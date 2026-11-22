import type {
  Arrangement,
  ArrangeOptions,
  GuitarNote,
} from "../../packages/contracts";
import {
  beatToSeconds,
  secondsToBeat,
  soundingEvents,
  validateScore,
  type InstrumentPluginV2,
  type MusicalScore,
  type PerformanceIssue,
  type PerformancePlan,
} from "../../packages/contracts/score";
import {
  chordName,
  transitionCost,
  tuning,
  voicings,
  type Voicing,
} from "./voicings";

export interface GuitarAction {
  id: string;
  beat: number;
  durationBeats: number;
  string: number;
  fret: number;
  finger: number;
  rightFinger: "p" | "i" | "m" | "a";
  kind: "pluck" | "strum" | "hammer" | "pull" | "slide";
  from?: string;
  stroke?: "down" | "up";
  strokeId?: string;
  velocity: number;
  role: "melody" | "bass" | "harmony";
  sourceIds: string[];
}
export interface GuitarGrip {
  beat: number;
  endBeat: number;
  chordId: string;
  shape: Voicing;
  name: string;
  transition: number;
}
export interface GuitarPerformance extends PerformancePlan<GuitarAction> {
  grips: GuitarGrip[];
  capo: number;
}
export interface GuitarOptions {
  difficulty: ArrangeOptions["difficulty"];
  capo: number;
  transpose: number;
  goal: NonNullable<ArrangeOptions["goal"]>;
  pattern: "strum" | "arpeggio";
}
const limits = {
  easy: { fret: 5, span: 3, minBeats: 1, shiftPerBeat: 2, barre: false },
  normal: { fret: 9, span: 4, minBeats: 0.5, shiftPerBeat: 3, barre: true },
  hard: { fret: 14, span: 4, minBeats: 0.25, shiftPerBeat: 4, barre: true },
  expert: { fret: 20, span: 4, minBeats: 0.25, shiftPerBeat: 5, barre: true },
};
/** Assign at most four physical fingers; a barre may not press through an open/lower note. */
export function assignFingers(
  notes: Pick<GuitarAction, "string" | "fret">[],
): number[] | null {
  const fingers = notes.map(() => 0);
  const fretted = notes
    .map((n, i) => ({ ...n, i }))
    .filter((n) => n.fret > 0)
    .sort((a, b) => a.fret - b.fret || a.string - b.string);
  if (!fretted.length) return fingers;
  if (fretted.length <= 4) {
    fretted.forEach((n, i) => (fingers[n.i] = i + 1));
    return fingers;
  }
  const lowest = fretted.filter((n) => n.fret === fretted[0].fret);
  const first = Math.min(...lowest.map((n) => n.string)),
    last = Math.max(...lowest.map((n) => n.string));
  if (
    notes.some(
      (n) => n.string >= first && n.string <= last && n.fret < lowest[0].fret,
    )
  )
    return null;
  const rest = fretted.filter((n) => n.fret !== lowest[0].fret);
  if (rest.length > 3) return null;
  lowest.forEach((n) => (fingers[n.i] = 1));
  rest.forEach((n, i) => (fingers[n.i] = i + 2));
  return fingers;
}
const rightFinger = (string: number): GuitarAction["rightFinger"] =>
  string >= 4 ? "p" : string === 3 ? "i" : string === 2 ? "m" : "a";
function validFingerState(active: GuitarAction[]): boolean {
  const fretted = active.filter((a) => a.fret > 0);
  if (
    fretted.some(
      (a) => !Number.isInteger(a.finger) || a.finger < 1 || a.finger > 4,
    )
  )
    return false;
  for (let finger = 1; finger <= 4; finger++) {
    const group = fretted.filter((a) => a.finger === finger);
    if (new Set(group.map((a) => a.fret)).size > 1) return false;
    if (group.length > 1) {
      const low = Math.min(...group.map((a) => a.string)),
        high = Math.max(...group.map((a) => a.string));
      if (
        finger !== 1 ||
        active.some(
          (a) => a.string >= low && a.string <= high && a.fret < group[0].fret,
        )
      )
        return false;
    }
  }
  return true;
}
function assignNewActions(actions: GuitarAction[]): GuitarAction[] {
  const kept: GuitarAction[] = [];
  // Solve protected melody first. Bass uses a free finger throughout its entire hold.
  for (const action of [...actions].sort(
    (a, b) =>
      (a.role === "melody" ? 0 : 1) - (b.role === "melody" ? 0 : 1) ||
      a.beat - b.beat,
  )) {
    const held = kept.filter(
      (a) =>
        a.beat + a.durationBeats > action.beat + 0.000001 &&
        a.beat < action.beat + action.durationBeats - 0.000001,
    );
    if (action.fret === 0) {
      action.finger = 0;
      kept.push(action);
      continue;
    }
    const fingers = [1, 2, 3, 4].sort(
      (a, b) =>
        Math.abs(a - Math.min(4, Math.max(1, action.fret))) -
        Math.abs(b - Math.min(4, Math.max(1, action.fret))),
    );
    const assigned = fingers.find((f) => {
      action.finger = f;
      return [
        action.beat,
        ...held
          .map((n) => n.beat)
          .filter(
            (b) => b > action.beat && b < action.beat + action.durationBeats,
          ),
      ].every((beat) =>
        validFingerState([
          ...held.filter(
            (n) =>
              n.beat <= beat + 0.000001 &&
              n.beat + n.durationBeats > beat + 0.000001,
          ),
          action,
        ]),
      );
    });
    if (assigned) {
      action.finger = assigned;
      kept.push(action);
    }
  }
  return kept.sort((a, b) => a.beat - b.beat);
}

function selectGrips(
  score: MusicalScore,
  options: GuitarOptions,
): GuitarGrip[] {
  const limit = limits[options.difficulty];
  type State = { cost: number; grips: GuitarGrip[] };
  let beam: State[] = [{ cost: 0, grips: [] }];
  for (const chord of [...score.chords].sort((a, b) => a.beat - b.beat)) {
    const root =
      (((chord.root + options.transpose - options.capo) % 12) + 12) % 12;
    const candidates = voicings(root, chord.quality, limit.barre).filter(
      (v) =>
        Math.max(...v.frets) <= limit.fret &&
        (chord.bass === undefined ||
          (tuning[v.frets.findLastIndex((f) => f >= 0)] +
            v.frets[v.frets.findLastIndex((f) => f >= 0)] +
            options.capo) %
            12 ===
            (chord.bass + options.transpose) % 12),
    );
    if (!candidates.length) continue;
    const next: State[] = [];
    for (const state of beam)
      for (const v of candidates) {
        const prev = state.grips.at(-1),
          cost = transitionCost(prev?.shape, v);
        const available = prev ? chord.beat - prev.beat : Infinity;
        if (
          prev &&
          cost >
            Math.max(2, available * limits[options.difficulty].shiftPerBeat)
        )
          continue;
        next.push({
          cost: state.cost + cost,
          grips: [
            ...state.grips,
            {
              beat: chord.beat,
              endBeat: chord.beat + chord.durationBeats,
              chordId: chord.id,
              shape: v,
              name: chordName(v),
              transition: cost,
            },
          ],
        });
      }
    if (next.length) beam = next.sort((a, b) => a.cost - b.cost).slice(0, 16);
  }
  return beam[0].grips;
}
function accompaniment(
  score: MusicalScore,
  options: GuitarOptions,
  grips: GuitarGrip[],
): GuitarAction[] {
  const actions: GuitarAction[] = [];
  for (const grip of grips) {
    const strings = grip.shape.frets
      .map((f, i) => ({ f, string: i + 1 }))
      .filter((x) => x.f >= 0)
      .sort((a, b) => b.string - a.string);
    const beatSeconds = 60 / score.tempo[0].bpm;
    const meter =
      score.meter.findLast((m) => m.beat <= grip.beat) ?? score.meter[0];
    const bar = (meter.numerator * 4) / meter.denominator;
    // Beginner uses two deliberate downstrokes per 4/4 bar. Daily has a stable pattern.
    const pattern =
      options.difficulty === "easy"
        ? [
            { beat: 0, up: false },
            { beat: 2, up: false },
          ]
        : [
            { beat: 0, up: false },
            { beat: 1, up: false },
            { beat: 1.5, up: true },
            { beat: 2.5, up: true },
            { beat: 3, up: false },
            { beat: 3.5, up: true },
          ];
    if (options.pattern === "strum") {
      for (let base = grip.beat; base < grip.endBeat - 0.01; base += bar)
        for (const p of pattern) {
          const beat = base + p.beat;
          if (beat >= Math.min(base + bar, grip.endBeat) - 0.01) continue;
          const order = p.up
            ? [...strings].reverse().filter((n) => n.string <= 3)
            : strings;
          const strokeId = `${grip.chordId}-${beat}`;
          order.forEach((n, i) => {
            const start = beat + (i * 0.009) / beatSeconds;
            if (start >= grip.endBeat) return;
            actions.push({
              id: `${strokeId}-s${n.string}`,
              beat: start,
              durationBeats: grip.endBeat - start,
              string: n.string,
              fret: n.f,
              finger: grip.shape.fingers[n.string - 1],
              rightFinger: rightFinger(n.string),
              kind: "strum",
              stroke: p.up ? "up" : "down",
              strokeId,
              velocity: (p.beat === 0 ? 0.62 : 0.5) * (1 - i * 0.035),
              role: n.string === strings[0].string ? "bass" : "harmony",
              sourceIds: [],
            });
          });
        }
    } else {
      const bass = strings[0].string;
      const picked =
        options.difficulty === "easy"
          ? [bass, 3, 2, 1]
          : [bass, 3, 2, 3, 1, 3, 2, 3];
      const step = options.difficulty === "easy" ? 1 : 0.5;
      for (
        let beat = grip.beat, i = 0;
        beat < grip.endBeat - 0.01;
        beat += step, i++
      ) {
        const string = picked[i % picked.length];
        if (grip.shape.frets[string - 1] < 0) continue;
        actions.push({
          id: `${grip.chordId}-${beat}-s${string}`,
          beat,
          durationBeats: grip.endBeat - beat,
          string,
          fret: grip.shape.frets[string - 1],
          finger: grip.shape.fingers[string - 1],
          rightFinger: rightFinger(string),
          kind: "pluck",
          velocity: string === bass ? 0.6 : 0.42,
          role: string === bass ? "bass" : "harmony",
          sourceIds: [],
        });
      }
    }
  }
  return actions;
}

function fingerstyle(
  score: MusicalScore,
  options: GuitarOptions,
  grips: GuitarGrip[],
): GuitarAction[] {
  const limit = limits[options.difficulty],
    actions: GuitarAction[] = [];
  const melody = soundingEvents(score).filter((n) => n.role === "melody");
  // Work in phrases: preserve melodic events, add only structural bass, never all detector leftovers.
  const times = new Map(score.events.map((e) => [e.id, e.beat]));
  let lastPosition = 0,
    lastBeat = -100,
    lastString = 0;
  for (const n of melody) {
    const beat = times.get(n.id)!;
    if (beat - lastBeat < limit.minBeats - 0.001) continue;
    const candidates = tuning
      .map((open, i) => ({
        string: i + 1,
        fret: n.pitch.midi + options.transpose - options.capo - open,
      }))
      .filter((p) => p.fret >= 0 && p.fret <= limit.fret)
      .sort((a, b) => {
        const grip = grips.find((g) => g.beat <= beat && g.endBeat > beat);
        const cost = (p: typeof a) =>
          Math.abs(p.fret - lastPosition) * 0.65 +
          (p.string === lastString ? -0.4 : 0) +
          (grip?.shape.frets[p.string - 1] === p.fret ? -2 : 0) +
          p.fret * 0.08;
        return cost(a) - cost(b);
      });
    for (const pos of candidates) {
      if (
        lastBeat > 0 &&
        Math.abs(pos.fret - lastPosition) >
          limit.shiftPerBeat * Math.max(0.5, beat - lastBeat) + 1
      )
        continue;
      const event = score.events.find((e) => e.id === n.id)!;
      const durationBeats = secondsToBeat(score, n.start + n.duration) - beat;
      const previous = actions.at(-1);
      const legato =
        options.difficulty !== "easy" &&
        event.slurFrom &&
        previous?.sourceIds.includes(event.slurFrom) &&
        previous.string === pos.string &&
        previous.fret !== pos.fret &&
        Math.abs(previous.fret - pos.fret) <= 3 &&
        Math.abs(previous.beat + previous.durationBeats - beat) < 0.05;
      const kind = legato
        ? pos.fret > previous!.fret
          ? "hammer"
          : "pull"
        : "pluck";
      actions.push({
        id: n.id,
        beat,
        durationBeats,
        string: pos.string,
        fret: pos.fret,
        finger: 0,
        rightFinger: rightFinger(pos.string),
        kind,
        from: legato ? previous!.id : undefined,
        velocity: n.velocity * 0.9,
        role: "melody",
        sourceIds: [n.id],
      });
      lastPosition = pos.fret;
      lastString = pos.string;
      lastBeat = beat;
      break;
    }
  }
  if (options.goal === "fingerstyle")
    for (const grip of grips) {
      const s = grip.shape.frets.findLastIndex((f) => f >= 0) + 1;
      // Roots on beats 1 and 3, with sustained melody kept ahead of bass.
      for (let beat = grip.beat; beat < grip.endBeat; beat += 2) {
        const active = actions.filter(
          (a) =>
            a.beat <= beat + 0.001 && a.beat + a.durationBeats > beat + 0.001,
        );
        const candidate: GuitarAction = {
          id: `bass-${grip.chordId}-${beat}`,
          beat,
          durationBeats: Math.min(2, grip.endBeat - beat),
          string: s,
          fret: grip.shape.frets[s - 1],
          finger: 0,
          rightFinger: "p",
          kind: "pluck",
          velocity: 0.46,
          role: "bass",
          sourceIds: [],
        };
        if (
          actions.some(
            (a) =>
              a.string === s &&
              a.beat < beat + candidate.durationBeats &&
              a.beat + a.durationBeats > beat,
          )
        )
          continue;
        if (
          active.some((a) => a.string === s) ||
          !assignFingers([...active, candidate])
        )
          continue;
        const frets = [...active, candidate]
          .filter((a) => a.fret > 0)
          .map((a) => a.fret);
        if (
          frets.length &&
          Math.max(...frets) - Math.min(...frets) > limit.span
        )
          continue;
        const future = actions.filter(
          (a) => a.beat > beat && a.beat < beat + candidate.durationBeats,
        );
        if (
          future.some((a) => {
            const held = [
              ...actions.filter(
                (b) =>
                  b.beat <= a.beat + 0.000001 &&
                  b.beat + b.durationBeats > a.beat + 0.000001,
              ),
              candidate,
            ];
            const f = held.filter((b) => b.fret > 0).map((b) => b.fret);
            return (
              !assignFingers(held) ||
              (f.length && Math.max(...f) - Math.min(...f) > limit.span)
            );
          })
        )
          continue;
        actions.push(candidate);
      }
    }
  return actions;
}
function terminateStrings(actions: GuitarAction[]) {
  actions.sort((a, b) => a.beat - b.beat || b.string - a.string);
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i],
      next = actions.slice(i + 1).find((b) => b.string === a.string);
    if (next && a.beat + a.durationBeats > next.beat)
      a.durationBeats = Math.max(0.001, next.beat - a.beat);
  }
}
export function validatePerformance(
  plan: PerformancePlan<GuitarAction>,
  options: GuitarOptions,
): PerformanceIssue[] {
  const issues: PerformanceIssue[] = [],
    limit = limits[options.difficulty];
  const add = (code: string, events: GuitarAction[], message: string) =>
    issues.push({
      code,
      severity: "error",
      eventIds: events.map((e) => e.id),
      message,
    });
  for (const a of plan.actions) {
    if (
      !Number.isInteger(a.string) ||
      a.string < 1 ||
      a.string > 6 ||
      !Number.isInteger(a.fret) ||
      a.fret < 0 ||
      a.fret > limit.fret ||
      a.fret + options.capo > 24 ||
      !Number.isFinite(a.beat) ||
      a.beat < 0 ||
      !Number.isFinite(a.durationBeats) ||
      a.durationBeats <= 0
    ) {
      add("position", [a], "弦位、品位或时长无效");
      continue;
    }
    const active = plan.actions.filter(
      (b) =>
        b.beat <= a.beat + 0.000001 &&
        b.beat + b.durationBeats > a.beat + 0.000001,
    );
    if (new Set(active.map((b) => b.string)).size < active.length)
      add("string-occupancy", active, "同弦持续音冲突");
    const frets = active.filter((b) => b.fret > 0).map((b) => b.fret);
    if (frets.length && Math.max(...frets) - Math.min(...frets) > limit.span)
      add("span", active, "按弦跨度超出限制");
    if (!assignFingers(active))
      add("fingers", active, "按弦需要超过四指，或横按压住了开放弦");
    if (
      active.every((a) => a.fret === 0 || a.finger > 0) &&
      !validFingerState(active)
    )
      add(
        "finger-hold",
        active,
        "持续音使用同一手指按在不同品位，或横按与开放弦冲突",
      );
    if (a.kind === "hammer" || a.kind === "pull" || a.kind === "slide") {
      const previous = plan.actions.find((b) => b.id === a.from);
      if (
        !previous ||
        previous.string !== a.string ||
        Math.abs(previous.beat + previous.durationBeats - a.beat) > 0.002 ||
        previous.fret === a.fret ||
        (a.kind === "hammer" && previous.fret >= a.fret) ||
        (a.kind === "pull" && previous.fret <= a.fret)
      )
        add("legato", [a], "连奏必须连接同弦相邻动作并符合方向");
    }
  }
  return issues.filter(
    (x, i, all) =>
      all.findIndex(
        (y) => y.code === x.code && y.eventIds.join() === x.eventIds.join(),
      ) === i,
  );
}
export function arrangeScore(
  score: MusicalScore,
  options: GuitarOptions,
): GuitarPerformance {
  validateScore(score);
  if (
    !limits[options.difficulty] ||
    !Number.isInteger(options.capo) ||
    options.capo < 0 ||
    options.capo > 12 ||
    !Number.isInteger(options.transpose) ||
    Math.abs(options.transpose) > 12
  )
    throw new Error("吉他演奏参数无效");
  const grips = selectGrips(score, options);
  let actions =
    options.goal === "accompaniment"
      ? accompaniment(score, options, grips)
      : fingerstyle(score, options, grips);
  terminateStrings(actions);
  // A held note retains its physical finger until release; later states cannot rewrite it.
  if (options.goal !== "accompaniment") actions = assignNewActions(actions);
  const plan: GuitarPerformance = {
    instrumentId: "guitar",
    version: 2,
    goal: options.goal,
    difficulty: options.difficulty,
    actions,
    grips,
    capo: options.capo,
    issues: [],
  };
  plan.issues = validatePerformance(plan, options);
  if (options.goal === "accompaniment") {
    let covered = 0;
    for (const chord of [...score.chords].sort((a, b) => a.beat - b.beat)) {
      if (chord.beat > covered + 0.01) break;
      covered = Math.max(covered, chord.beat + chord.durationBeats);
    }
    if (covered < score.durationBeats - 0.01)
      plan.issues.push({
        code: "unknown-harmony",
        severity: "warning",
        eventIds: [],
        message:
          "和弦进行尚未覆盖完整片段；未确定的区间保持空白，请在音乐结构中补充。",
      });
  }
  if (options.goal === "accompaniment" && grips.length < score.chords.length)
    plan.issues.push({
      code: "missing-voicing",
      severity: "warning",
      eventIds: [],
      message:
        "部分和弦没有当前难度下可用的指型或换和弦准备时间；请改用变调夹、移调或手动简化。",
    });
  if (options.goal === "accompaniment" && !grips.length)
    throw new Error(
      "没有可用和弦。请先确认和弦进行；单线旋律不足以可靠决定伴奏和弦。",
    );
  const errors = plan.issues.filter((i) => i.severity === "error");
  if (errors.length) throw new Error(errors[0].message);
  return plan;
}
export function soundEvents(
  plan: PerformancePlan<GuitarAction>,
  score: MusicalScore,
): GuitarNote[] {
  const capo = (plan as GuitarPerformance).capo ?? 0;
  return plan.actions.map((a) => ({
    id: a.id,
    start: beatToSeconds(score, a.beat),
    duration:
      beatToSeconds(score, a.beat + a.durationBeats) -
      beatToSeconds(score, a.beat),
    pitch: { midi: tuning[a.string - 1] + capo + a.fret },
    velocity: a.velocity,
    score: 1,
    source: "generated",
    role: a.role,
    string: a.string,
    fret: a.fret,
    leftFinger: a.finger,
    rightFinger: a.rightFinger,
    attack: a.kind,
    linkFrom: a.from,
    stroke: a.stroke,
    strokeId: a.strokeId,
    technique: a.kind === "hammer" ? "h" : a.kind === "pull" ? "p" : undefined,
    letRing: true,
  }));
}
export const guitarPerformancePlugin: InstrumentPluginV2<
  GuitarOptions,
  GuitarAction,
  GuitarGrip[]
> = {
  id: "guitar",
  arrangeScore,
  validatePerformance,
  soundEvents,
  notation: (plan) => (plan as GuitarPerformance).grips,
  editor: {
    fields: [
      { key: "capo", label: "变调夹", kind: "number" },
      {
        key: "pattern",
        label: "伴奏手法",
        kind: "choice",
        values: ["strum", "arpeggio"],
      },
    ],
  },
};
export function arrangeMusicalScore(
  score: MusicalScore,
  options: ArrangeOptions,
): Arrangement {
  const plan = arrangeScore(score, {
    difficulty: options.difficulty,
    capo: options.capo,
    transpose: options.transpose,
    goal: options.goal ?? "accompaniment",
    pattern: options.pattern ?? "strum",
  });
  let notes = soundEvents(plan, score);
  const locked = (options.previous ?? []).filter((n) => n.locked);
  if (locked.length) {
    const errors = validateProjectedNotes(locked, { ...options, score });
    if (errors.length)
      throw new Error("锁定音符与当前设置冲突：" + errors.join("、"));
    const lockedIds = new Set(locked.map((n) => n.id));
    const kept = [...locked];
    for (const note of notes
      .filter((n) => !lockedIds.has(n.id))
      .sort(
        (a, b) =>
          (a.role === "melody" ? -1 : 0) - (b.role === "melody" ? -1 : 0) ||
          a.start - b.start,
      )) {
      if (
        !validateProjectedNotes([...kept, note], { ...options, score }).length
      )
        kept.push(note);
    }
    notes = kept.sort((a, b) => a.start - b.start);
    plan.actions = projectActions(notes, score);
    plan.issues.push({
      code: "locked",
      severity: "warning",
      eventIds: locked.map((n) => n.id),
      message: "已保留锁定编辑，冲突的自动动作已省略；和弦图表示参考指型。",
    });
  }
  const kept = new Set(
    notes.flatMap(
      (n) => plan.actions.find((a) => a.id === n.id)?.sourceIds ?? [],
    ),
  );
  return {
    id: crypto.randomUUID(),
    instrumentId: "guitar",
    difficulty: options.difficulty,
    capo: options.capo,
    transpose: options.transpose,
    goal: plan.goal,
    score,
    performance: plan,
    notes,
    dropped:
      plan.goal === "accompaniment"
        ? []
        : score.events
            .filter((e) => e.midi !== null && !e.tieFrom && !kept.has(e.id))
            .map((e) => ({
              noteId: e.id,
              reason: "优先旋律后按演奏动作约束简化；未增加检测残留音",
            })),
    warnings: [
      ...score.warnings,
      ...plan.issues.map((i) => i.message),
      "结构化编配仍需真人试弹；连奏音色为采样/合成近似。",
    ],
  };
}
function projectActions(
  notes: GuitarNote[],
  score: MusicalScore,
): GuitarAction[] {
  return notes.map((n) => ({
    id: n.id,
    beat: secondsToBeat(score, n.start),
    durationBeats:
      secondsToBeat(score, n.start + n.duration) -
      secondsToBeat(score, n.start),
    string: n.string,
    fret: n.fret,
    finger: n.leftFinger ?? 0,
    rightFinger: n.rightFinger ?? rightFinger(n.string),
    kind: n.attack ?? "pluck",
    from: n.linkFrom,
    stroke: n.stroke,
    strokeId: n.strokeId,
    velocity: n.velocity,
    role: n.role ?? "harmony",
    sourceIds: [n.id],
  }));
}
export function validateProjectedNotes(
  notes: GuitarNote[],
  options: ArrangeOptions,
): string[] {
  const score = options.score;
  if (!score) return ["缺少音乐时间网格"];
  const errors = validatePerformance(
    {
      instrumentId: "guitar",
      version: 2,
      goal: options.goal ?? "accompaniment",
      difficulty: options.difficulty,
      actions: projectActions(notes, score),
      issues: [],
    },
    {
      difficulty: options.difficulty,
      capo: options.capo,
      transpose: options.transpose,
      goal: options.goal ?? "accompaniment",
      pattern: options.pattern ?? "strum",
    },
  )
    .filter((i) => i.severity === "error")
    .map((i) => i.message);
  if (
    notes.some(
      (n) => n.pitch.midi !== tuning[n.string - 1] + options.capo + n.fret,
    )
  )
    errors.push("弦位与音高不一致");
  return [...new Set(errors)];
}
export function recommendForScore(
  score: MusicalScore,
  options: Omit<GuitarOptions, "capo">,
) {
  return Array.from({ length: 10 }, (_, capo) => {
    try {
      const plan = arrangeScore(score, { ...options, capo });
      const missing = score.chords.length - plan.grips.length;
      return {
        capo,
        score:
          Math.round(
            (100 -
              missing * 25 -
              plan.grips.reduce((s, g) => s + g.transition, 0) -
              capo * 0.4) *
              100,
          ) / 100,
      };
    } catch {
      return { capo, score: -10000 };
    }
  })
    .sort((a, b) => b.score - a.score)
    .filter((c) => c.score > -10000);
}

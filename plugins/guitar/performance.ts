import type {
  Arrangement,
  ArrangeOptions,
  GuitarNote,
} from "../../packages/contracts";
import {
  beatToSeconds,
  secondsToBeat,
  validateScore,
  eventRole,
  type InstrumentPluginV2,
  type MusicalScore,
  type PerformancePlan,
} from "../../packages/contracts/score";
import { tuning } from "./voicings";
import {
  limits,
  type GuitarAction,
  type GuitarGrip,
  type GuitarOptions,
  type GuitarPerformance,
} from "./types";
import {
  assignNewActions,
  terminateStrings,
  assignRightHand,
  rightFinger,
} from "./hands";
import { selectGrips } from "./voicing-planner";
import { accompaniment } from "./accompaniment";
import { fingerstyle } from "./fingerstyle";
import { validatePerformance } from "./validation";
import { addInnerVoice } from "./inner-voice";
export type {
  GuitarAction,
  GuitarGrip,
  GuitarOptions,
  GuitarPerformance,
} from "./types";
export { assignFingers } from "./hands";
export { validatePerformance } from "./validation";

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
  if (options.goal === "fingerstyle")
    actions = addInnerVoice(
      score,
      grips,
      actions,
      options,
      (current, candidate) => {
        const trial = assignNewActions([...current, candidate]);
        if (trial.length !== current.length + 1) return null;
        const check: PerformancePlan<GuitarAction> = {
          instrumentId: "guitar",
          version: 2,
          goal: options.goal,
          difficulty: options.difficulty,
          actions: trial,
          issues: [],
        };
        assignRightHand(trial);
        return validatePerformance(check, options).some(
          (i) => i.severity === "error",
        )
          ? null
          : trial;
      },
    );
  assignRightHand(actions);
  if (options.phrases?.length && options.goal === "fingerstyle") {
    const kept = new Set(actions.flatMap((a) => a.sourceIds));
    const missing = score.events.filter(
      (e) =>
        e.midi !== null &&
        e.extensions?.arranger?.anchor &&
        !e.tieFrom &&
        !kept.has(e.id),
    );
    if (missing.length)
      throw new Error(
        `当前指法无法保留 ${missing.length} 个旋律骨干音；请调整难度或变调夹，原谱保留。`,
      );
  }
  for (const a of actions) {
    const energy = score.sections.find(
      (s) => s.beat <= a.beat && s.endBeat > a.beat,
    )?.energy;
    if (energy === "gentle") a.velocity *= 0.8;
    else if (energy === "emphatic")
      a.velocity = Math.min(
        1,
        a.velocity * (a.role === "melody" ? 1.12 : 0.95),
      );
  }
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
  if (options.goal === "accompaniment")
    for (const grip of grips)
      if (
        !actions.some(
          (a) => a.beat >= grip.beat - 0.001 && a.beat < grip.endBeat - 0.001,
        )
      )
        plan.issues.push({
          code: "rhythm-rest",
          severity: "warning",
          eventIds: [grip.chordId],
          message: `${grip.name} 所在的短区间没有节奏型起音，保持休止；可调整换和弦位置或手法。`,
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
    dead: a.kind === "dead" ? true : undefined,
    notationDurationBeats: a.notationDurationBeats,
    linkFrom: a.from,
    stroke: a.stroke,
    strokeId: a.strokeId,
    technique: a.kind === "hammer" ? "h" : a.kind === "pull" ? "p" : undefined,
    articulation: a.articulation,
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
        values: ["auto", "strum", "arpeggio"],
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
    phrases: options.phrases,
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
  if (options.phrases?.length && plan.goal === "fingerstyle") {
    const missing = score.events.filter(
      (e) =>
        e.midi !== null &&
        !e.tieFrom &&
        e.extensions?.arranger?.anchor &&
        !kept.has(e.id),
    );
    if (missing.length)
      throw new Error(
        `锁定动作与 ${missing.length} 个旋律骨干冲突，无法完整保留；请校正锁定音符，原谱保留。`,
      );
  }
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
            .filter(
              (e) =>
                (e.midi !== null || e.unpitched) &&
                !e.tieFrom &&
                !kept.has(e.id),
            )
            .map((e) => ({
              noteId: e.id,
              reason: "优先旋律后按演奏动作约束简化；未增加检测残留音",
            })),
    warnings: [
      ...score.warnings,
      ...plan.issues.map((i) => i.message),
      "编配通过动作约束检查；真实谱面比较见评估文档。连奏音色为采样/合成近似。",
      ...(notes.some((n) => n.dead)
        ? ["闷音试听为短噪声近似，MIDI 使用打击乐侧击音代替。"]
        : []),
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
    notationDurationBeats: n.notationDurationBeats,
    string: n.string,
    fret: n.fret,
    finger: n.leftFinger ?? 0,
    rightFinger: n.rightFinger ?? rightFinger(n.string),
    kind: n.dead ? "dead" : (n.attack ?? "pluck"),
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
/** Keep the v1 editing projection and v2 action plan consistent after manual edits. */
export function syncPerformance(arrangement: Arrangement): Arrangement {
  if (
    !arrangement.score ||
    !arrangement.performance ||
    arrangement.performance.version !== 2
  )
    return arrangement;
  const ids = new Set(arrangement.notes.map((n) => n.id));
  let unlinked = 0;
  const notes = arrangement.notes.map((n) => {
    if (!n.linkFrom || ids.has(n.linkFrom)) return n;
    if (n.locked)
      throw new Error("已锁定的连奏音仍依赖被删除的起点，请先解锁该连奏音。");
    unlinked++;
    return {
      ...n,
      attack: "pluck" as const,
      linkFrom: undefined,
      technique: undefined,
    };
  });
  const options: ArrangeOptions = {
    difficulty: arrangement.difficulty,
    capo: arrangement.capo,
    transpose: arrangement.transpose,
    bpm: arrangement.score.tempo[0].bpm,
    goal: arrangement.goal,
    score: arrangement.score,
  };
  const errors = validateProjectedNotes(notes, options);
  if (errors.length) throw new Error(errors.join("、"));
  return {
    ...arrangement,
    notes,
    performance: {
      ...arrangement.performance,
      actions: projectActions(notes, arrangement.score),
    },
    warnings: [
      ...arrangement.warnings,
      ...(unlinked
        ? [`删除了连奏起点，${unlinked} 个未锁定的后续音已改为独立拨弦。`]
        : []),
    ],
  };
}
export function recommendForScore(
  score: MusicalScore,
  options: Omit<GuitarOptions, "capo">,
) {
  return Array.from({ length: 10 }, (_, capo) => {
    try {
      const plan = arrangeScore(score, { ...options, capo });
      const missing = score.chords.length - plan.grips.length;
      const expected =
        options.goal === "accompaniment"
          ? []
          : score.events.filter(
              (e) => e.midi !== null && eventRole(e) === "melody" && !e.tieFrom,
            );
      const retained = new Set(plan.actions.flatMap((a) => a.sourceIds));
      const missingMelody = expected.filter((e) => !retained.has(e.id)).length;
      return {
        capo,
        score:
          Math.round(
            (100 -
              missing * 25 -
              missingMelody * 20 -
              plan.grips.reduce((s, g) => s + g.transition, 0) -
              capo * 0.8 -
              Math.max(0, capo - 5) * 1.2) *
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

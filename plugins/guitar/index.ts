import type {
  Arrangement,
  ArrangeOptions,
  GuitarNote,
  InstrumentDefinition,
  MusicPlugin,
  NoteEvent,
} from "../../packages/contracts";
import {
  arrangeMusicalScore,
  validateProjectedNotes,
  guitarPerformancePlugin,
  recommendForScore,
} from "./performance";
export const guitar: InstrumentDefinition = {
  id: "guitar",
  name: "标准六弦吉他",
  pitchRange: [40, 88],
  tuning: [64, 59, 55, 50, 45, 40],
  maxFret: 24,
  notation: ["tablature", "staff"],
  techniques: ["h", "p", "pm", "dead"],
};
export const levels = {
  easy: { voices: 1, fret: 5, span: 3, gap: 0.3, speed: 6 },
  normal: { voices: 2, fret: 9, span: 4, gap: 0.18, speed: 8 },
  hard: { voices: 3, fret: 14, span: 4, gap: 0.12, speed: 10 },
  expert: { voices: 4, fret: 20, span: 4, gap: 0.09, speed: 12 },
};
export function positions(midi: number, capo: number, maxFret = 24) {
  return guitar.tuning!.flatMap((open, i) => {
    const fret = midi - open - capo;
    return fret >= 0 && fret <= Math.min(maxFret, 24 - capo)
      ? [{ string: i + 1, fret }]
      : [];
  });
}
export function violations(
  notes: GuitarNote[],
  options: ArrangeOptions,
): string[] {
  if (options.score && options.goal !== "melody")
    return validateProjectedNotes(notes, options);
  const c = levels[options.difficulty],
    errors = new Set<string>();
  let active: GuitarNote[] = [];
  for (const n of [...notes].sort((a, b) => a.start - b.start)) {
    if (
      n.pitch.midi !== guitar.tuning![n.string - 1] + options.capo + n.fret ||
      n.fret < 0 ||
      n.fret > c.fret ||
      n.fret + options.capo > 24
    )
      errors.add("弦位或品位超出限制");
    active = active.filter((x) => x.start + x.duration > n.start + 0.00001);
    active.push(n);
    if (new Set(active.map((x) => x.string)).size < active.length)
      errors.add("同弦持续音冲突");
    if (active.length > c.voices) errors.add("同时声部超出限制");
    const frets = active.filter((x) => x.fret > 0).map((x) => x.fret);
    if (frets.length && Math.max(...frets) - Math.min(...frets) > c.span)
      errors.add("按弦跨度超出限制");
    if (errors.size) return [...errors];
  }
  return [...errors];
}
export function arrange(
  input: NoteEvent[],
  options: ArrangeOptions,
): Arrangement {
  if (options.score && options.goal !== "melody")
    return arrangeMusicalScore(options.score, options);
  const c = levels[options.difficulty];
  if (
    !c ||
    !Number.isInteger(options.capo) ||
    options.capo < 0 ||
    options.capo > 12 ||
    !Number.isInteger(options.transpose) ||
    Math.abs(options.transpose) > 12
  )
    throw new Error("吉他编配参数无效");
  const locked = (options.previous ?? [])
    .filter((n) => n.locked)
    .map((n) => ({ ...n, pitch: { ...n.pitch } }));
  const lockErrors = violations(locked, options);
  if (lockErrors.length)
    throw new Error(
      "锁定音符与当前设置冲突：" +
        lockErrors.join("、") +
        "。请修改设置或解锁对应音符。",
    );
  const lockedIds = new Set(locked.map((n) => n.id));
  const source = input
    .filter((n) => !lockedIds.has(n.id))
    .map((n) => ({
      ...n,
      pitch: { ...n.pitch, midi: n.pitch.midi + options.transpose },
    }))
    .sort((a, b) => a.start - b.start || (a.role === "melody" ? -1 : 1));
  const phrasePractice =
    options.profile === "phrasing" && options.goal === "melody";
  const groups: NoteEvent[][] = [];
  for (const n of source) {
    if (!groups.length || n.start - groups.at(-1)![0].start > 0.055)
      groups.push([]);
    groups.at(-1)!.push(n);
  }
  type State = {
    notes: GuitarNote[];
    cost: number;
    position: number;
    lastTime: number;
    lastAttack: number;
    lastString?: number;
  };
  let beam: State[] = [
    { notes: locked, cost: 0, position: 0, lastTime: -100, lastAttack: -100 },
  ];
  for (const group of groups) {
    const ordered = group
      .sort(
        (a, b) =>
          (b.role === "melody" ? 1 : 0) - (a.role === "melody" ? 1 : 0) ||
          b.score - a.score,
      )
      .slice(0, phrasePractice ? 1 : 8);
    let local = beam;
    for (const note of ordered) {
      const next: State[] = [];
      for (const state of local) {
        next.push({
          ...state,
          cost:
            state.cost -
            (note.role === "melody" ? 9 : 0) -
            (phrasePractice && (note.source === "manual" || note.locked)
              ? 6
              : 0),
        });
        if (
          note.start - state.lastAttack < c.gap - 0.00001 &&
          Math.abs(note.start - state.lastAttack) > 0.055
        )
          continue;
        for (const pos of positions(note.pitch.midi, options.capo, c.fret)) {
          const candidate: GuitarNote = {
            ...note,
            ...pos,
            pitch: { ...note.pitch },
          };
          // A real new attack ends an unlocked sustain on the same string.
          let notes = state.notes.map((n) =>
            n.string === pos.string &&
            !n.locked &&
            n.start < note.start &&
            n.start + n.duration > note.start
              ? { ...n, duration: note.start - n.start }
              : n,
          );
          const active = notes.filter(
            (n) =>
              n.start <= note.start + 0.00001 &&
              n.start + n.duration > note.start + 0.00001,
          );
          if (
            active.some((n) => n.string === pos.string) ||
            active.length >= c.voices
          )
            continue;
          const frets = [...active, candidate]
            .filter((n) => n.fret > 0)
            .map((n) => n.fret);
          if (frets.length && Math.max(...frets) - Math.min(...frets) > c.span)
            continue;
          // Also check future locked attacks; locked edits cannot be truncated.
          if (
            notes.some(
              (n) =>
                n.locked &&
                n.start > note.start &&
                n.start < note.start + note.duration &&
                (n.string === pos.string || active.length + 1 >= c.voices),
            )
          )
            continue;
          const center = frets.length
            ? frets.reduce((a, b) => a + b, 0) / frets.length
            : state.position;
          const dt = note.start - state.lastTime;
          if (
            dt > 0 &&
            Math.abs(center - state.position) > c.speed * Math.max(0.2, dt) + 1
          )
            continue;
          notes = [...notes, candidate];
          const movement = Math.abs(center - state.position);
          const phraseCost =
            phrasePractice && dt < 1.05
              ? movement *
                  (options.difficulty === "easy" ||
                  options.difficulty === "normal"
                    ? 0.42
                    : 0.2) +
                (state.lastString === undefined
                  ? 0
                  : Math.max(0, Math.abs(state.lastString - pos.string) - 1) *
                    0.36) /
                  (Math.max(0.24, dt) * 2)
              : 0;
          const reward =
            (note.role === "melody" ? 12 : 1.5) +
            note.score * 0.7 -
            pos.fret * 0.025 -
            movement * 0.08 -
            phraseCost;
          next.push({
            notes,
            cost: state.cost + reward,
            position: center,
            lastTime: note.start,
            lastAttack: note.start,
            lastString: pos.string,
          });
        }
      }
      local = next.sort((a, b) => b.cost - a.cost).slice(0, 12);
    }
    beam = local;
  }
  const result = (beam[0]?.notes ?? locked)
    .filter((n) => n.duration > 0.001)
    .sort((a, b) => a.start - b.start || a.string - b.string);
  // Drop any non-locked note that crosses a future locked multi-voice constraint.
  let kept: GuitarNote[] = result;
  if (violations(result, options).length) {
    kept = [...locked];
    for (const note of result.filter((n) => !n.locked))
      if (!violations([...kept, note], options).length) kept.push(note);
  }
  kept.sort((a, b) => a.start - b.start || a.string - b.string);
  const ids = new Set(kept.map((n) => n.id));
  return {
    id: crypto.randomUUID(),
    instrumentId: guitar.id,
    difficulty: options.difficulty,
    capo: options.capo,
    transpose: options.transpose,
    notes: kept,
    dropped: input
      .filter((n) => !ids.has(n.id))
      .map((n) => ({
        noteId: n.id,
        reason: positions(
          n.pitch.midi + options.transpose,
          options.capo,
          c.fret,
        ).length
          ? "密度、声部或动作约束"
          : "当前音域或品位不可覆盖",
      })),
    warnings: [
      "指法为约束算法建议，仍需试弹核对。",
      ...(locked.length ? ["已保留锁定音符；冲突的自动音符被省略。"] : []),
    ],
  };
}
export function recommend(
  notes: NoteEvent[],
  difficulty: ArrangeOptions["difficulty"],
) {
  const score = (capo: number) =>
    notes.reduce((sum, n) => {
      const p = positions(n.pitch.midi, capo, levels[difficulty].fret);
      return (
        sum + (p.length ? 10 - Math.min(...p.map((x) => x.fret)) * 0.07 : 0)
      );
    }, 0) -
    capo * 0.1;
  return Array.from({ length: 10 }, (_, capo) => ({
    capo,
    score: score(capo),
  })).sort((a, b) => b.score - a.score);
}
export default {
  ...guitarPerformancePlugin,
  instrument: guitar,
  arrange,
  recommendCapos: (notes, options) =>
    options.goal !== "melody" && options.score
      ? recommendForScore(options.score, {
          difficulty: options.difficulty,
          transpose: options.transpose,
          goal: options.goal ?? "accompaniment",
          pattern: options.pattern ?? "strum",
          phrases: options.phrases,
          profile: options.profile,
        })
      : recommend(notes, options.difficulty),
} satisfies MusicPlugin;

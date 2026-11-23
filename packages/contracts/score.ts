/** SDK v2 musical facts. No tuning, hands, capo or pedal rules belong here. */
import type { Difficulty, NoteEvent } from "./index";

export type ArrangementGoal = "accompaniment" | "fingerstyle" | "melody";
export interface TempoPoint {
  beat: number;
  bpm: number;
}
export interface MeterPoint {
  beat: number;
  numerator: number;
  denominator: number;
}
export interface ScoreEvent {
  id: string;
  voice: string;
  beat: number;
  durationBeats: number;
  /** null is a rest, or a percussion event when unpitched=true. */
  midi: number | null;
  unpitched?: boolean;
  velocity: number;
  sourceIds: string[];
  origin?: NoteEvent["source"] | "imported";
  /** Namespaced primitive notation data; interpretation belongs to instrument packages. */
  extensions?: Record<string, Record<string, string | number | boolean>>;
  role?: "melody" | "bass" | "harmony";
  roleOrigin?: "manual" | "inferred" | "imported";
  activation?: number;
  tieFrom?: string;
  slurFrom?: string;
}
export interface ChordSymbol {
  id: string;
  beat: number;
  durationBeats: number;
  root: number;
  quality: "major" | "minor" | "7" | "maj7" | "m7" | "sus4";
  bass?: number;
  origin: "manual" | "imported" | "estimated";
  /** Relative evidence margin, never calibrated probability. */
  evidence?: number;
  alternatives?: {
    root: number;
    quality: ChordSymbol["quality"];
    score: number;
  }[];
}
export function eventRole(
  event: Pick<ScoreEvent, "voice" | "role">,
): NonNullable<ScoreEvent["role"]> {
  return (
    event.role ??
    (event.voice === "melody"
      ? "melody"
      : event.voice === "bass"
        ? "bass"
        : "harmony")
  );
}
export interface MusicalScore {
  version: 2;
  durationBeats: number;
  tempo: TempoPoint[];
  meter: MeterPoint[];
  beatOffsetSeconds: number;
  /** Length of the initial incomplete bar, in quarter-note beats. */
  pickupBeats?: number;
  timing: "manual" | "imported" | "estimated" | "unconfirmed";
  events: ScoreEvent[];
  chords: ChordSymbol[];
  sections: {
    id: string;
    beat: number;
    endBeat: number;
    label: string;
    origin: "manual" | "imported";
    energy?: "gentle" | "steady" | "emphatic";
  }[];
  warnings: string[];
}
export interface PerformanceIssue {
  code: string;
  severity: "error" | "warning";
  eventIds: string[];
  message: string;
}
export interface PerformancePlan<Action> {
  instrumentId: string;
  version: number;
  goal: ArrangementGoal;
  difficulty: Difficulty;
  actions: Action[];
  issues: PerformanceIssue[];
}
/** An instrument package owns its options, actions, validation and projections. */
export interface InstrumentPluginV2<Options, Action, Notation> {
  id: string;
  arrangeScore(score: MusicalScore, options: Options): PerformancePlan<Action>;
  validatePerformance(
    plan: PerformancePlan<Action>,
    options: Options,
  ): PerformanceIssue[];
  notation(plan: PerformancePlan<Action>): Notation;
  soundEvents(plan: PerformancePlan<Action>, score: MusicalScore): NoteEvent[];
  editor: {
    fields: {
      key: string;
      label: string;
      kind: "number" | "choice";
      values?: string[];
    }[];
  };
}

export function beatToSeconds(score: MusicalScore, beat: number): number {
  let seconds = score.beatOffsetSeconds;
  for (let i = 0; i < score.tempo.length; i++) {
    const point = score.tempo[i];
    if (beat <= point.beat) break;
    seconds +=
      ((Math.min(beat, score.tempo[i + 1]?.beat ?? beat) - point.beat) * 60) /
      point.bpm;
  }
  return seconds;
}
export function secondsToBeat(score: MusicalScore, seconds: number): number {
  let remaining = seconds - score.beatOffsetSeconds;
  if (remaining < 0) return (remaining * score.tempo[0].bpm) / 60;
  for (let i = 0; i < score.tempo.length; i++) {
    const point = score.tempo[i],
      next = score.tempo[i + 1];
    const length = next
      ? ((next.beat - point.beat) * 60) / point.bpm
      : Infinity;
    if (remaining <= length) return point.beat + (remaining * point.bpm) / 60;
    remaining -= length;
  }
  return 0;
}
export function validateScore(score: MusicalScore): void {
  const finite = (n: number) => Number.isFinite(n);
  if (
    score?.version !== 2 ||
    !finite(score.durationBeats) ||
    score.durationBeats <= 0 ||
    !finite(score.beatOffsetSeconds) ||
    !score.tempo?.length ||
    score.tempo[0].beat !== 0 ||
    !score.meter?.length ||
    score.meter[0].beat !== 0 ||
    !Array.isArray(score.events) ||
    !Array.isArray(score.chords) ||
    !Array.isArray(score.warnings) ||
    score.warnings.some((w) => typeof w !== "string") ||
    !Array.isArray(score.sections) ||
    !["manual", "imported", "estimated", "unconfirmed"].includes(
      score.timing,
    ) ||
    score.events.length > 100000
  )
    throw new Error("音乐结构无效");
  const barLength = (score.meter[0].numerator * 4) / score.meter[0].denominator;
  if (
    score.pickupBeats !== undefined &&
    (!finite(score.pickupBeats) ||
      score.pickupBeats <= 0 ||
      score.pickupBeats >= barLength)
  )
    throw new Error("弱起长度必须小于完整小节");
  for (const [i, p] of score.tempo.entries())
    if (
      !finite(p.beat) ||
      !finite(p.bpm) ||
      p.bpm < 20 ||
      p.bpm > 300 ||
      (i > 0 && p.beat <= score.tempo[i - 1].beat)
    )
      throw new Error("速度图无效");
  for (const [i, m] of score.meter.entries())
    if (
      !finite(m.beat) ||
      !Number.isInteger(m.numerator) ||
      m.numerator < 1 ||
      m.numerator > 32 ||
      ![1, 2, 4, 8, 16].includes(m.denominator) ||
      (i > 0 && m.beat <= score.meter[i - 1].beat)
    )
      throw new Error("拍号图无效");
  const events = new Map<string, ScoreEvent>();
  for (const e of score.events) {
    if (
      !e.id ||
      events.has(e.id) ||
      !e.voice ||
      !finite(e.beat) ||
      e.beat < 0 ||
      !finite(e.durationBeats) ||
      e.durationBeats <= 0 ||
      e.beat + e.durationBeats > score.durationBeats + 0.001 ||
      (e.midi !== null &&
        (!Number.isInteger(e.midi) || e.midi < 0 || e.midi > 127)) ||
      !finite(e.velocity) ||
      e.velocity < 0 ||
      e.velocity > 1 ||
      !Array.isArray(e.sourceIds)
    )
      throw new Error("谱面事件无效");
    if (
      e.origin !== undefined &&
      !["detected", "manual", "imported", "generated", "demo"].includes(
        e.origin,
      )
    )
      throw new Error("谱面来源无效");
    if (
      e.activation !== undefined &&
      (!finite(e.activation) || e.activation < 0 || e.activation > 1)
    )
      throw new Error("谱面激活值无效");
    if (
      e.roleOrigin !== undefined &&
      !["manual", "inferred", "imported"].includes(e.roleOrigin)
    )
      throw new Error("声部用途来源无效");
    if (
      e.unpitched !== undefined &&
      (typeof e.unpitched !== "boolean" || (e.unpitched && e.midi !== null))
    )
      throw new Error("非音高事件不能同时声明固定音高");
    if (e.role !== undefined && !["melody", "bass", "harmony"].includes(e.role))
      throw new Error("声部用途无效");
    if (
      e.extensions !== undefined &&
      (e.extensions === null ||
        Array.isArray(e.extensions) ||
        typeof e.extensions !== "object" ||
        Object.values(e.extensions).some(
          (fields) =>
            fields === null ||
            Array.isArray(fields) ||
            typeof fields !== "object" ||
            Object.values(fields).some(
              (value) =>
                !["string", "number", "boolean"].includes(typeof value) ||
                (typeof value === "number" && !finite(value)),
            ),
        ))
    )
      throw new Error("谱面扩展只能包含分命名空间的有限基础值");
    events.set(e.id, e);
  }
  for (const e of score.events) {
    if (e.tieFrom) {
      const from = events.get(e.tieFrom);
      if (
        !from ||
        from.midi === null ||
        from.midi !== e.midi ||
        from.voice !== e.voice ||
        Math.abs(from.beat + from.durationBeats - e.beat) > 0.001
      )
        throw new Error("延音线必须连接同声部相邻的同音");
    }
    if (
      e.slurFrom &&
      (!events.has(e.slurFrom) || events.get(e.slurFrom)!.beat >= e.beat)
    )
      throw new Error("连奏关系无效");
  }
  const chordIds = new Set<string>();
  for (const c of score.chords) {
    if (
      !c.id ||
      chordIds.has(c.id) ||
      !finite(c.beat) ||
      c.beat < 0 ||
      !finite(c.durationBeats) ||
      c.durationBeats <= 0 ||
      c.beat + c.durationBeats > score.durationBeats + 0.001 ||
      !Number.isInteger(c.root) ||
      c.root < 0 ||
      c.root > 11 ||
      !["major", "minor", "7", "maj7", "m7", "sus4"].includes(c.quality) ||
      !["manual", "imported", "estimated"].includes(c.origin)
    )
      throw new Error("和弦事件无效");
    chordIds.add(c.id);
  }
  const ordered = [...score.chords].sort((a, b) => a.beat - b.beat);
  if (
    ordered.some(
      (c, i) =>
        i > 0 &&
        ordered[i - 1].beat + ordered[i - 1].durationBeats > c.beat + 0.001,
    )
  )
    throw new Error("和弦区间重叠，请先明确换和弦位置");
  const sectionIds = new Set<string>();
  for (const s of score.sections) {
    if (
      !s.id ||
      sectionIds.has(s.id) ||
      typeof s.label !== "string" ||
      !finite(s.beat) ||
      s.beat < 0 ||
      !finite(s.endBeat) ||
      s.endBeat <= s.beat ||
      s.endBeat > score.durationBeats + 0.001 ||
      !["manual", "imported"].includes(s.origin)
    )
      throw new Error("乐段区间无效");
    sectionIds.add(s.id);
  }
}

/** Ties are one sounding event. Repeated notes and slurs retain distinct events. */
export function soundingEvents(score: MusicalScore): NoteEvent[] {
  validateScore(score);
  const byId = new Map<string, NoteEvent>(),
    rootIds = new Map<string, string>();
  for (const e of [...score.events].sort((a, b) => a.beat - b.beat)) {
    if (e.midi === null) continue;
    if (e.tieFrom) {
      const rootId = rootIds.get(e.tieFrom)!,
        root = byId.get(rootId)!;
      root.duration =
        beatToSeconds(score, e.beat + e.durationBeats) - root.start;
      rootIds.set(e.id, rootId);
    } else {
      rootIds.set(e.id, e.id);
      byId.set(e.id, {
        id: e.id,
        start: beatToSeconds(score, e.beat),
        duration:
          beatToSeconds(score, e.beat + e.durationBeats) -
          beatToSeconds(score, e.beat),
        pitch: { midi: e.midi },
        velocity: e.velocity,
        score: e.activation ?? (e.origin === "detected" ? 0 : 1),
        source: e.origin === "imported" ? "manual" : (e.origin ?? "manual"),
        role: eventRole(e),
      });
    }
  }
  return [...byId.values()];
}

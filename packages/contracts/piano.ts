import type { NoteEvent } from "./index";
import {
  validateScore,
  type MusicalScore,
  type PerformancePlan,
} from "./score";

export type PianoHand = "left" | "right" | "unassigned";
export interface PianoAction {
  id: string;
  beat: number;
  durationBeats: number;
  midi: number;
  hand: PianoHand;
  finger: number;
  velocity: number;
  kind: "key";
}
export interface PianoArrangement {
  version: 1;
  score: MusicalScore;
  performance: PerformancePlan<PianoAction>;
  notes: NoteEvent[];
}
export function validatePianoArrangement(
  p: PianoArrangement,
  duration: number,
) {
  if (
    p.version !== 1 ||
    p.performance?.instrumentId !== "piano" ||
    p.performance.version !== 2 ||
    !Array.isArray(p.performance.actions) ||
    !Array.isArray(p.performance.issues) ||
    !Array.isArray(p.notes) ||
    p.performance.actions.length !== p.notes.length
  )
    throw new Error("钢琴编配格式无效");
  validateScore(p.score);
  const notes = new Map(p.notes.map((n) => [n.id, n]));
  const ids = new Set<string>();
  for (const a of p.performance.actions) {
    const n = notes.get(a.id);
    if (
      !n ||
      ids.has(a.id) ||
      !["left", "right", "unassigned"].includes(a.hand) ||
      a.kind !== "key" ||
      !Number.isFinite(a.beat) ||
      !Number.isFinite(a.durationBeats) ||
      a.durationBeats <= 0 ||
      a.midi !== n.pitch.midi ||
      n.start + n.duration > duration + 0.011 ||
      !Number.isInteger(a.finger) ||
      a.finger < 0 ||
      a.finger > 5 ||
      !Number.isFinite(a.velocity) ||
      a.velocity < 0 ||
      a.velocity > 1
    )
      throw new Error("钢琴演奏动作无效");
    ids.add(a.id);
  }
}

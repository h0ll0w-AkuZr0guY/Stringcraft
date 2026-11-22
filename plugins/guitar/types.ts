import type { ArrangeOptions, PerformancePlan } from "../../packages/contracts";
import type { Voicing } from "./voicings";
import type { FretPreferences } from "./fingering";

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
  preferences?: FretPreferences;
}
export const limits = {
  easy: { fret: 5, span: 3, minBeats: 1, shiftPerBeat: 2, barre: false },
  normal: { fret: 9, span: 4, minBeats: 0.5, shiftPerBeat: 3, barre: true },
  hard: { fret: 14, span: 4, minBeats: 0.25, shiftPerBeat: 4, barre: true },
  expert: { fret: 20, span: 4, minBeats: 0.25, shiftPerBeat: 5, barre: true },
};

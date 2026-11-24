/** A training chart describes actual attacks, independent of input keys or rendering. */
export type PracticeInstrument = "piano" | "guitar";
export type PracticeMode = "free" | "rhythm" | "wait";
export interface PracticeAttack {
  id: string;
  at: number;
  duration: number;
  measure: number;
  token: string;
  pitches: number[];
  label: string;
}
export interface PracticeChord {
  id: string;
  name: string;
  frets: number[];
  pitches: (number | null)[];
  firstBeat: number;
}
export interface PracticeChart {
  title: string;
  instrument: PracticeInstrument;
  duration: number;
  bpm: number;
  attacks: PracticeAttack[];
  chords: PracticeChord[];
}
export interface PracticeFeedback {
  eventId?: string;
  measure?: number;
  label: string;
  verdict: "perfect" | "good" | "hit" | "wrong" | "missed" | "early" | "late";
  differenceMs?: number;
}
export interface PracticeReport {
  hits: number;
  misses: number;
  wrong: number;
  accuracy?: number;
  score?: number;
  firstTry?: number;
  retries?: number;
  meanOffsetMs?: number;
  history: PracticeFeedback[];
}
export interface PracticeSession {
  begin(start: number, end: number): void;
  press(token: string, position: number, speed: number): void;
  tick(position: number, speed: number): void;
  next(): PracticeAttack | undefined;
  report(): PracticeReport;
}
export interface PracticePlugin {
  sdk: 1;
  modes: readonly PracticeMode[];
  create(
    chart: PracticeChart,
    mode: PracticeMode,
    offsetMs: number,
  ): PracticeSession;
}

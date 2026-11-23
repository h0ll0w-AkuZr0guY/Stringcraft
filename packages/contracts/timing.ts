/** Timing proposals remain evidence, separate from the user's confirmed score grid. */
export interface TimingCandidate {
  bpm: number;
  /** Pulse phase within one beat, relative to the analyzed clip. Not a downbeat label. */
  phaseSeconds: number;
  /** Relative waveform periodicity; not a correctness probability. */
  score: number;
}
export interface TimingAnalysis {
  method: string;
  durationSeconds: number;
  status: "unconfirmed";
  candidates: TimingCandidate[];
  proposal?: { bpm: number; source: "waveform" | "note-supported" };
  warnings: string[];
}
export function validateTiming(value: TimingAnalysis) {
  if (
    !value ||
    typeof value.method !== "string" ||
    value.status !== "unconfirmed" ||
    !Number.isFinite(value.durationSeconds) ||
    value.durationSeconds < 0 ||
    value.durationSeconds > 60.01 ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > 8 ||
    !Array.isArray(value.warnings) ||
    value.warnings.some((w) => typeof w !== "string")
  )
    throw new Error("拍点候选无效");
  for (const c of value.candidates)
    if (
      !Number.isFinite(c.bpm) ||
      c.bpm < 40 ||
      c.bpm > 240 ||
      !Number.isFinite(c.phaseSeconds) ||
      c.phaseSeconds < 0 ||
      c.phaseSeconds >= 60 / c.bpm + 0.001 ||
      !Number.isFinite(c.score) ||
      c.score < 0 ||
      c.score > 1
    )
      throw new Error("拍点候选参数无效");
  if (
    value.proposal &&
    (!Number.isFinite(value.proposal.bpm) ||
      value.proposal.bpm < 40 ||
      value.proposal.bpm > 240 ||
      !["waveform", "note-supported"].includes(value.proposal.source))
  )
    throw new Error("参考速度提议无效");
}

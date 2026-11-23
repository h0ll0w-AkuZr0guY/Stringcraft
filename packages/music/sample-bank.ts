import type { GuitarNote, NoteEvent } from "../contracts";
export interface GuitarSample {
  instrument: string;
  string: number;
  midi: number;
  local_file: string;
  layer?: number;
  technique?: "pick" | "finger";
}
/** Select the actual string first, then pitch and articulation, then dynamic layers. */
export function sampleChoices(
  bank: GuitarSample[],
  note: NoteEvent | GuitarNote,
  tone: string,
): { sample: GuitarSample; gain: number }[] {
  const guitar = note as GuitarNote;
  let choices = bank.filter(
    (s) =>
      s.instrument === tone &&
      (!guitar.string || s.string === guitar.string) &&
      Math.abs(s.midi - note.pitch.midi) <= 2,
  );
  if (!choices.length) return [];
  if (tone === "nylon" && choices.some((s) => s.technique)) {
    const technique = guitar.attack === "strum" ? "pick" : "finger";
    const matching = choices.filter((s) => s.technique === technique);
    if (matching.length) choices = matching;
  }
  const distance = Math.min(
    ...choices.map((s) => Math.abs(s.midi - note.pitch.midi)),
  );
  choices = choices.filter(
    (s) => Math.abs(s.midi - note.pitch.midi) === distance,
  );
  const midi = choices.sort((a, b) => a.midi - b.midi)[0].midi;
  choices = choices
    .filter((s) => s.midi === midi)
    .sort((a, b) => (a.layer ?? 1) - (b.layer ?? 1));
  if (choices.length === 1) return [{ sample: choices[0], gain: 1 }];
  const desired =
    1 + Math.max(0, Math.min(1, (note.velocity - 0.25) / 0.6)) * 2;
  const low = choices.findLast((s) => (s.layer ?? 1) <= desired) ?? choices[0];
  const high =
    choices.find((s) => (s.layer ?? 1) >= desired) ?? choices.at(-1)!;
  if (low === high) return [{ sample: low, gain: 1 }];
  const weight =
    (desired - (low.layer ?? 1)) / ((high.layer ?? 1) - (low.layer ?? 1));
  return [
    { sample: low, gain: Math.sqrt(1 - weight) },
    { sample: high, gain: Math.sqrt(weight) },
  ].filter((s) => s.gain > 0.01);
}

import {
  validateScore,
  type MusicalScore,
  type ChordSymbol,
} from "../contracts";
export interface MusicalMeasure {
  index: number;
  beat: number;
  endBeat: number;
  numerator: number;
  denominator: number;
  pickup: boolean;
}
export function measureGrid(score: MusicalScore): MusicalMeasure[] {
  const result: MusicalMeasure[] = [];
  let beat = 0;
  while (beat < score.durationBeats - 0.001) {
    const meter = score.meter.findLast((m) => m.beat <= beat) ?? score.meter[0];
    const length =
      !result.length && score.pickupBeats
        ? score.pickupBeats
        : (meter.numerator * 4) / meter.denominator;
    const endBeat = Math.min(
      beat + length,
      score.durationBeats,
      score.meter.find((m) => m.beat > beat)?.beat ?? Infinity,
    );
    result.push({
      index: result.length,
      beat,
      endBeat,
      numerator: meter.numerator,
      denominator: meter.denominator,
      pickup: !result.length && !!score.pickupBeats,
    });
    beat = endBeat;
  }
  return result;
}
/** Insert/change harmony without overlapping the neighbouring chord interval. */
export function setChord(
  score: MusicalScore,
  beat: number,
  changes: Partial<ChordSymbol> | null,
): MusicalScore {
  const next = structuredClone(score),
    old = next.chords.find((c) => Math.abs(c.beat - beat) < 0.001);
  next.chords = next.chords.filter((c) => c !== old);
  const previous = next.chords
    .filter((c) => c.beat < beat)
    .sort((a, b) => b.beat - a.beat)[0];
  const following = next.chords
    .filter((c) => c.beat > beat)
    .sort((a, b) => a.beat - b.beat)[0];
  if (changes) {
    const bar = measureGrid(score).find(
      (m) => m.beat <= beat && m.endBeat > beat,
    );
    if (!bar) throw new Error("换和弦位置超出片段");
    if (previous && previous.beat + previous.durationBeats > beat)
      previous.durationBeats = beat - previous.beat;
    const end = Math.min(
      following?.beat ?? Infinity,
      old ? old.beat + old.durationBeats : bar.endBeat,
    );
    next.chords.push({
      id: old?.id ?? `manual-chord-${beat}`,
      beat,
      durationBeats: end - beat,
      root: old?.root ?? 0,
      quality: old?.quality ?? "major",
      ...changes,
      origin: "manual",
    });
  }
  next.chords.sort((a, b) => a.beat - b.beat);
  validateScore(next);
  return next;
}
export function setSection(
  score: MusicalScore,
  id: string,
  section: {
    beat: number;
    endBeat: number;
    label: string;
    energy?: "gentle" | "steady" | "emphatic";
  } | null,
): MusicalScore {
  const next = structuredClone(score);
  next.sections = next.sections.filter((s) => s.id !== id);
  if (section) next.sections.push({ ...section, id, origin: "manual" });
  next.sections.sort((a, b) => a.beat - b.beat);
  validateScore(next);
  return next;
}

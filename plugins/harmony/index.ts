import type { NoteEvent } from "../../packages/contracts";
import {
  secondsToBeat,
  type MusicalScore,
  type ChordSymbol,
} from "../../packages/contracts/score";

export const chordIntervals: Record<ChordSymbol["quality"], number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  "7": [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  sus4: [0, 5, 7],
};
/** Beat-window evidence, not a transcription oracle. Manual/imported harmony wins. */
export function analyzeHarmony(
  notes: NoteEvent[],
  score: MusicalScore,
): MusicalScore {
  const result = structuredClone(score);
  const chords: ChordSymbol[] = result.chords.filter(
    (c) => c.origin !== "estimated",
  );
  let previous: ChordSymbol | undefined;
  const meter = result.meter[0],
    barLength = (meter.numerator * 4) / meter.denominator;
  for (let beat = 0; beat < result.durationBeats; beat += barLength) {
    const end = Math.min(result.durationBeats, beat + barLength);
    if (chords.some((c) => c.beat < end && c.beat + c.durationBeats > beat))
      continue;
    const chroma = Array<number>(12).fill(0),
      bass = Array<number>(12).fill(0);
    for (const n of notes) {
      const start = secondsToBeat(score, n.start),
        stop = secondsToBeat(score, n.start + n.duration);
      const overlap = Math.max(0, Math.min(end, stop) - Math.max(beat, start));
      const weight = overlap * n.score * n.velocity;
      chroma[n.pitch.midi % 12] += weight;
      if (n.pitch.midi < 55) bass[n.pitch.midi % 12] += weight;
    }
    const total = chroma.reduce((a, b) => a + b, 0);
    // One melodic note is insufficient evidence for a chord.
    const present = chroma.filter((x) => x > total * 0.08).length;
    if (total < 0.08 || present < 3) {
      previous = undefined;
      continue;
    }
    const ranked = Array.from({ length: 12 }, (_, root) =>
      (["major", "minor", "7", "maj7", "m7", "sus4"] as const).map(
        (quality) => {
          const pcs = chordIntervals[quality].map((i) => (root + i) % 12);
          const covered = pcs.reduce((sum, pc) => sum + chroma[pc], 0) / total;
          const completeness =
            pcs.filter((pc) => chroma[pc] > total * 0.06).length / pcs.length;
          const lowTotal = bass.reduce((a, b) => a + b, 0);
          const bassMatch = lowTotal ? bass[root] / lowTotal : 0;
          const continuity =
            previous?.root === root && previous.quality === quality ? 0.035 : 0;
          return {
            root,
            quality,
            score:
              covered * 0.62 +
              completeness * 0.25 +
              bassMatch * 0.13 +
              continuity -
              (pcs.length - 3) * 0.035,
          };
        },
      ),
    )
      .flat()
      .sort((a, b) => b.score - a.score);
    const best = ranked[0],
      margin = best.score - ranked[1].score;
    if (best.score < 0.7 || margin < 0.025) {
      previous = undefined;
      continue;
    }
    const chord: ChordSymbol = {
      id: `harmony-${beat}`,
      beat,
      durationBeats: end - beat,
      root: best.root,
      quality: best.quality,
      origin: "estimated",
      evidence: margin,
      alternatives: ranked.slice(0, 3),
    };
    chords.push(chord);
    previous = chord;
  }
  result.chords = chords.sort((a, b) => a.beat - b.beat);
  result.warnings = result.warnings.filter((w) => !w.startsWith("和弦估计"));
  if (chords.some((c) => c.origin === "estimated"))
    result.warnings.push(
      "和弦估计来自音高类别与低音证据，请逐小节试听确认；混音中的经过音会造成误判。",
    );
  return result;
}
export function tempoCandidates(
  notes: NoteEvent[],
): { bpm: number; score: number }[] {
  const starts = [
    ...new Set(
      notes
        .filter((n) => n.score > 0.35)
        .map((n) => Math.round(n.start * 50) / 50),
    ),
  ].sort((a, b) => a - b);
  const deltas = starts
    .slice(1)
    .map((t, i) => t - starts[i])
    .filter((d) => d > 0.12 && d < 2);
  if (deltas.length < 3) return [];
  const ranked = Array.from({ length: 161 }, (_, i) => i + 60)
    .map((bpm) => {
      const unit = 60 / bpm;
      const score =
        deltas.reduce(
          (s, d) =>
            s +
            Math.exp(
              -Math.pow(
                ((d / unit) * 2 - Math.round((d / unit) * 2)) / 0.16,
                2,
              ),
            ),
          0,
        ) / deltas.length;
      return { bpm, score };
    })
    .sort((a, b) => b.score - a.score);
  const kept: typeof ranked = [];
  for (const candidate of ranked)
    if (kept.every((c) => Math.abs(c.bpm - candidate.bpm) > 8))
      kept.push(candidate);
  return kept.slice(0, 5);
}
export default { analyzeHarmony, tempoCandidates };

import {
  beatToSeconds,
  secondsToBeat,
  type HarmonyAnalysis,
  type MusicalScore,
} from "../contracts";
/** The timeline is authoritative in seconds. The score is only a notation projection. */
export function projectHarmony(
  analysis: HarmonyAnalysis,
  input: MusicalScore,
): MusicalScore {
  const score = structuredClone(input);
  const manual = score.chords.filter((c) => c.origin !== "estimated");
  score.chords = [...manual];
  const protectedTimes = manual.map((c) => [
    beatToSeconds(score, c.beat),
    beatToSeconds(score, c.beat + c.durationBeats),
  ]);
  for (const s of analysis.segments) {
    if (s.root === null || !s.quality) continue;
    let pieces = [[s.start, s.end]];
    for (const [a, b] of protectedTimes)
      pieces = pieces.flatMap(([lo, hi]) =>
        b <= lo || a >= hi
          ? [[lo, hi]]
          : [
              [lo, Math.min(hi, a)],
              [Math.max(lo, b), hi],
            ].filter(([x, y]) => y - x > 0.001),
      );
    for (const [start, end] of pieces) {
      const beat = Math.max(0, secondsToBeat(score, start)),
        stop = Math.min(score.durationBeats, secondsToBeat(score, end));
      if (stop <= beat) continue;
      score.chords.push({
        id: `${s.id}-${start.toFixed(3)}`,
        analysisId: s.id,
        verification: s.status === "supported" ? "supported" : "candidate",
        beat,
        durationBeats: stop - beat,
        root: s.root,
        quality: s.quality,
        origin: "estimated",
        evidence: s.evidence,
        alternatives: s.alternatives,
      });
    }
  }
  score.chords.sort((a, b) => a.beat - b.beat);
  return score;
}

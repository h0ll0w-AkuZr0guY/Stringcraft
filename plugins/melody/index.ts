import type { NoteEvent, MusicPlugin } from "../../packages/contracts";
/** Viterbi-like voice tracking. Scores are model activations, not probabilities. */
export function extractMelody(input: NoteEvent[]): NoteEvent[] {
  const scores = input
    .map((n) => n.score)
    .filter((s) => Number.isFinite(s))
    .sort((a, b) => a - b);
  // Relative activation suppresses weak accompaniment reattacks; the floor is
  // bounded so quiet, uniformly scored melodies remain eligible.
  const floor = Math.max(
    0.12,
    Math.min(0.55, (scores[Math.floor(scores.length * 0.75)] ?? 0) * 0.68),
  );
  const sorted = input
    .filter((n) => n.score >= floor)
    .sort((a, b) => a.start - b.start);
  const groups: NoteEvent[][] = [];
  for (const n of sorted) {
    if (!groups.length || n.start - groups.at(-1)![0].start > 0.055)
      groups.push([]);
    groups.at(-1)!.push(n);
  }
  type Path = { note: NoteEvent; previous: Path | null };
  type State = { cost: number; last: NoteEvent | null; path: Path | null };
  let states: State[] = [{ cost: 0, last: null, path: null }];
  for (const group of groups) {
    const candidates = group.sort((a, b) => b.score - a.score).slice(0, 6);
    const next: State[] = [];
    for (const n of candidates)
      for (const s of states) {
        const gap = s.last ? n.start - (s.last.start + s.last.duration) : 0;
        const leap = s.last ? Math.abs(n.pitch.midi - s.last.pitch.midi) : 0;
        const continuity =
          gap < 0.8 ? 0.045 * leap + (leap > 12 ? 0.65 : 0) : 0.012 * leap;
        const overlap = s.last
          ? Math.max(0, s.last.start + s.last.duration - n.start)
          : 0;
        // Lower accompaniment notes are less likely melody, but never rejected by range alone.
        const reward =
          1.1 * n.score +
          0.15 * Math.min(n.duration, 1) +
          0.1 * Math.min(1, (n.pitch.midi - 40) / 36);
        next.push({
          cost: s.cost + reward - continuity - Math.min(0.3, overlap * 0.2),
          last: n,
          path: { note: n, previous: s.path },
        });
      }
    next.sort((a, b) => b.cost - a.cost);
    // Retain different end pitches, avoiding a beam filled by identical endings.
    const seen = new Set<number>();
    states = next
      .filter((s) => {
        const p = s.last!.pitch.midi;
        if (seen.has(p)) return false;
        seen.add(p);
        return true;
      })
      .slice(0, 6);
  }
  const path: NoteEvent[] = [];
  let node = states[0]?.path;
  while (node) {
    path.push(node.note);
    node = node.previous;
  }
  path.reverse();
  return path.map((n, i, all) => ({
    ...n,
    role: "melody",
    duration: Math.max(
      0.03,
      Math.min(n.duration, (all[i + 1]?.start ?? Infinity) - n.start),
    ),
  }));
}
export default { extractMelody } satisfies MusicPlugin;

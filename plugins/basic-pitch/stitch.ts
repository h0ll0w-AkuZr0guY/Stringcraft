import type { NoteEvent } from "../../packages/contracts";
export interface ChunkNote extends NoteEvent {
  continues: boolean;
}
/** Overlap supplies context; ownership follows onsets, never a clipped chunk edge. */
export function stitch(
  previous: NoteEvent[],
  next: ChunkNote[],
  from: number,
  to: number,
  total: number,
): NoteEvent[] {
  const result = previous.map((n) => ({ ...n }));
  let serial = previous.length;
  for (const incoming of [...next].sort((a, b) => a.start - b.start)) {
    if (incoming.start >= to) continue;
    const end = Math.min(total, incoming.start + incoming.duration),
      same = result.filter((n) => n.pitch.midi === incoming.pitch.midi);
    const duplicate = same.findLast(
      (n) =>
        Math.abs(n.start - incoming.start) <= 0.06 && n.start < from + 0.03,
    );
    const continuing = incoming.continues
      ? same.findLast(
          (n) => n.start < from && n.start + n.duration >= from - 0.08,
        )
      : undefined;
    const prior = duplicate ?? continuing;
    if (prior) {
      prior.duration =
        Math.max(prior.start + prior.duration, end) - prior.start;
      continue;
    }
    if (incoming.start < from - 0.03) continue;
    const start = Math.max(from, incoming.start);
    if (end - start < 0.03) continue;
    // A genuine new onset remains a new ID, even when its predecessor still rings.
    for (const old of same)
      if (old.start < start - 0.04 && old.start + old.duration > start)
        old.duration = start - old.start;
    const { continues, ...note } = incoming;
    result.push({
      ...note,
      id: `bp-stream-${serial++}`,
      start,
      duration: end - start,
    });
  }
  return result.sort(
    (a, b) => a.start - b.start || a.pitch.midi - b.pitch.midi,
  );
}

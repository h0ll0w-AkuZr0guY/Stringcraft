import type { GuitarNote, NoteEvent } from "../contracts";
export interface AudioGesture {
  note: NoteEvent;
  end: number;
  changes: { time: number; midi: number; kind: string }[];
  resumed: boolean;
}
/** One excitation per pluck/strum; linked left-hand actions change the same string's pitch. */
export function audioGestures(
  notes: NoteEvent[],
  from = 0,
  to = Infinity,
): AudioGesture[] {
  const gestures: AudioGesture[] = [],
    roots = new Map<string, AudioGesture>(),
    byId = new Map(notes.map((n) => [n.id, n]));
  for (const n of [...notes].sort((a, b) => a.start - b.start)) {
    const g = n as GuitarNote,
      previous = g.linkFrom
        ? (byId.get(g.linkFrom) as GuitarNote | undefined)
        : undefined;
    const root = g.linkFrom ? roots.get(g.linkFrom) : undefined;
    const linked =
      root &&
      previous &&
      ["hammer", "pull", "slide"].includes(g.attack ?? "") &&
      g.string === previous.string &&
      Math.abs(previous.start + previous.duration - g.start) < 0.003;
    if (linked) {
      root.end = n.start + n.duration;
      root.changes.push({ time: n.start, midi: n.pitch.midi, kind: g.attack! });
      roots.set(n.id, root);
    } else {
      const gesture = {
        note: { ...n, pitch: { ...n.pitch } },
        end: n.start + n.duration,
        changes: [],
        resumed: false,
      };
      gestures.push(gesture);
      roots.set(n.id, gesture);
    }
  }
  return gestures
    .filter((g) => g.note.start < to && g.end > from)
    .map((g) => {
      const before = g.changes.filter((c) => c.time <= from).at(-1);
      return {
        ...g,
        note: {
          ...g.note,
          start: Math.max(from, g.note.start),
          pitch: { midi: before?.midi ?? g.note.pitch.midi },
          duration: Math.min(g.end, to) - Math.max(from, g.note.start),
        },
        end: Math.min(g.end, to),
        changes: g.changes.filter((c) => c.time > from && c.time < to),
        resumed: g.note.start < from,
      };
    });
}

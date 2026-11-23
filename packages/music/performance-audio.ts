import type { GuitarNote, NoteEvent } from "../contracts";
export interface AudioGesture {
  note: NoteEvent;
  end: number;
  changes: { time: number; midi: number; kind: string }[];
  resumed: boolean;
  sampleOffset?: number;
  softAttack?: boolean;
  glideFrom?: number;
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
        sampleOffset:
          Math.max(0, from - (before?.time ?? g.note.start)) +
          (before?.kind ? 0.04 : 0),
      };
    });
}

/** Hammer/pull targets use a soft sustain transition; only slides glide continuously. */
export function articulationSegments(
  notes: NoteEvent[],
  from = 0,
  to = Infinity,
): AudioGesture[] {
  return audioGestures(notes, from, to).flatMap((g) => {
    const points = [
      { time: g.note.start, midi: g.note.pitch.midi, kind: "initial" },
      ...g.changes,
    ];
    return points.map((point, i) => ({
      ...g,
      note: {
        ...g.note,
        start: point.time,
        duration: (points[i + 1]?.time ?? g.end) - point.time,
        pitch: { midi: point.midi },
      },
      end: points[i + 1]?.time ?? g.end,
      changes: [],
      resumed: g.resumed || i > 0,
      softAttack: g.resumed || i > 0,
      sampleOffset: i > 0 ? 0.04 : (g.sampleOffset ?? 0),
      glideFrom: point.kind === "slide" ? points[i - 1].midi : undefined,
    }));
  });
}

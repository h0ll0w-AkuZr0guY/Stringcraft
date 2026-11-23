import {
  soundingEvents,
  beatToSeconds,
  type MusicalScore,
  type GuitarNote,
} from "../../packages/contracts";
import { tuning } from "./voicings";
import { soundingOriginId } from "./written-voices";
/** Materialize an authored TAB reference, retaining notation and sounding releases separately. */
export function referenceSoundEvents(score: MusicalScore): GuitarNote[] {
  const events = new Map(score.events.map((e) => [e.id, e]));
  const notes: GuitarNote[] = soundingEvents(score).map((n) => {
    const e = events.get(n.id)!,
      g = e.extensions?.guitar,
      string = g?.string,
      fret = g?.fret;
    if (
      typeof string !== "number" ||
      typeof fret !== "number" ||
      string < 1 ||
      string > 6 ||
      tuning[string - 1] + fret !== n.pitch.midi
    )
      throw new Error(`参考事件 ${n.id} 缺少经过核对的弦品`);
    return { ...n, string, fret, attack: "pluck" };
  });
  for (const note of notes) {
    const slur = events.get(note.id)?.slurFrom;
    if (slur) {
      const from = notes.find((n) => n.id === soundingOriginId(events, slur));
      if (
        from &&
        from.string === note.string &&
        from.fret !== note.fret &&
        Math.abs(from.start + from.duration - note.start) < 0.002
      ) {
        note.attack = note.fret > from.fret ? "hammer" : "pull";
        note.linkFrom = from.id;
      }
    }
  }
  for (const e of score.events.filter((e) => e.unpitched)) {
    const string = e.extensions?.guitar?.string;
    if (typeof string !== "number" || string < 1 || string > 6)
      throw new Error(`闷音 ${e.id} 缺少弦号`);
    const start = beatToSeconds(score, e.beat);
    notes.push({
      id: e.id,
      start,
      duration:
        beatToSeconds(score, e.beat + Math.min(0.125, e.durationBeats)) - start,
      pitch: { midi: tuning[string - 1] },
      velocity: e.velocity,
      score: 1,
      source: "manual",
      role: "bass",
      string,
      fret: 0,
      attack: "dead",
      dead: true,
    });
  }
  for (const note of notes) {
    const next = notes
      .filter(
        (n) => n.string === note.string && n.start > note.start + 0.000001,
      )
      .sort((a, b) => a.start - b.start)[0];
    if (next) note.duration = Math.min(note.duration, next.start - note.start);
  }
  return notes;
}

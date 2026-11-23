import { Midi } from "@tonejs/midi";
import { validateNotes, type MusicProject, type NoteEvent } from "../contracts";
import { soundingEvents, beatToSeconds } from "../contracts/score";
function project(
  name: string,
  notes: NoteEvent[],
  bpm: number,
  kind: "midi" | "musicxml",
): MusicProject {
  validateNotes(notes);
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    duration: Math.max(1, ...notes.map((n) => n.start + n.duration)),
    bpm: Math.max(20, Math.min(300, bpm)),
    beatOffset: 0,
    sourceOffset: 0,
    notes,
    melody: [],
    arrangement: null,
    pluginVersions: {},
    sourceKind: kind,
  };
}
export async function importMidi(file: File) {
  const midi = new Midi(await file.arrayBuffer());
  const notes: NoteEvent[] = midi.tracks.flatMap((t, ti) =>
    t.notes.map((n, i) => ({
      id: `midi-${ti}-${i}`,
      start: n.time,
      duration: n.duration,
      pitch: { midi: n.midi },
      velocity: n.velocity,
      score: 1,
      source: "manual",
    })),
  );
  return project(
    file.name.replace(/\.[^.]+$/, ""),
    notes,
    midi.header.tempos[0]?.bpm ?? 120,
    "midi",
  );
}
/** MusicXML preserves musical identities before any instrument arrangement is requested. */
export async function importMusicXML(file: File) {
  const { readMusicXML } = await import("./musicxml");
  const score = readMusicXML(await file.text()),
    notes = soundingEvents(score);
  const p = project(
    file.name.replace(/\.[^.]+$/, ""),
    notes,
    score.tempo[0].bpm,
    "musicxml",
  );
  p.schemaVersion = 2;
  p.score = score;
  p.duration = beatToSeconds(score, score.durationBeats);
  p.melody = notes.filter((n) => n.role === "melody");
  return p;
}

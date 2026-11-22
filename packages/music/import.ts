import { Midi } from "@tonejs/midi";
import { validateNotes, type MusicProject, type NoteEvent } from "../contracts";
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
/** Deliberately bounded partwise MusicXML importer: pitched notes, rests, chords, tempo. */
export async function importMusicXML(file: File) {
  const doc = new DOMParser().parseFromString(await file.text(), "text/xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.tagName !== "score-partwise"
  )
    throw new Error("仅支持未压缩的 score-partwise MusicXML；MXL 请先解压");
  const bpm = Number(
      doc.querySelector("sound[tempo]")?.getAttribute("tempo") ?? 120,
    ),
    notes: NoteEvent[] = [];
  let index = 0;
  for (const part of doc.querySelectorAll("score-partwise > part")) {
    let cursor = 0,
      divisions = 1,
      previous = 0;
    for (const measure of part.querySelectorAll(":scope > measure"))
      for (const child of measure.children) {
        if (child.tagName === "attributes") {
          divisions = Number(
            child.querySelector("divisions")?.textContent ?? divisions,
          );
          continue;
        }
        const beats =
          Number(child.querySelector("duration")?.textContent ?? 0) / divisions;
        if (child.tagName === "backup") {
          cursor -= beats;
          continue;
        }
        if (child.tagName === "forward") {
          cursor += beats;
          continue;
        }
        if (child.tagName !== "note" || child.querySelector("grace")) continue;
        const chord = !!child.querySelector("chord"),
          start = chord ? previous : cursor;
        const pitch = child.querySelector("pitch");
        if (pitch) {
          const step = pitch.querySelector("step")?.textContent ?? "C",
            oct = Number(pitch.querySelector("octave")?.textContent ?? 4),
            alter = Number(pitch.querySelector("alter")?.textContent ?? 0);
          notes.push({
            id: `xml-${index++}`,
            start: (Math.max(0, start) * 60) / bpm,
            duration: Math.max(0.01, (beats * 60) / bpm),
            pitch: {
              midi:
                (oct + 1) * 12 +
                ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step] ?? 0) +
                alter,
            },
            velocity: 0.7,
            score: 1,
            source: "manual",
          });
        }
        if (!chord) {
          previous = cursor;
          cursor += beats;
        }
      }
  }
  return project(file.name.replace(/\.[^.]+$/, ""), notes, bpm, "musicxml");
}

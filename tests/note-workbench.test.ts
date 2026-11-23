import { it, expect } from "vitest";
import { Midi } from "@tonejs/midi";
import { demoProject } from "../packages/music/demo";
import {
  commitNotes,
  correctedNotes,
  filteredNotes,
} from "../packages/music/note-edits";
import {
  validateProject,
  type MusicProject,
  type NoteEvent,
} from "../packages/contracts";
import { stitch } from "../plugins/basic-pitch/stitch";
import { exportNotes } from "../plugins/note-exporters";
import roll from "../plugins/piano-roll";
const n = (id: string, start = 0, duration = 0.4, midi = 64): NoteEvent => ({
  id,
  start,
  duration,
  pitch: { midi },
  velocity: 0.7,
  score: 0.8,
  source: "detected",
});
const project = (): MusicProject => ({
  ...demoProject(),
  notes: [n("a")],
  melody: [],
});
it("keeps corrections separate from progressive raw results and undo reveals the latest raw", () => {
  const original = project();
  let p = commitNotes(original, [{ id: "a", note: null }]);
  p.notes = [n("a", 0, 2), n("b", 2)];
  expect(correctedNotes(p).map((n) => n.id)).toEqual(["b"]);
  p.noteEditor!.cursor--;
  expect(correctedNotes(p)[0].duration).toBe(2);
  p = commitNotes(p, [{ id: "a", note: n("a", 0, 1, 67) }]);
  p.notes = [n("a", 0, 3)];
  expect(correctedNotes(p)[0].pitch.midi).toBe(67);
  expect(original.notes[0].duration).toBe(0.4);
  validateProject(p);
});
it("bounds undo history and keeps filtering nondestructive across serialization", () => {
  let p = project();
  for (let i = 0; i < 105; i++)
    p = commitNotes(p, [{ id: "a", note: n("a", i / 100) }]);
  expect(p.noteEditor!.commands).toHaveLength(100);
  expect(p.noteEditor!.base).toHaveLength(1);
  expect(correctedNotes(p)[0].start).toBe(1.04);
  p.noteEditor!.filter.strength = 0.9;
  expect(filteredNotes(p)).toHaveLength(0);
  expect(p.notes).toHaveLength(1);
  const restored = JSON.parse(JSON.stringify(p));
  validateProject(restored);
  expect(correctedNotes(restored)[0].start).toBe(1.04);
});
it("rejects invalid editor commands and corrupt imported history", () => {
  expect(() =>
    commitNotes(project(), [{ id: "a", note: n("a", 20) }]),
  ).toThrow();
  expect(() =>
    commitNotes(project(), [
      { id: "a", note: null },
      { id: "a", note: null },
    ]),
  ).toThrow();
  const p = commitNotes(project(), [{ id: "a", note: null }]);
  p.noteEditor!.cursor = 2;
  expect(() => validateProject(p)).toThrow();
});
it("stitches sustained boundaries without erasing a genuine same-pitch reattack", () => {
  const prior = [n("held", 1, 5.5)];
  const result = stitch(
    prior,
    [
      { ...n("continuation", 5.5, 3), continues: true },
      { ...n("attack", 7, 1), continues: false },
    ],
    6,
    12,
    16,
  );
  expect(result).toHaveLength(2);
  expect(result[0].id).toBe("held");
  expect(result[0].duration).toBe(6);
  expect(result[1].start).toBe(7);
  expect(prior[0].duration).toBe(5.5);
});
it("MIDI roundtrip preserves equal-pitch overlap on separate channels", () => {
  const notes = [n("a", 0.1, 2), n("b", 1, 2), n("c", 0.1, 0.5, 60)];
  const midi = new Midi(exportNotes(notes, 120));
  expect(new Set(midi.tracks.map((t) => t.channel)).size).toBe(2);
  const recovered = midi.tracks.flatMap((t) => t.notes);
  expect(recovered).toHaveLength(3);
  for (const note of notes)
    expect(
      recovered.some(
        (r) =>
          r.midi === note.pitch.midi &&
          Math.abs(r.time - note.start) < 0.002 &&
          Math.abs(r.duration - note.duration) < 0.002,
      ),
    ).toBe(true);
});
it("indexes ten thousand notes while retaining long notes crossing a viewport", () => {
  const notes = Array.from({ length: 10000 }, (_, i) =>
    n(String(i), i * 0.029, 0.1, 36 + (i % 60)),
  );
  notes.push(n("long", 0, 299, 64));
  const visible = roll.noteView.index(notes).query(200, 205, 60, 70);
  expect(visible.some((n) => n.id === "long")).toBe(true);
  expect(visible.length).toBeLessThan(100);
});

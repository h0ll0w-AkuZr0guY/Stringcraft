import { describe, it, expect } from "vitest";
import { arrange, positions, violations } from "../plugins/guitar";
import { extractMelody } from "../plugins/melody";
import { midi, tablature } from "../plugins/exporters";
import {
  validateNotes,
  validateProject,
  type NoteEvent,
  type Difficulty,
} from "../packages/contracts";
import { demoProject } from "../packages/music/demo";
const note = (
  id: string,
  midi: number,
  start = 0,
  duration = 0.4,
  score = 0.9,
): NoteEvent => ({
  id,
  start,
  duration,
  pitch: { midi },
  velocity: 0.7,
  score,
  source: "detected",
  role: "melody",
});
const options = {
  difficulty: "normal" as Difficulty,
  capo: 0,
  transpose: 0,
  bpm: 120,
};
describe("musical invariants", () => {
  for (const difficulty of ["easy", "normal", "hard", "expert"] as const)
    it(`${difficulty}: no impossible simultaneous fingerings`, () => {
      const p = demoProject(),
        a = arrange(p.notes, { ...options, difficulty });
      expect(a.notes.length).toBeGreaterThan(0);
      expect(violations(a.notes, { ...options, difficulty })).toEqual([]);
      for (const n of a.notes)
        expect(n.pitch.midi).toBe(
          [64, 59, 55, 50, 45, 40][n.string - 1] + n.fret,
        );
    });
  it("preserves a long sustain without repeated attacks", () => {
    const a = arrange([note("s", 64, 0, 3)], options);
    expect(a.notes).toHaveLength(1);
    expect(a.notes[0].duration).toBe(3);
  });
  it("preserves a distinct repeat attack and ends the prior same-string note", () => {
    const a = arrange([note("a", 64, 0, 2), note("b", 64, 1, 0.5)], {
      ...options,
      difficulty: "easy",
    });
    expect(a.notes).toHaveLength(2);
    expect(a.notes[0].duration).toBe(1);
  });
  it("honors explicit capo zero and transposition", () => {
    const a = arrange([note("a", 64)], { ...options, transpose: 2 });
    expect(a.capo).toBe(0);
    expect(a.notes[0].pitch.midi).toBe(66);
  });
  it("fret is relative to capo", () => {
    const a = arrange([note("a", 67)], { ...options, capo: 3 });
    for (const n of a.notes)
      expect(n.pitch.midi).toBe(
        [64, 59, 55, 50, 45, 40][n.string - 1] + 3 + n.fret,
      );
  });
  it("does not fabricate out-of-range melody pitches", () => {
    const a = arrange([note("a", 12)], options);
    expect(a.notes).toHaveLength(0);
    expect(a.dropped[0].reason).toContain("音域");
  });
  it("preserves an edited locked note when regenerating", () => {
    const n = { ...note("a", 64), string: 1, fret: 0, locked: true };
    const a = arrange([note("a", 67), note("b", 69, 1)], {
      ...options,
      previous: [n],
    });
    expect(a.notes.find((x) => x.id === "a")).toEqual(n);
  });
  it("reports incompatible locked edits", () => {
    const n = { ...note("a", 84), string: 1, fret: 20, locked: true };
    expect(() =>
      arrange([], { ...options, difficulty: "easy", previous: [n] }),
    ).toThrow("锁定");
  });
  it("does not allow overlapping locked strings", () => {
    const a = { ...note("a", 64), string: 1, fret: 0, locked: true },
      b = { ...note("b", 65, 0.1), string: 1, fret: 1, locked: true };
    expect(() => arrange([], { ...options, previous: [a, b] })).toThrow();
  });
  it("finds only physically valid positions", () => {
    for (let p = 0; p < 128; p++)
      for (const x of positions(p, 3, 14)) {
        expect(x.fret).toBeGreaterThanOrEqual(0);
        expect(x.fret).toBeLessThanOrEqual(14);
      }
  });
});
describe("voice tracking", () => {
  it("prefers a continuous melody over an isolated octave spike", () => {
    const input = [
      note("a", 64),
      note("b", 65, 0.6),
      note("noise", 88, 0.6, 0.05, 0.95),
      note("c", 67, 1.2),
    ];
    expect(extractMelody(input).map((n) => n.id)).toEqual(["a", "b", "c"]);
  });
  it("silence produces no invented melody", () =>
    expect(extractMelody([])).toEqual([]));
  it("clips overlapping source notes at the next actual attack", () => {
    const n = extractMelody([note("a", 64, 0, 2), note("b", 65, 0.8)]);
    expect(n[0].duration).toBe(0.8);
  });
});
describe("contracts and export", () => {
  it("rejects nonfinite values and duplicate identities", () => {
    expect(() => validateNotes([note("a", 64, NaN)])).toThrow();
    expect(() => validateNotes([note("a", 64), note("a", 65)])).toThrow();
  });
  it("round trips a project with locked manual edits", () => {
    const p = demoProject();
    p.arrangement = arrange(p.notes, options);
    p.arrangement.notes[0].locked = true;
    const restored = JSON.parse(JSON.stringify(p));
    expect(() => validateProject(restored)).not.toThrow();
    expect(restored.arrangement.notes[0].locked).toBe(true);
  });
  it("rejects corrupt guitar pitch positions", () => {
    const p = demoProject();
    p.arrangement = arrange(p.notes, options);
    p.arrangement.notes[0].fret = 99;
    expect(() => validateProject(p)).toThrow();
  });
  it("exports a standard MIDI header, tempo and actual note-off", () => {
    const p = demoProject();
    p.arrangement = arrange([note("a", 64, 0, 2)], options);
    const data = midi(p);
    expect(new TextDecoder().decode(data.slice(0, 4))).toBe("MThd");
    expect(Array.from(data)).toContain(128);
    expect(data.length).toBeGreaterThan(50);
  });
  it("TXT uses sustain marks instead of repeated frets", () => {
    const p = demoProject();
    p.arrangement = arrange([note("a", 64, 0, 3)], options);
    expect(tablature(p)).toContain("~");
  });
});

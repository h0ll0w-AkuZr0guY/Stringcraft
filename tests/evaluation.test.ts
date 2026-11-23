import { describe, it, expect } from "vitest";
import { compareNotes, compareHarmony } from "../packages/music/evaluation";
import { measureGrid, setChord, setSection } from "../packages/music/structure";
import { demoProject } from "../packages/music/demo";
import { fingeringPath } from "../plugins/guitar/fingering";
import {
  refineNotes,
  experimentalGuitarParameters,
} from "../plugins/note-refinement";
import { validateProject } from "../packages/contracts";
const note = (id: string, start: number) => ({
  id,
  start,
  duration: 1,
  pitch: { midi: 64 },
  velocity: 0.7,
  score: 1,
  source: "manual" as const,
});
describe("reference comparisons cannot reward density", () => {
  it("refinement only removes existing events and preserves locked weak notes", () => {
    const input = [
      { ...note("strong", 0), score: 0.9 },
      { ...note("strong2", 0.5), score: 0.8 },
      { ...note("weak", 1), score: 0.1 },
      { ...note("locked", 2), score: 0.1, locked: true },
    ];
    const before = JSON.stringify(input),
      result = refineNotes(input, experimentalGuitarParameters);
    expect(result.notes.map((n) => n.id)).toEqual([
      "strong",
      "strong2",
      "locked",
    ]);
    expect(result.dropped.map((n) => n.noteId)).toEqual(["weak"]);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("saved refinement cannot invent or retime a detected note", () => {
    const p = demoProject();
    p.refinement = {
      pluginId: "test",
      profile: "test",
      notes: [{ ...p.notes[0], start: 0.1 }],
      dropped: [],
    };
    expect(() => validateProject(p)).toThrow("不能更改");
  });
  it("each reference event matches at most one prediction", () => {
    const m = compareNotes([note("r", 0)], [note("a", 0), note("b", 0)]);
    expect(m.recall).toBe(1);
    expect(m.precision).toBe(0.5);
    expect(m.matched).toBe(1);
  });
  it("finds the maximum one-to-one alignment rather than greedily stealing the next onset", () => {
    const m = compareNotes(
      [note("r1", 0), note("r2", 0.07)],
      [note("p1", 0.03), note("p2", -0.03)],
      0.05,
    );
    expect(m.matched).toBe(2);
  });
  it("penalizes duration errors while keeping pitch/onset agreement separate", () => {
    const m = compareNotes(
      [note("r", 0)],
      [{ ...note("p", 0), duration: 0.1 }],
    );
    expect(m.f1).toBe(1);
    expect(m.durationMae).toBeCloseTo(0.9);
  });
  it("reports harmonic interval agreement instead of note count", () => {
    const c = {
      id: "c",
      beat: 0,
      durationBeats: 4,
      root: 0,
      quality: "major" as const,
      origin: "manual" as const,
    };
    expect(
      compareHarmony([c], [{ ...c, durationBeats: 2 }]).rootQualityAgreement,
    ).toBe(0.5);
    expect(() => compareHarmony([c], [c, { ...c, id: "duplicate" }])).toThrow(
      "重叠",
    );
  });
  it("a middle-of-bar chord insertion shortens its predecessor without overlap", () => {
    const s = demoProject().score!;
    const next = setChord(s, 2, { root: 7, quality: "major" });
    expect(next.chords[0].durationBeats).toBe(2);
    expect(next.chords.find((c) => c.beat === 2)?.durationBeats).toBe(2);
    expect(s.chords[0].durationBeats).toBe(4);
  });
  it("pickup and changing meters produce actual bar boundaries", () => {
    const s = demoProject().score!;
    s.pickupBeats = 1;
    s.meter.push({ beat: 5, numerator: 3, denominator: 4 });
    const bars = measureGrid(s);
    expect(bars.slice(0, 3).map((b) => [b.beat, b.endBeat])).toEqual([
      [0, 1],
      [1, 5],
      [5, 8],
    ]);
  });
  it("section copy cannot overwrite the new stable identity when splitting", () => {
    const s = demoProject().score!,
      old = s.sections[0];
    const shortened = setSection(s, old.id, { ...old, endBeat: 16 });
    const next = setSection(shortened, "new-section", { ...old, beat: 16 });
    expect(next.sections.map((s) => s.id)).toEqual([old.id, "new-section"]);
  });
  it("soft weights cannot create an out-of-tuning or out-of-fret position", () => {
    const path = fingeringPath(
      [64, 67, 69],
      { fret: -100, movement: -100, stringChange: -100, open: -100 },
      3,
      8,
    );
    expect(path).toHaveLength(3);
    for (const [i, p] of path.entries()) {
      expect([64, 59, 55, 50, 45, 40][p.string - 1] + 3 + p.fret).toBe(
        [64, 67, 69][i],
      );
      expect(p.fret).toBeLessThanOrEqual(8);
    }
  });
});

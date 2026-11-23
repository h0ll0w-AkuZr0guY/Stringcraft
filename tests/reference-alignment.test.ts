import { describe, it, expect } from "vitest";
import {
  fitReferenceGrid,
  type AlignmentSearch,
} from "../packages/music/reference-alignment";
const reference = Array.from({ length: 8 }, (_, i) => ({
  beat: i,
  midi: 60 + i,
}));
const recording = reference.map((e) => ({
  start: 1 + e.beat * 0.5,
  pitch: { midi: e.midi },
}));
const search: AlignmentSearch = {
  bpm: [100, 120, 20],
  offsetSeconds: [0, 1, 0.5],
  transpose: [0, 12],
  selectionBeats: [0, 4],
  checkBeats: [4, 8],
  onsetTolerance: 0.05,
  recordingBounds: [0, 6],
};
describe("reference-to-recording diagnostic", () => {
  it("selects on one phrase and reports a disjoint continuation without using it to rank", () => {
    const original = JSON.stringify({ reference, recording, search });
    const result = fitReferenceGrid(reference, recording, search);
    expect(JSON.stringify({ reference, recording, search })).toBe(original);
    expect(result.selected).toMatchObject({
      bpm: 120,
      offset: 1,
      transpose: 0,
      selection: { matched: 4 },
      check: { matched: 4 },
    });
    expect(result.status).toBe("unconfirmed");
    const broken = recording.filter((n) => n.start < 3);
    const second = fitReferenceGrid(reference, broken, search);
    expect(second.selected).toMatchObject({
      bpm: 120,
      offset: 1,
      transpose: 0,
      selection: { matched: 4 },
      check: { matched: 0 },
    });
    expect(second.diagnostics.checkOnsetsOnlyAt50ms.matched).toBe(0);
  });
  it("separates octave and onset diagnostics without changing the selected exact-pitch grid", () => {
    const shifted = recording.map((n, i) =>
      i < 4 ? n : { start: n.start + 0.08, pitch: { midi: n.pitch.midi + 12 } },
    );
    const result = fitReferenceGrid(reference, shifted, search);
    expect(result.selected.check.matched).toBe(0);
    expect(result.selected.transpose).toBe(0);
    expect(result.diagnostics.checkAt100ms.matched).toBe(0);
    expect(result.diagnostics.checkPitchClassAt100ms.matched).toBe(4);
  });
  it("cannot inflate coverage through duplicate reference attacks or compare outside the recording", () => {
    const repeated = reference.map((e) => ({ ...e, beat: 0, midi: 60 }));
    repeated.splice(4, 4, ...reference.slice(4));
    const result = fitReferenceGrid(repeated, recording, search);
    expect(result.selected.selection.matched).toBe(1);
    expect(() =>
      fitReferenceGrid(reference, recording, {
        ...search,
        recordingBounds: [0, 2],
      }),
    ).toThrow("does not cover");
  });
  it("rejects overlapping checks, unbounded searches and invalid numeric values", () => {
    expect(() =>
      fitReferenceGrid(reference, recording, { ...search, checkBeats: [3, 8] }),
    ).toThrow("overlap");
    expect(() =>
      fitReferenceGrid(reference, recording, {
        ...search,
        bpm: [20, 400, 0.0001],
      }),
    ).toThrow("too large");
    expect(() =>
      fitReferenceGrid(reference, recording, {
        ...search,
        onsetTolerance: NaN,
      }),
    ).toThrow("parameters");
  });
});

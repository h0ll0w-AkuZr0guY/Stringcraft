import { expect, it } from "vitest";
import { validateProject } from "../packages/contracts";
import { demoProject } from "../packages/music/demo";
import {
  arrangementTracks,
  commitTrackNotes,
  editorTrackProject,
} from "../packages/music/tracks";
import { planArrangement } from "../plugins/arrangement-planner";
import { assessMusic } from "../plugins/music-constraints";

it("track corrections preserve original notes and the other track history", () => {
  const p = demoProject();
  p.tracks = [
    {
      id: "vocal",
      role: "vocal",
      name: "人声",
      notes: [{ ...p.notes[0], id: "v" }],
    },
    {
      id: "instrumental",
      role: "instrumental",
      name: "伴奏",
      notes: [{ ...p.notes[1], id: "i" }],
    },
  ];
  const next = commitTrackNotes(p, "vocal", [
    { id: "v", note: { ...p.tracks[0].notes[0], pitch: { midi: 72 } } },
  ]);
  expect(next.tracks![0].notes).toEqual(p.tracks[0].notes);
  expect(next.tracks![1]).toBe(p.tracks[1]);
  expect(editorTrackProject(next, "vocal").noteEditor?.commands).toHaveLength(
    1,
  );
  expect(arrangementTracks(next, "fingerstyle").notes[0].pitch.midi).toBe(72);
  expect(arrangementTracks(next, "melody").notes[0].id).toBe("i");
  validateProject(next);
});
it("legacy projects retain their identities without manufactured stems", () => {
  const p = demoProject();
  expect(editorTrackProject(p, "legacy")).toBe(p);
  expect(arrangementTracks(p, "accompaniment").ids).toEqual([]);
  validateProject(p);
});
it("context-supported passing tones survive short-note reduction; isolated noise does not", () => {
  const score = demoProject().score!;
  score.events = [60, 62, 64, 82].map((midi, i) => ({
    id: "e" + i,
    beat: [0, 0.875, 1, 2.875][i],
    durationBeats: [0.875, 0.125, 0.8, 0.05][i],
    midi,
    voice: "melody",
    role: "melody",
    origin: "detected",
    activation: 0.9,
    velocity: 0.7,
    sourceIds: [],
  }));
  const assessment = assessMusic(score, "fingerstyle");
  expect(assessment.protectedIds).toContain("e1");
  const draft = planArrangement(
    { score, sourceKind: "audio", inputFingerprint: "fixture" },
    { goal: "fingerstyle", pattern: "auto", difficulty: "normal" },
  );
  expect(draft.score.events.map((e) => e.id)).toContain("e1");
  // Last-note protection is intentional; noise in the middle is not a passing tone.
  score.events[1].midi = 82;
  expect(assessMusic(score, "fingerstyle").protectedIds).not.toContain("e1");
  score.events[1].midi = 62;
  score.events.push({
    id: "rest",
    beat: 0.87,
    durationBeats: 0.005,
    midi: null,
    voice: "melody",
    origin: "manual",
    velocity: 0,
    sourceIds: [],
  });
  expect(assessMusic(score, "fingerstyle").protectedIds).not.toContain("e1");
});

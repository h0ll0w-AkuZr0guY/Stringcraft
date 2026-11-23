import { expect, it } from "vitest";
import { analyzeTimeline } from "../plugins/harmony/timeline";
import { projectHarmony } from "../packages/music/harmony";
import { demoProject } from "../packages/music/demo";
import { withReferenceTempo } from "../packages/music/score";
import {
  beatToSeconds,
  validateHarmony,
  validateProject,
} from "../packages/contracts";
it("BPM changes do not delete harmony intervals or modify raw notes", () => {
  const p = demoProject(),
    raw = structuredClone(p.notes),
    a = analyzeTimeline(p.notes, p.duration);
  validateHarmony(a, p.duration);
  const times = (bpm: number) =>
    projectHarmony(a, {
      ...withReferenceTempo(p.score!, bpm),
      chords: [],
    }).chords.map((c) => [
      c.root,
      c.quality,
      beatToSeconds(withReferenceTempo(p.score!, bpm), c.beat),
      beatToSeconds(
        withReferenceTempo(p.score!, bpm),
        c.beat + c.durationBeats,
      ),
    ]);
  const slow = times(68.5),
    fast = times(135.7);
  expect(slow.length).toBeGreaterThan(0);
  expect(slow.length).toBe(fast.length);
  slow.forEach((c, i) => {
    expect(c[0]).toBe(fast[i][0]);
    expect(c[2]).toBeCloseTo(fast[i][2] as number, 8);
    expect(c[3]).toBeCloseTo(fast[i][3] as number, 8);
  });
  expect(p.notes).toEqual(raw);
});
it("silence stays empty and manual harmony wins over model candidates", () => {
  const p = demoProject();
  expect(
    analyzeTimeline([], p.duration).segments.every((s) => s.root === null),
  ).toBe(true);
  const a = analyzeTimeline(p.notes, p.duration);
  const s = structuredClone(p.score!);
  s.chords = [
    {
      id: "manual",
      beat: 0,
      durationBeats: s.durationBeats,
      root: 0,
      quality: "major",
      origin: "manual",
    },
  ];
  expect(projectHarmony(a, s).chords).toEqual(s.chords);
});
it("invalid overlapping intervals are rejected", () => {
  const p = demoProject(),
    a = analyzeTimeline(p.notes, p.duration);
  a.segments[0].end = 200;
  expect(() => validateHarmony(a, p.duration)).toThrow();
  p.localAnalysis = {
    jobId: "unsafe",
    cacheKey: "bad",
    cacheHit: false,
    executions: [],
    warnings: [],
  };
  expect(() => validateProject(p)).toThrow("本地任务记录无效");
});

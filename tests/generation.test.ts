import { extractMelody } from "../plugins/melody";
import { beforeEach, expect, it, vi } from "vitest";
import { demoProject } from "../packages/music/demo";
import { arrange } from "../plugins/guitar";
import { planArrangement } from "../plugins/arrangement-planner";
const state = vi.hoisted(() => ({
  disabled: "",
  outdated: "",
  empty: false,
  invalid: false,
  ai: false,
  cancel: null as AbortController | null,
}));
vi.mock("../packages/plugin-host", () => ({
  catalog: async () =>
    [
      "melody-tracker",
      "harmony-analysis",
      "guitar-standard",
      "guitar-samples",
      "standard-exporters",
      "arrangement-planner",
    ].map((id) => ({ id, name: id, sha256: "current" })),
  installed: async (id: string) => ({
    code: "code",
    enabled: state.disabled !== id,
    manifest: {
      version: "local",
      sha256: state.outdated === id ? "old" : "current",
    },
  }),
  install: vi.fn(),
  load: async () => ({
    advise: async () => {
      state.cancel?.abort();
      throw new Error("provider failure");
    },
  }),
  invoke: vi.fn(async (id: string, method: string, args: any[]) => {
    if (method === "extractMelody") return extractMelody(args[0]);
    if (method === "planArrangement") return planArrangement(args[0], args[1]);
    if (method === "analyzeHarmony") return args[1];
    if (method === "recommendCapos") return [{ capo: 0, score: 100 }];
    if (method === "arrange") {
      const result = arrange(args[0], args[1]);
      if (state.empty) result.notes = [];
      if (state.invalid) result.notes[0].duration = -1;
      return result;
    }
    throw new Error("Unexpected worker method");
  }),
}));
import { generationPlugins, runGeneration } from "../packages/music/generate";
import { invoke } from "../packages/plugin-host";
const options = {
  difficulty: "normal" as const,
  capo: 0,
  transpose: 0,
  bpm: 120,
  goal: "accompaniment" as const,
  pattern: "strum" as const,
  autoCapo: true,
  useAI: false,
};
const ai = { key: "", endpoint: "https://example.invalid", model: "mock" };
beforeEach(() => {
  state.disabled = "";
  state.outdated = "";
  state.empty = false;
  state.invalid = false;
  state.cancel = null;
  vi.clearAllMocks();
});
it("returns a validated new project, preserving the original, and exposes worker phases", async () => {
  const p = demoProject(),
    before = structuredClone(p),
    phases: string[] = [];
  const result = await runGeneration(
    p,
    options,
    ai,
    new AbortController().signal,
    (v) => phases.push(v),
  );
  expect(result.project.arrangement!.notes.length).toBeGreaterThan(0);
  expect(p).toEqual(before);
  expect(phases).toContain("寻找可用指型");
  expect(vi.mocked(invoke).mock.calls.map((c) => c[1])).toEqual([
    "planArrangement",
    "recommendCapos",
    "arrange",
  ]);
});
it("detects incompatible cached or disabled plugins before invoking any computation", async () => {
  state.outdated = "guitar-standard";
  state.disabled = "harmony-analysis";
  expect(await generationPlugins()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ reason: "update" }),
      expect.objectContaining({ reason: "disabled" }),
    ]),
  );
  await expect(
    runGeneration(
      demoProject(),
      options,
      ai,
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toMatchObject({ recovery: "plugins" });
  expect(invoke).not.toHaveBeenCalled();
});
it("empty or invalid results cannot become successful projects", async () => {
  const p = demoProject(),
    before = structuredClone(p);
  state.empty = true;
  await expect(
    runGeneration(p, options, ai, new AbortController().signal, () => {}),
  ).rejects.toThrow("没有生成");
  state.empty = false;
  state.invalid = true;
  await expect(
    runGeneration(p, options, ai, new AbortController().signal, () => {}),
  ).rejects.toThrow();
  expect(p).toEqual(before);
});
it("unknown harmony offers a concrete correction path without inventing chords", async () => {
  const p = demoProject();
  p.score!.chords = [];
  await expect(
    runGeneration(p, options, ai, new AbortController().signal, () => {}),
  ).rejects.toMatchObject({ recovery: "structure" });
});
it("cancelling optional advice cannot fall back into generation", async () => {
  const control = new AbortController();
  state.cancel = control;
  await expect(
    runGeneration(
      demoProject(),
      { ...options, useAI: true },
      ai,
      control.signal,
      () => {},
    ),
  ).rejects.toThrow();
  expect(vi.mocked(invoke).mock.calls.some((c) => c[1] === "arrange")).toBe(
    false,
  );
});
it("a conflicting locked fingering rejects the new arrangement and preserves the old one", async () => {
  const p = demoProject();
  p.arrangement = arrange(p.notes, {
    ...options,
    goal: "melody",
    score: p.score,
  });
  p.arrangement.notes[0].locked = true;
  const before = structuredClone(p);
  await expect(
    runGeneration(
      p,
      { ...options, capo: 12, autoCapo: false },
      ai,
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toThrow();
  expect(p).toEqual(before);
});

it("direct whole-file melody generation does not treat the initial empty score as a selected voice", async () => {
  const p = demoProject();
  p.sourceKind = "audio";
  p.score!.events = [];
  p.melody = [];
  p.harmonyAnalysis = {
    version: 1,
    method: "fixture",
    duration: p.duration,
    frameHop: 0.5,
    segments: [],
    executions: [],
    warnings: [],
  };
  const before = structuredClone(p);
  const result = await runGeneration(
    p,
    { ...options, goal: "melody" },
    ai,
    new AbortController().signal,
    () => {},
  );
  expect(result.project.arrangement!.notes.length).toBeGreaterThan(0);
  expect(result.project.melody.length).toBeGreaterThan(0);
  expect(p).toEqual(before);
});

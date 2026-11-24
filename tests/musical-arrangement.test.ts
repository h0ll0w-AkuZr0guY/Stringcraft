import { expect, it } from "vitest";
import { planArrangement } from "../plugins/arrangement-planner";
import { arrangeScore } from "../plugins/guitar/performance";
import { extractMelody } from "../plugins/melody";
import { articulationSegments } from "../packages/music/performance-audio";
import {
  sampleChoices,
  type GuitarSample,
} from "../packages/music/sample-bank";
import {
  validateArrangementDraft,
  validateScore,
  type MusicalScore,
  type ChordSymbol,
} from "../packages/contracts";

const score = (): MusicalScore => ({
  version: 2,
  durationBeats: 16,
  tempo: [{ beat: 0, bpm: 90 }],
  meter: [{ beat: 0, numerator: 4, denominator: 4 }],
  beatOffsetSeconds: 0,
  timing: "manual",
  events: [],
  chords: [],
  sections: [],
  warnings: [],
});
const chord = (
  id: string,
  beat: number,
  durationBeats: number,
  root = 0,
  quality: ChordSymbol["quality"] = "major",
): ChordSymbol => ({
  id,
  beat,
  durationBeats,
  root,
  quality,
  origin: "estimated",
  evidence: 0.01,
});
const options = {
  goal: "fingerstyle" as const,
  difficulty: "hard" as const,
  pattern: "strum" as const,
};
const draft = (s: MusicalScore, kind: "audio" | "musicxml" = "audio") =>
  planArrangement(
    { score: s, sourceKind: kind, inputFingerprint: "test-fixed-input" },
    options,
  );

it("merges a weak chromatic island without editing the original or limiting vocabulary", () => {
  const s = score();
  s.chords = [
    chord("a", 0, 4),
    chord("false", 4, 0.15, 1),
    chord("b", 4.15, 11.85),
  ];
  const original = structuredClone(s),
    d = draft(s);
  validateArrangementDraft(d);
  expect(d.score.chords).toHaveLength(1);
  expect(d.score.chords[0].root).toBe(0);
  expect(d.decisions.some((x) => x.sourceIds.includes("false"))).toBe(true);
  expect(s).toEqual(original);
});
it("rare dominant resolution is kept even when common-chord frequency favors deletion", () => {
  const s = score();
  s.chords = [
    chord("c", 0, 10),
    chord("dominant", 10, 1, 11),
    chord("em", 11, 5, 4, "minor"),
  ];
  expect(
    draft(s).score.chords.some((c) => c.root === 11 && c.quality === "major"),
  ).toBe(true);
});
it("manual and imported harmonic changes are never simplified automatically", () => {
  const s = score();
  s.chords = [
    chord("c", 0, 4),
    { ...chord("manual", 4, 0.15, 1), origin: "manual" },
    chord("c2", 4.15, 11.85),
  ];
  expect(draft(s).score.chords.find((c) => c.id === "manual")).toEqual(
    s.chords[1],
  );
});

it("strong soft-bass evidence can keep a brief alternative without rewriting the original", () => {
  const s = score();
  s.chords = [
    chord("before", 0, 4, 0),
    { ...chord("bass-backed", 4, 0.62, 2), evidence: 0.15 },
    chord("after", 4.62, 11.38, 0),
  ];
  const result = planArrangement(
    {
      score: s,
      sourceKind: "audio",
      inputFingerprint: "independent-bass-label",
      bassEvidence: [
        {
          id: "d",
          start: (4 * 60) / 90,
          duration: 0.41,
          pitch: { midi: 38 },
          score: 0.95,
          velocity: 0.6,
          source: "detected",
        },
      ],
    },
    { ...options, profile: "phrasing" },
  );
  expect(result.score.chords.some((c) => c.root === 2)).toBe(true);
  expect(s.chords[1].durationBeats).toBe(0.62);
});

it("long structural chords survive non-chord melody tones and an unconfirmed grid is not snapped", () => {
  const s = score();
  s.timing = "unconfirmed";
  s.chords = [
    {
      ...chord("c", 0, 4.07),
      alternatives: [{ root: 7, quality: "major", score: 0.7 }],
    },
    chord("g", 4.07, 11.93, 7),
  ];
  s.events = [
    {
      id: "passing",
      beat: 0,
      durationBeats: 3,
      midi: 62,
      voice: "melody",
      velocity: 0.7,
      sourceIds: [],
      origin: "detected",
    },
  ];
  const d = draft(s);
  expect(d.score.chords.map((c) => [c.root, c.beat, c.durationBeats])).toEqual([
    [0, 0, 4.07],
    [7, 4.07, 11.93],
  ]);
});
it("a sustained melodic seventh protects its color; an unsupported weak color can simplify", () => {
  const s = score();
  s.chords = [chord("color", 0, 16, 0, "maj7")];
  expect(draft(s).score.chords[0].quality).toBe("major");
  s.events = [
    {
      id: "b",
      beat: 0,
      durationBeats: 4,
      midi: 71,
      voice: "melody",
      velocity: 0.7,
      sourceIds: [],
      origin: "detected",
      activation: 0.9,
    },
  ];
  expect(draft(s).score.chords[0].quality).toBe("maj7");
});
it("explicit musical rests prevent speculative filling of a chord gap", () => {
  const s = score();
  s.chords = [chord("c", 0, 4), chord("c2", 4.25, 11.75)];
  s.events = [
    {
      id: "hold",
      beat: 0,
      durationBeats: 8,
      midi: 64,
      voice: "melody",
      velocity: 0.7,
      sourceIds: [],
    },
    {
      id: "rest",
      beat: 4,
      durationBeats: 0.25,
      midi: null,
      voice: "bass",
      velocity: 0,
      sourceIds: [],
    },
  ];
  expect(draft(s).score.chords.some((c) => c.id.startsWith("fill-"))).toBe(
    false,
  );
  s.events = s.events.filter((e) => e.id !== "rest");
  expect(
    draft(s).score.chords.find((c) => c.id.startsWith("fill-"))?.origin,
  ).toBe("generated");
});
it("voice tracking can skip accompaniment attacks during a held melody and keep a real next note", () => {
  const n = (
    id: string,
    midi: number,
    start: number,
    duration: number,
    score: number,
  ) => ({
    id,
    start,
    duration,
    pitch: { midi },
    score,
    velocity: 0.7,
    source: "detected" as const,
  });
  const result = extractMelody([
    n("melody", 72, 0, 1.8, 0.95),
    n("bass1", 43, 0.2, 0.15, 0.3),
    n("bass2", 48, 0.4, 0.15, 0.3),
    n("next", 74, 2, 0.5, 0.95),
  ]);
  expect(result.map((n) => n.id)).toEqual(["melody", "next"]);
  expect(result[0].duration).toBe(1.8);
});
it("known-score melody anchors survive joint fingering with independent bass", () => {
  const s = score();
  s.chords = [
    { ...chord("c", 0, 8), origin: "manual" },
    { ...chord("g", 8, 8, 7), origin: "manual" },
  ];
  s.events = Array.from({ length: 16 }, (_, i) => ({
    id: `m${i}`,
    beat: i,
    durationBeats: 0.8,
    midi: [64, 67, 69, 67][i % 4],
    voice: "melody",
    velocity: 0.75,
    sourceIds: [],
    origin: "imported" as const,
  }));
  const d = draft(s, "musicxml"),
    plan = arrangeScore(d.score, {
      ...options,
      capo: 0,
      transpose: 0,
      phrases: d.phrases,
    });
  const retained = new Set(plan.actions.flatMap((a) => a.sourceIds));
  expect(s.events.every((e) => retained.has(e.id))).toBe(true);
  expect(plan.actions.some((a) => a.role === "bass")).toBe(true);
  expect(plan.issues.filter((i) => i.severity === "error")).toEqual([]);
});
it("an impossible anchor reports a concrete failure instead of quietly disappearing", () => {
  const s = score();
  s.events = [
    {
      id: "impossible",
      beat: 0,
      durationBeats: 1,
      midi: 120,
      voice: "melody",
      velocity: 0.7,
      sourceIds: [],
      origin: "imported",
    },
  ];
  const d = draft(s, "musicxml");
  expect(() =>
    arrangeScore(d.score, {
      ...options,
      capo: 0,
      transpose: 0,
      phrases: d.phrases,
    }),
  ).toThrow("骨干");
});
it("natural strums group real brushes with distinct accents and nonlinear string timing", () => {
  const s = score();
  s.chords = [{ ...chord("em", 0, 16, 4, "minor"), origin: "manual" }];
  const plan = arrangeScore(s, {
    ...options,
    goal: "accompaniment",
    difficulty: "normal",
    capo: 0,
    transpose: 0,
  });
  const brushes = [...new Set(plan.actions.map((a) => a.strokeId))].map((id) =>
    plan.actions.filter((a) => a.strokeId === id),
  );
  expect(
    new Set(brushes.map((a) => a[0].velocity.toFixed(2))).size,
  ).toBeGreaterThan(3);
  expect(brushes.some((b) => b[0].stroke === "up" && b.length < 4)).toBe(true);
  expect(brushes[0].at(-1)!.beat - brushes[0][0].beat).toBeGreaterThan(0.03);
  expect(plan.issues.filter((i) => i.severity === "error")).toEqual([]);
});
it("hammer and pull targets do not inherit slide pitch ramps, including a resumed phrase", () => {
  const notes = [
    {
      id: "a",
      start: 0,
      duration: 0.5,
      pitch: { midi: 64 },
      velocity: 0.7,
      score: 1,
      source: "manual" as const,
      string: 1,
      fret: 0,
      attack: "pluck" as const,
    },
    {
      id: "b",
      start: 0.5,
      duration: 0.5,
      pitch: { midi: 66 },
      velocity: 0.7,
      score: 1,
      source: "manual" as const,
      string: 1,
      fret: 2,
      attack: "hammer" as const,
      linkFrom: "a",
    },
    {
      id: "c",
      start: 1,
      duration: 0.5,
      pitch: { midi: 67 },
      velocity: 0.7,
      score: 1,
      source: "manual" as const,
      string: 1,
      fret: 3,
      attack: "slide" as const,
      linkFrom: "b",
    },
  ];
  const segments = articulationSegments(notes);
  expect(segments).toHaveLength(3);
  expect(segments[1].softAttack).toBe(true);
  expect(segments[1].glideFrom).toBeUndefined();
  expect(segments[2].glideFrom).toBe(66);
  const resumed = articulationSegments(notes, 0.7, 1.2);
  expect(resumed[0].sampleOffset).toBeGreaterThan(0.2);
  expect(resumed[0].note.pitch.midi).toBe(66);
});
it("sample mapping honors actual string and finger articulation before dynamics", () => {
  const bank: GuitarSample[] = [
    {
      instrument: "nylon",
      string: 1,
      midi: 64,
      layer: 1,
      technique: "finger",
      local_file: "finger",
    },
    {
      instrument: "nylon",
      string: 1,
      midi: 64,
      layer: 2,
      technique: "pick",
      local_file: "pick",
    },
    {
      instrument: "nylon",
      string: 2,
      midi: 64,
      layer: 1,
      technique: "finger",
      local_file: "wrong-string",
    },
  ];
  const n = {
    id: "n",
    start: 0,
    duration: 1,
    pitch: { midi: 64 },
    velocity: 1,
    score: 1,
    source: "manual" as const,
    string: 1,
    fret: 0,
    attack: "pluck" as const,
  };
  expect(
    sampleChoices(bank, n, "nylon").map((x) => x.sample.local_file),
  ).toEqual(["finger"]);
  expect(
    sampleChoices(bank, { ...n, attack: "strum" }, "nylon").map(
      (x) => x.sample.local_file,
    ),
  ).toEqual(["pick"]);
});
it("draft validation rejects corrupt boundaries and unsupported origins", () => {
  const d = draft(score());
  d.phrases[0].endBeat = 999;
  expect(() => validateArrangementDraft(d)).toThrow();
  const s = score();
  s.chords = [{ ...chord("generated", 0, 16), origin: "generated" }];
  expect(() => validateScore(s)).not.toThrow();
});

it("vocal evidence replaces overlapping detector decay without changing raw/manual notes", () => {
  const s = score();
  s.events = [
    {
      id: "detector-tail",
      voice: "melody",
      role: "melody",
      beat: 0,
      durationBeats: 3,
      midi: 60,
      velocity: 0.6,
      sourceIds: [],
      origin: "detected",
    },
    {
      id: "hand-edit",
      voice: "melody",
      role: "melody",
      beat: 4,
      durationBeats: 1,
      midi: 64,
      velocity: 0.7,
      sourceIds: [],
      origin: "manual",
    },
  ];
  const before = structuredClone(s);
  const d = planArrangement(
    {
      score: s,
      sourceKind: "audio",
      inputFingerprint: "overlay",
      melodyEvidence: [
        {
          id: "f0",
          start: 1,
          duration: 0.7,
          pitch: { midi: 62 },
          score: 0.95,
          velocity: 0.6,
          source: "detected",
        },
        {
          id: "conflict",
          start: 8 / 3,
          duration: 0.5,
          pitch: { midi: 65 },
          score: 0.95,
          velocity: 0.6,
          source: "detected",
        },
      ],
    },
    options,
  );
  expect(s).toEqual(before);
  expect(d.score.events.find((e) => e.id === "hand-edit")).toEqual(
    expect.objectContaining(before.events[1]),
  );
  const lead = d.score.events
    .filter((e) => e.role === "melody")
    .sort((a, b) => a.beat - b.beat);
  expect(lead[0].beat + lead[0].durationBeats).toBeLessThanOrEqual(
    lead[1].beat + 0.000001,
  );
});

it("a bass attack never ignores a sub-millisecond held melody span conflict", () => {
  const s = score();
  s.chords = [chord("g", 0, 16, 7)];
  s.events = [
    {
      id: "high",
      voice: "melody",
      role: "melody",
      beat: 0,
      durationBeats: 2.0005,
      midi: 67,
      velocity: 0.7,
      sourceIds: [],
      origin: "manual",
      extensions: { guitar: { string: 2, fret: 8 } },
    },
  ];
  const d = draft(s, "musicxml");
  expect(() =>
    arrangeScore(d.score, {
      ...options,
      capo: 0,
      transpose: 0,
      phrases: d.phrases,
    }),
  ).not.toThrow();
});

it("a real breath permits phrase octave preparation inside a suggested bar-count phrase", () => {
  const s = score();
  s.events = [
    {
      id: "high",
      beat: 0,
      durationBeats: 1,
      midi: 78,
      voice: "melody",
      role: "melody",
      velocity: 0.7,
      sourceIds: [],
      origin: "detected",
    },
    {
      id: "low",
      beat: 4,
      durationBeats: 1,
      midi: 38,
      voice: "melody",
      role: "melody",
      velocity: 0.7,
      sourceIds: [],
      origin: "detected",
    },
  ];
  const d = draft(s);
  const p = arrangeScore(d.score, {
    ...options,
    capo: 0,
    transpose: 0,
    phrases: [
      {
        id: "suggestion",
        beat: 0,
        endBeat: 16,
        energy: "steady",
        texture: "arpeggio",
      },
    ],
  });
  expect(p.actions.filter((a) => a.role === "melody")).toHaveLength(2);
});

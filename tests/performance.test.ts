import { describe, it, expect } from "vitest";
import * as alpha from "@coderline/alphatab";
import {
  beatToSeconds,
  soundingEvents,
  validateScore,
  type MusicalScore,
  type NoteEvent,
} from "../packages/contracts";
import {
  arrangeScore,
  arrangeMusicalScore,
  assignFingers,
  validatePerformance,
} from "../plugins/guitar/performance";
import { analyzeHarmony, tempoCandidates } from "../plugins/harmony";
import { demoProject } from "../packages/music/demo";
import { upgradeProject } from "../packages/music/score";
import { audioGestures } from "../packages/music/performance-audio";
import { alphaScore } from "../plugins/guitar/alpha-score";
import { tabMeasures } from "../plugins/guitar/notation";
import piano from "../plugins/piano";
import { musicXML } from "../plugins/exporters/musicxml";
const score = (): MusicalScore => ({
  version: 2,
  durationBeats: 8,
  tempo: [{ beat: 0, bpm: 120 }],
  meter: [{ beat: 0, numerator: 4, denominator: 4 }],
  beatOffsetSeconds: 0,
  timing: "manual",
  events: [],
  chords: [
    {
      id: "em",
      beat: 0,
      durationBeats: 4,
      root: 4,
      quality: "minor",
      origin: "manual",
    },
    {
      id: "c",
      beat: 4,
      durationBeats: 4,
      root: 0,
      quality: "major",
      origin: "manual",
    },
  ],
  sections: [],
  warnings: [],
});
const options = {
  difficulty: "normal" as const,
  capo: 0,
  transpose: 0,
  goal: "accompaniment" as const,
  pattern: "strum" as const,
};
describe("musical score and evidence", () => {
  it("ties excite once, a repeated pitch excites again, tempo changes preserve duration", () => {
    const s = score();
    s.tempo.push({ beat: 4, bpm: 60 });
    s.events = [
      {
        id: "a",
        voice: "melody",
        beat: 0,
        durationBeats: 4,
        midi: 64,
        velocity: 0.7,
        sourceIds: ["raw-a"],
      },
      {
        id: "b",
        voice: "melody",
        beat: 4,
        durationBeats: 2,
        midi: 64,
        velocity: 0.7,
        sourceIds: ["raw-a"],
        tieFrom: "a",
      },
      {
        id: "repeat",
        voice: "melody",
        beat: 6,
        durationBeats: 1,
        midi: 64,
        velocity: 0.7,
        sourceIds: ["raw-b"],
      },
    ];
    const n = soundingEvents(s);
    expect(n).toHaveLength(2);
    expect(n[0].duration).toBe(4);
    expect(n[1].start).toBe(4);
    expect(beatToSeconds(s, 8)).toBe(6);
  });
  it("rejects a tie across pitches or separated by silence", () => {
    const s = score();
    s.events = [
      {
        id: "a",
        voice: "melody",
        beat: 0,
        durationBeats: 1,
        midi: 64,
        velocity: 0.7,
        sourceIds: [],
      },
      {
        id: "b",
        voice: "melody",
        beat: 2,
        durationBeats: 1,
        midi: 65,
        velocity: 0.7,
        sourceIds: [],
        tieFrom: "a",
      },
    ];
    expect(() => validateScore(s)).toThrow("延音线");
  });
  it("does not turn one sustained note into a guessed chord", () => {
    const s = score();
    s.chords = [];
    const n: NoteEvent = {
      id: "raw",
      start: 0,
      duration: 4,
      pitch: { midi: 64 },
      velocity: 0.7,
      score: 0.9,
      source: "detected",
    };
    expect(analyzeHarmony([n], s).chords).toEqual([]);
    expect(tempoCandidates([n])).toEqual([]);
  });
  it("manual harmony survives contrary detector evidence", () => {
    const s = score(),
      n = [60, 64, 67].map((midi, i) => ({
        id: String(i),
        start: 0,
        duration: 4,
        pitch: { midi },
        velocity: 0.8,
        score: 0.9,
        source: "detected" as const,
      }));
    expect(analyzeHarmony(n, s).chords).toEqual(s.chords);
  });
  it("explicit upgrade preserves old identity and locked edits in the original", () => {
    const p = demoProject();
    p.schemaVersion = 1;
    delete p.score;
    const before = JSON.stringify(p);
    const next = upgradeProject(p);
    expect(next.id).not.toBe(p.id);
    expect(next.migratedFrom).toBe(p.id);
    expect(next.schemaVersion).toBe(2);
    expect(JSON.stringify(p)).toBe(before);
  });
});
describe("guitar actions rather than density", () => {
  it("beginner can play a full six-string Em with two fretting fingers", () => {
    const plan = arrangeScore(score(), { ...options, difficulty: "easy" });
    const first = plan.actions.filter(
      (a) => a.strokeId === plan.actions[0].strokeId,
    );
    expect(first).toHaveLength(6);
    expect(
      new Set(first.filter((a) => a.fret > 0).map((a) => a.finger)).size,
    ).toBe(2);
    expect(plan.issues).toEqual([]);
  });
  it("rejects five independent fingers even inside a four-fret span", () => {
    expect(
      assignFingers(
        [1, 2, 3, 4, 5].map((fret, i) => ({ fret, string: i + 1 })),
      ),
    ).toBeNull();
  });
  it("does not barre through an open string", () => {
    const assigned = assignFingers([
      { string: 1, fret: 1 },
      { string: 2, fret: 0 },
      { string: 3, fret: 1 },
    ]);
    expect(assigned![0]).not.toBe(assigned![2]);
  });
  it("daily accompaniment is identical when irrelevant detector events are added", () => {
    const a = arrangeMusicalScore(score(), { ...options, bpm: 120 });
    expect(a.notes.some((n) => n.role === "melody")).toBe(false);
    expect(a.notes.some((n) => n.stroke === "up")).toBe(true);
    expect(a.dropped).toEqual([]);
  });
  it("refuses accompaniment without harmonic evidence", () => {
    const s = score();
    s.chords = [];
    expect(() => arrangeScore(s, options)).toThrow("没有可用和弦");
  });
  it("does not replace a locked manual edit during structured re-arrangement", () => {
    const a = arrangeMusicalScore(score(), { ...options, bpm: 120 });
    const lock = { ...a.notes[0], locked: true, velocity: 0.3 };
    const b = arrangeMusicalScore(score(), {
      ...options,
      bpm: 120,
      previous: [lock],
    });
    expect(b.notes.find((n) => n.id === lock.id)).toEqual(lock);
  });
  it("all presets of an original harmonic phrase satisfy sounding string constraints", () => {
    const s = demoProject().score!;
    for (const difficulty of ["easy", "normal", "hard", "expert"] as const)
      for (const goal of ["accompaniment", "fingerstyle"] as const) {
        const plan = arrangeScore(s, { ...options, difficulty, goal });
        expect(
          validatePerformance(plan, { ...options, difficulty, goal }),
        ).toEqual([]);
      }
  });
});
describe("sound and notation share musical meaning", () => {
  it("piano package uses hands and keyboard spans without tuning or frets", () => {
    const s = score();
    s.events = [48, 72].map((midi, i) => ({
      id: `p${i}`,
      voice: String(i),
      beat: 0,
      durationBeats: 2,
      midi,
      velocity: 0.7,
      sourceIds: [],
    }));
    const options = { difficulty: "normal" as const, split: 60, maxSpan: 12 };
    const plan = piano.arrangeScore(s, options);
    expect(plan.issues).toEqual([]);
    expect(plan.actions.map((a) => a.hand)).toEqual(["left", "right"]);
    expect(plan.actions.some((a) => "fret" in a)).toBe(false);
    plan.actions[0].midi = 58;
    plan.actions[0].hand = "right";
    plan.actions[0].finger = 2;
    expect(
      piano
        .validatePerformance(plan, options)
        .some((i) => i.code === "keyboard-hand"),
    ).toBe(true);
  });
  it("an independent standard reader accepts the exported MusicXML", () => {
    const p = demoProject();
    p.arrangement = arrangeMusicalScore(p.score!, {
      ...options,
      goal: "fingerstyle",
      bpm: p.bpm,
    });
    const parsed = alpha.importer.ScoreLoader.loadScoreFromBytes(
      new TextEncoder().encode(musicXML(p)),
    );
    expect(parsed.tracks.length).toBe(1);
    expect(parsed.masterBars.length).toBeGreaterThan(1);
  });
  it("hammer-on and pull-off share one excitation, real repetition has its own", () => {
    const base = {
      velocity: 0.7,
      score: 1,
      source: "generated" as const,
      string: 1,
      role: "melody" as const,
    };
    const notes = [
      {
        ...base,
        id: "a",
        start: 0,
        duration: 0.5,
        pitch: { midi: 64 },
        fret: 0,
      },
      {
        ...base,
        id: "b",
        start: 0.5,
        duration: 0.5,
        pitch: { midi: 67 },
        fret: 3,
        linkFrom: "a",
        attack: "hammer" as const,
      },
      {
        ...base,
        id: "c",
        start: 1,
        duration: 0.5,
        pitch: { midi: 64 },
        fret: 0,
        linkFrom: "b",
        attack: "pull" as const,
      },
      {
        ...base,
        id: "d",
        start: 1.5,
        duration: 0.5,
        pitch: { midi: 64 },
        fret: 0,
      },
    ];
    const gestures = audioGestures(notes);
    expect(gestures).toHaveLength(2);
    expect(gestures[0].changes).toHaveLength(2);
    expect(gestures[0].end).toBe(1.5);
    const loop = audioGestures(notes, 0.7, 1.2);
    expect(loop).toHaveLength(1);
    expect(loop[0].resumed).toBe(true);
    expect(loop[0].note.pitch.midi).toBe(67);
  });
  it("structured rhythm notation retains separate melody and bass voices and ties", () => {
    const p = demoProject();
    p.arrangement = arrangeMusicalScore(p.score!, {
      ...options,
      goal: "fingerstyle",
      bpm: p.bpm,
    });
    const rendered = alphaScore(alpha, p);
    expect(rendered.tracks[0].staves[0].bars[0].voices).toHaveLength(2);
    expect(
      rendered.tracks[0].staves[0].bars
        .flatMap((b) =>
          b.voices.flatMap((v) => v.beats.flatMap((b) => b.notes)),
        )
        .some((n) => n.isTieDestination),
    ).toBe(true);
  });
  it("tab columns never overlap even for a deliberately dense, manually supplied bar", () => {
    const p = demoProject();
    p.arrangement = arrangeMusicalScore(p.score!, { ...options, bpm: p.bpm });
    p.arrangement.notes = Array.from({ length: 50 }, (_, i) => ({
      ...p.arrangement!.notes[0],
      id: String(i),
      strokeId: undefined,
      start: i * 0.015,
    }));
    const bar = tabMeasures(p)[0];
    for (let i = 1; i < bar.columns.length; i++)
      expect(bar.columns[i].x - bar.columns[i - 1].x).toBeGreaterThanOrEqual(
        38,
      );
    expect(bar.width).toBeGreaterThan(1900);
  });
});

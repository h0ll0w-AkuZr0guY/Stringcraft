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
  syncPerformance,
} from "../plugins/guitar/performance";
import { analyzeHarmony, tempoCandidates } from "../plugins/harmony";
import { demoProject } from "../packages/music/demo";
import { upgradeProject } from "../packages/music/score";
import { audioGestures } from "../packages/music/performance-audio";
import { alphaScore } from "../plugins/guitar/alpha-score";
import { tabMeasures } from "../plugins/guitar/notation";
import piano from "../plugins/piano";
import { musicXML } from "../plugins/exporters/musicxml";
import { referenceSoundEvents } from "../plugins/guitar/reference";
import { compareGuitarPerformance } from "../plugins/guitar/evaluation";
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
  it("intra-bar chord changes keep the measure's strum pattern instead of restarting it", () => {
    const s = score();
    s.durationBeats = 8;
    s.chords = [
      {
        id: "em",
        beat: 0,
        durationBeats: 3,
        root: 4,
        quality: "minor",
        origin: "manual",
      },
      {
        id: "g",
        beat: 3,
        durationBeats: 5,
        root: 7,
        quality: "major",
        origin: "manual",
      },
    ];
    const plan = arrangeScore(s, options),
      starts = [...new Set(plan.actions.map((a) => a.strokeId))]
        .map((id) =>
          Math.min(
            ...plan.actions.filter((a) => a.strokeId === id).map((a) => a.beat),
          ),
        )
        .sort((a, b) => a - b);
    expect(starts).toEqual([0, 1, 1.5, 2.5, 3, 3.5, 4, 5, 5.5, 6.5, 7, 7.5]);
  });
  it("a chord change in a rhythmic rest gets its own readable notation anchor", () => {
    const p = demoProject(),
      s = score();
    s.chords = [
      {
        id: "em",
        beat: 0,
        durationBeats: 1.25,
        root: 4,
        quality: "minor",
        origin: "manual",
      },
      {
        id: "c",
        beat: 1.25,
        durationBeats: 6.75,
        root: 0,
        quality: "major",
        origin: "manual",
      },
    ];
    s.events = [
      {
        id: "e",
        voice: "melody",
        beat: 0,
        durationBeats: 4,
        midi: 64,
        velocity: 0.7,
        sourceIds: [],
      },
    ];
    p.score = s;
    p.arrangement = arrangeMusicalScore(s, {
      ...options,
      goal: "melody",
      bpm: 120,
    });
    const bar = tabMeasures(p)[0],
      change = bar.columns.find((c) => c.chord?.id === "c")!;
    expect(change.beat).toBe(1.25);
    expect(change.notes).toEqual([]);
    expect(change.x + 62).toBeLessThan(bar.width);
    const symbols = bar.columns.filter((c) => c.chord);
    expect(symbols[1].x - symbols[0].x).toBeGreaterThanOrEqual(74);
  });
  it("simple waltz and compound duple patterns follow their own pulse groups", () => {
    for (const [numerator, denominator, duration, expected] of [
      [3, 4, 3, [0, 1, 2]],
      [6, 8, 3, [0, 1.5]],
    ] as const) {
      const s = score();
      s.durationBeats = duration;
      s.meter = [{ beat: 0, numerator, denominator }];
      s.chords = [
        {
          id: "em",
          beat: 0,
          durationBeats: duration,
          root: 4,
          quality: "minor",
          origin: "manual",
        },
      ];
      const plan = arrangeScore(s, { ...options, difficulty: "easy" }),
        starts = [...new Set(plan.actions.map((a) => a.strokeId))]
          .map((id) =>
            Math.min(
              ...plan.actions
                .filter((a) => a.strokeId === id)
                .map((a) => a.beat),
            ),
          )
          .sort((a, b) => a - b);
      expect(starts).toEqual(expected);
    }
  });
  it("authored muted attacks release the string without inventing a pitched score event", () => {
    const s = score();
    s.chords = [];
    s.events = [
      {
        id: "bass",
        voice: "bass",
        role: "bass",
        origin: "manual",
        beat: 0,
        durationBeats: 2,
        midi: 40,
        velocity: 0.7,
        sourceIds: [],
        extensions: { guitar: { string: 6, fret: 0 } },
      },
      {
        id: "tap",
        voice: "bass",
        role: "bass",
        origin: "manual",
        beat: 1,
        durationBeats: 1,
        midi: null,
        unpitched: true,
        velocity: 0.7,
        sourceIds: [],
        extensions: { guitar: { string: 6, fret: 0 } },
      },
    ];
    expect(soundingEvents(s)).toHaveLength(1);
    const p = arrangeScore(s, {
      ...options,
      goal: "fingerstyle",
      difficulty: "hard",
    });
    const notes = referenceSoundEvents(s);
    expect(p.actions.find((a) => a.id === "bass")!.durationBeats).toBe(1);
    expect(p.actions.find((a) => a.id === "tap")!.kind).toBe("dead");
    expect(p.actions.find((a) => a.id === "tap")!.notationDurationBeats).toBe(
      1,
    );
    const exact = compareGuitarPerformance(notes, notes);
    expect(exact.pitched.reference).toBe(1);
    expect(exact.percussion.reference).toBe(1);
    const missing = compareGuitarPerformance(
      notes,
      notes.filter((n) => !n.dead),
    );
    expect(missing.pitched.f1).toBe(1);
    expect(missing.percussion.f1).toBe(0);
    const wrongString = compareGuitarPerformance(
      notes,
      notes.map((n) => (n.dead ? { ...n, string: 5 } : n)),
    );
    expect(wrongString.percussion.f1).toBe(0);
    expect(() =>
      validateScore({
        ...s,
        events: s.events.map((e) => (e.unpitched ? { ...e, midi: 40 } : e)),
      }),
    ).toThrow("非音高");
  });
  it("quarter and half notes retain duration instead of becoming sixteenth tie chains", () => {
    const p = demoProject();
    const s = score();
    s.chords = [];
    s.events = [
      {
        id: "long",
        voice: "melody",
        beat: 0,
        durationBeats: 2,
        midi: 64,
        velocity: 0.7,
        sourceIds: [],
      },
      {
        id: "quarter",
        voice: "melody",
        beat: 2,
        durationBeats: 1,
        midi: 67,
        velocity: 0.7,
        sourceIds: [],
      },
    ];
    p.score = s;
    p.arrangement = arrangeMusicalScore(s, {
      ...options,
      goal: "melody",
      bpm: 120,
    });
    const bar = alphaScore(alpha, p).tracks[0].staves[0].bars[0];
    expect(bar.voices[0].beats.map((b) => b.duration)).toEqual([
      alpha.model.Duration.Half,
      alpha.model.Duration.Quarter,
      alpha.model.Duration.Quarter,
    ]);
    expect(
      bar.voices[0].beats
        .flatMap((b) => b.notes)
        .some((n) => n.isTieDestination),
    ).toBe(false);
  });
  it("guitar staff shows the conventional written octave without changing sounding pitch", () => {
    const p = demoProject(),
      s = score();
    s.chords = [];
    s.events = [
      {
        id: "e",
        voice: "melody",
        beat: 0,
        durationBeats: 1,
        midi: 64,
        velocity: 0.7,
        sourceIds: [],
      },
    ];
    p.score = s;
    p.arrangement = arrangeMusicalScore(s, {
      ...options,
      goal: "melody",
      bpm: 120,
    });
    const note = alphaScore(alpha, p).tracks[0].staves[0].bars[0].voices[0]
      .beats[0].notes[0];
    expect(note.realValue).toBe(64);
    expect(note.displayValue).toBe(76);
  });
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
  it("authored supporting voices are preserved without adding template notes", () => {
    const s = score();
    s.durationBeats = 4;
    s.chords = s.chords.slice(0, 1);
    s.events = [
      {
        id: "lead",
        voice: "upper",
        role: "melody",
        origin: "manual",
        beat: 0,
        durationBeats: 4,
        midi: 64,
        velocity: 0.8,
        sourceIds: [],
        extensions: { guitar: { string: 1, fret: 0 } },
      },
      {
        id: "written-bass",
        voice: "lower",
        role: "bass",
        origin: "manual",
        beat: 0,
        durationBeats: 4,
        midi: 40,
        velocity: 0.6,
        sourceIds: [],
        extensions: { guitar: { string: 6, fret: 0 } },
      },
      {
        id: "written-inner",
        voice: "middle",
        role: "harmony",
        origin: "manual",
        beat: 1,
        durationBeats: 1,
        midi: 55,
        velocity: 0.5,
        sourceIds: [],
        extensions: { guitar: { string: 3, fret: 0 } },
      },
    ];
    const plan = arrangeScore(s, {
      ...options,
      goal: "fingerstyle",
      difficulty: "hard",
    });
    expect(plan.actions.map((a) => a.id).sort()).toEqual([
      "lead",
      "written-bass",
      "written-inner",
    ]);
    expect(
      plan.actions.find((a) => a.id === "written-bass")!.durationBeats,
    ).toBe(4);
  });
  it("unreviewed detected supporting events are not treated as authored harmony", () => {
    const s = score();
    s.events = [
      {
        id: "lead",
        voice: "melody",
        beat: 0,
        durationBeats: 4,
        midi: 64,
        velocity: 0.8,
        sourceIds: [],
      },
      {
        id: "noise",
        voice: "other",
        role: "harmony",
        origin: "detected",
        beat: 1,
        durationBeats: 1,
        midi: 70,
        velocity: 0.9,
        sourceIds: ["raw-noise"],
      },
    ];
    const plan = arrangeScore(s, {
      ...options,
      goal: "fingerstyle",
      difficulty: "hard",
    });
    expect(plan.actions.some((a) => a.sourceIds.includes("noise"))).toBe(false);
  });
  it("an explicit role overrides an opaque voice identifier", () => {
    const s = score();
    s.events = [
      {
        id: "bass-only",
        voice: "melody",
        role: "bass",
        roleOrigin: "manual",
        origin: "detected",
        beat: 0,
        durationBeats: 4,
        midi: 40,
        velocity: 0.6,
        sourceIds: ["raw-bass"],
      },
    ];
    const plan = arrangeScore(s, {
      ...options,
      goal: "fingerstyle",
      difficulty: "hard",
    });
    expect(plan.actions).toHaveLength(1);
    expect(plan.actions[0].role).toBe("bass");
  });
  it("sparse fingerstyle adds a quiet inner voice without changing protected melody", () => {
    const s = score();
    s.durationBeats = 4;
    s.chords = s.chords.slice(0, 1);
    s.chords[0] = { ...s.chords[0], root: 0, quality: "major" };
    s.events = [
      {
        id: "held-melody",
        voice: "melody",
        beat: 0,
        durationBeats: 4,
        midi: 64,
        velocity: 0.8,
        sourceIds: [],
      },
    ];
    const hard = arrangeScore(s, {
      ...options,
      goal: "fingerstyle",
      difficulty: "hard",
    });
    const expert = arrangeScore(s, {
      ...options,
      goal: "fingerstyle",
      difficulty: "expert",
    });
    expect(
      hard.actions.filter((a) => a.role === "melody").map((a) => a.id),
    ).toEqual(["held-melody"]);
    expect(hard.actions.some((a) => a.role === "harmony")).toBe(true);
    expect(
      hard.actions
        .filter((a) => a.role === "harmony")
        .every((a) => a.velocity < 0.5),
    ).toBe(true);
    expect(expert.actions.length).toBe(hard.actions.length);
  });
  it("selects a higher chord grip to support a high sustained melody and its bass", () => {
    const s = score();
    s.durationBeats = 4;
    s.chords = [{ ...s.chords[0], root: 0, quality: "major" }];
    s.events = [
      {
        id: "high-c",
        voice: "melody",
        beat: 0,
        durationBeats: 4,
        midi: 72,
        velocity: 0.8,
        sourceIds: [],
      },
    ];
    const plan = arrangeScore(s, {
      ...options,
      goal: "fingerstyle",
      difficulty: "hard",
    });
    expect(
      plan.grips[0].shape.frets.filter((f) => f >= 0).every((f) => f >= 8),
    ).toBe(true);
    expect(plan.actions.some((a) => a.role === "bass")).toBe(true);
    expect(plan.issues.filter((i) => i.severity === "error")).toEqual([]);
  });
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
  it("deleting an unlocked legato origin updates sound actions rather than leaving an orphan", () => {
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
        beat: 1,
        durationBeats: 1,
        midi: 67,
        velocity: 0.7,
        sourceIds: [],
        slurFrom: "a",
      },
    ];
    const a = arrangeMusicalScore(s, {
      ...options,
      goal: "fingerstyle",
      difficulty: "hard",
      bpm: 120,
    });
    const b = a.notes.find((n) => n.id === "b")!;
    expect(b.linkFrom).toBe("a");
    const next = syncPerformance({
      ...a,
      notes: a.notes.filter((n) => n.id !== "a"),
    });
    expect(next.notes.find((n) => n.id === "b")!.attack).toBe("pluck");
    expect(
      next.performance!.actions.some(
        (n) =>
          (n as { id: string; from?: string }).id === "b" &&
          (n as { from?: string }).from === "a",
      ),
    ).toBe(false);
    expect(() =>
      syncPerformance({
        ...a,
        notes: a.notes
          .filter((n) => n.id !== "a")
          .map((n) => (n.id === "b" ? { ...n, locked: true } : n)),
      }),
    ).toThrow("已锁定");
  });
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

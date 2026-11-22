/** Minimal SDK v2 proof package. A keyboard action has hands and keys, never guitar frets. */
import type {
  InstrumentPluginV2,
  MusicalScore,
  PerformancePlan,
  PerformanceIssue,
  NoteEvent,
} from "../../packages/contracts";
import {
  beatToSeconds,
  secondsToBeat,
  soundingEvents,
} from "../../packages/contracts";
export interface PianoAction {
  id: string;
  beat: number;
  durationBeats: number;
  midi: number;
  hand: "left" | "right";
  finger: number;
  velocity: number;
  kind: "key" | "pedal-down" | "pedal-up";
}
export interface PianoOptions {
  difficulty: "easy" | "normal" | "hard" | "expert";
  split: number;
  maxSpan: number;
}
export function validatePerformance(
  plan: PerformancePlan<PianoAction>,
  options: PianoOptions,
): PerformanceIssue[] {
  const issues: PerformanceIssue[] = [];
  for (const a of plan.actions.filter((a) => a.kind === "key")) {
    const active = plan.actions.filter(
      (b) =>
        b.kind === "key" &&
        b.hand === a.hand &&
        b.beat <= a.beat &&
        b.beat + b.durationBeats > a.beat,
    );
    const pitches = active.map((b) => b.midi);
    if (
      active.length > 5 ||
      new Set(active.map((n) => n.finger)).size < active.length ||
      Math.max(...pitches) - Math.min(...pitches) > options.maxSpan
    )
      issues.push({
        code: "keyboard-hand",
        severity: "error",
        eventIds: active.map((n) => n.id),
        message: "同一只手的指法或跨度超出设置",
      });
    if (a.midi < 21 || a.midi > 108 || a.finger < 1 || a.finger > 5)
      issues.push({
        code: "keyboard-range",
        severity: "error",
        eventIds: [a.id],
        message: "琴键或指法无效",
      });
  }
  return issues;
}
export function arrangeScore(
  score: MusicalScore,
  options: PianoOptions,
): PerformancePlan<PianoAction> {
  const actions: PianoAction[] = [];
  for (const n of soundingEvents(score)) {
    const beat = secondsToBeat(score, n.start),
      hand = n.pitch.midi < options.split ? "left" : "right";
    const held = actions.filter(
      (a) =>
        a.kind === "key" && a.hand === hand && a.beat + a.durationBeats > beat,
    );
    const available = [1, 2, 3, 4, 5].filter(
      (f) => !held.some((a) => a.finger === f),
    );
    actions.push({
      id: n.id,
      beat,
      durationBeats: secondsToBeat(score, n.start + n.duration) - beat,
      midi: n.pitch.midi,
      hand,
      finger: available[0] ?? 1,
      velocity: n.velocity,
      kind: "key",
    });
  }
  const plan: PerformancePlan<PianoAction> = {
    instrumentId: "piano",
    version: 2,
    goal: "melody",
    difficulty: options.difficulty,
    actions,
    issues: [],
  };
  plan.issues = validatePerformance(plan, options);
  return plan;
}
export function soundEvents(
  plan: PerformancePlan<PianoAction>,
  score: MusicalScore,
): NoteEvent[] {
  return plan.actions
    .filter((a) => a.kind === "key")
    .map((a) => ({
      id: a.id,
      start: beatToSeconds(score, a.beat),
      duration:
        beatToSeconds(score, a.beat + a.durationBeats) -
        beatToSeconds(score, a.beat),
      pitch: { midi: a.midi },
      velocity: a.velocity,
      score: 1,
      source: "generated",
    }));
}
export default {
  id: "piano",
  arrangeScore,
  validatePerformance,
  soundEvents,
  notation: (plan) => plan.actions,
  editor: {
    fields: [
      { key: "split", label: "左右手分界音", kind: "number" },
      { key: "maxSpan", label: "单手最大跨度（半音）", kind: "number" },
    ],
  },
} satisfies InstrumentPluginV2<PianoOptions, PianoAction, PianoAction[]>;

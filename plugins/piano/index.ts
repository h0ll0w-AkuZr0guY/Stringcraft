import type {
  InstrumentPluginV2,
  MusicalScore,
  PerformancePlan,
  PerformanceIssue,
} from "../../packages/contracts";
import {
  beatToSeconds,
  secondsToBeat,
  soundingEvents,
  eventRole,
} from "../../packages/contracts";
import type { PianoAction, PianoHand } from "../../packages/contracts/piano";
export type { PianoAction } from "../../packages/contracts/piano";

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
  const held = { left: [] as PianoAction[], right: [] as PianoAction[] };
  for (const a of [...plan.actions].sort((a, b) => a.beat - b.beat)) {
    if (
      a.hand === "unassigned" ||
      a.finger === 0 ||
      a.midi < 21 ||
      a.midi > 108
    ) {
      issues.push({
        code: "keyboard-unassigned",
        severity: "warning",
        eventIds: [a.id],
        message: "此音保留在谱面，手别或指法待核对。",
      });
      if (a.hand === "unassigned" || a.finger === 0) continue;
    }
    const active = held[a.hand].filter(
      (b) => b.beat + b.durationBeats > a.beat + 0.000001,
    );
    const pitches = [a.midi, ...active.map((n) => n.midi)];
    if (
      active.length >= 5 ||
      active.some((n) => n.finger === a.finger) ||
      Math.max(...pitches) - Math.min(...pitches) > options.maxSpan
    )
      issues.push({
        code: "keyboard-hand",
        severity: "error",
        eventIds: [a.id, ...active.map((n) => n.id)],
        message: "同一只手的指法或跨度超出设置",
      });
    held[a.hand] = [...active, a];
  }
  return issues;
}
export function arrangeScore(
  score: MusicalScore,
  options: PianoOptions,
): PerformancePlan<PianoAction> {
  const held = { left: [] as PianoAction[], right: [] as PianoAction[] };
  const previous: Partial<Record<"left" | "right", PianoAction>> = {};
  const events = new Map(score.events.map((e) => [e.id, e]));
  const staffCount = score.events.some((e) => /\/staff-2\//.test(e.voice));
  const actions: PianoAction[] = [];
  for (const n of soundingEvents(score).sort(
    (a, b) => a.start - b.start || a.pitch.midi - b.pitch.midi,
  )) {
    const event = events.get(n.id)!;
    const beat = secondsToBeat(score, n.start),
      midi = n.pitch.midi;
    const written = event.voice.match(/^part-\d+\/staff-(\d+)\//)?.[1];
    const authoredHand: Exclude<PianoHand, "unassigned"> | undefined =
      staffCount && written ? (written === "1" ? "right" : "left") : undefined;
    const preferred =
      midi < options.split || eventRole(event) === "bass" ? "left" : "right";
    const choices: { hand: "left" | "right"; finger: number; cost: number }[] =
      [];
    for (const hand of authoredHand
      ? [authoredHand]
      : (["left", "right"] as const)) {
      held[hand] = held[hand].filter(
        (e) => e.beat + e.durationBeats > beat + 0.000001,
      );
      const current = held[hand],
        last = previous[hand];
      const pitches = [midi, ...current.map((e) => e.midi)];
      if (
        midi < 21 ||
        midi > 108 ||
        Math.max(...pitches) - Math.min(...pitches) > options.maxSpan
      )
        continue;
      for (let finger = 1; finger <= 5; finger++) {
        if (
          current.some(
            (e) =>
              e.finger === finger ||
              e.midi === midi ||
              Math.sign(finger - e.finger) !==
                Math.sign(midi - e.midi) * (hand === "left" ? -1 : 1),
          )
        )
          continue;
        const base = hand === "left" ? 5 : 1;
        const travel = last
          ? Math.abs(midi - last.midi) * 0.05 +
            Math.abs(finger - last.finger) * 0.07
          : 0;
        choices.push({
          hand,
          finger,
          cost:
            (hand === preferred ? 0 : 1.4) +
            travel +
            Math.abs(finger - base) * 0.12,
        });
      }
    }
    const choice = choices.sort((a, b) => a.cost - b.cost)[0];
    const action: PianoAction = {
      id: n.id,
      kind: "key",
      beat,
      durationBeats: secondsToBeat(score, n.start + n.duration) - beat,
      midi,
      hand: choice?.hand ?? authoredHand ?? "unassigned",
      finger: choice?.finger ?? 0,
      velocity: n.velocity,
    };
    actions.push(action);
    if (choice) {
      held[choice.hand].push(action);
      previous[choice.hand] = action;
    }
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
) {
  const written = new Map(soundingEvents(score).map((n) => [n.id, n]));
  return plan.actions.map((a) => {
    const start = beatToSeconds(score, a.beat);
    return {
      ...written.get(a.id)!,
      start,
      duration: beatToSeconds(score, a.beat + a.durationBeats) - start,
    };
  });
}
export default {
  id: "piano",
  arrangeScore,
  validatePerformance,
  soundEvents,
  notation: (plan) => plan.actions,
  editor: {
    fields: [
      { key: "split", label: "左右手参考分界音", kind: "number" },
      { key: "maxSpan", label: "单手最大跨度", kind: "number" },
    ],
  },
} satisfies InstrumentPluginV2<PianoOptions, PianoAction, PianoAction[]>;

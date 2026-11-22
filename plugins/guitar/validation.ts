import type {
  PerformancePlan,
  PerformanceIssue,
} from "../../packages/contracts";
import { limits, type GuitarAction, type GuitarOptions } from "./types";
import { assignFingers, validFingerState } from "./hands";

export function validatePerformance(
  plan: PerformancePlan<GuitarAction>,
  options: GuitarOptions,
): PerformanceIssue[] {
  const issues: PerformanceIssue[] = [],
    limit = limits[options.difficulty];
  const add = (code: string, events: GuitarAction[], message: string) =>
    issues.push({
      code,
      severity: "error",
      eventIds: events.map((e) => e.id),
      message,
    });
  for (const a of plan.actions) {
    if (
      !Number.isInteger(a.string) ||
      a.string < 1 ||
      a.string > 6 ||
      !Number.isInteger(a.fret) ||
      a.fret < 0 ||
      a.fret > limit.fret ||
      a.fret + options.capo > 24 ||
      !Number.isFinite(a.beat) ||
      a.beat < 0 ||
      !Number.isFinite(a.durationBeats) ||
      a.durationBeats <= 0
    ) {
      add("position", [a], "弦位、品位或时长无效");
      continue;
    }
    const active = plan.actions.filter(
      (b) =>
        b.beat <= a.beat + 0.000001 &&
        b.beat + b.durationBeats > a.beat + 0.000001,
    );
    if (new Set(active.map((b) => b.string)).size < active.length)
      add("string-occupancy", active, "同弦持续音冲突");
    const frets = active.filter((b) => b.fret > 0).map((b) => b.fret);
    if (frets.length && Math.max(...frets) - Math.min(...frets) > limit.span)
      add("span", active, "按弦跨度超出限制");
    if (!assignFingers(active))
      add("fingers", active, "按弦需要超过四指，或横按压住了开放弦");
    if (
      active.every((a) => a.fret === 0 || a.finger > 0) &&
      !validFingerState(active)
    )
      add(
        "finger-hold",
        active,
        "持续音使用同一手指按在不同品位，或横按与开放弦冲突",
      );
    if (a.kind === "hammer" || a.kind === "pull" || a.kind === "slide") {
      const previous = plan.actions.find((b) => b.id === a.from);
      if (
        !previous ||
        previous.kind === "dead" ||
        previous.string !== a.string ||
        Math.abs(previous.beat + previous.durationBeats - a.beat) > 0.002 ||
        previous.fret === a.fret ||
        (a.kind === "hammer" && previous.fret >= a.fret) ||
        (a.kind === "pull" && previous.fret <= a.fret)
      )
        add("legato", [a], "连奏必须连接同弦相邻动作并符合方向");
    }
    if (a.kind === "pluck" || a.kind === "dead") {
      const simultaneous = plan.actions.filter(
        (b) =>
          (b.kind === "pluck" || b.kind === "dead") &&
          Math.abs(b.beat - a.beat) < 0.035,
      );
      if (
        simultaneous.some(
          (b) => b.id !== a.id && b.rightFinger === a.rightFinger,
        )
      )
        add(
          "right-hand",
          simultaneous,
          "同一右手手指不能同时拨两根弦；请明确扫弦或拆开动作",
        );
    }
  }
  return issues.filter(
    (x, i, all) =>
      all.findIndex(
        (y) => y.code === x.code && y.eventIds.join() === x.eventIds.join(),
      ) === i,
  );
}

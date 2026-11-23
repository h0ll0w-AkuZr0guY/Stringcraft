import type { GuitarAction } from "./types";

/** Assign at most four physical fingers; a barre may not press through an open/lower note. */
export function assignFingers(
  notes: Pick<GuitarAction, "string" | "fret">[],
): number[] | null {
  const fingers = notes.map(() => 0);
  const fretted = notes
    .map((n, i) => ({ ...n, i }))
    .filter((n) => n.fret > 0)
    .sort((a, b) => a.fret - b.fret || a.string - b.string);
  if (!fretted.length) return fingers;
  if (fretted.length <= 4) {
    fretted.forEach((n, i) => (fingers[n.i] = i + 1));
    return fingers;
  }
  const lowest = fretted.filter((n) => n.fret === fretted[0].fret);
  const first = Math.min(...lowest.map((n) => n.string)),
    last = Math.max(...lowest.map((n) => n.string));
  if (
    notes.some(
      (n) => n.string >= first && n.string <= last && n.fret < lowest[0].fret,
    )
  )
    return null;
  const rest = fretted.filter((n) => n.fret !== lowest[0].fret);
  if (rest.length > 3) return null;
  lowest.forEach((n) => (fingers[n.i] = 1));
  rest.forEach((n, i) => (fingers[n.i] = i + 2));
  return fingers;
}
export const rightFinger = (string: number): GuitarAction["rightFinger"] =>
  string >= 4 ? "p" : string === 3 ? "i" : string === 2 ? "m" : "a";
export function validFingerState(active: GuitarAction[]): boolean {
  const fretted = active.filter((a) => a.fret > 0);
  if (
    fretted.some(
      (a) => !Number.isInteger(a.finger) || a.finger < 1 || a.finger > 4,
    )
  )
    return false;
  for (let finger = 1; finger <= 4; finger++) {
    const group = fretted.filter((a) => a.finger === finger);
    if (new Set(group.map((a) => a.fret)).size > 1) return false;
    if (group.length > 1) {
      const low = Math.min(...group.map((a) => a.string)),
        high = Math.max(...group.map((a) => a.string));
      if (
        finger !== 1 ||
        active.some(
          (a) => a.string >= low && a.string <= high && a.fret < group[0].fret,
        )
      )
        return false;
    }
  }
  return true;
}
export function assignNewActions(actions: GuitarAction[]): GuitarAction[] {
  const kept: GuitarAction[] = [];
  // Solve protected melody first. Bass uses a free finger throughout its entire hold.
  for (const action of [...actions].sort(
    (a, b) =>
      (a.role === "melody" ? 0 : 1) - (b.role === "melody" ? 0 : 1) ||
      a.beat - b.beat,
  )) {
    const held = kept.filter(
      (a) =>
        a.beat + a.durationBeats > action.beat + 0.000001 &&
        a.beat < action.beat + action.durationBeats - 0.000001,
    );
    if (action.fret === 0) {
      action.finger = 0;
      kept.push(action);
      continue;
    }
    const fingers = [1, 2, 3, 4].sort(
      (a, b) =>
        Math.abs(a - Math.min(4, Math.max(1, action.fret))) -
        Math.abs(b - Math.min(4, Math.max(1, action.fret))),
    );
    const assigned = fingers.find((f) => {
      action.finger = f;
      return [
        action.beat,
        ...held
          .map((n) => n.beat)
          .filter(
            (b) => b > action.beat && b < action.beat + action.durationBeats,
          ),
      ].every((beat) =>
        validFingerState([
          ...held.filter(
            (n) =>
              n.beat <= beat + 0.000001 &&
              n.beat + n.durationBeats > beat + 0.000001,
          ),
          action,
        ]),
      );
    });
    if (assigned) {
      action.finger = assigned;
      kept.push(action);
    }
  }
  return kept.sort((a, b) => a.beat - b.beat);
}

export function terminateStrings(actions: GuitarAction[]) {
  actions.sort((a, b) => a.beat - b.beat || b.string - a.string);
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i],
      next = actions.slice(i + 1).find((b) => b.string === a.string);
    if (next && a.beat + a.durationBeats > next.beat)
      a.durationBeats = Math.max(0.001, next.beat - a.beat);
  }
}
export function assignRightHand(actions: GuitarAction[]) {
  const plucks = actions
      .filter((a) => a.kind === "pluck" || a.kind === "dead")
      .sort((a, b) => a.beat - b.beat),
    groups: GuitarAction[][] = [];
  for (const a of plucks) {
    if (!groups.length || a.beat - groups.at(-1)![0].beat > 0.035)
      groups.push([]);
    groups.at(-1)!.push(a);
  }
  for (const group of groups) {
    if (group.length === 1) {
      group[0].rightFinger = rightFinger(group[0].string);
      continue;
    }
    const ordered = [...group].sort((a, b) => b.string - a.string),
      used = new Set<string>();
    for (const [index, a] of ordered.entries()) {
      const preferred =
        index === 0 && a.string >= 4 ? "p" : rightFinger(a.string);
      const available = ([preferred, "i", "m", "a", "p"] as const).find(
        (f) => !used.has(f),
      );
      if (available) {
        a.rightFinger = available;
        used.add(available);
      }
    }
  }
}

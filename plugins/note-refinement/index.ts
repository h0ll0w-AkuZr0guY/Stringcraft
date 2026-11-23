import type { NoteEvent } from "../../packages/contracts";
import profile from "./preferences.json";
export const experimentalGuitarParameters: RefinementParameters =
  profile.parameters;
export interface RefinementParameters {
  activationCeiling: number;
  relativeFloor: number;
  minimumDuration: number;
}
export const identityParameters: RefinementParameters = {
  activationCeiling: 0,
  relativeFloor: 0,
  minimumDuration: 0,
};
/** Keep raw detections separately. This only selects existing IDs and never invents a note. */
export function refineNotes(
  input: NoteEvent[],
  parameters: RefinementParameters = identityParameters,
) {
  if (
    Object.values(parameters).some((n) => !Number.isFinite(n) || n < 0) ||
    parameters.activationCeiling > 1 ||
    parameters.relativeFloor > 1 ||
    parameters.minimumDuration > 0.25
  )
    throw new Error("候选清理参数无效");
  const scores = input.map((n) => n.score).sort((a, b) => a - b);
  const quantile = scores[Math.floor((scores.length - 1) * 0.75)] ?? 0;
  const floor = Math.min(
    parameters.activationCeiling,
    quantile * parameters.relativeFloor,
  );
  const dropped = input
    .filter(
      (n) =>
        !n.locked &&
        (n.score < floor || n.duration < parameters.minimumDuration),
    )
    .map((n) => ({
      noteId: n.id,
      reason:
        n.score < floor
          ? "相对激活值低于当前清理设置"
          : "持续时间短于当前清理设置",
    }));
  const ids = new Set(dropped.map((n) => n.noteId));
  return {
    notes: input.filter((n) => !ids.has(n.id)),
    dropped,
    parameters,
    floor,
  };
}
export default { refineNotes };

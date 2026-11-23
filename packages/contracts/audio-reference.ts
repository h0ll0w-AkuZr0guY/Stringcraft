export interface AudioReference {
  sha256: string;
  durationSeconds: number;
  offsetSeconds: number;
  /** Only the verified analysis input is called original. Other files are references. */
  kind: "original" | "reference";
}
export function validateAudioReference(project: {
  sourceAudioSha256?: string;
  audioReference?: AudioReference;
  duration: number;
}) {
  const digest = (value: string) =>
    typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
  if (
    project.sourceAudioSha256 !== undefined &&
    !digest(project.sourceAudioSha256)
  )
    throw new Error("源录音摘要无效");
  const ref = project.audioReference;
  if (!ref) return;
  if (
    !digest(ref.sha256) ||
    !["original", "reference"].includes(ref.kind) ||
    !Number.isFinite(ref.durationSeconds) ||
    ref.durationSeconds <= 0 ||
    !Number.isFinite(ref.offsetSeconds) ||
    ref.offsetSeconds < 0 ||
    ref.offsetSeconds + project.duration > ref.durationSeconds + 0.05
  )
    throw new Error("关联录音不能覆盖项目片段，请检查文件与对照起点");
  if (
    ref.kind === "original" &&
    ref.sha256.toLowerCase() !== project.sourceAudioSha256?.toLowerCase()
  )
    throw new Error("关联文件未经源录音摘要核验，不能标为原文件");
}

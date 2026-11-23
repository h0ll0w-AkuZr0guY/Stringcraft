import type { ChordSymbol } from "./score";
export interface ModelExecution {
  name: string;
  version: string;
  device: string;
  provider: string;
  weightsSha256?: string;
}
export interface HarmonySegment {
  id: string;
  start: number;
  end: number;
  root: number | null;
  quality: ChordSymbol["quality"] | null;
  status: "supported" | "candidate" | "none";
  evidence: number;
  alternatives: {
    root: number;
    quality: ChordSymbol["quality"];
    score: number;
  }[];
}
export interface HarmonyAnalysis {
  version: 1;
  method: string;
  duration: number;
  frameHop: number;
  sourceAudioSha256?: string;
  segments: HarmonySegment[];
  executions: ModelExecution[];
  warnings: string[];
}
export interface LocalAnalysisRun {
  jobId: string;
  cacheKey: string;
  cacheHit: boolean;
  executions: ModelExecution[];
  warnings: string[];
}
function validateExecutions(executions: ModelExecution[], warnings: string[]) {
  if (
    !Array.isArray(executions) ||
    executions.length > 20 ||
    !Array.isArray(warnings) ||
    warnings.length > 128 ||
    warnings.some((w) => typeof w !== "string" || w.length > 2000)
  )
    throw new Error("模型分析记录无效");
  for (const e of executions)
    if (
      !e ||
      ![e.name, e.version, e.device, e.provider].every(
        (v) => typeof v === "string" && v.length > 0 && v.length <= 512,
      ) ||
      (e.weightsSha256 !== undefined && !/^[a-f0-9]{64}$/.test(e.weightsSha256))
    )
      throw new Error("模型执行记录无效");
}
export function validateLocalAnalysis(run: LocalAnalysisRun) {
  if (
    !run ||
    typeof run.jobId !== "string" ||
    !/^[a-f0-9]{32}$/.test(run.jobId) ||
    typeof run.cacheKey !== "string" ||
    !/^[a-f0-9]{64}$/.test(run.cacheKey) ||
    typeof run.cacheHit !== "boolean"
  )
    throw new Error("本地任务记录无效");
  validateExecutions(run.executions, run.warnings);
}
export function validateHarmony(a: HarmonyAnalysis, duration: number) {
  if (
    !a ||
    a.version !== 1 ||
    typeof a.method !== "string" ||
    !Number.isFinite(a.duration) ||
    a.duration <= 0 ||
    Math.abs(a.duration - duration) > 0.05 ||
    !Number.isFinite(a.frameHop) ||
    a.frameHop <= 0 ||
    !Array.isArray(a.segments) ||
    a.segments.length > 50000 ||
    !Array.isArray(a.executions) ||
    !Array.isArray(a.warnings) ||
    a.warnings.some((w) => typeof w !== "string")
  )
    throw new Error("和声时间轴无效");
  if (
    a.sourceAudioSha256 !== undefined &&
    !/^[a-f0-9]{64}$/.test(a.sourceAudioSha256)
  )
    throw new Error("和声输入摘要无效");
  validateExecutions(a.executions, a.warnings);
  const ids = new Set<string>();
  let previous = 0;
  for (const s of a.segments) {
    if (
      !s ||
      typeof s.id !== "string" ||
      !s.id ||
      ids.has(s.id) ||
      ![s.start, s.end, s.evidence].every(Number.isFinite) ||
      s.start < previous - 0.001 ||
      s.end <= s.start ||
      s.end > duration + 0.05 ||
      s.evidence < 0 ||
      s.evidence > 1 ||
      !["supported", "candidate", "none"].includes(s.status) ||
      !Array.isArray(s.alternatives) ||
      s.alternatives.length > 5
    )
      throw new Error("和声区间无效");
    if (
      s.status === "none"
        ? s.root !== null || s.quality !== null
        : !Number.isInteger(s.root) ||
          s.root! < 0 ||
          s.root! > 11 ||
          !["major", "minor", "7", "maj7", "m7", "sus4"].includes(s.quality!)
    )
      throw new Error("和弦候选无效");
    for (const c of s.alternatives)
      if (
        !Number.isInteger(c.root) ||
        c.root < 0 ||
        c.root > 11 ||
        !["major", "minor", "7", "maj7", "m7", "sus4"].includes(c.quality) ||
        !Number.isFinite(c.score)
      )
        throw new Error("备选和弦无效");
    ids.add(s.id);
    previous = s.end;
  }
}

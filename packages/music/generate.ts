import { projectHarmony } from "./harmony";
import {
  validateProject,
  soundingEvents,
  type MusicProject,
  type ArrangeOptions,
  type NoteEvent,
  type MusicalScore,
  type Arrangement,
  type HarmonyAnalysis,
} from "../contracts";
import { catalog, installed, invoke, load, install } from "../plugin-host";
import { filteredNotes } from "./note-edits";
import { projectScore } from "./score";
import type { AISettings } from "./advisor";

export type GenerationPhase =
  | "检查输入与插件"
  | "提取旋律"
  | "分析和弦"
  | "寻找可用指型"
  | "等待可选 AI 建议"
  | "生成谱面"
  | "校验并保存谱面";
export type Recovery = "plugins" | "structure" | "upgrade" | "retry";
export interface PluginProblem {
  id: string;
  name: string;
  reason: "missing" | "disabled" | "update";
}
export class GenerationError extends Error {
  constructor(
    message: string,
    public recovery: Recovery = "retry",
    public problems: PluginProblem[] = [],
  ) {
    super(message);
  }
}
export async function generationPlugins(): Promise<PluginProblem[]> {
  const list = await catalog();
  const result: PluginProblem[] = [];
  for (const id of [
    "melody-tracker",
    "harmony-analysis",
    "guitar-standard",
    "standard-exporters",
  ]) {
    const expected = list.find((m) => m.id === id);
    if (!expected)
      throw new Error("本地包缺少必要的插件目录，请重新解压完整包。");
    const actual = await installed(id);
    const reason = !actual?.code
      ? "missing"
      : !actual.enabled
        ? "disabled"
        : actual.manifest.sha256 !== expected.sha256
          ? "update"
          : null;
    if (reason) result.push({ id, name: expected.name, reason });
  }
  return result;
}
/** Only called by the user's explicit repair action; disabled plugins stay disabled otherwise. */
export async function repairGenerationPlugins(problems: PluginProblem[]) {
  const list = await catalog();
  for (const p of problems) await install(list.find((m) => m.id === p.id)!);
}
export async function runGeneration(
  project: MusicProject,
  options: ArrangeOptions & { autoCapo: boolean; useAI: boolean },
  ai: AISettings,
  signal: AbortSignal,
  phase: (phase: GenerationPhase) => void,
) {
  const mark = (value: GenerationPhase) => {
    signal.throwIfAborted();
    phase(value);
  };
  mark("检查输入与插件");
  const problems = await generationPlugins();
  signal.throwIfAborted();
  if (problems.length)
    throw new GenerationError(
      "生成所需插件需要处理，请使用下方按钮修复后重试。",
      "plugins",
      problems,
    );
  if (!project.notes.length)
    throw new GenerationError("请先导入或识别音乐，再生成编配。");
  if (project.schemaVersion === 1 && options.goal !== "melody")
    throw new GenerationError(
      "旧项目需要创建 v2 副本后使用和弦伴奏或指弹，原项目会保留。",
      "upgrade",
    );
  const musicalInput = project.noteEditor
    ? filteredNotes(project)
    : (project.refinement?.notes ?? project.notes);
  mark("提取旋律");
  const melody = project.score
    ? soundingEvents(project.score).filter((n) => n.role === "melody")
    : project.melody.length
      ? project.melody
      : await invoke<NoteEvent[]>(
          "melody-tracker",
          "extractMelody",
          [musicalInput],
          signal,
        );
  const base = projectScore({ ...project, melody });
  mark("分析和弦");
  const harmonyAnalysis =
    (project.harmonyAnalysis?.method.startsWith("note-seconds")
      ? undefined
      : project.harmonyAnalysis) ??
    (project.sourceKind === "audio"
      ? await invoke<HarmonyAnalysis>(
          "harmony-analysis",
          "analyzeTimeline",
          [musicalInput, project.duration],
          signal,
        )
      : undefined);
  const score = harmonyAnalysis ? projectHarmony(harmonyAnalysis, base) : base;
  if (options.goal === "accompaniment" && !score.chords.length)
    throw new GenerationError(
      "没有找到可用和弦。请补充和弦，或选择单线旋律练习；已有谱面已保留。",
      "structure",
    );
  mark("寻找可用指型");
  const candidates = (
    await invoke<{ capo: number; score: number }[]>(
      "guitar-standard",
      "recommendCapos",
      [melody, { ...options, score }],
      signal,
    )
  ).slice(0, 5);
  if (!candidates.length)
    throw new GenerationError(
      "当前设置没有可用指型。请检查和弦、难度、移调或锁定音符；已有谱面已保留。",
      "structure",
    );
  let capo = options.autoCapo ? candidates[0].capo : options.capo;
  let advice = "";
  if (options.useAI && options.autoCapo) {
    mark("等待可选 AI 建议");
    try {
      if (!(await installed("bailian-advisor")))
        await install(
          (await catalog()).find((m) => m.id === "bailian-advisor")!,
        );
      signal.throwIfAborted();
      const plugin = await load("bailian-advisor");
      const answer = await plugin.advise!(
        ai,
        candidates,
        { notes: melody.length, difficulty: options.difficulty },
        signal,
      );
      signal.throwIfAborted();
      if (!candidates.some((c) => c.capo === answer.capo))
        throw new Error("候选校验失败");
      capo = answer.capo;
      advice = `AI 已选择 Capo ${capo}，请试听核对。`;
    } catch {
      signal.throwIfAborted();
      advice = "AI 建议暂不可用，已使用本地指型候选。";
    }
  }
  mark("生成谱面");
  const arrangement = await invoke<Arrangement>(
    "guitar-standard",
    "arrange",
    [melody, { ...options, capo, score, previous: project.arrangement?.notes }],
    signal,
  );
  if (!arrangement.notes.length)
    throw new GenerationError(
      "这次没有生成可弹奏音符。请检查和弦、节奏与锁定设置；已有谱面已保留。",
      "structure",
    );
  mark("校验并保存谱面");
  const pluginVersions = { ...project.pluginVersions };
  for (const id of [
    "guitar-standard",
    "melody-tracker",
    "harmony-analysis",
    "standard-exporters",
  ])
    pluginVersions[id] = (await installed(id))!.manifest.version;
  signal.throwIfAborted();
  const next = {
    ...project,
    harmonyAnalysis,
    score,
    melody,
    arrangement,
    pluginVersions,
  };
  validateProject(next);
  return { project: next, capo, advice };
}

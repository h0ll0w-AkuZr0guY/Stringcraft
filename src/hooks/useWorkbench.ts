import { loadInstrument } from "../../packages/plugin-host";
import type { PianoAction } from "../../packages/contracts/piano";
import type { PianoOptions } from "../../plugins/piano";
import { pianoMusicXml } from "../../plugins/piano/musicxml";
import { pagesEdition } from "../edition";
import { initialAI } from "../preferences";
import { savedAudioAsset } from "../../packages/music/local";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  validateProject,
  type ArrangementGoal,
  type Difficulty,
  type GuitarNote,
  type HarmonyAnalysis,
  type MusicProject,
  type NoteEditorState,
  type NoteEvent,
  type NoteOverride,
  type TimingAnalysis,
  type TimingCandidate,
} from "../../packages/contracts";
import { decode, decodeWhole, transcribe } from "../../packages/music/analyze";
import { arrangementRevision } from "../../packages/music/arrangement-revision";
import { demoProject } from "../../packages/music/demo";
import {
  GenerationError,
  repairGenerationPlugins,
  runGeneration,
} from "../../packages/music/generate";
import { projectHarmony } from "../../packages/music/harmony";
import {
  repairWorkbenchComponents,
  workbenchComponentProblems,
} from "../../packages/music/maintenance";
import { readAudioFile, referenceWaveform } from "../../packages/music/media";
import { filteredNotes } from "../../packages/music/note-edits";
import { trackPlayback } from "../../packages/music/track-playback";
import {
  changeTrackEditor,
  commitTrackNotes,
  editorTrackProject,
  projectTracks,
} from "../../packages/music/tracks";
import { Transport } from "../../packages/music/transport";
import {
  bootstrap,
  catalog,
  install,
  installed,
  invoke,
  load,
  loadRefiner,
} from "../../packages/plugin-host";
import type { GenerationTask } from "./generation-state";

import { get, set } from "idb-keyval";
import { type AISettings } from "../../packages/music/advisor";
import { importMidi, importMusicXML } from "../../packages/music/import";
import {
  analyzeLocal,
  analyzeSavedTrack,
  exportAudioProject,
  importAudioProject,
  localAsset,
  localCapabilities,
  pinAudioAssets,
} from "../../packages/music/local";
import {
  projectScore,
  upgradeProject,
  withReferenceTempo,
} from "../../packages/music/score";
import {
  audioAssetKey,
  audioAssetPrefix,
  listProjects,
  saveProject,
} from "../../packages/storage";
import { violations } from "../../plugins/guitar";
import { syncPerformance } from "../../plugins/guitar/performance";
import {
  experimentalGuitarParameters,
  type RefinementParameters,
} from "../../plugins/note-refinement";

const labels: Record<Difficulty, string> = {
  easy: "初学",
  normal: "日常",
  hard: "进阶",
  expert: "挑战",
};
function download(data: BlobPart, mime: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : "操作未完成";
}

export function useWorkbench() {
  const [page, setPage] = useState<
      "workbench" | "projects" | "plugins" | "practice"
    >("workbench"),
    [project, setProject] = useState<MusicProject>(demoProject),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState(""),
    [saved, setSaved] = useState("原创示例 · 尚未修改"),
    [dirty, setDirty] = useState(false),
    [projects, setProjects] = useState<MusicProject[]>([]);
  const [generation, setGeneration] = useState<GenerationTask | null>(null);
  const generationLock = useRef(false);
  const [advanced, setAdvanced] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeTrackId, setActiveTrackId] = useState("legacy");
  const [mutedTracks, setMutedTracks] = useState<Set<string>>(new Set());
  const [soloTrackId, setSoloTrackId] = useState<string | null>(null);
  const [trackVolumes, setTrackVolumes] = useState<Record<string, number>>({});
  const [monitorMode, setMonitorMode] = useState<"audio" | "notes" | "mix">(
    "audio",
  );
  const [mixTrackIds, setMixTrackIds] = useState<Set<string>>(
    new Set(["instrumental"]),
  );
  const audibleTrackIds = useRef<string[]>([]);
  const previewContext = useRef<AudioContext | null>(null);
  const previewRevision = useRef(0);
  const [pluginCount, setPluginCount] = useState<number | null>(null);
  const [mode, setMode] = useState<"editor" | "guitar" | "piano">(() =>
    new URLSearchParams(location.search).get("view") === "guitar"
      ? "guitar"
      : "editor",
  );
  const [difficulty, setDifficulty] = useState<Difficulty>("normal"),
    [goal, setGoal] = useState<ArrangementGoal>("accompaniment"),
    [profile, setProfile] =
      useState<import("../../packages/contracts").ArrangementProfile>(
        "classic",
      ),
    [pattern, setPattern] = useState<"strum" | "arpeggio" | "auto">("auto"),
    [capo, setCapo] = useState(0),
    [autoCapo, setAutoCapo] = useState(true),
    [transpose, setTranspose] = useState(0),
    [tone, setTone] = useState("steel"),
    [view, setView] = useState<"tab" | "rhythm" | "text">("tab");
  const [file, setFile] = useState<File | null>(null),
    [refineGuitar, setRefineGuitar] = useState(false),
    [sourceUrl, setSourceUrl] = useState(""),
    [wave, setWave] = useState<number[]>([]),
    [start, setStart] = useState(0),
    [length, setLength] = useState(30),
    [busy, setBusy] = useState(""),
    [progress, setProgress] = useState(0),
    [selected, setSelected] = useState<string | null>(null),
    [textTab, setTextTab] = useState("");
  const [history, setHistory] = useState<MusicProject[]>([]),
    [future, setFuture] = useState<MusicProject[]>([]),
    [speed, setSpeed] = useState(1),
    [loop, setLoop] = useState(false),
    [loopStart, setLoopStart] = useState(0),
    [loopEnd, setLoopEnd] = useState(8);
  const transportRef = useRef<Transport | null>(null);
  if (!transportRef.current) transportRef.current = new Transport();
  const transport = transportRef.current;
  const playbackStatus = useSyncExternalStore(
    transport.subscribe,
    transport.status,
    transport.status,
  );
  const playing = playbackStatus !== "paused";
  useEffect(() => {
    transport.setDuration(project.duration);
  }, [project.duration, transport]);
  useEffect(() => {
    transport.stop();
  }, [project.id, transport]);
  useEffect(() => {
    transport.setSpeed(speed);
  }, [speed, transport]);
  useEffect(() => {
    try {
      transport.setLoop(
        loop
          ? { start: loopStart, end: Math.min(loopEnd, project.duration) }
          : null,
      );
    } catch {
      setLoop(false);
      notify("循环范围无效，请重新设置 A/B。");
    }
  }, [loop, loopStart, loopEnd, project.duration, transport]);
  const [settings, setSettings] = useState(false),
    [ai, setAI] = useState<AISettings>(initialAI),
    [useAI, setUseAI] = useState(false),
    [advice, setAdvice] = useState("");
  const [engineState, setEngineState] = useState<
    import("../../packages/music/local").LocalEngineState | null
  >(null);
  const analysisChoice = useRef(false);
  const chooseAnalysis = (value: string) => {
    analysisChoice.current = true;
    setLocalMode(value);
  };
  const [local, setLocal] = useState(false),
    [localReady, setLocalReady] = useState(false),
    [localMode, setLocalMode] = useState("browser");
  const abortRef = useRef<AbortController | null>(null),
    referenceLoad = useRef<AbortController | null>(null),
    audioRef = useRef<AudioContext | null>(null),
    timerRef = useRef<ReturnType<typeof setInterval> | null>(null),
    sourceBuffer = useRef(new Map<string, AudioBuffer>()),
    inputRef = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    playGeneration = useRef(0);
  const notify = useCallback((s: string) => setMessage(s), []);
  const projectRef = useRef(project);
  projectRef.current = project;
  const commitEdit = (next: MusicProject, synchronize = true) => {
    const current = projectRef.current;
    if (
      synchronize &&
      next.arrangement &&
      next.arrangement !== current.arrangement &&
      next.arrangement.performance
    )
      next = { ...next, arrangement: syncPerformance(next.arrangement) };
    if (next.bpm !== current.bpm && next.score && next.score === current.score)
      next = { ...next, score: withReferenceTempo(next.score, next.bpm) };
    validateProject(next);
    const updated = { ...next, updatedAt: new Date().toISOString() };
    setDirty(true);
    setHistory((h) => [...h.slice(-39), structuredClone(current)]);
    setFuture([]);
    projectRef.current = updated;
    setProject(updated);
  };
  const edit = (next: MusicProject, synchronize = true) => {
    try {
      commitEdit(next, synchronize);
      return true;
    } catch (error) {
      notify(errorMessage(error));
      return false;
    }
  };
  useEffect(() => {
    setGeneration(null);
    setAdvanced(false);
    setInspectorOpen(false);
    setActiveTrackId(
      project.piano && !project.arrangement
        ? "piano-arrangement"
        : (project.tracks?.find((t) => t.role === "instrumental")?.id ??
            "legacy"),
    );
    setSoloTrackId(null);
    setMutedTracks(new Set());
    setTrackVolumes({});
    setMixTrackIds(
      new Set([
        project.tracks?.find((t) => t.role === "instrumental")?.id ?? "legacy",
      ]),
    );
  }, [project.id]);
  const tracks = projectTracks(project);
  const selectedTrackId = tracks.some((t) => t.id === activeTrackId)
    ? activeTrackId
    : (tracks.find((t) => t.role === "instrumental")?.id ?? "legacy");
  const editorProject = editorTrackProject(project, selectedTrackId);
  const notes = project.arrangement?.notes ?? [],
    chosen = notes.find((n) => n.id === selected);
  const stale =
    !!project.arrangement &&
    (project.arrangement.difficulty !== difficulty ||
      project.arrangement.capo !== capo ||
      project.arrangement.transpose !== transpose ||
      project.arrangement.goal !== goal ||
      (project.arrangement.profile ?? "classic") !== profile ||
      project.arrangement.score?.tempo[0].bpm !== project.bpm ||
      (project.arrangementDraft
        ? project.arrangementDraft.inputFingerprint !==
            arrangementRevision(project) ||
          project.arrangementDraft.options.pattern !== pattern
        : !!project.score &&
          JSON.stringify(project.arrangement.score) !==
            JSON.stringify(project.score)));
  function stop() {
    transport.pause();
    referenceLoad.current?.abort();
    referenceLoad.current = null;
    playGeneration.current++;
    neutralStop.current?.();
    neutralStop.current = null;
    void audioRef.current?.close().catch(() => {});
    audioRef.current = null;
    previewRevision.current++;
    void previewContext.current?.close().catch(() => {});
    previewContext.current = null;
    if (stemPlayer.current) {
      stemPlayer.current.pause();
      stemPlayer.current = null;
    }
    if (stemUrl.current) {
      URL.revokeObjectURL(stemUrl.current);
      stemUrl.current = "";
    }
  }
  function seek(at: number) {
    if (loop && (at < loopStart || at >= loopEnd)) setLoop(false);
    transport.seek(at);
  }

  useEffect(() => {
    let active = true;
    bootstrap()
      .then(async (entries) => {
        if (active)
          setPluginCount(entries.filter((m) => m.audience === "user").length);
        const plugin = await load("guitar-standard");
        if (
          (await installed("guitar-standard"))!.manifest.version === "0.1.0"
        ) {
          if (active) {
            setReady(true);
            notify(
              "请在插件中心更新标准吉他、实录音源和标准导出到 0.2，以使用结构化编配。",
            );
          }
          return;
        }
        if (active) {
          // Bootstrap can finish after a user imports another project. Compute
          // outside React's updater and only apply to the unchanged initial demo.
          const arrangement = plugin.arrange!(project.notes, {
            difficulty: "normal",
            capo: 0,
            transpose: 0,
            bpm: project.bpm,
            score: projectScore(project),
            goal: "accompaniment",
            pattern: "strum",
          });
          setProject((p) =>
            p.id === project.id &&
            p.updatedAt === project.updatedAt &&
            !p.arrangement
              ? { ...p, arrangement }
              : p,
          );
          setReady(true);
        }
      })
      .catch((e) => {
        if (active) {
          setReady(true);
          notify(errorMessage(e));
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!ready || !dirty) return;
    setSaved("保存中…");
    const timer = setTimeout(
      () =>
        saveProject(project)
          .then(async () => {
            await pinAudioAssets(project);
            setSaved("已保存在此浏览器");
          })
          .catch(() => setSaved("存储不可用，请导出项目")),
      500,
    );
    return () => clearTimeout(timer);
  }, [project, ready, dirty]);
  useEffect(() => {
    if (!ready || !project.arrangement) return;
    let active = true;
    load("standard-exporters")
      .then((p) => {
        if (active) setTextTab(String(p.exportFile!(project, "txt").data));
      })
      .catch(() => setTextTab("请启用标准导出插件"));
    return () => {
      active = false;
    };
  }, [project, ready]);
  useEffect(() => {
    if (!sourceUrl) return;
    return () => URL.revokeObjectURL(sourceUrl);
  }, [sourceUrl]);
  useEffect(
    () => () => {
      transport.dispose();
      abortRef.current?.abort();
      neutralStop.current?.();
      if (timerRef.current) clearInterval(timerRef.current);
      void audioRef.current?.close();
      referenceLoad.current?.abort();
      stemPlayer.current?.pause();
      if (stemUrl.current) URL.revokeObjectURL(stemUrl.current);
    },
    [],
  );
  useEffect(() => {
    if (pagesEdition) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const c = await localCapabilities();
      if (!active) return;
      setLocal(!!c?.local);
      setEngineState(c?.engine ?? null);
      setLocalReady(!!c?.engine?.ready);
      if (!analysisChoice.current)
        setLocalMode(c?.engine?.ready ? "accompaniment" : "browser");
      if (c?.engine?.status === "checking") timer = setTimeout(refresh, 2000);
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  const neutralStop = useRef<(() => void) | null>(null);
  function updateEditorProject(next: MusicProject) {
    next = { ...next, updatedAt: new Date().toISOString() };
    projectRef.current = next;
    setProject(next);
    setDirty(true);
  }
  function commitEditor(changes: NoteOverride[]) {
    try {
      stop();
      const next = commitTrackNotes(
        projectRef.current,
        selectedTrackId,
        changes,
      );
      validateProject(next);
      updateEditorProject(next);
    } catch (error) {
      notify(errorMessage(error));
    }
  }
  function changeNoteEditor(
    change: (state: NoteEditorState) => NoteEditorState,
  ) {
    try {
      const current = projectRef.current,
        next = changeTrackEditor(current, selectedTrackId, change);
      validateProject(next);
      updateEditorProject(next);
    } catch (error) {
      notify(errorMessage(error));
    }
  }
  async function analyzeWhole(
    f: File,
    range?: { offset?: number; seconds?: number; soloPiano?: boolean },
  ) {
    if (/\.(mid|midi|xml|musicxml)$/i.test(f.name)) {
      abortRef.current?.abort();
      abortRef.current = null;
      setBusy("");
      await selectFile(f, true);
      return;
    }
    abortRef.current?.abort();
    stop();
    const control = new AbortController();
    abortRef.current = control;
    setBusy("正在解码整曲");
    setProgress(0);
    setMessage("");
    let id = "";
    try {
      if ((await workbenchComponentProblems()).length)
        throw new Error(
          "工作台组件需要更新或启用，请点击“修复工作台组件”，再重新分析。原项目已保留。",
        );
      const native =
        !pagesEdition && !range?.soloPiano && localMode === "accompaniment";
      if (native && !engineState?.ready)
        throw new Error(
          engineState?.message ??
            "本地模型尚未就绪，请等待检查完成或明确选择基础识别。",
        );
      const data = native
        ? await (async () => {
            const { buffer, sha256 } = await readAudioFile(
              f,
              200,
              control.signal,
            );
            if (buffer.duration > 1800)
              throw new Error("本地分析上限为 30 分钟，请裁剪文件。");
            return {
              buffer,
              duration: buffer.duration,
              sourceSha256: sha256,
              samples: new Float32Array(),
            };
          })()
        : await decodeWhole(f, control.signal);
      const offset = range?.offset ?? 0;
      if (range)
        data.duration = Math.min(
          range.seconds ?? data.duration,
          data.duration - offset,
        );
      if (data.duration <= 0) throw new Error("分析起点超出录音范围");
      control.signal.throwIfAborted();
      let engine = await installed("basic-pitch-stream");
      if (!engine) {
        await install(
          (await catalog()).find((p) => p.id === "basic-pitch-stream")!,
        );
        engine = await installed("basic-pitch-stream");
      }
      control.signal.throwIfAborted();
      const p: MusicProject = {
        schemaVersion: 2,
        id: crypto.randomUUID(),
        name: f.name.replace(/\.[^.]+$/, ""),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        duration: data.duration,
        bpm: 120,
        beatOffset: 0,
        sourceOffset: offset,
        sourceKind: "audio",
        notes: [],
        melody: [],
        arrangement: null,
        pluginVersions: native
          ? { "local-separation": "0.4.0" }
          : { "basic-pitch-stream": engine!.manifest.version },
        sourceAudioSha256: data.sourceSha256,
        audioReference: {
          kind: "original",
          sha256: data.sourceSha256,
          durationSeconds: data.buffer.duration,
          offsetSeconds: offset,
        },
        transcription: {
          jobId: crypto.randomUUID(),
          status: "running",
          processedSeconds: 0,
          pluginVersion: native ? "0.4.0" : engine!.manifest.version,
          pluginSha256: native
            ? (engineState?.pluginSha256 ?? "")
            : engine!.manifest.sha256,
        },
      };
      p.score = projectScore(p);
      id = p.id;
      if (!native)
        try {
          const provenance = await (
            await fetch(
              new URL(
                "models/basic-pitch/provenance.json",
                new URL(import.meta.env.BASE_URL, location.href),
              ),
            )
          ).json();
          p.transcription!.modelSha256 = provenance.sha256;
        } catch {}
      control.signal.throwIfAborted();
      if (
        projectRef.current.noteEditor ||
        projectRef.current.sourceKind !== "demo"
      )
        await saveProject(projectRef.current);
      control.signal.throwIfAborted();
      edit(p, false);
      setFile(f);
      setSourceUrl(URL.createObjectURL(f));
      setWave(referenceWaveform(data.buffer, offset, data.duration));
      sourceBuffer.current.set(audioAssetKey(p), data.buffer);
      if (sourceBuffer.current.size > 3)
        sourceBuffer.current.delete(sourceBuffer.current.keys().next().value!);
      await set(audioAssetKey(p), f);
      control.signal.throwIfAborted();
      if (native) {
        const result = await analyzeLocal(
          f,
          "accompaniment",
          control.signal,
          (j) => {
            if (control.signal.aborted || projectRef.current.id !== id) return;
            setProgress(j.progress);
            setBusy(j.message);
            if (j.partial)
              updateEditorProject({
                ...projectRef.current,
                notes: j.partial.notes,
              });
          },
          { offset, seconds: data.duration },
        );
        control.signal.throwIfAborted();
        if (projectRef.current.id !== id) return;
        const current = projectRef.current;
        const melody = await invoke<NoteEvent[]>(
          "melody-tracker",
          "extractMelody",
          [filteredNotes({ ...current, notes: result.notes })],
          control.signal,
        );
        control.signal.throwIfAborted();
        if (projectRef.current !== current)
          throw new Error("分析期间项目已改变，请重新送往编配。");
        const next = {
          ...current,
          duration: result.duration,
          notes: result.notes,
          melody,
          harmonyAnalysis: result.harmonyAnalysis,
          melodyEvidence: result.melodyEvidence,
          tracks: result.tracks,
          localAnalysis: result.run,
          pluginVersions: {
            ...current.pluginVersions,
            "local-separation": "0.4.0",
          },
          transcription: {
            ...current.transcription!,
            status: "complete" as const,
            processedSeconds: result.duration,
            pluginVersion: "0.4.0",
            modelSha256: result.executions?.find(
              (e) => e.name === "Basic Pitch",
            )?.weightsSha256,
          },
        };
        next.score = projectScore({ ...next, score: undefined });
        if (next.harmonyAnalysis)
          next.score = projectHarmony(next.harmonyAnalysis, next.score);
        validateProject(next);
        updateEditorProject(next);
        notify(
          `本地增强完成：${next.notes.length} 个原始音符、${next.harmonyAnalysis?.segments.filter((s) => s.root !== null).length ?? 0} 段和弦候选。${result.run?.cacheHit ? "已复用缓存。" : ""}请试听并核对待确认段落。`,
        );
        return;
      }
      setBusy("正在识别整曲 · 音符将逐段出现");
      await transcribe(data.samples, control.signal, setProgress, (chunk) => {
        if (control.signal.aborted || projectRef.current.id !== id) return;
        const current = projectRef.current;
        updateEditorProject({
          ...current,
          notes: chunk.notes,
          transcription: {
            ...current.transcription!,
            processedSeconds: Math.min(
              chunk.processedSeconds,
              current.duration,
            ),
            status: chunk.complete ? "complete" : "running",
          },
          updatedAt: new Date().toISOString(),
        });
      });
      if (!control.signal.aborted && projectRef.current.id === id) {
        const current = projectRef.current;
        const harmonyAnalysis = await invoke<HarmonyAnalysis>(
          "harmony-analysis",
          "analyzeTimeline",
          [current.notes, current.duration],
          control.signal,
        );
        if (projectRef.current.id === id)
          updateEditorProject({ ...projectRef.current, harmonyAnalysis });
      }
      if (projectRef.current.id === id)
        notify(
          `转录完成：${projectRef.current.notes.length} 个候选音符，可直接试听、编辑和导出。`,
        );
    } catch (error) {
      if (id && projectRef.current.id === id) {
        const current = projectRef.current;
        updateEditorProject({
          ...current,
          transcription: {
            ...current.transcription!,
            status: control.signal.aborted ? "stopped" : "error",
            error: control.signal.aborted ? undefined : errorMessage(error),
          },
        });
      }
      if (abortRef.current === control)
        notify(
          control.signal.aborted
            ? "已停止，已完成片段和校订已保留。"
            : errorMessage(error),
        );
    } finally {
      if (abortRef.current === control) {
        abortRef.current = null;
        setBusy("");
      }
    }
  }
  async function handoffToGuitar() {
    if (busy) return;
    const current = projectRef.current;
    if (current.tracks?.length) {
      setMode("guitar");
      setAdvanced(true);
      return;
    }
    if (current.sourceKind !== "audio" && !current.noteEditor) {
      setMode("guitar");
      return;
    }
    try {
      const input = filteredNotes(current);
      if (!input.length) throw new Error("请先识别或添加音符。");
      const melody = await invoke<NoteEvent[]>(
        "melody-tracker",
        "extractMelody",
        [input],
      );
      if (projectRef.current !== current)
        throw new Error("校订已更新，请再次送往吉他编配。");
      const score = projectScore({ ...current, score: undefined, melody });
      if (current.score) {
        score.chords = current.score.chords;
        score.sections = current.score.sections;
        score.meter = current.score.meter;
        score.pickupBeats = current.score.pickupBeats;
      }
      edit({ ...current, melody, score }, false);
      setMode("guitar");
      notify("已采用当前校订与筛选结果，请确认节拍、和弦和弹奏目标后生成。");
    } catch (error) {
      notify(errorMessage(error));
    }
  }
  async function selectFile(f: File, allowBusy = false) {
    if (busy && !allowBusy) return;
    stop();
    setMessage("");
    if (f.size > (local ? 200 : 50) * 1024 * 1024) {
      notify(`文件上限为 ${local ? 200 : 50} MB，请缩短片段`);
      return;
    }
    try {
      if (/\.mid(i)?$/i.test(f.name) || /\.musicxml$|\.xml$/i.test(f.name)) {
        const p = /\.mid(i)?$/i.test(f.name)
          ? await importMidi(f)
          : await importMusicXML(f);
        const tracker = await load("melody-tracker");
        if (!p.score) p.melody = tracker.extractMelody!(p.notes);
        edit(p);
        setFile(null);
        setSourceUrl("");

        setWave([]);
        setSelected(null);
        notify("乐谱已导入；请核对声部、节奏与技法后编配。");
      } else {
        setFile(f);
        setStart(0);
        setSourceUrl(URL.createObjectURL(f));
        notify("文件已就绪，选择片段后点击分析。");
      }
    } catch (e) {
      notify(errorMessage(e));
    }
  }
  async function analyze() {
    if (!file) return;
    if (localMode === "accompaniment") {
      await analyzeWhole(file, { offset: start, seconds: length });
      return;
    }
    stop();
    setBusy("正在解码音频");
    setProgress(0);
    setMessage("");
    const control = new AbortController();
    abortRef.current = control;
    try {
      if (localMode !== "browser") {
        const data = await analyzeLocal(
          file,
          localMode,
          control.signal,
          (j) => {
            setProgress(j.progress);
            setBusy(j.message);
          },
        );
        const tracker = await load("melody-tracker");
        const p: MusicProject = {
          schemaVersion: 1,
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^.]+$/, ""),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          duration: data.duration,
          bpm: Math.round(data.bpm * 100) / 100,
          beatOffset: 0,
          sourceOffset: 0,
          notes: data.notes,
          melody: await invoke<NoteEvent[]>(
            "melody-tracker",
            "extractMelody",
            [data.notes],
            control.signal,
          ),
          arrangement: null,
          pluginVersions: { "local-separation": "0.1.0" },
          sourceKind: "audio",
        };
        const harmony = await load("harmony-analysis");
        p.score = harmony.analyzeHarmony!(p.notes, projectScore(p));
        p.schemaVersion = 2;
        edit(p);
        await set("audio:" + p.id, file);
        setSelected(null);
        notify(
          `本地分析完成，${data.notes.length} 个候选音符。单次最多处理 30 分钟。`,
        );
        return;
      }
      const data = await decode(file, start, length, control.signal);

      setWave(data.waveform);
      setBusy("正在识别音符 · 音频留在浏览器");
      const detected = await transcribe(
        data.samples,
        control.signal,
        setProgress,
      );
      let refinement: MusicProject["refinement"];
      if (refineGuitar) {
        if (!(await installed("note-refinement")))
          await install(
            (await catalog()).find((m) => m.id === "note-refinement")!,
          );
        const plugin =
          await loadRefiner<RefinementParameters>("note-refinement");
        const result = plugin.refineNotes(
          detected,
          experimentalGuitarParameters,
        );
        refinement = {
          pluginId: "note-refinement",
          profile: "experimental-guitar-clarity",
          notes: result.notes,
          dropped: result.dropped,
        };
      }
      const usable = refinement?.notes ?? detected;
      const tracker = await load("melody-tracker");
      const melody = await invoke<NoteEvent[]>(
        "melody-tracker",
        "extractMelody",
        [usable],
        control.signal,
      );
      const p: MusicProject = {
        schemaVersion: 1,
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ""),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        duration: data.duration,
        bpm: 120,
        beatOffset: 0,
        sourceOffset: start,
        notes: detected,
        refinement,
        melody,
        arrangement: null,
        pluginVersions: {
          "basic-pitch": (await installed("basic-pitch"))!.manifest.version,
        },
        sourceKind: "audio",
        sourceAudioSha256: data.sourceSha256,
        audioReference: {
          kind: "original",
          sha256: data.sourceSha256,
          durationSeconds: data.buffer.duration,
          offsetSeconds: start,
        },
      };
      const harmony = await load("harmony-analysis");
      const tempos = harmony.tempoCandidates!(usable);
      if (tempos.length) p.bpm = tempos[0].bpm;
      let timingWarning = "";
      const timingPlugin = await installed("rhythm-analysis");
      if (timingPlugin?.enabled && timingPlugin.code) {
        try {
          p.timingAnalysis = await invoke<TimingAnalysis>(
            "rhythm-analysis",
            "analyzeTiming",
            [data.samples, 22050, p.bpm],
            control.signal,
          );
          p.pluginVersions["rhythm-analysis"] = timingPlugin.manifest.version;
        } catch (error) {
          if (control.signal.aborted) throw error;
          timingWarning = "波形拍点候选暂未生成，请手动确认参考速度与首拍。";
        }
      }
      p.score = harmony.analyzeHarmony!(usable, projectScore(p));
      if (timingWarning) p.score.warnings.push(timingWarning);
      for (const id of [
        "melody-tracker",
        "harmony-analysis",
        ...(refinement ? ["note-refinement"] : []),
      ])
        p.pluginVersions[id] = (await installed(id))!.manifest.version;
      p.schemaVersion = 2;
      sourceBuffer.current.set(audioAssetKey(p), data.buffer);
      if (sourceBuffer.current.size > 3)
        sourceBuffer.current.delete(sourceBuffer.current.keys().next().value!);
      control.signal.throwIfAborted();
      edit(p);
      setSelected(null);
      setLoopEnd(Math.min(8, p.duration));
      await set(audioAssetKey(p), file);
      notify(
        detected.length
          ? `识别到 ${detected.length} 个原始候选音${refinement ? `，清理后保留 ${usable.length} 个` : ""}、${melody.length} 个旋律候选音。速度与和弦待校正，请先确认首拍。`
          : "没有检测到可靠音符，请换用更清晰片段或本地增强识别。",
      );
    } catch (e) {
      if (abortRef.current === control)
        notify(
          control.signal.aborted ? "已取消，原项目已保留" : errorMessage(e),
        );
    } finally {
      if (abortRef.current === control) {
        setBusy("");
        abortRef.current = null;
      }
    }
  }
  async function generatePiano() {
    if (busy || abortRef.current) return;
    const control = new AbortController();
    abortRef.current = control;
    const current = projectRef.current;
    setBusy("正在分配钢琴左右手");
    stop();
    try {
      const expected = (await catalog()).find((x) => x.id === "piano");
      if (!expected) throw new Error("当前版本缺少钢琴插件目录。");
      const prior = await installed("piano");
      if (prior && !prior.enabled)
        throw new Error("请在插件中心启用钢琴插件。");
      if (!prior || prior.manifest.sha256 !== expected.sha256)
        await install(expected);
      const input = filteredNotes(current);
      const written = current.sourceKind === "musicxml" && !current.noteEditor;
      const score = projectScore(
        written ? current : { ...current, score: undefined, melody: input },
      );
      if (!score.events.some((e) => e.midi !== null))
        throw new Error("请先导入包含音符的谱件或识别钢琴独奏。");
      const piano = await loadInstrument<
        PianoOptions,
        PianoAction,
        PianoAction[]
      >("piano");
      control.signal.throwIfAborted();
      const options: PianoOptions = {
        split: 60,
        maxSpan: difficulty === "easy" ? 9 : 12,
        difficulty,
      };
      const performance = await invoke<
        import("../../packages/contracts").PerformancePlan<PianoAction>
      >("piano", "arrangeScore", [score, options], control.signal);
      const notes = piano.soundEvents(performance, score);
      if (projectRef.current !== current)
        throw new Error("工程已改动，请重新生成钢琴谱。");
      commitEdit(
        {
          ...current,
          piano: { version: 1, score, performance, notes },
          pluginVersions: {
            ...current.pluginVersions,
            piano: expected.version,
          },
        },
        false,
      );
      setActiveTrackId("piano-arrangement");
      setMode("piano");
      notify(
        performance.issues.length
          ? "钢琴谱已生成，部分音符需核对手别。"
          : "钢琴谱已生成，可点击试听。",
      );
    } catch (error) {
      if (!control.signal.aborted) notify(errorMessage(error));
    } finally {
      if (abortRef.current === control) {
        abortRef.current = null;
        setBusy("");
      }
    }
  }
  async function exportPiano(format: "musicxml" | "midi") {
    const piano = project.piano;
    if (!piano) return;
    try {
      if (format === "musicxml")
        download(
          pianoMusicXml(project.name, piano),
          "application/vnd.recordare.musicxml+xml",
          project.name + "-钢琴.musicxml",
        );
      else {
        const data = (await load("note-exporters")).exportNotes!(
          piano.notes,
          project.bpm,
        );
        download(
          new Uint8Array(data).buffer,
          "audio/midi",
          project.name + "-钢琴.mid",
        );
      }
    } catch (error) {
      notify(errorMessage(error));
    }
  }
  async function generate() {
    if (generationLock.current || abortRef.current || busy) return;
    generationLock.current = true;
    stop();
    let current = projectRef.current;
    const control = new AbortController();
    abortRef.current = control;
    const task: GenerationTask = {
      id: crypto.randomUUID(),
      projectId: current.id,
      status: "running",
      phase: "检查输入与插件",
      startedAt: Date.now(),
      message: "已收到请求，正在检查输入与插件。",
    };
    setGeneration(task);
    setBusy("正在编配 · 检查输入与插件");
    setMessage("");
    setAdvice("");
    const update = (changes: Partial<GenerationTask>) =>
      setGeneration((previous) =>
        previous?.id === task.id ? { ...previous, ...changes } : previous,
      );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const vocal = current.tracks?.find((t) => t.role === "vocal");
      if (
        goal === "fingerstyle" &&
        vocal?.asset &&
        (!vocal.analysisRevision ||
          (profile === "phrasing" && !vocal.phraseEvidence))
      ) {
        update({
          phase: "分析人声轨",
          message: "正在独立转录人声，不重复分离。",
        });
        setBusy("正在分析独立人声轨");
        const revised = await analyzeVocalTrack(control.signal);
        current = revised;
      }
      timeout = setTimeout(() => control.abort("timeout"), 120000);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      control.signal.throwIfAborted();
      const result = await runGeneration(
        current,
        {
          difficulty,
          capo,
          transpose,
          bpm: current.bpm,
          goal,
          pattern,
          autoCapo,
          useAI,
          profile,
        },
        ai,
        control.signal,
        (phase) => {
          update({ phase, message: phase + "…" });
          setBusy("正在编配 · " + phase);
        },
      );
      control.signal.throwIfAborted();
      if (projectRef.current !== current)
        throw new GenerationError(
          "生成期间项目已修改，请使用当前设置重试。已有谱面已保留。",
        );
      commitEdit(result.project, false);
      setCapo(result.capo);
      setAdvice(result.advice);
      setSelected(null);
      setActiveTrackId("arrangement");
      setMode("guitar");
      setView("tab");
      update({
        status: "success",
        endedAt: Date.now(),
        count: result.project.arrangement!.notes.length,
        message: `编配完成：${result.project.arrangement!.notes.length} 个发声事件，可直接试听。`,
      });
      notify(
        `编配完成：${goal === "accompaniment" ? "和弦伴奏" : goal === "fingerstyle" ? "独奏指弹" : "单线练习"}，${result.project.arrangement!.notes.length} 个发声事件。请逐小节核对并试弹。`,
      );
    } catch (error) {
      if (projectRef.current.id !== current.id) return;
      const timedOut = control.signal.reason === "timeout";
      const cancelled = control.signal.aborted && !timedOut;
      const message = timedOut
        ? "生成超过 120 秒，已停止。已有谱面已保留，可缩短片段后重试。"
        : cancelled
          ? "已取消生成，已有谱面已保留。"
          : errorMessage(error);
      update({
        status: cancelled ? "cancelled" : "error",
        message,
        endedAt: Date.now(),
        recovery:
          error instanceof GenerationError
            ? error.recovery
            : /锁定|指型|和弦|手指/.test(message)
              ? "structure"
              : "retry",
        problems: error instanceof GenerationError ? error.problems : [],
      });
      if (abortRef.current === control) notify(message);
    } finally {
      clearTimeout(timeout);
      generationLock.current = false;
      if (abortRef.current === control) {
        setBusy("");
        abortRef.current = null;
      }
    }
  }
  async function repairGeneration() {
    if (busy || generationLock.current) return;
    setBusy("正在修复生成所需插件");
    try {
      await repairGenerationPlugins(generation?.problems ?? []);
      setGeneration(null);
      notify("所需插件已修复，请点击生成吉他编配。");
    } catch (error) {
      const message = "插件修复失败：" + errorMessage(error);
      setGeneration((previous) =>
        previous ? { ...previous, message } : previous,
      );
      notify(message);
    } finally {
      setBusy("");
    }
  }
  async function useDemo() {
    stop();
    try {
      const p = demoProject(),
        g = await load("guitar-standard");
      p.arrangement = g.arrange!(p.notes, {
        difficulty,
        capo,
        transpose,
        bpm: p.bpm,
        goal,
        score: projectScore(p),
        pattern,
      });
      edit(p);
      setFile(null);
      setSourceUrl("");

      setWave([]);
      setSelected(null);
      setMessage("正在体验原创练习曲，示例音符为预先编写，未经过音频识别。");
    } catch (e) {
      notify(errorMessage(e));
    }
  }
  async function bindRecording(recording: File, offset: number) {
    if (busy) return;
    stop();
    setBusy("正在关联录音");
    const control = new AbortController();
    abortRef.current = control;
    const projectId = project.id;
    try {
      const decoded = await readAudioFile(
        recording,
        local ? 200 : 50,
        control.signal,
      );
      control.signal.throwIfAborted();
      const current = projectRef.current;
      if (current.id !== projectId) return;
      const kind =
        current.sourceAudioSha256?.toLowerCase() === decoded.sha256
          ? ("original" as const)
          : ("reference" as const);
      const next = {
        ...current,
        audioReference: {
          kind,
          sha256: decoded.sha256,
          durationSeconds: decoded.buffer.duration,
          offsetSeconds: offset,
        },
      };
      validateProject(next);
      await set(audioAssetKey(next), recording);
      control.signal.throwIfAborted();
      if (projectRef.current.id !== projectId) return;
      sourceBuffer.current.set(audioAssetKey(next), decoded.buffer);
      if (sourceBuffer.current.size > 3)
        sourceBuffer.current.delete(sourceBuffer.current.keys().next().value!);
      const applied = {
        ...projectRef.current,
        audioReference: next.audioReference,
      };
      validateProject(applied);
      edit(applied);
      setFile(recording);
      setSourceUrl(URL.createObjectURL(recording));
      setWave(referenceWaveform(decoded.buffer, offset, applied.duration));
      notify(
        kind === "original"
          ? "原文件摘要已核验，录音对照已恢复；谱面和编辑保留。"
          : "已关联参考录音；识别来源、谱面和编辑保留。",
      );
    } catch (error) {
      notify(
        control.signal.aborted
          ? "已取消关联，原项目保留。"
          : errorMessage(error),
      );
    } finally {
      if (abortRef.current === control) {
        abortRef.current = null;
        setBusy("");
      }
    }
  }
  async function upgrade() {
    if (busy) return;
    stop();
    const current = projectRef.current,
      next = upgradeProject(current);
    setBusy("正在升级项目副本");
    try {
      await saveProject(current);
      const audio = await get<File>(audioAssetKey(current));
      if (projectRef.current !== current) return;
      if (audio) await set(audioAssetKey(next), audio);
      if (projectRef.current !== current) return;
      const buffer = sourceBuffer.current.get(audioAssetKey(current));
      if (buffer) sourceBuffer.current.set(audioAssetKey(next), buffer);
      edit(next, false);
      notify("已创建 v2 副本，原项目和关联录音保留。");
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy("");
    }
  }
  function clearProjectAudio(id: string) {
    for (const key of sourceBuffer.current.keys())
      if (key === `audio:${id}` || key.startsWith(audioAssetPrefix(id)))
        sourceBuffer.current.delete(key);
    if (projectRef.current.id === id) {
      stop();
      setDirty(false);
      setSaved("作品已删除，编辑后重新保存");
      setFile(null);
      setSourceUrl("");
      setWave([]);
    }
  }
  function updateReferenceOffset(offset: number): boolean {
    const current = projectRef.current;
    if (!current.audioReference) return false;
    const next = {
      ...current,
      audioReference: { ...current.audioReference, offsetSeconds: offset },
    };
    try {
      validateProject(next);
      stop();
      edit(next);
      const buffer = sourceBuffer.current.get(audioAssetKey(next));
      if (buffer) setWave(referenceWaveform(buffer, offset, next.duration));
      return true;
    } catch (error) {
      notify(errorMessage(error));
      return false;
    }
  }
  const stemPlayer = useRef<HTMLAudioElement | null>(null);
  const stemUrl = useRef("");
  async function repairComponents() {
    if (busy) return;
    setBusy("正在修复工作台组件");
    try {
      await repairWorkbenchComponents();
      notify("工作台组件已修复，请重新分析。原始材料与谱面保留。");
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy("");
    }
  }
  async function compareHarmony(variant: "direct" | "separated" | "notes") {
    const current = projectRef.current;
    if (!current.localAnalysis) return;
    try {
      stop();
      const harmonyAnalysis =
        variant === "notes"
          ? await invoke<HarmonyAnalysis>(
              "harmony-analysis",
              "analyzeTimeline",
              [current.notes, current.duration],
            )
          : variant === "direct"
            ? (JSON.parse(
                await (
                  await localAsset(
                    current.localAnalysis.jobId,
                    "direct-harmony.json",
                  )
                ).text(),
              ) as HarmonyAnalysis)
            : (JSON.parse(
                await (
                  await localAsset(
                    current.localAnalysis.jobId,
                    "separated-harmony.json",
                  )
                ).text(),
              ) as HarmonyAnalysis);
      if (projectRef.current !== current)
        throw new Error("项目已改变，请重新选择对照。");
      if (variant === "direct" && !harmonyAnalysis.method.endsWith("/original"))
        harmonyAnalysis.method += "/original";
      edit(
        {
          ...current,
          harmonyAnalysis,
          score: projectHarmony(harmonyAnalysis, projectScore(current)),
        },
        false,
      );
      notify("已切换和声对照，原始音符保留。请重新生成后试听本方案。");
    } catch (error) {
      notify(errorMessage(error));
    }
  }
  async function playStem(asset: "accompaniment.wav" | "bass.wav") {
    const track = projectRef.current.tracks?.find(
      (t) => t.role === (asset === "bass.wav" ? "bass" : "instrumental"),
    );
    if (track) {
      setActiveTrackId(track.id);
      setMonitorMode("audio");
      await playTracks([track.id], "audio");
      return;
    }
    if (stemPlayer.current) {
      stemPlayer.current.pause();
      stemPlayer.current = null;
      URL.revokeObjectURL(stemUrl.current);
      stemUrl.current = "";
    }
    stop();
    try {
      const job = projectRef.current.localAnalysis?.jobId;
      if (!job)
        throw new Error("本作品没有本地分离结果，请先使用本地伴奏增强。");
      const blob = await localAsset(job, asset);
      stemUrl.current = URL.createObjectURL(blob);
      const player = new Audio(stemUrl.current);
      stemPlayer.current = player;
      player.onended = () => {
        URL.revokeObjectURL(stemUrl.current);
        stemPlayer.current = null;
        stemUrl.current = "";
      };
      await player.play();
      notify(
        asset === "bass.wav"
          ? "正在试听分离低音；点击停止结束。"
          : "正在试听分离伴奏；点击停止结束。",
      );
    } catch (error) {
      notify(errorMessage(error));
    }
  }
  async function play(
    source = false,
    pulse?: TimingCandidate,
    eventOverride?: NoteEvent[],
    position?: number,
    guitarOverride = false,
  ) {
    stop();
    const sourceStem =
      project.audioReference?.kind === "reference" ||
      (project.audioReference &&
        project.audioReference.offsetSeconds !== project.sourceOffset)
        ? undefined
        : project.tracks?.find((t) => t.role === "original")?.asset;
    if (position !== undefined) transport.seek(position);
    transport.onError = (error) => notify(errorMessage(error));
    await transport.play(async (from, to, speed, current, signal) => {
      const generation = playGeneration.current;
      const ctx = new AudioContext();
      signal.addEventListener("abort", () => void ctx.close().catch(() => {}), {
        once: true,
      });
      audioRef.current = ctx;
      await ctx.resume();
      try {
        let origin = ctx.currentTime + 0.06;
        const assetKey = sourceStem
          ? `track:${sourceStem.id}`
          : audioAssetKey(project);
        if (source && sourceStem && !sourceBuffer.current.has(assetKey))
          sourceBuffer.current.set(
            assetKey,
            await ctx.decodeAudioData(
              await (
                await savedAudioAsset(sourceStem.id, signal)
              ).arrayBuffer(),
            ),
          );
        if (source && !sourceBuffer.current.has(assetKey)) {
          const control = new AbortController();
          referenceLoad.current = control;
          const original = await get<File>(assetKey);
          control.signal.throwIfAborted();
          if (!original)
            throw new Error(
              "当前浏览器没有这份录音文件。请用“关联录音”重新选择；谱面和编辑会保留。",
            );
          const decoded = await readAudioFile(
            original,
            local ? 200 : 50,
            control.signal,
          );
          if (
            project.audioReference &&
            decoded.sha256 !== project.audioReference.sha256.toLowerCase()
          )
            throw new Error("缓存录音与项目摘要不同，请重新关联文件。");
          sourceBuffer.current.set(assetKey, decoded.buffer);
          if (referenceLoad.current === control) referenceLoad.current = null;
        }
        if (source) {
          if (
            !current() ||
            generation !== playGeneration.current ||
            ctx.state === "closed"
          )
            throw new DOMException("已取消", "AbortError");
          origin = ctx.currentTime + 0.06;
          const s = ctx.createBufferSource();
          s.buffer = sourceBuffer.current.get(assetKey)!;
          s.playbackRate.value = speed;
          s.connect(ctx.destination);
          s.start(
            origin,
            (sourceStem?.offsetSeconds ??
              project.audioReference?.offsetSeconds ??
              project.sourceOffset) + from,
            to - from,
          );
          if (pulse) {
            const period = 60 / pulse.bpm;
            for (
              let beat =
                pulse.phaseSeconds +
                Math.max(0, Math.ceil((from - pulse.phaseSeconds) / period)) *
                  period;
              beat < to;
              beat += period
            ) {
              const oscillator = ctx.createOscillator(),
                gain = ctx.createGain(),
                when = origin + (beat - from) / speed;
              oscillator.frequency.value = 1200;
              gain.gain.setValueAtTime(0, when);
              gain.gain.linearRampToValueAtTime(0.12, when + 0.002);
              gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
              oscillator.connect(gain);
              gain.connect(ctx.destination);
              oscillator.start(when);
              oscillator.stop(when + 0.05);
            }
            notify(
              `正在对照原曲试听 ${pulse.bpm.toFixed(1)} BPM 拍点；小节首拍仍需核对。`,
            );
          }
        } else if (eventOverride && !guitarOverride) {
          const renderer = await load("note-audio");
          if (generation !== playGeneration.current)
            throw new DOMException("已取消", "AbortError");
          const result = renderer.scheduleNotes!(
            ctx,
            eventOverride,
            from,
            to,
            speed,
          );
          origin = result.origin;
          neutralStop.current = result.stop;
        } else {
          const renderer = await load("guitar-samples");
          const result = await renderer.scheduleAudio!(
            ctx,
            eventOverride ?? notes,
            tone,
            from,
            to,
            speed,
          );
          origin = result.origin;
          if (result.fallback && tone !== "synth")
            notify(
              `${result.fallback} 个音符使用合成音回退，其余使用实录采样。`,
            );
        }
        if (
          !current() ||
          generation !== playGeneration.current ||
          ctx.state === "closed"
        )
          throw new DOMException("已取消", "AbortError");
        return {
          position: () => from + Math.max(0, ctx.currentTime - origin) * speed,
          stop: () => {
            neutralStop.current?.();
            neutralStop.current = null;
            void ctx.close().catch(() => {});
          },
        };
      } catch (error) {
        void ctx.close().catch(() => {});
        throw error;
      }
    });
  }
  function updateNote(id: string, changes: Partial<GuitarNote>) {
    if (!project.arrangement) return;
    stop();
    const changed = notes.map((n) =>
      n.id === id ? { ...n, ...changes, locked: true } : n,
    );
    try {
      validateProject({
        ...project,
        arrangement: { ...project.arrangement, notes: changed },
      });
    } catch (e) {
      notify(errorMessage(e));
      return;
    }
    const errors = violations(changed, {
      difficulty,
      capo: project.arrangement.capo,
      transpose: project.arrangement.transpose,
      bpm: project.bpm,
      score: project.arrangement.score,
      goal: project.arrangement.goal,
    });
    if (errors.length) {
      notify(errors.join("、"));
      return;
    }
    edit({
      ...project,
      arrangement: { ...project.arrangement, notes: changed },
    });
  }
  async function playVoice(role: "melody" | "bass" | "harmony") {
    const voice = notes.filter((n) => n.role === role);
    if (!voice.length) {
      notify("本编配没有这个声部。");
      return;
    }
    await play(false, undefined, voice, undefined, true);
  }
  async function analyzeVocalTrack(signal?: AbortSignal) {
    const initial = projectRef.current,
      vocal = initial.tracks?.find((t) => t.role === "vocal"),
      backing = initial.tracks?.find((t) => t.role === "instrumental");
    if (!vocal?.asset) throw new Error("请先分离人声轨。");
    const control = signal ? null : new AbortController();
    if (control) {
      if (busy) throw new Error("请等待当前任务完成。");
      abortRef.current = control;
      setBusy("正在分析独立人声轨");
    }
    try {
      const result = await analyzeSavedTrack(
        vocal.asset.id,
        "vocal-melody",
        signal ?? control!.signal,
        (j) => {
          setBusy(j.message);
          setProgress(j.progress);
        },
        backing?.asset?.id,
      );
      (signal ?? control!.signal).throwIfAborted();
      if (projectRef.current !== initial)
        throw new Error("项目已改变，人声结果未覆盖当前项目。");
      const next = {
        ...initial,
        tracks: initial.tracks!.map((t) =>
          t.id === vocal.id
            ? {
                ...t,
                notes: t.analysisRevision ? t.notes : result.notes,
                melodyEvidence: result.melodyEvidence,
                phraseEvidence: result.phraseEvidence,
                analysisRevision: result.run?.cacheKey,
              }
            : t,
        ),
      };
      validateProject(next);
      updateEditorProject(next);
      return projectRef.current;
    } finally {
      if (control && abortRef.current === control) {
        abortRef.current = null;
        setBusy("");
      }
    }
  }
  async function playTracks(ids?: string[], playbackMode = monitorMode) {
    const selectedIds =
      ids ??
      (soloTrackId
        ? [soloTrackId]
        : monitorMode === "mix"
          ? [...mixTrackIds]
          : [selectedTrackId]);
    audibleTrackIds.current = selectedIds;
    const material = projectTracks(projectRef.current).filter(
      (t) => selectedIds.includes(t.id) && !mutedTracks.has(t.id),
    );
    if (!material.length) {
      stop();
      notify("请先选择至少一条未静音的轨道。");
      return;
    }
    if (
      material.length === 1 &&
      material[0].id === "legacy" &&
      playbackMode === "audio" &&
      project.audioReference
    ) {
      await play(true);
      return;
    }
    stop();
    transport.onError = (error) => notify(errorMessage(error));
    await transport.play(
      trackPlayback(
        projectRef.current,
        material.map((t) => t.id),
        { mode: playbackMode, volumes: trackVolumes, tone },
        sourceBuffer.current,
      ),
    );
  }
  function selectTrack(id: string) {
    setActiveTrackId(id);
  }
  // Rebuild the shared driver after settings commit, preserving its audio-clock position.
  useEffect(() => {
    if (transport.snapshot().status !== "paused") void playTracks();
  }, [
    selectedTrackId,
    monitorMode,
    soloTrackId,
    mutedTracks,
    mixTrackIds,
    trackVolumes,
  ]);
  useEffect(
    () => () => {
      previewRevision.current++;
      void previewContext.current?.close().catch(() => {});
    },
    [],
  );
  async function audition(events: NoteEvent[], guitar = false) {
    const revision = ++previewRevision.current;
    void previewContext.current?.close().catch(() => {});
    const ctx = new AudioContext();
    previewContext.current = ctx;
    await ctx.resume();
    const end = Math.min(2, Math.max(...events.map((n) => n.duration), 0.1));
    const material = events.map((n) => ({
      ...n,
      start: 0,
      duration: Math.min(end, n.duration),
    }));
    try {
      const renderer = await load(guitar ? "guitar-samples" : "note-audio");
      if (revision !== previewRevision.current) {
        void ctx.close().catch(() => {});
        return;
      }
      if (guitar) await renderer.scheduleAudio!(ctx, material, tone, 0, end, 1);
      else renderer.scheduleNotes!(ctx, material, 0, end, 1);
      setTimeout(() => void ctx.close().catch(() => {}), (end + 0.3) * 1000);
    } catch (error) {
      void ctx.close();
      notify(errorMessage(error));
    }
  }
  function activateNotes(events: NoteEvent[], at: number, guitar = false) {
    const wasPlaying = transport.snapshot().status !== "paused";
    seek(at);
    if (
      events.length &&
      (!wasPlaying ||
        !audibleTrackIds.current.includes(
          guitar ? "arrangement" : selectedTrackId,
        ))
    )
      void audition(events, guitar);
  }
  async function exportAs(format: string) {
    try {
      if (format === "wav") {
        const expected = (await catalog()).find(
          (m) => m.id === "guitar-samples",
        );
        if (
          (await installed("guitar-samples"))?.manifest.sha256 !==
          expected?.sha256
        )
          throw new Error(
            "请先在插件中心更新“吉他音色”，再导出 WAV。作品已保留。",
          );
        setBusy("正在渲染 WAV");
        const renderer = await load("guitar-samples");
        const r = await renderer.renderAudio!(
          notes,
          project.duration,
          tone,
          (processed, total) =>
            setBusy(
              `正在渲染 WAV · ${Math.round(processed)} / ${Math.round(total)} 秒`,
            ),
        );
        download(r.data, "audio/wav", project.name + ".wav");
        if (r.fallback) notify(`已导出；${r.fallback} 个音符使用合成音回退。`);
      } else {
        const plugin = await load("standard-exporters"),
          r = plugin.exportFile!(project, format);
        download(r.data as BlobPart, r.mime, project.name + "." + r.extension);
      }
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setBusy("");
    }
  }
  async function openProject(p: MusicProject, replaceTask = false) {
    if (busy && !replaceTask) {
      notify("请先取消或完成当前任务，再打开其他作品。");
      return;
    }
    if (replaceTask) {
      abortRef.current?.abort();
      abortRef.current = null;
      setBusy("");
    }
    stop();
    const control = new AbortController();
    referenceLoad.current = control;
    try {
      validateProject(p);
      if (p.transcription?.status === "running")
        p = { ...p, transcription: { ...p.transcription, status: "stopped" } };
      edit(p, false);
      if (p.piano && !p.arrangement) {
        setMode("piano");
        setActiveTrackId("piano-arrangement");
      }
      setProfile(p.arrangement?.profile ?? "classic");
      if (p.arrangement) {
        setGoal(p.arrangement.goal ?? "melody");
        if (p.arrangementDraft) setPattern(p.arrangementDraft.options.pattern);
        setDifficulty(p.arrangement.difficulty);
        setCapo(p.arrangement.capo);
        setAutoCapo(false);
        setTranspose(p.arrangement.transpose);
      }
      const audio = await get<File>(audioAssetKey(p));
      control.signal.throwIfAborted();
      if (
        projectRef.current.id !== p.id ||
        audioAssetKey(projectRef.current) !== audioAssetKey(p)
      )
        return;
      setFile(audio ?? null);
      setSourceUrl(audio ? URL.createObjectURL(audio) : "");

      if (audio) {
        const decoded = await readAudioFile(
          audio,
          local ? 200 : 50,
          control.signal,
        );
        if (
          p.audioReference &&
          decoded.sha256 !== p.audioReference.sha256.toLowerCase()
        )
          throw new Error("关联录音摘要不符，请重新选择文件。");
        if (
          projectRef.current.id !== p.id ||
          audioAssetKey(projectRef.current) !== audioAssetKey(p)
        )
          return;
        sourceBuffer.current.set(audioAssetKey(p), decoded.buffer);
        setWave(
          referenceWaveform(
            decoded.buffer,
            p.audioReference?.offsetSeconds ?? p.sourceOffset,
            p.duration,
          ),
        );
      } else {
        setWave([]);
      }
      if (referenceLoad.current === control) referenceLoad.current = null;
      setPage("workbench");
      setSelected(null);
      return true;
    } catch (e) {
      if (!control.signal.aborted) notify(errorMessage(e));
    } finally {
      if (referenceLoad.current === control) referenceLoad.current = null;
    }
  }
  const section = (p: typeof page) => {
    if (busy) {
      notify("请等待当前任务完成，或先取消");
      return;
    }
    stop();
    setPage(p);
    setSettings(false);
    if (p === "projects") {
      const pending = dirty
        ? saveProject(projectRef.current)
        : Promise.resolve();
      pending
        .catch((e) => notify(errorMessage(e)))
        .then(listProjects)
        .then(setProjects)
        .catch((e) => notify(errorMessage(e)));
    }
  };
  async function importFile(file: File) {
    try {
      let imported: MusicProject | undefined;
      if (/\.(zip|stringcraft)$/i.test(file.name)) {
        if (!local) throw new Error("含音频工程请在本地版打开。");
        imported = await importAudioProject(file);
      } else if (/\.json$/i.test(file.name)) {
        if (file.size > 50 * 1024 ** 2)
          throw new Error("项目 JSON 上限为 50 MB");
        imported = JSON.parse(await file.text());
      } else {
        await analyzeWhole(file);
        return;
      }
      validateProject(imported);
      if (await openProject(imported, true)) {
        await saveProject(projectRef.current);
        await pinAudioAssets(projectRef.current);
        setSaved("已保存在此浏览器");
        notify("项目已载入，音符与编辑记录已保留。");
      }
    } catch (error) {
      notify(errorMessage(error));
    }
  }
  async function exportBundle() {
    if (busy) return;
    try {
      setBusy("正在打包工程音频");
      const blob = await exportAudioProject(projectRef.current);
      download(blob, "application/zip", project.name + ".stringcraft.zip");
      notify("工程音频与项目已打包。");
    } catch (error) {
      notify(errorMessage(error));
    } finally {
      setBusy("");
    }
  }
  return {
    importFile,
    exportBundle,
    inspectorOpen,
    setInspectorOpen,
    filtersOpen,
    setFiltersOpen,
    tracks,
    activeTrackId: selectedTrackId,
    selectTrack,
    editorProject,
    playTracks,
    analyzeVocalTrack,
    monitorMode,
    setMonitorMode,
    mutedTracks,
    setMutedTracks,
    soloTrackId,
    setSoloTrackId,
    trackVolumes,
    setTrackVolumes,
    mixTrackIds,
    setMixTrackIds,
    generation,
    repairGeneration,
    advanced,
    setAdvanced,
    commitEditor,
    changeNoteEditor,
    mode,
    setMode,
    analyzeWhole,
    generatePiano,
    exportPiano,
    handoffToGuitar,
    updateEditorProject,
    playNeutral: (events: NoteEvent[], position?: number) =>
      play(false, undefined, events, position),
    bindRecording,
    updateReferenceOffset,
    clearProjectAudio,
    pluginCount,
    playTiming: (candidate: TimingCandidate) => play(true, candidate),
    refineGuitar,
    setRefineGuitar,
    goal,
    setGoal,
    pattern,
    setPattern,
    upgrade,
    page,
    setPage,
    project,
    setProject,
    ready,
    setReady,
    message,
    setMessage,
    saved,
    setSaved,
    projects,
    setProjects,
    difficulty,
    setDifficulty,
    profile,
    setProfile,
    capo,
    setCapo,
    autoCapo,
    setAutoCapo,
    transpose,
    setTranspose,
    tone,
    setTone,
    view,
    setView,
    file,
    setFile,
    sourceUrl,
    setSourceUrl,
    wave,
    setWave,
    start,
    setStart,
    length,
    setLength,
    busy,
    setBusy,
    progress,
    setProgress,
    selected,
    setSelected,
    textTab,
    setTextTab,
    history,
    setHistory,
    future,
    setFuture,
    playing,
    transport,
    playbackStatus,
    get time() {
      return transport.snapshot().position;
    },
    setTime: seek,
    seek,
    pause: stop,
    rewind: () => {
      stop();
      transport.stop();
    },
    audition,
    activateNotes,
    speed,
    setSpeed,
    loop,
    setLoop,
    loopStart,
    setLoopStart,
    loopEnd,
    setLoopEnd,
    settings,
    setSettings,
    ai,
    setAI,
    useAI,
    setUseAI,
    advice,
    setAdvice,
    engineState,
    local,
    setLocal,
    localReady,
    setLocalReady,
    localMode,
    setLocalMode: chooseAnalysis,
    playStem,
    playVoice,
    repairComponents,
    compareHarmony,
    abortRef,
    audioRef,
    timerRef,
    sourceBuffer,
    inputRef,
    projectInput,
    playGeneration,
    notify,
    edit,
    notes,
    chosen,
    stale,
    stop,
    selectFile,
    analyze,
    generate,
    useDemo,
    play,
    updateNote,
    exportAs,
    openProject,
    section,
  };
}
export { errorMessage, labels };

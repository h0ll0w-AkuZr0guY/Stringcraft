import { useCallback, useEffect, useRef, useState } from "react";
import {
  validateProject,
  type Arrangement,
  type Difficulty,
  type GuitarNote,
  type MusicProject,
  type NoteEvent,
  type ArrangementGoal,
  soundingEvents,
} from "../../packages/contracts";
import { decode, transcribe } from "../../packages/music/analyze";
import { demoProject } from "../../packages/music/demo";
import {
  bootstrap,
  catalog,
  install,
  installed,
  invoke,
  load,
  loadRefiner,
} from "../../packages/plugin-host";

import { get, set } from "idb-keyval";
import { type AISettings } from "../../packages/music/advisor";
import { importMidi, importMusicXML } from "../../packages/music/import";
import { analyzeLocal, localCapabilities } from "../../packages/music/local";
import { listProjects, saveProject } from "../../packages/storage";
import { recommend, violations } from "../../plugins/guitar";
import {
  recommendForScore,
  syncPerformance,
} from "../../plugins/guitar/performance";
import {
  projectScore,
  upgradeProject,
  withReferenceTempo,
} from "../../packages/music/score";
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
  const [page, setPage] = useState<"workbench" | "projects" | "plugins">(
      "workbench",
    ),
    [project, setProject] = useState<MusicProject>(demoProject),
    [ready, setReady] = useState(false),
    [message, setMessage] = useState(""),
    [saved, setSaved] = useState("原创示例 · 尚未修改"),
    [dirty, setDirty] = useState(false),
    [projects, setProjects] = useState<MusicProject[]>([]);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal"),
    [goal, setGoal] = useState<ArrangementGoal>("accompaniment"),
    [pattern, setPattern] = useState<"strum" | "arpeggio">("strum"),
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
    [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [speed, setSpeed] = useState(1),
    [loop, setLoop] = useState(false),
    [loopStart, setLoopStart] = useState(0),
    [loopEnd, setLoopEnd] = useState(8);
  const [settings, setSettings] = useState(false),
    [ai, setAI] = useState<AISettings>({
      key: "",
      endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-plus",
    }),
    [useAI, setUseAI] = useState(false),
    [advice, setAdvice] = useState("");
  const [local, setLocal] = useState(false),
    [localReady, setLocalReady] = useState(false),
    [localMode, setLocalMode] = useState("browser");
  const abortRef = useRef<AbortController | null>(null),
    audioRef = useRef<AudioContext | null>(null),
    timerRef = useRef<ReturnType<typeof setInterval> | null>(null),
    sourceBuffer = useRef(new Map<string, AudioBuffer>()),
    inputRef = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    playGeneration = useRef(0);
  const notify = useCallback((s: string) => setMessage(s), []);
  const edit = (next: MusicProject) => {
    try {
      if (
        next.arrangement &&
        next.arrangement !== project.arrangement &&
        next.arrangement.performance
      )
        next = { ...next, arrangement: syncPerformance(next.arrangement) };
    } catch (error) {
      notify(errorMessage(error));
      return;
    }
    if (next.bpm !== project.bpm && next.score && next.score === project.score)
      next = { ...next, score: withReferenceTempo(next.score, next.bpm) };
    setDirty(true);
    setHistory((h) => [...h.slice(-39), structuredClone(project)]);
    setFuture([]);
    setProject({ ...next, updatedAt: new Date().toISOString() });
  };
  const notes = project.arrangement?.notes ?? [],
    chosen = notes.find((n) => n.id === selected);
  const stale =
    !!project.arrangement &&
    (project.arrangement.difficulty !== difficulty ||
      project.arrangement.capo !== capo ||
      project.arrangement.transpose !== transpose ||
      project.arrangement.goal !== goal ||
      project.arrangement.score?.tempo[0].bpm !== project.bpm ||
      (!!project.score &&
        JSON.stringify(project.arrangement.score) !==
          JSON.stringify(project.score)));
  function stop() {
    playGeneration.current++;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    void audioRef.current?.close().catch(() => {});
    audioRef.current = null;
    setPlaying(false);
    setTime(0);
  }
  useEffect(() => {
    let active = true;
    bootstrap()
      .then(async () => {
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
          .then(() => setSaved("已保存在此浏览器"))
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
      abortRef.current?.abort();
      if (timerRef.current) clearInterval(timerRef.current);
      void audioRef.current?.close();
    },
    [],
  );
  useEffect(() => {
    localCapabilities().then((c) => {
      setLocal(!!c?.local);
      setLocalReady(!!c?.plugin?.installed && !!c?.plugin?.ffmpeg);
    });
  }, []);
  async function selectFile(f: File) {
    if (busy) return;
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
      };
      const harmony = await load("harmony-analysis");
      const tempos = harmony.tempoCandidates!(usable);
      if (tempos.length) p.bpm = tempos[0].bpm;
      p.score = harmony.analyzeHarmony!(usable, projectScore(p));
      for (const id of [
        "melody-tracker",
        "harmony-analysis",
        ...(refinement ? ["note-refinement"] : []),
      ])
        p.pluginVersions[id] = (await installed(id))!.manifest.version;
      p.schemaVersion = 2;
      sourceBuffer.current.set(p.id, data.buffer);
      if (sourceBuffer.current.size > 3)
        sourceBuffer.current.delete(sourceBuffer.current.keys().next().value!);
      edit(p);
      setSelected(null);
      setLoopEnd(Math.min(8, p.duration));
      await set("audio:" + p.id, file);
      notify(
        detected.length
          ? `识别到 ${detected.length} 个原始候选音${refinement ? `，清理后保留 ${usable.length} 个` : ""}、${melody.length} 个旋律候选音。速度与和弦待校正，请先确认首拍。`
          : "没有检测到可靠音符，请换用更清晰片段或本地增强识别。",
      );
    } catch (e) {
      notify(control.signal.aborted ? "已取消，原项目已保留" : errorMessage(e));
    } finally {
      setBusy("");
      abortRef.current = null;
    }
  }
  async function generate() {
    stop();
    setBusy("正在编配");
    setMessage("");
    setAdvice("");
    const control = new AbortController();
    abortRef.current = control;
    try {
      const tracker = await load("melody-tracker"),
        guitar = await load("guitar-standard");
      if (project.schemaVersion === 1 && goal !== "melody")
        throw new Error(
          "请先在音乐结构中点击“升级为 v2 副本”，保留旧项目后再重编配。",
        );
      const melody = project.score
        ? soundingEvents(project.score).filter((n) => n.role === "melody")
        : project.melody.length
          ? project.melody
          : await invoke<NoteEvent[]>(
              "melody-tracker",
              "extractMelody",
              [project.refinement?.notes ?? project.notes],
              control.signal,
            );
      if ((await installed("guitar-standard"))!.manifest.version === "0.1.0")
        throw new Error("请在插件中心更新标准吉他到 0.2，再使用新的编配方式。");
      const harmony = await load("harmony-analysis");
      const baseScore = projectScore({ ...project, melody });
      const score = baseScore.chords.length
        ? baseScore
        : harmony.analyzeHarmony!(
            project.refinement?.notes ?? project.notes,
            baseScore,
          );
      const candidates = (
        goal === "melody"
          ? recommend(melody, difficulty)
          : recommendForScore(score, { difficulty, transpose, goal, pattern })
      ).slice(0, 5);
      if (!candidates.length)
        throw new Error(
          "当前没有可用指型。请先补充或校正和弦，再调整移调、变调夹或难度。",
        );
      let chosenCapo = autoCapo ? (candidates[0]?.capo ?? 0) : capo;
      if (useAI && autoCapo) {
        try {
          let advisor = await installed("bailian-advisor");
          if (!advisor) {
            const entry = (await catalog()).find(
              (m) => m.id === "bailian-advisor",
            )!;
            await install(entry);
          }
          const plugin = await load("bailian-advisor");
          const a = await plugin.advise!(
            ai,
            candidates,
            {
              notes: melody.length,
              difficulty,
            },
            control.signal,
          );
          chosenCapo = a.capo;
          const metric = candidates.find((c) => c.capo === a.capo);
          if (!metric) throw new Error("AI 返回了候选以外的结果");
          setAdvice(
            `AI 选择 Capo ${a.capo}；本地演奏候选评分 ${metric.score.toFixed(2)}。请试听核对。`,
          );
        } catch (e) {
          setAdvice(errorMessage(e) + "，已使用本地规则。");
        }
      }
      const input = melody;
      const arrangement = await invoke<Arrangement>(
        "guitar-standard",
        "arrange",
        [
          input,
          {
            difficulty,
            capo: chosenCapo,
            transpose,
            bpm: project.bpm,
            previous: project.arrangement?.notes,
            goal,
            score,
            pattern,
          },
        ],
        control.signal,
      );
      const versions = { ...project.pluginVersions };
      for (const id of [
        "guitar-standard",
        "melody-tracker",
        "standard-exporters",
      ])
        versions[id] = (await installed(id))!.manifest.version;
      setCapo(chosenCapo);
      edit({
        ...project,
        schemaVersion: project.schemaVersion,
        score,
        melody,
        arrangement,
        pluginVersions: versions,
      });
      setSelected(null);
      notify(
        `编配完成：${goal === "accompaniment" ? "和弦伴奏" : goal === "fingerstyle" ? "独奏指弹" : "单线练习"}，${arrangement.notes.length} 个发声事件。请逐小节核对并试弹。`,
      );
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setBusy("");
      abortRef.current = null;
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
  async function play(source = false) {
    stop();
    const generation = playGeneration.current;
    const ctx = new AudioContext();
    audioRef.current = ctx;
    await ctx.resume();
    const from = loop ? loopStart : 0,
      to = loop ? Math.min(loopEnd, project.duration) : project.duration;
    if (to <= from) {
      notify("循环结束必须大于起点");
      stop();
      return;
    }
    try {
      let origin = ctx.currentTime + 0.06;
      if (source && !sourceBuffer.current.has(project.id)) {
        const original = await get<File>("audio:" + project.id);
        if (!original)
          throw new Error(
            "该项目没有原音频。请重新选择源文件进行分析；原曲对照不会使用合成音代替。",
          );
        sourceBuffer.current.set(
          project.id,
          await ctx.decodeAudioData(await original.arrayBuffer()),
        );
      }
      if (source) {
        const s = ctx.createBufferSource();
        s.buffer = sourceBuffer.current.get(project.id)!;
        s.playbackRate.value = speed;
        s.connect(ctx.destination);
        s.start(origin, project.sourceOffset + from, to - from);
      } else {
        const renderer = await load("guitar-samples");
        const result = await renderer.scheduleAudio!(
          ctx,
          source ? project.notes : notes,
          tone,
          from,
          to,
          speed,
        );
        origin = result.origin;
        if (result.fallback && tone !== "synth")
          notify(`${result.fallback} 个音符使用合成音回退，其余使用实录采样。`);
      }
      if (generation !== playGeneration.current || ctx.state === "closed")
        return;
      setPlaying(true);
      timerRef.current = setInterval(() => {
        const t = from + Math.max(0, ctx.currentTime - origin) * speed;
        setTime(Math.min(t, to));
        if (t >= to) {
          stop();
          if (loop) void play(source);
        }
      }, 40);
    } catch (e) {
      if (generation === playGeneration.current) {
        stop();
        notify(errorMessage(e));
      }
    }
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
  async function exportAs(format: string) {
    try {
      if (format === "wav") {
        setBusy("正在渲染 WAV");
        const renderer = await load("guitar-samples");
        const r = await renderer.renderAudio!(notes, project.duration, tone);
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
  async function openProject(p: MusicProject) {
    stop();
    try {
      validateProject(p);
      edit(p);
      if (p.arrangement) {
        setGoal(p.arrangement.goal ?? "melody");
        setDifficulty(p.arrangement.difficulty);
        setCapo(p.arrangement.capo);
        setAutoCapo(false);
        setTranspose(p.arrangement.transpose);
      }
      const audio = await get<File>("audio:" + p.id);
      setFile(audio ?? null);
      setSourceUrl(audio ? URL.createObjectURL(audio) : "");

      if (audio) {
        const ctx = new AudioContext();
        try {
          sourceBuffer.current.set(
            p.id,
            await ctx.decodeAudioData(await audio.arrayBuffer()),
          );
        } finally {
          await ctx.close();
        }
      }
      setWave([]);
      setPage("workbench");
      setSelected(null);
    } catch (e) {
      notify(errorMessage(e));
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
    if (p === "projects")
      listProjects()
        .then(setProjects)
        .catch((e) => notify(errorMessage(e)));
  };
  return {
    refineGuitar,
    setRefineGuitar,
    goal,
    setGoal,
    pattern,
    setPattern,
    upgrade: () => edit(upgradeProject(project)),
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
    setPlaying,
    time,
    setTime,
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
    local,
    setLocal,
    localReady,
    setLocalReady,
    localMode,
    setLocalMode,
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

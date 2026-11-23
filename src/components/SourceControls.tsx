import GenerationFeedback from "./GenerationFeedback";
import {
  ArrowUpRight,
  AudioLines,
  Check,
  Guitar,
  LoaderCircle,
  LockKeyhole,
  Music2,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import { type Difficulty } from "../../packages/contracts";

import { useWorkbenchContext } from "../hooks/WorkbenchContext";
import { labels } from "../hooks/useWorkbench";
export default function SourceControls() {
  const {
    section,
    inputRef,
    selectFile,
    file,
    local,
    localMode,
    setLocalMode,
    localReady,
    start,
    setStart,
    length,
    setLength,
    ready,
    busy,
    analyze,
    progress,
    abortRef,
    project,
    refineGuitar,
    setRefineGuitar,
    difficulty,
    setDifficulty,
    goal,
    setGoal,
    pattern,
    setPattern,
    autoCapo,
    capo,
    setAutoCapo,
    setCapo,
    transpose,
    setTranspose,
    edit,
    tone,
    stop,
    setTone,
    useAI,
    setUseAI,
    ai,
    setSettings,
    notes,
    generate,
    advice,
    generation,
    advanced,
    setAdvanced,
  } = useWorkbenchContext();
  return (
    <aside className="controls-column">
      <section className="panel source-panel">
        <div className="panel-heading">
          <span className="panel-symbol">
            <AudioLines size={18} />
          </span>
          <h2>选择音乐</h2>
          <span className="step-label">SOURCE</span>
        </div>
        <div
          className="dropzone"
          role="button"
          tabIndex={0}
          aria-label="选择音频或乐谱文件"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter") inputRef.current?.click();
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files[0])
              void selectFile(e.dataTransfer.files[0]);
          }}
        >
          <span className="upload-circle">
            <Upload size={24} />
          </span>
          <strong>{file ? file.name : "把喜欢的音乐，放进来"}</strong>
          <span>点击上传，或拖放文件到这里</span>
          <small>MP3 / WAV / FLAC / MIDI / MusicXML</small>
        </div>
        <input
          ref={inputRef}
          type="file"
          className="visually-hidden"
          accept="audio/*,video/*,.mid,.midi,.musicxml,.xml"
          onChange={(e) => {
            if (e.target.files?.[0]) void selectFile(e.target.files[0]);
            e.target.value = "";
          }}
          data-testid="audio-input"
        />
        {file && (
          <>
            {localMode === "browser" && (
              <label className="refinement-option">
                <span>
                  <input
                    type="checkbox"
                    aria-label="清理弱音候选"
                    checked={refineGuitar}
                    onChange={(e) => setRefineGuitar(e.target.checked)}
                  />{" "}
                  清理弱音候选（实验）
                </span>
                <small>
                  适合清晰吉他录音，可能漏掉弱和弦音。下次分析应用，原候选始终保留。
                </small>
              </label>
            )}
            {local && (
              <label className="local-mode">
                分析方式
                <select
                  value={localMode}
                  onChange={(e) => setLocalMode(e.target.value)}
                >
                  <option value="browser">浏览器片段识别</option>
                  <option value="transcribe" disabled={!localReady}>
                    本地整曲识别
                  </option>
                  <option value="vocals" disabled={!localReady}>
                    分离人声，再提取旋律
                  </option>
                  <option value="instrumental" disabled={!localReady}>
                    分离伴奏，再识别音符
                  </option>
                </select>
                {!localReady && <small>请将增强环境包解压到应用目录</small>}
              </label>
            )}
            <div className="field-row">
              <label>
                起点（秒）
                <input
                  type="number"
                  min="0"
                  value={start}
                  onChange={(e) =>
                    setStart(Math.max(0, Number(e.target.value)))
                  }
                />
              </label>
              <label>
                片段（秒）
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={length}
                  onChange={(e) =>
                    setLength(Math.max(1, Math.min(60, Number(e.target.value))))
                  }
                />
              </label>
            </div>
            <button
              className="button primary full"
              disabled={!ready || !!busy}
              onClick={analyze}
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <AudioLines size={16} />
              )}
              分析音乐片段
            </button>
          </>
        )}
        {busy && generation?.status !== "running" && (
          <div className="progress-box">
            <progress max="1" value={progress} />
            <span>
              {busy}
              {progress > 0 ? " " + Math.round(progress * 100) + "%" : ""}
            </span>
            <button
              className="text-button"
              onClick={() => abortRef.current?.abort()}
            >
              取消
            </button>
          </div>
        )}
        <div className="source-summary">
          <span className="source-icon">
            <Music2 size={17} />
          </span>
          <div>
            <strong>{project.name}</strong>
            <span>
              {project.sourceKind === "demo"
                ? "原创示例 · 预先编写，未经识别"
                : project.sourceKind === "audio"
                  ? project.pluginVersions["local-separation"]
                    ? "本地增强 · 模型识别"
                    : "Basic Pitch · 模型识别"
                  : "乐谱导入"}{" "}
              · {project.duration.toFixed(1)}s
            </span>
          </div>
          <Check size={16} />
        </div>
        <div className="source-footer">
          <LockKeyhole size={13} />
          <span>基础识别在浏览器内完成</span>
        </div>
      </section>
      <section className="panel settings-panel">
        <div className="panel-heading">
          <span className="panel-symbol">
            <SlidersHorizontal size={18} />
          </span>
          <h2>我的弹奏方式</h2>
          <span className="step-label">ARRANGE</span>
        </div>
        <fieldset className="basic-arrange-settings" disabled={!!busy}>
          <div className="field-header">
            <label>弹奏难度</label>
            <span>循序渐进，找到手感</span>
          </div>
          <label>
            编配目标
            <select
              aria-label="编配目标"
              value={goal}
              onChange={(e) => setGoal(e.target.value as typeof goal)}
            >
              <option value="accompaniment">和弦伴奏 · 为弹唱留出空间</option>
              <option value="fingerstyle">独奏指弹 · 旋律与低音</option>
              <option value="melody">单线旋律练习</option>
            </select>
          </label>
          {goal === "accompaniment" && (
            <label>
              伴奏手法
              <select
                aria-label="伴奏手法"
                value={pattern}
                onChange={(e) => setPattern(e.target.value as typeof pattern)}
              >
                <option value="strum">扫弦</option>
                <option value="arpeggio">分解和弦</option>
              </select>
            </label>
          )}
          <div className="difficulty-grid">
            {Object.entries(labels).map(([d, label], i) => (
              <button
                key={d}
                className={difficulty === d ? "selected" : ""}
                onClick={() => {
                  setDifficulty(d as Difficulty);
                  setGoal(
                    d === "easy" || d === "normal"
                      ? "accompaniment"
                      : "fingerstyle",
                  );
                }}
              >
                <span className="difficulty-dots">
                  {Array.from({ length: 4 }, (_, j) => (
                    <i key={j} className={j <= i ? "filled" : ""} />
                  ))}
                </span>
                <strong>{label}</strong>
              </button>
            ))}
          </div>
          <p className="difficulty-description">
            {difficulty === "easy"
              ? "简化和弦伴奏，稳定节奏，留出换和弦的准备时间。"
              : difficulty === "normal"
                ? "常用和弦与扫弦或分解节奏，为弹唱留出空间。"
                : difficulty === "hard"
                  ? "以旋律和独立低音构成指弹，优先保持乐句。"
                  : "保留独奏结构，处理连奏和指法；不通过堆叠音符增加难度。"}
          </p>
        </fieldset>
        <details
          className="generation-advanced-controls"
          open={advanced}
          onToggle={(e) => {
            if (e.currentTarget.open !== advanced)
              setAdvanced(e.currentTarget.open);
          }}
        >
          <summary>高级设置：变调、速度与 AI</summary>
          <fieldset disabled={!!busy}>
            <div className="field-row">
              <label>
                变调夹
                <select
                  aria-label="变调夹"
                  value={autoCapo ? "auto" : capo}
                  onChange={(e) => {
                    setAutoCapo(e.target.value === "auto");
                    if (e.target.value !== "auto")
                      setCapo(Number(e.target.value));
                  }}
                >
                  <option value="auto">自动推荐</option>
                  {Array.from({ length: 13 }, (_, i) => (
                    <option value={i} key={i}>
                      {i === 0 ? "不使用" : i + " 品"}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                移调（半音）
                <input
                  aria-label="移调"
                  type="number"
                  min="-12"
                  max="12"
                  value={transpose}
                  onChange={(e) =>
                    setTranspose(
                      Math.max(-12, Math.min(12, Number(e.target.value))),
                    )
                  }
                />
              </label>
            </div>
            <div className="field-row">
              <label>
                参考速度 BPM
                <input
                  aria-label="参考速度 BPM"
                  type="number"
                  min="20"
                  max="300"
                  value={Number(project.bpm.toFixed(1))}
                  onChange={(e) =>
                    edit({
                      ...project,
                      bpm: Math.max(20, Math.min(300, Number(e.target.value))),
                    })
                  }
                />
              </label>
              <label>
                吉他音色
                <select
                  value={tone}
                  onChange={(e) => {
                    stop();
                    setTone(e.target.value);
                  }}
                >
                  <option value="steel">钢弦 · 实录采样</option>
                  <option value="nylon">尼龙 · 实录采样</option>
                  <option value="synth">合成拨弦</option>
                </select>
              </label>
            </div>
            <label className="toggle-row">
              <span>
                <strong>AI 辅助建议</strong>
                <small>可选 · 使用自己的百炼 Key</small>
              </span>
              <input
                type="checkbox"
                checked={useAI}
                onChange={(e) => {
                  setUseAI(e.target.checked);
                  if (e.target.checked && !ai.key) setSettings(true);
                }}
              />
            </label>
          </fieldset>
        </details>
        <button
          className="button accent full generate-button"
          disabled={!ready || !!busy || !project.notes.length}
          onClick={generate}
        >
          {generation?.status === "running" ? (
            <LoaderCircle size={18} className="spin" />
          ) : (
            <Guitar size={18} />
          )}
          {generation?.status === "running"
            ? "正在生成，请稍候…"
            : "生成吉他编配"}
        </button>
        <GenerationFeedback />
        <p className="center-caption">先生成谱面，再试听和校正</p>
        {advice && <p className="advice">{advice}</p>}
      </section>
      <div className="tip-card">
        <span>一点小提示</span>
        <p>
          先用 15–30
          秒的清晰旋律试一试。复杂混音可以交给本地增强版，再回来慢慢校谱。
        </p>
        <a href="docs/USAGE.html" target="_blank" rel="noreferrer">
          了解在线与本地的区别 <ArrowUpRight size={13} />
        </a>
      </div>
    </aside>
  );
}

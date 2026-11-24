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
import ArrangementChoices from "./ArrangementChoices";
import AnalysisEngine from "./AnalysisEngine";
import ChordDiagrams from "./ChordDiagrams";
import MusicalStructure from "./MusicalStructure";
import ReferenceSettings from "./ReferenceSettings";

import { useWorkbenchContext } from "../hooks/WorkbenchContext";
export default function SourceControls({
  tab,
}: {
  tab: "arrange" | "analysis" | "harmony" | "notes";
}) {
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
    notes,
    generate,
    advice,
    generation,
    profile,
    setProfile,
  } = useWorkbenchContext();
  return (
    <aside className="controls-column">
      {tab === "analysis" && <ReferenceSettings />}
      <section className="panel source-panel" hidden={tab !== "analysis"}>
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
        <AnalysisEngine />
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
          <span>
            {localMode === "accompaniment"
              ? "离线模型在本机运行"
              : "基础识别在浏览器内完成"}
          </span>
        </div>
      </section>
      <section className="panel settings-panel" hidden={tab !== "arrange"}>
        <div className="panel-heading">
          <span className="panel-symbol">
            <SlidersHorizontal size={18} />
          </span>
          <h2>我的弹奏方式</h2>
          <span className="step-label">ARRANGE</span>
        </div>
        <ArrangementChoices />
        <label className="algorithm-setting">
          编配算法
          <select
            value={profile}
            onChange={(e) =>
              setProfile(e.target.value === "phrasing" ? "phrasing" : "classic")
            }
            disabled={!!busy}
          >
            <option value="classic">稳定版 · 沿用 local.4</option>
            <option value="phrasing">乐句实验 · 低音证据与演奏动作</option>
          </select>
        </label>
        <details className="generation-advanced-controls">
          <summary>高级设置：变调、速度与音色</summary>
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
      {tab === "harmony" && (
        <>
          <MusicalStructure />
          <ChordDiagrams />
        </>
      )}
    </aside>
  );
}

import {
  Download,
  PanelRight,
  SlidersHorizontal,
  Upload,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useWorkbenchContext } from "../hooks/WorkbenchContext";
import GenerationFeedback from "./GenerationFeedback";
import NoteEditor from "./NoteEditor";
import ScorePanel, { printTab } from "./ScorePanel";
import SharedTransport from "./SharedTransport";
import ArrangementChoices from "./ArrangementChoices";
import SourceControls from "./SourceControls";
import "./workspace.css";

export default function UnifiedWorkspace() {
  const c = useWorkbenchContext();
  const desktop = !!(window as Window & { chrome?: { webview?: unknown } })
    .chrome?.webview;
  const [controls, setControls] = useState(false),
    [exporting, setExporting] = useState(false),
    [extras, setExtras] = useState(false),
    [trackDrawer, setTrackDrawer] = useState(false);
  const [professional, setProfessional] = useState(false);
  const [settingsTab, setSettingsTab] = useState<
    "arrange" | "analysis" | "harmony" | "notes"
  >("arrange");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (c.advanced) {
      setProfessional(true);
      setSettingsTab("harmony");
      setControls(true);
    }
  }, [c.advanced]);
  const visible = c.tracks.filter(
    (t) => extras || !["bass", "drums", "other"].includes(t.role),
  );
  const chooseView = (view: "notes" | "tab" | "rhythm") => {
    c.setMode(view === "notes" ? "editor" : "guitar");
    if (view !== "notes") {
      c.setView(view);
    }
  };
  const togglePlay = () => {
    if (c.transport.snapshot().status !== "paused") c.pause();
    else void c.playTracks();
  };
  return (
    <section
      ref={root}
      data-professional={professional}
      className={`unified-workspace ${c.inspectorOpen ? "inspector-open" : ""} ${c.filtersOpen ? "filters-open" : ""}`}
      aria-label="多轨音乐工作台"
      onKeyDown={(e) => {
        if (
          e.code === "Space" &&
          !["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(
            (e.target as HTMLElement).tagName,
          ) &&
          !(e.target as HTMLElement).closest('[role="application"]')
        ) {
          e.preventDefault();
          togglePlay();
        }
      }}
    >
      <header className="workspace-title">
        <div>
          <strong>{c.project.name}</strong>
          <small>
            {desktop ? c.saved.replace("此浏览器", "本机") : c.saved} ·{" "}
            {c.project.tracks?.length ? "独立分轨" : "原始 / 导入音乐"}
          </small>
        </div>
        <button
          className="button secondary small"
          disabled={
            !c.ready ||
            !!c.busy ||
            (c.local && c.engineState?.status === "checking")
          }
          onClick={() =>
            root.current
              ?.querySelector<HTMLInputElement>(
                '[data-testid="whole-audio-input"]',
              )
              ?.click()
          }
        >
          <Upload size={15} />
          上传音频 / MIDI
        </button>
        <div className="workspace-mode" role="group" aria-label="界面模式">
          <button
            type="button"
            aria-pressed={!professional}
            onClick={() => {
              setProfessional(false);
              setControls(false);
              c.setInspectorOpen(false);
              c.setFiltersOpen(false);
            }}
          >
            常规模式
          </button>
          <button
            type="button"
            aria-pressed={professional}
            onClick={() => {
              setProfessional(true);
              setControls(true);
            }}
          >
            专业模式
          </button>
        </div>
        {professional && !controls && (
          <button
            className="button secondary small"
            onClick={() => setControls(true)}
          >
            <SlidersHorizontal size={15} />
            编配与分析设置
          </button>
        )}
        <div className="workspace-export">
          <button
            className="button secondary small"
            aria-expanded={exporting}
            onClick={() => setExporting(!exporting)}
          >
            <Download size={15} />
            导出
          </button>
          {exporting && (
            <div className="export-menu">
              <button onClick={() => void c.exportAs("project")}>
                导出项目 JSON
              </button>
              <button
                disabled={!c.local || !!c.busy}
                onClick={() => void c.exportBundle()}
              >
                导出含音频工程
              </button>
              {c.project.arrangement && (
                <>
                  <button onClick={() => void c.exportAs("midi")}>
                    编配 MIDI
                  </button>
                  <button onClick={() => void c.exportAs("wav")}>
                    编配 WAV
                  </button>
                  <button onClick={() => void c.exportAs("musicxml")}>
                    编配 MusicXML
                  </button>
                  <button
                    onClick={() => {
                      setControls(false);
                      setExporting(false);
                      chooseView("tab");
                      setTimeout(printTab, 100);
                    }}
                  >
                    打印六线谱 PDF
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </header>
      {!controls && (
        <div className="arrangement-bar">
          <ArrangementChoices compact />{" "}
          <button
            className="button accent small"
            disabled={
              !c.ready || !!c.busy || !c.tracks.some((t) => t.notes.length)
            }
            onClick={() => void c.generate()}
          >
            {c.generation?.status === "running"
              ? "正在生成，请稍候…"
              : "生成吉他编配"}
          </button>
        </div>
      )}
      <SharedTransport professional={professional} />
      <div className="workspace-feedback">
        <GenerationFeedback result />
        {c.message.includes("工作台组件需要") && (
          <button
            className="button secondary small"
            onClick={() => void c.repairComponents()}
          >
            修复工作台组件
          </button>
        )}
        {c.busy && c.generation?.status !== "running" && (
          <div className="analysis-task">
            <span>{c.busy}</span>
            <progress max={1} value={c.progress} />
            <button onClick={() => c.abortRef.current?.abort()}>取消</button>
          </div>
        )}
      </div>
      <div className="workspace-content" hidden={controls}>
        <aside
          className={`track-list ${trackDrawer ? "tracks-open" : ""}`}
          aria-label="工程轨道"
        >
          <header>
            <strong>轨道</strong>
            <button
              className="text-button"
              onClick={() => setTrackDrawer(false)}
            >
              收起
            </button>
          </header>
          {visible.map((t) => (
            <article
              key={t.id}
              className={`track-row ${t.id === c.activeTrackId ? "selected" : ""}`}
              data-track-id={t.id}
            >
              <button
                className="track-select"
                aria-pressed={t.id === c.activeTrackId}
                onClick={() => {
                  c.selectTrack(t.id);
                  if (!professional && t.role === "arrangement")
                    chooseView("tab");
                  setTrackDrawer(false);
                }}
              >
                <span>{t.name}</span>
                <small>
                  {t.role === "vocal" && !t.analysisRevision
                    ? "音频已分离 · 旋律待分析"
                    : t.notes.length
                      ? `${t.notes.length} 个音符`
                      : t.asset
                        ? "独立音频"
                        : "暂无音符"}
                </small>
              </button>
              <div
                className="track-actions"
                hidden={!professional && c.monitorMode !== "mix"}
              >
                {c.monitorMode === "mix" && (
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`${t.name}加入混合`}
                      checked={c.mixTrackIds.has(t.id)}
                      onChange={(e) =>
                        c.setMixTrackIds((ids) => {
                          const next = new Set(ids);
                          e.target.checked ? next.add(t.id) : next.delete(t.id);
                          return next;
                        })
                      }
                    />
                    混合
                  </label>
                )}
                <button
                  aria-label={`独听${t.name}`}
                  aria-pressed={c.soloTrackId === t.id}
                  onClick={() => {
                    c.setSoloTrackId(c.soloTrackId === t.id ? null : t.id);
                  }}
                >
                  独听
                </button>
                <button
                  aria-label={`静音${t.name}`}
                  aria-pressed={c.mutedTracks.has(t.id)}
                  onClick={() => {
                    c.setMutedTracks((ids) => {
                      const next = new Set(ids);
                      next.has(t.id) ? next.delete(t.id) : next.add(t.id);
                      return next;
                    });
                  }}
                >
                  静音
                </button>
                <details>
                  <summary aria-label={`${t.name}音量`}>
                    <Volume2 size={13} />
                  </summary>
                  <input
                    type="range"
                    aria-label={`${t.name}音量值`}
                    min={0}
                    max={1.5}
                    step={0.05}
                    value={c.trackVolumes[t.id] ?? 1}
                    onChange={(e) => {
                      c.setTrackVolumes((v) => ({
                        ...v,
                        [t.id]: Number(e.target.value),
                      }));
                    }}
                  />
                </details>
              </div>
              {professional && t.role === "vocal" && !t.analysisRevision && (
                <button
                  className="text-button"
                  disabled={!!c.busy || !c.localReady}
                  onClick={() =>
                    void c.analyzeVocalTrack().catch((e) => c.notify(String(e)))
                  }
                >
                  分析人声旋律
                </button>
              )}
            </article>
          ))}
          {professional &&
            c.tracks.some((t) =>
              ["bass", "drums", "other"].includes(t.role),
            ) && (
              <button
                className="text-button"
                onClick={() => setExtras(!extras)}
              >
                {extras ? "收起伴奏声部" : "展开低音、鼓与其他器乐"}
              </button>
            )}
          <p className="track-help">
            伴奏包含低音、鼓与其他器乐。扫弦与单线练习用器乐，指弹按需分析人声。
          </p>
        </aside>
        <div className="workspace-main">
          <nav className="score-view-tabs" aria-label="谱面视图">
            <button
              className="mobile-tracks"
              onClick={() => setTrackDrawer(!trackDrawer)}
            >
              轨道
            </button>
            <button
              aria-pressed={c.mode === "editor"}
              onClick={() => chooseView("notes")}
            >
              音符
            </button>
            <button
              aria-pressed={c.mode === "guitar" && c.view === "tab"}
              onClick={() => chooseView("tab")}
            >
              六线谱
            </button>
            <button
              aria-pressed={c.mode === "guitar" && c.view === "rhythm"}
              onClick={() => chooseView("rhythm")}
            >
              节奏谱
            </button>
            <span />
            <button
              hidden={!professional}
              aria-pressed={c.filtersOpen}
              onClick={() => c.setFiltersOpen(!c.filtersOpen)}
            >
              筛选
            </button>
            <button
              hidden={!professional}
              aria-pressed={c.inspectorOpen}
              onClick={() => c.setInspectorOpen(!c.inspectorOpen)}
            >
              <PanelRight size={14} />
              属性
            </button>
          </nav>
          <div className="view-pane" hidden={c.mode !== "editor"}>
            <NoteEditor professional={professional} />
          </div>
          <div className="view-pane" hidden={c.mode !== "guitar"}>
            <ScorePanel professional={professional} shown={!controls} />
          </div>
        </div>
      </div>
      {controls && (
        <section className="professional-page" aria-label="编配与分析设置">
          <header className="professional-toolbar">
            <nav aria-label="专业配置分类">
              {(
                [
                  ["arrange", "编配"],
                  ["analysis", "识别与分轨"],
                  ["harmony", "节拍与和弦"],
                  ["notes", "音符与指法"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={settingsTab === id}
                  onClick={() => setSettingsTab(id)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <button
              className="button secondary small"
              aria-label="关闭设置"
              onClick={() => {
                c.setAdvanced(false);
                setControls(false);
              }}
            >
              返回谱面
            </button>
          </header>
          <div className="professional-content">
            <SourceControls tab={settingsTab} />
            {settingsTab === "notes" && (
              <section className="panel professional-notes">
                <h2>音符与指法</h2>
                <p>
                  在音符视图筛选和校订识别结果，或在六线谱查看指法与编辑弦位。
                </p>
                <button
                  className="button secondary small"
                  onClick={() => {
                    chooseView("notes");
                    c.setFiltersOpen(true);
                    setControls(false);
                  }}
                >
                  打开音符编辑器
                </button>
                <button
                  className="button secondary small"
                  onClick={() => {
                    chooseView("tab");
                    c.setInspectorOpen(true);
                    setControls(false);
                  }}
                >
                  打开六线谱编辑
                </button>
              </section>
            )}
          </div>
        </section>
      )}
    </section>
  );
}

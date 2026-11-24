import {
  Download,
  Guitar,
  LockKeyhole,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useState } from "react";
import { type GuitarNote } from "../../packages/contracts";
import { noteName } from "../../packages/music/demo";
import ArrangementDraftPanel from "./ArrangementDraftPanel";

import { violations } from "../../plugins/guitar";
import { RhythmScore, Tablature } from "./Tablature";

import { useWorkbenchContext } from "../hooks/WorkbenchContext";
import { useTransport } from "../hooks/useTransport";
export default function ScorePanel({
  professional,
  shown,
  zoom = 1,
}: {
  professional: boolean;
  shown: boolean;
  zoom?: number;
}) {
  const controller = useWorkbenchContext();
  const { position: time } = useTransport(
    controller.transport,
    controller.mode === "guitar" && shown,
  );
  const {
    section,
    project,
    difficulty,
    capo,
    notes,
    length,
    busy,
    stop,
    stale,
    view,
    setView,
    history,
    setFuture,
    setProject,
    setHistory,
    future,
    selected,
    setSelected,
    textTab,
    chosen,
    start,
    updateNote,
    notify,
    edit,
    transpose,
    exportAs,
    generation,
  } = useWorkbenchContext();
  return (
    <section className="panel score-panel">
      {professional && (
        <details className="score-analysis">
          <summary>编配依据与声部试听</summary>
          <ArrangementDraftPanel />
        </details>
      )}
      {stale && (
        <p className="stale-note">
          设置已改变，谱面仍为上次结果。重新生成后应用新设置。
        </p>
      )}

      <div className="notation-toolbar">
        <div className="tabs">
          <button
            className={view === "tab" ? "active" : ""}
            onClick={() => setView("tab")}
          >
            六线谱
          </button>
          <button
            className={view === "rhythm" ? "active" : ""}
            onClick={() => setView("rhythm")}
          >
            节奏谱
          </button>
          <button
            className={view === "text" ? "active" : ""}
            onClick={() => setView("text")}
          >
            文本谱
          </button>
        </div>
        <div className="edit-toolbar">
          <button
            className="icon-button"
            title="撤销"
            aria-label="撤销"
            disabled={!history.length}
            onClick={() => {
              stop();
              setFuture((f) => [project, ...f]);
              setProject(history.at(-1)!);
              setHistory((h) => h.slice(0, -1));
            }}
          >
            <Undo2 size={16} />
          </button>
          <button
            className="icon-button"
            title="重做"
            aria-label="重做"
            disabled={!future.length}
            onClick={() => {
              stop();
              setHistory((h) => [...h, project]);
              setProject(future[0]);
              setFuture((f) => f.slice(1));
            }}
          >
            <Redo2 size={16} />
          </button>
          <span />
        </div>
      </div>
      <div className="notation-body" id="guitar-notation">
        {!notes.length ? (
          <div className="empty-panel">
            <Guitar size={48} />
            <h3>
              {generation?.status === "running"
                ? "正在生成你的吉他谱…"
                : generation?.status === "error"
                  ? "本次生成尚未完成"
                  : generation?.status === "cancelled"
                    ? "生成已取消"
                    : "音乐已就绪，下一步生成吉他谱"}
            </h3>
            <p>
              {generation
                ? generation.message
                : "选择弹奏目标和难度，点击「生成吉他编配」。"}
            </p>
          </div>
        ) : view === "tab" ? (
          <Tablature
            project={project}
            selected={selected}
            onSelect={(n) => {
              setSelected(n.id);
              if (professional) controller.setInspectorOpen(true);
              controller.activateNotes([n], n.start, true);
            }}
            time={time}
            zoom={zoom}
            professional={professional}
            onSeek={controller.seek}
          />
        ) : view === "rhythm" ? (
          <RhythmScore
            project={project}
            time={time}
            zoom={zoom}
            professional={professional}
            onActivate={(ns, at) => {
              if (ns[0]) setSelected(ns[0].id);
              if (professional) controller.setInspectorOpen(true);
              controller.activateNotes(ns, at, true);
            }}
          />
        ) : (
          <pre className="text-tab">{textTab}</pre>
        )}
      </div>
      <div className="notation-hint">
        <span>
          <i className="legend-dot" />
          主旋律 <i className="legend-line" />
          持续时间
        </span>
        <span>
          {professional ? "点击音符试听与校订" : "点击音符试听与定位"} ·
          品位相对变调夹
        </span>
      </div>
      {chosen && controller.inspectorOpen && (
        <div className="note-editor">
          <div className="note-editor-heading">
            <strong>
              {chosen.dead
                ? `${chosen.string}弦闷音`
                : noteName(chosen.pitch.midi)}{" "}
              <small>音符编辑</small>
            </strong>
            <button
              className="icon-button"
              onClick={() => setSelected(null)}
              aria-label="关闭音符编辑"
            >
              <X size={16} />
            </button>
          </div>
          <div className="note-fields">
            <label>
              起音（秒）
              <input
                type="number"
                min="0"
                max={project.duration - 0.01}
                step=".01"
                value={chosen.start}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v >= 0 && v < project.duration)
                    updateNote(chosen.id, { start: v });
                }}
              />
            </label>
            <label>
              时长（秒）
              <input
                type="number"
                min=".03"
                step=".01"
                value={chosen.duration}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (v > 0 && v <= project.duration - chosen.start)
                    updateNote(chosen.id, { duration: v });
                }}
              />
            </label>
            <label>
              弦
              <select
                aria-label="编辑弦号"
                value={chosen.string}
                onChange={(e) => {
                  const string = Number(e.target.value);
                  if (chosen.dead) {
                    updateNote(chosen.id, {
                      string,
                      fret: 0,
                      pitch: {
                        midi:
                          [64, 59, 55, 50, 45, 40][string - 1] +
                          (project.arrangement?.capo ?? 0),
                      },
                    });
                    return;
                  }
                  const fret =
                    chosen.pitch.midi -
                    [64, 59, 55, 50, 45, 40][string - 1] -
                    (project.arrangement?.capo ?? 0);
                  if (fret < 0) {
                    notify("该音高在所选弦不可弹");
                    return;
                  }
                  updateNote(chosen.id, { string, fret });
                }}
              >
                {[1, 2, 3, 4, 5, 6].map((s) => (
                  <option key={s} value={s}>
                    {s} 弦
                  </option>
                ))}
              </select>
            </label>
            <label>
              品
              <input
                type="number"
                disabled={!!chosen.dead}
                min="0"
                max="24"
                value={chosen.fret}
                onChange={(e) => {
                  const fret = Number(e.target.value);
                  updateNote(chosen.id, {
                    fret,
                    pitch: {
                      midi:
                        [64, 59, 55, 50, 45, 40][chosen.string - 1] +
                        (project.arrangement?.capo ?? 0) +
                        fret,
                    },
                  });
                }}
              />
            </label>
            <label>
              演奏动作
              <select
                aria-label="编辑演奏动作"
                value={chosen.dead ? "dead" : (chosen.attack ?? "pluck")}
                onChange={(e) => {
                  const attack = e.target.value as GuitarNote["attack"];
                  const linked =
                    attack === "hammer" ||
                    attack === "pull" ||
                    attack === "slide";
                  const previous = linked
                    ? notes
                        .filter(
                          (n) =>
                            n.id !== chosen.id &&
                            !n.dead &&
                            n.string === chosen.string &&
                            n.start < chosen.start &&
                            Math.abs(n.start + n.duration - chosen.start) <
                              0.001,
                        )
                        .sort((a, b) => b.start - a.start)[0]
                    : undefined;
                  if (linked && !previous) {
                    notify(
                      "请先让前一个同弦音的结束时间与当前起音相接，再设置连奏。",
                    );
                    return;
                  }
                  updateNote(chosen.id, {
                    attack,
                    dead: attack === "dead" ? true : undefined,
                    linkFrom: previous?.id,
                    technique:
                      attack === "hammer"
                        ? "h"
                        : attack === "pull"
                          ? "p"
                          : undefined,
                    stroke: undefined,
                    strokeId: undefined,
                    ...(attack === "dead"
                      ? {
                          fret: 0,
                          leftFinger: 0,
                          pitch: {
                            midi:
                              [64, 59, 55, 50, 45, 40][chosen.string - 1] +
                              (project.arrangement?.capo ?? 0),
                          },
                        }
                      : {}),
                  });
                }}
              >
                <option value="pluck">独立拨弦</option>
                <option value="hammer">击弦 h</option>
                <option value="pull">勾弦 p</option>
                <option value="slide">滑音 /</option>
                <option value="dead">闷音 ×</option>
                {chosen.attack === "strum" && (
                  <option value="strum" disabled>
                    扫弦组（当前）
                  </option>
                )}
              </select>
            </label>
            <button
              className={`icon-button ${chosen.locked ? "locked" : ""}`}
              title={chosen.locked ? "解锁" : "锁定"}
              aria-label={chosen.locked ? "解锁音符" : "锁定音符"}
              onClick={() => {
                edit({
                  ...project,
                  arrangement: {
                    ...project.arrangement!,
                    notes: notes.map((n) =>
                      n.id === chosen.id ? { ...n, locked: !n.locked } : n,
                    ),
                  },
                });
              }}
            >
              <LockKeyhole size={17} />
            </button>
            <button
              className="icon-button danger"
              title="删除音符"
              onClick={() => {
                edit({
                  ...project,
                  arrangement: {
                    ...project.arrangement!,
                    notes: notes.filter((n) => n.id !== chosen.id),
                  },
                });
                setSelected(null);
              }}
            >
              <Trash2 size={17} />
            </button>
          </div>
          <p className="muted">
            修改后自动锁定，重新编配保留此音符；降低难度可能需要先解锁。
          </p>
        </div>
      )}
      <div className="score-bottom">
        <button
          className="text-button"
          disabled={!project.arrangement}
          onClick={() => {
            const id = crypto.randomUUID(),
              base = notes.at(-1),
              n: GuitarNote = {
                id,
                start: Math.min(
                  project.duration - 0.5,
                  base ? base.start + 0.5 : 0,
                ),
                duration: 0.3,
                pitch: {
                  midi: 64 + (project.arrangement?.capo ?? 0),
                },
                string: 1,
                fret: 0,
                velocity: 0.7,
                score: 1,
                source: "manual",
                role: "melody",
                locked: true,
              };
            const errors = violations([...notes, n], {
              difficulty,
              capo,
              transpose,
              bpm: project.bpm,
              goal: project.arrangement?.goal,
              score: project.arrangement?.score,
            });
            if (errors.length) {
              notify("请先删去末尾冲突音符，再添加新音符");
              return;
            }
            edit({
              ...project,
              arrangement: {
                ...project.arrangement!,
                notes: [...notes, n],
              },
            });
            setSelected(id);
          }}
        >
          <Plus size={15} />
          添加音符
        </button>
        <div className="download-actions">
          <button
            className="text-button"
            disabled={!notes.length}
            onClick={() => exportAs("musicxml")}
          >
            MusicXML
          </button>
          <button
            className="text-button"
            disabled={!notes.length || !!busy}
            onClick={() => exportAs("wav")}
          >
            <Download size={14} />
            WAV
          </button>
          <button
            className="text-button"
            disabled={!notes.length}
            onClick={() => exportAs("midi")}
          >
            MIDI
          </button>
          <button
            className="text-button"
            disabled={!notes.length}
            onClick={() => exportAs("txt")}
          >
            TXT
          </button>
          <button
            className="text-button"
            onClick={() => {
              setView("tab");
              setTimeout(printTab, 100);
            }}
          >
            打印六线谱 PDF
          </button>
          <button
            className="button secondary small"
            onClick={() => exportAs("project")}
          >
            <Save size={14} />
            导出项目
          </button>
        </div>
      </div>
    </section>
  );
}

export function printTab() {
  const webview = (
    window as Window & {
      chrome?: { webview?: { postMessage: (command: string) => void } };
    }
  ).chrome?.webview;
  if (webview) webview.postMessage("print-tab");
  else window.print();
}

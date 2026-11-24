import {
  Copy,
  Download,
  Guitar,
  Music2,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NoteEvent } from "../../packages/contracts";
import { noteName } from "../../packages/music/demo";
import {
  correctedNotes,
  emptyNoteEditor,
} from "../../packages/music/note-edits";
import { load } from "../../packages/plugin-host";
import "../editor.css";
import { useTransport } from "../hooks/useTransport";
import { useWorkbenchContext } from "../hooks/WorkbenchContext";
import PianoRollEditor from "./PianoRollEditor";
const download = (data: BlobPart, mime: string, name: string) => {
  const url = URL.createObjectURL(new Blob([data], { type: mime })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export default function NoteEditor() {
  const c = useWorkbenchContext(),
    p = c.editorProject,
    input = useRef<HTMLInputElement>(null),
    referenceInput = useRef<HTMLInputElement>(null),
    [selected, setSelected] = useState(new Set<string>()),
    [layer, setLayer] = useState<"corrected" | "raw" | "melody">("corrected"),
    [cursor, setCursor] = useState(0),
    [snap, setSnap] = useState(false),
    [allExport, setAllExport] = useState(false),
    [source, setSource] = useState<"notes" | "audio">("notes"),
    [exporting, setExporting] = useState(false),
    preview = useRef<AudioContext | null>(null),
    previewRequest = useRef(0),
    clipboard = useRef<NoteEvent[]>([]);
  const playback = useTransport(c.transport, c.mode === "editor");
  const state = p.noteEditor ?? emptyNoteEditor(),
    corrected = useMemo(() => correctedNotes(p), [p.notes, p.noteEditor]),
    active =
      layer === "raw" ? p.notes : layer === "melody" ? p.melody : corrected,
    f = state.filter,
    notes = useMemo(
      () =>
        active.filter(
          (n) =>
            n.score >= f.strength &&
            n.duration >= f.minimumDuration &&
            n.pitch.midi >= f.low &&
            n.pitch.midi <= f.high,
        ),
      [active, f.strength, f.minimumDuration, f.low, f.high],
    ),
    chosen = active.find((n) => selected.has(n.id)),
    editable = layer === "corrected" && c.activeTrackId !== "arrangement",
    partial = !!p.transcription && p.transcription.status !== "complete";
  useEffect(() => {
    setSelected(new Set());
    setCursor(0);
    setLayer("corrected");
    previewRequest.current++;
    void preview.current?.close().catch(() => {});
    preview.current = null;
  }, [p.id, c.activeTrackId]);
  useEffect(() => {
    setCursor(playback.position);
  }, [playback.position]);
  useEffect(
    () => () => {
      previewRequest.current++;
      void preview.current?.close().catch(() => {});
    },
    [],
  );
  const previewNote = async (n: NoteEvent) => {
    const request = ++previewRequest.current;
    void preview.current?.close().catch(() => {});
    const ctx = new AudioContext();
    preview.current = ctx;
    try {
      await ctx.resume();
      const plugin = await load("note-audio");
      if (request !== previewRequest.current || ctx.state === "closed") return;
      plugin.scheduleNotes!(
        ctx,
        [{ ...n, start: 0, duration: Math.min(1.5, n.duration) }],
        0,
        Math.min(1.5, n.duration),
        1,
      );
      setTimeout(
        () => {
          if (preview.current === ctx) {
            void ctx.close().catch(() => {});
            preview.current = null;
          }
        },
        Math.min(1.5, n.duration) * 1000 + 150,
      );
    } catch (e) {
      c.notify(e instanceof Error ? e.message : "试听不可用");
    }
  };
  const change = (ns: NoteEvent[]) => {
    if (!editable) return;
    c.commitEditor(
      ns.map((n) => ({
        id: n.id,
        note: { ...n, source: "manual" as const, locked: true },
      })),
    );
  };
  const add = (start = cursor, midi = 64) => {
    if (!editable) return;
    const n: NoteEvent = {
      id: crypto.randomUUID(),
      start: Math.max(0, Math.min(p.duration - 0.03, start)),
      duration: Math.min(
        snap ? 60 / p.bpm / 4 : 0.4,
        p.duration - Math.max(0, Math.min(p.duration - 0.03, start)),
      ),
      pitch: { midi },
      velocity: 0.7,
      score: 1,
      source: "manual",
      locked: true,
    };
    c.commitEditor([{ id: n.id, note: n }]);
    setSelected(new Set([n.id]));
  };
  const remove = () => {
    if (editable) {
      c.commitEditor([...selected].map((id) => ({ id, note: null })));
      setSelected(new Set());
    }
  };
  const undo = () => {
      c.stop();
      c.changeNoteEditor((s) => ({ ...s, cursor: Math.max(0, s.cursor - 1) }));
    },
    redo = () => {
      c.stop();
      c.changeNoteEditor((s) => ({
        ...s,
        cursor: Math.min(s.commands.length, s.cursor + 1),
      }));
    };
  const copy = () => {
    clipboard.current = corrected
      .filter((n) => selected.has(n.id))
      .map((n) => structuredClone(n));
  };
  const paste = () => {
    if (!clipboard.current.length || !editable) return;
    const first = Math.min(...clipboard.current.map((n) => n.start)),
      last = Math.max(...clipboard.current.map((n) => n.start + n.duration));
    const at = Math.max(0, Math.min(cursor, p.duration - (last - first))),
      ns = clipboard.current.map((n) => ({
        ...n,
        id: crypto.randomUUID(),
        start: at + n.start - first,
        source: "manual" as const,
        locked: true,
      }));
    c.commitEditor(ns.map((n) => ({ id: n.id, note: n })));
    setSelected(new Set(ns.map((n) => n.id)));
  };
  const seek = (at: number) => {
    c.seek(at);
    setCursor(at);
  };
  const play = () => {
    if (c.playing) {
      setCursor(c.time);
      c.stop();
    } else if (source === "audio")
      void c.play(
        true,
        undefined,
        undefined,
        cursor >= p.duration ? 0 : cursor,
      );
    else void c.playNeutral(notes, cursor >= p.duration ? 0 : cursor);
  };
  const filter = (patch: Partial<typeof f>) => {
    if (c.playing) c.stop();
    c.changeNoteEditor((s) => ({ ...s, filter: { ...s.filter, ...patch } }));
  };
  const exportNotes = async (
    format: "midi" | "wav" | "project" | "training",
  ) => {
    try {
      setExporting(true);
      const name = p.name + (partial ? "-部分转录" : "");
      const events = allExport ? corrected : notes;
      if (format === "project") {
        download(
          JSON.stringify(c.project, null, 2),
          "application/json",
          name + ".stringcraft.json",
        );
        return;
      }
      if (format === "training") {
        download(
          JSON.stringify(
            {
              version: 1,
              task: "Local correction record, not a trained model",
              sourceAudioSha256: p.sourceAudioSha256,
              sourceOffset: p.sourceOffset,
              duration: p.duration,
              model: p.transcription,
              pluginVersions: p.pluginVersions,
              raw: p.notes,
              corrected,
              editor: p.noteEditor,
            },
            null,
            2,
          ),
          "application/json",
          name + ".corrections.json",
        );
        return;
      }
      if (!events.length) throw new Error("当前没有可导出的音符");
      if (format === "midi") {
        const exporter = await load("note-exporters");
        download(
          exporter.exportNotes!(events, p.bpm) as BlobPart,
          "audio/midi",
          name + ".mid",
        );
      } else {
        const audio = await load("note-audio");
        download(
          await audio.renderNotes!(events, p.duration),
          "audio/wav",
          name + ".wav",
        );
      }
    } catch (e) {
      c.notify(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };
  const upload = async (file: File) => c.importFile(file);

  return (
    <section
      className="note-workbench"
      aria-label="音符编辑工作台"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) void upload(file);
      }}
    >
      <header className="note-heading">
        <div>
          <p className="eyebrow">LISTEN · SEE · SHAPE</p>
          <h1>
            让每一个音符，<em>都清楚可见。</em>
          </h1>
          <p>上传整曲，逐音试听与校订，再找到自己的弹奏方式。</p>
        </div>
        <button
          className="button primary"
          disabled={!c.ready}
          onClick={() => input.current?.click()}
        >
          <Upload size={16} />
          上传音频 / MIDI
        </button>
        <input
          ref={input}
          data-testid="whole-audio-input"
          type="file"
          accept="audio/*,.flac,.mid,.midi,.xml,.musicxml,.json,.zip,.stringcraft"
          className="visually-hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
      </header>
      <div className="note-meta">
        <Music2 size={18} />
        <strong>{p.name}</strong>
        <span>
          {p.sourceKind === "demo"
            ? "预编写原创示例"
            : p.transcription?.status === "complete"
              ? "整曲转录完成"
              : partial
                ? "部分转录"
                : "已导入作品"}
        </span>
        <span>
          {p.duration.toFixed(1)} 秒 · 原始 {p.notes.length} / 校订{" "}
          {corrected.length} / 筛选 {notes.length}
        </span>
        <small>{c.saved}</small>
      </div>
      {c.busy && (
        <div className="note-progress">
          <progress max={1} value={c.progress} />
          <span>
            {c.busy} {Math.round(c.progress * 100)}%
          </span>
          <button
            className="text-button"
            onClick={() => c.abortRef.current?.abort()}
          >
            停止并保留结果
          </button>
        </div>
      )}
      <div className="note-edit-actions">
        <button
          className="icon-button"
          aria-label="撤销音符编辑"
          disabled={!state.cursor || !editable}
          onClick={undo}
        >
          <Undo2 size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="重做音符编辑"
          disabled={state.cursor >= state.commands.length || !editable}
          onClick={redo}
        >
          <Redo2 size={15} />
        </button>
        <button
          className="text-button"
          onClick={() => referenceInput.current?.click()}
        >
          关联录音
        </button>
        <input
          ref={referenceInput}
          data-testid="editor-reference-input"
          type="file"
          accept="audio/*,.flac"
          className="visually-hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f)
              void c.bindRecording(
                f,
                c.project.audioReference?.offsetSeconds ??
                  c.project.sourceOffset,
              );
          }}
        />
      </div>
      <div className="note-filter">
        <select
          aria-label="音符图层"
          value={layer}
          onChange={(e) => {
            c.stop();
            setLayer(e.target.value as typeof layer);
            setSelected(new Set());
          }}
        >
          <option value="corrected">全部音符 · 人工校订</option>
          <option value="raw">原始候选 · 只读对照</option>
          <option value="melody">主旋律候选 · 只读对照</option>
        </select>
        <label>
          强度过滤 {Math.round(f.strength * 100)}%
          <input
            aria-label="音符强度过滤"
            type="range"
            min="0"
            max="1"
            step=".01"
            value={f.strength}
            onChange={(e) => filter({ strength: Number(e.target.value) })}
          />
        </label>
        <label>
          最短时长（秒）
          <input
            aria-label="最短音符时长"
            type="number"
            min={0}
            max={300}
            step={0.01}
            value={f.minimumDuration}
            onChange={(e) =>
              filter({ minimumDuration: Number(e.target.value) })
            }
          />
        </label>
        <label>
          最低 MIDI
          <input
            aria-label="最低音高"
            type="number"
            min={0}
            max={f.high}
            value={f.low}
            onChange={(e) => filter({ low: Number(e.target.value) })}
          />
        </label>
        <label>
          最高 MIDI
          <input
            aria-label="最高音高"
            type="number"
            min={f.low}
            max={127}
            value={f.high}
            onChange={(e) => filter({ high: Number(e.target.value) })}
          />
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={snap}
            onChange={(e) => setSnap(e.target.checked)}
          />
          十六分吸附
        </label>
        <label>
          参考 BPM
          <input
            aria-label="编辑参考 BPM"
            type="number"
            min={20}
            max={300}
            defaultValue={p.bpm}
            key={p.id + "-" + p.bpm}
            onBlur={(e) => {
              const bpm = Number(e.target.value);
              if (bpm >= 20 && bpm <= 300) c.edit({ ...c.project, bpm });
            }}
          />
        </label>
      </div>
      <div className="note-body">
        {c.ready ? (
          <PianoRollEditor
            key={p.id + "-" + c.activeTrackId}
            notes={notes}
            selected={selected}
            onSelect={(ids) => {
              setSelected(ids);
              if (ids.size) c.setInspectorOpen(true);
            }}
            onChange={change}
            onAdd={add}
            onPreview={(n) => void previewNote(n)}
            onActivate={(n) => {
              setCursor(n.start);
              c.activateNotes([n], n.start, c.activeTrackId === "arrangement");
            }}
            onSeek={seek}
            duration={p.duration}
            time={cursor}
            wave={c.wave}
            processed={p.transcription?.processedSeconds ?? p.duration}
            bpm={p.bpm}
            snap={snap}
            editable={editable}
            onKey={(e) => {
              const command = e.ctrlKey || e.metaKey;
              if (e.key === " ") {
                e.preventDefault();
                if (c.transport.snapshot().status !== "paused") c.pause();
                else void c.playTracks();
              } else if (command && e.key.toLowerCase() === "a") {
                e.preventDefault();
                setSelected(new Set(notes.map((n) => n.id)));
              } else if (command && e.key.toLowerCase() === "c") {
                e.preventDefault();
                copy();
              } else if (command && e.key.toLowerCase() === "v") {
                e.preventDefault();
                paste();
              } else if (command && e.key.toLowerCase() === "z") {
                e.preventDefault();
                e.shiftKey ? redo() : undo();
              } else if (command && e.key.toLowerCase() === "y") {
                e.preventDefault();
                redo();
              } else if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                remove();
              } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                change(
                  corrected
                    .filter((n) => selected.has(n.id))
                    .map((n) => ({
                      ...n,
                      pitch: {
                        midi: Math.max(
                          0,
                          Math.min(
                            127,
                            n.pitch.midi +
                              (e.key === "ArrowUp" ? 1 : -1) *
                                (command ? 12 : 1),
                          ),
                        ),
                      },
                    })),
                );
              }
            }}
          />
        ) : (
          <p className="muted">正在准备音符插件…</p>
        )}
        <aside className="note-inspector" hidden={!c.inspectorOpen}>
          <p className="eyebrow">NOTE DETAILS</p>
          <h3>
            {selected.size > 1
              ? `已选 ${selected.size} 个音符`
              : chosen
                ? noteName(chosen.pitch.midi)
                : "点击一个音符"}
          </h3>
          {chosen && selected.size === 1 ? (
            <div
              key={
                chosen.id +
                "-" +
                chosen.start +
                "-" +
                chosen.duration +
                "-" +
                chosen.pitch.midi
              }
            >
              <label>
                音高 MIDI
                <input
                  aria-label="编辑音高 MIDI"
                  type="number"
                  min={0}
                  max={127}
                  disabled={!editable}
                  defaultValue={chosen.pitch.midi}
                  onBlur={(e) =>
                    change([
                      { ...chosen, pitch: { midi: Number(e.target.value) } },
                    ])
                  }
                />
              </label>
              <label>
                起音（秒）
                <input
                  aria-label="编辑起音秒"
                  type="number"
                  step={0.01}
                  min={0}
                  disabled={!editable}
                  defaultValue={Number(chosen.start.toFixed(4))}
                  onBlur={(e) =>
                    change([{ ...chosen, start: Number(e.target.value) }])
                  }
                />
              </label>
              <label>
                时长（秒）
                <input
                  aria-label="编辑时长秒"
                  type="number"
                  step={0.01}
                  min={0.03}
                  disabled={!editable}
                  defaultValue={Number(chosen.duration.toFixed(4))}
                  onBlur={(e) =>
                    change([{ ...chosen, duration: Number(e.target.value) }])
                  }
                />
              </label>
              <label>
                力度
                <input
                  aria-label="编辑力度"
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  disabled={!editable}
                  defaultValue={chosen.velocity}
                  onBlur={(e) =>
                    change([{ ...chosen, velocity: Number(e.target.value) }])
                  }
                />
              </label>
              <button
                className="button secondary full"
                onClick={() => void previewNote(chosen)}
              >
                试听这个音符
              </button>
            </div>
          ) : (
            <p className="muted">
              点击试听，拖动修改。原始候选随时可对照。蓝色表示人工音符，金色表示选中。
            </p>
          )}
          <div className="note-actions">
            <button
              aria-label="添加校订音符"
              onClick={() => add()}
              disabled={!editable}
            >
              <Plus size={16} />
              添加
            </button>
            <button
              aria-label="复制校订音符"
              onClick={copy}
              disabled={!selected.size}
            >
              <Copy size={16} />
              复制
            </button>
            <button
              aria-label="粘贴校订音符"
              onClick={paste}
              disabled={!editable}
            >
              粘贴
            </button>
            <button
              aria-label="删除校订音符"
              onClick={remove}
              disabled={!selected.size || !editable}
            >
              <Trash2 size={16} />
              删除
            </button>
          </div>
          <details>
            <summary>当前范围音符列表</summary>
            <div className="accessible-note-list">
              {notes
                .filter((n) => n.start >= cursor && n.start < cursor + 8)
                .slice(0, 50)
                .map((n) => (
                  <button
                    key={n.id}
                    aria-label={`选择音符 ${noteName(n.pitch.midi)} ${n.start.toFixed(2)}秒`}
                    onClick={() => {
                      setSelected(new Set([n.id]));
                      void previewNote(n);
                    }}
                  >
                    {noteName(n.pitch.midi)} <span>{n.start.toFixed(2)}s</span>
                  </button>
                ))}
            </div>
          </details>
          <p className="note-disclaimer">
            模型响应不是正确概率。复音视图保留和弦与重叠音符，演奏指法由乐器插件处理。
          </p>
        </aside>
      </div>
      <footer className="note-export">
        <label className="inline-check">
          <input
            type="checkbox"
            checked={allExport}
            onChange={(e) => setAllExport(e.target.checked)}
          />
          导出全部校订音符（忽略筛选）
        </label>
        <span>
          {partial ? "部分转录 · " : ""}
          {allExport ? corrected.length : notes.length} 个导出音符
        </span>
        <button
          className="button secondary small"
          disabled={exporting}
          onClick={() => void exportNotes("project")}
        >
          保存项目 JSON
        </button>
        <button
          className="button secondary small"
          disabled={exporting || !(allExport ? corrected : notes).length}
          onClick={() => void exportNotes("midi")}
        >
          <Download size={14} />
          导出音符 MIDI
        </button>
        <button
          className="button secondary small"
          disabled={exporting || !(allExport ? corrected : notes).length}
          onClick={() => void exportNotes("wav")}
        >
          导出音符 WAV
        </button>
        <button
          className="text-button"
          disabled={exporting}
          onClick={() => void exportNotes("training")}
        >
          导出纠错记录
        </button>
        <button
          className="button primary small"
          disabled={!!c.busy}
          onClick={() => void c.handoffToGuitar()}
        >
          <Guitar size={15} />
          送往吉他编配
        </button>
      </footer>
      <div className="note-bottom">
        <span>
          Space 播放 · Delete 删除 · Ctrl/Cmd C/V 复制粘贴 · Ctrl/Cmd Z 撤销
        </span>
        <button
          className="text-button"
          disabled={!!c.busy}
          onClick={async () => {
            const response = await fetch(
              new URL(
                "demo/phrase.wav",
                new URL(import.meta.env.BASE_URL, location.href),
              ),
            );
            if (!response.ok) {
              c.notify("示例音频暂不可用");
              return;
            }
            await c.analyzeWhole(
              new File([await response.blob()], "原创短句.wav", {
                type: "audio/wav",
              }),
            );
          }}
        >
          用原创音频体验真实识别
        </button>
      </div>
    </section>
  );
}

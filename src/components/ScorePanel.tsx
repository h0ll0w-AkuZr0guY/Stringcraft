import {
  Check,
  Download,
  Guitar,
  LockKeyhole,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  Volume2,
  X,
} from "lucide-react";
import { type GuitarNote } from "../../packages/contracts";
import { noteName } from "../../packages/music/demo";

import { violations } from "../../plugins/guitar";
import { RhythmScore, Tablature } from "./Tablature";

import { useWorkbenchContext } from "../hooks/WorkbenchContext";
import { labels } from "../hooks/useWorkbench";
export default function ScorePanel() {
  const {
    section,
    project,
    difficulty,
    capo,
    saved,
    playing,
    notes,
    length,
    busy,
    stop,
    play,
    tone,
    loop,
    setLoopStart,
    loopEnd,
    wave,
    time,
    speed,
    setSpeed,
    setLoop,
    loopStart,
    setLoopEnd,
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
  } = useWorkbenchContext();
  return (
    <section className="panel score-panel">
      <div className="score-heading">
        <div>
          <span className="eyebrow">YOUR ARRANGEMENT</span>
          <h2>{project.name}</h2>
          <div className="score-tags">
            <span className="tag green">
              <Guitar size={12} />
              标准吉他
            </span>
            <span className="tag">
              {labels[project.arrangement?.difficulty ?? difficulty]}
            </span>
            <span className="tag">
              Capo {project.arrangement?.capo ?? capo}
            </span>
            <span className="tag">{project.bpm} BPM</span>
            {project.sourceKind === "demo" && (
              <span className="tag gold">原创演示</span>
            )}
          </div>
        </div>
        <span className="save-state">
          <Check size={13} />
          {saved}
        </span>
      </div>
      <div className="player">
        <div className="transport">
          <button
            className="play-button"
            aria-label={playing ? "停止播放" : "播放编配"}
            disabled={!notes.length || !!busy}
            onClick={() => (playing ? stop() : void play())}
          >
            {playing ? (
              <Pause size={19} />
            ) : (
              <Play size={19} fill="currentColor" />
            )}
          </button>
          <div>
            <strong>{playing ? "正在试听" : "听听你的编配"}</strong>
            <span>
              {tone === "synth"
                ? "合成拨弦音色"
                : "实录采样 · 缺失音域回退合成"}
            </span>
          </div>
          <button
            className="original-button"
            disabled={!!busy}
            onClick={() => void play(true)}
          >
            原曲对照
          </button>
        </div>
        <div
          className="waveform"
          onClick={(e) => {
            if (!loop) return;
            const t =
              ((e.clientX - e.currentTarget.getBoundingClientRect().left) /
                e.currentTarget.clientWidth) *
              project.duration;
            setLoopStart(Math.max(0, Math.min(t, loopEnd - 0.1)));
          }}
        >
          {Array.from({ length: 100 }, (_, i) => (
            <i
              key={i}
              style={{
                height: `${12 + (wave[i % wave.length] ?? 0.2 + 0.5 * Math.abs(Math.sin(i * 0.39) * Math.cos(i * 0.17))) * 70}%`,
                background:
                  (i / 100) * project.duration < time ? "#b68c58" : undefined,
              }}
            />
          ))}
          <span
            className="playhead"
            style={{ left: `${(time / project.duration) * 100}%` }}
          />
        </div>
        <div className="player-footer">
          <span>
            {time.toFixed(1)}{" "}
            <span className="muted">/ {project.duration.toFixed(1)} 秒</span>
          </span>
          <div>
            <label>
              速度
              <select
                aria-label="播放速度"
                value={speed}
                onChange={(e) => {
                  stop();
                  setSpeed(Number(e.target.value));
                }}
              >
                <option value=".5">0.5×</option>
                <option value=".75">0.75×</option>
                <option value="1">1.0×</option>
              </select>
            </label>
            <Volume2 size={15} />
          </div>
        </div>
      </div>
      <div className="loop-controls">
        <label>
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => {
              stop();
              setLoop(e.target.checked);
            }}
          />
          片段循环
        </label>
        {loop && (
          <>
            <input
              aria-label="循环起点"
              type="number"
              min="0"
              max={project.duration}
              step=".1"
              value={loopStart}
              onChange={(e) => {
                stop();
                setLoopStart(Math.max(0, Number(e.target.value)));
              }}
            />
            <span>至</span>
            <input
              aria-label="循环终点"
              type="number"
              min="0"
              max={project.duration}
              step=".1"
              value={loopEnd}
              onChange={(e) => {
                stop();
                setLoopEnd(Math.min(project.duration, Number(e.target.value)));
              }}
            />
            <span>秒</span>
          </>
        )}
        <span className="muted">
          {project.melody.length} 个主旋律音 · {notes.length} 个编配音符
        </span>
      </div>
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
      <div className="notation-body">
        {!notes.length ? (
          <div className="empty-panel">
            <Guitar size={48} />
            <h3>旋律的下一种可能，在这里。</h3>
            <p>分析音乐后，点击「生成吉他编配」。</p>
          </div>
        ) : view === "tab" ? (
          <Tablature
            project={project}
            selected={selected}
            onSelect={(n) => setSelected(n.id)}
            time={time}
          />
        ) : view === "rhythm" ? (
          <RhythmScore project={project} />
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
        <span>点击谱上音符可修改 · 品位相对变调夹</span>
      </div>
      {chosen && (
        <div className="note-editor">
          <div className="note-editor-heading">
            <strong>
              {noteName(chosen.pitch.midi)} <small>音符编辑</small>
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
                  const string = Number(e.target.value),
                    fret =
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
              setTimeout(() => window.print(), 100);
            }}
          >
            打印 PDF
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

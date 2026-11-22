import { useRef } from "react";
import type { ChordSymbol } from "../../packages/contracts";
import { projectScore, withReferenceTempo } from "../../packages/music/score";
import {
  measureGrid,
  setChord,
  setSection,
} from "../../packages/music/structure";
import {
  beatToSeconds,
  secondsToBeat,
  soundingEvents,
  eventRole,
  type ScoreEvent,
} from "../../packages/contracts/score";
import { chordName } from "../../plugins/guitar/voicings";
import { useWorkbenchContext } from "../hooks/WorkbenchContext";

const roots = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export default function MusicalStructure() {
  const { project, edit, stop, upgrade } = useWorkbenchContext();
  const taps = useRef<number[]>([]);
  const score = projectScore(project),
    meter = score.meter[0],
    barLength = (meter.numerator * 4) / meter.denominator;
  const bars = measureGrid(score);
  function timing(
    bpm: number,
    numerator = meter.numerator,
    denominator = meter.denominator,
  ) {
    stop();
    const next =
      bpm === score.tempo[0].bpm
        ? structuredClone(score)
        : withReferenceTempo(score, bpm);
    if (numerator !== meter.numerator || denominator !== meter.denominator) {
      next.meter = [{ beat: 0, numerator, denominator }];
      if (next.pickupBeats && next.pickupBeats >= (numerator * 4) / denominator)
        delete next.pickupBeats;
    }
    next.timing = "manual";
    edit({ ...project, bpm, score: next });
  }
  function updateChord(beat: number, changes: Partial<ChordSymbol> | null) {
    stop();
    edit({ ...project, score: setChord(score, beat, changes) });
  }
  function splitSection(id: string) {
    const section = score.sections.find((s) => s.id === id)!;
    const candidates = bars.filter(
      (b) => b.beat > section.beat && b.beat < section.endBeat,
    );
    if (!candidates.length) return;
    const middle = (section.beat + section.endBeat) / 2;
    const split = candidates.sort(
      (a, b) => Math.abs(a.beat - middle) - Math.abs(b.beat - middle),
    )[0].beat;
    const next = setSection(score, id, { ...section, endBeat: split });
    edit({
      ...project,
      score: setSection(next, crypto.randomUUID(), {
        ...section,
        beat: split,
        label: section.label + " · 后段",
      }),
    });
  }
  if (project.schemaVersion === 1)
    return (
      <div className="structure-panel">
        <p>这是 v1 项目。原有音符与编辑保持可读；新编配需要独立的音乐结构。</p>
        <button className="button secondary small" onClick={upgrade}>
          升级为 v2 副本
        </button>
      </div>
    );
  return (
    <details className="structure-panel" open={!project.arrangement}>
      <summary>
        音乐结构 · {score.chords.length} 个和弦 ·{" "}
        {score.timing === "unconfirmed" ? "首拍与速度待确认" : "可校正"}
      </summary>
      <p className="muted">
        先对照原曲确认节拍和和弦。伴奏不会复制人声旋律；指弹保留旋律，并加入有依据的低音。
      </p>
      <div className="structure-timing">
        <label>
          速度 BPM
          <input
            aria-label="结构速度 BPM"
            type="number"
            min={20}
            max={300}
            value={project.bpm}
            onChange={(e) => {
              const bpm = Number(e.target.value);
              if (bpm >= 20 && bpm <= 300) timing(bpm);
            }}
          />
        </label>
        <button
          className="button secondary small"
          onClick={() => {
            const now = performance.now();
            taps.current =
              taps.current.length && now - taps.current.at(-1)! < 2500
                ? [...taps.current.slice(-7), now]
                : [now];
            if (taps.current.length >= 3) {
              const gaps = taps.current
                .slice(1)
                .map((n, i) => n - taps.current[i])
                .sort((a, b) => a - b);
              const bpm = Math.round(60000 / gaps[Math.floor(gaps.length / 2)]);
              if (bpm >= 20 && bpm <= 300) timing(bpm);
            }
          }}
        >
          轻拍定速（至少三次）
        </button>
        <label>
          编配拍号
          <select
            aria-label="编配拍号"
            value={`${meter.numerator}/${meter.denominator}`}
            onChange={(e) => {
              const [n, d] = e.target.value.split("/").map(Number);
              timing(project.bpm, n, d);
            }}
          >
            <option>4/4</option>
            <option>3/4</option>
            <option>6/8</option>
          </select>
        </label>
        <label>
          首个完整小节起点（秒）
          <input
            aria-label="首个完整小节起点"
            type="number"
            min={0}
            max={beatToSeconds(score, barLength) - score.beatOffsetSeconds}
            step={0.01}
            value={
              score.pickupBeats
                ? beatToSeconds(score, score.pickupBeats) -
                  score.beatOffsetSeconds
                : 0
            }
            onChange={(e) => {
              const seconds = Number(e.target.value),
                pickup = secondsToBeat(
                  score,
                  seconds + score.beatOffsetSeconds,
                );
              if (seconds >= 0 && pickup < barLength) {
                const next = structuredClone(score);
                if (pickup > 0.001) next.pickupBeats = pickup;
                else delete next.pickupBeats;
                next.timing = "manual";
                stop();
                edit({ ...project, score: next });
              }
            }}
          />
        </label>
        <button className="text-button" onClick={() => timing(project.bpm)}>
          确认当前节拍
        </button>
      </div>
      {!!score.events.length && (
        <details className="voice-editor">
          <summary>声部用途 · 核对旋律、低音与内声部</summary>
          <p className="muted">
            乐谱中的独立声部可分别指定用途。已导入的低音和内声部优先保留；未确认的检测残留不会自动当成和声。
          </p>
          {[...new Set(score.events.map((e) => e.voice))].map((voice) => {
            const events = score.events.filter((e) => e.voice === voice),
              roles = [
                ...new Set(
                  events
                    .filter((e) => e.midi !== null || e.unpitched)
                    .map(eventRole),
                ),
              ],
              role = roles.length > 1 ? "mixed" : (roles[0] ?? "harmony");
            return (
              <label key={voice} className="voice-row">
                <span>{voice}</span>
                <select
                  aria-label={`声部 ${voice} 用途`}
                  value={role}
                  onChange={(e) => {
                    const next = structuredClone(score);
                    next.events = next.events.map((event) =>
                      event.voice === voice
                        ? {
                            ...event,
                            role: e.target.value as ScoreEvent["role"],
                            roleOrigin: "manual",
                          }
                        : event,
                    );
                    stop();
                    edit({
                      ...project,
                      score: next,
                      melody: soundingEvents(next).filter(
                        (n) => n.role === "melody",
                      ),
                    });
                  }}
                >
                  {role === "mixed" && (
                    <option value="mixed" disabled>
                      混合用途（保留原谱）
                    </option>
                  )}
                  <option value="melody">主旋律</option>
                  <option value="bass">独立低音</option>
                  <option value="harmony">和声／内声部</option>
                </select>
              </label>
            );
          })}
        </details>
      )}
      <div className="chord-editor" aria-label="和弦进行编辑">
        {bars.map((bar) => {
          const starts = [
            bar.beat,
            ...score.chords
              .filter((c) => c.beat > bar.beat + 0.001 && c.beat < bar.endBeat)
              .map((c) => c.beat),
          ];
          return (
            <div key={bar.beat} className="chord-cell">
              <strong>
                {bar.pickup ? "弱起小节" : `小节 ${bar.index + 1}`}
              </strong>
              <small>{beatToSeconds(score, bar.beat).toFixed(1)}s</small>
              {starts.map((beat) => {
                const c = score.chords.find(
                  (c) =>
                    c.beat <= beat + 0.001 &&
                    c.beat + c.durationBeats > beat + 0.001,
                );
                const label = `小节 ${bar.index + 1} 第 ${(beat - bar.beat + 1).toFixed(2)} 拍`;
                return (
                  <div className="chord-change" key={beat}>
                    <small>
                      第 {(beat - bar.beat + 1).toFixed(2)} 拍 ·{" "}
                      {c?.origin === "estimated"
                        ? "待核对估计"
                        : c
                          ? "已编辑/导入"
                          : "未确定"}
                    </small>
                    <select
                      aria-label={`${label} 和弦根音`}
                      value={c?.root ?? ""}
                      onChange={(e) =>
                        updateChord(
                          beat,
                          e.target.value === ""
                            ? null
                            : {
                                root: Number(e.target.value),
                                quality: c?.quality ?? "major",
                              },
                        )
                      }
                    >
                      <option value="">未确定</option>
                      {roots.map((r, i) => (
                        <option value={i} key={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    {c && (
                      <select
                        aria-label={`${label} 和弦性质`}
                        value={c.quality}
                        onChange={(e) =>
                          updateChord(beat, {
                            root: c.root,
                            quality: e.target.value as ChordSymbol["quality"],
                          })
                        }
                      >
                        {(
                          ["major", "minor", "7", "maj7", "m7", "sus4"] as const
                        ).map((q) => (
                          <option value={q} key={q}>
                            {chordName({ root: c.root, quality: q })}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
              <button
                className="text-button"
                aria-label={`小节 ${bar.index + 1} 添加换和弦`}
                onClick={() => {
                  const points = [...starts, bar.endBeat];
                  const gap = points
                    .slice(0, -1)
                    .map((beat, i) => ({ beat, length: points[i + 1] - beat }))
                    .sort((a, b) => b.length - a.length)[0];
                  if (gap.length < 0.5) return;
                  const beat = Math.round((gap.beat + gap.length / 2) * 4) / 4;
                  const previous = score.chords.find(
                    (c) =>
                      c.beat <= gap.beat && c.beat + c.durationBeats > gap.beat,
                  );
                  updateChord(beat, {
                    root: previous?.root ?? 0,
                    quality: previous?.quality ?? "major",
                  });
                }}
              >
                添加换和弦
              </button>
            </div>
          );
        })}
      </div>
      <div className="section-editor" aria-label="乐段编辑">
        <h3>乐段与表达</h3>
        <p className="muted">
          手动标记前奏、主歌和副歌，按段落调整力度与留白。段落名称不会被当成原曲识别结果。
        </p>
        {!score.sections.length && (
          <button
            className="text-button"
            onClick={() =>
              edit({
                ...project,
                score: setSection(score, crypto.randomUUID(), {
                  beat: 0,
                  endBeat: score.durationBeats,
                  label: "待标记段落",
                  energy: "steady",
                }),
              })
            }
          >
            开始标记段落
          </button>
        )}
        {score.sections.map((section) => (
          <div className="section-row" key={section.id}>
            <input
              aria-label={`乐段 ${section.id} 名称`}
              value={section.label}
              onChange={(e) =>
                edit({
                  ...project,
                  score: setSection(score, section.id, {
                    ...section,
                    label: e.target.value,
                  }),
                })
              }
            />
            <small>
              {beatToSeconds(score, section.beat).toFixed(1)}–
              {beatToSeconds(score, section.endBeat).toFixed(1)}s
            </small>
            <select
              aria-label={`乐段 ${section.id} 表达`}
              value={section.energy ?? "steady"}
              onChange={(e) =>
                edit({
                  ...project,
                  score: setSection(score, section.id, {
                    ...section,
                    energy: e.target.value as typeof section.energy,
                  }),
                })
              }
            >
              <option value="gentle">轻柔留白</option>
              <option value="steady">平稳叙述</option>
              <option value="emphatic">突出旋律</option>
            </select>
            <button
              className="text-button"
              onClick={() => splitSection(section.id)}
            >
              拆分段落
            </button>
            <button
              className="text-button"
              onClick={() =>
                edit({ ...project, score: setSection(score, section.id, null) })
              }
            >
              删除标记
            </button>
          </div>
        ))}
      </div>
      {score.warnings.map((w) => (
        <p className="muted" key={w}>
          {w}
        </p>
      ))}
    </details>
  );
}

import { useRef } from "react";
import type { ChordSymbol } from "../../packages/contracts";
import { projectScore } from "../../packages/music/score";
import { beatToSeconds, secondsToBeat } from "../../packages/contracts/score";
import { chordName } from "../../plugins/guitar/voicings";
import { useWorkbenchContext } from "../hooks/WorkbenchContext";

const roots = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export default function MusicalStructure() {
  const { project, edit, stop, upgrade } = useWorkbenchContext();
  const taps = useRef<number[]>([]);
  const score = projectScore(project),
    meter = score.meter[0],
    barLength = (meter.numerator * 4) / meter.denominator;
  function timing(
    bpm: number,
    numerator = meter.numerator,
    denominator = meter.denominator,
    offset = score.beatOffsetSeconds,
  ) {
    stop();
    const next = structuredClone(score);
    next.tempo = [{ beat: 0, bpm }];
    next.meter = [{ beat: 0, numerator, denominator }];
    next.timing = "manual";
    next.beatOffsetSeconds = offset;
    next.durationBeats = Math.max(0.25, secondsToBeat(next, project.duration));
    next.events = score.events
      .map((e) => {
        const start = beatToSeconds(score, e.beat),
          end = beatToSeconds(score, e.beat + e.durationBeats);
        const beat = Math.max(0, secondsToBeat(next, start));
        return {
          ...e,
          beat,
          durationBeats: Math.max(0.001, secondsToBeat(next, end) - beat),
        };
      })
      .filter((e) => e.beat + e.durationBeats <= next.durationBeats + 0.001);
    next.chords = next.chords
      .filter((c) => c.beat < next.durationBeats)
      .map((c) => ({
        ...c,
        durationBeats: Math.min(c.durationBeats, next.durationBeats - c.beat),
      }));
    edit({ ...project, bpm, beatOffset: offset, score: next });
  }
  function updateChord(beat: number, changes: Partial<ChordSymbol> | null) {
    stop();
    const next = structuredClone(score);
    const old = next.chords.find((c) => Math.abs(c.beat - beat) < 0.001);
    next.chords = next.chords.filter((c) => c !== old);
    if (changes)
      next.chords.push({
        id: old?.id ?? `manual-chord-${beat}`,
        beat,
        durationBeats: Math.min(barLength, next.durationBeats - beat),
        root: old?.root ?? 0,
        quality: old?.quality ?? "major",
        ...changes,
        origin: "manual",
      });
    next.chords.sort((a, b) => a.beat - b.beat);
    edit({ ...project, score: next });
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
          网格起点（秒）
          <input
            aria-label="网格起点"
            type="number"
            max={0}
            min={-10}
            step={0.01}
            value={score.beatOffsetSeconds}
            onChange={(e) => {
              const value = Number(e.target.value);
              if (value <= 0 && value >= -10)
                timing(project.bpm, meter.numerator, meter.denominator, value);
            }}
          />
        </label>
        <button className="text-button" onClick={() => timing(project.bpm)}>
          确认当前节拍
        </button>
      </div>
      <div className="chord-editor" aria-label="和弦进行编辑">
        {Array.from(
          { length: Math.ceil(score.durationBeats / barLength) },
          (_, i) => {
            const beat = i * barLength,
              c = score.chords.find((c) => Math.abs(c.beat - beat) < 0.001);
            return (
              <div key={beat} className="chord-cell">
                <strong>小节 {i + 1}</strong>
                <small>
                  {beatToSeconds(score, beat).toFixed(1)}s ·{" "}
                  {c
                    ? c.origin === "estimated"
                      ? "待核对估计"
                      : "已编辑/导入"
                    : "未确定"}
                </small>
                <select
                  aria-label={`小节 ${i + 1} 和弦根音`}
                  value={c?.root ?? ""}
                  onChange={(e) =>
                    updateChord(
                      beat,
                      e.target.value === ""
                        ? null
                        : { root: Number(e.target.value) },
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
                    aria-label={`小节 ${i + 1} 和弦性质`}
                    value={c.quality}
                    onChange={(e) =>
                      updateChord(beat, {
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
          },
        )}
      </div>
      {score.warnings.map((w) => (
        <p className="muted" key={w}>
          {w}
        </p>
      ))}
    </details>
  );
}

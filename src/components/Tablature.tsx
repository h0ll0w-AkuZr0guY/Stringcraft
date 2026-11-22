import { alphaScore } from "../../plugins/guitar/alpha-score";
import { tabMeasures } from "../../plugins/guitar/notation";
import { chordName } from "../../plugins/guitar/voicings";
import { secondsToBeat } from "../../packages/contracts/score";
import { projectScore } from "../../packages/music/score";
let musicFont: Promise<void> | undefined;
function prepareMusicFont(directory: URL) {
  return (musicFont ??= new FontFace(
    "alphaTab",
    `url("${new URL("Bravura.woff2", directory).href}")`,
  )
    .load()
    .then((face) => {
      document.fonts.add(face);
    })
    .catch((error) => {
      musicFont = undefined;
      throw error;
    }));
}
import { useEffect, useRef, useState } from "react";
import type { GuitarNote, MusicProject } from "../../packages/contracts";
import { noteName } from "../../packages/music/demo";
export function Tablature({
  project,
  selected,
  onSelect,
  time,
}: {
  project: MusicProject;
  selected: string | null;
  onSelect: (n: GuitarNote) => void;
  time: number;
}) {
  const measures = tabMeasures(project),
    score = project.arrangement?.score ?? projectScore(project);
  const [fingering, setFingering] = useState(false);
  return (
    <div className="tab-pages" data-testid="tablature">
      <label className="fingering-toggle">
        <input
          type="checkbox"
          checked={fingering}
          onChange={(e) => setFingering(e.target.checked)}
        />{" "}
        显示左右手指法（1–4 / p i m a）
      </label>
      {Array.from({ length: Math.ceil(measures.length / 2) }, (_, row) => {
        const bars = measures.slice(row * 2, row * 2 + 2),
          width = Math.max(750, bars.reduce((sum, b) => sum + b.width, 0) + 30);
        let offset = 30;
        return (
          <svg
            key={row}
            viewBox={`0 0 ${width} 250`}
            style={{ minWidth: width }}
            role="img"
            aria-label={`小节 ${row * 2 + 1} 至 ${row * 2 + bars.length} 六线谱`}
          >
            {bars.map((bar) => {
              const left = offset;
              offset += bar.width;
              const beatX = (beat: number) => {
                const after = bar.columns.find((c) => c.beat >= beat),
                  before = bar.columns.filter((c) => c.beat < beat).at(-1);
                const a = before ?? { beat: bar.beat, x: 40 },
                  b = after ?? { beat: bar.endBeat, x: bar.width - 15 };
                return (
                  a.x +
                  (b.x - a.x) *
                    Math.max(
                      0,
                      Math.min(
                        1,
                        (beat - a.beat) / Math.max(0.001, b.beat - a.beat),
                      ),
                    )
                );
              };
              const chord = score?.chords.find(
                (c) =>
                  c.beat <= bar.beat + 0.001 &&
                  c.beat + c.durationBeats > bar.beat,
              );
              return (
                <g key={bar.index} transform={`translate(${left},0)`}>
                  <text x={5} y={20} className="measure-label">
                    {bar.index + 1}
                  </text>
                  <text x={50} y={20} className="time-label">
                    {bar.start.toFixed(1)}s
                  </text>
                  {chord && (
                    <text x={50} y={43} className="fret">
                      {chordName({
                        root:
                          (((chord.root +
                            (project.arrangement?.transpose ?? 0) -
                            (project.arrangement?.capo ?? 0)) %
                            12) +
                            12) %
                          12,
                        quality: chord.quality,
                      })}
                      {chord.origin === "estimated" ? " ?" : ""}
                    </text>
                  )}
                  {Array.from({ length: 6 }, (_, s) => (
                    <g key={s}>
                      <text x={5} y={78 + s * 23} className="string-label">
                        {["e", "B", "G", "D", "A", "E"][s]}
                      </text>
                      <line
                        x1={35}
                        x2={bar.width - 5}
                        y1={74 + s * 23}
                        y2={74 + s * 23}
                        stroke="#d0d7d0"
                      />
                    </g>
                  ))}
                  <line x1={35} x2={35} y1={60} y2={201} stroke="#9aaa9b" />
                  <line
                    x1={bar.width - 5}
                    x2={bar.width - 5}
                    y1={60}
                    y2={201}
                    stroke="#9aaa9b"
                  />
                  {(project.arrangement?.notes ?? [])
                    .filter(
                      (n) =>
                        n.start < bar.start - 0.001 &&
                        n.start + n.duration > bar.start,
                    )
                    .map((n) => (
                      <g key={`held-${n.id}`}>
                        <text
                          x={40}
                          y={79 + (n.string - 1) * 23}
                          className="time-label"
                        >
                          ~
                        </text>
                        <line
                          x1={52}
                          x2={
                            beatX(
                              Math.min(
                                bar.endBeat,
                                secondsToBeat(score, n.start + n.duration),
                              ),
                            ) - 8
                          }
                          y1={81 + (n.string - 1) * 23}
                          y2={81 + (n.string - 1) * 23}
                          stroke={n.role === "melody" ? "#7b9c89" : "#c5b79a"}
                          strokeWidth={2}
                        />
                      </g>
                    ))}
                  {bar.columns.map((column) => (
                    <g key={column.key}>
                      {column.notes[0].stroke && (
                        <text
                          x={column.x}
                          y={57}
                          textAnchor="middle"
                          className="time-label"
                        >
                          {column.notes[0].stroke === "down" ? "↓" : "↑"}
                        </text>
                      )}
                      {column.notes.map((n) => {
                        const y = 74 + (n.string - 1) * 23;
                        return (
                          <g
                            key={n.id}
                            className="tab-note"
                            onClick={() => onSelect(n)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ")
                                onSelect(n);
                            }}
                            tabIndex={0}
                            role="button"
                            aria-label={`${noteName(n.pitch.midi)} ${n.string}弦${n.fret}品 ${n.start.toFixed(2)}秒`}
                          >
                            <title>{`${n.start.toFixed(2)}s · ${n.duration.toFixed(2)}s${n.leftFinger ? ` · 左手 ${n.leftFinger}` : ""}${n.rightFinger ? ` · 右手 ${n.rightFinger}` : ""}${n.attack ? ` · ${n.attack}` : ""}`}</title>
                            <line
                              x1={column.x + 13}
                              x2={Math.max(
                                column.x + 13,
                                beatX(
                                  Math.min(
                                    bar.endBeat,
                                    secondsToBeat(score, n.start + n.duration),
                                  ),
                                ) - 9,
                              )}
                              y1={y + 7}
                              y2={y + 7}
                              stroke={
                                n.role === "melody" ? "#7b9c89" : "#c5b79a"
                              }
                              strokeWidth={2}
                            />
                            <rect
                              x={column.x - 11}
                              y={y - 11}
                              width={24}
                              height={23}
                              rx={4}
                              fill={
                                selected === n.id
                                  ? "#d8ad6b"
                                  : n.locked
                                    ? "#dbe7e0"
                                    : "#fafbf8"
                              }
                            />
                            <text
                              x={column.x + 1}
                              y={y + 5}
                              textAnchor="middle"
                              className={
                                n.role === "melody" ? "fret melody" : "fret"
                              }
                            >
                              {n.fret}
                            </text>
                            {(n.attack === "hammer" ||
                              n.attack === "pull" ||
                              n.attack === "slide") && (
                              <text
                                x={column.x - 15}
                                y={y - 8}
                                className="time-label"
                              >
                                {n.attack === "hammer"
                                  ? "h"
                                  : n.attack === "pull"
                                    ? "p"
                                    : "/"}
                              </text>
                            )}
                            {fingering && (
                              <text
                                x={column.x + 13}
                                y={y - 6}
                                className="finger-label"
                              >
                                {n.fret > 0 ? n.leftFinger : ""}
                                {n.rightFinger}
                              </text>
                            )}
                          </g>
                        );
                      })}
                      <line
                        x1={column.x}
                        x2={column.x}
                        y1={207}
                        y2={222}
                        stroke="#66846d"
                      />
                      <text
                        x={column.x}
                        y={238}
                        textAnchor="middle"
                        className="time-label"
                      >
                        {(column.beat - bar.beat + 1)
                          .toFixed(2)
                          .replace(/\.?0+$/, "")}
                      </text>
                    </g>
                  ))}
                  {time >= bar.start && time < bar.end && (
                    <line
                      x1={Math.max(
                        40,
                        bar.columns
                          .filter((c) => c.notes[0].start <= time)
                          .at(-1)?.x ?? 40,
                      )}
                      x2={Math.max(
                        40,
                        bar.columns
                          .filter((c) => c.notes[0].start <= time)
                          .at(-1)?.x ?? 40,
                      )}
                      y1={58}
                      y2={224}
                      stroke="#b47040"
                      strokeWidth={2}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        );
      })}
    </div>
  );
}
export function RhythmScore({ project }: { project: MusicProject }) {
  const element = useRef<HTMLDivElement>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let disposed = false,
      api: { destroy: () => void } | undefined;
    setError("");
    import("@coderline/alphatab")
      .then(async (alpha) => {
        if (disposed || !element.current) return;
        // alphaTab 1.9 can wait indefinitely when its initial font availability
        // probe runs before the browser has loaded Bravura. Load it explicitly.
        const directory = new URL(
          "font/",
          new URL(import.meta.env.BASE_URL, location.href),
        );
        await prepareMusicFont(directory);
        if (disposed || !element.current) return;
        const a = new alpha.AlphaTabApi(element.current, {
          core: {
            fontDirectory: new URL(
              "font/",
              new URL(import.meta.env.BASE_URL, location.href),
            ).href,
            useWorkers: false,
            enableLazyLoading: false,
          },
          player: { enablePlayer: false },
          display: { scale: 0.85 },
        });
        api = a;
        a.error.on((e) => setError(String(e)));
        a.renderScore(alphaScore(alpha, project));
      })
      .catch((e) => setError(String(e)));
    return () => {
      disposed = true;
      api?.destroy();
    };
  }, [project]);
  return (
    <div className="rhythm-view">
      <p className="muted">
        节奏谱按十六分网格近似量化，旋律、低音与和弦独立分声部；延音线保持发声，试听保留原始时间。
      </p>
      {error && (
        <p role="alert" className="inline-error">
          谱面暂不可用：{error}
        </p>
      )}
      <div ref={element} />
    </div>
  );
}

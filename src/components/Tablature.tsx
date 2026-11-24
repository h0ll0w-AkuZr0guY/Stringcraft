import { alphaPiano } from "../../plugins/piano/alpha";
import type { NoteEvent } from "../../packages/contracts";
import type { AlphaTabApi, model } from "@coderline/alphatab";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  GuitarNote,
  MusicProject,
  ScoreHit,
} from "../../packages/contracts";
import { beatToSeconds, secondsToBeat } from "../../packages/contracts/score";
import { noteName } from "../../packages/music/demo";
import { projectScore } from "../../packages/music/score";
import { alphaScore } from "../../plugins/guitar/alpha-score";
import { tabMeasures } from "../../plugins/guitar/notation";
import { chordName } from "../../plugins/guitar/voicings";
import { useScoreFollow } from "../hooks/useScoreFollow";
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
export function Tablature({
  project,
  selected,
  onSelect,
  time,
  onSeek,
  zoom = 1,
  professional = false,
}: {
  project: MusicProject;
  selected: string | null;
  onSelect: (n: GuitarNote) => void;
  time: number;
  zoom?: number;
  professional?: boolean;
  onSeek?: (at: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    follow = useScoreFollow();
  const measures = useMemo(() => tabMeasures(project), [project]),
    score = project.arrangement?.score ?? projectScore(project);
  const [fingering, setFingering] = useState(false);
  const [viewport, setViewport] = useState(0);
  useEffect(() => {
    const container = root.current?.closest<HTMLElement>(".notation-body");
    if (!container) return;
    const resize = () => setViewport(container.clientWidth);
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    const disconnectFollow = follow.observe(container);
    return () => {
      observer.disconnect();
      disconnectFollow();
    };
  }, [follow.observe]);
  const rows = useMemo(() => {
    const result: (typeof measures)[] = [];
    let row: typeof measures = [],
      used = 16;
    for (const measure of measures) {
      if (row.length && (used + measure.width) * zoom > viewport - 8) {
        result.push(row);
        row = [];
        used = 16;
      }
      row.push(measure);
      used += measure.width;
    }
    if (row.length) result.push(row);
    return result;
  }, [measures, viewport, zoom]);
  const playAt = Math.max(0, Math.min(time, project.duration - 0.00001));
  useEffect(() => {
    const el = root.current;
    const container = el?.closest<HTMLElement>(".notation-body");
    const active = el?.querySelector<SVGElement>("[data-score-playhead]");
    const row = active?.ownerSVGElement;
    if (!container || !active || !row) return;
    const a = active.getBoundingClientRect(),
      b = container.getBoundingClientRect(),
      r = row.getBoundingClientRect();
    follow.reveal(container, {
      left: a.left - b.left + container.scrollLeft,
      top: r.top - b.top + container.scrollTop,
      width: 2,
      height: Math.min(r.height, container.clientHeight - 28),
    });
  }, [playAt, rows, follow.reveal]);
  return (
    <div
      ref={root}
      className="tab-pages"
      data-testid="tablature"
      onWheel={follow.manual}
      onTouchMove={follow.manual}
    >
      <div className="score-follow-controls">
        <button
          className="text-button"
          aria-pressed={follow.following}
          onClick={follow.resume}
        >
          {follow.following ? "跟随播放" : "回到播放位置"}
        </button>
        {!follow.following && <span>跟随已暂停</span>}
        {professional && (
          <label>
            <input
              type="checkbox"
              checked={fingering}
              onChange={(e) => setFingering(e.target.checked)}
            />{" "}
            显示左右手指法（1–4 / p i m a）
          </label>
        )}
      </div>
      {rows.map((bars) => {
        const width = bars.reduce((sum, b) => sum + b.width, 16);
        let offset = 8;
        return (
          <svg
            data-playing-row={
              playAt >= bars[0].start && playAt < bars[bars.length - 1].end
            }
            key={bars[0].index}
            className="score-row"
            viewBox={`0 0 ${width} 250`}
            style={{ width: width * zoom, height: 250 * zoom }}
            role="group"
            aria-label={`小节 ${bars[0].index + 1} 至 ${bars.at(-1)!.index + 1} 六线谱`}
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
              return (
                <g
                  key={bar.index}
                  data-current-measure={
                    playAt >= bar.start && playAt < bar.end
                      ? bar.index + 1
                      : undefined
                  }
                  transform={`translate(${left},0)`}
                  onClick={(e) => {
                    const svg = e.currentTarget.ownerSVGElement!,
                      bounds = svg.getBoundingClientRect(),
                      x =
                        ((e.clientX - bounds.left) * width) / bounds.width -
                        left;
                    const points = [
                      { beat: bar.beat, x: 35 },
                      ...bar.columns,
                      { beat: bar.endBeat, x: bar.width - 5 },
                    ].sort((a, b) => a.x - b.x);
                    const next = points.find((p) => p.x >= x) ?? points.at(-1)!,
                      prev =
                        [...points].reverse().find((p) => p.x < x) ?? points[0];
                    onSeek?.(
                      beatToSeconds(
                        score,
                        prev.beat +
                          (next.beat - prev.beat) *
                            Math.max(
                              0,
                              Math.min(
                                1,
                                (x - prev.x) / Math.max(1, next.x - prev.x),
                              ),
                            ),
                      ),
                    );
                  }}
                >
                  <rect
                    x={35}
                    y={60}
                    width={bar.width - 40}
                    height={145}
                    fill="transparent"
                  />
                  <text x={5} y={20} className="measure-label">
                    {bar.index + 1}
                  </text>
                  <text x={50} y={20} className="time-label">
                    {bar.start.toFixed(1)}s
                  </text>
                  {bar.columns
                    .filter((c) => c.chord)
                    .map((column) => {
                      const chord = column.chord!;
                      return (
                        <text
                          key={`symbol-${chord.id}`}
                          x={column.x}
                          y={43}
                          className="fret chord-symbol"
                        >
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
                      );
                    })}
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
                      {column.notes[0]?.stroke && (
                        <text
                          x={column.x}
                          y={57}
                          textAnchor="middle"
                          className="time-label"
                        >
                          {column.notes[0]?.stroke === "down" ? "↓" : "↑"}
                        </text>
                      )}
                      {column.notes.map((n) => {
                        const y = 74 + (n.string - 1) * 23;
                        return (
                          <g key={n.id}>
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
                            <g
                              className="tab-note"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelect(n);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onSelect(n);
                                }
                              }}
                              tabIndex={0}
                              role="button"
                              aria-label={`${n.dead ? "闷音" : noteName(n.pitch.midi)} ${n.string}弦${n.dead ? "" : `${n.fret}品`} ${n.start.toFixed(2)}秒`}
                            >
                              <title>{`${n.start.toFixed(2)}s · ${n.duration.toFixed(2)}s${n.leftFinger ? ` · 左手 ${n.leftFinger}` : ""}${n.rightFinger ? ` · 右手 ${n.rightFinger}` : ""}${n.attack ? ` · ${n.attack}` : ""}`}</title>
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
                                {n.dead ? "×" : n.fret}
                              </text>
                              {!n.linkFrom &&
                                (n.attack === "hammer" ||
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
                  {playAt >= bar.start && playAt < bar.end && (
                    <line
                      data-score-playhead
                      x1={beatX(secondsToBeat(score, playAt))}
                      x2={beatX(secondsToBeat(score, playAt))}
                      y1={58}
                      y2={224}
                      stroke="#b47040"
                      strokeWidth={2}
                    />
                  )}
                  {(project.arrangement?.notes ?? [])
                    .filter(
                      (n) =>
                        n.linkFrom &&
                        ["hammer", "pull", "slide"].includes(n.attack ?? ""),
                    )
                    .map((n) => {
                      const previous = project.arrangement!.notes.find(
                        (p) => p.id === n.linkFrom,
                      );
                      if (!previous || previous.string !== n.string)
                        return null;
                      const a = secondsToBeat(score, previous.start),
                        b = secondsToBeat(score, n.start);
                      if (b < bar.beat || a >= bar.endBeat) return null;
                      const x1 = a < bar.beat ? 40 : beatX(a) + 12,
                        x2 = b >= bar.endBeat ? bar.width - 10 : beatX(b) - 12;
                      if (x2 <= x1) return null;
                      const y = 62 + (n.string - 1) * 23,
                        label =
                          n.attack === "hammer"
                            ? "h"
                            : n.attack === "pull"
                              ? "p"
                              : "/";
                      return (
                        <g key={`link-${n.id}`} className="legato-link">
                          <path
                            d={`M ${x1} ${y} Q ${(x1 + x2) / 2} ${y - 24} ${x2} ${y}`}
                            fill="none"
                            stroke="#527560"
                            strokeWidth="1.3"
                          />
                          <text
                            x={(x1 + x2) / 2}
                            y={y - 15}
                            textAnchor="middle"
                            className="time-label"
                          >
                            {a < bar.beat ? "←" : ""}
                            {label}
                            {b >= bar.endBeat ? "→" : ""}
                          </text>
                        </g>
                      );
                    })}
                </g>
              );
            })}
          </svg>
        );
      })}
    </div>
  );
}
export function RhythmScore({
  project,
  time = 0,
  zoom = 1,
  professional = false,
  onActivate,
  piano = false,
}: {
  project: MusicProject;
  time?: number;
  zoom?: number;
  professional?: boolean;
  onActivate?: (notes: NoteEvent[], at: number) => void;
  piano?: boolean;
}) {
  const follow = useScoreFollow(),
    cursor = useRef<HTMLDivElement>(null);
  const projection = useRef<{
    api: AlphaTabApi;
    hits: [model.Beat, ScoreHit][];
  } | null>(null);
  const element = useRef<HTMLDivElement>(null),
    [error, setError] = useState(""),
    [fingering, setFingering] = useState(false),
    [rendered, setRendered] = useState(0);
  const printScore = useRef<() => void>(undefined);
  useEffect(() => {
    const c = element.current?.closest<HTMLElement>(".notation-body");
    return c ? follow.observe(c) : undefined;
  }, [follow.observe]);
  useEffect(() => {
    let disposed = false,
      api: { destroy: () => void } | undefined;
    setError("");
    setRendered(0);
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
          player: { enablePlayer: false, enableElementHighlighting: true },
          display: { scale: 0.85 * zoom },
        });
        api = a;
        a.settings.core.includeNoteBounds = true;
        const bindings = new Map<model.Beat, ScoreHit>();
        const notes: NoteEvent[] = piano
          ? (project.piano?.notes ?? [])
          : (project.arrangement?.notes ?? []);
        let noteHit = false;
        a.beatMouseUp.on((beat) => {
          noteHit = false;
          const hit = beat ? bindings.get(beat) : undefined;
          queueMicrotask(() => {
            if (hit && !noteHit)
              onActivate?.(
                notes.filter((n) => hit.noteIds.includes(n.id)),
                hit.startSeconds,
              );
          });
        });
        a.noteMouseUp.on((note) => {
          if (!note) return;
          const hit = bindings.get(note.beat);
          if (!hit) return;
          const selected = notes.find(
            (n) =>
              hit.noteIds.includes(n.id) &&
              (piano
                ? n.pitch.midi === note.realValue
                : (n as GuitarNote).string === 7 - note.string &&
                  (n as GuitarNote).fret === note.fret),
          );
          if (selected) {
            noteHit = true;
            onActivate?.([selected], hit.startSeconds);
          }
        });
        printScore.current = () =>
          // alphaTab print() forces workers on unless explicitly overridden.
          // Keep the same renderer mode: Vite dev prebundles have no worker URL.
          a.print("180mm", {
            core: { useWorkers: false },
            display: { scale: 0.8, barsPerRow: 2 },
          });
        a.error.on((e) => setError(String(e)));
        a.renderFinished.on(() => {
          if (!disposed) setRendered((version) => version + 1);
        });
        const bind = (beat: model.Beat, hit: ScoreHit) =>
          bindings.set(beat, hit);
        const score = piano
          ? alphaPiano(alpha, project, bind)
          : alphaScore(alpha, project, fingering, bind);
        projection.current = {
          api: a,
          hits: [...bindings].sort(
            (a, b) => b[1].startSeconds - a[1].startSeconds,
          ),
        };
        a.renderScore(score);
      })
      .catch((e) => setError(String(e)));
    return () => {
      disposed = true;
      printScore.current = undefined;
      api?.destroy();
      projection.current = null;
    };
  }, [project, fingering, zoom, piano]);
  useEffect(() => {
    const p = projection.current,
      el = element.current,
      indicator = cursor.current;
    if (!p || !el || !indicator || !rendered) return;
    const at = Math.max(0, Math.min(time, project.duration - 0.00001));
    const entry =
      p.hits.find(([, hit]) => hit.startSeconds <= at && hit.endSeconds > at) ??
      p.hits.find(([, hit]) => hit.startSeconds <= at) ??
      p.hits.at(-1);
    const beatBounds = entry ? p.api.boundsLookup?.findBeat(entry[0]) : null;
    const bounds = beatBounds?.realBounds;
    const measure = beatBounds?.barBounds.masterBarBounds.visualBounds;
    indicator.dataset.currentMeasure = entry
      ? String(entry[0].voice.bar.index + 1)
      : "";
    indicator.hidden = !bounds;
    if (!bounds) return;
    Object.assign(indicator.style, {
      left: `${bounds.x}px`,
      top: `${bounds.y}px`,
      height: `${bounds.h}px`,
    });
    const container = el.closest<HTMLElement>(".notation-body");
    if (container && measure) {
      const a = el.getBoundingClientRect(),
        b = container.getBoundingClientRect();
      follow.reveal(container, {
        left: a.left - b.left + container.scrollLeft + bounds.x,
        top: a.top - b.top + container.scrollTop + measure.y,
        width: 2,
        height: Math.min(measure.h, container.clientHeight - 28),
      });
    }
  }, [time, rendered, follow.reveal, project.duration]);
  return (
    <div
      className="rhythm-view"
      onWheel={follow.manual}
      onTouchMove={follow.manual}
    >
      <div className="score-follow-controls">
        <button
          className="text-button"
          aria-pressed={follow.following}
          onClick={follow.resume}
        >
          {follow.following ? "跟随播放" : "回到播放位置"}
        </button>
        {!follow.following && <span>跟随已暂停</span>}
        {professional && !piano && (
          <label>
            <input
              type="checkbox"
              checked={fingering}
              onChange={(e) => setFingering(e.target.checked)}
            />{" "}
            显示节奏谱指法
          </label>
        )}
        <button
          className="text-button"
          disabled={!rendered}
          onClick={() => printScore.current?.()}
        >
          打印节奏谱 PDF
        </button>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          谱面暂不可用：{error}
        </p>
      )}
      <div style={{ position: "relative" }}>
        <div ref={element} />
        <div ref={cursor} className="score-play-cursor" hidden />
      </div>
    </div>
  );
}

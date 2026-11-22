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
  const notes = project.arrangement?.notes ?? [],
    seconds = 8,
    width = 900,
    left = 48,
    right = 20,
    barWidth = width - left - right;
  const rows = Math.max(1, Math.ceil(project.duration / seconds));
  return (
    <div className="tab-pages" data-testid="tablature">
      {Array.from({ length: rows }, (_, row) => {
        const start = row * seconds,
          group = notes.filter(
            (n) => n.start >= start && n.start < start + seconds,
          );
        return (
          <svg
            key={row}
            viewBox={`0 0 ${width} 210`}
            role="img"
            aria-label={`${start} 至 ${Math.min(project.duration, start + seconds)} 秒六线谱`}
          >
            <text x="0" y="22" className="measure-label">
              {String(row + 1).padStart(2, "0")}
            </text>
            <text x={left} y="22" className="time-label">
              {start.toFixed(0)}s
            </text>
            {Array.from({ length: 6 }, (_, s) => (
              <g key={s}>
                <text x="14" y={64 + s * 22} className="string-label">
                  {["e", "B", "G", "D", "A", "E"][s]}
                </text>
                <line
                  x1={left}
                  x2={width - right}
                  y1={60 + s * 22}
                  y2={60 + s * 22}
                  stroke="#d0d7d0"
                />
              </g>
            ))}
            {Array.from({ length: 9 }, (_, i) => (
              <line
                key={i}
                x1={left + (i / 8) * barWidth}
                x2={left + (i / 8) * barWidth}
                y1="46"
                y2="182"
                stroke={i === 0 || i === 8 ? "#9aaa9b" : "#e9ece7"}
                strokeDasharray={i % 2 ? "2 5" : undefined}
              />
            ))}
            {group.map((n) => {
              const x = left + ((n.start - start) / seconds) * barWidth,
                y = 60 + (n.string - 1) * 22;
              return (
                <g
                  key={n.id}
                  className="tab-note"
                  onClick={() => onSelect(n)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onSelect(n);
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`${noteName(n.pitch.midi)} ${n.string}弦${n.fret}品 ${n.start.toFixed(2)}秒`}
                >
                  <line
                    x1={x + 11}
                    x2={Math.min(
                      width - right,
                      x + (n.duration / seconds) * barWidth,
                    )}
                    y1={y + 6}
                    y2={y + 6}
                    stroke={n.role === "melody" ? "#7b9c89" : "#c5b79a"}
                    strokeWidth="3"
                    opacity=".55"
                  />
                  <rect
                    x={x - 10}
                    y={y - 12}
                    width="22"
                    height="24"
                    rx="5"
                    fill={
                      selected === n.id
                        ? "#d8ad6b"
                        : n.locked
                          ? "#dbe7e0"
                          : "#fafbf8"
                    }
                  />
                  <text
                    x={x + 1}
                    y={y + 5}
                    textAnchor="middle"
                    className={n.role === "melody" ? "fret melody" : "fret"}
                  >
                    {n.fret}
                  </text>
                </g>
              );
            })}
            {time >= start && time < start + seconds && (
              <line
                x1={left + ((time - start) / seconds) * barWidth}
                x2={left + ((time - start) / seconds) * barWidth}
                y1="42"
                y2="187"
                stroke="#b47040"
                strokeWidth="2"
              />
            )}
            <text
              x={width - right}
              y="204"
              textAnchor="end"
              className="time-label"
            >
              {Math.min(project.duration, start + seconds).toFixed(1)}s
            </text>
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
      .then((alpha) => {
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
        const step = 60 / project.bpm / 4,
          notes = project.arrangement?.notes ?? [];
        const cells = Array.from(
          { length: Math.ceil(project.duration / step) },
          (_, i) => {
            const sounding = notes.filter(
              (n) =>
                Math.round(n.start / step) <= i &&
                Math.round((n.start + n.duration) / step) > i,
            );
            const tokens = sounding.map(
              (n) =>
                `${n.fret}.${n.string}${Math.round(n.start / step) < i ? "{t}" : ""}`,
            );
            return (
              (i && i % 16 === 0 ? "| " : "") +
              (tokens.length > 1 ? `(${tokens.join(" ")})` : (tokens[0] ?? "r"))
            );
          },
        );
        const title = project.name.replace(/["\\\r\n]/g, " ").slice(0, 100);
        a.tex(
          `\\title "${title}" \\tempo ${project.bpm} \\capo ${project.arrangement?.capo ?? 0} . :16 ${cells.join(" ")}`,
        );
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
        节奏谱按十六分网格近似量化，试听保留原始起音与时长。
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

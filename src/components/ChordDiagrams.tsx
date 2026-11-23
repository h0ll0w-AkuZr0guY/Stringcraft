import type { GuitarPerformance } from "../../plugins/guitar/performance";
import { useWorkbenchContext } from "../hooks/WorkbenchContext";
export default function ChordDiagrams() {
  const { project } = useWorkbenchContext();
  const performance = project.arrangement?.performance as
    | GuitarPerformance
    | undefined;
  const grips = Array.isArray(performance?.grips)
    ? performance.grips.filter(
        (g) =>
          typeof g?.name === "string" &&
          Array.isArray(g.shape?.frets) &&
          g.shape.frets.length === 6 &&
          Array.isArray(g.shape.fingers) &&
          g.shape.fingers.length === 6,
      )
    : [];
  const unique = [...new Map(grips.map((g) => [g.shape.id, g])).values()];
  if (!unique.length) return null;
  return (
    <details className="chord-diagrams">
      <summary>参考和弦指型 · 品位相对变调夹</summary>
      <div className="chord-diagram-grid">
        {unique.map((g) => {
          const frets = g.shape.frets.filter((f) => f > 0),
            first = Math.max(1, Math.min(...frets));
          return (
            <svg
              key={g.shape.id}
              width={120}
              height={150}
              viewBox="0 0 120 150"
              role="img"
              aria-label={`${g.name} 和弦指型`}
            >
              <text x={60} y={18} textAnchor="middle" className="fret">
                {g.name}
              </text>
              {Array.from({ length: 6 }, (_, s) => (
                <line
                  key={`s${s}`}
                  x1={25 + s * 14}
                  x2={25 + s * 14}
                  y1={42}
                  y2={122}
                  stroke="#8a9c88"
                />
              ))}
              {Array.from({ length: 5 }, (_, f) => (
                <line
                  key={`f${f}`}
                  x1={25}
                  x2={95}
                  y1={42 + f * 20}
                  y2={42 + f * 20}
                  stroke="#8a9c88"
                  strokeWidth={f === 0 && first === 1 ? 3 : 1}
                />
              ))}
              {first > 1 && (
                <text x={5} y={57} className="time-label">
                  {first}
                </text>
              )}
              {g.shape.frets.map((f, s) => {
                const x = 95 - s * 14;
                return f <= 0 ? (
                  <text
                    key={s}
                    x={x}
                    y={34}
                    textAnchor="middle"
                    className="time-label"
                  >
                    {f < 0 ? "×" : "○"}
                  </text>
                ) : (
                  <g key={s}>
                    <circle
                      cx={x}
                      cy={52 + (f - first) * 20}
                      r={7}
                      fill="#486e4d"
                    />
                    <text
                      x={x}
                      y={55 + (f - first) * 20}
                      fill="white"
                      fontSize={9}
                      textAnchor="middle"
                    >
                      {g.shape.fingers[s]}
                    </text>
                  </g>
                );
              })}
              <text x={60} y={142} textAnchor="middle" className="time-label">
                左侧低音弦 · 数字为手指
              </text>
            </svg>
          );
        })}
      </div>
    </details>
  );
}

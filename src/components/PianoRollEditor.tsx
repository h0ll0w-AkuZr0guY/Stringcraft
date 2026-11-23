import { useEffect, useMemo, useRef, useState } from "react";
import type { NoteEvent, NoteViewPlugin } from "../../packages/contracts";
import { load } from "../../packages/plugin-host";
type Props = {
  notes: NoteEvent[];
  selected: Set<string>;
  onSelect: (ids: Set<string>) => void;
  onChange: (notes: NoteEvent[]) => void;
  onAdd: (start: number, midi: number) => void;
  onPreview: (note: NoteEvent) => void;
  onSeek: (time: number) => void;
  onKey: (event: React.KeyboardEvent) => void;
  duration: number;
  time: number;
  wave: number[];
  processed: number;
  bpm: number;
  snap: boolean;
  editable: boolean;
};
export default function PianoRollEditor(p: Props) {
  const container = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    [view, setView] = useState<NoteViewPlugin | null>(null),
    [error, setError] = useState(""),
    [size, setSize] = useState({ w: 900, h: 550 }),
    [scroll, setScroll] = useState({ x: 0, y: 0 }),
    [scale, setScale] = useState(70),
    [row, setRow] = useState(14),
    [ghost, setGhost] = useState<NoteEvent[] | null>(null),
    [box, setBox] = useState<{
      x: number;
      y: number;
      w: number;
      h: number;
    } | null>(null);
  const drag = useRef<{
    x: number;
    y: number;
    notes: NoteEvent[];
    kind: "move" | "left" | "right" | "box";
    moved: boolean;
  } | null>(null);
  useEffect(() => {
    let active = true;
    load("piano-roll")
      .then((plugin) => {
        if (!plugin.noteView) throw new Error("请更新音符卷帘插件");
        if (active) setView(plugin.noteView);
      })
      .catch((e) => setError(e.message));
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const el = container.current!;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const range = useMemo(
    () =>
      p.notes.reduce(
        (r, n) => ({
          low: Math.min(r.low, n.pitch.midi),
          high: Math.max(r.high, n.pitch.midi),
        }),
        { low: 60, high: 60 },
      ),
    [p.notes],
  );
  const initial = useRef(false);
  useEffect(() => {
    if (initial.current) return;
    initial.current = p.notes.length > 0;
    container.current!.scrollTop = (127 - Math.min(127, range.high + 7)) * row;
  }, [range, row, p.notes.length]);
  const high = 127 - scroll.y / row,
    from = scroll.x / scale,
    to = from + (size.w - 64) / scale,
    index = useMemo(() => view?.index(p.notes), [view, p.notes]),
    shown = useMemo(
      () => index?.query(from, to, high - (size.h - 80) / row, high + 1) ?? [],
      [index, from, to, high, row, size.h],
    );
  useEffect(() => {
    const el = canvas.current;
    if (!el || !view) return;
    const ratio = devicePixelRatio || 1;
    el.width = Math.ceil(size.w * ratio);
    el.height = Math.ceil(size.h * ratio);
    const ctx = el.getContext("2d")!;
    ctx.scale(ratio, ratio);
    view.paint(
      ctx,
      {
        from,
        to,
        high,
        rowHeight: row,
        width: size.w,
        height: size.h,
        duration: p.duration,
        time: p.time,
        wave: p.wave,
        processed: p.processed,
      },
      ghost
        ? [...shown.filter((n) => !ghost.some((g) => g.id === n.id)), ...ghost]
        : shown,
      p.selected,
    );
    if (box) {
      ctx.fillStyle = "#648e7c22";
      ctx.strokeStyle = "#648e7c";
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.strokeRect(box.x, box.y, box.w, box.h);
    }
  }, [
    view,
    shown,
    ghost,
    box,
    from,
    to,
    high,
    row,
    size,
    p.duration,
    p.time,
    p.wave,
    p.processed,
    p.selected,
  ]);
  const coords = (e: { clientX: number; clientY: number }) => {
    const bounds = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - bounds.left, y: e.clientY - bounds.top };
  };
  const at = (x: number) =>
    Math.max(0, Math.min(p.duration, from + (x - 64) / scale));
  const pitch = (y: number) =>
    Math.max(0, Math.min(127, Math.ceil(high - (y - 80) / row)));
  const hit = (x: number, y: number) =>
    index
      ?.query(at(x) - 4 / scale, at(x) + 4 / scale, pitch(y), pitch(y))
      .sort((a, b) => a.duration - b.duration)
      .find(
        (n) =>
          n.start <= at(x) + 4 / scale &&
          n.start + n.duration >= at(x) - 4 / scale,
      );
  const finish = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.kind === "box" && box) {
      const a = at(box.x),
        b = at(box.x + box.w),
        low = pitch(box.y + box.h),
        hi = pitch(box.y);
      p.onSelect(new Set(index?.query(a, b, low, hi).map((n) => n.id)));
    } else if (d.moved && ghost) p.onChange(ghost);
    setGhost(null);
    setBox(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  if (error)
    return (
      <div role="alert" className="inline-error">
        {error}，请在插件中心启用音符卷帘。
      </div>
    );
  return (
    <div className="roll-editor">
      <div className="roll-tools">
        <span>
          {shown.length} 个可见音符 ·
          拖动音符移动，拖动边缘调时长，空白处框选，双击添加
        </span>
        <button
          onClick={() => {
            setScale(Math.max(3, (size.w - 70) / p.duration));
            container.current!.scrollLeft = 0;
            const r = Math.max(
              5,
              Math.min(24, (size.h - 80) / (range.high - range.low + 12)),
            );
            setRow(r);
            requestAnimationFrame(() => {
              container.current!.scrollTop = Math.max(
                0,
                (127 - range.high - 6) * r,
              );
            });
          }}
        >
          适配全曲
        </button>
        <label>
          时间缩放
          <input
            aria-label="时间缩放"
            type="range"
            min="3"
            max="400"
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
          />
        </label>
        <label>
          音高缩放
          <input
            aria-label="音高缩放"
            type="range"
            min="5"
            max="30"
            value={row}
            onChange={(e) => setRow(Number(e.target.value))}
          />
        </label>
      </div>
      <div
        ref={container}
        className="roll-scroll"
        onScroll={(e) =>
          setScroll({
            x: e.currentTarget.scrollLeft,
            y: e.currentTarget.scrollTop,
          })
        }
      >
        <div
          style={{
            width: Math.max(size.w, 64 + p.duration * scale),
            height: 128 * row + 80,
            position: "relative",
          }}
        >
          <canvas
            ref={canvas}
            role="application"
            aria-label="可编辑音符卷帘"
            tabIndex={0}
            data-testid="note-roll"
            data-ready={!!view}
            data-visible={shown.length}
            data-from={from}
            data-high={high}
            data-scale={scale}
            data-row={row}
            style={{
              width: size.w,
              height: size.h,
              position: "sticky",
              top: 0,
              left: 0,
              display: "block",
              touchAction: "none",
            }}
            onKeyDown={p.onKey}
            onDoubleClick={(e) => {
              const { x, y } = coords(e);
              if (p.editable && x > 64 && y > 80 && !hit(x, y))
                p.onAdd(at(x), pitch(y));
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.currentTarget.focus();
              const { x, y } = coords(e);
              if (y < 80) {
                p.onSeek(at(x));
                return;
              }
              if (x < 64) {
                p.onPreview({
                  id: "key",
                  start: 0,
                  duration: 0.5,
                  pitch: { midi: pitch(y) },
                  velocity: 0.7,
                  score: 1,
                  source: "manual",
                });
                return;
              }
              const n = hit(x, y);
              if (n) {
                p.onPreview(n);
                const selection = e.shiftKey
                  ? new Set(p.selected)
                  : p.selected.has(n.id)
                    ? new Set(p.selected)
                    : new Set<string>();
                if (e.shiftKey && selection.has(n.id)) selection.delete(n.id);
                else selection.add(n.id);
                p.onSelect(selection);
                if (!p.editable) return;
                const width = n.duration * scale,
                  start = 64 + (n.start - from) * scale,
                  kind =
                    selection.size > 1
                      ? "move"
                      : width > 14 && x - start < 5
                        ? "left"
                        : start + width - x < 6
                          ? "right"
                          : "move";
                drag.current = {
                  x,
                  y,
                  notes: p.notes
                    .filter((n) => selection.has(n.id))
                    .map((n) => structuredClone(n)),
                  kind,
                  moved: false,
                };
              } else {
                p.onSelect(new Set());
                drag.current = { x, y, notes: [], kind: "box", moved: false };
              }
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const { x, y } = coords(e),
                dx = x - d.x,
                dy = y - d.y;
              if (Math.abs(dx) + Math.abs(dy) < 3) return;
              d.moved = true;
              if (d.kind === "box") {
                setBox({
                  x: Math.min(x, d.x),
                  y: Math.min(y, d.y),
                  w: Math.abs(dx),
                  h: Math.abs(dy),
                });
                return;
              }
              let delta = dx / scale;
              const step = 60 / p.bpm / 4;
              if (p.snap) delta = Math.round(delta / step) * step;
              const dp = -Math.round(dy / row);
              if (d.kind === "move") {
                const minStart = Math.min(...d.notes.map((n) => n.start)),
                  maxEnd = Math.max(
                    ...d.notes.map((n) => n.start + n.duration),
                  ),
                  minPitch = Math.min(...d.notes.map((n) => n.pitch.midi)),
                  maxPitch = Math.max(...d.notes.map((n) => n.pitch.midi));
                delta = Math.max(
                  -minStart,
                  Math.min(p.duration - maxEnd, delta),
                );
                const transpose = Math.max(
                  -minPitch,
                  Math.min(127 - maxPitch, dp),
                );
                setGhost(
                  d.notes.map((n) => ({
                    ...n,
                    start: n.start + delta,
                    pitch: { ...n.pitch, midi: n.pitch.midi + transpose },
                  })),
                );
              } else
                setGhost(
                  d.notes.map((n) => {
                    if (d.kind === "right")
                      return {
                        ...n,
                        duration: Math.max(
                          0.03,
                          Math.min(p.duration - n.start, n.duration + delta),
                        ),
                      };
                    const start = Math.max(
                      0,
                      Math.min(n.start + n.duration - 0.03, n.start + delta),
                    );
                    return {
                      ...n,
                      start,
                      duration: n.start + n.duration - start,
                    };
                  }),
                );
            }}
            onPointerUp={finish}
            onPointerCancel={() => {
              drag.current = null;
              setGhost(null);
              setBox(null);
            }}
          />
        </div>
      </div>
    </div>
  );
}

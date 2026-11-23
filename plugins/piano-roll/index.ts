import type {
  MusicPlugin,
  NoteEvent,
  NoteSpatialIndex,
  NoteWindow,
} from "../../packages/contracts";
function lower(values: number[], n: number) {
  let a = 0,
    b = values.length;
  while (a < b) {
    const m = (a + b) >>> 1;
    if (values[m] < n) a = m + 1;
    else b = m;
  }
  return a;
}
export function index(notes: NoteEvent[]): NoteSpatialIndex {
  const rows = Array.from({ length: 128 }, () => [] as NoteEvent[]);
  for (const n of notes) rows[n.pitch.midi].push(n);
  const data = rows.map((row) => {
    row.sort((a, b) => a.start - b.start);
    let end = 0;
    return {
      row,
      ends: row.map((n) => (end = Math.max(end, n.start + n.duration))),
      starts: row.map((n) => n.start),
    };
  });
  return {
    query(from, to, low, high) {
      const result: NoteEvent[] = [];
      for (
        let p = Math.max(0, Math.ceil(low));
        p <= Math.min(127, Math.floor(high));
        p++
      ) {
        const d = data[p],
          a = lower(d.ends, from),
          b = lower(d.starts, to + 0.000001);
        for (let i = a; i < b; i++)
          if (d.row[i].start + d.row[i].duration >= from) result.push(d.row[i]);
      }
      return result;
    },
  };
}
export function paint(
  ctx: CanvasRenderingContext2D,
  v: NoteWindow,
  notes: NoteEvent[],
  selected: Set<string>,
) {
  const { width: w, height: h, high, rowHeight: r, from, to } = v,
    scale = (w - 64) / (to - from),
    x = (t: number) => 64 + (t - from) * scale,
    y = (m: number) => 80 + (high - m) * r;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#fbfcf8";
  ctx.fillRect(0, 0, w, h);
  ctx.font = "11px Segoe UI, sans-serif";
  for (
    let m = Math.min(127, Math.ceil(high));
    m >= Math.max(0, Math.floor(high - (h - 80) / r));
    m--
  ) {
    const black = [1, 3, 6, 8, 10].includes(m % 12);
    ctx.fillStyle = black ? "#eaf0e8" : "#f8faf6";
    ctx.fillRect(64, y(m), w - 64, r);
    ctx.fillStyle = black ? "#3d5147" : "#ffffff";
    ctx.fillRect(0, y(m), 60, r - 1);
    if (r >= 9 || m % 12 === 0) {
      ctx.fillStyle = black ? "#e5eee6" : "#6a7e6e";
      ctx.fillText(
        ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][
          m % 12
        ] +
          (Math.floor(m / 12) - 1),
        8,
        y(m) + r * 0.73,
      );
    }
  }
  const step =
    [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60].find((s) => s * scale >= 65) ??
    60;
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
    ctx.strokeStyle = "#dce5d8";
    ctx.beginPath();
    ctx.moveTo(x(t), 80);
    ctx.lineTo(x(t), h);
    ctx.stroke();
    ctx.fillStyle = "#788b79";
    ctx.fillText(t.toFixed(step < 1 ? 1 : 0) + "s", x(t) + 4, 17);
  }
  ctx.fillStyle = "#edf3e9";
  ctx.fillRect(64, 25, w - 64, 48);
  ctx.fillStyle = "#a5b99b";
  for (let px = 64; px < w; px += 3) {
    const t = from + (px - 64) / scale,
      i = Math.floor((t / v.duration) * v.wave.length),
      peak = v.wave[i] ?? 0;
    ctx.fillRect(px, 49 - peak * 20, 2, Math.max(1, peak * 40));
  }
  if (v.processed < v.duration) {
    ctx.fillStyle = "#d9e0d34d";
    const start = Math.max(64, x(v.processed));
    ctx.fillRect(start, 80, Math.max(0, w - start), h - 80);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(64, 80, w - 64, h - 80);
  ctx.clip();
  for (const n of notes) {
    const selectedNote = selected.has(n.id);
    ctx.globalAlpha = selectedNote ? 1 : 0.35 + n.score * 0.65;
    ctx.fillStyle = selectedNote
      ? "#d5a366"
      : n.source === "manual"
        ? "#688eaa"
        : n.pitch.midi < 60
          ? "#5c8173"
          : "#7f9f64";
    ctx.fillRect(
      x(n.start),
      y(n.pitch.midi) + 1,
      Math.max(3, n.duration * scale),
      Math.max(2, r - 2),
    );
    if (selectedNote) {
      ctx.strokeStyle = "#765529";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        x(n.start),
        y(n.pitch.midi) + 1,
        Math.max(3, n.duration * scale),
        Math.max(2, r - 2),
      );
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  if (v.time >= from && v.time <= to) {
    ctx.strokeStyle = "#b7783d";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x(v.time), 25);
    ctx.lineTo(x(v.time), h);
    ctx.stroke();
  }
}
export default { noteView: { index, paint } } satisfies MusicPlugin;

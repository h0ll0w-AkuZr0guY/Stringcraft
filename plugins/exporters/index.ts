import type { MusicPlugin, MusicProject } from "../../packages/contracts";
export function tablature(p: MusicProject): string {
  const a = p.arrangement;
  if (!a) throw new Error("请先生成编配");
  const step = 60 / p.bpm / 4,
    width = 48,
    total = Math.ceil(p.duration / step) + 1,
    lines = [
      `${p.name}\n弦作 Stringcraft | ${p.bpm} BPM | Capo ${a.capo} | ${a.transpose >= 0 ? "+" : ""}${a.transpose} 半音\n数字相对变调夹；~ 为持续。十六分网格仅作近似显示。\n`,
    ];
  for (let offset = 0; offset < total; offset += width) {
    const rows = ["e", "B", "G", "D", "A", "E"].map((s) => `${s}|`);
    for (let i = offset; i < Math.min(offset + width, total); i++)
      for (let s = 1; s <= 6; s++) {
        const note = a.notes.find(
          (n) => n.string === s && Math.round(n.start / step) === i,
        );
        const sustain = a.notes.some(
          (n) =>
            n.string === s &&
            Math.round(n.start / step) < i &&
            n.start + n.duration > i * step,
        );
        rows[s - 1] += (note ? String(note.fret) : sustain ? "~" : "-").padEnd(
          3,
          "-",
        );
      }
    lines.push(rows.join("\n"));
  }
  return lines.join("\n\n");
}
const vlq = (n: number) => {
  const b = [n & 127];
  while ((n >>= 7) > 0) b.unshift((n & 127) | 128);
  return b;
};
export function midi(p: MusicProject): Uint8Array {
  if (!p.arrangement) throw new Error("请先生成编配");
  const tempo = Math.round(60000000 / p.bpm),
    ticks = (seconds: number) => Math.round(((seconds * p.bpm) / 60) * 480);
  const events: { tick: number; order: number; data: number[] }[] = [
    {
      tick: 0,
      order: -2,
      data: [255, 81, 3, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255],
    },
  ];
  // Separate string channels preserve overlapping repetitions of a pitch on different strings.
  for (let s = 0; s < 6; s++)
    events.push({ tick: 0, order: -1, data: [192 + s, 24] });
  for (const n of p.arrangement.notes) {
    const ch = n.string - 1;
    events.push(
      {
        tick: ticks(n.start),
        order: 1,
        data: [
          144 + ch,
          n.pitch.midi,
          Math.max(1, Math.round(n.velocity * 127)),
        ],
      },
      {
        tick: Math.max(ticks(n.start) + 1, ticks(n.start + n.duration)),
        order: 0,
        data: [128 + ch, n.pitch.midi, 0],
      },
    );
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const data: number[] = [];
  let prev = 0;
  for (const e of events) {
    data.push(...vlq(e.tick - prev), ...e.data);
    prev = e.tick;
  }
  data.push(0, 255, 47, 0);
  const len = data.length;
  return new Uint8Array([
    77,
    84,
    104,
    100,
    0,
    0,
    0,
    6,
    0,
    0,
    0,
    1,
    1,
    224,
    77,
    84,
    114,
    107,
    (len >>> 24) & 255,
    (len >>> 16) & 255,
    (len >>> 8) & 255,
    len & 255,
    ...data,
  ]);
}
export function exportFile(project: MusicProject, format: string) {
  if (format === "txt")
    return {
      data: tablature(project),
      mime: "text/plain;charset=utf-8",
      extension: "txt",
    };
  if (format === "midi")
    return { data: midi(project), mime: "audio/midi", extension: "mid" };
  if (format === "project")
    return {
      data: JSON.stringify(project, null, 2),
      mime: "application/json",
      extension: "stringcraft.json",
    };
  throw new Error("不支持的导出格式");
}
export default { exportFile } satisfies MusicPlugin;

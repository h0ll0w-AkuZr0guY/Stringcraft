import type {
  HarmonyAnalysis,
  NoteEvent,
  HarmonySegment,
} from "../../packages/contracts";
/** Fixed seconds, never a bar or BPM. This fallback uses note evidence, not separated audio. */
export function analyzeTimeline(
  notes: NoteEvent[],
  duration: number,
): HarmonyAnalysis {
  const hop = 0.25,
    segments: HarmonySegment[] = [];
  const qualities = {
    major: [0, 4, 7],
    minor: [0, 3, 7],
    "7": [0, 4, 7, 10],
    maj7: [0, 4, 7, 11],
    m7: [0, 3, 7, 10],
    sus4: [0, 5, 7],
  } as const;
  for (let t = 0; t < duration; t += hop) {
    const x = Array(12).fill(0),
      bass = Array(12).fill(0),
      a = Math.max(0, t - 0.85),
      b = Math.min(duration, t + 1.1);
    for (const n of notes) {
      const weight =
        Math.max(0, Math.min(b, n.start + n.duration) - Math.max(a, n.start)) *
        n.score *
        n.velocity;
      x[n.pitch.midi % 12] += weight;
      if (n.pitch.midi < 55) bass[n.pitch.midi % 12] += weight;
    }
    const total = x.reduce((a, b) => a + b, 0),
      low = bass.reduce((a, b) => a + b, 0),
      present = x.filter((v) => v > total * 0.09).length;
    const ranked = Array.from({ length: 12 }, (_, root) =>
      Object.entries(qualities).map(([quality, intervals]) => {
        const pcs = intervals.map((v) => (root + v) % 12),
          inside = pcs.reduce((s, p) => s + x[p], 0) / (total || 1);
        return {
          root,
          quality: quality as keyof typeof qualities,
          score:
            inside -
            (1 - inside) * 0.5 +
            (low ? (bass[root] / low) * 0.13 : 0) -
            (intervals.length - 3) * 0.035,
        };
      }),
    )
      .flat()
      .sort((a, b) => b.score - a.score);
    const best = ranked[0],
      none = total < 0.025 || present < 3;
    const margin = best.score - ranked[1].score;
    const s: HarmonySegment = {
      id: `h-${segments.length}`,
      start: t,
      end: Math.min(duration, t + hop),
      root: none ? null : best.root,
      quality: none ? null : best.quality,
      status: none ? "none" : margin > 0.04 ? "supported" : "candidate",
      evidence: Math.max(0, Math.min(1, margin)),
      alternatives: none ? [] : ranked.slice(0, 3),
    };
    const prev = segments.at(-1);
    if (
      prev &&
      prev.root === s.root &&
      prev.quality === s.quality &&
      prev.status === s.status
    )
      prev.end = s.end;
    else segments.push(s);
  }
  return {
    version: 1,
    method: "note-seconds-v1",
    duration,
    frameHop: hop,
    segments,
    executions: [],
    warnings: ["和弦来自固定时间窗的音符候选；本次未使用音频分离。"],
  };
}

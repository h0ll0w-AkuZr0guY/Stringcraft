import type { MusicPlugin, NoteEvent } from "../../packages/contracts";
function voice(
  ctx: BaseAudioContext,
  out: AudioNode,
  n: NoteEvent,
  start: number,
  end: number,
) {
  const o = ctx.createOscillator(),
    g = ctx.createGain();
  o.type = "triangle";
  o.frequency.value = 440 * 2 ** ((n.pitch.midi - 69) / 12);
  const level = 0.14 * Math.max(0.05, n.velocity);
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(
    level,
    start + Math.min(0.008, (end - start) / 3),
  );
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, level * 0.3), end);
  g.gain.linearRampToValueAtTime(0, end + 0.025);
  o.connect(g);
  g.connect(out);
  o.start(start);
  o.stop(end + 0.03);
  o.onended = () => {
    o.disconnect();
    g.disconnect();
  };
  return o;
}
export function scheduleNotes(
  ctx: AudioContext,
  notes: NoteEvent[],
  from: number,
  to: number,
  speed: number,
  atTime?: number,
) {
  const origin = atTime ?? ctx.currentTime + 0.06,
    out = ctx.createDynamicsCompressor();
  out.connect(ctx.destination);
  const queue = notes
    .filter((n) => n.start + n.duration > from && n.start < to)
    .sort((a, b) => a.start - b.start);
  let next = 0;
  const voices = new Set<OscillatorNode>();
  const tick = () => {
    if (
      ctx.state === "closed" ||
      ctx.currentTime > origin + (to - from) / speed + 0.05
    ) {
      stop();
      return;
    }
    const position = from + Math.max(0, ctx.currentTime - origin) * speed;
    while (next < queue.length && queue[next].start < position + 0.2 * speed) {
      const n = queue[next++],
        start = Math.max(ctx.currentTime, origin + (n.start - from) / speed),
        end = origin + (Math.min(to, n.start + n.duration) - from) / speed;
      if (end > start) {
        const o = voice(ctx, out, n, start, end);
        voices.add(o);
        o.addEventListener("ended", () => voices.delete(o));
      }
    }
  };
  const timer = setInterval(tick, 40);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    for (const o of voices)
      try {
        o.stop();
      } catch {}
    out.disconnect();
  };
  tick();
  return {
    origin,
    stop,
  };
}
export async function renderNotes(notes: NoteEvent[], duration: number) {
  const rate = 22050,
    ctx = new OfflineAudioContext(1, Math.ceil((duration + 0.1) * rate), rate),
    out = ctx.createDynamicsCompressor();
  out.connect(ctx.destination);
  for (const n of notes)
    voice(ctx, out, n, n.start, Math.min(duration, n.start + n.duration));
  const buffer = await ctx.startRendering(),
    data = buffer.getChannelData(0),
    bytes = new ArrayBuffer(44 + data.length * 2),
    v = new DataView(bytes);
  const str = (offset: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + data.length * 2, true);
  str(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++)
    v.setInt16(
      44 + i * 2,
      Math.round(Math.max(-1, Math.min(1, data[i])) * 32767),
      true,
    );
  return bytes;
}
export default { scheduleNotes, renderNotes } satisfies MusicPlugin;

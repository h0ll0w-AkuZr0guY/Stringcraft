import type { GuitarNote, NoteEvent } from "../contracts";
type AudioCtx = AudioContext | OfflineAudioContext;
type Sample = {
  instrument: string;
  string: number;
  midi: number;
  local_file: string;
};
const rawSamples = new Map<string, Promise<ArrayBuffer>>();
let manifest: Promise<Sample[]> | undefined;
const resource = (path: string) =>
  new URL(path, new URL(".", location.href)).href;
async function bank(): Promise<Sample[]> {
  return (manifest ??= fetch(resource("samples/manifest.json"))
    .then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    })
    .then((d) => d.samples as Sample[])
    .catch(() => []));
}
async function getSample(ctx: AudioCtx, n: NoteEvent, tone: string) {
  const list = await bank(),
    string = (n as GuitarNote).string;
  const candidates = list
    .filter(
      (s) =>
        s.instrument === tone &&
        (!string || s.string === string) &&
        Math.abs(s.midi - n.pitch.midi) <= 2,
    )
    .sort(
      (a, b) =>
        Math.abs(a.midi - n.pitch.midi) - Math.abs(b.midi - n.pitch.midi),
    );
  const sample = candidates[0];
  if (!sample) return null;
  let raw = rawSamples.get(sample.local_file);
  if (!raw) {
    raw = fetch(resource("samples/" + sample.local_file)).then((r) => {
      if (!r.ok) throw new Error();
      return r.arrayBuffer();
    });
    rawSamples.set(sample.local_file, raw);
  }
  try {
    return {
      buffer: await ctx.decodeAudioData((await raw).slice(0)),
      midi: sample.midi,
    };
  } catch {
    return null;
  }
}
function synth(ctx: AudioCtx, n: NoteEvent, when: number, duration: number) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(
    Math.max(0.01, n.velocity * 0.18),
    when + 0.008,
  );
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    when + Math.max(0.02, duration),
  );
  gain.connect(ctx.destination);
  for (const [harmonic, volume] of [
    [1, 1],
    [2, 0.28],
    [3, 0.1],
  ]) {
    const osc = ctx.createOscillator(),
      amp = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = 440 * 2 ** ((n.pitch.midi - 69) / 12) * harmonic;
    amp.gain.value = volume;
    osc.connect(amp);
    amp.connect(gain);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }
}
export async function schedule(
  ctx: AudioCtx,
  notes: NoteEvent[],
  tone: string,
  from = 0,
  to = Infinity,
  speed = 1,
) {
  const prepared = await Promise.all(
    notes
      .filter((n) => n.start >= from && n.start < to)
      .map(async (n) => ({
        n,
        sample: tone === "synth" ? null : await getSample(ctx, n, tone),
      })),
  );
  const origin =
    ctx instanceof OfflineAudioContext ? 0 : ctx.currentTime + 0.06;
  let fallback = 0;
  for (const { n, sample } of prepared) {
    const when = origin + (n.start - from) / speed,
      duration = Math.max(0.03, Math.min(n.duration, to - n.start) / speed);
    if (!sample) {
      synth(ctx, n, when, duration);
      fallback++;
      continue;
    }
    const source = ctx.createBufferSource(),
      gain = ctx.createGain();
    source.buffer = sample.buffer;
    source.playbackRate.value = 2 ** ((n.pitch.midi - sample.midi) / 12);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.01, n.velocity * 0.7),
      when + 0.004,
    );
    gain.gain.setTargetAtTime(
      0.0001,
      when + Math.max(0.01, duration - 0.035),
      0.012,
    );
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(when);
    source.stop(when + duration + 0.15);
  }
  return { origin, fallback };
}
export function encodeWav(buffer: AudioBuffer): ArrayBuffer {
  const output = new ArrayBuffer(44 + buffer.length * 2),
    view = new DataView(output),
    text = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++)
        view.setUint8(offset + i, s.charCodeAt(i));
    };
  text(0, "RIFF");
  view.setUint32(4, 36 + buffer.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, buffer.length * 2, true);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++)
    view.setInt16(
      44 + i * 2,
      Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767))),
      true,
    );
  return output;
}
export async function renderWav(
  notes: NoteEvent[],
  duration: number,
  tone: string,
) {
  const ctx = new OfflineAudioContext(
    1,
    Math.ceil((duration + 0.3) * 44100),
    44100,
  );
  const result = await schedule(ctx, notes, tone);
  return {
    data: encodeWav(await ctx.startRendering()),
    fallback: result.fallback,
  };
}

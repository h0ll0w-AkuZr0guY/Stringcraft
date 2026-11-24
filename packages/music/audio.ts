import type { GuitarNote, NoteEvent } from "../contracts";
import { articulationSegments, type AudioGesture } from "./performance-audio";
import { sampleChoices, type GuitarSample } from "./sample-bank";
type AudioCtx = AudioContext | OfflineAudioContext;
type Sample = GuitarSample;
type RenderSession = {
  decoded: Map<string, Promise<AudioBuffer>>;
  fallbackIds: Set<string>;
};
const rawSamples = new Map<string, Promise<ArrayBuffer>>();
// One decoded buffer per file and context. A whole score reuses each sample
// hundreds of times; decoding it per note can exhaust the browser's memory.
const decodedSamples = new WeakMap<
  AudioCtx,
  Map<string, Promise<AudioBuffer>>
>();
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
async function getSample(
  ctx: AudioCtx,
  n: NoteEvent,
  tone: string,
  session?: RenderSession,
) {
  const selected = sampleChoices(await bank(), n, tone);
  if (!selected.length) return null;
  const layers = await Promise.all(
    selected.map(async ({ sample, gain }) => {
      let raw = rawSamples.get(sample.local_file);
      if (!raw) {
        raw = fetch(resource("samples/" + sample.local_file)).then((r) => {
          if (!r.ok) throw new Error("采样不可用");
          return r.arrayBuffer();
        });
        rawSamples.set(sample.local_file, raw);
      }
      let cache = session?.decoded ?? decodedSamples.get(ctx);
      if (!cache) {
        cache = new Map();
        decodedSamples.set(ctx, cache);
      }
      try {
        let decoded = cache.get(sample.local_file);
        if (!decoded) {
          decoded = raw.then((bytes) => ctx.decodeAudioData(bytes.slice(0)));
          cache.set(sample.local_file, decoded);
        }
        if (cache.size > 128) cache.delete(cache.keys().next().value!);
        return { buffer: await decoded, midi: sample.midi, gain };
      } catch {
        cache.delete(sample.local_file);
        return null;
      }
    }),
  );
  const available = layers.filter(
    (x): x is NonNullable<typeof x> => x !== null,
  );
  return available.length ? available : null;
}

function synth(
  ctx: AudioCtx,
  n: NoteEvent,
  when: number,
  duration: number,
  destination: AudioNode,
  changes: AudioGesture["changes"],
  from: number,
  origin: number,
  speed: number,
) {
  if ((n as GuitarNote).dead) {
    const length = Math.max(0.02, Math.min(0.07, duration)),
      buffer = ctx.createBuffer(
        1,
        Math.ceil(ctx.sampleRate * length),
        ctx.sampleRate,
      ),
      channel = buffer.getChannelData(0);
    let state = 17;
    for (let i = 0; i < channel.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) | 0;
      channel[i] =
        (state / 2147483648) *
        Math.exp((-i / channel.length) * 7) *
        n.velocity *
        0.45;
    }
    const source = ctx.createBufferSource(),
      filter = ctx.createBiquadFilter();
    source.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.value = 1100;
    source.connect(filter);
    filter.connect(destination);
    source.start(when);
    return;
  }
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
  gain.connect(destination);
  for (const [harmonic, volume] of [
    [1, 1],
    [2, 0.28],
    [3, 0.1],
  ]) {
    const osc = ctx.createOscillator(),
      amp = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = 440 * 2 ** ((n.pitch.midi - 69) / 12) * harmonic;
    for (const change of changes)
      osc.frequency.setTargetAtTime(
        440 * 2 ** ((change.midi - 69) / 12) * harmonic,
        origin + (change.time - from) / speed,
        change.kind === "slide" ? 0.045 : 0.007,
      );
    amp.gain.value = volume;
    osc.connect(amp);
    amp.connect(gain);
    osc.start(when);
    osc.stop(when + duration + 0.02);
  }
}
export async function prepareAudio(
  ctx: AudioCtx,
  notes: NoteEvent[],
  tone: string,
) {
  if (tone !== "synth")
    await Promise.all(
      notes
        .filter((n) => !(n as GuitarNote).dead)
        .map((n) => getSample(ctx, n, tone)),
    );
}
export async function schedule(
  ctx: AudioCtx,
  notes: NoteEvent[],
  tone: string,
  from = 0,
  to = Infinity,
  speed = 1,
  session?: RenderSession,
  atTime?: number,
) {
  const prepared = await Promise.all(
    articulationSegments(notes, from, to).map(async (gesture) => ({
      gesture,
      samples:
        tone === "synth" || (gesture.note as GuitarNote).dead
          ? null
          : await getSample(ctx, gesture.note, tone, session),
    })),
  );
  const origin =
    atTime ?? (ctx instanceof OfflineAudioContext ? 0 : ctx.currentTime + 0.06);
  let fallback = 0;
  const mix = ctx.createGain(),
    compressor = ctx.createDynamicsCompressor();
  mix.gain.value = 0.7;
  compressor.threshold.value = -8;
  compressor.knee.value = 8;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.18;
  mix.connect(compressor);
  compressor.connect(ctx.destination);
  const solo = notes.some((n) => n.role === "melody");
  for (const { gesture, samples } of prepared) {
    const n = {
      ...gesture.note,
      velocity:
        gesture.note.velocity *
        (solo
          ? gesture.note.role === "melody"
            ? 1.1
            : gesture.note.role === "bass"
              ? 0.8
              : 0.55
          : gesture.note.role === "bass"
            ? 0.85
            : 0.7),
    };
    const when = origin + (n.start - from) / speed,
      duration = Math.max(0.015, Math.min(n.duration, to - n.start) / speed);
    if (!samples) {
      synth(ctx, n, when, duration, mix, gesture.changes, from, origin, speed);
      if (!(n as GuitarNote).dead) {
        fallback++;
        session?.fallbackIds.add(n.id);
      }
      continue;
    }
    for (const sample of samples) {
      const source = ctx.createBufferSource(),
        gain = ctx.createGain();
      source.buffer = sample.buffer;
      const rate = 2 ** ((n.pitch.midi - sample.midi) / 12);
      if (gesture.glideFrom !== undefined) {
        source.playbackRate.setValueAtTime(
          2 ** ((gesture.glideFrom - sample.midi) / 12),
          when,
        );
        source.playbackRate.linearRampToValueAtTime(
          rate,
          when + Math.min(0.075, duration * 0.5),
        );
      } else source.playbackRate.value = rate;
      const release = (n as GuitarNote).articulation?.releaseSeconds ?? 0.06;
      const peak = Math.max(0.001, n.velocity * 0.7 * sample.gain);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.linearRampToValueAtTime(
        peak,
        when + (gesture.softAttack ? 0.02 : 0.004),
      );
      gain.gain.setTargetAtTime(
        0.0001,
        when + Math.max(0.01, duration - 0.008),
        Math.max(0.003, release / 4),
      );
      source.connect(gain);
      gain.connect(mix);
      const offset = Math.min(
        Math.max(0, sample.buffer.duration - 0.001),
        ((gesture.sampleOffset ?? 0) * rate) / speed,
      );
      source.start(when, offset);
      source.stop(when + duration + release + 0.02);
    }
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
  progress?: (processed: number, total: number) => void,
) {
  const rate = 44100,
    total = duration + 0.3,
    output = new Float32Array(Math.ceil(total * rate));
  const session: RenderSession = { decoded: new Map(), fallbackIds: new Set() };
  const overlap = 0.02;
  for (let from = 0; from < total; from += 16) {
    const to = Math.min(total, from + 16 + overlap),
      ctx = new OfflineAudioContext(1, Math.ceil((to - from) * rate), rate);
    await schedule(ctx, notes, tone, from, to, 1, session);
    const block = (await ctx.startRendering()).getChannelData(0),
      offset = Math.round(from * rate);
    for (let i = 0; i < block.length && offset + i < output.length; i++) {
      const weight =
        from > 0 && i < Math.round(overlap * rate)
          ? i / Math.round(overlap * rate)
          : 1;
      output[offset + i] =
        output[offset + i] * (1 - weight) + block[i] * weight;
    }
    progress?.(Math.min(duration, from + 16), duration);
  }
  return {
    data: encodeWav({
      length: output.length,
      sampleRate: rate,
      getChannelData: () => output,
    } as unknown as AudioBuffer),
    fallback: session.fallbackIds.size,
  };
}

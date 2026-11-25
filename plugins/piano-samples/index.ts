import type { MusicPlugin, NoteEvent } from "../../packages/contracts";
import {
  monoWav,
  renderNotes as syntheticWav,
  scheduleNotes as syntheticSchedule,
} from "../note-audio";

type Patch = { midi: number; layer: number; file: string; sha256: string };
const buffers = new Map<string, AudioBuffer>();
const pending = new Map<string, Promise<void>>();
const root = () => new URL("piano-samples/", document.baseURI);
let manifest: Promise<Patch[]> | undefined;
const select = (midi: number, velocity: number) =>
  Math.min(108, Math.max(21, Math.round(midi / 3) * 3)) +
  "-" +
  (velocity < 0.65 ? 5 : 12);
const keyOf = (note: NoteEvent) => select(note.pitch.midi, note.velocity);

async function prepareAudio(ctx: BaseAudioContext, notes: NoteEvent[]) {
  manifest ??= fetch(new URL("manifest.json", root()), {
    signal: AbortSignal.timeout(5000),
  })
    .then(async (response) =>
      response.ok ? ((await response.json()).files as Patch[]) : [],
    )
    .catch(() => []);
  const files = await manifest;
  const needed = new Set(notes.map(keyOf));
  await Promise.all(
    files
      .filter((p) => needed.has(p.midi + "-" + p.layer))
      .map((p) => {
        const key = p.midi + "-" + p.layer;
        if (buffers.has(key)) return;
        const existing = pending.get(key);
        if (existing) return existing;
        const work = (async () => {
          const response = await fetch(new URL(p.file, root()), {
            signal: AbortSignal.timeout(8000),
          });
          if (!response.ok) throw new Error("Sample unavailable");
          const bytes = await response.arrayBuffer();
          const digest = Uint8Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
          );
          if (
            Array.from(digest, (byte) =>
              byte.toString(16).padStart(2, "0"),
            ).join("") !== p.sha256
          )
            throw new Error("Sample checksum mismatch");
          buffers.set(key, await ctx.decodeAudioData(bytes));
        })()
          .catch(() => {})
          .finally(() => pending.delete(key));
        pending.set(key, work);
        return work;
      }),
  );
}

const hasSamples = (notes: NoteEvent[]) =>
  notes.length > 0 && notes.every((note) => buffers.has(keyOf(note)));
function playSampleNote(
  ctx: BaseAudioContext,
  midi: number,
  velocity: number,
  start: number,
  duration?: number,
  offset = 0,
) {
  const key = select(midi, velocity);
  const buffer = buffers.get(key);
  if (!buffer) return;
  const source = ctx.createBufferSource(),
    volume = ctx.createGain();
  const rate = 2 ** ((midi - Number(key.split("-")[0])) / 12);
  const position = offset * rate;
  if (position >= buffer.duration) return () => {};
  source.buffer = buffer;
  source.playbackRate.value = rate;
  source.connect(volume).connect(ctx.destination);
  volume.gain.setValueAtTime(Math.max(0.08, velocity) * 0.48, start);
  source.start(start, position);
  let ended = false;
  source.onended = () => {
    ended = true;
    source.disconnect();
    volume.disconnect();
  };
  const release = (at: number) => {
    if (ended) return;
    volume.gain.cancelScheduledValues(at);
    volume.gain.setTargetAtTime(0.0001, at, 0.045);
    source.stop(at + 0.24);
  };
  if (duration !== undefined) release(start + duration);
  return () => release(Math.max(ctx.currentTime, start));
}

function scheduleNotes(
  ctx: AudioContext,
  notes: NoteEvent[],
  from: number,
  to: number,
  speed: number,
  origin = ctx.currentTime + 0.06,
) {
  const queue = notes.filter(
    (n) => n.start < to && n.start + n.duration > from,
  );
  const missing = queue.filter((n) => !buffers.has(keyOf(n)));
  const synth = missing.length
    ? syntheticSchedule(ctx, missing, from, to, speed, origin)
    : undefined;
  const voices = queue
    .filter((n) => buffers.has(keyOf(n)))
    .map((n) =>
      playSampleNote(
        ctx,
        n.pitch.midi,
        n.velocity,
        origin + (Math.max(n.start, from) - from) / speed,
        (Math.min(to, n.start + n.duration) - Math.max(n.start, from)) / speed,
        Math.max(0, from - n.start) / speed,
      ),
    );
  return {
    origin,
    stop: () => {
      synth?.stop();
      voices.forEach((stop) => stop?.());
    },
  };
}

async function renderNotes(notes: NoteEvent[], duration: number) {
  const rate = 24000;
  const ctx = new OfflineAudioContext(
    1,
    Math.ceil((duration + 0.25) * rate),
    rate,
  );
  await prepareAudio(ctx, notes);
  if (!hasSamples(notes)) return syntheticWav(notes, duration);
  for (const n of notes)
    if (n.start < duration)
      playSampleNote(
        ctx,
        n.pitch.midi,
        n.velocity,
        n.start,
        Math.min(n.duration, duration - n.start),
      );
  return monoWav(await ctx.startRendering());
}

export default {
  prepareAudio,
  hasSamples,
  playSampleNote,
  scheduleNotes,
  renderNotes,
} satisfies MusicPlugin;

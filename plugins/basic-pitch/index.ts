import * as tf from "@tensorflow/tfjs";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import {
  BasicPitch,
  noteFramesToTime,
  outputToNotesPoly,
} from "@spotify/basic-pitch";
import type {
  NoteEvent,
  MusicPlugin,
  TranscriptionChunk,
} from "../../packages/contracts";
import { stitch, type ChunkNote } from "./stitch";
/** tfjs 3.21 signal.frame pads with fill(dtype=undefined), unsupported by WASM.
 * Keep Spotify's exact framing geometry, using explicit float32 host padding. */
class WasmBasicPitch extends BasicPitch {
  override async prepareData(
    samples: Float32Array,
  ): Promise<[tf.Tensor3D, number]> {
    const frame = 43844,
      hop = 36164,
      pad = 3840,
      count = Math.ceil((samples.length + pad) / hop);
    const output = new Float32Array(count * frame);
    for (let i = 0; i < count; i++) {
      const sourceStart = i * hop - pad,
        lo = Math.max(0, sourceStart),
        hi = Math.min(samples.length, sourceStart + frame);
      if (hi > lo)
        output.set(samples.subarray(lo, hi), i * frame + lo - sourceStart);
    }
    return [tf.tensor3d(output, [count, frame, 1], "float32"), samples.length];
  }
}
export async function transcribe(
  samples: Float32Array,
  modelUrl: string,
  wasmUrl: string,
  progress: (value: number) => void,
  chunk?: (value: TranscriptionChunk) => void,
): Promise<NoteEvent[]> {
  setWasmPaths(wasmUrl);
  tf.env().set("WASM_HAS_MULTITHREAD_SUPPORT", false);
  await tf.setBackend("wasm");
  await tf.ready();
  const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  if (peak < 0.0001) {
    chunk?.({
      notes: [],
      processedSeconds: samples.length / 22050,
      complete: true,
    });
    return [];
  }
  const model = new WasmBasicPitch(modelUrl);
  await model.model;
  const frames: number[][] = [],
    onsets: number[][] = [];
  try {
    if (chunk) {
      let all: NoteEvent[] = [];
      const duration = samples.length / 22050;
      for (let from = 0; from < duration; from += 6) {
        const to = Math.min(duration, from + 6),
          a = Math.max(0, from - 0.5),
          b = Math.min(duration, to + 0.5),
          part = samples.slice(Math.round(a * 22050), Math.round(b * 22050)),
          f: number[][] = [],
          o: number[][] = [];
        tf.engine().startScope();
        try {
          await model.evaluateModel(
            part,
            (frames, onsets) => {
              f.push(...frames);
              o.push(...onsets);
            },
            () => {},
          );
        } finally {
          tf.engine().endScope();
        }
        const raw = outputToNotesPoly(f, o, 0.5, 0.3, 8, true),
          timed = noteFramesToTime(raw);
        const notes: ChunkNote[] = timed
          .map((n, i) => ({
            id: "pending",
            start: Math.max(a, a + n.startTimeSeconds),
            duration: Math.min(
              n.durationSeconds,
              b - a - Math.max(0, n.startTimeSeconds),
            ),
            pitch: { midi: n.pitchMidi },
            velocity: Math.max(0.15, Math.min(1, n.amplitude)),
            score: Math.max(0, Math.min(1, n.amplitude)),
            source: "detected" as const,
            continues:
              from > 0 &&
              n.startTimeSeconds < 0.09 &&
              Math.max(
                ...o
                  .slice(
                    Math.max(0, raw[i].startFrame - 1),
                    raw[i].startFrame + 2,
                  )
                  .map((row) => row[n.pitchMidi - 21] ?? 0),
              ) < 0.5,
          }))
          .filter((n) => n.duration > 0.04);
        all = stitch(all, notes, from, to, duration);
        progress(to / duration);
        chunk({ notes: all, processedSeconds: to, complete: to >= duration });
      }
      return all;
    }
    await model.evaluateModel(
      samples,
      (f, o) => {
        frames.push(...f);
        onsets.push(...o);
      },
      progress,
    );
    return noteFramesToTime(
      outputToNotesPoly(frames, onsets, 0.5, 0.3, 8, true),
    )
      .filter(
        (n) =>
          n.durationSeconds > 0.04 &&
          n.startTimeSeconds >= 0 &&
          n.startTimeSeconds < samples.length / 22050,
      )
      .map((n, i) => ({
        id: `bp-${i}`,
        start: n.startTimeSeconds,
        duration: Math.min(
          n.durationSeconds,
          samples.length / 22050 - n.startTimeSeconds,
        ),
        pitch: { midi: n.pitchMidi },
        velocity: Math.max(0.15, Math.min(1, n.amplitude)),
        score: Math.max(0, Math.min(1, n.amplitude)),
        source: "detected",
      }));
  } finally {
    (await model.model).dispose();
  }
}
export default { transcribe } satisfies MusicPlugin;

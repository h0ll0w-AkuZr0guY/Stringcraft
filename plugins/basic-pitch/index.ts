import * as tf from "@tensorflow/tfjs";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import {
  BasicPitch,
  noteFramesToTime,
  outputToNotesPoly,
} from "@spotify/basic-pitch";
import type { NoteEvent, MusicPlugin } from "../../packages/contracts";
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
): Promise<NoteEvent[]> {
  setWasmPaths(wasmUrl);
  tf.env().set("WASM_HAS_MULTITHREAD_SUPPORT", false);
  await tf.setBackend("wasm");
  await tf.ready();
  const peak = samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  if (peak < 0.0001) return [];
  const model = new WasmBasicPitch(modelUrl);
  await model.model;
  const frames: number[][] = [],
    onsets: number[][] = [];
  try {
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

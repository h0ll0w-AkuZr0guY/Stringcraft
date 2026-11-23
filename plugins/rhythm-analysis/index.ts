import type {
  MusicPlugin,
  TimingAnalysis,
  TimingCandidate,
} from "../../packages/contracts";
import { spectrumTransform } from "./spectrum";
const RATE = 22050,
  SIZE = 1024,
  HOP = 128;
const percentile = (sorted: number[], fraction: number) => {
  const index = fraction * (sorted.length - 1),
    low = Math.floor(index);
  return (
    sorted[low] +
    (sorted[Math.min(low + 1, sorted.length - 1)] - sorted[low]) * (index - low)
  );
};

/** Waveform evidence is independent of Basic Pitch's note selection. */
export function onsetEnvelope(samples: Float32Array): Float64Array {
  let maximum = 0;
  for (const value of samples) maximum = Math.max(maximum, Math.abs(value));
  if (maximum < 1e-7) return new Float64Array();
  const transform = spectrumTransform(SIZE),
    window = Float64Array.from(
      { length: SIZE },
      (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SIZE),
    );
  const frames = Math.floor(samples.length / HOP) + 1,
    flux = new Float64Array(frames - 1),
    previous = new Float64Array(SIZE / 2 + 1);
  const first = Math.ceil((70 * SIZE) / RATE),
    last = Math.floor((5000 * SIZE) / RATE);
  for (let frame = 0; frame < frames; frame++) {
    for (let i = 0; i < SIZE; i++) {
      const index = frame * HOP + i - SIZE / 2;
      transform.real[i] = ((samples[index] ?? 0) / maximum) * window[i];
    }
    const magnitude = transform.magnitude();
    for (let bin = 0; bin < magnitude.length; bin++)
      magnitude[bin] = Math.log1p(1000 * magnitude[bin]);
    if (frame) {
      let value = 0;
      for (let bin = first; bin <= last; bin++)
        value += Math.max(
          0,
          magnitude[bin] -
            Math.max(previous[bin - 1], previous[bin], previous[bin + 1]),
        );
      flux[frame - 1] = value / (last - first + 1);
    }
    previous.set(magnitude);
  }
  const clean = new Float64Array(flux.length);
  for (let i = 0; i < flux.length; i++) {
    const local = [];
    for (let j = i - 15; j <= i + 15; j++) {
      const reflected =
        j < 0 ? -j - 1 : j >= flux.length ? 2 * flux.length - j - 1 : j;
      local.push(flux[reflected] ?? 0);
    }
    local.sort((a, b) => a - b);
    clean[i] = Math.max(0, flux[i] - local[15]);
  }
  const scale = percentile(
    [...clean].sort((a, b) => a - b),
    0.95,
  );
  if (scale > 1e-9) for (let i = 0; i < clean.length; i++) clean[i] /= scale;
  return clean;
}
function phase(envelope: Float64Array, periodFrames: number) {
  let best = 0,
    bestScore = -Infinity;
  for (let phase = 0; phase < periodFrames; phase++) {
    let sum = 0,
      count = 0;
    for (
      let frame = phase;
      frame < envelope.length - 1;
      frame += periodFrames
    ) {
      const a = Math.floor(frame),
        f = frame - a;
      sum += envelope[a] * (1 - f) + envelope[a + 1] * f;
      count++;
    }
    const score = sum / Math.max(1, count);
    if (score > bestScore) {
      bestScore = score;
      best = phase;
    }
  }
  const period = (periodFrames * HOP) / RATE;
  return (((best + 1) * HOP) / RATE) % period;
}
export function analyzeTiming(
  samples: Float32Array,
  sampleRate: number,
  noteProposalBpm?: number,
): TimingAnalysis {
  if (
    !(samples instanceof Float32Array) ||
    sampleRate !== RATE ||
    samples.length > RATE * 60 ||
    samples.some((n) => !Number.isFinite(n))
  )
    throw new Error("拍点插件需要不超过 60 秒的 22050 Hz 单声道浮点样本");
  const result: TimingAnalysis = {
    method: "spectral-flux-acf-v1",
    durationSeconds: samples.length / RATE,
    status: "unconfirmed",
    candidates: [],
    warnings: [
      "波形周期可能对应半速、倍速或其他分拍；拍点相位不代表小节首拍，请试听后确认。",
    ],
  };
  if (samples.length < RATE * 4) {
    result.warnings.push("片段短于 4 秒，请延长片段或手动轻拍定速。");
    return result;
  }
  const envelope = onsetEnvelope(samples);
  if (!envelope.length) {
    result.warnings.push("没有检测到稳定起音。");
    return result;
  }
  let energy = 0;
  for (const value of envelope) energy += value * value;
  if (energy < 1e-9) return result;
  const low = Math.floor(((RATE / HOP) * 60) / 240),
    high = Math.floor(((RATE / HOP) * 60) / 40),
    correlations = new Float64Array(high + 2);
  for (let lag = low - 1; lag <= high + 1; lag++) {
    let sum = 0;
    for (let i = lag; i < envelope.length; i++)
      sum += envelope[i] * envelope[i - lag];
    correlations[lag] = sum / energy;
  }
  const background = percentile(
    [...correlations.slice(low, high + 1)].sort((a, b) => a - b),
    0.5,
  );
  const peaks: TimingCandidate[] = [];
  for (let lag = low; lag <= high; lag++)
    if (
      correlations[lag] > correlations[lag - 1] &&
      correlations[lag] >= correlations[lag + 1]
    ) {
      const a = correlations[lag - 1],
        b = correlations[lag],
        c = correlations[lag + 1],
        denominator = a - 2 * b + c;
      const correction =
        Math.abs(denominator) > 1e-9
          ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denominator))
          : 0;
      const bpm = (60 * RATE) / HOP / (lag + correction),
        score = Math.max(0, Math.min(1, (b - background) / (1 - background)));
      if (bpm >= 40 && bpm <= 240 && score >= 0.035)
        peaks.push({ bpm, phaseSeconds: 0, score });
    }
  peaks.sort((a, b) => b.score - a.score);
  for (const candidate of peaks)
    if (
      result.candidates.every(
        (c) => Math.abs(Math.log2(c.bpm / candidate.bpm)) >= 0.05,
      )
    ) {
      candidate.phaseSeconds = phase(
        envelope,
        (60 * RATE) / HOP / candidate.bpm,
      );
      result.candidates.push(candidate);
      if (result.candidates.length === 5) break;
    }
  // A close note proposal can select between waveform-supported metrical aliases.
  // It never manufactures a waveform candidate or supplies a downbeat label.
  if (result.candidates.length)
    result.proposal = { bpm: result.candidates[0].bpm, source: "waveform" };
  if (noteProposalBpm !== undefined && Number.isFinite(noteProposalBpm)) {
    const supported = result.candidates.find(
      (c) => Math.abs(c.bpm / noteProposalBpm - 1) <= 0.04,
    );
    if (supported)
      result.proposal = { bpm: noteProposalBpm, source: "note-supported" };
  }
  if (!result.candidates.length)
    result.warnings.push("未发现足够稳定的周期，请手动确认速度。");
  return result;
}
export default { analyzeTiming } satisfies MusicPlugin;

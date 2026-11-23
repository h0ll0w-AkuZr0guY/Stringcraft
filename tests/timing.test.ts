import { describe, it, expect } from "vitest";
import { analyzeTiming } from "../plugins/rhythm-analysis";
import { spectrumTransform } from "../plugins/rhythm-analysis/spectrum";
import { validateTiming } from "../packages/contracts";
import { analyzeHarmony } from "../plugins/harmony";

describe("independent waveform timing", () => {
  it("harmony windows follow the pickup and changed meter without swallowing the next chord", () => {
    const s = {
      version: 2 as const,
      durationBeats: 6.5,
      beatOffsetSeconds: 0,
      tempo: [{ beat: 0, bpm: 120 }],
      meter: [
        { beat: 0, numerator: 4, denominator: 4 },
        { beat: 4.5, numerator: 3, denominator: 4 },
      ],
      pickupBeats: 0.5,
      timing: "manual" as const,
      events: [],
      chords: [
        {
          id: "written",
          beat: 0.5,
          durationBeats: 4,
          root: 0,
          quality: "major" as const,
          origin: "manual" as const,
        },
      ],
      sections: [],
      warnings: [],
    };
    const notes = [55, 59, 62].map((midi, i) => ({
      id: String(i),
      start: 2.25,
      duration: 1,
      pitch: { midi },
      velocity: 0.7,
      score: 1,
      source: "manual" as const,
    }));
    const result = analyzeHarmony(notes, s);
    expect(result.chords.find((c) => c.id === "written")).toEqual(s.chords[0]);
    expect(result.chords.find((c) => c.origin === "estimated")?.beat).toBe(4.5);
  });
  it("FFT preserves the frequency and amplitude of a known sinusoid", () => {
    const transform = spectrumTransform(16);
    for (let i = 0; i < 16; i++)
      transform.real[i] = Math.sin((2 * Math.PI * 3 * i) / 16);
    const magnitude = transform.magnitude();
    expect(magnitude[3]).toBeCloseTo(1, 10);
    expect(magnitude[2]).toBeLessThan(1e-10);
  });
  it("retains the pulse tempo and phase of an original synthetic click phrase", () => {
    const rate = 22050,
      samples = new Float32Array(rate * 8);
    for (let time = 0.25; time < 8; time += 0.5)
      for (let i = 0; i < 300; i++) {
        const index = Math.round(time * rate) + i;
        if (index < samples.length)
          samples[index] =
            Math.sin((2 * Math.PI * 900 * i) / rate) * Math.exp(-i / 65);
      }
    const result = analyzeTiming(samples, rate),
      candidate = result.candidates.find((c) => Math.abs(c.bpm - 120) < 2);
    expect(candidate).toBeDefined();
    expect(Math.abs(candidate!.phaseSeconds - 0.25)).toBeLessThan(0.035);
    expect(result.status).toBe("unconfirmed");
    validateTiming(result);
    const hinted = analyzeTiming(samples, rate, 120);
    expect(hinted.proposal).toEqual({ bpm: 120, source: "note-supported" });
    expect(hinted.candidates).toEqual(result.candidates);
  });
  it("silence and short clips produce warnings rather than fabricated beat grids", () => {
    expect(
      analyzeTiming(new Float32Array(22050 * 5), 22050).candidates,
    ).toEqual([]);
    expect(
      analyzeTiming(new Float32Array(22050), 22050).warnings.some((w) =>
        w.includes("4 秒"),
      ),
    ).toBe(true);
    expect(() => analyzeTiming(new Float32Array([NaN]), 22050)).toThrow();
    expect(() => analyzeTiming(new Float32Array(1), 44100)).toThrow();
  });
  it("rejects evidence mislabeled as certainty or as a bar downbeat", () => {
    expect(() =>
      validateTiming({
        method: "test",
        durationSeconds: 5,
        status: "confirmed",
        candidates: [],
        warnings: [],
      } as never),
    ).toThrow();
    expect(() =>
      validateTiming({
        method: "test",
        durationSeconds: 5,
        status: "unconfirmed",
        candidates: [{ bpm: 120, phaseSeconds: 1, score: 0.8 }],
        warnings: [],
      }),
    ).toThrow();
  });
});

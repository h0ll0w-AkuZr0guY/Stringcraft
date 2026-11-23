import { test, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tempoCandidates } from "../../plugins/harmony";
import { compareNotes } from "../../packages/music/evaluation";
import type { NoteEvent, TimingAnalysis } from "../../packages/contracts";

test("compare waveform timing proposals with an independent nominal beat corpus", async ({
  page,
}) => {
  test.skip(
    !process.env.STRINGCRAFT_TIMING_CORPUS ||
      !process.env.STRINGCRAFT_TIMING_NOTES,
    "Opt-in verified local audio and frozen browser note cache",
  );
  test.setTimeout(180000);
  const bytes = await readFile(process.env.STRINGCRAFT_TIMING_CORPUS!),
    cacheBytes = await readFile(process.env.STRINGCRAFT_TIMING_NOTES!);
  const manifest = JSON.parse(bytes.toString()) as {
    source: string;
    task: string;
    tracks: {
      id: string;
      path: string;
      sha256: string;
      referenceBpm: number;
      beatTimes: number[];
    }[];
  };
  const cache = JSON.parse(cacheBytes.toString()) as {
    records: { id: string; sha256: string; detected: NoteEvent[] }[];
  };
  await page.route("**/__timing_audio/*", async (route) => {
    const index = Number(
      new URL(route.request().url()).pathname.split("/").at(-1),
    );
    await route.fulfill({
      contentType: "audio/wav",
      body: await readFile(manifest.tracks[index].path),
    });
  });
  await page.goto("./");
  const plugin = await page.evaluate(async () => {
    const catalog = await (await fetch("plugins/catalog.json")).json();
    return catalog.find((p: { id: string }) => p.id === "rhythm-analysis");
  });
  expect(plugin).toBeDefined();
  const records: {
    id: string;
    sha256: string;
    referenceBpm: number;
    baseline: {
      bpm: number;
      strict: boolean;
      best5Strict: boolean;
      nominalGridF1: number;
    };
    waveform: {
      primaryBpm: number | null;
      primaryStrict: boolean;
      best5Strict: boolean;
      closestPhaseError: number | null;
    };
    proposal: {
      bpm: number;
      source: string;
      strict: boolean;
      nominalGridF1: number;
    };
    analysis: TimingAnalysis;
  }[] = [];
  for (const [index, track] of manifest.tracks.entries()) {
    const detected = cache.records.find((r) => r.id === track.id);
    expect(detected?.sha256).toBe(track.sha256);
    const old = tempoCandidates(detected!.detected),
      noteBpm = old[0]?.bpm ?? 120;
    const analysis = (await page.evaluate(
      async ({ index, entry, noteBpm }) => {
        const bytes = await (
            await fetch(`__timing_audio/${index}`)
          ).arrayBuffer(),
          ctx = new AudioContext();
        try {
          const original = await ctx.decodeAudioData(bytes),
            duration = Math.min(30, original.duration),
            offline = new OfflineAudioContext(
              1,
              Math.ceil(duration * 22050),
              22050,
            ),
            source = offline.createBufferSource();
          source.buffer = original;
          source.connect(offline.destination);
          source.start(0, 0, duration);
          const rendered = await offline.startRendering();
          const blob = URL.createObjectURL(
            new Blob([await (await fetch(entry)).text()], {
              type: "text/javascript",
            }),
          );
          try {
            const implementation = (await import(/* @vite-ignore */ blob))
              .default;
            return implementation.analyzeTiming(
              rendered.getChannelData(0),
              22050,
              noteBpm,
            );
          } finally {
            URL.revokeObjectURL(blob);
          }
        } finally {
          await ctx.close();
        }
      },
      { index, entry: plugin.entry, noteBpm },
    )) as TimingAnalysis;
    const strict = (bpm: number) =>
      Math.abs(bpm / track.referenceBpm - 1) <= 0.04;
    const duration = analysis.durationSeconds,
      proposed = analysis.proposal?.bpm ?? noteBpm;
    const reference = track.beatTimes
      .filter((t) => t >= 2 && t < duration - 0.2)
      .map((time, i) => ({
        id: `truth-${i}`,
        start: time,
        duration: 0.001,
        pitch: { midi: 0 },
        score: 1,
        source: "manual" as const,
        velocity: 1,
      }));
    const grid = (bpm: number, phase = 0) =>
      Array.from({ length: Math.ceil((duration * bpm) / 60) }, (_, i) => ({
        id: `grid-${i}`,
        start: phase + (i * 60) / bpm,
        duration: 0.001,
        pitch: { midi: 0 },
        score: 1,
        source: "generated" as const,
        velocity: 1,
      })).filter((n) => n.start >= 2 && n.start < duration - 0.2);
    const beatF1 = (bpm: number, phase = 0) =>
      compareNotes(reference, grid(bpm, phase), 0.07).f1;
    const closest = analysis.candidates.reduce(
      (best, c) =>
        !best ||
        Math.abs(c.bpm / track.referenceBpm - 1) <
          Math.abs(best.bpm / track.referenceBpm - 1)
          ? c
          : best,
      analysis.candidates[0],
    );
    const record = {
      id: track.id,
      sha256: track.sha256,
      referenceBpm: track.referenceBpm,
      baseline: {
        bpm: noteBpm,
        strict: strict(noteBpm),
        best5Strict: old.some((c) => strict(c.bpm)),
        nominalGridF1: beatF1(noteBpm),
      },
      waveform: {
        primaryBpm: analysis.candidates[0]?.bpm ?? null,
        primaryStrict:
          analysis.candidates.length > 0 && strict(analysis.candidates[0].bpm),
        best5Strict: analysis.candidates.some((c) => strict(c.bpm)),
        closestPhaseError:
          closest && strict(closest.bpm)
            ? Math.min(
                closest.phaseSeconds,
                60 / closest.bpm - closest.phaseSeconds,
              )
            : null,
      },
      proposal: {
        bpm: proposed,
        source: analysis.proposal?.source ?? "note-fallback",
        strict: strict(proposed),
        nominalGridF1: beatF1(proposed),
      },
      analysis,
    };
    records.push(record);
    console.log(
      JSON.stringify({
        id: track.id,
        referenceBpm: track.referenceBpm,
        baseline: noteBpm,
        wave: record.waveform.primaryBpm,
        proposal: proposed,
        waveBest5: record.waveform.best5Strict,
      }),
    );
  }
  const count = (predicate: (r: (typeof records)[number]) => boolean) =>
    records.filter(predicate).length;
  const regressions = records
    .filter((r) => r.baseline.strict && !r.proposal.strict)
    .map((r) => r.id);
  const errorRegressions = records
    .filter(
      (r) =>
        Math.abs(r.proposal.bpm / r.referenceBpm - 1) >
        Math.abs(r.baseline.bpm / r.referenceBpm - 1) + 0.03,
    )
    .map((r) => r.id);
  const report = {
    version: 1,
    source: manifest.source,
    task: manifest.task,
    manifestSha256: createHash("sha256").update(bytes).digest("hex"),
    noteCacheSha256: createHash("sha256").update(cacheBytes).digest("hex"),
    pluginSha256: plugin.sha256,
    criteria: {
      tempoRelativeTolerance: 0.04,
      nominalBeatToleranceSeconds: 0.07,
      defaultPromotion:
        "No previously correct primary may regress, primary count must not decrease, no per-track relative-tempo error increase above 0.03; phase never automatically applied",
      gateReview:
        "Continuous-error gate added after reviewing the inadequacy of correctness counts alone; no retuning on these held-out tracks",
    },
    summary: {
      tracks: records.length,
      baselineStrict: count((r) => r.baseline.strict),
      baselineBest5Strict: count((r) => r.baseline.best5Strict),
      waveformPrimaryStrict: count((r) => r.waveform.primaryStrict),
      waveformBest5Strict: count((r) => r.waveform.best5Strict),
      proposalStrict: count((r) => r.proposal.strict),
      regressions,
      errorRegressions,
      defaultPromotion:
        regressions.length === 0 &&
        errorRegressions.length === 0 &&
        count((r) => r.proposal.strict) >= count((r) => r.baseline.strict),
    },
    records,
    limitations: [
      "Official beats are nominal click positions, not independent expressive downbeat annotations",
      "Half/double tempo and offbeat phases remain ambiguous",
      "A BPM improvement does not prove beat-grid or note-recognition accuracy",
    ],
  };
  await mkdir("artifacts/quality", { recursive: true });
  await writeFile(
    `artifacts/quality/timing-${process.env.STRINGCRAFT_TIMING_LABEL ?? "development"}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report.summary));
});

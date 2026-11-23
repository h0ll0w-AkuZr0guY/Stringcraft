import { test, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import type { NoteEvent } from "../../packages/contracts";
import { compareNotes } from "../../packages/music/evaluation";
test("measure real licensed GuitarSet recordings against published note annotations", async ({
  page,
}) => {
  test.skip(
    !process.env.STRINGCRAFT_REFERENCE_AUDIO,
    "Opt-in real reference corpus; never downloaded by ordinary CI",
  );
  test.setTimeout(600000);
  const manifest = JSON.parse(
    await readFile(process.env.STRINGCRAFT_REFERENCE_AUDIO!, "utf8"),
  ) as {
    source: string;
    validation: string;
    tracks: { id: string; path: string; sha256: string; notes: NoteEvent[] }[];
  };
  const outsideUploads: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && !r.url().startsWith("http://127.0.0.1:"))
      outsideUploads.push(new URL(r.url()).origin);
  });
  await page.goto("./?view=guitar");
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
  const records = [];
  const cached = [];
  for (const reference of manifest.tracks) {
    await page.getByTestId("audio-input").setInputFiles(reference.path);
    await page
      .getByRole("button", { name: "分析音乐片段", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("候选音", {
      timeout: 120000,
    });
    const wait = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出项目", exact: true }).click();
    const p = JSON.parse(
      await readFile((await (await wait).path())!, "utf8"),
    ) as { duration: number; notes: NoteEvent[] };
    const truth = reference.notes
      .filter((n) => n.start < p.duration)
      .map((n) => ({
        ...n,
        duration: Math.min(n.duration, p.duration - n.start),
      }));
    const fifty = compareNotes(truth, p.notes, 0.05),
      hundred = compareNotes(truth, p.notes, 0.1);
    cached.push({
      id: reference.id,
      sha256: reference.sha256,
      duration: p.duration,
      reference: truth,
      detected: p.notes,
    });
    records.push({
      id: reference.id,
      sha256: reference.sha256,
      duration: p.duration,
      at50ms: { ...fifty, pairs: undefined },
      at100msDiagnostic: { ...hundred, pairs: undefined },
    });
    console.log(
      JSON.stringify({
        id: reference.id,
        reference: truth.length,
        prediction: p.notes.length,
        f1: fifty.f1,
        durationMae: fifty.durationMae,
      }),
    );
  }
  expect(outsideUploads).toEqual([]);
  expect(records.length).toBe(manifest.tracks.length);
  const sorted = records.map((r) => r.at50ms.f1).sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  const report = {
    version: 1,
    source: manifest.source,
    validation: manifest.validation,
    task: "real polyphonic note transcription, not lead melody extraction",
    primaryMetric: "one-to-one MIDI pitch and onset F1 at 50 ms",
    medianF1:
      sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2,
    externalUploads: outsideUploads.length,
    records,
  };
  await mkdir("artifacts/quality", { recursive: true });
  const label = process.env.STRINGCRAFT_REFERENCE_LABEL ?? "heldout";
  await writeFile(
    `artifacts/quality/reference-audio-${label}.json`,
    JSON.stringify(report, null, 2),
  );
  await writeFile(
    `artifacts/quality/reference-predictions-${label}.json`,
    JSON.stringify({ version: 1, source: manifest.source, records: cached }),
  );
});

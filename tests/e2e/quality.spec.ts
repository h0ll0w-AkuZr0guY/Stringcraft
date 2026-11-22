import { test, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
type Reference = {
  id: string;
  kind: string;
  notes: { start: number; midi: number }[];
};
function match(
  truth: { start: number; midi: number }[],
  detected: { start: number; pitch: { midi: number } }[],
  tolerance: number,
) {
  const used = new Set<number>();
  let tp = 0;
  for (const n of truth) {
    const candidates = detected
      .map((d, i) => ({
        i,
        distance: Math.abs(d.start - n.start),
        midi: d.pitch.midi,
      }))
      .filter(
        (d) => !used.has(d.i) && d.midi === n.midi && d.distance <= tolerance,
      )
      .sort((a, b) => a.distance - b.distance);
    if (candidates.length) {
      tp++;
      used.add(candidates[0].i);
    }
  }
  const precision = detected.length
      ? tp / detected.length
      : truth.length
        ? 0
        : 1,
    recall = truth.length ? tp / truth.length : detected.length ? 0 : 1;
  return {
    precision,
    recall,
    f1:
      precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    tp,
    reference: truth.length,
    detected: detected.length,
  };
}
test("measure real browser model on all explicitly synthetic fixtures", async ({
  page,
}) => {
  test.skip(
    process.env.STRINGCRAFT_QUALITY !== "1",
    "Run npm run quality for the full model benchmark",
  );
  test.setTimeout(180000);
  const truth: Reference[] = JSON.parse(
      await readFile("tests/fixtures/audio/truth.json", "utf-8"),
    ),
    results = [];
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
  for (const fixture of truth) {
    await page
      .getByTestId("audio-input")
      .setInputFiles(`tests/fixtures/audio/${fixture.id}.wav`);
    await page
      .getByRole("button", { name: "分析音乐片段", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      /候选音|没有检测到可靠音符/,
      { timeout: 30000 },
    );
    const wait = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出项目", exact: true }).click();
    const d = await wait,
      p = JSON.parse(await readFile((await d.path())!, "utf-8"));
    results.push({
      id: fixture.id,
      kind: fixture.kind,
      detection50ms: match(fixture.notes, p.notes, 0.05),
      melody50ms: match(fixture.notes, p.melody, 0.05),
      melody100ms: match(fixture.notes, p.melody, 0.1),
      predicted: p.notes,
      melody: p.melody,
    });
  }
  await mkdir("artifacts/quality", { recursive: true });
  await writeFile(
    "artifacts/quality/browser.json",
    JSON.stringify(
      {
        date: new Date().toISOString(),
        source: "Real Basic Pitch WASM inference; synthetic fixtures only",
        results,
      },
      null,
      2,
    ),
  );
  const rows = results.map(
    (r) =>
      `| ${r.id} | ${r.detection50ms.f1.toFixed(3)} | ${r.melody50ms.f1.toFixed(3)} | ${r.melody100ms.f1.toFixed(3)} | ${r.detection50ms.detected} |`,
  );
  await writeFile(
    "artifacts/quality/browser.md",
    `# Synthetic model benchmark\n\nReal browser inference. These are synthetic signals, not real-song accuracy. Silence is scored separately.\n\n| Fixture | Detection F1 50ms | Melody F1 50ms | Melody F1 100ms | Detected notes |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}\n`,
  );
  expect(results).toHaveLength(12);
  expect(results.find((r) => r.id === "silence")!.detection50ms.detected).toBe(
    0,
  );
});

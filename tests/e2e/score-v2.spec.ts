import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("known score preserves independent voices, ties, slurs, rests, meter and tempo", async ({
  page,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
  await page
    .getByTestId("audio-input")
    .setInputFiles("tests/fixtures/phrases/voices-and-legato.musicxml");
  await expect(page.getByRole("status")).toContainText("乐谱已导入");
  async function exportedProject() {
    const wait = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出项目", exact: true }).click();
    return JSON.parse(await readFile((await (await wait).path())!, "utf8"));
  }
  const p = await exportedProject();
  expect(p.schemaVersion).toBe(2);
  expect(p.duration).toBeCloseTo(4);
  expect(p.score.tempo).toEqual([
    { beat: 0, bpm: 120 },
    { beat: 4, bpm: 90 },
  ]);
  expect(p.score.meter).toEqual([
    { beat: 0, numerator: 4, denominator: 4 },
    { beat: 4, numerator: 3, denominator: 4 },
  ]);
  expect(
    p.score.events.filter((e: { tieFrom?: string }) => e.tieFrom),
  ).toHaveLength(1);
  expect(
    p.score.events.filter((e: { slurFrom?: string }) => e.slurFrom),
  ).toHaveLength(1);
  expect(
    p.score.events.filter((e: { midi: number | null }) => e.midi === null),
  ).toHaveLength(1);
  expect(
    p.notes.filter((n: { role: string }) => n.role === "melody"),
  ).toHaveLength(3);
  expect(p.notes[0].duration).toBeCloseTo(1.5);
  await page.getByRole("button", { name: "进阶", exact: true }).click();
  await page.getByLabel("变调夹", { exact: true }).selectOption("0");
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("编配完成");
  const arranged = await exportedProject();
  expect(
    arranged.arrangement.notes.some(
      (n: { attack: string }) => n.attack === "hammer",
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "节奏谱", exact: true }).click();
  await expect(page.locator(".at-surface")).toBeVisible();
  await expect(page.locator(".inline-error")).toHaveCount(0);
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: "MusicXML", exact: true }).click();
  const download = await wait;
  await page
    .getByTestId("audio-input")
    .setInputFiles({
      name: "roundtrip.musicxml",
      mimeType: "application/xml",
      buffer: await readFile((await download.path())!),
    });
  await expect(page.getByRole("status")).toContainText("乐谱已导入");
  const restored = await exportedProject();
  expect(restored.score.tempo).toEqual(p.score.tempo);
  expect(restored.score.meter).toEqual(p.score.meter);
  expect(
    restored.score.events.some((e: { slurFrom?: string }) => e.slurFrom),
  ).toBe(true);
});

test("daily style changes accompaniment pattern and melody mode remains independent", async ({
  page,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("伴奏手法", { exact: true }).selectOption("arpeggio");
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("和弦伴奏");
  await page.getByLabel("显示左右手指法", { exact: false }).check();
  await expect(page.locator(".finger-label").first()).toBeVisible();
  await page.screenshot({
    path: "artifacts/v2-accompaniment.png",
    fullPage: true,
  });
  await page.getByLabel("编配目标", { exact: true }).selectOption("melody");
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("单线练习");
});

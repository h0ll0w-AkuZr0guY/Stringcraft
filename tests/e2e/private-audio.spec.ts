import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
test("opt-in local-only real recording smoke test", async ({ page }) => {
  test.skip(
    !process.env.STRINGCRAFT_PRIVATE_AUDIO,
    "No private recording supplied",
  );
  const outsideUploads: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && !r.url().startsWith("http://127.0.0.1:"))
      outsideUploads.push(new URL(r.url()).origin);
  });
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
  await page
    .getByTestId("audio-input")
    .setInputFiles(process.env.STRINGCRAFT_PRIVATE_AUDIO!);
  await page.getByRole("button", { name: "分析音乐片段", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("候选音", {
    timeout: 90000,
  });
  await page.getByRole("button", { name: "初学", exact: true }).click();
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("编配完成");
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出项目", exact: true }).click();
  const d = await wait,
    p = JSON.parse(await readFile((await d.path())!, "utf8"));
  const audio = page.waitForEvent("download");
  await page.getByRole("button", { name: "WAV", exact: true }).click();
  const wav = await audio;
  await wav.saveAs("artifacts/private-clip-arrangement.wav");
  const stats = {
    duration: p.duration,
    detected: p.notes.length,
    melody: p.melody.length,
    arranged: p.arrangement.notes.length,
    externalUploads: outsideUploads.length,
    timingCandidates: p.timingAnalysis?.candidates,
    retainedBpm: p.bpm,
    quality: "Not annotated; no accuracy claim",
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/private-validation.json",
    JSON.stringify(stats, null, 2),
  );
  await writeFile(
    "artifacts/private-recording-project.json",
    JSON.stringify(p),
  );
  console.log(JSON.stringify(stats));
  expect(outsideUploads).toEqual([]);
  expect(p.arrangement.notes.length).toBeGreaterThan(0);
});

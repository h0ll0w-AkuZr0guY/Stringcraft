import { openSettings } from "./workspace-helpers";
import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { demoProject } from "../../packages/music/demo";
import { projectScore } from "../../packages/music/score";
test.use({ trace: "off", screenshot: "off" });
test("local stems, lazy vocal analysis and portable audio survive reimport", async ({
  page,
}) => {
  test.skip(
    !process.env.STRINGCRAFT_TRACK_JOB,
    "Requires an explicitly supplied local inference result and matching asset store",
  );
  const job = JSON.parse(
      await readFile(process.env.STRINGCRAFT_TRACK_JOB!, "utf8"),
    ),
    result = job.result,
    p = demoProject();
  p.name = "本地分轨试听";
  p.sourceKind = "audio";
  p.duration = result.duration;
  p.notes = result.notes;
  p.melody = [];
  p.tracks = result.tracks;
  p.harmonyAnalysis = result.harmonyAnalysis;
  p.score = projectScore({ ...p, score: undefined });
  p.localAnalysis = {
    jobId: job.id,
    cacheKey: job.cacheKey,
    cacheHit: false,
    executions: result.executions,
    warnings: result.warnings,
  };
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "上传音频 / MIDI", exact: true }),
  ).toBeEnabled();
  await page.getByTestId("whole-audio-input").setInputFiles({
    name: "stems.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await expect(page.locator('[data-track-id="instrumental"]')).toHaveClass(
    /selected/,
  );
  await page.getByRole("button", { name: "播放当前轨道", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停播放", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      parseFloat(await page.getByTestId("transport-position").innerText()),
    )
    .toBeGreaterThan(0.2);
  await page.getByRole("button", { name: "暂停播放", exact: true }).click();
  await page.locator('[data-track-id="vocal"] .track-select').click();
  await page.getByRole("button", { name: "播放当前轨道", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停播放", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "暂停播放", exact: true }).click();
  await openSettings(page, "编配");
  await page
    .getByLabel("编配目标", { exact: true })
    .selectOption("fingerstyle");
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByTestId("generation-result")).toHaveAttribute(
    "data-status",
    "success",
    { timeout: 120000 },
  );
  await page.getByRole("button", { name: "导出", exact: true }).click();
  let pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出项目 JSON", exact: true })
    .click();
  const generated = JSON.parse(
    await readFile((await (await pending).path())!, "utf8"),
  );
  expect(
    generated.tracks.find((t: { role: string }) => t.role === "vocal")
      .analysisRevision,
  ).toMatch(/^[a-f0-9]{64}$/);
  expect(generated.arrangement.sourceTrackIds).toContain("vocal");
  expect(generated.arrangement.notes.length).toBeGreaterThan(0);
  pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出含音频工程", exact: true })
    .click();
  const folder =
    process.env.STRINGCRAFT_TRACK_REPORT ?? "artifacts/local4-native";
  await mkdir(folder, { recursive: true });
  const bundlePath = folder + "/portable.stringcraft.zip";
  await (await pending).saveAs(bundlePath);
  await page.getByTestId("whole-audio-input").setInputFiles(bundlePath);
  await expect(page.getByRole("status")).toContainText("项目已载入");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "播放当前轨道", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  await page
    .getByRole("button", { name: "继续创作", exact: true })
    .first()
    .click();
  await expect(page.locator('[data-track-id="vocal"]')).toBeVisible();
  await writeFile(
    folder + "/fingerstyle-project.json",
    JSON.stringify(generated, null, 2),
  );
  await page.screenshot({ path: folder + "/multitrack.png" });
  expect(errors).toEqual([]);
});

import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
test("real workbench: editing, undo, score, downloads and saved project", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("Workbench browser error:", e.message);
  });
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByTestId("tablature").locator(".tab-note").first(),
  ).toBeVisible();
  await expect(page.getByLabel("编配目标")).toHaveValue("accompaniment");
  await page.getByTestId("tablature").locator(".tab-note rect").first().click();
  await expect(page.getByText("音符编辑", { exact: true })).toBeVisible();
  await page.getByLabel("锁定音符", { exact: true }).click();
  await expect(page.getByLabel("解锁音符", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(page.getByLabel("锁定音符", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await page.getByRole("button", { name: "关闭音符编辑" }).click();
  await page.getByRole("button", { name: "节奏谱", exact: true }).click();
  await expect(page.locator(".at-surface")).toBeVisible();
  await expect(page.locator(".inline-error")).toHaveCount(0);
  await page.getByRole("button", { name: "六线谱", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出项目", exact: true }).click();
  const saved = await download;
  const path = await saved.path();
  const project = JSON.parse(await readFile(path!, "utf-8"));
  expect(project.arrangement.notes[0].locked).toBe(true);
  expect(JSON.stringify(project)).not.toContain("sk-");
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "继续创作" }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续创作" }).first().click();
  await expect(page.getByTestId("tablature")).toBeVisible();
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/workbench.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("plugin lifecycle: disable, refuse execution, enable, uninstall, restore", async ({
  page,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "插件中心", exact: false }).click();
  const card = page.locator(".plugin-card").filter({
    has: page.getByRole("heading", { name: "标准吉他", exact: true }),
  });
  await card.getByRole("button", { name: /已启用/ }).click();
  await expect(
    card.getByRole("button", { name: "启用插件", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "音乐工作台", exact: true }).click();
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("安装并启用");
  await page.getByRole("button", { name: "插件中心", exact: false }).click();
  await card.getByRole("button", { name: "启用插件", exact: true }).click();
  await card.getByRole("button", { name: "卸载", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "安装插件", exact: true }),
  ).toBeVisible();
  await card.getByTitle("恢复上一个版本").click();
  await expect(card.getByRole("button", { name: /已启用/ })).toBeVisible();
});
test("real uploaded audio reaches the model and can be arranged", async ({
  page,
}) => {
  page.on("console", (m) => {
    if (m.type() === "error") console.log("Browser inference:", m.text());
  });
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
  await page
    .getByTestId("audio-input")
    .setInputFiles("tests/fixtures/audio/clean-melody.wav");
  await page.getByLabel("清理弱音候选", { exact: true }).check();
  await page.getByRole("button", { name: "分析音乐片段", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("候选音", {
    timeout: 120000,
  });
  await page.getByLabel("编配目标").selectOption("melody");
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("编配完成");
  const projectDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出项目", exact: true }).click();
  const result = JSON.parse(
    await readFile((await (await projectDownload).path())!, "utf8"),
  );
  expect(result.refinement.profile).toBe("experimental-guitar-clarity");
  expect(result.sourceAudioSha256).toBe(
    createHash("sha256")
      .update(await readFile("tests/fixtures/audio/clean-melody.wav"))
      .digest("hex"),
  );
  expect(result.audioReference).toMatchObject({
    kind: "original",
    sha256: result.sourceAudioSha256,
    offsetSeconds: 0,
  });
  expect(result.refinement.notes.length).toBeLessThanOrEqual(
    result.notes.length,
  );
  expect(
    await page.getByTestId("tablature").locator(".tab-note").count(),
  ).toBeGreaterThan(0);
  expect(result.timingAnalysis.method).toBe("spectral-flux-acf-v1");
  expect(result.timingAnalysis.candidates.length).toBeGreaterThan(0);
  await page.locator(".structure-panel > summary").click();
  await page
    .getByRole("button", { name: /试听 .* BPM 拍点/ })
    .first()
    .click();
  await expect(page.getByRole("status")).toContainText("试听");
  await page.getByRole("button", { name: "停止播放", exact: true }).click();
  await page
    .getByRole("button", { name: /使用 .* BPM 参考速度/ })
    .first()
    .click();
  const afterWait = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出项目", exact: true }).click();
  const after = JSON.parse(
    await readFile((await (await afterWait).path())!, "utf8"),
  );
  expect(after.notes).toEqual(result.notes);
  expect(after.bpm).toBeCloseTo(result.timingAnalysis.candidates[0].bpm, 6);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "MIDI", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.mid$/);
});
test("mobile layout stays within viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/mobile.png", fullPage: true });
});

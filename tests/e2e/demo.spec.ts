import { test, expect } from "@playwright/test";
test.use({
  video:
    process.env.STRINGCRAFT_DEMO === "1"
      ? { mode: "on", size: { width: 1440, height: 1050 } }
      : "off",
});
test("record the actual preview workflow without a prerecorded recognition result", async ({
  page,
}) => {
  test.skip(
    process.env.STRINGCRAFT_DEMO !== "1",
    "Opt-in recording, run with STRINGCRAFT_DEMO=1",
  );
  await page.goto("./?view=guitar");
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
  await page
    .getByTestId("audio-input")
    .setInputFiles("tests/fixtures/audio/clean-melody.wav");
  await page.getByRole("button", { name: "分析音乐片段", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("候选音");
  await page.getByRole("button", { name: "初学", exact: true }).click();
  await page.getByLabel("编配目标",{exact:true}).selectOption("melody");
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("编配完成");
  await page.getByTestId("tablature").locator(".tab-note rect").first().click();
  await page.getByLabel("锁定音符", { exact: true }).click();
  await page.getByRole("button", { name: "关闭音符编辑" }).click();
  await page.getByRole("button", { name: "播放编配", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止播放", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "播放编配", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByTestId("audio-input").setInputFiles("tests/fixtures/phrases/voices-and-legato.musicxml");
  await expect(page.getByRole("status")).toContainText("乐谱已导入");
  await page.getByRole("button",{name:"进阶",exact:true}).click();
  await page.getByLabel("变调夹",{exact:true}).selectOption("0");
  await page.getByRole("button",{name:"生成吉他编配",exact:true}).click();
  await expect(page.getByRole("status")).toContainText("编配完成");
  await page.getByRole("button", { name: "节奏谱", exact: true }).click();
  await expect(page.locator(".at-surface")).toBeVisible();
  await page.getByRole("button", { name: "插件中心", exact: false }).click();
  await expect(
    page.getByRole("heading", { name: "Basic Pitch", exact: true }),
  ).toBeVisible();
});

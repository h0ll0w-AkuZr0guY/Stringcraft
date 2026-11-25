import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("piano produces a grand staff and exports notes and ties", async ({
  page,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "上传音频 / MIDI", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("乐器", { exact: true }).selectOption("piano");
  await page
    .getByLabel("上传钢琴素材")
    .setInputFiles("tests/fixtures/phrases/piano-two-hands.musicxml");
  await expect(page.getByRole("status")).toContainText("乐谱已导入");
  await page.getByRole("button", { name: "生成钢琴双手谱" }).click();
  await expect(page.getByRole("status")).toContainText("钢琴谱已生成");
  await expect(
    page.getByLabel("钢琴大谱表").locator(".at-surface"),
  ).toBeVisible();
  await expect(page.locator(".inline-error")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "钢琴 MusicXML", exact: true })
    .click();
  const xml = await readFile((await (await download).path())!, "utf8");
  expect(xml).toContain("<staves>2</staves>");
  expect(xml).toContain('<clef number="2"><sign>F</sign>');
  expect(xml).toContain('<tie type="stop"/>');
  const midi = page.waitForEvent("download");
  await page.getByRole("button", { name: "钢琴 MIDI", exact: true }).click();
  expect(
    (await readFile((await (await midi).path())!)).subarray(0, 4).toString(),
  ).toBe("MThd");
});

test("global text size persists and saved work uses editable compact cards", async ({
  page,
}) => {
  await page.goto("./?view=guitar");
  await page.getByRole("button", { name: "全局设置", exact: true }).click();
  await page.getByLabel("界面文字").selectOption("largest");
  await page.getByRole("button", { name: "完成设置" }).click();
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.documentElement.style.getPropertyValue("--ui-scale"),
      ),
    )
    .toBe("1.3");
  await page.getByRole("button", { name: "全局设置", exact: true }).click();
  await page.getByLabel("界面文字").selectOption("standard");
  await page.getByRole("button", { name: "完成设置" }).click();
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByTestId("generation-result")).toHaveAttribute(
    "data-status",
    "success",
  );
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  await page.getByRole("button", { name: "编辑卡片" }).click();
  await page.getByLabel("作品名称").fill("新的练习曲");
  await page.getByLabel("标签").fill("练习，指弹");
  await page.getByLabel("置顶").check();
  await page.getByLabel("配色").selectOption("blue");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const card = page.locator(".project-card");
  await expect(card).toHaveAttribute("data-color", "blue");
  await expect(card).toContainText("新的练习曲");
  await expect(card).toContainText("练习");
  expect((await card.boundingBox())!.width).toBeLessThan(320);
  await page.getByRole("button", { name: "继续创作" }).click();
  await expect(page.locator(".workspace-title")).toContainText("新的练习曲");
});

test("original piano and guitar demos play from the mapped keys", async ({
  page,
}) => {
  await page.goto("./");
  await page.getByRole("button", { name: /键盘练习|键盘试玩/ }).click();
  const studio = page.getByRole("application", { name: "键盘练习区" });
  await page.getByRole("button", { name: "自由弹奏", exact: true }).click();
  await page.getByRole("button", { name: "开始弹奏", exact: true }).click();
  await page.keyboard.down("j");
  await expect(
    page.getByRole("button", { name: "C4 J", exact: true }),
  ).toHaveAttribute("data-active", "true");
  await page.keyboard.down("a");
  await expect(
    page.getByRole("button", { name: "C3 A", exact: true }),
  ).toHaveAttribute("data-active", "true");
  await page.keyboard.up("a");
  await page.keyboard.up("j");
  await expect(
    page.getByRole("button", { name: "C4 J", exact: true }),
  ).toHaveAttribute("data-active", "false");
  await page.getByRole("button", { name: "吉他", exact: true }).click();
  await page.getByRole("button", { name: "开始跟练", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停", exact: true }),
  ).toBeVisible();
  await expect(studio.getByLabel("当前和弦弦位")).toContainText("空弦");
  await page.getByRole("button", { name: "暂停", exact: true }).click();
});

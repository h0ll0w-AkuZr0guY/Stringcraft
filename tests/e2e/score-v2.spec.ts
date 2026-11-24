import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { demoProject } from "../../packages/music/demo";
import {
  closeSettings,
  exportProject,
  openSettings,
  setting,
  settingButton,
} from "./workspace-helpers";
test("early project import is not overwritten by asynchronous plugin bootstrap", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/plugins/catalog.json", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  await page.goto("./?view=guitar");
  const p = demoProject();
  p.name = "启动时导入的无和弦乐谱";
  p.sourceKind = "musicxml";
  p.score!.chords = [];
  await page.locator('input[accept=".json"]').setInputFiles({
    name: "early.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await expect(page.locator(".workspace-title strong")).toHaveText(p.name);
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".workspace-title strong")).toHaveText(p.name);
  expect(errors).toEqual([]);
});
test("written guitar octave, string positions and unpitched attacks survive arrangement and XML roundtrip", async ({
  page,
}) => {
  await page.context().addInitScript(() => {
    window.print = () => {};
  });
  await page.goto("./?view=guitar");
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
  await page
    .getByTestId("whole-audio-input")
    .setInputFiles("tests/fixtures/phrases/guitar-written.musicxml");
  await expect(page.getByRole("status")).toContainText("乐谱已导入");
  const project = async () => {
    const wait = page.waitForEvent("download");
    await exportProject(page);
    return JSON.parse(await readFile((await (await wait).path())!, "utf8"));
  };
  const imported = await project();
  expect(
    imported.notes.map((n: { pitch: { midi: number } }) => n.pitch.midi).sort(),
  ).toEqual([40, 40, 64, 64, 67]);
  expect(
    imported.score.events.filter((e: { unpitched?: boolean }) => e.unpitched),
  ).toHaveLength(1);
  await (await settingButton(page, "进阶")).click();
  await openSettings(page);
  await page.locator(".generation-advanced-controls > summary").click();
  await (await setting(page, "变调夹")).selectOption("0");
  await closeSettings(page);
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("编配完成");
  const arranged = await project();
  expect(arranged.arrangement.notes).toHaveLength(6);
  expect(
    arranged.arrangement.notes.filter((n: { dead?: boolean }) => n.dead),
  ).toHaveLength(1);
  expect(
    arranged.arrangement.notes
      .filter((n: { attack?: string }) =>
        ["hammer", "pull"].includes(n.attack ?? ""),
      )
      .map((n: { attack: string }) => n.attack),
  ).toEqual(["hammer", "pull"]);
  expect(
    arranged.arrangement.notes
      .filter((n: { role: string }) => n.role === "melody")
      .every((n: { string: number }) => n.string === 1),
  ).toBe(true);
  await page
    .getByRole("button", { name: "G4 1弦3品 1.00秒", exact: true })
    .click();
  await page.getByLabel("编辑演奏动作", { exact: true }).selectOption("pluck");
  const edited = await project();
  const changed = edited.arrangement.notes.find(
    (n: { id: string }) =>
      n.id ===
      arranged.arrangement.notes.find(
        (n: { attack: string }) => n.attack === "hammer",
      ).id,
  );
  expect(changed.attack).toBe("pluck");
  expect(changed.linkFrom).toBeUndefined();
  expect(changed.locked).toBe(true);
  await page.getByLabel("编辑演奏动作", { exact: true }).selectOption("hammer");
  await expect(page.locator(".legato-link")).toHaveCount(2);
  await page.getByRole("button", { name: "节奏谱", exact: true }).click();
  await expect(page.locator(".at-surface")).toBeVisible();
  await expect(page.locator(".inline-error")).toHaveCount(0);
  const print = page.getByRole("button", {
    name: "打印节奏谱 PDF",
    exact: true,
  });
  await expect(print).toBeEnabled();
  const next = page.waitForEvent("popup");
  await print.click();
  const popup = await next;
  await expect(popup.locator(".at-surface")).toBeVisible();
  expect(
    (await popup.locator(".at-surface").boundingBox())!.width,
  ).toBeLessThanOrEqual(690);
  expect((await popup.pdf({ format: "A4" })).subarray(0, 4).toString()).toBe(
    "%PDF",
  );
  await popup.close();
  const wait = page.waitForEvent("download");
  await page.getByRole("button", { name: "MusicXML", exact: true }).click();
  await page.getByTestId("whole-audio-input").setInputFiles({
    name: "restored.musicxml",
    mimeType: "application/xml",
    buffer: await readFile((await (await wait).path())!),
  });
  await expect(page.getByRole("status")).toContainText("乐谱已导入");
  const restored = await project();
  expect(
    restored.notes.map((n: { pitch: { midi: number } }) => n.pitch.midi).sort(),
  ).toEqual(
    imported.notes.map((n: { pitch: { midi: number } }) => n.pitch.midi).sort(),
  );
  const dead = restored.score.events.find(
    (e: { unpitched?: boolean }) => e.unpitched,
  );
  expect(dead.midi).toBeNull();
  expect(dead.extensions.guitar.string).toBe(6);
});
test("known score preserves independent voices, ties, slurs, rests, meter and tempo", async ({
  page,
}) => {
  await page.goto("./?view=guitar");
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
  await page
    .getByTestId("whole-audio-input")
    .setInputFiles("tests/fixtures/phrases/voices-and-legato.musicxml");
  await expect(page.getByRole("status")).toContainText("乐谱已导入");
  async function exportedProject() {
    const wait = page.waitForEvent("download");
    await exportProject(page);
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
  await (await settingButton(page, "进阶")).click();
  await openSettings(page);
  await page.locator(".generation-advanced-controls > summary").click();
  await (await setting(page, "变调夹")).selectOption("0");
  await closeSettings(page);
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
  await page.getByTestId("whole-audio-input").setInputFiles({
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
  await page.goto("./?view=guitar");
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
  await (await setting(page, "伴奏手法")).selectOption("arpeggio");
  await closeSettings(page);
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("和弦伴奏");
  await page.getByLabel("显示左右手指法", { exact: false }).check();
  await expect(page.locator(".finger-label").first()).toBeVisible();
  await page.screenshot({
    path: "artifacts/v2-accompaniment.png",
    fullPage: true,
  });
  await (await setting(page, "编配目标")).selectOption("melody");
  await closeSettings(page);
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("单线练习");
});

test("musical editor splits intra-bar harmony, pickup and expressive sections without changing raw notes", async ({
  page,
}) => {
  await page.goto("./?view=guitar");
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "编配与分析设置", exact: true })
    .click();
  await page.locator(".structure-panel > summary").click();
  await page
    .getByRole("button", { name: "小节 1 添加换和弦", exact: true })
    .click();
  await page
    .getByLabel("小节 1 第 3.00 拍 和弦根音", { exact: true })
    .selectOption("7");
  await page
    .getByLabel("小节 1 第 3.00 拍 和弦性质", { exact: true })
    .selectOption("major");
  await page.getByLabel("首个完整小节起点", { exact: true }).fill("0.5");
  await page.getByRole("button", { name: "拆分段落", exact: true }).click();
  await expect(page.locator(".section-row")).toHaveCount(2);
  await page.locator(".section-row select").first().selectOption("gentle");
  const wait = page.waitForEvent("download");
  await exportProject(page);
  const p = JSON.parse(await readFile((await (await wait).path())!, "utf8"));
  expect(
    p.score.chords.find((c: { beat: number }) => c.beat === 0).durationBeats,
  ).toBe(2);
  expect(p.score.chords.find((c: { beat: number }) => c.beat === 2).root).toBe(
    7,
  );
  expect(p.score.pickupBeats).toBeCloseTo(125 / 120);
  expect(p.notes[0].start).toBe(0);
  expect(p.notes[1].start).toBe(0.48);
  expect(p.score.sections[0].energy).toBe("gentle");
});

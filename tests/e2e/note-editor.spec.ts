import { expect, test, type Page } from "@playwright/test";
import midiPackage from "@tonejs/midi";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { demoProject } from "../../packages/music/demo";
const { Midi } = midiPackage;
test("hidden legacy components have an explicit repair path before analysis", async ({
  page,
}) => {
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "上传音频 / MIDI", exact: true }),
  ).toBeEnabled();
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open("keyval-store");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction("keyval", "readwrite"),
          store = tx.objectStore("keyval");
        const get = store.get("plugin:harmony-analysis");
        get.onsuccess = () => {
          const value = get.result;
          value.manifest.sha256 = "legacy";
          value.code = "export default {}";
          store.put(value, "plugin:harmony-analysis");
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "上传音频 / MIDI", exact: true }),
  ).toBeEnabled();
  await page
    .getByTestId("whole-audio-input")
    .setInputFiles("tests/fixtures/audio/clean-melody.wav");
  await expect(page.getByRole("status")).toContainText("工作台组件需要更新");
  await page
    .getByRole("button", { name: "修复工作台组件", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("工作台组件已修复");
  await page
    .getByTestId("whole-audio-input")
    .setInputFiles("tests/fixtures/audio/clean-melody.wav");
  await expect(page.getByRole("status")).toContainText("转录完成", {
    timeout: 120000,
  });
});
async function saved(page: Page) {
  const pending = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "保存项目 JSON", exact: true })
    .click();
  return JSON.parse(await readFile((await (await pending).path())!, "utf8"));
}
async function ready(page: Page) {
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "上传音频 / MIDI", exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId("note-roll")).toHaveAttribute(
    "data-ready",
    "true",
  );
}
test("note editor: audition, gestures, nondestructive edits, exports and guitar handoff", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  const original = await saved(page);
  await page.getByRole("button", { name: "播放当前轨道", exact: true }).click();
  await expect(page.getByRole("button", { name: "暂停播放" })).toBeVisible();
  await page.getByRole("button", { name: "暂停播放" }).click();
  const roll = page.getByTestId("note-roll");
  const position = async (start: number, midi: number, offset = 10) => {
    const b = (await roll.boundingBox())!;
    const values = await roll.evaluate((el) => ({
      from: Number(el.dataset.from),
      high: Number(el.dataset.high),
      scale: Number(el.dataset.scale),
      row: Number(el.dataset.row),
    }));
    return {
      x: b.x + 64 + (start - values.from) * values.scale + offset,
      y: b.y + 80 + (values.high - midi) * values.row + values.row / 2,
    };
  };
  let point = await position(0, 64);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByLabel("编辑音高 MIDI", { exact: true })).toHaveValue(
    "64",
  );
  await roll.press("ArrowUp");
  expect((await saved(page)).notes).toEqual(original.notes);
  await expect(page.getByLabel("编辑音高 MIDI", { exact: true })).toHaveValue(
    "65",
  );
  await page.getByRole("button", { name: "撤销音符编辑" }).click();
  await expect(page.getByLabel("编辑音高 MIDI", { exact: true })).toHaveValue(
    "64",
  );
  point = await position(0, 64);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 35, point.y - 14, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByLabel("编辑起音秒", { exact: true })).toHaveValue(
    "0.5",
  );
  await expect(page.getByLabel("编辑音高 MIDI", { exact: true })).toHaveValue(
    "65",
  );
  point = await position(0.5 + 0.4, 65, -2);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 35, point.y, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByLabel("编辑时长秒", { exact: true })).toHaveValue(
    "0.9",
  );
  await page.getByRole("button", { name: "复制校订音符" }).click();
  await page.getByRole("button", { name: "粘贴校订音符" }).click();
  const edited = await saved(page);
  expect(edited.noteEditor.commands.length).toBeGreaterThanOrEqual(3);
  await page.getByRole("button", { name: "删除校订音符" }).click();
  await page.getByRole("button", { name: "撤销音符编辑" }).click();
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await page.getByLabel("音符强度过滤").fill("1");
  expect((await saved(page)).notes).toEqual(original.notes);
  await page.getByLabel("音符强度过滤").fill("0");
  const midiDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出音符 MIDI", exact: true })
    .click();
  const midi = new Midi(await readFile((await (await midiDownload).path())!));
  expect(midi.tracks.flatMap((t) => t.notes).length).toBe(
    original.notes.length + 1,
  );
  const wavDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出音符 WAV", exact: true }).click();
  expect(
    (await readFile((await (await wavDownload).path())!)).toString(
      "ascii",
      0,
      4,
    ),
  ).toBe("RIFF");
  await page.getByTestId("whole-audio-input").setInputFiles({
    name: "roundtrip.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(edited)),
  });
  expect((await saved(page)).noteEditor).toEqual(edited.noteEditor);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/note-editor.png", fullPage: true });
  await page.getByRole("button", { name: "送往吉他编配", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("whole-file inference produces real notes and provenance without arrangement", async ({
  page,
}) => {
  await ready(page);
  await page
    .getByTestId("whole-audio-input")
    .setInputFiles("tests/fixtures/audio/clean-melody.wav");
  await expect(page.getByRole("status")).toContainText("转录完成", {
    timeout: 120000,
  });
  const p = await saved(page);
  expect(p.transcription.status).toBe("complete");
  expect(p.transcription.processedSeconds).toBeCloseTo(p.duration, 2);
  expect(p.transcription.modelSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(p.notes.length).toBeGreaterThan(5);
  expect(p.melody).toHaveLength(0);
  expect(p.arrangement).toBeNull();
  expect(
    p.notes.every((n: { source: string }) => n.source === "detected"),
  ).toBe(true);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({
    path: "artifacts/note-inference.png",
    fullPage: true,
  });
});
test("ten thousand notes stay virtualized and mobile stays within viewport", async ({
  page,
}) => {
  await ready(page);
  const p = {
    ...demoProject(),
    duration: 300,
    melody: [],
    arrangement: null,
    sourceKind: "midi",
    notes: Array.from({ length: 10000 }, (_, i) => ({
      id: `load-${i}`,
      start: i * 0.029,
      duration: 0.1,
      pitch: { midi: 36 + (i % 60) },
      velocity: 0.7,
      score: 0.8,
      source: "detected",
    })),
  };
  const start = Date.now();
  await page.getByTestId("whole-audio-input").setInputFiles({
    name: "ten-thousand.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await expect(page.locator(".note-meta")).toContainText("原始 10000");
  await expect(page.getByTestId("note-roll")).toHaveAttribute(
    "data-ready",
    "true",
  );
  const importMs = Date.now() - start;
  expect(importMs).toBeLessThan(5000);
  expect(
    Number(await page.getByTestId("note-roll").getAttribute("data-visible")),
  ).toBeLessThan(1000);
  const scrollMs = await page.evaluate(async () => {
    const el = document.querySelector(".roll-scroll")!;
    const start = performance.now();
    for (let i = 0; i < 20; i++) {
      el.scrollLeft = i * 750;
      await new Promise(requestAnimationFrame);
    }
    return performance.now() - start;
  });
  expect(scrollMs).toBeLessThan(2500);
  await writeFile(
    "artifacts/note-performance.json",
    JSON.stringify(
      { notes: 10000, importMs, twentyScrollFramesMs: scrollMs },
      null,
      2,
    ),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("cancel retains partial notes and corrections; replacing a task cannot overwrite the new project", async ({
  page,
}) => {
  await ready(page);
  const rate = 22050,
    seconds = 120,
    data = Buffer.alloc(44 + rate * seconds * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(data.length - 44, 40);
  for (let i = 0; i < rate * seconds; i++)
    data.writeInt16LE(
      Math.round(Math.sin((i / rate) * Math.PI * 440 * 2) * 9000),
      44 + i * 2,
    );
  const upload = () =>
    page.getByTestId("whole-audio-input").setInputFiles({
      name: "long-synthetic.wav",
      mimeType: "audio/wav",
      buffer: data,
    });
  await upload();
  await expect
    .poll(async () =>
      Number(
        await page
          .locator(".workspace-feedback progress")
          .getAttribute("value"),
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "属性", exact: true }).click();
  await page.getByRole("button", { name: "添加校订音符" }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".note-progress")).toHaveCount(0);
  const partial = await saved(page);
  expect(partial.transcription.status).toBe("stopped");
  expect(partial.notes.length).toBeGreaterThan(0);
  expect(partial.transcription.processedSeconds).toBeLessThan(seconds);
  expect(partial.noteEditor.commands).toHaveLength(1);
  await upload();
  await expect
    .poll(async () =>
      Number(
        await page
          .locator(".workspace-feedback progress")
          .getAttribute("value"),
      ),
    )
    .toBeGreaterThan(0);
  await page
    .getByTestId("whole-audio-input")
    .setInputFiles("tests/fixtures/audio/clean-melody.wav");
  await expect(page.getByRole("status")).toContainText("转录完成", {
    timeout: 120000,
  });
  const replacement = await saved(page);
  expect(replacement.name).toBe("clean-melody");
  expect(replacement.transcription.status).toBe("complete");
  expect(replacement.duration).toBeLessThan(20);
});

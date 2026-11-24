import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { demoProject } from "../../packages/music/demo";
import { closeSettings, exportProject, setting } from "./workspace-helpers";
async function start(page: Page) {
  await page.goto("./?view=guitar");
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
}
test("whole-score WAV reuses decoded sample buffers instead of decoding each attack", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const decode = BaseAudioContext.prototype.decodeAudioData;
    (window as any).__sampleDecodeCount = 0;
    BaseAudioContext.prototype.decodeAudioData = function (
      ...args: Parameters<typeof decode>
    ) {
      (window as any).__sampleDecodeCount++;
      return decode.apply(this, args);
    };
  });
  await start(page);
  const p = demoProject();
  p.schemaVersion = 1;
  delete p.score;
  p.duration = 300;
  const notes = Array.from({ length: 1200 }, (_, i) => ({
    id: `sample-${i}`,
    start: i * 0.25,
    duration: 0.2,
    pitch: { midi: 40 },
    score: 1,
    velocity: 0.6,
    source: "generated" as const,
    string: 6,
    fret: 0,
  }));
  p.notes = notes;
  p.melody = notes;
  p.arrangement = {
    id: "sample-reuse",
    instrumentId: "guitar",
    difficulty: "normal",
    capo: 0,
    transpose: 0,
    notes,
    dropped: [],
    warnings: [],
  };
  await page.getByTestId("project-import").setInputFiles({
    name: "sample-reuse.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "WAV", exact: true }).click();
  const data = await readFile((await (await pending).path())!);
  expect(data.toString("ascii", 0, 4)).toBe("RIFF");
  expect(data.length).toBeGreaterThan(10_000_000);
  // Two actual velocity layers are blended once and reused across all 1,200 attacks.
  expect(await page.evaluate(() => (window as any).__sampleDecodeCount)).toBe(
    2,
  );
});
async function project(page: Page) {
  const download = page.waitForEvent("download");
  await exportProject(page);
  return JSON.parse(await readFile((await (await download).path())!, "utf8"));
}
async function setPlugin(page: Page, change: "old" | "disabled") {
  await page.evaluate(async (change) => {
    await new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("keyval-store");
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction("keyval", "readwrite"),
          store = tx.objectStore("keyval");
        const get = store.get("plugin:guitar-standard");
        get.onsuccess = () => {
          const p = get.result;
          if (change === "old") {
            p.manifest.version = "0.1.0";
            p.manifest.sha256 = "old";
          } else p.enabled = false;
          store.put(p, "plugin:guitar-standard");
        };
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
  }, change);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
}
async function fakeWorker(
  page: Page,
  mode: "delay" | "hang" | "empty" | "invalid",
) {
  await page.addInitScript((mode) => {
    const Native = window.Worker;
    window.Worker = class extends Native {
      postMessage(data: any, options?: any) {
        if (data.method !== "arrange") {
          super.postMessage(data, options);
          return;
        }
        if (mode === "hang") return;
        if (mode === "delay") {
          setTimeout(() => super.postMessage(data, options), 2500);
          return;
        }
        const bad = {
          id: "fault",
          instrumentId: "guitar",
          difficulty: "normal",
          capo: 0,
          transpose: 0,
          notes: [],
          warnings: [],
          dropped: [],
        };
        if (mode === "invalid")
          (bad.notes as unknown[]) = [
            { id: "bad", pitch: { midi: 200 }, duration: -1 },
          ];
        setTimeout(
          () =>
            this.dispatchEvent(
              new MessageEvent("message", { data: { result: bad } }),
            ),
          100,
        );
      }
    };
  }, mode);
}
test("simple mode gives immediate visible feedback, prevents duplicate generation and locates the result", async ({
  page,
}) => {
  await fakeWorker(page, "delay");
  await start(page);
  await expect(page.locator(".structure-panel")).toHaveCount(0);
  await expect(await setting(page, "变调夹")).not.toBeVisible();
  await closeSettings(page);
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByTestId("generation-result")).toHaveAttribute(
    "data-status",
    "running",
  );
  await expect(
    page.getByRole("button", { name: "正在生成，请稍候…" }),
  ).toBeDisabled();
  await expect(
    page
      .getByTestId("generation-result")
      .getByRole("button", { name: "取消生成" }),
  ).toBeVisible();
  await expect(page.getByTestId("generation-result")).toHaveAttribute(
    "data-status",
    "success",
  );
  await expect(page.getByTestId("generation-result")).toBeInViewport();
  await page.getByRole("button", { name: "播放结果", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止结果试听" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "停止结果试听" }).click();
  await mkdir("artifacts/local-trial", { recursive: true });
  await page.screenshot({
    path: "artifacts/local-trial/simple-result.png",
    fullPage: true,
  });
  expect((await project(page)).arrangement.notes.length).toBeGreaterThan(0);
});
for (const change of ["old", "disabled"] as const)
  test(`${change} plugin cache is explained and repaired explicitly`, async ({
    page,
  }) => {
    await start(page);
    await setPlugin(page, change);
    const before = await project(page);
    await closeSettings(page);
    await page
      .getByRole("button", { name: "生成吉他编配", exact: true })
      .click();
    await expect(page.getByTestId("generation-result")).toHaveAttribute(
      "data-status",
      "error",
    );
    await expect(page.getByTestId("generation-result")).toContainText(
      change === "old" ? "需要更新" : "已停用",
    );
    expect((await project(page)).arrangement).toEqual(before.arrangement);
    await page
      .getByTestId("generation-result")
      .getByRole("button", { name: "修复所需插件" })
      .click();
    await expect(page.getByRole("status")).toContainText("所需插件已修复");
    await closeSettings(page);
    await page
      .getByRole("button", { name: "生成吉他编配", exact: true })
      .click();
    await expect(page.getByTestId("generation-result")).toHaveAttribute(
      "data-status",
      "success",
    );
  });
for (const mode of ["empty", "invalid"] as const)
  test(`${mode} worker results cannot report success or replace the old score`, async ({
    page,
  }) => {
    await fakeWorker(page, mode);
    await start(page);
    const before = await project(page);
    await closeSettings(page);
    await page
      .getByRole("button", { name: "生成吉他编配", exact: true })
      .click();
    await expect(page.getByTestId("generation-result")).toHaveAttribute(
      "data-status",
      "error",
    );
    await expect(page.getByTestId("generation-result")).toBeInViewport();
    expect((await project(page)).arrangement).toEqual(before.arrangement);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出诊断信息" }).click();
    const diagnostic = JSON.parse(
      await readFile((await (await download).path())!, "utf8"),
    );
    expect(diagnostic.status).toBe("error");
    expect(diagnostic).not.toHaveProperty("notes");
    expect(diagnostic).not.toHaveProperty("key");
  });
test("cancel and overall timeout retain the old score", async ({ page }) => {
  await fakeWorker(page, "hang");
  await start(page);
  const before = await project(page);
  await page.clock.install();
  await closeSettings(page);
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByTestId("generation-result")).toHaveAttribute(
    "data-phase",
    "生成谱面",
  );
  await page
    .getByTestId("generation-result")
    .getByRole("button", { name: "取消生成" })
    .click();
  await expect(page.getByTestId("generation-result")).toHaveAttribute(
    "data-status",
    "cancelled",
  );
  expect((await project(page)).arrangement).toEqual(before.arrangement);
  await closeSettings(page);
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByTestId("generation-result")).toHaveAttribute(
    "data-phase",
    "生成谱面",
  );
  await page.clock.fastForward(121000);
  await expect(page.getByTestId("generation-result")).toHaveAttribute(
    "data-status",
    "error",
  );
  await expect(page.getByTestId("generation-result")).toContainText(
    "超过 120 秒",
  );
  expect((await project(page)).arrangement).toEqual(before.arrangement);
});
test("unknown harmony gives a correction action and keeps the input unchanged", async ({
  page,
}) => {
  await start(page);
  const p = demoProject();
  p.sourceKind = "musicxml";
  p.score!.chords = [];
  p.arrangement = null;
  p.notes = p.notes.slice(0, 1);
  p.melody = p.notes;
  await page.getByTestId("project-import").setInputFiles({
    name: "unknown.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await closeSettings(page);
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByTestId("generation-result")).toContainText(
    "没有找到可用和弦",
  );
  await page
    .getByTestId("generation-result")
    .getByRole("button", { name: "检查和弦与高级设置" })
    .click();
  await expect(page.locator(".structure-panel")).toBeVisible();
  expect((await project(page)).notes).toEqual(p.notes);
});

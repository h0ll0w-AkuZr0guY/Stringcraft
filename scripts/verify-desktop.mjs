/** Verify the actual extracted WebView2 app. Enable CDP only for this test launch. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";

const cdp = process.env.TEST_DESKTOP_CDP;
const evidence = process.env.STRINGCRAFT_DESKTOP_REPORT;
if (!cdp || !evidence)
  throw new Error("Set TEST_DESKTOP_CDP and STRINGCRAFT_DESKTOP_REPORT");
await mkdir(evidence, { recursive: true });
const browser = await chromium.connectOverCDP(cdp);
try {
  const context = browser.contexts()[0];
  const page = context
    .pages()
    .find((p) => p.url() === "http://127.0.0.1:18770/");
  assert(
    page,
    "Start the extracted Windows application before running this check",
  );
  const errors = [];
  const external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route(/^https?:\/\//, async (route) => {
    if (new URL(route.request().url()).origin === "http://127.0.0.1:18770")
      return route.continue();
    external.push(new URL(route.request().url()).hostname);
    return route.abort();
  });
  assert.equal((await fetch(page.url())).status, 403);
  const capabilities = await page.evaluate(() =>
    fetch("/api/v1/capabilities").then((r) => r.json()),
  );
  const button = (name) => page.getByRole("button", { name, exact: true });
  await button("音乐工作台").click();
  await expect(button("上传音频 / MIDI")).toBeEnabled();
  await expect(button("常规模式")).toHaveAttribute("aria-pressed", "true");
  const bundle = process.env.STRINGCRAFT_TRACK_BUNDLE;
  if (bundle) {
    await button("我的作品").click();
    // CDP binds a path on the same Windows host without streaming the entire ZIP.
    const session = await context.newCDPSession(page);
    const { root } = await session.send("DOM.getDocument");
    const { nodeId } = await session.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: '[data-testid="project-import"]',
    });
    await session.send("DOM.setFileInputFiles", {
      nodeId,
      files: [resolve(bundle)],
    });
    await session.detach();
    await expect(page.getByRole("status")).toContainText("项目已载入", {
      timeout: 90000,
    });
    const voice = page.locator('[data-track-id="vocal"] .track-select');
    await expect(voice).toBeVisible();
    await voice.click();
    await button("播放当前轨道").click();
    await expect(button("暂停播放")).toBeVisible();
    await button("暂停播放").click();
    await page.locator('[data-track-id="arrangement"] .track-select').click();
    await page.getByLabel("播放位置").fill("96.3");
    await expect(
      page.locator(".notation-body [data-current-measure]"),
    ).toBeInViewport();
    await button("节奏谱").click();
    await expect(
      page.locator(".rhythm-view [data-current-measure]"),
    ).toBeInViewport();
    await page.screenshot({ path: join(evidence, "whole-score-follow.png") });
  }
  const audio = "tests/fixtures/audio/clean-melody.wav";
  await page.getByTestId("whole-audio-input").setInputFiles(audio);
  await expect(page.getByRole("status")).toContainText("转录完成", {
    timeout: 150000,
  });
  await page.getByLabel("编配目标").selectOption("melody");
  await button("生成吉他编配").click();
  await expect(page.getByTestId("generation-result")).toHaveAttribute(
    "data-status",
    "success",
    { timeout: 120000 },
  );
  await expect(
    page.getByTestId("tablature").locator(".tab-note").first(),
  ).toBeVisible();
  await button("导出").click();
  const downloaded = page.waitForEvent("download");
  await button("编配 WAV").click();
  const wav = await readFile(await (await downloaded).path());
  assert.equal(wav.subarray(0, 4).toString(), "RIFF");
  let energy = 0;
  for (let i = 44; i + 1 < wav.length; i += 2)
    energy += (wav.readInt16LE(i) / 32768) ** 2;
  const rms = Math.sqrt(energy / ((wav.length - 44) / 2));
  assert(rms > 0.001, "The rendered WAV is silent");
  await button("导出").click();
  await page.screenshot({ path: join(evidence, "basic-score.png") });
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  const report = {
    version: capabilities.appVersion,
    build: capabilities.buildSha,
    engine: capabilities.engine.status,
    device: capabilities.engine.device,
    importedPortableProject: !!bundle,
    wavRms: rms,
    pageErrors: errors,
    externalRequests: external,
  };
  await writeFile(
    join(evidence, "desktop-webview.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}

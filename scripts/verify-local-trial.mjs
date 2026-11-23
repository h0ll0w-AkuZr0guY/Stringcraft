/** Verify the extracted local app with remote requests blocked. Private audio is opt-in. */
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:18766/";
const output = "artifacts/local-trial";
await mkdir(output, { recursive: true });
const report = {
  version: "",
  build: "",
  blockedRemoteRequests: [],
  checks: [],
  private: null,
};
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "msedge",
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1050 },
  recordVideo: { dir: `${output}/video`, size: { width: 1600, height: 1050 } },
});
const blockRemote = async (context) =>
  context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(url.hostname))
      return route.continue();
    report.blockedRemoteRequests.push(url.origin);
    return route.abort();
  });
await blockRemote(context);
async function download(page, button, file) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  const result = await pending;
  await result.saveAs(`${output}/${file}`);
  return readFile(`${output}/${file}`);
}
async function ready(page) {
  await page.goto(base);
  await expect(
    page.getByRole("button", { name: "上传音频 / MIDI", exact: true }),
  ).toBeEnabled();
}
try {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  const meta = await (
    await page.request.get(new URL("api/v1/capabilities", base).href)
  ).json();
  expect(meta.appVersion).toBe("0.2.0-local.1");
  report.version = meta.appVersion;
  report.build = meta.buildSha;
  await page.getByRole("button", { name: "用原创音频体验真实识别" }).click();
  await expect(page.getByRole("status")).toContainText("转录完成", {
    timeout: 120000,
  });
  const raw = JSON.parse(
    await download(page, "保存项目 JSON", "synthetic-input.json"),
  );
  expect(raw.notes.length).toBeGreaterThan(5);
  await page.getByRole("button", { name: "送往吉他编配", exact: true }).click();
  await page.getByLabel("编配目标", { exact: true }).selectOption("melody");
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByTestId("generation-result")).toContainText(
    "编配完成",
    { timeout: 120000 },
  );
  await page.getByRole("button", { name: "播放结果", exact: true }).click();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "停止结果试听" }).click();
  const arranged = JSON.parse(
    await download(page, "导出项目", "synthetic-result.json"),
  );
  expect(arranged.notes).toEqual(raw.notes);
  expect(arranged.arrangement.notes.length).toBeGreaterThan(0);
  const wav = await download(page, "WAV", "synthetic-guitar.wav");
  expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  let energy = 0;
  for (let i = 44; i + 1 < wav.length; i += 2)
    energy += (wav.readInt16LE(i) / 32768) ** 2;
  const rms = Math.sqrt(energy / ((wav.length - 44) / 2));
  expect(rms).toBeGreaterThan(0.001);
  await download(page, "MIDI", "synthetic-guitar.mid");
  await expect(page.locator(".save-state")).toContainText("已保存在此浏览器");
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  await page.getByRole("button", { name: "继续创作" }).first().click();
  const reopened = JSON.parse(
    await download(page, "导出项目", "reopened-result.json"),
  );
  expect(reopened.arrangement).toEqual(arranged.arrangement);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: `${output}/packaged-result.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
  report.checks.push({
    name: "offline packaged inference, generation, playback, export, reopen",
    raw: raw.notes.length,
    arranged: arranged.arrangement.notes.length,
    wavRms: rms,
  });
  console.log("PACKAGED BASIC FLOW PASSED");
  await context.close();
  if (process.env.STRINGCRAFT_PRIVATE_AUDIO) {
    const privateContext = await browser.newContext({
      viewport: { width: 1600, height: 1050 },
    });
    await blockRemote(privateContext);
    const page = await privateContext.newPage();
    await ready(page);
    const started = Date.now();
    await page
      .getByTestId("whole-audio-input")
      .setInputFiles(process.env.STRINGCRAFT_PRIVATE_AUDIO);
    await expect(page.getByRole("status")).toContainText("转录完成", {
      timeout: 300000,
    });
    const raw = JSON.parse(
      await download(page, "保存项目 JSON", "private-input.json"),
    );
    await page
      .getByRole("button", { name: "送往吉他编配", exact: true })
      .click();
    await page
      .getByLabel("编配目标", { exact: true })
      .selectOption("accompaniment");
    await page.getByRole("button", { name: "日常", exact: true }).click();
    await page.locator(".generation-advanced-controls > summary").click();
    await page.getByLabel("变调夹", { exact: true }).selectOption("3");
    await page.getByLabel("参考速度 BPM", { exact: true }).fill("68.5");
    await page
      .getByRole("button", { name: "生成吉他编配", exact: true })
      .click();
    await expect(page.getByTestId("generation-result")).toContainText(
      "编配完成",
      { timeout: 120000 },
    );
    const result = JSON.parse(
      await download(page, "导出项目", "private-result.json"),
    );
    expect(result.notes).toEqual(raw.notes);
    expect(result.arrangement.notes.length).toBeGreaterThan(0);
    expect(result.arrangement.capo).toBe(3);
    await page.getByRole("button", { name: "播放结果", exact: true }).click();
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: "停止结果试听" }).click();
    await page.screenshot({
      path: `${output}/private-result.png`,
      fullPage: true,
    });
    report.private = {
      seconds: raw.duration,
      processed: raw.transcription.processedSeconds,
      raw: raw.notes.length,
      arranged: result.arrangement.notes.length,
      bpm: result.bpm,
      capo: result.arrangement.capo,
      elapsedSeconds: (Date.now() - started) / 1000,
    };
    console.log(
      "PRIVATE WHOLE SONG FLOW PASSED",
      JSON.stringify(report.private),
    );
    await privateContext.close();
  }
  expect(report.blockedRemoteRequests).toEqual([]);
  await writeFile(
    `${output}/packaged-verification.json`,
    JSON.stringify(report, null, 2),
  );
} finally {
  await context.close().catch(() => {});
  await browser.close();
}

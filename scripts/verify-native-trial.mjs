/** Actual extracted full-model flow. Private inputs and outputs stay in artifacts. */
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:18767/";
const audio =
  process.env.STRINGCRAFT_NATIVE_AUDIO ??
  "tests/fixtures/audio/melody-with-pad.wav";
const output =
  process.env.STRINGCRAFT_NATIVE_REPORT ?? "artifacts/local2-native-trial";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "msedge",
});
const context = await browser.newContext({
  viewport: { width: 1600, height: 1050 },
});
const remote = [],
  errors = [],
  report = {};
await context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (["127.0.0.1", "localhost"].includes(url.hostname))
    return route.continue();
  remote.push(url.origin);
  return route.abort();
});
await context.addInitScript(() => {
  const original = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    window.__trialMedia = this;
    return original.call(this);
  };
});
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));
async function download(name, filename) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  const file = await pending;
  await file.saveAs(`${output}/${filename}`);
  return readFile(`${output}/${filename}`);
}
const json = async (button, name) => JSON.parse(await download(button, name));
async function generate(bpm) {
  await page.getByLabel("参考速度 BPM", { exact: true }).fill(String(bpm));
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByTestId("generation-result")).toContainText(
    "编配完成",
    { timeout: 120000 },
  );
  return json("导出项目", `guitar-${bpm}.json`);
}
try {
  await page.goto(base);
  await expect(
    page.getByRole("button", { name: "上传音频 / MIDI", exact: true }),
  ).toBeEnabled();
  let capabilities;
  await expect
    .poll(
      async () => {
        capabilities = await (
          await page.request.get(new URL("api/v1/capabilities", base).href)
        ).json();
        return capabilities.engine.status;
      },
      { timeout: 120000 },
    )
    .toBe("ready");
  const version = JSON.parse(await readFile("package.json", "utf8")).version;
  expect(capabilities.appVersion).toBe(version);
  await expect(
    page
      .getByLabel("识别方式", { exact: true })
      .locator('option[value="accompaniment"]'),
  ).toBeEnabled();
  await page
    .getByLabel("识别方式", { exact: true })
    .selectOption("accompaniment");
  await page.getByTestId("whole-audio-input").setInputFiles(audio);
  await expect(page.getByRole("status")).toContainText("本地增强完成", {
    timeout: 600000,
  });
  const raw = await json("保存项目 JSON", "raw-project.json");
  expect(raw.notes.length).toBeGreaterThan(0);
  expect(raw.localAnalysis.executions.map((e) => e.name)).toEqual(
    expect.arrayContaining(["HTDemucs", "Basic Pitch", "BTC chord network"]),
  );
  expect(raw.transcription.pluginSha256).toBe(capabilities.engine.pluginSha256);
  await page.getByRole("button", { name: "试听分离伴奏", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__trialMedia?.currentTime ?? 0))
    .toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "停止分离试听", exact: true }).click();
  await page.getByRole("button", { name: "试听分离低音", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__trialMedia?.currentTime ?? 0))
    .toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "停止分离试听", exact: true }).click();
  await page.getByRole("button", { name: "送往吉他编配", exact: true }).click();
  await page
    .getByLabel("编配目标", { exact: true })
    .selectOption("accompaniment");
  await page.getByRole("button", { name: "日常", exact: true }).click();
  await page.locator(".generation-advanced-controls > summary").click();
  await page.getByLabel("变调夹", { exact: true }).selectOption("0");
  const slow = await generate(68.5),
    fast = await generate(135.7);
  expect(slow.notes).toEqual(raw.notes);
  expect(fast.notes).toEqual(raw.notes);
  expect(slow.harmonyAnalysis).toEqual(raw.harmonyAnalysis);
  expect(fast.harmonyAnalysis).toEqual(raw.harmonyAnalysis);
  expect(slow.arrangement.notes.length).toBeGreaterThan(0);
  expect(fast.arrangement.notes.length).toBeGreaterThan(0);
  const wav = await download("WAV", "guitar.wav");
  expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  let energy = 0;
  for (let i = 44; i + 1 < wav.length; i += 2)
    energy += (wav.readInt16LE(i) / 32768) ** 2;
  const rms = Math.sqrt(energy / ((wav.length - 44) / 2));
  expect(rms).toBeGreaterThan(0.001);
  const midi = await download("MIDI", "guitar.mid");
  expect(midi.toString("ascii", 0, 4)).toBe("MThd");
  await page.getByLabel("和声对照", { exact: true }).selectOption("direct");
  await expect(page.getByRole("status")).toContainText("已切换和声对照");
  const direct = await generate(68.5);
  expect(direct.notes).toEqual(raw.notes);
  expect(direct.harmonyAnalysis.method).toMatch(/original$/);
  await page.getByLabel("和声对照", { exact: true }).selectOption("notes");
  await expect(page.getByRole("status")).toContainText("已切换和声对照");
  const basic = await generate(68.5);
  expect(basic.notes).toEqual(raw.notes);
  expect(basic.harmonyAnalysis.method).toMatch(/^note-seconds/);
  await page.getByLabel("和声对照", { exact: true }).selectOption("separated");
  await expect(page.getByRole("status")).toContainText("已切换和声对照");
  await generate(68.5);
  await page.screenshot({ path: `${output}/guitar.png`, fullPage: true });
  await page.getByRole("button", { name: /插件中心/ }).click();
  await expect(page.locator(".plugin-card")).toHaveCount(5);
  await expect(page.locator(".plugin-card")).not.toContainText([
    "钢琴契约验证包",
  ]);
  await page.screenshot({ path: `${output}/plugins.png`, fullPage: true });
  await page.getByRole("button", { name: "音乐工作台", exact: true }).click();
  await page.getByRole("button", { name: "音符编辑器", exact: true }).click();
  await page.getByTestId("whole-audio-input").setInputFiles(audio);
  await expect(page.getByRole("status")).toContainText("已复用缓存", {
    timeout: 60000,
  });
  const cached = await json("保存项目 JSON", "cached-project.json");
  expect(cached.localAnalysis.cacheHit).toBe(true);
  expect(cached.localAnalysis.jobId).toBe(raw.localAnalysis.jobId);
  expect(cached.notes).toEqual(raw.notes);
  const session = await (
    await page.request.get(new URL("api/v1/session", base).href)
  ).json();
  const headers = { Authorization: `Bearer ${session.token}` };
  const root = new URL("api/v1/", base).href;
  const job = await (
    await page.request.post(root + "jobs", {
      headers,
      multipart: {
        file: {
          name: "local-test.wav",
          mimeType: "audio/wav",
          buffer: await readFile(audio),
        },
        mode: "accompaniment",
        offset: "0",
        seconds: "1",
      },
    })
  ).json();
  expect(job.id).toBeTruthy();
  const cancel = await (
    await page.request.delete(root + "jobs/" + job.id, { headers })
  ).json();
  expect(cancel.status).toBe("cancelled");
  expect(remote).toEqual([]);
  expect(errors).toEqual([]);
  Object.assign(report, {
    version,
    build: capabilities.buildSha,
    engine: capabilities.engine,
    sourceSha256: createHash("sha256")
      .update(await readFile(audio))
      .digest("hex"),
    raw: raw.notes.length,
    harmonyIntervals: raw.harmonyAnalysis.segments.length,
    bpmInvariant: true,
    slowNotes: slow.arrangement.notes.length,
    fastNotes: fast.arrangement.notes.length,
    stemPlayback: true,
    comparisonSwitches: true,
    cacheHit: true,
    cancellation: true,
    pluginCards: 5,
    wavRms: rms,
    blockedRemoteRequests: remote,
  });
  await writeFile(
    `${output}/verification.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await browser.close();
}

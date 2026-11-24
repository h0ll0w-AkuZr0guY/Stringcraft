/** Offline verification of the extracted local.4 workbench. No paid services. */
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:18766/";
const output =
  process.env.STRINGCRAFT_TRIAL_REPORT ?? "artifacts/local4-packaged";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "msedge",
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const report = { checks: [], blockedRemoteRequests: [], errors: [] };
await context.route("**/*", (r) => {
  const u = new URL(r.request().url());
  if (["127.0.0.1", "localhost"].includes(u.hostname)) return r.continue();
  report.blockedRemoteRequests.push(u.origin);
  return r.abort();
});
const page = await context.newPage();
page.on("pageerror", (e) => report.errors.push(e.message));
async function settings() {
  if (
    !(await page
      .getByRole("button", { name: "关闭设置", exact: true })
      .isVisible())
  )
    await page
      .getByRole("button", { name: "编配与分析设置", exact: true })
      .click();
}
async function close() {
  if (
    await page
      .getByRole("button", { name: "关闭设置", exact: true })
      .isVisible()
  )
    await page.getByRole("button", { name: "关闭设置", exact: true }).click();
}
async function download(name, file) {
  await close();
  const event = page.waitForEvent("download", { timeout: 120000 });
  await page.getByRole("button", { name, exact: true }).click();
  await (await event).saveAs(output + "/" + file);
  return readFile(output + "/" + file);
}
try {
  await page.goto(base);
  await expect(
    page.getByRole("button", { name: "上传音频 / MIDI", exact: true }),
  ).toBeEnabled();
  const meta = await (
    await page.request.get(new URL("api/v1/capabilities", base).href)
  ).json();
  expect(meta.appVersion).toBe(
    JSON.parse(await readFile("package.json", "utf8")).version,
  );
  Object.assign(report, { version: meta.appVersion, build: meta.buildSha });
  await settings();
  await page.getByLabel("识别方式", { exact: true }).selectOption("browser");
  await close();
  await page
    .getByTestId("whole-audio-input")
    .setInputFiles("tests/fixtures/audio/clean-melody.wav");
  await expect(page.getByRole("status")).toContainText("转录完成", {
    timeout: 120000,
  });
  const raw = JSON.parse(
    await download("保存项目 JSON", "synthetic-input.json"),
  );
  expect(raw.notes.length).toBeGreaterThan(5);
  report.checks.push("actual bundled WASM inference");
  await settings();
  await page.getByLabel("编配目标", { exact: true }).selectOption("melody");
  await close();
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByTestId("generation-result")).toHaveAttribute(
    "data-status",
    "success",
  );
  await page.getByRole("button", { name: "播放当前轨道", exact: true }).click();
  await expect
    .poll(async () =>
      parseFloat(await page.getByTestId("transport-position").innerText()),
    )
    .toBeGreaterThan(0.2);
  await page.getByRole("button", { name: "暂停播放", exact: true }).click();
  await page.getByLabel("播放位置", { exact: true }).fill("1.2");
  await page.getByRole("button", { name: "播放当前轨道", exact: true }).click();
  await expect
    .poll(async () =>
      parseFloat(await page.getByTestId("transport-position").innerText()),
    )
    .toBeGreaterThan(1.3);
  await page.getByRole("button", { name: "暂停播放", exact: true }).click();
  report.checks.push("shared clock, seek and resume");
  const wav = await download("WAV", "guitar.wav");
  expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
  const energy = await page.evaluate(
    async (bytes) => {
      const c = new AudioContext();
      try {
        const b = await c.decodeAudioData(Uint8Array.from(bytes).buffer),
          a = b.getChannelData(0);
        return Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
      } finally {
        await c.close();
      }
    },
    [...wav],
  );
  expect(energy).toBeGreaterThan(0.0001);
  report.wavRms = energy;
  const midi = await download("MIDI", "guitar.mid");
  expect(midi.toString("ascii", 0, 4)).toBe("MThd");
  const saved = JSON.parse(await download("导出项目", "saved-project.json"));
  expect(saved.notes).toEqual(raw.notes);
  expect(saved.arrangement.notes.length).toBeGreaterThan(0);
  report.checks.push("non-silent sampled WAV, MIDI and project export");
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  await page
    .getByRole("button", { name: "继续创作", exact: true })
    .first()
    .click();
  await expect(page.getByTestId("tablature")).toBeVisible();
  report.checks.push("saved project reopen");
  await page.screenshot({ path: output + "/workspace.png" });
  if (process.env.STRINGCRAFT_PRIVATE_BUNDLE) {
    // Explicit local-only input; no video or tracing is enabled.
    await page
      .getByTestId("whole-audio-input")
      .setInputFiles(process.env.STRINGCRAFT_PRIVATE_BUNDLE);
    await expect(page.getByRole("status")).toContainText("项目已载入", {
      timeout: 120000,
    });
    await settings();
    await page.getByRole("button", { name: "原曲对照", exact: true }).click();
    await close();
    await expect
      .poll(async () =>
        parseFloat(await page.getByTestId("transport-position").innerText()),
      )
      .toBeGreaterThan(0.1);
    await page.getByRole("button", { name: "暂停播放", exact: true }).click();
    await page.getByRole("button", { name: "音符", exact: true }).click();
    await page.locator('[data-track-id="vocal"] .track-select').click();
    await page
      .getByRole("button", { name: "播放当前轨道", exact: true })
      .click();
    await expect
      .poll(async () =>
        parseFloat(await page.getByTestId("transport-position").innerText()),
      )
      .toBeGreaterThan(0.1);
    await page.getByRole("button", { name: "暂停播放", exact: true }).click();
    await page.getByLabel("播放位置", { exact: true }).fill("20");
    await page.locator('[data-track-id="instrumental"] .track-select').click();
    await page
      .getByRole("button", { name: "播放当前轨道", exact: true })
      .click();
    await expect
      .poll(async () =>
        parseFloat(await page.getByTestId("transport-position").innerText()),
      )
      .toBeGreaterThan(20.1);
    await page.getByRole("button", { name: "暂停播放", exact: true }).click();
    report.checks.push(
      "portable project/audio in independent asset store; vocal and instrumental playback",
    );
    await page.screenshot({ path: output + "/private-multitrack.png" });
  }
  expect(report.errors).toEqual([]);
  expect(report.blockedRemoteRequests).toEqual([]);
  await writeFile(
    output + "/packaged-verification.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await context.close();
  await browser.close();
}

/** Verify the actual local.4 separated model workflow; no external audio upload. */
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:18767/";
const audio =
  process.env.STRINGCRAFT_NATIVE_AUDIO ??
  "tests/fixtures/audio/melody-with-pad.wav";
const output =
  process.env.STRINGCRAFT_NATIVE_REPORT ?? "artifacts/local4-native-trial";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  channel: process.env.PLAYWRIGHT_CHANNEL ?? "msedge",
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  remote = [],
  errors = [],
  report = {};
await context.route("**/*", (r) => {
  const u = new URL(r.request().url());
  if (["127.0.0.1", "localhost"].includes(u.hostname)) return r.continue();
  remote.push(u.origin);
  return r.abort();
});
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
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
async function saved(file) {
  await close();
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出项目 JSON", exact: true })
    .click();
  await (await event).saveAs(output + "/" + file);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  return JSON.parse(await readFile(output + "/" + file, "utf8"));
}
async function generate(bpm) {
  await settings();
  const details = page.locator(".generation-advanced-controls");
  if (!(await details.evaluate((e) => e.open)))
    await details.locator("summary").click();
  await page.getByLabel("参考速度 BPM", { exact: true }).fill(String(bpm));
  await close();
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByTestId("generation-result")).toHaveAttribute(
    "data-status",
    "success",
    { timeout: 120000 },
  );
  return saved("guitar-" + bpm + ".json");
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
  expect(capabilities.appVersion).toBe(
    JSON.parse(await readFile("package.json", "utf8")).version,
  );
  await settings();
  await page
    .getByLabel("识别方式", { exact: true })
    .selectOption("accompaniment");
  await close();
  await page.getByTestId("whole-audio-input").setInputFiles(audio);
  await expect(page.getByRole("status")).toContainText("转录完成", {
    timeout: 900000,
  });
  const raw = await saved("raw-project.json");
  expect(raw.tracks).toHaveLength(6);
  expect(raw.notes.length).toBeGreaterThan(0);
  expect(raw.tracks.find((t) => t.role === "vocal").notes).toEqual([]);
  for (const t of raw.tracks) expect(t.asset.sha256).toMatch(/^[a-f0-9]{64}$/);
  await page.locator('[data-track-id="vocal"] .track-select').click();
  await page.getByRole("button", { name: "播放当前轨道", exact: true }).click();
  await expect
    .poll(async () =>
      parseFloat(await page.getByTestId("transport-position").innerText()),
    )
    .toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "暂停播放", exact: true }).click();
  await settings();
  await page
    .getByLabel("编配目标", { exact: true })
    .selectOption(
      raw.harmonyAnalysis.segments.some((s) => s.root !== null)
        ? "accompaniment"
        : "melody",
    );
  await close();
  const slow = await generate(68.5),
    fast = await generate(135.7);
  expect(slow.notes).toEqual(raw.notes);
  expect(fast.notes).toEqual(raw.notes);
  expect(slow.harmonyAnalysis).toEqual(raw.harmonyAnalysis);
  expect(fast.harmonyAnalysis).toEqual(raw.harmonyAnalysis);
  expect(slow.arrangement.notes.length).toBeGreaterThan(0);
  expect(fast.arrangement.notes.length).toBeGreaterThan(0);
  await page.getByTestId("whole-audio-input").setInputFiles(audio);
  await expect(page.getByRole("status")).toContainText("转录完成", {
    timeout: 900000,
  });
  const cached = await saved("cached-project.json");
  expect(cached.localAnalysis.cacheHit).toBe(true);
  expect(cached.localAnalysis.jobId).toBe(raw.localAnalysis.jobId);
  Object.assign(report, {
    version: capabilities.appVersion,
    build: capabilities.buildSha,
    device: capabilities.engine.device,
    duration: raw.duration,
    notes: raw.notes.length,
    tracks: raw.tracks.map((t) => ({ role: t.role, sha256: t.asset.sha256 })),
    slow: slow.arrangement.notes.length,
    fast: fast.arrangement.notes.length,
    cacheHit: cached.localAnalysis.cacheHit,
    remote,
    errors,
  });
  expect(remote).toEqual([]);
  expect(errors).toEqual([]);
  await writeFile(
    output + "/native-verification.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  await context.close();
  await browser.close();
}

/** Actual UI recording using only the original synthetic fixture. No API keys. */
import { chromium } from "@playwright/test";
import { mkdir, copyFile } from "node:fs/promises";
const output = "artifacts/note-demo";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHANNEL
    ? { channel: process.env.PLAYWRIGHT_CHANNEL }
    : {}),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  recordVideo: { dir: output, size: { width: 1440, height: 1050 } },
});
const page = await context.newPage();
try {
  await page.goto(process.env.DEMO_URL ?? "http://127.0.0.1:5174/");
  const upload = page.getByRole("button", {
    name: "上传音频 / MIDI",
    exact: true,
  });
  await upload.waitFor();
  await page.waitForFunction(
    () => !document.querySelector(".note-heading button").disabled,
  );
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "用原创音频体验真实识别" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "转录完成" })
    .waitFor({ timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.locator(".note-inspector summary").click();
  await page
    .getByRole("button", { name: /^选择音符/ })
    .first()
    .click();
  await page.getByRole("button", { name: "试听这个音符", exact: true }).click();
  await page.waitForTimeout(800);
  const pitch = page.getByLabel("编辑音高 MIDI", { exact: true });
  await pitch.fill(String(Number(await pitch.inputValue()) + 1));
  await pitch.press("Tab");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "撤销音符编辑" }).click();
  await page.getByRole("button", { name: "播放音符", exact: true }).click();
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: "暂停音符播放" }).click();
  for (const [button, file] of [
    ["导出音符 MIDI", "notes.mid"],
    ["导出音符 WAV", "notes.wav"],
  ]) {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: button, exact: true }).click();
    await (await download).saveAs(`${output}/${file}`);
  }
  await page.getByRole("button", { name: "适配全曲", exact: true }).click();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: `${output}/editor.png`, fullPage: true });
  await page.waitForTimeout(1500);
} finally {
  const video = page.video();
  await context.close();
  if (video)
    await copyFile(await video.path(), `${output}/actual-workflow.webm`);
  await browser.close();
}
console.log(`Recorded real UI to ${output}/actual-workflow.webm (video only)`);

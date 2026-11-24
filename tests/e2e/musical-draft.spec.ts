import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { demoProject } from "../../packages/music/demo";
import {
  closeSettings,
  exportProject,
  openSettings,
  setting,
} from "./workspace-helpers";

test("generated draft stays separate, voice audition works, and source edits mark it stale", async ({
  page,
}) => {
  await page.goto("./?view=guitar");
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
  const p = demoProject();
  await page.getByTestId("project-import").setInputFiles({
    name: "draft.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await openSettings(page);
  await closeSettings(page);
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByTestId("generation-result")).toContainText("编配完成");
  await page.getByText("编配依据与声部试听", { exact: true }).click();
  await expect(page.getByTestId("musical-draft")).toContainText("种和弦");
  const pending = page.waitForEvent("download");
  await exportProject(page);
  const saved = JSON.parse(
    await readFile((await (await pending).path())!, "utf8"),
  );
  expect(saved.notes).toEqual(p.notes);
  expect(saved.score.events).toEqual(p.score!.events);
  expect(saved.arrangementDraft.inputFingerprint).toContain("music-v1:");
  await page.getByRole("button", { name: "试听伴奏", exact: true }).click();
  await page
    .getByRole("button", { name: "停止分声部试听", exact: true })
    .click();
  await openSettings(page);
  await page.getByText("高级设置：变调、速度与 AI", { exact: true }).click();
  await (await setting(page, "参考速度 BPM")).fill("90");
  await closeSettings(page);
  await expect(
    page.getByText("设置已改变，谱面仍为上次结果。重新生成后应用新设置。"),
  ).toBeVisible();
});

test("chunked WAV preserves the decaying sustain at a render boundary", async ({
  page,
}) => {
  await page.goto("./?view=guitar");
  const { build } = await import("esbuild");
  const code = (
    await build({
      entryPoints: ["packages/music/audio.ts"],
      bundle: true,
      format: "esm",
      platform: "browser",
      write: false,
    })
  ).outputFiles[0].text;
  await page.route("**/audio-boundary-check.mjs", (r) =>
    r.fulfill({ contentType: "text/javascript", body: code }),
  );
  const value = await page.evaluate(async () => {
    const url = "/audio-boundary-check.mjs";
    const { renderWav, schedule } = await import(url);
    const notes = [
      {
        id: "hold",
        start: 15.4,
        duration: 3,
        pitch: { midi: 40 },
        score: 1,
        velocity: 0.6,
        source: "manual",
        string: 6,
        fret: 0,
      },
    ];
    const { data } = await renderWav(notes, 19, "steel");
    const decoder = new AudioContext({ sampleRate: 44100 });
    const decoded = await decoder.decodeAudioData(data);
    await decoder.close();
    const ctx = new OfflineAudioContext(1, Math.ceil(19.3 * 44100), 44100);
    await schedule(ctx, notes, "steel");
    const reference = (await ctx.startRendering()).getChannelData(0),
      actual = decoded.getChannelData(0);
    let error = 0,
      energy = 0;
    for (let i = Math.round(16.05 * 44100); i < Math.round(16.5 * 44100); i++) {
      error += (actual[i] - reference[i]) ** 2;
      energy += reference[i] ** 2;
    }
    return { relative: Math.sqrt(error / energy), energy };
  });
  expect(value.energy).toBeGreaterThan(0.01);
  expect(value.relative).toBeLessThan(0.12);
});

import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { demoProject } from "../../packages/music/demo";
import { projectScore } from "../../packages/music/score";
import { openSettings } from "./workspace-helpers";

async function exercise() {
  const p = demoProject(),
    truth = JSON.parse(
      await readFile("tests/fixtures/audio/truth.json", "utf8"),
    ).find((r: { id: string }) => r.id === "clean-melody");
  p.id = "recording-test";
  p.name = "录音关联练习";
  p.sourceKind = "audio";
  p.duration = truth.duration;
  p.bpm = 92;
  p.sourceAudioSha256 = createHash("sha256")
    .update(await readFile("tests/fixtures/audio/clean-melody.wav"))
    .digest("hex");
  p.notes = truth.notes.map(
    (n: { start: number; duration: number; midi: number }, i: number) => ({
      id: `written-${i}`,
      start: n.start,
      duration: n.duration,
      pitch: { midi: n.midi },
      velocity: 0.7,
      score: 1,
      source: "manual",
      role: "melody",
    }),
  );
  p.melody = p.notes;
  p.score = undefined;
  p.score = projectScore(p);
  p.arrangement = {
    id: "written-arrangement",
    instrumentId: "guitar-standard",
    difficulty: "hard",
    goal: "melody",
    capo: 0,
    transpose: 0,
    notes: p.notes.map((n) => ({
      ...n,
      string: n.pitch.midi >= 64 ? 1 : 2,
      fret: n.pitch.midi - (n.pitch.midi >= 64 ? 64 : 59),
    })),
    warnings: [],
    dropped: [],
    score: p.score,
    performance: {
      instrumentId: "guitar-standard",
      version: 2,
      goal: "melody",
      difficulty: "hard",
      issues: [],
      actions: p.notes.map((n) => ({
        id: n.id,
        sourceIds: [],
        beat: (n.start * p.bpm) / 60,
        durationBeats: (n.duration * p.bpm) / 60,
        string: n.pitch.midi >= 64 ? 1 : 2,
        fret: n.pitch.midi - (n.pitch.midi >= 64 ? 64 : 59),
        kind: "pluck",
        role: "melody",
        velocity: n.velocity,
      })),
    },
  };
  p.arrangement.notes[0].locked = true;
  return p;
}
async function open(page: Page, p: object) {
  await page.goto("./?view=guitar");
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
  await page.getByTestId("project-import").setInputFiles({
    name: "reference.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
  await expect(page.locator(".workspace-title strong")).toContainText(
    "录音关联练习",
  );
}
async function exported(page: Page) {
  const reopen = await page
    .getByRole("button", { name: "关闭设置", exact: true })
    .isVisible();
  if (reopen)
    await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const wait = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出项目 JSON", exact: true })
    .click();
  await page.getByRole("button", { name: "导出", exact: true }).click();
  if (reopen) await openSettings(page, "识别与分轨");
  return JSON.parse(await readFile((await (await wait).path())!, "utf8"));
}

test("rebind original and alternative recordings while preserving the score and locked edits", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = AudioBufferSourceNode.prototype.start;
    (window as unknown as { sourceStarts: number[][] }).sourceStarts = [];
    AudioBufferSourceNode.prototype.start = function (
      ...args: Parameters<AudioBufferSourceNode["start"]>
    ) {
      (window as unknown as { sourceStarts: number[][] }).sourceStarts.push(
        args.map((n) => n ?? 0),
      );
      return original.apply(this, args);
    };
  });
  const p = await exercise();
  await open(page, p);
  await openSettings(page, "识别与分轨");
  await page.getByRole("button", { name: "原曲对照", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("当前浏览器没有");
  await page
    .getByTestId("reference-audio-input")
    .setInputFiles("tests/fixtures/audio/clean-melody.wav");
  await expect(page.getByRole("status")).toContainText("原文件摘要已核验");
  const exact = await exported(page);
  expect(exact.audioReference.kind).toBe("original");
  expect(exact.sourceAudioSha256).toBe(p.sourceAudioSha256);
  expect(exact.notes).toEqual(p.notes);
  expect(exact.score).toEqual(p.score);
  expect(exact.arrangement).toEqual(p.arrangement);
  await page
    .getByTestId("reference-audio-input")
    .setInputFiles("tests/fixtures/audio/ascending.wav");
  await expect(page.getByRole("status")).toContainText("已关联参考录音");
  await expect(
    page.getByRole("button", { name: "参考录音对照", exact: true }),
  ).toBeVisible();
  const comparison = await exported(page);
  expect(comparison.audioReference.kind).toBe("reference");
  expect(comparison.sourceAudioSha256).toBe(p.sourceAudioSha256);
  expect(comparison.notes).toEqual(p.notes);
  expect(comparison.arrangement).toEqual(p.arrangement);
  // Both source files are 4.5 s; use a shorter score so the reference seek can move.
  const short = {
    ...comparison,
    duration: 3,
    notes: comparison.notes.filter(
      (n: { start: number; duration: number }) => n.start + n.duration <= 3,
    ),
    melody: comparison.melody.filter(
      (n: { start: number; duration: number }) => n.start + n.duration <= 3,
    ),
    arrangement: null,
  };
  short.score = {
    ...comparison.score,
    durationBeats: (3 * short.bpm) / 60,
    events: comparison.score.events.filter(
      (e: { beat: number; durationBeats: number }) =>
        e.beat + e.durationBeats <= (3 * short.bpm) / 60,
    ),
    chords: [],
    sections: [],
  };
  await page.getByTestId("project-import").setInputFiles({
    name: "short.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(short)),
  });
  await openSettings(page, "识别与分轨");
  await page.getByLabel("录音对照起点", { exact: true }).fill("0.5");
  await page.getByRole("button", { name: "参考录音对照", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停播放", exact: true }),
  ).toBeVisible();
  const starts = await page.evaluate(
    () => (window as unknown as { sourceStarts: number[][] }).sourceStarts,
  );
  expect(starts.at(-1)![1]).toBe(0.5);
  expect(starts.at(-1)![2]).toBe(3);
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByRole("button", { name: "暂停播放", exact: true }).click();
  const moved = await exported(page);
  expect(moved.sourceOffset).toBe(p.sourceOffset);
  expect(moved.notes).toEqual(short.notes);
  expect(moved.audioReference.offsetSeconds).toBe(0.5);
});

test("invalid recordings and uncovered offsets leave the musical project unchanged", async ({
  page,
}) => {
  const p = await exercise();
  await open(page, p);
  await openSettings(page, "识别与分轨");
  await page.getByTestId("reference-audio-input").setInputFiles({
    name: "invalid.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("invalid audio"),
  });
  await expect(page.getByRole("status")).toContainText("无法解码录音");
  const invalid = await exported(page);
  expect(invalid.audioReference).toBeUndefined();
  expect(invalid.notes).toEqual(p.notes);
  expect(invalid.arrangement).toEqual(p.arrangement);
  await page.getByLabel("录音对照起点", { exact: true }).fill("2");
  await page
    .getByTestId("reference-audio-input")
    .setInputFiles("tests/fixtures/audio/clean-melody.wav");
  await expect(page.getByRole("status")).toContainText("不能覆盖");
  const after = await exported(page);
  expect(after.audioReference).toBeUndefined();
  expect(after.score).toEqual(p.score);
  expect(after.arrangement).toEqual(p.arrangement);
});

async function assetKeys(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open("keyval-store");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("keyval"),
            keys = tx.objectStore("keyval").getAllKeys();
          keys.onsuccess = () => resolve(keys.result.map(String));
          tx.oncomplete = () => db.close();
        };
      }),
  );
}

test("saved references reopen and deleting a project clears only its own recording versions", async ({
  page,
}) => {
  const p = await exercise();
  await open(page, p);
  await openSettings(page, "识别与分轨");
  for (const name of ["clean-melody", "ascending"]) {
    await page
      .getByTestId("reference-audio-input")
      .setInputFiles(`tests/fixtures/audio/${name}.wav`);
    await expect(page.getByRole("status")).toContainText(
      name === "clean-melody" ? "原文件摘要已核验" : "已关联参考录音",
    );
  }
  await expect(page.locator(".workspace-title")).toContainText(
    "已保存在此浏览器",
  );
  await page.reload();
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  await page
    .locator(".project-card")
    .filter({ has: page.getByRole("heading", { name: p.name, exact: true }) })
    .getByRole("button", { name: "继续创作" })
    .click();
  await openSettings(page, "识别与分轨");
  await expect(
    page.getByRole("button", { name: "参考录音对照", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "参考录音对照", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停播放", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await page.getByRole("button", { name: "暂停播放", exact: true }).click();
  const reopened = await exported(page);
  expect(reopened.arrangement).toEqual(p.arrangement);
  const before = await assetKeys(page);
  expect(
    before.filter((k) => k.startsWith("audio-v2:recording-test:")).length,
  ).toBe(2);
  const sibling = `audio-v2:${encodeURIComponent(p.id + ":child")}:${"b".repeat(64)}`;
  await page.evaluate(
    (key) =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open("keyval-store");
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result,
            t = db.transaction("keyval", "readwrite");
          t.objectStore("keyval").put(
            new Blob(["other project's recording"]),
            key,
          );
          t.oncomplete = () => {
            db.close();
            resolve();
          };
        };
      }),
    sibling,
  );
  await page.getByRole("button", { name: "我的作品", exact: true }).click();
  await page
    .getByRole("button", { name: `删除 ${p.name}`, exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "关联录音已从此浏览器删除",
  );
  const after = await assetKeys(page);
  expect(
    after.filter(
      (k) =>
        k.startsWith("audio-v2:recording-test:") || k === `project:${p.id}`,
    ),
  ).toEqual([]);
  expect(after).toContain(sibling);
});

test("upgrading a legacy project copies its recording without replacing the original", async ({
  page,
}) => {
  const p = await exercise();
  p.schemaVersion = 1;
  p.score = undefined;
  await open(page, p);
  await openSettings(page, "识别与分轨");
  await page
    .getByTestId("reference-audio-input")
    .setInputFiles("tests/fixtures/audio/clean-melody.wav");
  await expect(page.getByRole("status")).toContainText("原文件摘要已核验");
  await expect(page.locator(".workspace-title")).toContainText(
    "已保存在此浏览器",
  );

  await openSettings(page, "节拍与和弦");
  await page
    .getByRole("button", { name: "升级为 v2 副本", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已创建 v2 副本");
  const copy = await exported(page);
  expect(copy.schemaVersion).toBe(2);
  expect(copy.migratedFrom).toBe(p.id);
  expect(copy.notes).toEqual(p.notes);
  expect(copy.arrangement).toEqual(p.arrangement);
  const keys = await assetKeys(page);
  expect(keys).toContain(`audio-v2:${p.id}:${p.sourceAudioSha256}`);
  expect(keys).toContain(`audio-v2:${copy.id}:${p.sourceAudioSha256}`);
  expect(keys).toContain(`project:${p.id}`);
});

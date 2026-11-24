import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { demoProject } from "../../packages/music/demo";
import { projectScore } from "../../packages/music/score";

async function ready(page: Page) {
  await page.goto("./");
  await expect(
    page.getByRole("button", { name: "播放当前轨道", exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId("note-roll")).toHaveAttribute(
    "data-ready",
    "true",
  );
}
async function save(page: Page) {
  await page.getByRole("button", { name: "导出", exact: true }).click();
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "导出项目 JSON", exact: true })
    .click();
  const result = JSON.parse(
    await readFile((await (await event).path())!, "utf8"),
  );
  await page.getByRole("button", { name: "导出", exact: true }).click();
  return result;
}
async function load(page: Page, p: unknown) {
  await page.getByTestId("whole-audio-input").setInputFiles({
    name: "tracks.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(p)),
  });
}
async function seek(page: Page, at: number) {
  await page.getByLabel("播放位置", { exact: true }).fill(String(at));
}
async function position(page: Page) {
  return Number(
    (await page.getByTestId("transport-position").innerText()).split(" /")[0],
  );
}

test("shared clock resumes, seeks while playing, follows and yields to manual browsing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  const p = demoProject();
  p.duration = 300;
  p.notes = [
    ...p.notes,
    ...p.notes.map((n) => ({
      ...n,
      id: "later-" + n.id,
      start: n.start + 160,
    })),
  ];
  p.melody = p.notes.filter((n) => n.role === "melody");
  p.score = projectScore({ ...p, score: undefined });
  await load(page, p);
  await page.getByRole("button", { name: "播放当前轨道", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "暂停播放", exact: true }),
  ).toBeVisible();
  await expect.poll(() => position(page)).toBeGreaterThan(0.2);
  await page.getByRole("button", { name: "暂停播放", exact: true }).click();
  const paused = await position(page);
  await page.waitForTimeout(150);
  expect(await position(page)).toBeCloseTo(paused, 1);
  await page.getByRole("button", { name: "播放当前轨道", exact: true }).click();
  await expect.poll(() => position(page)).toBeGreaterThan(paused + 0.2);
  await seek(page, 160);
  await expect.poll(() => position(page)).toBeGreaterThanOrEqual(160);
  const roll = page.getByTestId("note-roll");
  await expect
    .poll(async () => Number(await roll.getAttribute("data-from")))
    .toBeGreaterThan(140);
  const area = page.locator(".roll-scroll");
  await area.hover();
  await page.mouse.wheel(-600, 0);
  await expect(
    page.getByRole("button", { name: "回到播放位置", exact: true }),
  ).toBeVisible();
  const browsed = Number(await roll.getAttribute("data-from"));
  await seek(page, 220);
  await page.waitForTimeout(150);
  expect(Number(await roll.getAttribute("data-from"))).toBeCloseTo(browsed, 1);
  await page.getByRole("button", { name: "回到播放位置", exact: true }).click();
  await expect
    .poll(async () => Number(await roll.getAttribute("data-from")))
    .toBeGreaterThan(200);
  await page.getByRole("button", { name: "静音导入音乐", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "播放当前轨道", exact: true }),
  ).toBeVisible();
  const silent = await position(page);
  await page.waitForTimeout(100);
  expect(await position(page)).toBeCloseTo(silent, 1);
  await page.getByRole("button", { name: "静音导入音乐", exact: true }).click();
  await page.getByRole("button", { name: "回到开头", exact: true }).click();
  expect(await position(page)).toBe(0);
  expect(errors).toEqual([]);
});

test("track edits are independent, click auditions and drag does not seek", async ({
  page,
}) => {
  await ready(page);
  const p = demoProject();
  p.tracks = [
    {
      id: "instrumental",
      name: "伴奏",
      role: "instrumental",
      notes: [p.notes[0]],
    },
    {
      id: "vocal",
      name: "人声",
      role: "vocal",
      notes: [{ ...p.notes[1], id: "v-1", start: 3 }],
    },
  ];
  await load(page, p);
  const roll = page.getByTestId("note-roll");
  const point = async (start: number, midi: number) => {
    const b = (await roll.boundingBox())!;
    const d = await roll.evaluate((e) => ({
      from: +e.dataset.from!,
      high: +e.dataset.high!,
      scale: +e.dataset.scale!,
      row: +e.dataset.row!,
    }));
    return {
      x: b.x + 64 + (start - d.from) * d.scale + 10,
      y: b.y + 80 + (d.high - midi) * d.row + d.row / 2,
    };
  };
  await page.locator('[data-track-id="vocal"] .track-select').click();
  let q = await point(3, 67);
  await page.mouse.click(q.x, q.y);
  await expect(page.getByLabel("编辑音高 MIDI", { exact: true })).toHaveValue(
    "67",
  );
  expect(await position(page)).toBeCloseTo(3, 1);
  await roll.press("ArrowUp");
  await page.locator('[data-track-id="instrumental"] .track-select').click();
  await page.locator('[data-track-id="vocal"] .track-select').click();
  q = await point(3, 68);
  await page.mouse.move(q.x, q.y);
  await page.mouse.down();
  await page.mouse.move(q.x + 35, q.y, { steps: 5 });
  await page.mouse.up();
  expect(await position(page)).toBeCloseTo(3, 1);
  const result = await save(page);
  expect(result.tracks[0]).toEqual(p.tracks[0]);
  expect(result.tracks[1].notes).toEqual(p.tracks[1].notes);
  expect(result.tracks[1].noteEditor.commands.length).toBe(2);
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  await page.getByLabel("音符图层", { exact: true }).selectOption("raw");
  await seek(page, 2);
  q = await point(3, 67);
  await page.mouse.move(q.x, q.y);
  await page.mouse.down();
  await page.mouse.move(q.x + 35, q.y, { steps: 5 });
  await page.mouse.up();
  expect(await position(page)).toBeCloseTo(2, 1);
  await page.mouse.click(q.x, q.y);
  expect(await position(page)).toBeCloseTo(3, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
    )
    .toBe(true);
});

test("guitar and rhythm score hits use the shared position and stay audible", async ({
  page,
}) => {
  await ready(page);
  await page.getByRole("button", { name: "生成吉他编配", exact: true }).click();
  await expect(page.getByTestId("generation-result")).toContainText("编配完成");
  await expect(page.locator('[data-track-id="arrangement"]')).toHaveClass(
    /selected/,
  );
  const tab = page.getByTestId("tablature");
  const note = tab.locator(".tab-note").nth(12);
  const at = Number(
    (await note.getAttribute("aria-label"))!.match(/([\d.]+)秒/)![1],
  );
  await note.click();
  expect(await position(page)).toBeCloseTo(at, 1);
  await page.getByRole("button", { name: "播放当前轨道", exact: true }).click();
  await expect.poll(() => position(page)).toBeGreaterThan(at + 0.15);
  await page.getByRole("button", { name: "暂停播放", exact: true }).click();
  await page.getByRole("button", { name: "节奏谱", exact: true }).click();
  await expect(page.locator(".at-surface")).toBeVisible();
  await expect(page.locator(".inline-error")).toHaveCount(0);
  // Bounds are the same lookup used by alphaTab's pointer interaction.
  await seek(page, 0);
  const surface = page.locator(".at-surface");
  const rect = (await surface.boundingBox())!;
  await page.mouse.click(rect.x + 250, rect.y + 100);
  await expect.poll(() => position(page)).toBeGreaterThan(0.1);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/local4-rhythm.png" });
  const p = await save(page);
  expect(p.arrangementDraft.assessment.rules).toHaveLength(6);
  expect(
    p.arrangement.notes.some((n: { duration: number }) => n.duration > 0),
  ).toBe(true);
});

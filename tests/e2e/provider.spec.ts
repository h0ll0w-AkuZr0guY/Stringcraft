import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
// Explicit opt-in only. Never record credentials in screenshots, video or traces.
test.use({ trace: "off", screenshot: "off", video: "off" });
test("opt-in actual Pages BYOK call uses the official provider and validated candidates", async ({
  page,
}) => {
  test.skip(
    !process.env.STRINGCRAFT_PROVIDER_KEY_FILE,
    "No provider credential supplied",
  );
  const text = await readFile(
    process.env.STRINGCRAFT_PROVIDER_KEY_FILE!,
    "utf8",
  );
  const key = text.match(/sk-[A-Za-z0-9_.-]{20,}/)?.[0];
  if (!key)
    throw new Error("Credential format not recognized; file was not logged");
  await page.goto("./?view=guitar");
  await expect(
    page.getByRole("button", { name: "生成吉他编配", exact: true }),
  ).toBeEnabled();
  try {
    await page.getByRole("button", { name: "API 设置", exact: true }).click();
    await page.getByPlaceholder("仅保留在当前页面内存").fill(key);
    await page.getByRole("button", { name: "完成设置", exact: true }).click();
    await page.locator(".generation-advanced-controls > summary").click();
    await page.getByRole("checkbox", { name: /AI 辅助建议/ }).check();
    const response = page.waitForResponse(
      (r) =>
        r.url() ===
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
    await page
      .getByRole("button", { name: "生成吉他编配", exact: true })
      .click();
    expect((await response).status()).toBe(200);
    await expect(page.locator(".advice")).toContainText("AI 已选择");
    const d = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出项目", exact: true }).click();
    const file = await d;
    const exported = await readFile((await file.path())!, "utf8");
    // Boolean assertion avoids printing either credential or exported content.
    expect(exported.includes(key)).toBe(false);
  } finally {
    // Remove before failure diagnostics can inspect the UI; context is then closed.
    if (!(await page.getByPlaceholder("仅保留在当前页面内存").isVisible()))
      await page.getByRole("button", { name: "API 设置", exact: true }).click();
    await page.getByPlaceholder("仅保留在当前页面内存").fill("");
    await page.getByRole("button", { name: "清除 Key", exact: true }).click();
  }
});

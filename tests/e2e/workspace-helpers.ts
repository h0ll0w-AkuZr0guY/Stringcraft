import { type Page } from "@playwright/test";
export async function openSettings(page: Page) {
  if (
    !(await page
      .getByRole("button", { name: "关闭设置", exact: true })
      .isVisible())
  )
    await page
      .getByRole("button", { name: "编配与分析设置", exact: true })
      .click();
}
export async function closeSettings(page: Page) {
  if (
    await page
      .getByRole("button", { name: "关闭设置", exact: true })
      .isVisible()
  )
    await page.getByRole("button", { name: "关闭设置", exact: true }).click();
}
export async function setting(page: Page, label: string) {
  await openSettings(page);
  return page.getByLabel(label, { exact: true });
}
export async function settingButton(page: Page, name: string) {
  await openSettings(page);
  return page.getByRole("button", { name, exact: true });
}
export async function exportProject(page: Page) {
  await closeSettings(page);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page
    .getByRole("button", { name: "导出项目 JSON", exact: true })
    .click();
  await page.getByRole("button", { name: "导出", exact: true }).click();
}

import { type Page } from "@playwright/test";
export async function openSettings(
  page: Page,
  tab?: "编配" | "识别与分轨" | "节拍与和弦" | "音符与指法",
) {
  if (
    !(await page
      .getByRole("button", { name: "关闭设置", exact: true })
      .isVisible())
  )
    await page.getByRole("button", { name: "专业模式", exact: true }).click();
  if (tab)
    await page
      .getByRole("navigation", { name: "专业配置分类" })
      .getByRole("button", { name: tab, exact: true })
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
  await openSettings(page, label === "清理弱音候选" ? "识别与分轨" : "编配");
  return page.getByLabel(label, { exact: true });
}
export async function settingButton(page: Page, name: string) {
  await openSettings(page, "编配");
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

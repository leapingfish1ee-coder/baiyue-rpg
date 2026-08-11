import { expect, test } from "@playwright/test";

test("create, explore, cancel, choose a destination, save, and restore", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#hud")).toHaveCount(0);
  await expect(page.locator("#debug-link")).toBeHidden();
  await expect(page.locator("#create-world")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#world-seed").fill("20260809");
  await page.locator("#create-world").click();

  await expect(page.locator("#journey-panel")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#save-state")).toContainText("已保存");
  const initiallyRevealed = Number((await page.locator("#revealed-count").textContent())?.match(/\d+/)?.[0] ?? 0);
  expect(initiallyRevealed).toBeGreaterThan(0);

  await page.locator("#explore-continuous").click();
  await expect(page.locator("#cancel-task")).toBeVisible({ timeout: 30_000 });
  await page.locator("#cancel-task").click();
  await expect(page.locator("#cancel-task")).toBeHidden();

  await page.locator("#choose-destination").click();
  const canvas = page.locator("#world");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("world canvas is unavailable");
  await canvas.click({ position: { x: box.width / 2 + 248, y: box.height / 2 + 124 } });
  await expect(page.locator("#destination-card")).toBeVisible();
  const selectedTile = (await page.locator("#destination-label").textContent()) ?? "";
  await page.locator("#destination-confirm").click();
  await expect(page.locator("#activity-state")).toContainText("探索中", { timeout: 30_000 });
  await expect(page.locator("#activity-state")).toContainText("已抵达目的地", { timeout: 30_000 });
  const finallyRevealed = Number((await page.locator("#revealed-count").textContent())?.match(/\d+/)?.[0] ?? 0);
  expect(finallyRevealed).toBeGreaterThan(initiallyRevealed);

  await page.reload();
  await expect(page.locator("#journey-panel")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#save-state")).toContainText("已保存");
  await expect(page.locator("#player-position")).toHaveText(selectedTile);
});

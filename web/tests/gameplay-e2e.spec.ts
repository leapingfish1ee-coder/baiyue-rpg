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

test("woodcut twice with tool cancellation, re-equip, mine once, and reload without duplicate settlement", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("./");
  await expect(page.locator("#create-world")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#world-seed").fill("20260809");
  await page.locator("#create-world").click();

  await expect(page.locator("#gather-controls")).toBeVisible({ timeout: 30_000 });
  await page.locator("#choose-destination").click();
  await page.locator("#destination-x").fill("-6");
  await page.locator("#destination-y").fill("2");
  await page.locator("#destination-confirm").click();
  await expect(page.locator("#activity-state")).toContainText("已抵达目的地", { timeout: 30_000 });
  await expect.poll(() => page.locator("#resource-list li").filter({ hasText: "软木树" }).count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator("#gather-target option[value=softwood_tree]")).toHaveCount(1);
  await page.locator("#gather-target").selectOption("softwood_tree");
  await page.locator("#gather-quantity").fill("2");
  await page.locator("#gather-finite").click();

  await expect(page.locator("#activity-state")).toContainText("伐木", { timeout: 30_000 });
  const softwoodRow = page.locator("#material-list .compact-stat").filter({ hasText: "软木" });
  const stoneRow = page.locator("#material-list .compact-stat").filter({ hasText: "石料" });
  await expect(softwoodRow).toHaveText(/软木\s*1/, { timeout: 30_000 });
  await expect(page.locator("#woodcutting-xp")).toContainText("10 / 100 XP");
  await expect(page.locator("#gather-progress")).toHaveText("1 / 2");

  await expect(page.locator("#activity-state")).toContainText("伐木", { timeout: 30_000 });
  await page.waitForTimeout(750);
  await page.locator("#axe-toggle").click();
  await expect(page.locator("#activity-state")).toContainText("缺少斧");
  await expect(page.locator("#gather-progress")).toHaveText("1 / 2");
  await expect(softwoodRow).toHaveText(/软木\s*1/);
  await expect(page.locator("#tool-inventory-list")).toContainText("破旧斧");

  await page.locator("#axe-toggle").click();
  await expect(softwoodRow).toHaveText(/软木\s*2/, { timeout: 30_000 });
  await expect(page.locator("#woodcutting-xp")).toContainText("20 / 100 XP");
  await expect(page.locator("#gather-progress")).toHaveText("2 / 2");

  await page.locator("#gather-target").selectOption("surface_stone");
  await page.locator("#gather-quantity").fill("1");
  await page.locator("#gather-finite").click();
  await expect(page.locator("#activity-state")).toContainText("采矿", { timeout: 30_000 });
  await expect(stoneRow).toHaveText(/石料\s*1/, { timeout: 30_000 });
  await expect(page.locator("#mining-xp")).toContainText("12 / 100 XP");
  await expect(page.locator("#gather-progress")).toHaveText("1 / 1");
  await expect(page.locator("#save-state")).toContainText("已保存");

  await page.reload();
  await expect(page.locator("#journey-panel")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#gather-progress")).toHaveText("1 / 1");
  await expect(softwoodRow).toHaveText(/软木\s*2/);
  await expect(stoneRow).toHaveText(/石料\s*1/);
  await expect(page.locator("#woodcutting-xp")).toContainText("20 / 100 XP");
  await expect(page.locator("#mining-xp")).toContainText("12 / 100 XP");
});

test("rope production exposes missing fiber, settles once after gathering, and survives reload", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("./");
  await expect(page.locator("#create-world")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#world-seed").fill("20260809");
  await page.locator("#create-world").click();

  await expect(page.locator("#produce-recipe option[value=rope]")).toHaveCount(1, { timeout: 30_000 });
  await page.locator("#produce-recipe").selectOption("rope");
  await page.locator("#produce-quantity").fill("1");
  await page.locator("#produce-finite").click();
  await expect(page.locator("#activity-state")).toContainText("缺少材料", { timeout: 30_000 });
  await expect(page.locator("#materials-missing")).toContainText("纤维 缺 2（0/2）");

  await page.locator("#choose-destination").click();
  await page.locator("#destination-x").fill("14");
  await page.locator("#destination-y").fill("20");
  await page.locator("#destination-confirm").click();
  await expect(page.locator("#activity-state")).toContainText("已抵达目的地", { timeout: 30_000 });
  await expect.poll(() => page.locator("#resource-list li").filter({ hasText: "野生纤维" }).count()).toBeGreaterThanOrEqual(2);

  await page.locator("#gather-target").selectOption("wild_fiber");
  await page.locator("#gather-quantity").fill("2");
  await page.locator("#gather-finite").click();
  const fiberRow = page.locator("#material-list .compact-stat").filter({ hasText: "纤维" });
  await expect(fiberRow).toHaveText(/纤维\s*2/, { timeout: 45_000 });

  await page.locator("#produce-recipe").selectOption("rope");
  await page.locator("#produce-quantity").fill("1");
  await page.locator("#produce-finite").click();
  await expect(page.locator("#activity-state")).toContainText("生产绳索", { timeout: 30_000 });
  const ropeRow = page.locator("#material-list .compact-stat").filter({ hasText: "绳索" });
  await expect(ropeRow).toHaveText(/绳索\s*1/, { timeout: 30_000 });
  await expect(page.locator("#crafting-xp")).toContainText("12 / 100 XP");
  await expect(page.locator("#gather-progress")).toHaveText("生产 1 / 1");
  await expect(page.locator("#save-state")).toContainText("已保存");

  await page.reload();
  await expect(page.locator("#journey-panel")).toBeVisible({ timeout: 30_000 });
  await expect(ropeRow).toHaveText(/绳索\s*1/);
  await expect(page.locator("#crafting-xp")).toContainText("12 / 100 XP");
  await expect(page.locator("#gather-progress")).toHaveText("生产 1 / 1");
  await page.waitForTimeout(1_000);
  await expect(ropeRow).toHaveText(/绳索\s*1/);
});

test("discover a graymane boar, Hunt once, settle combat, and reload without duplicate rewards", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("./");
  await expect(page.locator("#create-world")).toBeEnabled({ timeout: 30_000 });
  await page.locator("#world-seed").fill("20260809");
  await page.locator("#create-world").click();

  await expect(page.locator("#journey-panel")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#weapon-equipped")).toHaveText("破旧短刃");
  await expect(page.locator("#weapon-detail")).toContainText("4–6 伤害");

  await page.locator("#choose-destination").click();
  await page.locator("#destination-x").fill("-10");
  await page.locator("#destination-y").fill("28");
  await page.locator("#destination-confirm").click();
  await expect(page.locator("#hunt-controls")).toBeVisible({ timeout: 45_000 });
  await page.locator("#hunt-quantity").fill("1");
  await page.locator("#hunt-finite").click();

  await expect(page.locator("#combat-panel")).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("#combat-enemy-name")).toHaveText("灰鬃野猪");
  await expect(page.locator("#combat-trigger")).toHaveText("定向狩猎");
  await expect(page.locator("#combat-panel")).toBeHidden({ timeout: 45_000 });

  const rawHideRow = page.locator("#material-list .compact-stat").filter({ hasText: "生皮" });
  await expect(rawHideRow).toHaveText(/生皮\s*1/);
  await expect(page.locator("#melee-xp")).toContainText("30 / 100 XP");
  await expect(page.locator("#hunt-progress")).toHaveText("1 / 1");
  await expect(page.locator("#save-state")).toContainText("已保存");

  await page.reload();
  await expect(page.locator("#journey-panel")).toBeVisible({ timeout: 30_000 });
  await expect(rawHideRow).toHaveText(/生皮\s*1/);
  await expect(page.locator("#melee-xp")).toContainText("30 / 100 XP");
  await expect(page.locator("#hunt-progress")).toHaveText("1 / 1");
  await page.waitForTimeout(1_000);
  await expect(rawHideRow).toHaveText(/生皮\s*1/);
});

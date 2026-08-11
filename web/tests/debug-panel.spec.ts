import { expect, test } from "@playwright/test";

test("debug panel exposes compact exact controls, persists tuning, and exports a submission-ready JSON", async ({ page }) => {
  await page.goto("./world-debug.html?shaderTime=10");
  await expect(page.locator("html")).toHaveAttribute("data-render-mode", "enhanced", { timeout: 30_000 });

  await expect(page.locator("[data-lighting-parameter]")).toHaveCount(8);
  await expect(page.locator("[data-texture-slot][data-texture-parameter]")).toHaveCount(24);
  await expect(page.locator("#lighting-parameter-panel")).toHaveAttribute("open", "");
  await expect(page.locator("#texture-parameter-panel")).not.toHaveAttribute("open", "");

  const exposureNumber = page.locator("#lighting-exposure-number");
  await exposureNumber.fill("1.15");
  await exposureNumber.press("Enter");
  await expect(page.locator("#lighting-exposure")).toHaveValue("1.15");

  await page.locator("#texture-parameter-panel > summary").click();
  await expect(page.locator("#texture-parameter-panel")).toHaveAttribute("open", "");
  const landSpeedNumber = page.locator("#texture-slot-3-speed-number");
  await landSpeedNumber.fill("0.123");
  await landSpeedNumber.press("Enter");
  await expect(page.locator("#texture-slot-3-speed")).toHaveValue("0.123");

  const stored = await page.evaluate(() => ({
    lighting: JSON.parse(localStorage.getItem("baiyue-rpg:global-lighting-params:v1") ?? "null") as { exposure?: number } | null,
    texture: JSON.parse(localStorage.getItem("baiyue-rpg:texture-shader-params:v2") ?? "null") as { slots?: Array<{ speed?: number }> } | null,
  }));
  expect(stored.lighting?.exposure).toBeCloseTo(1.15);
  expect(stored.texture?.slots?.[3]?.speed).toBeCloseTo(0.123);

  await page.locator("#debug-panel-collapse").click();
  await expect(page.locator("#hud")).toHaveClass(/is-collapsed/);
  expect(await page.evaluate(() => localStorage.getItem("baiyue-rpg:debug-panel-collapsed:v1"))).toBe("1");
  await page.locator("#debug-panel-collapse").click();
  await expect(page.locator("#hud")).not.toHaveClass(/is-collapsed/);

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#debug-export").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^baiyue-rpg-debug-params-.*\.json$/);

  const stream = await download.createReadStream();
  if (!stream) throw new Error("Debug parameter download stream is unavailable.");
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  }
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const exported = JSON.parse(new TextDecoder().decode(bytes)) as {
    schema: string;
    source: { waterVisualBaseline: string };
    textureShader: { slots: Array<{ slot: number; name: string; speed: number }> };
    globalLighting: { exposure: number };
  };

  expect(exported.schema).toBe("baiyue-rpg.debug-render-config/v1");
  expect(exported.source.waterVisualBaseline).toBe("b67e8bad260b3816447e067fcedd2524da0c46f3");
  expect(exported.globalLighting.exposure).toBeCloseTo(1.15);
  expect(exported.textureShader.slots[3]).toMatchObject({ slot: 3, name: "土地", speed: 0.123 });
  await expect(page.locator("#debug-export-status")).toContainText("JSON 已导出");
});

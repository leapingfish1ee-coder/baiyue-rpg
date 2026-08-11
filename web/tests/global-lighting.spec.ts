import { expect, test } from "@playwright/test";
import {
  DEFAULT_GLOBAL_LIGHTING_PARAMETERS,
  GLOBAL_LIGHTING_PARAMETER_LIMITS,
  NEUTRAL_GLOBAL_LIGHTING_PARAMETERS,
} from "../src/texture-shader";

test("production lighting defaults match the approved scattered-cloud lab preset", () => {
  expect(DEFAULT_GLOBAL_LIGHTING_PARAMETERS).toEqual({
    exposure: 0.65,
    cloudDensity: 0.58,
    shadowStrength: 0.52,
    cloudScale: 0.0065,
    softness: 0.12,
    detail: 0.42,
    windSpeed: 0.34,
    windDirection: 28,
  });
  expect(NEUTRAL_GLOBAL_LIGHTING_PARAMETERS.exposure).toBe(0);
  expect(NEUTRAL_GLOBAL_LIGHTING_PARAMETERS.cloudDensity).toBe(0);
  expect(NEUTRAL_GLOBAL_LIGHTING_PARAMETERS.shadowStrength).toBe(0);
  expect(GLOBAL_LIGHTING_PARAMETER_LIMITS.exposure).toEqual([-6, 6]);
  expect(GLOBAL_LIGHTING_PARAMETER_LIMITS.shadowStrength).toEqual([0, 0.9]);
});

test("main map initializes the cloud lighting stage in real WebGL2", async ({ page }) => {
  await page.goto("./world-debug.html?shaderTime=10");
  await expect(page.locator("html")).toHaveAttribute("data-render-mode", "enhanced", { timeout: 30_000 });
  await expect(page.locator("#texture-effects")).toHaveAttribute("data-lighting-stage", "cloud");
  await expect(page.locator("#status")).toContainText("WASM v", { timeout: 30_000 });
});

test("diagnostic lighting modes preserve the enhanced renderer", async ({ page }) => {
  await page.goto("./world-debug.html?shaderTime=10&lighting=neutral");
  await expect(page.locator("html")).toHaveAttribute("data-render-mode", "enhanced", { timeout: 30_000 });
  await expect(page.locator("#texture-effects")).toHaveAttribute("data-lighting-stage", "neutral");

  await page.goto("./world-debug.html?shaderTime=10&lighting=off");
  await expect(page.locator("html")).toHaveAttribute("data-render-mode", "enhanced", { timeout: 30_000 });
  await expect(page.locator("#texture-effects")).toHaveAttribute("data-lighting-stage", "off");
});

import { expect, test, type Page } from "@playwright/test";
import {
  DEFAULT_TEXTURE_SHADER_PARAMETERS,
  TEXTURE_SHADER_PARAMETER_LIMITS,
  WATER_VISUAL_BASELINE_GLSL,
  WATER_VISUAL_BASELINE_VERSION,
} from "../src/texture-shader";

const APPROVED_WATER_COMPOSITE = `
    vec3 baseColor = deep ? u_deepBase : u_shallowBase;
    vec3 fullColor = deep ? u_deepColor : u_shallowColor;
    vec3 ambientColor = mix(baseColor * 1.05, fullColor * 0.52, colorNoise);

    vec3 overlayColor = mix(ambientColor, textureColor, textureAlpha);
    float ambientAlpha = deep ? 0.16 : 0.20;
    float overlayAlpha = mix(ambientAlpha + colorNoise * 0.07, 0.94, textureAlpha);

    outColor = vec4(overlayColor, overlayAlpha);
`;

const EXPECTED_SLOT_DEFAULTS = [
  { speed: 0.18, colorStrength: 0.15, colorFrequency: 0.045 },
  { speed: 0.30, colorStrength: 0.22, colorFrequency: 0.045 },
  { speed: 0.052, colorStrength: 0.06, colorFrequency: 0.045 },
  { speed: 0.08, colorStrength: 0.08, colorFrequency: 0.045 },
  { speed: 0.02, colorStrength: 0.036, colorFrequency: 0.045 },
  { speed: 0.044, colorStrength: 0.068, colorFrequency: 0.045 },
  { speed: 0.11, colorStrength: 0.10, colorFrequency: 0.045 },
  { speed: 0.075, colorStrength: 0.08, colorFrequency: 0.045 },
];

async function waitForWorld(page: Page): Promise<void> {
  await expect(page.locator("#status")).toContainText("WASM v", { timeout: 30_000 });
  await expect.poll(async () => {
    const text = await page.locator("#chunks").textContent();
    return Number(text?.match(/\d+/)?.[0] ?? 0);
  }).toBeGreaterThan(0);

  await expect.poll(async () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#world");
    const context = canvas?.getContext("2d");
    if (!canvas || !context || canvas.width < 8 || canvas.height < 8) return 0;

    const sampleWidth = Math.min(96, canvas.width);
    const sampleHeight = Math.min(96, canvas.height);
    const startX = Math.max(0, Math.floor((canvas.width - sampleWidth) / 2));
    const startY = Math.max(0, Math.floor((canvas.height - sampleHeight) / 2));
    const pixels = context.getImageData(startX, startY, sampleWidth, sampleHeight).data;
    let nonBlack = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if ((pixels[offset] ?? 0) > 0 || (pixels[offset + 1] ?? 0) > 0 || (pixels[offset + 2] ?? 0) > 0) {
        nonBlack += 1;
      }
    }
    return nonBlack;
  })).toBeGreaterThan(20);
}

test("validated water visual composition remains pinned to b67 baseline", () => {
  expect(WATER_VISUAL_BASELINE_VERSION).toBe("b67e8bad260b3816447e067fcedd2524da0c46f3");
  expect(WATER_VISUAL_BASELINE_GLSL).toBe(APPROVED_WATER_COMPOSITE);
});

test("all eight texture slots keep the current visual defaults but have wider independent limits", () => {
  expect(DEFAULT_TEXTURE_SHADER_PARAMETERS.slots).toEqual(EXPECTED_SLOT_DEFAULTS);
  expect(TEXTURE_SHADER_PARAMETER_LIMITS).toEqual({
    speed: [0.001, 2.0],
    colorStrength: [0, 1.0],
    colorFrequency: [0.001, 0.5],
  });
});

test("all eight texture slots expose and persist independent dynamic parameters", async ({ page }) => {
  await page.goto("./?shaderTime=10");

  const controls = page.locator("[data-texture-slot][data-texture-parameter]");
  await expect(controls).toHaveCount(24);

  for (let slot = 0; slot < 8; slot += 1) {
    const speed = page.locator(`[data-texture-slot="${slot}"][data-texture-parameter="speed"]`);
    const strength = page.locator(`[data-texture-slot="${slot}"][data-texture-parameter="colorStrength"]`);
    const frequency = page.locator(`[data-texture-slot="${slot}"][data-texture-parameter="colorFrequency"]`);
    await expect(speed).toHaveAttribute("min", "0.001");
    await expect(speed).toHaveAttribute("max", "2");
    await expect(strength).toHaveAttribute("min", "0");
    await expect(strength).toHaveAttribute("max", "1");
    await expect(frequency).toHaveAttribute("min", "0.001");
    await expect(frequency).toHaveAttribute("max", "0.5");
  }

  await page.locator('[data-texture-slot="2"][data-texture-parameter="speed"]').evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "0.333";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator('[data-texture-slot="3"][data-texture-parameter="speed"]').evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "0.777";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator('[data-texture-slot="7"][data-texture-parameter="colorFrequency"]').evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "0.321";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem("baiyue-rpg:texture-shader-params:v2");
    return raw ? JSON.parse(raw) as { slots: Array<{ speed: number; colorStrength: number; colorFrequency: number }> } : null;
  });
  expect(stored).not.toBeNull();
  expect(stored?.slots[2]?.speed).toBeCloseTo(0.333);
  expect(stored?.slots[3]?.speed).toBeCloseTo(0.777);
  expect(stored?.slots[2]?.colorFrequency).toBeCloseTo(0.045);
  expect(stored?.slots[7]?.colorFrequency).toBeCloseTo(0.321);
});

test("Canvas2D remains fully usable when WebGL2 cannot be created", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function patchedGetContext(
      this: HTMLCanvasElement,
      contextId: string,
      ...args: unknown[]
    ): RenderingContext | null {
      if (contextId === "webgl2") return null;
      return originalGetContext.call(this, contextId as never, ...(args as []));
    };
  });

  await page.goto("./");
  await expect(page.locator("html")).toHaveAttribute("data-render-mode", "fallback");
  await expect(page.locator("#texture-shader-toggle")).toBeDisabled();
  await expect(page.locator("#render-mode")).toContainText("Canvas2D");
  await waitForWorld(page);
  expect(pageErrors).toEqual([]);
});

test("WebGL2 shader initializes, then context loss restores complete Canvas2D textures", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("./?shaderTime=10");
  await waitForWorld(page);

  await expect(page.locator("html")).toHaveAttribute("data-render-mode", "enhanced");
  await expect(page.locator("#render-mode")).toContainText("WebGL2");
  await expect(page.locator("#texture-shader-toggle")).toBeChecked();
  await expect(page.locator("#texture-shader-toggle")).toBeEnabled();

  const contextLost = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("#texture-effects");
    const gl = canvas?.getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_lose_context");
    if (!extension) return false;
    extension.loseContext();
    return true;
  });

  expect(contextLost).toBe(true);
  await expect(page.locator("html")).toHaveAttribute("data-render-mode", "fallback");
  await expect(page.locator("#texture-shader-toggle")).toBeDisabled();
  await waitForWorld(page);
  expect(pageErrors).toEqual([]);
});

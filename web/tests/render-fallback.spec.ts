import { expect, test, type Page } from "@playwright/test";
import {
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

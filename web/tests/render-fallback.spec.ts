import { expect, test, type Page } from "@playwright/test";

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

test("losing a live WebGL2 context degrades to Canvas2D without losing the world", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("./");
  await waitForWorld(page);

  const mode = await page.locator("html").getAttribute("data-render-mode");
  if (mode === "enhanced") {
    const contextLost = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>("#texture-effects");
      const gl = canvas?.getContext("webgl2");
      const extension = gl?.getExtension("WEBGL_lose_context");
      if (!extension) return false;
      extension.loseContext();
      return true;
    });

    if (contextLost) {
      await expect(page.locator("html")).toHaveAttribute("data-render-mode", "fallback");
      await expect(page.locator("#texture-shader-toggle")).toBeDisabled();
      await waitForWorld(page);
    }
  } else {
    expect(["canvas", "fallback"]).toContain(mode);
  }

  expect(pageErrors).toEqual([]);
});

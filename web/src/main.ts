import "./style.css";
import { Camera } from "./camera";
import { ChunkManager } from "./chunk-manager";
import { Renderer, TERRAIN_NAMES } from "./renderer";
import { TextureTool } from "./texture-tool";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required UI element is missing: ${selector}`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#world");
const seedInput = requireElement<HTMLInputElement>("#seed");
const applySeedButton = requireElement<HTMLButtonElement>("#apply-seed");
const gridToggle = requireElement<HTMLInputElement>("#grid-toggle");
const statusElement = requireElement<HTMLElement>("#status");
const positionElement = requireElement<HTMLElement>("#position");
const chunksElement = requireElement<HTMLElement>("#chunks");
const zoomElement = requireElement<HTMLElement>("#zoom");

const maybeContext = canvas.getContext("2d");
if (!maybeContext) throw new Error("Canvas 2D is unavailable.");
const context: CanvasRenderingContext2D = maybeContext;

const camera = new Camera(canvas);
const chunkManager = new ChunkManager();
const renderer = new Renderer();
renderer.setGridVisible(gridToggle.checked);

const textureTool = new TextureTool(renderer, {
  toggleButton: requireElement<HTMLButtonElement>("#texture-tool-toggle"),
  panel: requireElement<HTMLElement>("#texture-tool"),
  closeButton: requireElement<HTMLButtonElement>("#texture-tool-close"),
  fileInput: requireElement<HTMLInputElement>("#texture-file"),
  resetButton: requireElement<HTMLButtonElement>("#texture-reset"),
  status: requireElement<HTMLElement>("#texture-status"),
  preview: requireElement<HTMLElement>("#texture-preview"),
});
void textureTool.restoreStoredSheet();

let viewportWidth = 1;
let viewportHeight = 1;
let lastFrame = performance.now();

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewportWidth = Math.max(1, canvas.clientWidth);
  viewportHeight = Math.max(1, canvas.clientHeight);
  const targetWidth = Math.round(viewportWidth * dpr);
  const targetHeight = Math.round(viewportHeight * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function parseSeed(value: string): bigint {
  const normalized = value.trim();
  if (!normalized) throw new Error("Seed 不能为空。");
  const seed = BigInt(normalized);
  if (seed < 0n || seed > 0xffff_ffff_ffff_ffffn) {
    throw new Error("Seed 必须位于 0 到 18446744073709551615。 ");
  }
  return seed;
}

function applySeed(): void {
  try {
    const seed = parseSeed(seedInput.value);
    chunkManager.setSeed(seed);
    renderer.clear();
    seedInput.setCustomValidity("");
  } catch (error: unknown) {
    seedInput.setCustomValidity(error instanceof Error ? error.message : String(error));
    seedInput.reportValidity();
  }
}

function setGridVisible(visible: boolean): void {
  gridToggle.checked = visible;
  renderer.setGridVisible(visible);
}

applySeedButton.addEventListener("click", applySeed);
seedInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") applySeed();
});
gridToggle.addEventListener("change", () => {
  setGridVisible(gridToggle.checked);
});
window.addEventListener("keydown", (event) => {
  if (event.repeat || event.code !== "KeyG") return;
  if (event.target instanceof HTMLInputElement) return;
  setGridVisible(!renderer.isGridVisible());
});
window.addEventListener("resize", resize);
resize();

function frame(now: number): void {
  const deltaSeconds = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  resize();
  camera.update(deltaSeconds);

  chunkManager.ensureVisible(
    camera.x,
    camera.y,
    viewportWidth,
    viewportHeight,
    camera.zoom,
    renderer.tilePixels,
  );
  renderer.draw(context, viewportWidth, viewportHeight, camera, chunkManager);

  const centerTileX = Math.floor(camera.x / renderer.tilePixels);
  const centerTileY = Math.floor(camera.y / renderer.tilePixels);
  const macroX = Math.floor(centerTileX / chunkManager.chunkSize);
  const macroY = Math.floor(centerTileY / chunkManager.chunkSize);
  const centerMacro = chunkManager.getChunk(macroX, macroY);
  const biomeName = centerMacro ? (TERRAIN_NAMES[centerMacro.macroBiome] ?? `#${centerMacro.macroBiome}`) : "加载中";
  const status = chunkManager.getStatus();

  statusElement.textContent = status.error
    ? `错误: ${status.error}`
    : status.ready
      ? `WASM v${status.generatorVersion ?? "?"} · 1 macro = ${chunkManager.chunkSize}×${chunkManager.chunkSize} tiles`
      : "WASM 初始化中";
  positionElement.textContent = `tile ${centerTileX.toLocaleString()}, ${centerTileY.toLocaleString()} · macro ${macroX}, ${macroY} · ${biomeName}`;
  chunksElement.textContent = `${chunkManager.loadedCount} macro regions`;
  zoomElement.textContent = `${Math.round(camera.zoom * 100)}%`;

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

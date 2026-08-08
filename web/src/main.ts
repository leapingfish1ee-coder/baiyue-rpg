import "./style.css";
import { Camera } from "./camera";
import { ChunkManager } from "./chunk-manager";
import { Renderer, TERRAIN_NAMES } from "./renderer";
import { TextureTool } from "./texture-tool";
import { WaterShaderRenderer, type WaterShaderParameters } from "./water-shader";

const WATER_SHADER_STORAGE_KEY = "baiyue-rpg:water-shader-params:v1";

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required UI element is missing: ${selector}`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#world");
const waterCanvas = requireElement<HTMLCanvasElement>("#water-effects");
const seedInput = requireElement<HTMLInputElement>("#seed");
const applySeedButton = requireElement<HTMLButtonElement>("#apply-seed");
const gridToggle = requireElement<HTMLInputElement>("#grid-toggle");
const waterShaderToggle = requireElement<HTMLInputElement>("#water-shader-toggle");
const waterParameterFields = requireElement<HTMLFieldSetElement>("#water-parameter-fields");
const waterParameterReset = requireElement<HTMLButtonElement>("#water-parameter-reset");
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
const waterShader = new WaterShaderRenderer(waterCanvas);
renderer.setGridVisible(gridToggle.checked);

type WaterControlDefinition = {
  key: keyof WaterShaderParameters;
  input: HTMLInputElement;
  output: HTMLOutputElement;
  decimals: number;
  suffix: string;
};

const waterControls: WaterControlDefinition[] = [
  {
    key: "deepSpeed",
    input: requireElement<HTMLInputElement>("#water-deep-speed"),
    output: requireElement<HTMLOutputElement>("#water-deep-speed-value"),
    decimals: 2,
    suffix: "×",
  },
  {
    key: "deepColorStrength",
    input: requireElement<HTMLInputElement>("#water-deep-color"),
    output: requireElement<HTMLOutputElement>("#water-deep-color-value"),
    decimals: 2,
    suffix: "",
  },
  {
    key: "shallowSpeed",
    input: requireElement<HTMLInputElement>("#water-shallow-speed"),
    output: requireElement<HTMLOutputElement>("#water-shallow-speed-value"),
    decimals: 2,
    suffix: "×",
  },
  {
    key: "shallowColorStrength",
    input: requireElement<HTMLInputElement>("#water-shallow-color"),
    output: requireElement<HTMLOutputElement>("#water-shallow-color-value"),
    decimals: 2,
    suffix: "",
  },
  {
    key: "colorFrequency",
    input: requireElement<HTMLInputElement>("#water-color-frequency"),
    output: requireElement<HTMLOutputElement>("#water-color-frequency-value"),
    decimals: 3,
    suffix: "",
  },
];

function syncWaterParameterControls(): void {
  const parameters = waterShader.getParameters();
  for (const control of waterControls) {
    const value = parameters[control.key];
    control.input.value = String(value);
    control.output.textContent = `${value.toFixed(control.decimals)}${control.suffix}`;
  }
}

function persistWaterParameters(): void {
  try {
    localStorage.setItem(WATER_SHADER_STORAGE_KEY, JSON.stringify(waterShader.getParameters()));
  } catch {
    // Rendering remains functional if local storage is unavailable.
  }
}

function restoreWaterParameters(): void {
  const stored = localStorage.getItem(WATER_SHADER_STORAGE_KEY);
  if (!stored) return;
  try {
    const parsed = JSON.parse(stored) as Partial<WaterShaderParameters>;
    waterShader.setParameters(parsed);
  } catch {
    localStorage.removeItem(WATER_SHADER_STORAGE_KEY);
  }
}

restoreWaterParameters();
syncWaterParameterControls();

for (const control of waterControls) {
  control.input.addEventListener("input", () => {
    const value = Number(control.input.value);
    waterShader.setParameters({ [control.key]: value } as Partial<WaterShaderParameters>);
    const actual = waterShader.getParameters()[control.key];
    control.output.textContent = `${actual.toFixed(control.decimals)}${control.suffix}`;
    persistWaterParameters();
  });
}

waterParameterReset.addEventListener("click", () => {
  waterShader.resetParameters();
  localStorage.removeItem(WATER_SHADER_STORAGE_KEY);
  syncWaterParameterControls();
});

function setWaterShaderEnabled(enabled: boolean): void {
  const active = enabled && waterShader.available;
  waterShaderToggle.checked = active;
  renderer.setWaterShaderEnabled(active);
  waterShader.setEnabled(active);
}

if (!waterShader.available) {
  waterShaderToggle.checked = false;
  waterShaderToggle.disabled = true;
  waterShaderToggle.title = "当前浏览器不支持 WebGL2，已回退到静态水面纹理。";
  waterParameterFields.disabled = true;
  waterParameterReset.disabled = true;
}
setWaterShaderEnabled(waterShaderToggle.checked);

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
  waterShader.resize(viewportWidth, viewportHeight, dpr);
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
waterShaderToggle.addEventListener("change", () => {
  setWaterShaderEnabled(waterShaderToggle.checked);
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
  waterShader.draw(now / 1000, camera, chunkManager, renderer);

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

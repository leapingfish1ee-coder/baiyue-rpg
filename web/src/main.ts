import "./style.css";
import { Camera } from "./camera";
import { ChunkManager } from "./chunk-manager";
import { Renderer, TERRAIN_NAMES } from "./renderer";
import { TextureTool } from "./texture-tool";
import { TextureShaderRenderer, type TextureShaderParameters } from "./texture-shader";

const TEXTURE_SHADER_STORAGE_KEY = "baiyue-rpg:texture-shader-params:v1";
const LEGACY_WATER_SHADER_STORAGE_KEY = "baiyue-rpg:water-shader-params:v1";
const ZOOM_PRESETS = [0.5, 1, 2, 4] as const;

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required UI element is missing: ${selector}`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#world");
const textureCanvas = requireElement<HTMLCanvasElement>("#texture-effects");
const seedInput = requireElement<HTMLInputElement>("#seed");
const applySeedButton = requireElement<HTMLButtonElement>("#apply-seed");
const gridToggle = requireElement<HTMLInputElement>("#grid-toggle");
const baseColorToggle = requireElement<HTMLInputElement>("#base-color-toggle");
const textureShaderToggle = requireElement<HTMLInputElement>("#texture-shader-toggle");
const textureParameterFields = requireElement<HTMLFieldSetElement>("#texture-parameter-fields");
const textureParameterReset = requireElement<HTMLButtonElement>("#texture-parameter-reset");
const zoomPresetButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-zoom]"));
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
const textureShader = new TextureShaderRenderer(textureCanvas);
renderer.setGridVisible(gridToggle.checked);
renderer.setBaseColorVisible(baseColorToggle.checked);

type TextureControlDefinition = {
  key: keyof TextureShaderParameters;
  input: HTMLInputElement;
  output: HTMLOutputElement;
  decimals: number;
  suffix: string;
};

const textureControls: TextureControlDefinition[] = [
  {
    key: "deepSpeed",
    input: requireElement<HTMLInputElement>("#texture-deep-speed"),
    output: requireElement<HTMLOutputElement>("#texture-deep-speed-value"),
    decimals: 2,
    suffix: "×",
  },
  {
    key: "deepColorStrength",
    input: requireElement<HTMLInputElement>("#texture-deep-color"),
    output: requireElement<HTMLOutputElement>("#texture-deep-color-value"),
    decimals: 2,
    suffix: "",
  },
  {
    key: "shallowSpeed",
    input: requireElement<HTMLInputElement>("#texture-shallow-speed"),
    output: requireElement<HTMLOutputElement>("#texture-shallow-speed-value"),
    decimals: 2,
    suffix: "×",
  },
  {
    key: "shallowColorStrength",
    input: requireElement<HTMLInputElement>("#texture-shallow-color"),
    output: requireElement<HTMLOutputElement>("#texture-shallow-color-value"),
    decimals: 2,
    suffix: "",
  },
  {
    key: "surfaceSpeed",
    input: requireElement<HTMLInputElement>("#texture-surface-speed"),
    output: requireElement<HTMLOutputElement>("#texture-surface-speed-value"),
    decimals: 2,
    suffix: "×",
  },
  {
    key: "surfaceColorStrength",
    input: requireElement<HTMLInputElement>("#texture-surface-color"),
    output: requireElement<HTMLOutputElement>("#texture-surface-color-value"),
    decimals: 2,
    suffix: "",
  },
  {
    key: "decorationSpeed",
    input: requireElement<HTMLInputElement>("#texture-decoration-speed"),
    output: requireElement<HTMLOutputElement>("#texture-decoration-speed-value"),
    decimals: 2,
    suffix: "×",
  },
  {
    key: "decorationColorStrength",
    input: requireElement<HTMLInputElement>("#texture-decoration-color"),
    output: requireElement<HTMLOutputElement>("#texture-decoration-color-value"),
    decimals: 2,
    suffix: "",
  },
  {
    key: "colorFrequency",
    input: requireElement<HTMLInputElement>("#texture-color-frequency"),
    output: requireElement<HTMLOutputElement>("#texture-color-frequency-value"),
    decimals: 3,
    suffix: "",
  },
];

function syncTextureParameterControls(): void {
  const parameters = textureShader.getParameters();
  for (const control of textureControls) {
    const value = parameters[control.key];
    control.input.value = String(value);
    control.output.textContent = `${value.toFixed(control.decimals)}${control.suffix}`;
  }
}

function persistTextureParameters(): void {
  try {
    localStorage.setItem(TEXTURE_SHADER_STORAGE_KEY, JSON.stringify(textureShader.getParameters()));
  } catch {
    // Rendering remains functional if local storage is unavailable.
  }
}

function restoreTextureParameters(): void {
  let stored = localStorage.getItem(TEXTURE_SHADER_STORAGE_KEY);
  if (!stored) {
    stored = localStorage.getItem(LEGACY_WATER_SHADER_STORAGE_KEY);
    if (stored) localStorage.removeItem(LEGACY_WATER_SHADER_STORAGE_KEY);
  }
  if (!stored) return;

  try {
    const parsed = JSON.parse(stored) as Partial<TextureShaderParameters>;
    textureShader.setParameters(parsed);
    persistTextureParameters();
  } catch {
    localStorage.removeItem(TEXTURE_SHADER_STORAGE_KEY);
  }
}

restoreTextureParameters();
syncTextureParameterControls();

for (const control of textureControls) {
  control.input.addEventListener("input", () => {
    const value = Number(control.input.value);
    textureShader.setParameters({ [control.key]: value } as Partial<TextureShaderParameters>);
    const actual = textureShader.getParameters()[control.key];
    control.output.textContent = `${actual.toFixed(control.decimals)}${control.suffix}`;
    persistTextureParameters();
  });
}

textureParameterReset.addEventListener("click", () => {
  textureShader.resetParameters();
  localStorage.removeItem(TEXTURE_SHADER_STORAGE_KEY);
  syncTextureParameterControls();
});

function setTextureShaderEnabled(enabled: boolean): void {
  const active = enabled && textureShader.available;
  textureShaderToggle.checked = active;
  renderer.setTextureShaderEnabled(active);
  textureShader.setEnabled(active);
}

if (!textureShader.available) {
  textureShaderToggle.checked = false;
  textureShaderToggle.disabled = true;
  textureShaderToggle.title = "当前浏览器不支持 WebGL2，已回退到静态纹理渲染。";
  textureParameterFields.disabled = true;
  textureParameterReset.disabled = true;
}
setTextureShaderEnabled(textureShaderToggle.checked);

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
  textureShader.resize(viewportWidth, viewportHeight, dpr);
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

function setBaseColorVisible(visible: boolean): void {
  baseColorToggle.checked = visible;
  renderer.setBaseColorVisible(visible);
}

function setZoomPreset(zoom: number): void {
  camera.setZoom(zoom);
  syncZoomPresetButtons();
}

function syncZoomPresetButtons(): void {
  for (const button of zoomPresetButtons) {
    const zoom = Number(button.dataset.zoom);
    const active = Number.isFinite(zoom) && Math.abs(camera.zoom - zoom) < 0.001;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

for (const button of zoomPresetButtons) {
  button.addEventListener("click", () => {
    const zoom = Number(button.dataset.zoom);
    if (Number.isFinite(zoom)) setZoomPreset(zoom);
  });
}
syncZoomPresetButtons();

applySeedButton.addEventListener("click", applySeed);
seedInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") applySeed();
});
gridToggle.addEventListener("change", () => {
  setGridVisible(gridToggle.checked);
});
baseColorToggle.addEventListener("change", () => {
  setBaseColorVisible(baseColorToggle.checked);
});
textureShaderToggle.addEventListener("change", () => {
  setTextureShaderEnabled(textureShaderToggle.checked);
});
window.addEventListener("keydown", (event) => {
  if (event.repeat) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;

  if (event.code === "KeyG") {
    setGridVisible(!renderer.isGridVisible());
    return;
  }

  const presetIndex = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(event.code);
  const preset = ZOOM_PRESETS[presetIndex];
  if (preset !== undefined) setZoomPreset(preset);
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
  textureShader.draw(now / 1000, camera, chunkManager, renderer);

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
  syncZoomPresetButtons();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

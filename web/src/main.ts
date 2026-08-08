import "./style.css";
import { Camera } from "./camera";
import { ChunkManager } from "./chunk-manager";
import { Renderer, TERRAIN_NAMES, TEXTURE_SLOT_NAMES } from "./renderer";
import { TextureTool } from "./texture-tool";
import {
  TextureShaderRenderer,
  type TextureShaderFailure,
  type TextureShaderParameterName,
  type TextureShaderParameters,
} from "./texture-shader";

const TEXTURE_SHADER_STORAGE_KEY = "baiyue-rpg:texture-shader-params:v2";
const LEGACY_TEXTURE_SHADER_STORAGE_KEY = "baiyue-rpg:texture-shader-params:v1";
const LEGACY_WATER_SHADER_STORAGE_KEY = "baiyue-rpg:water-shader-params:v1";
const ZOOM_PRESETS = [0.5, 1, 2, 4] as const;
const TEXTURE_PARAMETER_KEYS = ["speed", "colorStrength", "colorFrequency"] as const satisfies readonly TextureShaderParameterName[];
const queryParameters = new URLSearchParams(window.location.search);
const FORCE_SHADER_OFF = queryParameters.get("shader") === "off";
const shaderTimeValue = queryParameters.get("shaderTime");
const parsedShaderTime = shaderTimeValue === null ? Number.NaN : Number(shaderTimeValue);
const FIXED_SHADER_TIME = Number.isFinite(parsedShaderTime) ? parsedShaderTime : null;

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
const renderModeElement = requireElement<HTMLElement>("#render-mode");

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
  slot: number;
  key: TextureShaderParameterName;
  input: HTMLInputElement;
  output: HTMLOutputElement;
  decimals: number;
  suffix: string;
};

function isTextureParameterName(value: string | undefined): value is TextureShaderParameterName {
  return TEXTURE_PARAMETER_KEYS.includes(value as TextureShaderParameterName);
}

const textureControls: TextureControlDefinition[] = Array.from(
  document.querySelectorAll<HTMLInputElement>("[data-texture-slot][data-texture-parameter]"),
).map((input) => {
  const slot = Number(input.dataset.textureSlot);
  const key = input.dataset.textureParameter;
  if (!Number.isInteger(slot) || slot < 0 || slot >= TEXTURE_SLOT_NAMES.length) {
    throw new Error(`Invalid texture shader slot on #${input.id}: ${input.dataset.textureSlot ?? "missing"}`);
  }
  if (!isTextureParameterName(key)) {
    throw new Error(`Invalid texture shader parameter on #${input.id}: ${key ?? "missing"}`);
  }

  return {
    slot,
    key,
    input,
    output: requireElement<HTMLOutputElement>(`#${input.id}-value`),
    decimals: 3,
    suffix: key === "speed" ? "×" : "",
  };
});

const expectedTextureControlCount = TEXTURE_SLOT_NAMES.length * TEXTURE_PARAMETER_KEYS.length;
if (textureControls.length !== expectedTextureControlCount) {
  throw new Error(`Expected ${expectedTextureControlCount} texture shader controls, found ${textureControls.length}.`);
}

function syncTextureParameterControls(): void {
  for (const control of textureControls) {
    const value = textureShader.getSlotParameters(control.slot)[control.key];
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

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function migrateLegacyTextureParameters(parsed: unknown, waterOnly: boolean): TextureShaderParameters | null {
  if (!parsed || typeof parsed !== "object") return null;
  const legacy = parsed as Record<string, unknown>;
  const migrated = textureShader.getParameters();

  const sharedFrequency = finiteNumber(legacy.colorFrequency);
  if (sharedFrequency !== null) {
    const frequencySlots = waterOnly ? migrated.slots.slice(0, 2) : migrated.slots;
    for (const profile of frequencySlots) profile.colorFrequency = sharedFrequency;
  }

  const deepSpeed = finiteNumber(legacy.deepSpeed);
  const deepStrength = finiteNumber(legacy.deepColorStrength);
  const shallowSpeed = finiteNumber(legacy.shallowSpeed);
  const shallowStrength = finiteNumber(legacy.shallowColorStrength);
  if (deepSpeed !== null && migrated.slots[0]) migrated.slots[0].speed = deepSpeed;
  if (deepStrength !== null && migrated.slots[0]) migrated.slots[0].colorStrength = deepStrength;
  if (shallowSpeed !== null && migrated.slots[1]) migrated.slots[1].speed = shallowSpeed;
  if (shallowStrength !== null && migrated.slots[1]) migrated.slots[1].colorStrength = shallowStrength;

  const surfaceSpeed = finiteNumber(legacy.surfaceSpeed);
  const surfaceStrength = finiteNumber(legacy.surfaceColorStrength);
  const surfaceSpeedMultipliers = [0.65, 1.0, 0.25, 0.55] as const;
  const surfaceStrengthMultipliers = [0.75, 1.0, 0.45, 0.85] as const;
  for (let offset = 0; offset < 4; offset += 1) {
    const profile = migrated.slots[2 + offset];
    if (!profile) continue;
    if (surfaceSpeed !== null) profile.speed = surfaceSpeed * (surfaceSpeedMultipliers[offset] ?? 1);
    if (surfaceStrength !== null) profile.colorStrength = surfaceStrength * (surfaceStrengthMultipliers[offset] ?? 1);
  }

  const decorationSpeed = finiteNumber(legacy.decorationSpeed);
  const decorationStrength = finiteNumber(legacy.decorationColorStrength);
  const decorationSpeedMultipliers = [1.10, 0.75] as const;
  const decorationStrengthMultipliers = [1.0, 0.80] as const;
  for (let offset = 0; offset < 2; offset += 1) {
    const profile = migrated.slots[6 + offset];
    if (!profile) continue;
    if (decorationSpeed !== null) profile.speed = decorationSpeed * (decorationSpeedMultipliers[offset] ?? 1);
    if (decorationStrength !== null) profile.colorStrength = decorationStrength * (decorationStrengthMultipliers[offset] ?? 1);
  }

  return migrated;
}

function restoreTextureParameters(): void {
  const stored = localStorage.getItem(TEXTURE_SHADER_STORAGE_KEY);
  if (stored) {
    try {
      textureShader.setParameters(JSON.parse(stored) as Partial<TextureShaderParameters>);
      return;
    } catch {
      localStorage.removeItem(TEXTURE_SHADER_STORAGE_KEY);
    }
  }

  for (const legacyKey of [LEGACY_TEXTURE_SHADER_STORAGE_KEY, LEGACY_WATER_SHADER_STORAGE_KEY]) {
    const legacyStored = localStorage.getItem(legacyKey);
    if (!legacyStored) continue;
    try {
      const migrated = migrateLegacyTextureParameters(
        JSON.parse(legacyStored),
        legacyKey === LEGACY_WATER_SHADER_STORAGE_KEY,
      );
      if (migrated) {
        textureShader.setParameters(migrated);
        persistTextureParameters();
      }
      localStorage.removeItem(legacyKey);
      return;
    } catch {
      localStorage.removeItem(legacyKey);
    }
  }
}

function setRenderMode(
  mode: "canvas" | "enhanced" | "fallback",
  detail = "",
): void {
  document.documentElement.dataset.renderMode = mode;
  renderModeElement.dataset.mode = mode;
  renderModeElement.title = detail;
  if (mode === "enhanced") {
    renderModeElement.textContent = "渲染 WebGL2 动态纹理 + Canvas2D 底层";
  } else if (mode === "fallback") {
    renderModeElement.textContent = "渲染 Canvas2D（GPU 已降级）";
  } else {
    renderModeElement.textContent = "渲染 Canvas2D";
  }
}

function lockShaderToFallback(message: string): void {
  textureShader.setEnabled(false);
  renderer.setTextureShaderActive(false);
  textureShaderToggle.checked = false;
  textureShaderToggle.disabled = true;
  textureShaderToggle.title = message;
  textureParameterFields.disabled = true;
  textureParameterReset.disabled = true;
  setRenderMode("fallback", message);
}

function handleTextureShaderFailure(failure: TextureShaderFailure): void {
  lockShaderToFallback(failure.message);
}

function setTextureShaderEnabled(enabled: boolean): void {
  if (FORCE_SHADER_OFF) {
    textureShader.setEnabled(false);
    renderer.setTextureShaderActive(false);
    textureShaderToggle.checked = false;
    textureShaderToggle.disabled = true;
    textureShaderToggle.title = "自动化测试强制使用 Canvas2D 基线渲染。";
    textureParameterFields.disabled = true;
    textureParameterReset.disabled = true;
    setRenderMode("canvas", "通过 ?shader=off 强制关闭 WebGL2。Canvas2D 绘制完整静态纹理。");
    return;
  }

  const failure = textureShader.getFailure();
  if (failure) {
    lockShaderToFallback(failure.message);
    return;
  }

  const active = enabled && textureShader.available;
  textureShaderToggle.checked = active;
  renderer.setTextureShaderActive(active);
  textureShader.setEnabled(active);
  textureParameterFields.disabled = false;
  textureParameterReset.disabled = false;

  if (active) {
    setRenderMode(
      "enhanced",
      "WebGL2 负责完整动态纹理；Canvas2D 保留地形底层。GPU 故障时立即切换为完整 Canvas2D 静态纹理。",
    );
  } else {
    setRenderMode("canvas", "WebGL2 动态纹理已关闭；Canvas2D 绘制完整静态纹理。");
  }
}

textureShader.setFailureHandler(handleTextureShaderFailure);
restoreTextureParameters();
syncTextureParameterControls();

for (const control of textureControls) {
  control.input.addEventListener("input", () => {
    const value = Number(control.input.value);
    textureShader.setSlotParameters(control.slot, { [control.key]: value });
    const actual = textureShader.getSlotParameters(control.slot)[control.key];
    control.output.textContent = `${actual.toFixed(control.decimals)}${control.suffix}`;
    persistTextureParameters();
  });
}

textureParameterReset.addEventListener("click", () => {
  textureShader.resetParameters();
  localStorage.removeItem(TEXTURE_SHADER_STORAGE_KEY);
  syncTextureParameterControls();
});

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
  textureShader.draw(FIXED_SHADER_TIME ?? now / 1000, camera, chunkManager, renderer);

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

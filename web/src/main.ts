import "./style.css";
import { Camera } from "./camera";
import { ChunkManager } from "./chunk-manager";
import { Renderer, TERRAIN_NAMES, TEXTURE_SLOT_NAMES } from "./renderer";
import { TextureTool } from "./texture-tool";
import {
  GLOBAL_LIGHTING_PARAMETER_LIMITS,
  TEXTURE_SHADER_PARAMETER_LIMITS,
  TextureShaderRenderer,
  WATER_VISUAL_BASELINE_VERSION,
  type GlobalLightingParameters,
  type TextureShaderFailure,
  type TextureShaderParameterName,
  type TextureShaderParameters,
} from "./texture-shader";

const TEXTURE_SHADER_STORAGE_KEY = "baiyue-rpg:texture-shader-params:v2";
const GLOBAL_LIGHTING_STORAGE_KEY = "baiyue-rpg:global-lighting-params:v1";
const DEBUG_PANEL_STORAGE_KEY = "baiyue-rpg:debug-panel-collapsed:v1";
const LEGACY_TEXTURE_SHADER_STORAGE_KEY = "baiyue-rpg:texture-shader-params:v1";
const LEGACY_WATER_SHADER_STORAGE_KEY = "baiyue-rpg:water-shader-params:v1";
const DEBUG_EXPORT_SCHEMA = "baiyue-rpg.debug-render-config/v1";
const ZOOM_PRESETS = [0.5, 1, 2, 4] as const;
const TEXTURE_PARAMETER_KEYS = ["speed", "colorStrength", "colorFrequency"] as const satisfies readonly TextureShaderParameterName[];
const LIGHTING_PARAMETER_KEYS = [
  "exposure",
  "cloudDensity",
  "shadowStrength",
  "cloudScale",
  "softness",
  "detail",
  "windSpeed",
  "windDirection",
] as const satisfies readonly (keyof GlobalLightingParameters)[];

const TEXTURE_PARAMETER_META: Readonly<Record<TextureShaderParameterName, {
  label: string;
  step: number;
  decimals: number;
}>> = {
  speed: { label: "速度", step: 0.001, decimals: 3 },
  colorStrength: { label: "明暗", step: 0.001, decimals: 3 },
  colorFrequency: { label: "频率", step: 0.001, decimals: 3 },
};

const LIGHTING_PARAMETER_META: Readonly<Record<keyof GlobalLightingParameters, {
  label: string;
  step: number;
  decimals: number;
}>> = {
  exposure: { label: "曝光 EV", step: 0.05, decimals: 2 },
  cloudDensity: { label: "云密度", step: 0.01, decimals: 2 },
  shadowStrength: { label: "云影强度", step: 0.01, decimals: 2 },
  cloudScale: { label: "云尺度", step: 0.0001, decimals: 4 },
  softness: { label: "边缘柔度", step: 0.01, decimals: 2 },
  detail: { label: "云细节", step: 0.01, decimals: 2 },
  windSpeed: { label: "风速", step: 0.01, decimals: 2 },
  windDirection: { label: "风向 °", step: 1, decimals: 0 },
};

const queryParameters = new URLSearchParams(window.location.search);
const FORCE_SHADER_OFF = queryParameters.get("shader") === "off";
const LIGHTING_DIAGNOSTIC_MODE = queryParameters.get("lighting");
const LOCK_LIGHTING_PARAMETERS = LIGHTING_DIAGNOSTIC_MODE === "off" || LIGHTING_DIAGNOSTIC_MODE === "neutral";
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
const hud = requireElement<HTMLElement>("#hud");
const debugPanelCollapse = requireElement<HTMLButtonElement>("#debug-panel-collapse");
const debugExportButton = requireElement<HTMLButtonElement>("#debug-export");
const debugExportStatus = requireElement<HTMLElement>("#debug-export-status");
const seedInput = requireElement<HTMLInputElement>("#seed");
const applySeedButton = requireElement<HTMLButtonElement>("#apply-seed");
const gridToggle = requireElement<HTMLInputElement>("#grid-toggle");
const baseColorToggle = requireElement<HTMLInputElement>("#base-color-toggle");
const textureShaderToggle = requireElement<HTMLInputElement>("#texture-shader-toggle");
const textureParameterFields = requireElement<HTMLFieldSetElement>("#texture-parameter-fields");
const textureParameterTable = requireElement<HTMLElement>("#texture-parameter-table");
const textureParameterReset = requireElement<HTMLButtonElement>("#texture-parameter-reset");
const lightingParameterFields = requireElement<HTMLFieldSetElement>("#lighting-parameter-fields");
const lightingParameterGrid = requireElement<HTMLElement>("#lighting-parameter-grid");
const lightingParameterReset = requireElement<HTMLButtonElement>("#lighting-parameter-reset");
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
  range: HTMLInputElement;
  number: HTMLInputElement;
  decimals: number;
};

type LightingControlDefinition = {
  key: keyof GlobalLightingParameters;
  range: HTMLInputElement;
  number: HTMLInputElement;
  decimals: number;
};

function configureNumericInput(
  input: HTMLInputElement,
  minimum: number,
  maximum: number,
  step: number,
): void {
  input.min = String(minimum);
  input.max = String(maximum);
  input.step = String(step);
}

function buildTextureControls(): TextureControlDefinition[] {
  textureParameterTable.replaceChildren();
  const controls: TextureControlDefinition[] = [];

  const header = document.createElement("div");
  header.className = "parameter-table-header";
  for (const label of ["纹理", "速度", "明暗", "频率"]) {
    const span = document.createElement("span");
    span.textContent = label;
    header.append(span);
  }
  textureParameterTable.append(header);

  TEXTURE_SLOT_NAMES.forEach((slotName, slot) => {
    const row = document.createElement("div");
    row.className = "parameter-row";
    row.dataset.textureRow = String(slot);

    const name = document.createElement("span");
    name.className = "parameter-row-name";
    name.textContent = slotName;
    row.append(name);

    for (const key of TEXTURE_PARAMETER_KEYS) {
      const meta = TEXTURE_PARAMETER_META[key];
      const [minimum, maximum] = TEXTURE_SHADER_PARAMETER_LIMITS[key];
      const cell = document.createElement("label");
      cell.className = "parameter-control";
      cell.title = `${slotName} · ${meta.label}`;

      const range = document.createElement("input");
      range.id = `texture-slot-${slot}-${key}`;
      range.type = "range";
      range.dataset.textureSlot = String(slot);
      range.dataset.textureParameter = key;
      configureNumericInput(range, minimum, maximum, meta.step);
      range.setAttribute("aria-label", `${slotName} ${meta.label}`);

      const number = document.createElement("input");
      number.id = `${range.id}-number`;
      number.type = "number";
      number.inputMode = "decimal";
      configureNumericInput(number, minimum, maximum, meta.step);
      number.setAttribute("aria-label", `${slotName} ${meta.label}精确值`);

      cell.append(range, number);
      row.append(cell);
      controls.push({ slot, key, range, number, decimals: meta.decimals });
    }

    textureParameterTable.append(row);
  });

  return controls;
}

function buildLightingControls(): LightingControlDefinition[] {
  lightingParameterGrid.replaceChildren();
  const controls: LightingControlDefinition[] = [];

  for (const key of LIGHTING_PARAMETER_KEYS) {
    const meta = LIGHTING_PARAMETER_META[key];
    const [minimum, maximum] = GLOBAL_LIGHTING_PARAMETER_LIMITS[key];
    const label = document.createElement("label");
    label.className = "lighting-control";

    const name = document.createElement("span");
    name.textContent = meta.label;

    const range = document.createElement("input");
    range.id = `lighting-${key}`;
    range.type = "range";
    range.dataset.lightingParameter = key;
    configureNumericInput(range, minimum, maximum, meta.step);
    range.setAttribute("aria-label", meta.label);

    const number = document.createElement("input");
    number.id = `${range.id}-number`;
    number.type = "number";
    number.inputMode = "decimal";
    configureNumericInput(number, minimum, maximum, meta.step);
    number.setAttribute("aria-label", `${meta.label}精确值`);

    label.append(name, range, number);
    lightingParameterGrid.append(label);
    controls.push({ key, range, number, decimals: meta.decimals });
  }

  return controls;
}

const textureControls = buildTextureControls();
const lightingControls = buildLightingControls();

const expectedTextureControlCount = TEXTURE_SLOT_NAMES.length * TEXTURE_PARAMETER_KEYS.length;
if (textureControls.length !== expectedTextureControlCount) {
  throw new Error(`Expected ${expectedTextureControlCount} texture shader controls, found ${textureControls.length}.`);
}
if (lightingControls.length !== LIGHTING_PARAMETER_KEYS.length) {
  throw new Error(`Expected ${LIGHTING_PARAMETER_KEYS.length} lighting controls, found ${lightingControls.length}.`);
}

function syncNumericPair(range: HTMLInputElement, number: HTMLInputElement, value: number, decimals: number): void {
  range.value = String(value);
  number.value = value.toFixed(decimals);
}

function syncTextureParameterControls(): void {
  for (const control of textureControls) {
    const value = textureShader.getSlotParameters(control.slot)[control.key];
    syncNumericPair(control.range, control.number, value, control.decimals);
  }
}

function syncLightingParameterControls(): void {
  const parameters = textureShader.getLightingParameters();
  for (const control of lightingControls) {
    syncNumericPair(control.range, control.number, parameters[control.key], control.decimals);
  }
}

function getStoredValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storeValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Rendering remains functional if local storage is unavailable.
  }
}

function removeStoredValue(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore unavailable local storage.
  }
}

function persistTextureParameters(): void {
  storeValue(TEXTURE_SHADER_STORAGE_KEY, JSON.stringify(textureShader.getParameters()));
}

function persistLightingParameters(): void {
  if (LOCK_LIGHTING_PARAMETERS) return;
  storeValue(GLOBAL_LIGHTING_STORAGE_KEY, JSON.stringify(textureShader.getLightingParameters()));
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
  const stored = getStoredValue(TEXTURE_SHADER_STORAGE_KEY);
  if (stored) {
    try {
      textureShader.setParameters(JSON.parse(stored) as Partial<TextureShaderParameters>);
      return;
    } catch {
      removeStoredValue(TEXTURE_SHADER_STORAGE_KEY);
    }
  }

  for (const legacyKey of [LEGACY_TEXTURE_SHADER_STORAGE_KEY, LEGACY_WATER_SHADER_STORAGE_KEY]) {
    const legacyStored = getStoredValue(legacyKey);
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
      removeStoredValue(legacyKey);
      return;
    } catch {
      removeStoredValue(legacyKey);
    }
  }
}

function restoreLightingParameters(): void {
  if (LOCK_LIGHTING_PARAMETERS) return;
  const stored = getStoredValue(GLOBAL_LIGHTING_STORAGE_KEY);
  if (!stored) return;
  try {
    textureShader.setLightingParameters(JSON.parse(stored) as Partial<GlobalLightingParameters>);
  } catch {
    removeStoredValue(GLOBAL_LIGHTING_STORAGE_KEY);
  }
}

function setRenderMode(mode: "canvas" | "enhanced" | "fallback", detail = ""): void {
  document.documentElement.dataset.renderMode = mode;
  renderModeElement.dataset.mode = mode;
  renderModeElement.title = detail;
  if (mode === "enhanced") {
    renderModeElement.textContent = "WebGL2 + Lighting";
  } else if (mode === "fallback") {
    renderModeElement.textContent = "Canvas2D · fallback";
  } else {
    renderModeElement.textContent = "Canvas2D";
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
  lightingParameterFields.disabled = true;
  lightingParameterReset.disabled = true;
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
    lightingParameterFields.disabled = true;
    lightingParameterReset.disabled = true;
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
  lightingParameterFields.disabled = LOCK_LIGHTING_PARAMETERS;
  lightingParameterReset.disabled = LOCK_LIGHTING_PARAMETERS;

  if (active) {
    setRenderMode(
      "enhanced",
      "WebGL2 负责动态纹理、全局曝光与世界空间云影；GPU 故障时立即切换为完整 Canvas2D 静态纹理。",
    );
  } else {
    setRenderMode("canvas", "WebGL2 动态纹理与光照已关闭；Canvas2D 绘制完整静态纹理。");
  }
}

function applyTextureControl(control: TextureControlDefinition, value: number): void {
  if (!Number.isFinite(value)) {
    syncTextureParameterControls();
    return;
  }
  textureShader.setSlotParameters(control.slot, { [control.key]: value });
  const actual = textureShader.getSlotParameters(control.slot)[control.key];
  syncNumericPair(control.range, control.number, actual, control.decimals);
  persistTextureParameters();
}

function applyLightingControl(control: LightingControlDefinition, value: number): void {
  if (!Number.isFinite(value)) {
    syncLightingParameterControls();
    return;
  }
  textureShader.setLightingParameters({ [control.key]: value });
  const actual = textureShader.getLightingParameters()[control.key];
  syncNumericPair(control.range, control.number, actual, control.decimals);
  persistLightingParameters();
}

textureShader.setFailureHandler(handleTextureShaderFailure);
restoreTextureParameters();
restoreLightingParameters();
syncTextureParameterControls();
syncLightingParameterControls();

for (const control of textureControls) {
  control.range.addEventListener("input", () => applyTextureControl(control, Number(control.range.value)));
  control.number.addEventListener("change", () => applyTextureControl(control, Number(control.number.value)));
  control.number.addEventListener("keydown", (event) => {
    if (event.key === "Enter") control.number.blur();
  });
}

for (const control of lightingControls) {
  control.range.addEventListener("input", () => applyLightingControl(control, Number(control.range.value)));
  control.number.addEventListener("change", () => applyLightingControl(control, Number(control.number.value)));
  control.number.addEventListener("keydown", (event) => {
    if (event.key === "Enter") control.number.blur();
  });
}

textureParameterReset.addEventListener("click", () => {
  textureShader.resetParameters();
  removeStoredValue(TEXTURE_SHADER_STORAGE_KEY);
  syncTextureParameterControls();
});

lightingParameterReset.addEventListener("click", () => {
  textureShader.resetLightingParameters();
  removeStoredValue(GLOBAL_LIGHTING_STORAGE_KEY);
  syncLightingParameterControls();
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

function setDebugPanelCollapsed(collapsed: boolean): void {
  hud.classList.toggle("is-collapsed", collapsed);
  debugPanelCollapse.setAttribute("aria-expanded", String(!collapsed));
  debugPanelCollapse.textContent = collapsed ? "+" : "−";
  debugPanelCollapse.title = collapsed ? "展开 Debug 面板" : "收起 Debug 面板";
  storeValue(DEBUG_PANEL_STORAGE_KEY, collapsed ? "1" : "0");
}

function restoreDebugPanelState(): void {
  setDebugPanelCollapsed(getStoredValue(DEBUG_PANEL_STORAGE_KEY) === "1");
}

function buildDebugExportPayload(): object {
  const textureParameters = textureShader.getParameters();
  return {
    schema: DEBUG_EXPORT_SCHEMA,
    exportedAt: new Date().toISOString(),
    source: {
      page: window.location.origin + window.location.pathname,
      waterVisualBaseline: WATER_VISUAL_BASELINE_VERSION,
      lightingStage: textureCanvas.dataset.lightingStage ?? "unknown",
    },
    world: {
      seed: seedInput.value.trim(),
    },
    view: {
      cameraX: camera.x,
      cameraY: camera.y,
      zoom: camera.zoom,
      gridVisible: renderer.isGridVisible(),
      baseColorVisible: renderer.isBaseColorVisible(),
      textureShaderEnabled: textureShader.isEnabled(),
    },
    textureShader: {
      slots: TEXTURE_SLOT_NAMES.map((name, slot) => ({
        slot,
        name,
        ...(textureParameters.slots[slot] ?? {}),
      })),
    },
    globalLighting: textureShader.getLightingParameters(),
  };
}

function exportDebugParameters(): void {
  try {
    const json = `${JSON.stringify(buildDebugExportPayload(), null, 2)}\n`;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    anchor.href = url;
    anchor.download = `baiyue-rpg-debug-params-${timestamp}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    debugExportStatus.dataset.state = "ok";
    debugExportStatus.textContent = "JSON 已导出";
  } catch (error) {
    debugExportStatus.dataset.state = "error";
    debugExportStatus.textContent = `导出失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

for (const button of zoomPresetButtons) {
  button.addEventListener("click", () => {
    const zoom = Number(button.dataset.zoom);
    if (Number.isFinite(zoom)) setZoomPreset(zoom);
  });
}
syncZoomPresetButtons();
restoreDebugPanelState();

debugPanelCollapse.addEventListener("click", () => {
  setDebugPanelCollapsed(!hud.classList.contains("is-collapsed"));
});
debugExportButton.addEventListener("click", exportDebugParameters);
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

  if (event.code === "Backquote") {
    setDebugPanelCollapsed(!hud.classList.contains("is-collapsed"));
    return;
  }

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
      ? `WASM v${status.generatorVersion ?? "?"} · ${chunkManager.chunkSize}² macro`
      : "WASM 初始化中";
  positionElement.textContent = `tile ${centerTileX.toLocaleString()}, ${centerTileY.toLocaleString()} · macro ${macroX}, ${macroY} · ${biomeName}`;
  chunksElement.textContent = `${chunkManager.loadedCount} regions`;
  zoomElement.textContent = `${Math.round(camera.zoom * 100)}%`;
  syncZoomPresetButtons();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
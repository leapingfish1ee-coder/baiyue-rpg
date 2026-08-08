import "./lighting-lab.css";

type LabParameters = {
  exposure: number;
  cloudDensity: number;
  shadowStrength: number;
  cloudScale: number;
  softness: number;
  detail: number;
  windSpeed: number;
  windDirection: number;
};

type PresetName = "clear" | "scattered" | "dramatic";

const PRESETS: Record<PresetName, LabParameters> = {
  clear: {
    exposure: 0.45,
    cloudDensity: 0.15,
    shadowStrength: 0.28,
    cloudScale: 0.0045,
    softness: 0.16,
    detail: 0.25,
    windSpeed: 0.22,
    windDirection: 18,
  },
  scattered: {
    exposure: 0.65,
    cloudDensity: 0.58,
    shadowStrength: 0.52,
    cloudScale: 0.0065,
    softness: 0.12,
    detail: 0.42,
    windSpeed: 0.34,
    windDirection: 28,
  },
  dramatic: {
    exposure: 1.25,
    cloudDensity: 0.78,
    shadowStrength: 0.72,
    cloudScale: 0.0045,
    softness: 0.08,
    detail: 0.62,
    windSpeed: 0.48,
    windDirection: 42,
  },
};

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Lighting lab element is missing: ${selector}`);
  return element;
}

const canvas = requireElement<HTMLCanvasElement>("#lighting-canvas");
const statusElement = requireElement<HTMLElement>("#lab-status");
const compareToggle = requireElement<HTMLInputElement>("#compare");
const animateToggle = requireElement<HTMLInputElement>("#animate");

const controls = {
  exposure: requireElement<HTMLInputElement>("#exposure"),
  cloudDensity: requireElement<HTMLInputElement>("#cloud-density"),
  shadowStrength: requireElement<HTMLInputElement>("#shadow-strength"),
  cloudScale: requireElement<HTMLInputElement>("#cloud-scale"),
  softness: requireElement<HTMLInputElement>("#softness"),
  detail: requireElement<HTMLInputElement>("#detail"),
  windSpeed: requireElement<HTMLInputElement>("#wind-speed"),
  windDirection: requireElement<HTMLInputElement>("#wind-direction"),
};

const outputs = {
  exposure: requireElement<HTMLOutputElement>("#exposure-value"),
  cloudDensity: requireElement<HTMLOutputElement>("#cloud-density-value"),
  shadowStrength: requireElement<HTMLOutputElement>("#shadow-strength-value"),
  cloudScale: requireElement<HTMLOutputElement>("#cloud-scale-value"),
  softness: requireElement<HTMLOutputElement>("#softness-value"),
  detail: requireElement<HTMLOutputElement>("#detail-value"),
  windSpeed: requireElement<HTMLOutputElement>("#wind-speed-value"),
  windDirection: requireElement<HTMLOutputElement>("#wind-direction-value"),
};

const VERTEX_SHADER = `#version 300 es
precision highp float;

void main() {
  vec2 position;
  if (gl_VertexID == 0) position = vec2(-1.0, -1.0);
  else if (gl_VertexID == 1) position = vec2(3.0, -1.0);
  else position = vec2(-1.0, 3.0);
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 u_resolution;
uniform vec2 u_camera;
uniform float u_zoom;
uniform float u_time;
uniform float u_exposure;
uniform float u_cloudDensity;
uniform float u_shadowStrength;
uniform float u_cloudScale;
uniform float u_softness;
uniform float u_detail;
uniform float u_windSpeed;
uniform float u_windDirection;
uniform float u_compare;

out vec4 outColor;

const float TILE_PITCH = 18.0;
const float TILE_ART = 16.0;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec2 rotateA(vec2 p) {
  return vec2(
    p.x * 0.932327 - p.y * 0.361615,
    p.x * 0.361615 + p.y * 0.932327
  );
}

vec2 rotateB(vec2 p) {
  return vec2(
    p.x * 0.758362 + p.y * 0.651834,
   -p.x * 0.651834 + p.y * 0.758362
  );
}

vec2 rotateC(vec2 p) {
  return vec2(
    p.x * 0.453596 - p.y * 0.891207,
    p.x * 0.891207 + p.y * 0.453596
  );
}

float terrainFbm(vec2 p) {
  float a = valueNoise(rotateA(p) + vec2(11.7, -7.3));
  float b = valueNoise(rotateB(p * 2.03) + vec2(-17.1, 29.4));
  float c = valueNoise(rotateC(p * 4.11) + vec2(43.2, 9.8));
  return a * 0.56 + b * 0.29 + c * 0.15;
}

float cloudFbm(vec2 p) {
  float a = valueNoise(rotateA(p) + vec2(13.71, -8.43));
  float b = valueNoise(rotateB(p * 2.03) + vec2(-19.27, 31.61));
  float c = valueNoise(rotateC(p * 4.11) + vec2(47.13, 11.89));
  float d = valueNoise(rotateA(p * 7.87) + vec2(-63.9, -28.4));
  return a * 0.50 + b * 0.27 + c * 0.15 + d * 0.08;
}

vec3 basePalette(int terrain) {
  if (terrain == 0) return vec3(22.0, 63.0, 112.0) / 255.0;
  if (terrain == 1) return vec3(40.0, 103.0, 166.0) / 255.0;
  if (terrain == 2) return vec3(210.0, 190.0, 131.0) / 255.0;
  if (terrain == 3) return vec3(154.0, 126.0, 82.0) / 255.0;
  if (terrain == 4) return vec3(112.0, 113.0, 107.0) / 255.0;
  return vec3(229.0, 235.0, 238.0) / 255.0;
}

int classifyTerrain(float elevation) {
  if (elevation < 0.34) return 0;
  if (elevation < 0.42) return 1;
  if (elevation < 0.47) return 2;
  if (elevation > 0.80) return 5;
  if (elevation > 0.69) return 4;
  return 3;
}

vec3 materialAt(vec2 world, float timeValue) {
  vec2 tile = floor(world / TILE_PITCH);
  vec2 cell = fract(world / TILE_PITCH) * TILE_PITCH;
  if (cell.x >= TILE_ART || cell.y >= TILE_ART) return vec3(0.0);

  vec2 texel = floor(cell / TILE_ART * 8.0);
  float elevation = terrainFbm(tile * 0.036 + vec2(-4.0, 7.0));
  float moisture = terrainFbm(tile * 0.051 + vec2(91.0, -37.0));
  int terrain = classifyTerrain(elevation);
  vec3 fullColor = basePalette(terrain);
  vec3 baseColor = fullColor * 0.42;

  float grain = hash12(tile * 23.17 + texel * vec2(7.13, 11.91));
  float threshold = terrain == 4 ? 0.52 : terrain == 5 ? 0.68 : terrain == 3 ? 0.73 : 0.78;
  float textureMask = step(threshold, grain);
  vec3 material = mix(baseColor, fullColor, textureMask * 0.76);

  if (terrain <= 1) {
    float waterMotion = cloudFbm(world * 0.016 + vec2(timeValue * 0.10, -timeValue * 0.035));
    material *= 0.91 + waterMotion * 0.16;
  }

  if (terrain == 3) {
    float vegetationSeed = hash12(tile * 5.31 + vec2(17.0, 29.0));
    float groveSeed = terrainFbm(tile * 0.13 + vec2(-18.0, 71.0));
    float localMark = hash12(texel * 9.71 + tile * 0.37);

    if (moisture > 0.50 && vegetationSeed > 0.54 && localMark > 0.74) {
      vec3 grass = vec3(105.0, 158.0, 86.0) / 255.0;
      material = mix(material, grass, 0.92);
    }
    if (moisture > 0.58 && groveSeed > 0.62) {
      vec2 center = texel - vec2(3.5);
      float groveShape = step(dot(center, center), 7.0);
      if (groveShape > 0.5 && localMark > 0.28) {
        vec3 grove = vec3(47.0, 105.0, 65.0) / 255.0;
        material = mix(material, grove, 0.96);
      }
    }
  }

  return clamp(material, 0.0, 0.96);
}

float cloudDensityAt(vec2 world, float timeValue) {
  float angle = radians(u_windDirection);
  vec2 wind = vec2(cos(angle), sin(angle));
  vec2 p = world * (u_cloudScale * 0.35) + wind * timeValue * u_windSpeed * 0.075;

  float broad = cloudFbm(p);
  float detail = cloudFbm(p * 2.83 + vec2(37.1, -21.7));
  float field = mix(broad, broad * 0.72 + detail * 0.28, u_detail);
  float threshold = mix(0.83, 0.31, u_cloudDensity);
  float cloud = smoothstep(threshold - u_softness, threshold + u_softness, field);
  cloud *= smoothstep(0.0, 0.08, u_cloudDensity);
  return clamp(cloud, 0.0, 1.0);
}

vec3 applyLighting(vec3 material, float transmission) {
  // Reversible Reinhard lift: EV=0 and transmission=1 preserve the input.
  vec3 linearColor = pow(material, vec3(2.2));
  vec3 sceneHdr = linearColor / max(vec3(0.0001), vec3(1.0) - linearColor);
  sceneHdr *= exp2(u_exposure) * transmission;
  vec3 mapped = sceneHdr / (vec3(1.0) + sceneHdr);
  return pow(clamp(mapped, 0.0, 1.0), vec3(1.0 / 2.2));
}

void main() {
  vec2 centered = gl_FragCoord.xy - u_resolution * 0.5;
  vec2 world = centered / u_zoom + u_camera;
  vec3 material = materialAt(world, u_time);
  float cloud = cloudDensityAt(world, u_time);
  float transmission = 1.0 - cloud * u_shadowStrength;
  vec3 lit = applyLighting(material, transmission);

  bool compareMode = u_compare > 0.5;
  bool baselineSide = compareMode && gl_FragCoord.x < u_resolution.x * 0.5;
  vec3 finalColor = baselineSide ? material : lit;

  if (compareMode && abs(gl_FragCoord.x - u_resolution.x * 0.5) < 1.25) {
    finalColor = mix(finalColor, vec3(0.92), 0.65);
  }

  outColor = vec4(finalColor, 1.0);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("无法创建 WebGL2 shader。");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "未知 GLSL 编译错误";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("无法创建 WebGL2 program。");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) ?? "未知 WebGL2 link 错误";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function readParameters(): LabParameters {
  return {
    exposure: Number(controls.exposure.value),
    cloudDensity: Number(controls.cloudDensity.value),
    shadowStrength: Number(controls.shadowStrength.value),
    cloudScale: Number(controls.cloudScale.value),
    softness: Number(controls.softness.value),
    detail: Number(controls.detail.value),
    windSpeed: Number(controls.windSpeed.value),
    windDirection: Number(controls.windDirection.value),
  };
}

function syncOutputs(): void {
  const p = readParameters();
  outputs.exposure.textContent = `${p.exposure >= 0 ? "+" : ""}${p.exposure.toFixed(2)}`;
  outputs.cloudDensity.textContent = p.cloudDensity.toFixed(2);
  outputs.shadowStrength.textContent = p.shadowStrength.toFixed(2);
  outputs.cloudScale.textContent = p.cloudScale.toFixed(4);
  outputs.softness.textContent = p.softness.toFixed(2);
  outputs.detail.textContent = p.detail.toFixed(2);
  outputs.windSpeed.textContent = p.windSpeed.toFixed(2);
  outputs.windDirection.textContent = `${Math.round(p.windDirection)}°`;
}

function applyPreset(name: PresetName): void {
  const preset = PRESETS[name];
  for (const key of Object.keys(preset) as (keyof LabParameters)[]) {
    controls[key].value = String(preset[key]);
  }
  syncOutputs();
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
    button.classList.toggle("is-active", button.dataset.preset === name);
  }
}

for (const input of Object.values(controls)) {
  input.addEventListener("input", () => {
    syncOutputs();
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
      button.classList.remove("is-active");
    }
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-preset]")) {
  button.addEventListener("click", () => {
    const preset = button.dataset.preset;
    if (preset === "clear" || preset === "scattered" || preset === "dramatic") applyPreset(preset);
  });
}

syncOutputs();

const gl = canvas.getContext("webgl2", {
  alpha: false,
  antialias: false,
  premultipliedAlpha: false,
  powerPreference: "default",
});

if (!gl) {
  document.documentElement.dataset.labStatus = "unavailable";
  statusElement.textContent = "无法创建 WebGL2。这个实验页需要 WebGL2 才能运行；主地图不受影响。";
} else {
  try {
    const program = createProgram(gl);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error("无法创建 WebGL2 VAO。");
    gl.bindVertexArray(vao);
    gl.useProgram(program);

    const uniform = (name: string): WebGLUniformLocation => {
      const location = gl.getUniformLocation(program, name);
      if (location === null) throw new Error(`缺少 shader uniform: ${name}`);
      return location;
    };

    const uniforms = {
      resolution: uniform("u_resolution"),
      camera: uniform("u_camera"),
      zoom: uniform("u_zoom"),
      time: uniform("u_time"),
      exposure: uniform("u_exposure"),
      cloudDensity: uniform("u_cloudDensity"),
      shadowStrength: uniform("u_shadowStrength"),
      cloudScale: uniform("u_cloudScale"),
      softness: uniform("u_softness"),
      detail: uniform("u_detail"),
      windSpeed: uniform("u_windSpeed"),
      windDirection: uniform("u_windDirection"),
      compare: uniform("u_compare"),
    };

    let cssWidth = 1;
    let cssHeight = 1;
    let cameraX = 0;
    let cameraY = 0;
    let zoom = 1;
    let dragging = false;
    let pointerId: number | null = null;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let accumulatedTime = 0;
    let lastFrameTime = performance.now();

    function resize(): void {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cssWidth = Math.max(1, canvas.clientWidth);
      cssHeight = Math.max(1, canvas.clientHeight);
      const width = Math.max(1, Math.round(cssWidth * dpr));
      const height = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
    }

    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      dragging = true;
      pointerId = event.pointerId;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("dragging");
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!dragging || event.pointerId !== pointerId) return;
      const dx = event.clientX - lastPointerX;
      const dy = event.clientY - lastPointerY;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      cameraX -= dx / zoom;
      cameraY += dy / zoom;
    });

    const endDrag = (event: PointerEvent): void => {
      if (event.pointerId !== pointerId) return;
      dragging = false;
      pointerId = null;
      canvas.classList.remove("dragging");
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const nextZoom = zoom * Math.exp(-event.deltaY * 0.0012);
      zoom = Math.min(4, Math.max(0.35, nextZoom));
    }, { passive: false });

    window.addEventListener("resize", resize);
    resize();

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);

    document.documentElement.dataset.labStatus = "ready";
    statusElement.textContent = "WebGL2 Lighting Stage 已运行 · 当前页只用于视觉验证";

    function frame(now: number): void {
      const deltaSeconds = Math.min((now - lastFrameTime) / 1000, 0.05);
      lastFrameTime = now;
      if (animateToggle.checked) accumulatedTime += deltaSeconds;
      resize();

      const p = readParameters();
      gl.useProgram(program);
      gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      gl.uniform2f(uniforms.camera, cameraX, cameraY);
      gl.uniform1f(uniforms.zoom, zoom * (canvas.width / Math.max(1, cssWidth)));
      gl.uniform1f(uniforms.time, accumulatedTime);
      gl.uniform1f(uniforms.exposure, p.exposure);
      gl.uniform1f(uniforms.cloudDensity, p.cloudDensity);
      gl.uniform1f(uniforms.shadowStrength, p.shadowStrength);
      gl.uniform1f(uniforms.cloudScale, p.cloudScale);
      gl.uniform1f(uniforms.softness, p.softness);
      gl.uniform1f(uniforms.detail, p.detail);
      gl.uniform1f(uniforms.windSpeed, p.windSpeed);
      gl.uniform1f(uniforms.windDirection, p.windDirection);
      gl.uniform1f(uniforms.compare, compareToggle.checked ? 1 : 0);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  } catch (error) {
    console.error("Lighting lab initialization failed", error);
    document.documentElement.dataset.labStatus = "failed";
    statusElement.textContent = `Lighting Lab 初始化失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

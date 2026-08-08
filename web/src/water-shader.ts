import type { Camera } from "./camera";
import type { ChunkManager } from "./chunk-manager";
import {
  TERRAIN_BASE_COLORS,
  TERRAIN_COLORS,
  type Renderer,
} from "./renderer";

export interface WaterShaderParameters {
  deepSpeed: number;
  shallowSpeed: number;
  deepColorStrength: number;
  shallowColorStrength: number;
  colorFrequency: number;
}

export const DEFAULT_WATER_SHADER_PARAMETERS: Readonly<WaterShaderParameters> = Object.freeze({
  deepSpeed: 0.18,
  shallowSpeed: 0.30,
  deepColorStrength: 0.15,
  shallowColorStrength: 0.22,
  colorFrequency: 0.045,
});

const PARAMETER_LIMITS: Record<keyof WaterShaderParameters, readonly [number, number]> = {
  deepSpeed: [0.02, 0.8],
  shallowSpeed: [0.02, 1.0],
  deepColorStrength: [0, 0.6],
  shallowColorStrength: [0, 0.6],
  colorFrequency: [0.005, 0.15],
};

const VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_worldTile;
layout(location = 1) in float a_terrain;

uniform vec2 u_camera;
uniform vec2 u_viewport;
uniform float u_zoom;
uniform float u_tilePixels;
uniform float u_tileArtPixels;

out vec2 v_uv;
flat out vec2 v_worldTile;
flat out int v_terrain;

vec2 cornerForVertex(int id) {
  if (id == 0) return vec2(0.0, 0.0);
  if (id == 1) return vec2(1.0, 0.0);
  if (id == 2) return vec2(0.0, 1.0);
  if (id == 3) return vec2(0.0, 1.0);
  if (id == 4) return vec2(1.0, 0.0);
  return vec2(1.0, 1.0);
}

void main() {
  vec2 corner = cornerForVertex(gl_VertexID);
  vec2 worldPixel = a_worldTile * u_tilePixels + corner * u_tileArtPixels;
  vec2 screen = (worldPixel - u_camera) * u_zoom + u_viewport * 0.5;
  vec2 clip = vec2(
    screen.x / u_viewport.x * 2.0 - 1.0,
    1.0 - screen.y / u_viewport.y * 2.0
  );

  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = corner;
  v_worldTile = a_worldTile;
  v_terrain = int(a_terrain + 0.5);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

in vec2 v_uv;
flat in vec2 v_worldTile;
flat in int v_terrain;

uniform float u_time;
uniform sampler2D u_deepTexture;
uniform sampler2D u_shallowTexture;
uniform vec3 u_deepBase;
uniform vec3 u_shallowBase;
uniform vec3 u_deepColor;
uniform vec3 u_shallowColor;
uniform float u_deepSpeed;
uniform float u_shallowSpeed;
uniform float u_deepColorStrength;
uniform float u_shallowColorStrength;
uniform float u_colorFrequency;
uniform float u_baseEnabled;

out vec4 outColor;

const int TILE_SIZE = 8;

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

float waterColorNoise(vec2 p, float timeValue) {
  vec2 flow = vec2(timeValue, -timeValue * 0.35);

  float octave1 = valueNoise(
    rotateA(p + flow) + vec2(13.71, -8.43)
  );
  float octave2 = valueNoise(
    rotateB(p * 2.03 + flow * 1.17) + vec2(-19.27, 31.61)
  );
  float octave3 = valueNoise(
    rotateC(p * 4.11 + flow * 0.83) + vec2(47.13, 11.89)
  );

  return octave1 * 0.56 + octave2 * 0.29 + octave3 * 0.15;
}

void main() {
  bool deep = v_terrain == 0;
  float speed = deep ? u_deepSpeed : u_shallowSpeed;
  float colorStrength = deep ? u_deepColorStrength : u_shallowColorStrength;

  vec2 localFloat = clamp(floor(v_uv * float(TILE_SIZE)), vec2(0.0), vec2(7.0));
  ivec2 localTexel = ivec2(localFloat);
  vec2 worldTexel = v_worldTile * float(TILE_SIZE) + localFloat;

  vec4 textureSample = deep
    ? texelFetch(u_deepTexture, localTexel, 0)
    : texelFetch(u_shallowTexture, localTexel, 0);

  float colorNoise = waterColorNoise(
    worldTexel * u_colorFrequency,
    u_time * speed
  );
  float brightness = 1.0 + (colorNoise * 2.0 - 1.0) * colorStrength;
  vec3 textureColor = textureSample.rgb * brightness;
  float textureAlpha = textureSample.a;

  if (u_baseEnabled < 0.5) {
    outColor = vec4(textureColor, textureAlpha * 0.94);
    return;
  }

  vec3 baseColor = deep ? u_deepBase : u_shallowBase;
  vec3 fullColor = deep ? u_deepColor : u_shallowColor;
  vec3 ambientColor = mix(baseColor * 1.05, fullColor * 0.52, colorNoise);
  vec3 overlayColor = mix(ambientColor, textureColor, textureAlpha);
  float ambientAlpha = deep ? 0.16 : 0.20;
  float overlayAlpha = mix(ambientAlpha + colorNoise * 0.07, 0.94, textureAlpha);

  outColor = vec4(overlayColor, overlayAlpha);
}
`;

export class WaterShaderRenderer {
  private readonly gl: WebGL2RenderingContext | null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private deepTexture: WebGLTexture | null = null;
  private shallowTexture: WebGLTexture | null = null;
  private enabled = false;
  private uploadedTextureRevision = -1;
  private cssWidth = 1;
  private cssHeight = 1;
  private parameters: WaterShaderParameters = { ...DEFAULT_WATER_SHADER_PARAMETERS };

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
    });
    this.gl = gl;

    if (!gl) {
      this.canvas.hidden = true;
      return;
    }

    try {
      this.program = this.createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
      this.vao = gl.createVertexArray();
      this.instanceBuffer = gl.createBuffer();
      this.deepTexture = this.createTexture(gl);
      this.shallowTexture = this.createTexture(gl);
      if (!this.vao || !this.instanceBuffer || !this.deepTexture || !this.shallowTexture) {
        throw new Error("Unable to allocate WebGL2 water shader resources.");
      }

      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 12, 0);
      gl.vertexAttribDivisor(0, 1);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 12, 8);
      gl.vertexAttribDivisor(1, 1);
      gl.bindVertexArray(null);

      gl.useProgram(this.program);
      gl.uniform1i(gl.getUniformLocation(this.program, "u_deepTexture"), 0);
      gl.uniform1i(gl.getUniformLocation(this.program, "u_shallowTexture"), 1);
      this.setColorUniform(gl, this.program, "u_deepBase", TERRAIN_BASE_COLORS[0]);
      this.setColorUniform(gl, this.program, "u_shallowBase", TERRAIN_BASE_COLORS[1]);
      this.setColorUniform(gl, this.program, "u_deepColor", TERRAIN_COLORS[0]);
      this.setColorUniform(gl, this.program, "u_shallowColor", TERRAIN_COLORS[1]);

      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
    } catch (error) {
      console.error("Water shader initialization failed", error);
      this.program = null;
      this.vao = null;
      this.instanceBuffer = null;
      this.deepTexture = null;
      this.shallowTexture = null;
      this.canvas.hidden = true;
    }
  }

  get available(): boolean {
    return Boolean(
      this.gl &&
      this.program &&
      this.vao &&
      this.instanceBuffer &&
      this.deepTexture &&
      this.shallowTexture,
    );
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled && this.available;
    this.canvas.hidden = !this.enabled;
    if (!this.enabled) this.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getParameters(): WaterShaderParameters {
    return { ...this.parameters };
  }

  setParameters(next: Partial<WaterShaderParameters>): void {
    const updated = { ...this.parameters };
    for (const key of Object.keys(DEFAULT_WATER_SHADER_PARAMETERS) as (keyof WaterShaderParameters)[]) {
      const value = next[key];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const [minimum, maximum] = PARAMETER_LIMITS[key];
      updated[key] = Math.min(maximum, Math.max(minimum, value));
    }
    this.parameters = updated;
  }

  resetParameters(): void {
    this.parameters = { ...DEFAULT_WATER_SHADER_PARAMETERS };
  }

  resize(width: number, height: number, dpr: number): void {
    this.cssWidth = Math.max(1, width);
    this.cssHeight = Math.max(1, height);
    const targetWidth = Math.max(1, Math.round(this.cssWidth * dpr));
    const targetHeight = Math.max(1, Math.round(this.cssHeight * dpr));
    if (this.canvas.width !== targetWidth || this.canvas.height !== targetHeight) {
      this.canvas.width = targetWidth;
      this.canvas.height = targetHeight;
    }
    this.gl?.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(timeSeconds: number, camera: Camera, chunks: ChunkManager, renderer: Renderer): void {
    const gl = this.gl;
    const program = this.program;
    if (!this.enabled || !gl || !program || !this.vao || !this.instanceBuffer) return;

    gl.clear(gl.COLOR_BUFFER_BIT);
    this.syncTextures(renderer);

    const instances = this.collectVisibleWater(camera, chunks, renderer.tilePixels);
    const instanceCount = instances.length / 3;
    if (instanceCount === 0) return;

    gl.useProgram(program);
    gl.uniform2f(gl.getUniformLocation(program, "u_camera"), camera.x, camera.y);
    gl.uniform2f(gl.getUniformLocation(program, "u_viewport"), this.cssWidth, this.cssHeight);
    gl.uniform1f(gl.getUniformLocation(program, "u_zoom"), camera.zoom);
    gl.uniform1f(gl.getUniformLocation(program, "u_tilePixels"), renderer.tilePixels);
    gl.uniform1f(gl.getUniformLocation(program, "u_tileArtPixels"), renderer.tileArtPixels);
    gl.uniform1f(gl.getUniformLocation(program, "u_time"), timeSeconds);
    gl.uniform1f(gl.getUniformLocation(program, "u_deepSpeed"), this.parameters.deepSpeed);
    gl.uniform1f(gl.getUniformLocation(program, "u_shallowSpeed"), this.parameters.shallowSpeed);
    gl.uniform1f(gl.getUniformLocation(program, "u_deepColorStrength"), this.parameters.deepColorStrength);
    gl.uniform1f(gl.getUniformLocation(program, "u_shallowColorStrength"), this.parameters.shallowColorStrength);
    gl.uniform1f(gl.getUniformLocation(program, "u_colorFrequency"), this.parameters.colorFrequency);
    gl.uniform1f(gl.getUniformLocation(program, "u_baseEnabled"), renderer.isBaseColorVisible() ? 1 : 0);

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instances, gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCount);
    gl.bindVertexArray(null);
  }

  private collectVisibleWater(camera: Camera, chunks: ChunkManager, tilePixels: number): Float32Array {
    const halfWidth = this.cssWidth / (2 * camera.zoom);
    const halfHeight = this.cssHeight / (2 * camera.zoom);
    const minTileX = Math.floor((camera.x - halfWidth) / tilePixels) - 1;
    const maxTileX = Math.ceil((camera.x + halfWidth) / tilePixels) + 1;
    const minTileY = Math.floor((camera.y - halfHeight) / tilePixels) - 1;
    const maxTileY = Math.ceil((camera.y + halfHeight) / tilePixels) + 1;
    const values: number[] = [];

    for (const chunk of chunks.getChunks()) {
      const baseX = chunk.x * chunks.chunkSize;
      const baseY = chunk.y * chunks.chunkSize;
      const localMinX = Math.max(0, minTileX - baseX);
      const localMaxX = Math.min(chunks.chunkSize - 1, maxTileX - baseX);
      const localMinY = Math.max(0, minTileY - baseY);
      const localMaxY = Math.min(chunks.chunkSize - 1, maxTileY - baseY);
      if (localMinX > localMaxX || localMinY > localMaxY) continue;

      for (let localY = localMinY; localY <= localMaxY; localY += 1) {
        const rowOffset = localY * chunks.chunkSize;
        for (let localX = localMinX; localX <= localMaxX; localX += 1) {
          const terrainId = chunk.tiles[rowOffset + localX] ?? 255;
          if (terrainId !== 0 && terrainId !== 1) continue;
          values.push(baseX + localX, baseY + localY, terrainId);
        }
      }
    }

    return new Float32Array(values);
  }

  private syncTextures(renderer: Renderer): void {
    const gl = this.gl;
    if (!gl || !this.deepTexture || !this.shallowTexture) return;
    const revision = renderer.getTextureRevision();
    if (revision === this.uploadedTextureRevision) return;

    const sprites = renderer.getTerrainSprites();
    const deep = sprites[0];
    const shallow = sprites[1];
    if (deep) this.uploadTexture(gl, this.deepTexture, 0, deep);
    if (shallow) this.uploadTexture(gl, this.shallowTexture, 1, shallow);
    this.uploadedTextureRevision = revision;
  }

  private uploadTexture(
    gl: WebGL2RenderingContext,
    texture: WebGLTexture,
    unit: number,
    source: HTMLCanvasElement,
  ): void {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  private createTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
    const texture = gl.createTexture();
    if (!texture) return null;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private clear(): void {
    const gl = this.gl;
    if (!gl) return;
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private createProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string): WebGLProgram {
    const vertex = this.compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = this.compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error("Unable to create WebGL2 program.");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) ?? "Unknown WebGL2 program link error.";
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  private compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Unable to create WebGL2 shader.");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) ?? "Unknown WebGL2 shader compile error.";
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  private setColorUniform(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    name: string,
    color: readonly [number, number, number] | undefined,
  ): void {
    if (!color) return;
    gl.uniform3f(
      gl.getUniformLocation(program, name),
      color[0] / 255,
      color[1] / 255,
      color[2] / 255,
    );
  }
}

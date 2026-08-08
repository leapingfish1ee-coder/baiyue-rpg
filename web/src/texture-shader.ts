import type { Camera } from "./camera";
import type { ChunkManager } from "./chunk-manager";
import {
  BASE_TERRAIN_COUNT,
  SOURCE_TILE_PIXELS,
  TERRAIN_BASE_COLORS,
  TERRAIN_COLORS,
  TEXTURE_SLOT_NAMES,
  type Renderer,
} from "./renderer";

export interface TextureShaderParameters {
  deepSpeed: number;
  shallowSpeed: number;
  deepColorStrength: number;
  shallowColorStrength: number;
  surfaceSpeed: number;
  surfaceColorStrength: number;
  decorationSpeed: number;
  decorationColorStrength: number;
  colorFrequency: number;
}

export const DEFAULT_TEXTURE_SHADER_PARAMETERS: Readonly<TextureShaderParameters> = Object.freeze({
  deepSpeed: 0.18,
  shallowSpeed: 0.30,
  deepColorStrength: 0.15,
  shallowColorStrength: 0.22,
  surfaceSpeed: 0.08,
  surfaceColorStrength: 0.08,
  decorationSpeed: 0.10,
  decorationColorStrength: 0.10,
  colorFrequency: 0.045,
});

const PARAMETER_LIMITS: Record<keyof TextureShaderParameters, readonly [number, number]> = {
  deepSpeed: [0.02, 0.8],
  shallowSpeed: [0.02, 1.0],
  deepColorStrength: [0, 0.6],
  shallowColorStrength: [0, 0.6],
  surfaceSpeed: [0.01, 0.5],
  surfaceColorStrength: [0, 0.35],
  decorationSpeed: [0.01, 0.6],
  decorationColorStrength: [0, 0.4],
  colorFrequency: [0.005, 0.15],
};

const SLOT_COUNT = TEXTURE_SLOT_NAMES.length;

const VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_worldTile;
layout(location = 1) in float a_slot;

uniform vec2 u_camera;
uniform vec2 u_viewport;
uniform float u_zoom;
uniform float u_tilePixels;
uniform float u_tileArtPixels;

out vec2 v_uv;
flat out vec2 v_worldTile;
flat out int v_slot;

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
  v_slot = int(a_slot + 0.5);
}
`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
precision highp int;

in vec2 v_uv;
flat in vec2 v_worldTile;
flat in int v_slot;

uniform float u_time;
uniform sampler2DArray u_textureAtlas;
uniform vec3 u_deepBase;
uniform vec3 u_shallowBase;
uniform vec3 u_deepColor;
uniform vec3 u_shallowColor;
uniform float u_speed[8];
uniform float u_colorStrength[8];
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

float textureColorNoise(vec2 p, float timeValue) {
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
  vec2 localFloat = clamp(floor(v_uv * float(TILE_SIZE)), vec2(0.0), vec2(7.0));
  ivec2 localTexel = ivec2(localFloat);
  vec2 worldTexel = v_worldTile * float(TILE_SIZE) + localFloat;
  vec4 textureSample = texelFetch(u_textureAtlas, ivec3(localTexel, v_slot), 0);
  float textureAlpha = textureSample.a;
  bool water = v_slot == 0 || v_slot == 1;

  if (!water && textureAlpha < 0.001) discard;
  if (water && u_baseEnabled < 0.5 && textureAlpha < 0.001) discard;

  float colorNoise = textureColorNoise(
    worldTexel * u_colorFrequency,
    u_time * u_speed[v_slot]
  );
  float brightness = 1.0 + (colorNoise * 2.0 - 1.0) * u_colorStrength[v_slot];
  vec3 textureColor = textureSample.rgb * brightness;

  if (!water || u_baseEnabled < 0.5) {
    outColor = vec4(textureColor, textureAlpha * 0.94);
    return;
  }

  bool deep = v_slot == 0;
  vec3 baseColor = deep ? u_deepBase : u_shallowBase;
  vec3 fullColor = deep ? u_deepColor : u_shallowColor;
  vec3 ambientColor = mix(baseColor * 1.05, fullColor * 0.52, colorNoise);
  vec3 overlayColor = mix(ambientColor, textureColor, textureAlpha);
  float ambientAlpha = deep ? 0.16 : 0.20;
  float overlayAlpha = mix(ambientAlpha + colorNoise * 0.07, 0.94, textureAlpha);

  outColor = vec4(overlayColor, overlayAlpha);
}
`;

type VisibleInstances = {
  base: Float32Array;
  decorations: Float32Array;
};

export class TextureShaderRenderer {
  private readonly gl: WebGL2RenderingContext | null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private instanceBuffer: WebGLBuffer | null = null;
  private textureAtlas: WebGLTexture | null = null;
  private enabled = false;
  private uploadedTextureRevision = -1;
  private cssWidth = 1;
  private cssHeight = 1;
  private parameters: TextureShaderParameters = { ...DEFAULT_TEXTURE_SHADER_PARAMETERS };

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
      this.textureAtlas = this.createTextureAtlas(gl);
      if (!this.vao || !this.instanceBuffer || !this.textureAtlas) {
        throw new Error("Unable to allocate WebGL2 texture shader resources.");
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
      gl.uniform1i(gl.getUniformLocation(this.program, "u_textureAtlas"), 0);
      this.setColorUniform(gl, this.program, "u_deepBase", TERRAIN_BASE_COLORS[0]);
      this.setColorUniform(gl, this.program, "u_shallowBase", TERRAIN_BASE_COLORS[1]);
      this.setColorUniform(gl, this.program, "u_deepColor", TERRAIN_COLORS[0]);
      this.setColorUniform(gl, this.program, "u_shallowColor", TERRAIN_COLORS[1]);

      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
    } catch (error) {
      console.error("Texture shader initialization failed", error);
      this.program = null;
      this.vao = null;
      this.instanceBuffer = null;
      this.textureAtlas = null;
      this.canvas.hidden = true;
    }
  }

  get available(): boolean {
    return Boolean(this.gl && this.program && this.vao && this.instanceBuffer && this.textureAtlas);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled && this.available;
    this.canvas.hidden = !this.enabled;
    if (!this.enabled) this.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getParameters(): TextureShaderParameters {
    return { ...this.parameters };
  }

  setParameters(next: Partial<TextureShaderParameters>): void {
    const updated = { ...this.parameters };
    for (const key of Object.keys(DEFAULT_TEXTURE_SHADER_PARAMETERS) as (keyof TextureShaderParameters)[]) {
      const value = next[key];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const [minimum, maximum] = PARAMETER_LIMITS[key];
      updated[key] = Math.min(maximum, Math.max(minimum, value));
    }
    this.parameters = updated;
  }

  resetParameters(): void {
    this.parameters = { ...DEFAULT_TEXTURE_SHADER_PARAMETERS };
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
    if (!this.enabled || !gl || !program || !this.vao || !this.instanceBuffer || !this.textureAtlas) return;

    gl.clear(gl.COLOR_BUFFER_BIT);
    this.syncTextures(renderer);

    const instances = this.collectVisibleInstances(camera, chunks, renderer.tilePixels);
    if (instances.base.length === 0 && instances.decorations.length === 0) return;

    gl.useProgram(program);
    gl.uniform2f(gl.getUniformLocation(program, "u_camera"), camera.x, camera.y);
    gl.uniform2f(gl.getUniformLocation(program, "u_viewport"), this.cssWidth, this.cssHeight);
    gl.uniform1f(gl.getUniformLocation(program, "u_zoom"), camera.zoom);
    gl.uniform1f(gl.getUniformLocation(program, "u_tilePixels"), renderer.tilePixels);
    gl.uniform1f(gl.getUniformLocation(program, "u_tileArtPixels"), renderer.tileArtPixels);
    gl.uniform1f(gl.getUniformLocation(program, "u_time"), timeSeconds);
    gl.uniform1fv(gl.getUniformLocation(program, "u_speed[0]"), this.slotSpeeds());
    gl.uniform1fv(gl.getUniformLocation(program, "u_colorStrength[0]"), this.slotColorStrengths());
    gl.uniform1f(gl.getUniformLocation(program, "u_colorFrequency"), this.parameters.colorFrequency);
    gl.uniform1f(gl.getUniformLocation(program, "u_baseEnabled"), renderer.isBaseColorVisible() ? 1 : 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textureAtlas);
    gl.bindVertexArray(this.vao);
    this.drawInstances(gl, instances.base);
    this.drawInstances(gl, instances.decorations);
    gl.bindVertexArray(null);
  }

  private slotSpeeds(): Float32Array {
    const p = this.parameters;
    return new Float32Array([
      p.deepSpeed,
      p.shallowSpeed,
      p.surfaceSpeed * 0.65,
      p.surfaceSpeed,
      p.surfaceSpeed * 0.25,
      p.surfaceSpeed * 0.55,
      p.decorationSpeed * 1.10,
      p.decorationSpeed * 0.75,
    ]);
  }

  private slotColorStrengths(): Float32Array {
    const p = this.parameters;
    return new Float32Array([
      p.deepColorStrength,
      p.shallowColorStrength,
      p.surfaceColorStrength * 0.75,
      p.surfaceColorStrength,
      p.surfaceColorStrength * 0.45,
      p.surfaceColorStrength * 0.85,
      p.decorationColorStrength,
      p.decorationColorStrength * 0.80,
    ]);
  }

  private collectVisibleInstances(camera: Camera, chunks: ChunkManager, tilePixels: number): VisibleInstances {
    const halfWidth = this.cssWidth / (2 * camera.zoom);
    const halfHeight = this.cssHeight / (2 * camera.zoom);
    const minTileX = Math.floor((camera.x - halfWidth) / tilePixels) - 1;
    const maxTileX = Math.ceil((camera.x + halfWidth) / tilePixels) + 1;
    const minTileY = Math.floor((camera.y - halfHeight) / tilePixels) - 1;
    const maxTileY = Math.ceil((camera.y + halfHeight) / tilePixels) + 1;
    const baseValues: number[] = [];
    const decorationValues: number[] = [];

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
          const index = rowOffset + localX;
          const worldX = baseX + localX;
          const worldY = baseY + localY;
          const baseTerrainId = chunk.baseTiles[index] ?? 255;
          if (baseTerrainId >= 0 && baseTerrainId < BASE_TERRAIN_COUNT) {
            baseValues.push(worldX, worldY, baseTerrainId);
          }

          const decorationId = chunk.decorations[index] ?? 0;
          if (decorationId > 0) {
            const slot = BASE_TERRAIN_COUNT + decorationId - 1;
            if (slot >= BASE_TERRAIN_COUNT && slot < SLOT_COUNT) {
              decorationValues.push(worldX, worldY, slot);
            }
          }
        }
      }
    }

    return {
      base: new Float32Array(baseValues),
      decorations: new Float32Array(decorationValues),
    };
  }

  private drawInstances(gl: WebGL2RenderingContext, instances: Float32Array): void {
    const instanceCount = instances.length / 3;
    if (instanceCount === 0 || !this.instanceBuffer) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, instances, gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCount);
  }

  private syncTextures(renderer: Renderer): void {
    const gl = this.gl;
    if (!gl || !this.textureAtlas) return;
    const revision = renderer.getTextureRevision();
    if (revision === this.uploadedTextureRevision) return;

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textureAtlas);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);

    const sprites = renderer.getTerrainSprites();
    for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
      const sprite = sprites[slot];
      if (!sprite) continue;
      const context = sprite.getContext("2d", { willReadFrequently: true });
      if (!context) continue;
      const pixels = context.getImageData(0, 0, SOURCE_TILE_PIXELS, SOURCE_TILE_PIXELS).data;
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        0,
        slot,
        SOURCE_TILE_PIXELS,
        SOURCE_TILE_PIXELS,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
    }
    this.uploadedTextureRevision = revision;
  }

  private createTextureAtlas(gl: WebGL2RenderingContext): WebGLTexture | null {
    const texture = gl.createTexture();
    if (!texture) return null;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texStorage3D(
      gl.TEXTURE_2D_ARRAY,
      1,
      gl.RGBA8,
      SOURCE_TILE_PIXELS,
      SOURCE_TILE_PIXELS,
      SLOT_COUNT,
    );
    const empty = new Uint8Array(SOURCE_TILE_PIXELS * SOURCE_TILE_PIXELS * 4 * SLOT_COUNT);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      0,
      SOURCE_TILE_PIXELS,
      SOURCE_TILE_PIXELS,
      SLOT_COUNT,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      empty,
    );
    return texture;
  }

  private clear(): void {
    this.gl?.clear(this.gl.COLOR_BUFFER_BIT);
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

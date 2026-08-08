import type { Camera } from "./camera";
import type { Chunk, ChunkManager } from "./chunk-manager";

export const TERRAIN_NAMES = ["深水", "浅水", "沙地", "草地", "森林", "岩地", "雪地"] as const;

export const TERRAIN_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [22, 63, 112],   // deep water
  [40, 103, 166],  // water
  [210, 190, 131], // sand
  [105, 158, 86],  // grass
  [47, 105, 65],   // forest
  [112, 113, 107], // rock
  [229, 235, 238], // snow
];

export const SOURCE_TILE_PIXELS = 8;
const MAX_SURFACE_CACHE = 32;
const WORLD_BACKGROUND = "#000000";

// Default mask from the latest uploaded sprite: a centered 2×2 mark in an 8×8 cell.
const DEFAULT_TILE_MASK = [
  "00000000",
  "00000000",
  "00000000",
  "00011000",
  "00011000",
  "00000000",
  "00000000",
  "00000000",
] as const;

export class Renderer {
  /** Base art/grid size. World generation remains tile-coordinate based. */
  readonly tilePixels = 32;
  private readonly surfaces = new Map<string, HTMLCanvasElement>();
  private readonly defaultMask: HTMLCanvasElement;
  private terrainSprites: HTMLCanvasElement[];
  private gridVisible = true;

  constructor() {
    this.defaultMask = this.createDefaultMask();
    this.terrainSprites = this.createTintedSprites([this.defaultMask]);
  }

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible;
  }

  isGridVisible(): boolean {
    return this.gridVisible;
  }

  setTerrainMasks(masks: readonly CanvasImageSource[]): void {
    this.terrainSprites = this.createTintedSprites(masks.length > 0 ? masks : [this.defaultMask]);
    this.clear();
  }

  resetTerrainTextures(): void {
    this.terrainSprites = this.createTintedSprites([this.defaultMask]);
    this.clear();
  }

  getTerrainSprites(): readonly HTMLCanvasElement[] {
    return this.terrainSprites;
  }

  clear(): void {
    this.surfaces.clear();
  }

  draw(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    camera: Camera,
    chunks: ChunkManager,
  ): void {
    context.clearRect(0, 0, width, height);
    context.fillStyle = WORLD_BACKGROUND;
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = false;

    const chunkWorldPixels = chunks.chunkSize * this.tilePixels;
    const halfWorldWidth = width / (2 * camera.zoom);
    const halfWorldHeight = height / (2 * camera.zoom);

    for (const chunk of chunks.getChunks()) {
      const worldX = chunk.x * chunkWorldPixels;
      const worldY = chunk.y * chunkWorldPixels;
      if (
        worldX + chunkWorldPixels < camera.x - halfWorldWidth ||
        worldX > camera.x + halfWorldWidth ||
        worldY + chunkWorldPixels < camera.y - halfWorldHeight ||
        worldY > camera.y + halfWorldHeight
      ) {
        continue;
      }

      const screenX = (worldX - camera.x) * camera.zoom + width / 2;
      const screenY = (worldY - camera.y) * camera.zoom + height / 2;
      const screenSize = chunkWorldPixels * camera.zoom;
      const surface = this.getSurface(chunk, chunks.chunkSize);
      context.drawImage(surface, screenX, screenY, screenSize, screenSize);
    }

    if (this.gridVisible) {
      this.drawGrid(context, width, height, camera, chunks.chunkSize);
    }

    this.cleanupSurfaces(chunks);
  }

  private createDefaultMask(): HTMLCanvasElement {
    const mask = document.createElement("canvas");
    mask.width = SOURCE_TILE_PIXELS;
    mask.height = SOURCE_TILE_PIXELS;
    const context = mask.getContext("2d");
    if (!context) throw new Error("2D canvas context is unavailable.");

    context.clearRect(0, 0, SOURCE_TILE_PIXELS, SOURCE_TILE_PIXELS);
    context.fillStyle = "#ffffff";
    for (let y = 0; y < SOURCE_TILE_PIXELS; y += 1) {
      const row = DEFAULT_TILE_MASK[y];
      if (!row) continue;
      for (let x = 0; x < SOURCE_TILE_PIXELS; x += 1) {
        if (row[x] === "1") context.fillRect(x, y, 1, 1);
      }
    }
    return mask;
  }

  private createTintedSprites(masks: readonly CanvasImageSource[]): HTMLCanvasElement[] {
    const firstMask = masks[0] ?? this.defaultMask;
    return TERRAIN_COLORS.map((color, index) => {
      const mask = masks[index] ?? firstMask;
      const canvas = document.createElement("canvas");
      canvas.width = SOURCE_TILE_PIXELS;
      canvas.height = SOURCE_TILE_PIXELS;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("2D canvas context is unavailable.");

      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, SOURCE_TILE_PIXELS, SOURCE_TILE_PIXELS);
      context.drawImage(mask, 0, 0, SOURCE_TILE_PIXELS, SOURCE_TILE_PIXELS);
      context.globalCompositeOperation = "source-in";
      context.fillStyle = `rgb(${color[0]} ${color[1]} ${color[2]})`;
      context.fillRect(0, 0, SOURCE_TILE_PIXELS, SOURCE_TILE_PIXELS);
      context.globalCompositeOperation = "source-over";
      return canvas;
    });
  }

  private drawGrid(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    camera: Camera,
    macroSize: number,
  ): void {
    const tileScreenPixels = this.tilePixels * camera.zoom;
    if (tileScreenPixels < 8) return;

    const halfWorldWidth = width / (2 * camera.zoom);
    const halfWorldHeight = height / (2 * camera.zoom);
    const minTileX = Math.floor((camera.x - halfWorldWidth) / this.tilePixels);
    const maxTileX = Math.ceil((camera.x + halfWorldWidth) / this.tilePixels);
    const minTileY = Math.floor((camera.y - halfWorldHeight) / this.tilePixels);
    const maxTileY = Math.ceil((camera.y + halfWorldHeight) / this.tilePixels);

    const tileToScreenX = (tileX: number): number =>
      (tileX * this.tilePixels - camera.x) * camera.zoom + width / 2;
    const tileToScreenY = (tileY: number): number =>
      (tileY * this.tilePixels - camera.y) * camera.zoom + height / 2;

    context.save();

    context.beginPath();
    context.strokeStyle = "rgba(255, 255, 255, 0.18)";
    context.lineWidth = 1;
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      if (tileX % macroSize === 0) continue;
      const screenX = tileToScreenX(tileX);
      context.moveTo(screenX, 0);
      context.lineTo(screenX, height);
    }
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      if (tileY % macroSize === 0) continue;
      const screenY = tileToScreenY(tileY);
      context.moveTo(0, screenY);
      context.lineTo(width, screenY);
    }
    context.stroke();

    context.beginPath();
    context.strokeStyle = "rgba(255, 255, 255, 0.72)";
    context.lineWidth = 1.5;
    const firstMacroX = Math.floor(minTileX / macroSize) * macroSize;
    const firstMacroY = Math.floor(minTileY / macroSize) * macroSize;
    for (let tileX = firstMacroX; tileX <= maxTileX; tileX += macroSize) {
      const screenX = tileToScreenX(tileX);
      context.moveTo(screenX, 0);
      context.lineTo(screenX, height);
    }
    for (let tileY = firstMacroY; tileY <= maxTileY; tileY += macroSize) {
      const screenY = tileToScreenY(tileY);
      context.moveTo(0, screenY);
      context.lineTo(width, screenY);
    }
    context.stroke();

    context.restore();
  }

  private getSurface(chunk: Chunk, chunkSize: number): HTMLCanvasElement {
    const existing = this.surfaces.get(chunk.key);
    if (existing) return existing;

    const canvas = document.createElement("canvas");
    canvas.width = chunkSize * SOURCE_TILE_PIXELS;
    canvas.height = chunkSize * SOURCE_TILE_PIXELS;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas context is unavailable.");

    context.imageSmoothingEnabled = false;
    context.fillStyle = WORLD_BACKGROUND;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < chunk.tiles.length; i += 1) {
      const terrainId = chunk.tiles[i] ?? 0;
      const sprite = this.terrainSprites[terrainId] ?? this.terrainSprites[0];
      if (!sprite) continue;
      const tileX = i % chunkSize;
      const tileY = Math.floor(i / chunkSize);
      context.drawImage(
        sprite,
        tileX * SOURCE_TILE_PIXELS,
        tileY * SOURCE_TILE_PIXELS,
      );
    }

    this.surfaces.set(chunk.key, canvas);
    return canvas;
  }

  private cleanupSurfaces(chunks: ChunkManager): void {
    for (const key of this.surfaces.keys()) {
      if (!chunks.has(key)) this.surfaces.delete(key);
    }
    while (this.surfaces.size > MAX_SURFACE_CACHE) {
      const oldest = this.surfaces.keys().next().value as string | undefined;
      if (!oldest) break;
      this.surfaces.delete(oldest);
    }
  }
}

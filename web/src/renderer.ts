import type { Camera } from "./camera";
import type { Chunk, ChunkManager } from "./chunk-manager";

const TERRAIN_COLORS: ReadonlyArray<readonly [number, number, number]> = [
  [22, 63, 112],   // deep water
  [40, 103, 166],  // water
  [210, 190, 131], // sand
  [105, 158, 86],  // grass
  [47, 105, 65],   // forest
  [112, 113, 107], // rock
  [229, 235, 238], // snow
];

export class Renderer {
  /** Base art/grid size. World generation remains tile-coordinate based. */
  readonly tilePixels = 32;
  private readonly surfaces = new Map<string, HTMLCanvasElement>();
  private gridVisible = true;

  setGridVisible(visible: boolean): void {
    this.gridVisible = visible;
  }

  isGridVisible(): boolean {
    return this.gridVisible;
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
    context.fillStyle = "#111820";
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
    context.strokeStyle = "rgba(6, 10, 14, 0.32)";
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
    context.strokeStyle = "rgba(238, 244, 250, 0.58)";
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
    canvas.width = chunkSize;
    canvas.height = chunkSize;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D canvas context is unavailable.");

    const image = context.createImageData(chunkSize, chunkSize);
    for (let i = 0; i < chunk.tiles.length; i += 1) {
      const terrainId = chunk.tiles[i] ?? 0;
      const color = TERRAIN_COLORS[terrainId] ?? [255, 0, 255];
      const offset = i * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    this.surfaces.set(chunk.key, canvas);
    return canvas;
  }

  private cleanupSurfaces(chunks: ChunkManager): void {
    if (this.surfaces.size < 160) return;
    for (const key of this.surfaces.keys()) {
      if (!chunks.has(key)) this.surfaces.delete(key);
    }
  }
}

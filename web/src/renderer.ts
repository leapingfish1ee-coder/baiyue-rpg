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
  readonly tilePixels = 16;
  private readonly surfaces = new Map<string, HTMLCanvasElement>();

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

    this.cleanupSurfaces(chunks);
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

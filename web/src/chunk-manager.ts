import type { GenerateChunkRequest, WorkerMessage } from "./protocol";

export type Chunk = {
  key: string;
  x: number;
  y: number;
  tiles: Uint8Array;
};

export type ChunkManagerStatus = {
  ready: boolean;
  generatorVersion: number | null;
  error: string | null;
};

export class ChunkManager {
  readonly chunkSize = 64;

  private readonly worker = new Worker(new URL("./generator-worker.ts", import.meta.url), {
    type: "module",
  });
  private readonly cache = new Map<string, Chunk>();
  private readonly pending = new Map<string, number>();
  private requestId = 0;
  private epoch = 0;
  private seed = 20260808n;
  private readonly maxCachedChunks = 144;
  private status: ChunkManagerStatus = {
    ready: false,
    generatorVersion: null,
    error: null,
  };

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === "ready") {
        if (message.chunkSize !== this.chunkSize) {
          this.status.error = `Chunk size mismatch: JS=${this.chunkSize}, WASM=${message.chunkSize}`;
          return;
        }
        this.status = {
          ready: true,
          generatorVersion: message.generatorVersion,
          error: null,
        };
        return;
      }

      if (message.type === "error") {
        this.status.error = message.message;
        return;
      }

      if (message.epoch !== this.epoch) return;
      const key = this.key(Number(message.chunkX), Number(message.chunkY));
      const expectedRequestId = this.pending.get(key);
      if (expectedRequestId !== message.requestId) return;

      this.pending.delete(key);
      this.cache.set(key, {
        key,
        x: Number(message.chunkX),
        y: Number(message.chunkY),
        tiles: new Uint8Array(message.buffer),
      });
      this.prune();
    };
  }

  getStatus(): ChunkManagerStatus {
    return this.status;
  }

  getSeed(): bigint {
    return this.seed;
  }

  setSeed(seed: bigint): void {
    if (seed < 0n || seed > 0xffff_ffff_ffff_ffffn) {
      throw new RangeError("Seed must be an unsigned 64-bit integer.");
    }
    this.seed = seed;
    this.epoch += 1;
    this.cache.clear();
    this.pending.clear();
  }

  ensureVisible(
    cameraX: number,
    cameraY: number,
    viewportWidth: number,
    viewportHeight: number,
    zoom: number,
    tilePixels: number,
  ): void {
    if (!this.status.ready) return;

    const chunkWorldPixels = this.chunkSize * tilePixels;
    const halfWidth = viewportWidth / (2 * zoom);
    const halfHeight = viewportHeight / (2 * zoom);
    const preload = 1;

    const minX = Math.floor((cameraX - halfWidth) / chunkWorldPixels) - preload;
    const maxX = Math.floor((cameraX + halfWidth) / chunkWorldPixels) + preload;
    const minY = Math.floor((cameraY - halfHeight) / chunkWorldPixels) - preload;
    const maxY = Math.floor((cameraY + halfHeight) / chunkWorldPixels) + preload;

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        this.request(x, y);
      }
    }
  }

  getChunks(): Iterable<Chunk> {
    return this.cache.values();
  }

  get loadedCount(): number {
    return this.cache.size;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  private request(x: number, y: number): void {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      this.status.error = "Camera moved beyond JavaScript safe-integer chunk coordinates.";
      return;
    }

    const key = this.key(x, y);
    if (this.cache.has(key) || this.pending.has(key)) return;

    const requestId = ++this.requestId;
    this.pending.set(key, requestId);
    const request: GenerateChunkRequest = {
      type: "generate",
      requestId,
      epoch: this.epoch,
      seed: this.seed.toString(),
      chunkX: BigInt(x).toString(),
      chunkY: BigInt(y).toString(),
    };
    this.worker.postMessage(request);
  }

  private prune(): void {
    while (this.cache.size > this.maxCachedChunks) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      this.cache.delete(oldestKey);
    }
  }

  private key(x: number, y: number): string {
    return `${x},${y}`;
  }
}

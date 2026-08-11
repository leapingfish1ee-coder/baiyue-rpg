import { isWorkerMessage, type GenerateChunkRequest } from "./protocol.ts";
import { TerrainSourceError } from "./terrain-source-error.ts";
import { BASE_TERRAIN_ID, GENERATED_CHUNK_BYTES, RUNTIME_CHUNK_AREA, RUNTIME_CHUNK_SIZE, isBaseTerrainId, isDecorationId } from "./world-contract.ts";

export type Chunk = {
  key: string;
  x: number;
  y: number;
  macroBiome: number;
  baseTiles: Uint8Array;
  decorations: Uint8Array;
  /** Compatibility alias for renderers that still read the base terrain plane as `tiles`. */
  tiles: Uint8Array;
};

export type ChunkManagerStatus = {
  ready: boolean;
  generatorVersion: number | null;
  error: string | null;
};

type ChunkWaiter = Readonly<{ resolve: (chunk: Chunk) => void; reject: (error: Error) => void }>;

type PendingChunk = {
  requestId: number;
  epoch: number;
  seed: string;
  generatorVersion: number;
  chunkKey: string;
  chunkX: number;
  chunkY: number;
  purpose: "gameplay" | "render";
  waiters: ChunkWaiter[];
};

type QueuedChunk = Readonly<{
  chunkKey: string;
  chunkX: number;
  chunkY: number;
  waiters: ChunkWaiter[];
}>;

const MAX_GENERATOR_IN_FLIGHT = 8;
const MAX_RENDER_IN_FLIGHT = 7;
const MAX_RENDER_QUEUE = 64;

export class ChunkManager {
  /// A runtime chunk is one macro-map pixel expanded to a 64×64 playable region.
  readonly chunkSize = RUNTIME_CHUNK_SIZE;

  private readonly worker: Worker;
  private readonly cache = new Map<string, Chunk>();
  private readonly pending = new Map<string, PendingChunk>();
  private readonly gameplayQueue = new Map<string, QueuedChunk>();
  private readonly renderQueue = new Map<string, QueuedChunk>();
  private readonly failedRenderKeys = new Set<string>();
  private readonly readyPromise: Promise<number>;
  private resolveReady: ((generatorVersion: number) => void) | null = null;
  private rejectReady: ((error: Error) => void) | null = null;
  private terminalError: TerrainSourceError | null = null;
  private requestId = 0;
  private epoch = 0;
  private seed = 20260808n;
  private readonly maxCachedChunks = 144;
  private status: ChunkManagerStatus = {
    ready: false,
    generatorVersion: null,
    error: null,
  };

  constructor(
    workerFactory: () => Worker = () => new Worker(new URL("./generator-worker.ts", import.meta.url), { type: "module" }),
  ) {
    this.worker = workerFactory();
    this.readyPromise = new Promise<number>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.worker.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (!isWorkerMessage(message)) {
        this.failTerminal(new TerrainSourceError("payload", "terrain worker sent an invalid message"));
        return;
      }
      if (message.type === "ready") {
        if (message.chunkSize !== this.chunkSize) {
          this.failTerminal(new TerrainSourceError("version", `Chunk size mismatch: JS=${this.chunkSize}, WASM=${message.chunkSize}`));
          return;
        }
        this.status = {
          ready: true,
          generatorVersion: message.generatorVersion,
          error: null,
        };
        this.resolveReady?.(message.generatorVersion);
        this.resolveReady = null;
        this.rejectReady = null;
        return;
      }

      if (message.type === "error") {
        this.status.error = message.message;
        if (!("requestId" in message)) {
          this.failTerminal(new TerrainSourceError("worker", message.message));
          return;
        }
        const pending = [...this.pending.values()].find((candidate) => candidate.requestId === message.requestId && candidate.epoch === message.epoch);
        if (pending !== undefined) {
          this.rejectPending(pending, new TerrainSourceError("generation", message.message, false));
        }
        return;
      }

      if (message.epoch !== this.epoch) return;
      const pending = [...this.pending.values()].find((candidate) => candidate.requestId === message.requestId && candidate.epoch === message.epoch);
      if (pending === undefined) return;
      let chunkX: number;
      let chunkY: number;
      try {
        chunkX = Number(BigInt(message.chunkX));
        chunkY = Number(BigInt(message.chunkY));
      } catch {
        this.rejectPending(pending, new TerrainSourceError("payload", "terrain response coordinates are not canonical integers"));
        return;
      }
      const key = this.key(chunkX, chunkY);
      if (pending.seed !== this.seed.toString() || pending.generatorVersion !== this.status.generatorVersion
        || pending.chunkKey !== key || pending.chunkX !== chunkX || pending.chunkY !== chunkY
        || message.chunkX !== BigInt(chunkX).toString() || message.chunkY !== BigInt(chunkY).toString()) {
        this.rejectPending(pending, new TerrainSourceError("payload", "terrain response correlation mismatch"));
        return;
      }

      const planeArea = RUNTIME_CHUNK_AREA;
      if (message.buffer.byteLength !== GENERATED_CHUNK_BYTES) {
        this.status.error = `Chunk payload mismatch: expected ${GENERATED_CHUNK_BYTES} bytes, got ${message.buffer.byteLength}`;
        this.rejectPending(pending, new TerrainSourceError("payload", this.status.error));
        return;
      }

      const baseTiles = new Uint8Array(message.buffer, 0, planeArea);
      if (!baseTiles.every(isBaseTerrainId)) {
        this.rejectPending(pending, new TerrainSourceError("payload", "terrain response contains invalid BaseTerrain IDs"));
        return;
      }
      const decorations = new Uint8Array(message.buffer, planeArea, planeArea);
      if (!decorations.every(isDecorationId)
        || decorations.some((decoration, index) => decoration !== 0 && baseTiles[index] !== BASE_TERRAIN_ID.Land)) {
        this.rejectPending(pending, new TerrainSourceError("payload", "terrain response contains invalid Decoration semantics"));
        return;
      }
      const chunk: Chunk = {
        key,
        x: chunkX,
        y: chunkY,
        macroBiome: message.macroBiome,
        baseTiles,
        decorations,
        tiles: baseTiles,
      };
      this.pending.delete(key);
      this.failedRenderKeys.delete(key);
      this.cache.set(key, chunk);
      for (const waiter of pending.waiters) waiter.resolve(chunk);
      this.status.error = null;
      this.prune();
      this.pumpQueues();
    };
    this.worker.onerror = () => {
      this.failTerminal(new TerrainSourceError("worker", "terrain generator worker crashed"));
    };
  }

  getStatus(): ChunkManagerStatus {
    return this.status;
  }

  whenReady(): Promise<number> {
    if (this.terminalError !== null) return Promise.reject(this.terminalError);
    if (this.status.ready && this.status.generatorVersion !== null) return Promise.resolve(this.status.generatorVersion);
    return this.readyPromise;
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
    for (const pending of this.pending.values()) {
      for (const waiter of pending.waiters) waiter.reject(new TerrainSourceError("stale", "terrain request became stale after seed/epoch change"));
    }
    this.pending.clear();
    const stale = new TerrainSourceError("stale", "terrain request became stale after seed/epoch change");
    for (const queued of this.gameplayQueue.values()) for (const waiter of queued.waiters) waiter.reject(stale);
    this.gameplayQueue.clear();
    this.renderQueue.clear();
    this.failedRenderKeys.clear();
    this.status.error = null;
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

    const visibleMinX = Math.floor((cameraX - halfWidth) / chunkWorldPixels);
    const visibleMaxX = Math.floor((cameraX + halfWidth) / chunkWorldPixels);
    const visibleMinY = Math.floor((cameraY - halfHeight) / chunkWorldPixels);
    const visibleMaxY = Math.floor((cameraY + halfHeight) / chunkWorldPixels);
    const centerX = Math.floor(cameraX / chunkWorldPixels);
    const centerY = Math.floor(cameraY / chunkWorldPixels);
    const candidates: Array<{ x: number; y: number; visible: boolean; distance: number }> = [];
    for (let y = visibleMinY - preload; y <= visibleMaxY + preload; y += 1) {
      for (let x = visibleMinX - preload; x <= visibleMaxX + preload; x += 1) {
        candidates.push({
          x,
          y,
          visible: x >= visibleMinX && x <= visibleMaxX && y >= visibleMinY && y <= visibleMaxY,
          distance: Math.abs(x - centerX) + Math.abs(y - centerY),
        });
      }
    }
    candidates.sort((left, right) => Number(right.visible) - Number(left.visible)
      || left.distance - right.distance || left.y - right.y || left.x - right.x);
    this.renderQueue.clear();
    for (const candidate of candidates.slice(0, MAX_RENDER_QUEUE)) {
      const chunkKey = this.key(candidate.x, candidate.y);
      if (this.cache.has(chunkKey) || this.pending.has(chunkKey) || this.gameplayQueue.has(chunkKey) || this.failedRenderKeys.has(chunkKey)) continue;
      this.renderQueue.set(chunkKey, { chunkKey, chunkX: candidate.x, chunkY: candidate.y, waiters: [] });
    }
    this.pumpQueues();
  }

  getChunks(): Iterable<Chunk> {
    return this.cache.values();
  }

  getChunk(x: number, y: number): Chunk | undefined {
    return this.cache.get(this.key(x, y));
  }

  async getBaseTerrain(seed: string, chunkXText: string, chunkYText: string, expectedGeneratorVersion: number): Promise<Uint8Array> {
    const seedValue = BigInt(seed);
    const chunkXValue = BigInt(chunkXText);
    const chunkYValue = BigInt(chunkYText);
    const chunkX = Number(chunkXValue);
    const chunkY = Number(chunkYValue);
    if (!Number.isSafeInteger(chunkX) || !Number.isSafeInteger(chunkY)
      || BigInt(chunkX) !== chunkXValue || BigInt(chunkY) !== chunkYValue) throw new RangeError("chunk coordinate is outside the safe broker range");
    const actualGeneratorVersion = await this.whenReady();
    if (actualGeneratorVersion !== expectedGeneratorVersion) throw new TerrainSourceError("version", "terrain generator version changed during broker request");
    if (this.seed !== seedValue) this.setSeed(seedValue);
    const chunk = await this.requestGameplay(chunkX, chunkY);
    return chunk.baseTiles.slice();
  }

  get loadedCount(): number {
    return this.cache.size;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  get queuedRenderCount(): number {
    return this.renderQueue.size;
  }

  dispose(): void {
    this.failTerminal(new TerrainSourceError("stale", "chunk manager disposed"));
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  private requestGameplay(x: number, y: number): Promise<Chunk> {
    if (this.terminalError !== null) return Promise.reject(this.terminalError);
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
      this.status.error = "Camera moved beyond JavaScript safe-integer chunk coordinates.";
      return Promise.reject(new RangeError(this.status.error));
    }

    const key = this.key(x, y);
    const cached = this.cache.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const existing = this.pending.get(key);
    if (existing !== undefined) {
      return new Promise<Chunk>((resolve, reject) => existing.waiters.push({ resolve, reject }));
    }
    const queued = this.gameplayQueue.get(key);
    if (queued !== undefined) {
      return new Promise<Chunk>((resolve, reject) => queued.waiters.push({ resolve, reject }));
    }

    if (!this.status.ready || this.status.generatorVersion === null) return Promise.reject(new Error("terrain generator is not ready"));

    let resolveChunk: (chunk: Chunk) => void = () => {};
    let rejectChunk: (error: Error) => void = () => {};
    const promise = new Promise<Chunk>((resolve, reject) => { resolveChunk = resolve; rejectChunk = reject; });
    this.renderQueue.delete(key);
    this.gameplayQueue.set(key, { chunkKey: key, chunkX: x, chunkY: y, waiters: [{ resolve: resolveChunk, reject: rejectChunk }] });
    this.pumpQueues();
    return promise;
  }

  private startQueued(queued: QueuedChunk, purpose: "gameplay" | "render"): void {
    const generatorVersion = this.status.generatorVersion;
    if (generatorVersion === null) throw new Error("terrain generator is not ready");
    const requestId = ++this.requestId;
    this.pending.set(queued.chunkKey, {
      requestId,
      epoch: this.epoch,
      seed: this.seed.toString(),
      generatorVersion,
      chunkKey: queued.chunkKey,
      chunkX: queued.chunkX,
      chunkY: queued.chunkY,
      purpose,
      waiters: queued.waiters,
    });
    const request: GenerateChunkRequest = {
      type: "generate",
      requestId,
      epoch: this.epoch,
      seed: this.seed.toString(),
      chunkX: BigInt(queued.chunkX).toString(),
      chunkY: BigInt(queued.chunkY).toString(),
    };
    try {
      this.worker.postMessage(request);
    } catch (error: unknown) {
      this.failTerminal(new TerrainSourceError("worker", error instanceof Error ? error.message : String(error)));
    }
  }

  private pumpQueues(): void {
    if (this.terminalError !== null || !this.status.ready || this.status.generatorVersion === null) return;
    while (this.pending.size < MAX_GENERATOR_IN_FLIGHT) {
      const gameplay = this.gameplayQueue.entries().next().value as [string, QueuedChunk] | undefined;
      if (gameplay !== undefined) {
        this.gameplayQueue.delete(gameplay[0]);
        this.startQueued(gameplay[1], "gameplay");
        continue;
      }
      const renderInFlight = [...this.pending.values()].filter((pending) => pending.purpose === "render").length;
      if (renderInFlight >= MAX_RENDER_IN_FLIGHT) return;
      const render = this.renderQueue.entries().next().value as [string, QueuedChunk] | undefined;
      if (render === undefined) return;
      this.renderQueue.delete(render[0]);
      this.startQueued(render[1], "render");
    }
  }

  private prune(): void {
    while (this.cache.size > this.maxCachedChunks) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      this.cache.delete(oldestKey);
    }
  }

  private rejectPending(pending: PendingChunk, error: Error): void {
    this.pending.delete(pending.chunkKey);
    if (pending.purpose === "render" && error instanceof TerrainSourceError && error.kind !== "stale") {
      this.failedRenderKeys.add(pending.chunkKey);
    }
    for (const waiter of pending.waiters) waiter.reject(error);
    this.pumpQueues();
  }

  private failTerminal(error: TerrainSourceError): void {
    if (this.terminalError !== null) return;
    this.terminalError = error;
    this.status = { ready: false, generatorVersion: null, error: error.message };
    this.rejectReady?.(error);
    this.resolveReady = null;
    this.rejectReady = null;
    for (const pending of [...this.pending.values()]) this.rejectPending(pending, error);
    for (const queued of this.gameplayQueue.values()) for (const waiter of queued.waiters) waiter.reject(error);
    this.gameplayQueue.clear();
    this.renderQueue.clear();
    this.worker.terminate();
  }

  private key(x: number, y: number): string {
    return `${x},${y}`;
  }
}

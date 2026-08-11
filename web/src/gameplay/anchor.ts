import {
  BASE_TERRAIN_ID,
  BASE_TERRAIN_ID_MAX,
  NAV_UNITS_PER_TILE,
  RUNTIME_CHUNK_AREA,
  RUNTIME_CHUNK_SIZE,
  isPassableBaseTerrain,
} from "../world-contract.ts";
import { floorDiv } from "./math.ts";

export const CAMP_SEARCH_MAX_CHUNK_RING = 16;
export const CHUNK_SIZE_TILES = BigInt(RUNTIME_CHUNK_SIZE);
export const CAMP_RADIUS_NAV_UNITS = 256n;

if (CAMP_RADIUS_NAV_UNITS * 2n >= NAV_UNITS_PER_TILE) {
  throw new Error("camp radius must fit strictly inside a tile centered on its anchor");
}

export type CanonicalWorldPoint = Readonly<{ x: string; y: string }>;
export type CampAnchor = Readonly<{ tileX: string; tileY: string; point: CanonicalWorldPoint }>;
export type AnchorTerrainProvider = (chunkX: string, chunkY: string) => Promise<Uint8Array>;
export type AnchorTerrainRequest = Readonly<{ kind: "terrain-required"; chunkX: string; chunkY: string; chunkKey: string }>;
export type AnchorStepResult = AnchorTerrainRequest | Readonly<{ kind: "yield" }> | Readonly<{ kind: "complete"; anchor: CampAnchor | null }>;

type AnchorSignal = AnchorTerrainRequest | Readonly<{ kind: "operation" }>;

function terrainIndex(tileX: bigint, tileY: bigint): number {
  const chunkX = floorDiv(tileX, CHUNK_SIZE_TILES);
  const chunkY = floorDiv(tileY, CHUNK_SIZE_TILES);
  const localX = Number(tileX - chunkX * CHUNK_SIZE_TILES);
  const localY = Number(tileY - chunkY * CHUNK_SIZE_TILES);
  return localY * RUNTIME_CHUNK_SIZE + localX;
}

function chunkKey(chunkX: bigint, chunkY: bigint): string { return `${chunkX},${chunkY}`; }

function validateTerrain(key: string, terrain: Uint8Array): Uint8Array {
  if (!(terrain instanceof Uint8Array) || terrain.byteLength !== RUNTIME_CHUNK_AREA) {
    throw new Error(`anchor terrain ${key} must contain exactly ${RUNTIME_CHUNK_AREA} BaseTerrain bytes`);
  }
  for (const terrainId of terrain) {
    if (terrainId > BASE_TERRAIN_ID_MAX) throw new Error(`anchor terrain ${key} contains invalid BaseTerrain id ${terrainId}`);
  }
  return terrain.slice();
}

function* anchorGenerator(chunks: Map<string, Uint8Array>): Generator<AnchorSignal, CampAnchor | null, void> {
  function* loadChunk(chunkX: bigint, chunkY: bigint): Generator<AnchorSignal, Uint8Array, void> {
    const key = chunkKey(chunkX, chunkY);
    while (!chunks.has(key)) yield { kind: "terrain-required", chunkX: chunkX.toString(), chunkY: chunkY.toString(), chunkKey: key };
    return chunks.get(key)!;
  }

  function* terrainAt(tileX: bigint, tileY: bigint): Generator<AnchorSignal, number, void> {
    const chunkX = floorDiv(tileX, CHUNK_SIZE_TILES);
    const chunkY = floorDiv(tileY, CHUNK_SIZE_TILES);
    const terrain = yield* loadChunk(chunkX, chunkY);
    yield { kind: "operation" };
    return terrain[terrainIndex(tileX, tileY)]!;
  }

  function loadedTerrainAt(tileX: bigint, tileY: bigint): number {
    const chunkX = floorDiv(tileX, CHUNK_SIZE_TILES);
    const chunkY = floorDiv(tileY, CHUNK_SIZE_TILES);
    const terrain = chunks.get(chunkKey(chunkX, chunkY));
    if (terrain === undefined) throw new Error("anchor connectivity read an unloaded chunk");
    return terrain[terrainIndex(tileX, tileY)]!;
  }

  function* hasPassableNeighborhood(tileX: bigint, tileY: bigint): Generator<AnchorSignal, boolean, void> {
    for (let offsetY = -1n; offsetY <= 1n; offsetY += 1n) {
      for (let offsetX = -1n; offsetX <= 1n; offsetX += 1n) {
        if (!isPassableBaseTerrain(yield* terrainAt(tileX + offsetX, tileY + offsetY))) return false;
      }
    }
    return true;
  }

  function* crossesOrthogonalChunk(tileX: bigint, tileY: bigint): Generator<AnchorSignal, boolean, void> {
    const centerChunkX = floorDiv(tileX, CHUNK_SIZE_TILES);
    const centerChunkY = floorDiv(tileY, CHUNK_SIZE_TILES);
    for (let offsetY = -1n; offsetY <= 1n; offsetY += 1n) {
      for (let offsetX = -1n; offsetX <= 1n; offsetX += 1n) yield* loadChunk(centerChunkX + offsetX, centerChunkY + offsetY);
    }

    const minTileX = (centerChunkX - 1n) * CHUNK_SIZE_TILES;
    const minTileY = (centerChunkY - 1n) * CHUNK_SIZE_TILES;
    const width = RUNTIME_CHUNK_SIZE * 3;
    const area = width * width;
    const visited = new Uint8Array(area);
    const queue = new Int32Array(area);
    const startX = Number(tileX - minTileX);
    const startY = Number(tileY - minTileY);
    const startIndex = startY * width + startX;
    visited[startIndex] = 1;
    queue[0] = startIndex;
    let head = 0;
    let tail = 1;
    const offsets = [[0, -1], [-1, 0], [1, 0], [0, 1]] as const;

    while (head < tail) {
      yield { kind: "operation" };
      const current = queue[head++]!;
      const localY = Math.floor(current / width);
      const localX = current - localY * width;
      const currentTileX = minTileX + BigInt(localX);
      const currentTileY = minTileY + BigInt(localY);
      const currentChunkX = floorDiv(currentTileX, CHUNK_SIZE_TILES);
      const currentChunkY = floorDiv(currentTileY, CHUNK_SIZE_TILES);
      if ((currentChunkX === centerChunkX && (currentChunkY === centerChunkY - 1n || currentChunkY === centerChunkY + 1n))
        || (currentChunkY === centerChunkY && (currentChunkX === centerChunkX - 1n || currentChunkX === centerChunkX + 1n))) return true;

      for (const [offsetX, offsetY] of offsets) {
        const nextX = localX + offsetX;
        const nextY = localY + offsetY;
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= width) continue;
        const nextIndex = nextY * width + nextX;
        if (visited[nextIndex] !== 0) continue;
        const nextTileX = minTileX + BigInt(nextX);
        const nextTileY = minTileY + BigInt(nextY);
        if (!isPassableBaseTerrain(loadedTerrainAt(nextTileX, nextTileY))) continue;
        visited[nextIndex] = 1;
        queue[tail++] = nextIndex;
      }
    }
    return false;
  }

  for (let ring = 0; ring <= CAMP_SEARCH_MAX_CHUNK_RING; ring += 1) {
    for (let chunkY = -ring; chunkY <= ring; chunkY += 1) {
      for (let chunkX = -ring; chunkX <= ring; chunkX += 1) {
        if (Math.max(Math.abs(chunkX), Math.abs(chunkY)) !== ring) continue;
        const chunkXBig = BigInt(chunkX);
        const chunkYBig = BigInt(chunkY);
        yield* loadChunk(chunkXBig, chunkYBig);
        const firstTileX = chunkXBig * CHUNK_SIZE_TILES;
        const firstTileY = chunkYBig * CHUNK_SIZE_TILES;
        for (let localY = 0n; localY < CHUNK_SIZE_TILES; localY += 1n) {
          for (let localX = 0n; localX < CHUNK_SIZE_TILES; localX += 1n) {
            const tileX = firstTileX + localX;
            const tileY = firstTileY + localY;
            if ((yield* terrainAt(tileX, tileY)) !== BASE_TERRAIN_ID.Land) continue;
            if (!(yield* hasPassableNeighborhood(tileX, tileY))) continue;
            if (!(yield* crossesOrthogonalChunk(tileX, tileY))) continue;
            return {
              tileX: tileX.toString(),
              tileY: tileY.toString(),
              point: {
                x: (tileX * NAV_UNITS_PER_TILE + NAV_UNITS_PER_TILE / 2n).toString(),
                y: (tileY * NAV_UNITS_PER_TILE + NAV_UNITS_PER_TILE / 2n).toString(),
              },
            };
          }
        }
      }
    }
  }
  return null;
}

export class CampAnchorStepper {
  private readonly chunks = new Map<string, Uint8Array>();
  private readonly generator = anchorGenerator(this.chunks);
  private final: CampAnchor | null | undefined;

  provideChunk(chunkX: string, chunkY: string, terrain: Uint8Array): void {
    const key = `${BigInt(chunkX)},${BigInt(chunkY)}`;
    this.chunks.set(key, validateTerrain(key, terrain));
  }

  step(maxOperations: number): AnchorStepResult {
    if (!Number.isInteger(maxOperations) || maxOperations < 1) throw new RangeError("anchor operation budget must be positive");
    if (this.final !== undefined) return { kind: "complete", anchor: this.final };
    let operations = 0;
    while (operations < maxOperations) {
      const result = this.generator.next();
      if (result.done) {
        this.final = result.value;
        return { kind: "complete", anchor: result.value };
      }
      if (result.value.kind === "terrain-required") return result.value;
      operations += 1;
    }
    return { kind: "yield" };
  }
}

export async function findCampAnchor(getBaseTerrain: AnchorTerrainProvider): Promise<CampAnchor | null> {
  const stepper = new CampAnchorStepper();
  while (true) {
    const result = stepper.step(4096);
    if (result.kind === "complete") return result.anchor;
    if (result.kind === "terrain-required") stepper.provideChunk(result.chunkX, result.chunkY, await getBaseTerrain(result.chunkX, result.chunkY));
  }
}

import { BASE_TERRAIN_ID, NAV_UNITS_PER_TILE, RUNTIME_CHUNK_SIZE, isTileCoordinateInBounds } from "../world-contract.ts";
import { CONTENT_VERSION, type SeedDecimal, type WorldPoint } from "./contracts.ts";
import { revealTile, type FogMap } from "./fog.ts";
import { floorDiv, tileCenter } from "./math.ts";
import { PlannerStepper, TerrainSnapshot, type RoutePlan } from "./navigation.ts";

export const WILD_FIBER_PROTOTYPE_ID = "wild_fiber" as const;
export const FIBER_ITEM_ID = "fiber" as const;
export const GATHERING_SKILL_ID = "gathering" as const;
export const CONTENT_CELL_SIZE_TILES = 32n;
export const WILD_FIBER_BASE_DURATION_MS = 6_000n;
export const WILD_FIBER_RESPAWN_DURATION_MS = 60_000n;
export const WILD_FIBER_XP = 6;

export type PlacementSource = "ambient" | "guarantee";
export type ResourcePlacementDefinition = Readonly<{
  placementId: string;
  prototypeId: typeof WILD_FIBER_PROTOTYPE_ID;
  source: PlacementSource;
  tileX: string;
  tileY: string;
  point: WorldPoint;
}>;

export type GuaranteePlacementResult =
  | Readonly<{ kind: "terrain-required"; chunkX: string; chunkY: string; chunkKey: string }>
  | Readonly<{ kind: "yield" }>
  | Readonly<{ kind: "complete"; placements: readonly ResourcePlacementDefinition[] }>;

export class ContentPlacementError extends Error {
  readonly code = "content/guarantee_unavailable" as const;
}

function fnv1a64(text: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash;
}

function contentDomain(seed: SeedDecimal, campAnchor: WorldPoint): string {
  return `${seed}|${CONTENT_VERSION}|${WILD_FIBER_PROTOTYPE_ID}|${campAnchor.x}|${campAnchor.y}`;
}

function pointForTile(tileX: bigint, tileY: bigint): WorldPoint {
  return { x: tileCenter(tileX).toString(), y: tileCenter(tileY).toString() };
}

function placementChunk(tileX: bigint, tileY: bigint): Readonly<{ chunkX: bigint; chunkY: bigint; chunkKey: string }> {
  const size = BigInt(RUNTIME_CHUNK_SIZE);
  const chunkX = floorDiv(tileX, size);
  const chunkY = floorDiv(tileY, size);
  return { chunkX, chunkY, chunkKey: `${chunkX},${chunkY}` };
}

function guaranteeCandidateTiles(
  seed: SeedDecimal,
  campAnchor: WorldPoint,
  slotId: "initial-observation" | "ring-a" | "ring-b",
): readonly Readonly<{ x: bigint; y: bigint; score: bigint }>[] {
  const campTileX = floorDiv(BigInt(campAnchor.x), NAV_UNITS_PER_TILE);
  const campTileY = floorDiv(BigInt(campAnchor.y), NAV_UNITS_PER_TILE);
  const candidates: Array<Readonly<{ x: bigint; y: bigint; score: bigint }>> = [];
  const maximum = slotId === "initial-observation" ? 4 : 20;
  for (let offsetY = -maximum; offsetY <= maximum; offsetY += 1) {
    for (let offsetX = -maximum; offsetX <= maximum; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      const chebyshev = Math.max(Math.abs(offsetX), Math.abs(offsetY));
      if (slotId === "initial-observation") {
        const dx = BigInt(offsetX) * NAV_UNITS_PER_TILE;
        const dy = BigInt(offsetY) * NAV_UNITS_PER_TILE;
        const radius = 4n * NAV_UNITS_PER_TILE;
        if (dx * dx + dy * dy > radius * radius) continue;
      } else if (chebyshev < 6 || chebyshev > 20) continue;
      const x = campTileX + BigInt(offsetX);
      const y = campTileY + BigInt(offsetY);
      if (!isTileCoordinateInBounds(x) || !isTileCoordinateInBounds(y)) continue;
      const score = fnv1a64(`${contentDomain(seed, campAnchor)}|guarantee|${slotId}|${x}|${y}`);
      candidates.push({ x, y, score });
    }
  }
  return candidates.sort((left, right) => left.score !== right.score
    ? left.score < right.score ? -1 : 1
    : left.y !== right.y ? left.y < right.y ? -1 : 1
    : left.x < right.x ? -1 : left.x > right.x ? 1 : 0);
}

function fullyRevealedGuaranteeFog(campAnchor: WorldPoint): FogMap {
  const fog: FogMap = new Map();
  const campTileX = floorDiv(BigInt(campAnchor.x), NAV_UNITS_PER_TILE);
  const campTileY = floorDiv(BigInt(campAnchor.y), NAV_UNITS_PER_TILE);
  const chunkSize = BigInt(RUNTIME_CHUNK_SIZE);
  const centerChunkX = floorDiv(campTileX, chunkSize);
  const centerChunkY = floorDiv(campTileY, chunkSize);
  for (let chunkOffsetY = -1n; chunkOffsetY <= 1n; chunkOffsetY += 1n) {
    for (let chunkOffsetX = -1n; chunkOffsetX <= 1n; chunkOffsetX += 1n) {
      const firstX = (centerChunkX + chunkOffsetX) * chunkSize;
      const firstY = (centerChunkY + chunkOffsetY) * chunkSize;
      for (let localY = 0n; localY < chunkSize; localY += 1n) {
        for (let localX = 0n; localX < chunkSize; localX += 1n) revealTile(fog, firstX + localX, firstY + localY);
      }
    }
  }
  return fog;
}

/** Resumable creation gate for the three camp-guaranteed nodes. */
export class GuaranteePlacementStepper {
  private readonly generator: Generator<GuaranteePlacementResult, readonly ResourcePlacementDefinition[], void>;
  private final: readonly ResourcePlacementDefinition[] | null = null;

  constructor(
    seed: SeedDecimal,
    campAnchor: WorldPoint,
    terrain: TerrainSnapshot,
  ) {
    this.generator = this.generate(seed, campAnchor, terrain);
  }

  step(maxOperations: number): GuaranteePlacementResult {
    if (!Number.isInteger(maxOperations) || maxOperations < 1) throw new RangeError("content placement budget must be positive");
    if (this.final !== null) return { kind: "complete", placements: this.final };
    let operations = 0;
    while (operations < maxOperations) {
      const result = this.generator.next();
      if (result.done) {
        this.final = result.value;
        return { kind: "complete", placements: result.value };
      }
      if (result.value.kind === "terrain-required") return result.value;
      operations += 1;
    }
    return { kind: "yield" };
  }

  private *generate(
    seed: SeedDecimal,
    campAnchor: WorldPoint,
    terrain: TerrainSnapshot,
  ): Generator<GuaranteePlacementResult, readonly ResourcePlacementDefinition[], void> {
    const fog = fullyRevealedGuaranteeFog(campAnchor);
    const selected: ResourcePlacementDefinition[] = [];
    const occupiedTiles = new Set<string>();
    const slots = ["initial-observation", "ring-a", "ring-b"] as const;
    for (const slotId of slots) {
      let placement: ResourcePlacementDefinition | null = null;
      for (const candidate of guaranteeCandidateTiles(seed, campAnchor, slotId)) {
        const tileKey = `${candidate.x},${candidate.y}`;
        if (occupiedTiles.has(tileKey)) continue;
        const chunk = placementChunk(candidate.x, candidate.y);
        while (!terrain.hasChunk(chunk.chunkX, chunk.chunkY)) {
          yield { kind: "terrain-required", chunkX: chunk.chunkX.toString(), chunkY: chunk.chunkY.toString(), chunkKey: chunk.chunkKey };
        }
        yield { kind: "yield" };
        if (terrain.terrainAtLoaded(candidate.x, candidate.y) !== BASE_TERRAIN_ID.Land) continue;
        const point = pointForTile(candidate.x, candidate.y);
        const planner = new PlannerStepper(terrain, fog, campAnchor, 4, point);
        let plan: RoutePlan | null = null;
        while (plan === null) {
          const result = planner.step(256);
          if (result.kind === "terrain-required") {
            yield result;
            continue;
          }
          if (result.kind === "yield") {
            yield result;
            continue;
          }
          if (result.kind === "route") plan = result.plan;
          else break;
        }
        if (plan === null) continue;
        placement = {
          placementId: `place:wild-fiber:guarantee:${slotId}`,
          prototypeId: WILD_FIBER_PROTOTYPE_ID,
          source: "guarantee",
          tileX: candidate.x.toString(),
          tileY: candidate.y.toString(),
          point,
        };
        occupiedTiles.add(tileKey);
        break;
      }
      if (placement === null) throw new ContentPlacementError(`unable to place guarantee slot ${slotId}`);
      selected.push(placement);
    }
    return selected;
  }
}

export function ambientPlacementCandidate(
  seed: SeedDecimal,
  campAnchor: WorldPoint,
  cellX: bigint,
  cellY: bigint,
): ResourcePlacementDefinition {
  const domain = `${contentDomain(seed, campAnchor)}|ambient|${cellX}|${cellY}`;
  const offsetX = fnv1a64(`${domain}|x`) % CONTENT_CELL_SIZE_TILES;
  const offsetY = fnv1a64(`${domain}|y`) % CONTENT_CELL_SIZE_TILES;
  const tileX = cellX * CONTENT_CELL_SIZE_TILES + offsetX;
  const tileY = cellY * CONTENT_CELL_SIZE_TILES + offsetY;
  return {
    placementId: `place:wild-fiber:ambient:${cellX}:${cellY}`,
    prototypeId: WILD_FIBER_PROTOTYPE_ID,
    source: "ambient",
    tileX: tileX.toString(),
    tileY: tileY.toString(),
    point: pointForTile(tileX, tileY),
  };
}

export function contentCellForTile(tile: bigint): bigint {
  return floorDiv(tile, CONTENT_CELL_SIZE_TILES);
}

export function authoritativeGatherDuration(level: number): Readonly<{ durationMs: bigint; skillSpeedBps: number }> {
  if (!Number.isInteger(level) || level < 1 || level > 100) throw new RangeError("gathering level must be 1..100");
  const skillSpeedBps = Math.min(Math.max(level - 1, 0) * 50, 2_500);
  const duration = (WILD_FIBER_BASE_DURATION_MS * 10_000n + BigInt(10_000 + skillSpeedBps) - 1n)
    / BigInt(10_000 + skillSpeedBps);
  const floorDuration = (WILD_FIBER_BASE_DURATION_MS * 2_500n + 9_999n) / 10_000n;
  return { durationMs: duration > floorDuration ? duration : floorDuration, skillSpeedBps };
}

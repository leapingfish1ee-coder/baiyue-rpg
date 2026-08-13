import { BASE_TERRAIN_ID, NAV_UNITS_PER_TILE, RUNTIME_CHUNK_SIZE, isTileCoordinateInBounds } from "../world-contract.ts";
import type { SeedDecimal, WorldPoint } from "./contracts.ts";
import { revealTile, type FogMap } from "./fog.ts";
import { floorDiv, tileCenter } from "./math.ts";
import { PlannerStepper, TerrainSnapshot, type RoutePlan } from "./navigation.ts";

export const CONTENT_CELL_SIZE_TILES = 32n;
export const CONTENT_PLACEMENT_VERSION = 3 as const;

export const RESOURCE_PROTOTYPE_ORDER = [
  "wild_fiber",
  "softwood_tree",
  "surface_stone",
  "shallow_copper_deposit",
] as const;
export type ResourcePrototypeId = typeof RESOURCE_PROTOTYPE_ORDER[number];
export type ResourceTaskKind = "Gather" | "Woodcut" | "Mine";
export type ResourceSkillId = "gathering" | "woodcutting" | "mining";
export type CraftingSkillId = "crafting";
export type SkillId = ResourceSkillId | CraftingSkillId;
export type BaseMaterialItemId = "fiber" | "softwood" | "stone" | "copper_ore";
export type MaterialItemId = BaseMaterialItemId | "rope";
export type ToolSlot = "axe" | "pickaxe";
export type ToolItemId = "worn_axe" | "worn_pickaxe" | "reinforced_axe" | "reinforced_pickaxe";
export type ItemId = MaterialItemId | ToolItemId;
export type RecipeId = "rope" | "reinforced_axe" | "reinforced_pickaxe";

export type ResourceDefinition = Readonly<{
  prototypeId: ResourcePrototypeId;
  displayName: "野生纤维" | "软木树" | "地表石" | "浅层铜矿";
  taskKind: ResourceTaskKind;
  skillId: ResourceSkillId;
  requiredLevel: number;
  requiredTool: Readonly<{ slot: ToolSlot; minimumTier: number }> | null;
  baseDurationMs: bigint;
  output: Readonly<{ itemId: MaterialItemId; displayName: "纤维" | "软木" | "石料" | "铜矿石"; quantity: 1 }>;
  xp: number;
  respawnDurationMs: bigint;
  mapColor: string;
}>;

export const RESOURCE_DEFINITIONS = {
  wild_fiber: {
    prototypeId: "wild_fiber", displayName: "野生纤维", taskKind: "Gather", skillId: "gathering",
    requiredLevel: 1, requiredTool: null, baseDurationMs: 6_000n,
    output: { itemId: "fiber", displayName: "纤维", quantity: 1 }, xp: 6, respawnDurationMs: 60_000n,
    mapColor: "#85d59a",
  },
  softwood_tree: {
    prototypeId: "softwood_tree", displayName: "软木树", taskKind: "Woodcut", skillId: "woodcutting",
    requiredLevel: 1, requiredTool: { slot: "axe", minimumTier: 0 }, baseDurationMs: 10_000n,
    output: { itemId: "softwood", displayName: "软木", quantity: 1 }, xp: 10, respawnDurationMs: 120_000n,
    mapColor: "#6fbd78",
  },
  surface_stone: {
    prototypeId: "surface_stone", displayName: "地表石", taskKind: "Mine", skillId: "mining",
    requiredLevel: 1, requiredTool: { slot: "pickaxe", minimumTier: 0 }, baseDurationMs: 12_000n,
    output: { itemId: "stone", displayName: "石料", quantity: 1 }, xp: 12, respawnDurationMs: 120_000n,
    mapColor: "#b8b7ad",
  },
  shallow_copper_deposit: {
    prototypeId: "shallow_copper_deposit", displayName: "浅层铜矿", taskKind: "Mine", skillId: "mining",
    requiredLevel: 5, requiredTool: { slot: "pickaxe", minimumTier: 0 }, baseDurationMs: 18_000n,
    output: { itemId: "copper_ore", displayName: "铜矿石", quantity: 1 }, xp: 23, respawnDurationMs: 240_000n,
    mapColor: "#cf8658",
  },
} as const satisfies Record<ResourcePrototypeId, ResourceDefinition>;

export const TOOL_DEFINITIONS = {
  worn_axe: { itemId: "worn_axe", displayName: "破旧斧", slot: "axe", tier: 0, speedBps: 0, requiredSkill: "woodcutting", requiredLevel: 1 },
  worn_pickaxe: { itemId: "worn_pickaxe", displayName: "破旧镐", slot: "pickaxe", tier: 0, speedBps: 0, requiredSkill: "mining", requiredLevel: 1 },
  reinforced_axe: { itemId: "reinforced_axe", displayName: "强化斧", slot: "axe", tier: 1, speedBps: 1_000, requiredSkill: "woodcutting", requiredLevel: 2 },
  reinforced_pickaxe: { itemId: "reinforced_pickaxe", displayName: "强化镐", slot: "pickaxe", tier: 1, speedBps: 1_000, requiredSkill: "mining", requiredLevel: 2 },
} as const satisfies Record<ToolItemId, Readonly<{
  itemId: ToolItemId;
  displayName: "破旧斧" | "破旧镐" | "强化斧" | "强化镐";
  slot: ToolSlot;
  tier: number;
  speedBps: number;
  requiredSkill: "woodcutting" | "mining";
  requiredLevel: number;
}>>;

export type RecipeDefinition = Readonly<{
  recipeId: RecipeId;
  displayName: "绳索" | "强化斧" | "强化镐";
  skillId: "crafting";
  requiredLevel: number;
  inputs: readonly Readonly<{ itemId: MaterialItemId; displayName: "纤维" | "软木" | "石料" | "绳索"; quantity: number }>[];
  baseDurationMs: bigint;
  output: Readonly<{ itemId: ItemId; displayName: "绳索" | "强化斧" | "强化镐"; quantity: 1 }>;
  xp: number;
  station: null;
}>;

export const RECIPE_ORDER = ["rope", "reinforced_axe", "reinforced_pickaxe"] as const satisfies readonly RecipeId[];

export const RECIPE_DEFINITIONS = {
  rope: {
    recipeId: "rope", displayName: "绳索", skillId: "crafting", requiredLevel: 1,
    inputs: [{ itemId: "fiber", displayName: "纤维", quantity: 2 }],
    baseDurationMs: 12_000n, output: { itemId: "rope", displayName: "绳索", quantity: 1 }, xp: 12, station: null,
  },
  reinforced_axe: {
    recipeId: "reinforced_axe", displayName: "强化斧", skillId: "crafting", requiredLevel: 2,
    inputs: [
      { itemId: "softwood", displayName: "软木", quantity: 4 },
      { itemId: "rope", displayName: "绳索", quantity: 2 },
      { itemId: "stone", displayName: "石料", quantity: 2 },
    ],
    baseDurationMs: 30_000n, output: { itemId: "reinforced_axe", displayName: "强化斧", quantity: 1 }, xp: 30, station: null,
  },
  reinforced_pickaxe: {
    recipeId: "reinforced_pickaxe", displayName: "强化镐", skillId: "crafting", requiredLevel: 2,
    inputs: [
      { itemId: "softwood", displayName: "软木", quantity: 4 },
      { itemId: "rope", displayName: "绳索", quantity: 2 },
      { itemId: "stone", displayName: "石料", quantity: 3 },
    ],
    baseDurationMs: 30_000n, output: { itemId: "reinforced_pickaxe", displayName: "强化镐", quantity: 1 }, xp: 30, station: null,
  },
} as const satisfies Record<RecipeId, RecipeDefinition>;

export function isRecipeId(value: unknown): value is RecipeId {
  return typeof value === "string" && (RECIPE_ORDER as readonly string[]).includes(value);
}

export function recipeDefinition(recipeId: RecipeId): RecipeDefinition {
  return RECIPE_DEFINITIONS[recipeId];
}

export const WILD_FIBER_PROTOTYPE_ID = "wild_fiber" as const;
export const FIBER_ITEM_ID = "fiber" as const;
export const GATHERING_SKILL_ID = "gathering" as const;
export const WILD_FIBER_BASE_DURATION_MS = RESOURCE_DEFINITIONS.wild_fiber.baseDurationMs;
export const WILD_FIBER_RESPAWN_DURATION_MS = RESOURCE_DEFINITIONS.wild_fiber.respawnDurationMs;
export const WILD_FIBER_XP = RESOURCE_DEFINITIONS.wild_fiber.xp;

export function isResourcePrototypeId(value: unknown): value is ResourcePrototypeId {
  return typeof value === "string" && (RESOURCE_PROTOTYPE_ORDER as readonly string[]).includes(value);
}

export function resourceDefinition(prototypeId: ResourcePrototypeId): ResourceDefinition {
  return RESOURCE_DEFINITIONS[prototypeId];
}

export function taskKindMatchesPrototype(kind: ResourceTaskKind, prototypeId: ResourcePrototypeId): boolean {
  return RESOURCE_DEFINITIONS[prototypeId].taskKind === kind;
}

export type PlacementSource = "ambient" | "guarantee";
export type ResourcePlacementDefinition = Readonly<{
  placementId: string;
  prototypeId: ResourcePrototypeId;
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

type GuaranteeSlot = Readonly<{
  prototypeId: ResourcePrototypeId;
  slotId: "initial-observation" | "ring-a" | "ring-b" | "boundary-a";
}>;

export const GUARANTEE_SLOTS = [
  { prototypeId: "wild_fiber", slotId: "initial-observation" },
  { prototypeId: "softwood_tree", slotId: "initial-observation" },
  { prototypeId: "surface_stone", slotId: "initial-observation" },
  { prototypeId: "wild_fiber", slotId: "ring-a" },
  { prototypeId: "wild_fiber", slotId: "ring-b" },
  { prototypeId: "softwood_tree", slotId: "ring-a" },
  { prototypeId: "surface_stone", slotId: "ring-a" },
  { prototypeId: "shallow_copper_deposit", slotId: "boundary-a" },
] as const satisfies readonly GuaranteeSlot[];

function fnv1a64(text: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash;
}

function contentDomain(seed: SeedDecimal, campAnchor: WorldPoint, prototypeId: ResourcePrototypeId): string {
  return `${seed}|${CONTENT_PLACEMENT_VERSION}|${prototypeId}|${campAnchor.x}|${campAnchor.y}`;
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

function placementPrototypeSlug(prototypeId: ResourcePrototypeId): string {
  return prototypeId.replaceAll("_", "-");
}

function guaranteeCandidateTiles(
  seed: SeedDecimal,
  campAnchor: WorldPoint,
  slot: GuaranteeSlot,
): readonly Readonly<{ x: bigint; y: bigint; score: bigint }>[] {
  const campTileX = floorDiv(BigInt(campAnchor.x), NAV_UNITS_PER_TILE);
  const campTileY = floorDiv(BigInt(campAnchor.y), NAV_UNITS_PER_TILE);
  const campChunkX = floorDiv(campTileX, BigInt(RUNTIME_CHUNK_SIZE));
  const campChunkY = floorDiv(campTileY, BigInt(RUNTIME_CHUNK_SIZE));
  const candidates: Array<Readonly<{ x: bigint; y: bigint; score: bigint }>> = [];
  const maximum = slot.slotId === "initial-observation" ? 4 : slot.slotId === "boundary-a" ? 96 : 20;
  for (let offsetY = -maximum; offsetY <= maximum; offsetY += 1) {
    for (let offsetX = -maximum; offsetX <= maximum; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) continue;
      const chebyshev = Math.max(Math.abs(offsetX), Math.abs(offsetY));
      if (slot.slotId === "initial-observation") {
        const dx = BigInt(offsetX) * NAV_UNITS_PER_TILE;
        const dy = BigInt(offsetY) * NAV_UNITS_PER_TILE;
        const radius = 4n * NAV_UNITS_PER_TILE;
        if (dx * dx + dy * dy > radius * radius) continue;
      } else if (slot.slotId === "boundary-a") {
        if (chebyshev < 64 || chebyshev > 96) continue;
      } else if (chebyshev < 6 || chebyshev > 20) continue;
      const x = campTileX + BigInt(offsetX);
      const y = campTileY + BigInt(offsetY);
      if (!isTileCoordinateInBounds(x) || !isTileCoordinateInBounds(y)) continue;
      if (slot.slotId === "boundary-a") {
        const chunkX = floorDiv(x, BigInt(RUNTIME_CHUNK_SIZE));
        const chunkY = floorDiv(y, BigInt(RUNTIME_CHUNK_SIZE));
        if (chunkX === campChunkX && chunkY === campChunkY) continue;
        if (chunkX < campChunkX - 1n || chunkX > campChunkX + 1n || chunkY < campChunkY - 1n || chunkY > campChunkY + 1n) continue;
      }
      const score = fnv1a64(`${contentDomain(seed, campAnchor, slot.prototypeId)}|guarantee|${slot.slotId}|${x}|${y}`);
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

/** Resumable creation gate for all eight camp-guaranteed resource nodes. */
export class GuaranteePlacementStepper {
  private readonly generator: Generator<GuaranteePlacementResult, readonly ResourcePlacementDefinition[], void>;
  private final: readonly ResourcePlacementDefinition[] | null = null;

  constructor(seed: SeedDecimal, campAnchor: WorldPoint, terrain: TerrainSnapshot) {
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

  private *generate(seed: SeedDecimal, campAnchor: WorldPoint, terrain: TerrainSnapshot): Generator<GuaranteePlacementResult, readonly ResourcePlacementDefinition[], void> {
    const fog = fullyRevealedGuaranteeFog(campAnchor);
    const selected: ResourcePlacementDefinition[] = [];
    const occupiedTiles = new Set<string>();
    for (const slot of GUARANTEE_SLOTS) {
      let placement: ResourcePlacementDefinition | null = null;
      for (const candidate of guaranteeCandidateTiles(seed, campAnchor, slot)) {
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
          if (result.kind === "terrain-required" || result.kind === "yield") {
            yield result;
            continue;
          }
          if (result.kind === "route") plan = result.plan;
          else break;
        }
        if (plan === null) continue;
        placement = {
          placementId: `place:${placementPrototypeSlug(slot.prototypeId)}:guarantee:${slot.slotId}`,
          prototypeId: slot.prototypeId,
          source: "guarantee",
          tileX: candidate.x.toString(), tileY: candidate.y.toString(), point,
        };
        occupiedTiles.add(tileKey);
        break;
      }
      if (placement === null) throw new ContentPlacementError(`unable to place guarantee slot ${slot.prototypeId}/${slot.slotId}`);
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
  prototypeId: ResourcePrototypeId = WILD_FIBER_PROTOTYPE_ID,
): ResourcePlacementDefinition {
  const domain = `${contentDomain(seed, campAnchor, prototypeId)}|ambient|${cellX}|${cellY}`;
  const offsetX = fnv1a64(`${domain}|x`) % CONTENT_CELL_SIZE_TILES;
  const offsetY = fnv1a64(`${domain}|y`) % CONTENT_CELL_SIZE_TILES;
  const tileX = cellX * CONTENT_CELL_SIZE_TILES + offsetX;
  const tileY = cellY * CONTENT_CELL_SIZE_TILES + offsetY;
  return {
    placementId: `place:${placementPrototypeSlug(prototypeId)}:ambient:${cellX}:${cellY}`,
    prototypeId,
    source: "ambient",
    tileX: tileX.toString(), tileY: tileY.toString(), point: pointForTile(tileX, tileY),
  };
}

export function ambientPlacementCandidates(seed: SeedDecimal, campAnchor: WorldPoint, cellX: bigint, cellY: bigint): readonly ResourcePlacementDefinition[] {
  return RESOURCE_PROTOTYPE_ORDER.map((prototypeId) => ambientPlacementCandidate(seed, campAnchor, cellX, cellY, prototypeId));
}

export function resolveAmbientPlacementConflicts(
  candidates: readonly ResourcePlacementDefinition[],
  occupiedTileKeys: ReadonlySet<string> = new Set(),
): readonly ResourcePlacementDefinition[] {
  const occupied = new Set(occupiedTileKeys);
  const resolved: ResourcePlacementDefinition[] = [];
  for (const prototypeId of RESOURCE_PROTOTYPE_ORDER) {
    const candidate = candidates.find((value) => value.prototypeId === prototypeId);
    if (candidate === undefined) continue;
    const tileKey = `${candidate.tileX},${candidate.tileY}`;
    if (occupied.has(tileKey)) continue;
    occupied.add(tileKey);
    resolved.push(candidate);
  }
  return resolved;
}

export function contentCellForTile(tile: bigint): bigint {
  return floorDiv(tile, CONTENT_CELL_SIZE_TILES);
}

export function authoritativeResourceDuration(
  prototypeId: ResourcePrototypeId,
  level: number,
  equippedToolSpeedBps = 0,
): Readonly<{ durationMs: bigint; skillSpeedBps: number; toolSpeedBps: number; totalSpeedBps: number }> {
  const definition = resourceDefinition(prototypeId);
  if (!Number.isInteger(level) || level < 1 || level > 100) throw new RangeError(`${definition.skillId} level must be 1..100`);
  if (!Number.isInteger(equippedToolSpeedBps) || equippedToolSpeedBps < 0) throw new RangeError("tool speed must be a non-negative integer");
  const skillSpeedBps = Math.min(Math.max(level - definition.requiredLevel, 0) * 50, 2_500);
  const totalSpeedBps = skillSpeedBps + equippedToolSpeedBps;
  const duration = (definition.baseDurationMs * 10_000n + BigInt(10_000 + totalSpeedBps) - 1n) / BigInt(10_000 + totalSpeedBps);
  const floorDuration = (definition.baseDurationMs * 2_500n + 9_999n) / 10_000n;
  return {
    durationMs: duration > floorDuration ? duration : floorDuration,
    skillSpeedBps,
    toolSpeedBps: equippedToolSpeedBps,
    totalSpeedBps,
  };
}

export function authoritativeGatherDuration(level: number): Readonly<{ durationMs: bigint; skillSpeedBps: number }> {
  const result = authoritativeResourceDuration("wild_fiber", level);
  return { durationMs: result.durationMs, skillSpeedBps: result.skillSpeedBps };
}

export function authoritativeCraftingDuration(
  recipeId: RecipeId,
  level: number,
): Readonly<{ durationMs: bigint; skillSpeedBps: number; totalSpeedBps: number }> {
  const definition = recipeDefinition(recipeId);
  if (!Number.isInteger(level) || level < 1 || level > 100) throw new RangeError("crafting level must be 1..100");
  const skillSpeedBps = Math.min(Math.max(level - definition.requiredLevel, 0) * 50, 2_500);
  const duration = (definition.baseDurationMs * 10_000n + BigInt(10_000 + skillSpeedBps) - 1n) / BigInt(10_000 + skillSpeedBps);
  const floorDuration = (definition.baseDurationMs * 2_500n + 9_999n) / 10_000n;
  return { durationMs: duration > floorDuration ? duration : floorDuration, skillSpeedBps, totalSpeedBps: skillSpeedBps };
}

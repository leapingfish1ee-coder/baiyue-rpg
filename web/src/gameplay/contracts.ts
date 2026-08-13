import { CHUNK_COORDINATE_MAX, CHUNK_COORDINATE_MIN, WORLD_POINT_NAV_MAX, WORLD_POINT_NAV_MIN } from "../world-contract.ts";
import type { ItemId, MaterialItemId, RecipeId, ResourcePrototypeId, ResourceSkillId, ResourceTaskKind, SkillId, ToolItemId, ToolSlot } from "./content.ts";

export const GAMEPLAY_PROTOCOL_VERSION = 1 as const;
export const DB_SCHEMA_VERSION = 1 as const;
export const SAVE_SCHEMA_VERSION = 4 as const;
export const GAME_RULES_VERSION = 4 as const;
export const CONTENT_VERSION = 4 as const;
export const EXPORT_FORMAT_VERSION = 1 as const;
export const SAVE_ID = "save:local" as const;

export type SafeUint = number;
export type SafeInt = number;
export type U32 = number;
export type SignedDecimal = string;
export type UnsignedDecimal = string;
export type SeedDecimal = UnsignedDecimal;
export type WorldTimeDecimal = UnsignedDecimal;
export type CostDecimal = UnsignedDecimal;
export type EtaDecimal = UnsignedDecimal;
export type ChunkDecimal = SignedDecimal;
export type NavDecimal = SignedDecimal;
export type RequestId = string;
export type CommandId = string;
export type TaskId = string;
export type PlacementId = string;
export type ActionId = string;
export type TerrainRequestId = string;
export type ClaimId = string;
export type DiagnosticId = string;
export type ChunkKey = string;

export type WorldPoint = Readonly<{ x: NavDecimal; y: NavDecimal }>;

export type ActivityReason =
  | Readonly<{ code: "TaskCompleted"; params: null; allowedActions: readonly ["set_task"]; diagnosticId: null }>
  | Readonly<{ code: "NoReachableTargetOrFrontier"; params: null; allowedActions: readonly ["set_task"]; diagnosticId: null }>
  | Readonly<{ code: "DestinationUnreachable"; params: Readonly<{ destination: WorldPoint }>; allowedActions: readonly ["set_task"]; diagnosticId: null }>
  | Readonly<{ code: "MissingTool"; params: Readonly<{ slot: ToolSlot; minimumTier: SafeUint }>; allowedActions: readonly ["equip_item", "set_task"]; diagnosticId: null }>
  | Readonly<{ code: "MaterialsMissing"; params: Readonly<{ recipeId: RecipeId; materials: readonly Readonly<{ itemId: MaterialItemId; displayName: "纤维" | "软木" | "石料" | "绳索"; required: SafeUint; available: SafeUint; missing: SafeUint }>[] }>; allowedActions: readonly ["set_task"]; diagnosticId: null }>
  | Readonly<{ code: "storage_write_failed"; params: null; allowedActions: readonly ["open_system", "export", "reset", "retry"]; diagnosticId: DiagnosticId }>
  | Readonly<{ code: "incompatible_save"; params: Readonly<{ expected: U32; actual: U32; version: "db" | "save" | "rules" | "content" | "generator" }>; allowedActions: readonly ["export", "reset"]; diagnosticId: DiagnosticId }>
  | Readonly<{ code: "active_in_other_tab"; params: null; allowedActions: readonly ["retry"]; diagnosticId: null }>
  | Readonly<{ code: "integrity/quantity_overflow"; params: null; allowedActions: readonly ["open_system", "export", "reset"]; diagnosticId: DiagnosticId }>
  | Readonly<{ code: "undefined_failure"; params: null; allowedActions: readonly ["open_system", "export", "reset"]; diagnosticId: DiagnosticId }>;

export type ProtocolError =
  | Readonly<{ code: "protocol/unknown_message" | "protocol/invalid_message"; params: null; diagnosticId: DiagnosticId }>
  | Readonly<{ code: "protocol/version_mismatch"; params: Readonly<{ expected: 1; actual: U32 | null }>; diagnosticId: DiagnosticId }>;

export type LifecycleError =
  | Readonly<{ code: "save/incompatible_version"; params: Readonly<{ expected: U32; actual: U32; version: "db" | "save" | "rules" | "content" | "generator" }>; diagnosticId: DiagnosticId }>
  | Readonly<{ code: "storage/unavailable" | "storage/write_failed" | "storage/quota_exceeded" | "storage/integrity_failed"; params: null; diagnosticId: DiagnosticId }>
  | Readonly<{ code: "platform/web_locks_unavailable" | "active_in_other_tab"; params: null; diagnosticId: DiagnosticId | null }>
  | Readonly<{ code: "integrity/quantity_overflow"; params: null; diagnosticId: DiagnosticId }>
  | Readonly<{ code: "undefined_failure"; params: null; diagnosticId: DiagnosticId }>;

export type CommandError =
  | Readonly<{ code: "command/id_conflict"; params: Readonly<{ commandId: CommandId }>; diagnosticId: null }>
  | Readonly<{ code: "command/invalid_seed"; params: null; diagnosticId: null }>
  | Readonly<{ code: "command/invalid_destination"; params: Readonly<{ destination: WorldPoint }>; diagnosticId: null }>
  | Readonly<{ code: "command/unknown_target_prototype" | "command/content_placement_failed" | "command/item_unavailable" | "command/invalid_equipment"; params: null; diagnosticId: null }>
  | Readonly<{ code: "command/skill_level_too_low"; params: Readonly<{ prototypeId: ResourcePrototypeId; skillId: ResourceSkillId; requiredLevel: SafeUint; actualLevel: SafeUint }>; diagnosticId: null }>
  | Readonly<{ code: "command/recipe_level_too_low"; params: Readonly<{ recipeId: RecipeId; skillId: "crafting"; requiredLevel: SafeUint; actualLevel: SafeUint }>; diagnosticId: null }>
  | Readonly<{ code: "command/equipment_level_too_low"; params: Readonly<{ itemId: ToolItemId; skillId: ResourceSkillId; requiredLevel: SafeUint; actualLevel: SafeUint }>; diagnosticId: null }>
  | Readonly<{ code: "command/confirmation_required"; params: Readonly<{ command: "ImportSave" | "ResetSave" }>; diagnosticId: null }>
  | Readonly<{ code: "save/not_found"; params: null; diagnosticId: null }>
  | Readonly<{ code: "save/incompatible_version"; params: Readonly<{ expected: U32; actual: U32; version: "db" | "save" | "rules" | "content" | "generator" }>; diagnosticId: DiagnosticId }>
  | Readonly<{ code: "storage/unavailable" | "storage/write_failed" | "storage/quota_exceeded" | "storage/integrity_failed"; params: null; diagnosticId: DiagnosticId }>
  | Readonly<{ code: "platform/web_locks_unavailable" | "active_in_other_tab"; params: null; diagnosticId: DiagnosticId | null }>
  | Readonly<{ code: "backup/file_too_large" | "backup/invalid_utf8" | "backup/invalid_json" | "backup/invalid_product" | "backup/incompatible_export_version" | "backup/incompatible_version" | "backup/invalid_shape" | "backup/invalid_id" | "backup/non_canonical_decimal" | "backup/coordinate_out_of_range" | "backup/unsafe_integer" | "backup/duplicate_chunk" | "backup/checksum_mismatch" | "integrity/quantity_overflow" | "undefined_failure"; params: null; diagnosticId: DiagnosticId }>;

export type FatalError = LifecycleError;

export type ExploreTask = Readonly<{
  taskId: TaskId;
  kind: "Explore";
  mode: "continuous" | "destination";
  destination: WorldPoint | null;
  createdWorldTimeMs: WorldTimeDecimal;
}>;

export type GatherTask = Readonly<{
  taskId: TaskId;
  kind: "Gather";
  targetPrototypeId: "wild_fiber";
  quantity: SafeUint | null;
  completedQuantity: SafeUint;
  createdWorldTimeMs: WorldTimeDecimal;
}>;

export type WoodcutTask = Readonly<{
  taskId: TaskId;
  kind: "Woodcut";
  targetPrototypeId: "softwood_tree";
  quantity: SafeUint | null;
  completedQuantity: SafeUint;
  createdWorldTimeMs: WorldTimeDecimal;
}>;

export type MineTask = Readonly<{
  taskId: TaskId;
  kind: "Mine";
  targetPrototypeId: "surface_stone" | "shallow_copper_deposit";
  quantity: SafeUint | null;
  completedQuantity: SafeUint;
  createdWorldTimeMs: WorldTimeDecimal;
}>;

export type ResourceTask = GatherTask | WoodcutTask | MineTask;
export type ProduceTask = Readonly<{
  taskId: TaskId;
  kind: "Produce";
  recipeId: RecipeId;
  requestedQuantity: SafeUint | null;
  completedQuantity: SafeUint;
  createdWorldTimeMs: WorldTimeDecimal;
}>;
export type TaskIntent = ExploreTask | ResourceTask | ProduceTask;

export type ResourceActionSummary = Readonly<{
  kind: "Resource";
  actionId: ActionId;
  placementId: PlacementId;
  prototypeId: ResourcePrototypeId;
  baseDurationMs: WorldTimeDecimal;
  durationMs: WorldTimeDecimal;
  remainingMs: WorldTimeDecimal;
  skillSpeedBps: SafeUint;
  toolSpeedBps: SafeUint;
  totalSpeedBps: SafeUint;
}>;

export type ProductionActionSummary = Readonly<{
  kind: "Produce";
  actionId: ActionId;
  recipeId: RecipeId;
  baseDurationMs: WorldTimeDecimal;
  durationMs: WorldTimeDecimal;
  remainingMs: WorldTimeDecimal;
  skillSpeedBps: SafeUint;
  totalSpeedBps: SafeUint;
}>;

export type NonCombatActionSummary = ResourceActionSummary | ProductionActionSummary;

export type Activity = Readonly<{
  state: "idle" | "planning" | "moving" | "acting" | "waiting" | "paused";
  phase: "idle" | "exploring" | "acquiring_target" | "moving_to_target" | "resource_action" | "production_action" | "auto_exploring" | "waiting" | "paused";
  route: readonly WorldPoint[];
  routePurpose: "explore" | "task_target" | "auto_explore" | null;
  routeIndex: SafeUint;
  etaMs: EtaDecimal | null;
  progressPermille: number | null;
  targetPlacementId: PlacementId | null;
  action: NonCombatActionSummary | null;
  reason: ActivityReason | null;
}>;

export type ResourcePlacementSummary = Readonly<{
  placementId: PlacementId;
  prototypeId: ResourcePrototypeId;
  displayName: "野生纤维" | "软木树" | "地表石" | "浅层铜矿";
  taskKind: ResourceTaskKind;
  skillId: ResourceSkillId;
  requiredLevel: SafeUint;
  locked: boolean;
  requiredTool: Readonly<{ slot: ToolSlot; minimumTier: SafeUint }> | null;
  mapColor: string;
  point: WorldPoint;
  state: "active" | "depleted" | "respawning";
  respawnRemainingMs: WorldTimeDecimal | null;
  reachable: "reachable" | "unreachable" | "unknown";
}>;

export type RevealedChunk = Readonly<{
  chunkKey: ChunkKey;
  chunkX: ChunkDecimal;
  chunkY: ChunkDecimal;
  revealedBase64: string;
}>;

export type OfflineReport = Readonly<{
  claimId: ClaimId;
  rawElapsedMs: SafeInt;
  clockSkew: "none" | "backward";
  creditedDurationMs: UnsignedDecimal;
  discardedDurationMs: UnsignedDecimal;
  fromWorldTimeMs: WorldTimeDecimal;
  toWorldTimeMs: WorldTimeDecimal;
  taskBefore: TaskIntent | null;
  taskAfter: TaskIntent | null;
  revealedTiles: SafeUint;
  itemDeltas: readonly Readonly<{ itemId: ItemId; displayName: "纤维" | "软木" | "石料" | "铜矿石" | "绳索" | "破旧斧" | "破旧镐" | "强化斧" | "强化镐"; quantity: SafeInt }>[];
  skillXpGains: readonly Readonly<{ skillId: "exploration" | SkillId; displayName: "探索" | "采集" | "伐木" | "采矿" | "工艺"; xp: SafeUint }>[];
  stopReason: ActivityReason | null;
  committedRevision: SafeUint;
}>;

export type GameplayReadModelV1 = Readonly<{
  protocolVersion: 1;
  readModelRevision: SafeUint;
  gameplayEpoch: SafeUint;
  startup: "acquiring_lock" | "loading_save" | "new_world" | "processing_offline" | "ready" | "active_in_other_tab" | "incompatible_save" | "storage_blocked";
  generatorVersion: U32 | null;
  player: Readonly<{ position: WorldPoint; hp: Readonly<{ current: 100; max: 100 }>; combatScope: "not_implemented_phase_2c" }> | null;
  task: TaskIntent | null;
  activity: Activity;
  exploration: Readonly<{ level: SafeUint; totalXp: SafeUint; currentLevelXp: SafeUint; nextLevelXp: SafeUint | null; observationRadiusTiles: SafeUint; revealedTileCount: SafeUint }> | null;
  skills: Readonly<Record<SkillId, Readonly<{ level: SafeUint; totalXp: SafeUint; currentLevelXp: SafeUint; nextLevelXp: SafeUint | null; skillSpeedBps: SafeUint }>>> | null;
  inventory: Readonly<{ items: readonly Readonly<{ itemId: ItemId; displayName: "纤维" | "软木" | "石料" | "铜矿石" | "绳索" | "破旧斧" | "破旧镐" | "强化斧" | "强化镐"; category: "material" | "equipment"; quantity: SafeUint }>[] }> | null;
  equipment: Readonly<Record<ToolSlot, Readonly<{ itemId: ToolItemId; displayName: "破旧斧" | "破旧镐" | "强化斧" | "强化镐"; tier: SafeUint; speedBps: SafeUint }> | null>> | null;
  toolCandidates: readonly Readonly<{ itemId: ToolItemId; displayName: "破旧斧" | "破旧镐" | "强化斧" | "强化镐"; slot: ToolSlot; tier: SafeUint; speedBps: SafeUint; requiredSkillId: ResourceSkillId; requiredLevel: SafeUint; actualLevel: SafeUint; canEquip: boolean; inventoryQuantity: SafeUint; equipped: boolean }>[];
  recipes: readonly Readonly<{ recipeId: RecipeId; displayName: "绳索" | "强化斧" | "强化镐"; skillId: "crafting"; requiredLevel: SafeUint; locked: boolean; inputs: readonly Readonly<{ itemId: MaterialItemId; displayName: "纤维" | "软木" | "石料" | "绳索"; required: SafeUint; available: SafeUint; missing: SafeUint }>[]; output: Readonly<{ itemId: ItemId; displayName: "绳索" | "强化斧" | "强化镐"; quantity: 1 }>; baseDurationMs: WorldTimeDecimal; durationMs: WorldTimeDecimal; skillSpeedBps: SafeUint; totalSpeedBps: SafeUint; xp: SafeUint; station: "handcraft" }>[];
  knownTargetPrototypeIds: readonly ResourcePrototypeId[];
  map: Readonly<{ revealedChunks: readonly RevealedChunk[]; resourcePlacements: readonly ResourcePlacementSummary[]; selectedDestination: null }>;
  save: Readonly<{ state: "none" | "saving" | "saved" | "error" | "incompatible" | "active_in_other_tab"; revision: SafeUint; committedWallClockMs: SafeUint | null; localOnly: true; evictionWarning: boolean; lastError: ActivityReason | null }>;
  offlineReport: OfflineReport | null;
}>;

export type GameplayCommand =
  | Readonly<{ type: "CreateWorld"; commandId: CommandId; seed: SeedDecimal; seedSource: "automatic" | "manual"; wallClockMs: SafeUint }>
  | Readonly<{ type: "SetTask"; commandId: CommandId; task: Readonly<{ kind: "Explore"; mode: "continuous"; destination: null }>; wallClockMs: SafeUint }>
  | Readonly<{ type: "SetTask"; commandId: CommandId; task: Readonly<{ kind: "Explore"; mode: "destination"; destination: WorldPoint }>; wallClockMs: SafeUint }>
  | Readonly<{ type: "SetTask"; commandId: CommandId; task: Readonly<{ kind: "Gather"; targetPrototypeId: "wild_fiber"; quantity: SafeUint | null }>; wallClockMs: SafeUint }>
  | Readonly<{ type: "SetTask"; commandId: CommandId; task: Readonly<{ kind: "Woodcut"; targetPrototypeId: "softwood_tree"; quantity: SafeUint | null }>; wallClockMs: SafeUint }>
  | Readonly<{ type: "SetTask"; commandId: CommandId; task: Readonly<{ kind: "Mine"; targetPrototypeId: "surface_stone" | "shallow_copper_deposit"; quantity: SafeUint | null }>; wallClockMs: SafeUint }>
  | Readonly<{ type: "SetTask"; commandId: CommandId; task: Readonly<{ kind: "Produce"; recipeId: RecipeId; requestedQuantity: SafeUint | null }>; wallClockMs: SafeUint }>
  | Readonly<{ type: "EquipItem"; commandId: CommandId; itemId: ToolItemId; wallClockMs: SafeUint }>
  | Readonly<{ type: "UnequipSlot"; commandId: CommandId; slot: ToolSlot; wallClockMs: SafeUint }>
  | Readonly<{ type: "CancelTask" | "ExportSave"; commandId: CommandId; wallClockMs: SafeUint }>
  | Readonly<{ type: "ImportSave"; commandId: CommandId; backupUtf8: ArrayBuffer; confirmed: true; wallClockMs: SafeUint }>
  | Readonly<{ type: "ResetSave"; commandId: CommandId; confirmed: true; wallClockMs: SafeUint }>;

export type MainToGameplayWorker =
  | Readonly<{ type: "initialize"; protocolVersion: 1; requestId: RequestId; generatorVersion: U32; wallClockMs: SafeUint }>
  | Readonly<{ type: "command"; protocolVersion: 1; requestId: RequestId; command: GameplayCommand }>
  | Readonly<{ type: "terrain-result"; protocolVersion: 1; terrainRequestId: TerrainRequestId; gameplayEpoch: SafeUint; chunkKey: ChunkKey; chunkX: ChunkDecimal; chunkY: ChunkDecimal; generatorVersion: U32; baseTerrain: ArrayBuffer }>
  | Readonly<{ type: "terrain-error"; protocolVersion: 1; terrainRequestId: TerrainRequestId; gameplayEpoch: SafeUint; code: "terrain/generation_failed" | "terrain/payload_invalid"; transient: boolean; diagnosticId: DiagnosticId }>
  | Readonly<{ type: "flush"; protocolVersion: 1; requestId: RequestId; wallClockMs: SafeUint }>
  | Readonly<{ type: "shutdown"; protocolVersion: 1; requestId: RequestId }>;

export type GameplayWorkerToMain =
  | Readonly<{ type: "worker-ready"; protocolVersion: 1 }>
  | Readonly<{ type: "request-result"; protocolVersion: 1; requestId: RequestId; operation: "initialize" | "flush" | "shutdown"; status: "accepted" | "rejected"; readModelRevision: SafeUint; saveRevision: SafeUint; error: LifecycleError | null }>
  | Readonly<{ type: "protocol-error"; protocolVersion: 1; requestId: RequestId | null; error: ProtocolError; readModelRevision: SafeUint; saveRevision: SafeUint }>
  | Readonly<{ type: "terrain-request"; protocolVersion: 1; terrainRequestId: TerrainRequestId; gameplayEpoch: SafeUint; readModelRevision: SafeUint; seed: SeedDecimal; chunkKey: ChunkKey; chunkX: ChunkDecimal; chunkY: ChunkDecimal }>
  | Readonly<{ type: "read-model"; protocolVersion: 1; readModel: GameplayReadModelV1 }>
  | Readonly<{ type: "command-result"; protocolVersion: 1; requestId: RequestId; commandId: CommandId; status: "accepted" | "rejected"; readModelRevision: SafeUint; saveRevision: SafeUint; error: CommandError | null }>
  | Readonly<{ type: "offline-progress"; protocolVersion: 1; claimId: ClaimId; processedDurationMs: UnsignedDecimal; creditedDurationMs: UnsignedDecimal; sliceMaxMs: number }>
  | Readonly<{ type: "export-ready"; protocolVersion: 1; requestId: RequestId; commandId: CommandId; saveRevision: SafeUint; filename: string; backupUtf8: ArrayBuffer }>
  | Readonly<{ type: "fatal"; protocolVersion: 1; error: FatalError; readModelRevision: SafeUint; saveRevision: SafeUint }>;

const UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const SIGNED_DECIMAL = /^(?:0|-?[1-9][0-9]*)$/;
const REQUEST_ID = /^req:[0-9a-f]{16}:(?:0|[1-9][0-9]*)$/;
const COMMAND_ID = /^cmd:[0-9a-f]{16}:(?:0|[1-9][0-9]*)$/;
const TASK_ID = /^task:[0-9a-f]{16}:(?:0|[1-9][0-9]*)$/;
const PLACEMENT_ID = /^place:(?:(?:wild-fiber|softwood-tree|surface-stone|shallow-copper-deposit):ambient:(?:0|-?[1-9][0-9]*):(?:0|-?[1-9][0-9]*)|wild-fiber:guarantee:(?:initial-observation|ring-a|ring-b)|(?:softwood-tree|surface-stone):guarantee:(?:initial-observation|ring-a)|shallow-copper-deposit:guarantee:boundary-a)$/;
const ACTION_ID = /^action:(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*)$/;
const TERRAIN_REQUEST_ID = /^terrain:(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*)$/;
const CLAIM_ID = /^claim:(?:0|[1-9][0-9]*):(?:0|[1-9][0-9]*)$/;
const DIAGNOSTIC_ID = /^diag:[a-z][a-z0-9]*(?:-[a-z0-9]+)*:[a-z][a-z0-9]*(?:-[a-z0-9]+)*:[0-9a-f]{16}$/;
const PADDED_FOG_BASE64 = /^(?:[A-Za-z0-9+/]{4}){170}[A-Za-z0-9+/]{3}=$/;
const MAX_EXACT = (1n << 127n) - 1n;
const MAX_SEED = (1n << 64n) - 1n;
const MIN_NAV = WORLD_POINT_NAV_MIN;
const MAX_NAV = WORLD_POINT_NAV_MAX;
const MIN_CHUNK = CHUNK_COORDINATE_MIN;
const MAX_CHUNK = CHUNK_COORDINATE_MAX;
const RESOURCE_PROTOTYPE_IDS = ["wild_fiber", "softwood_tree", "surface_stone", "shallow_copper_deposit"] as const;
const MATERIAL_ITEM_IDS = ["fiber", "softwood", "stone", "copper_ore", "rope"] as const;
const TOOL_ITEM_IDS = ["worn_axe", "worn_pickaxe", "reinforced_axe", "reinforced_pickaxe"] as const;
const RESOURCE_SKILL_IDS = ["gathering", "woodcutting", "mining"] as const;
const SKILL_IDS = [...RESOURCE_SKILL_IDS, "crafting"] as const;
const RECIPE_IDS = ["rope", "reinforced_axe", "reinforced_pickaxe"] as const;
const ITEM_DISPLAY_NAMES = {
  fiber: "纤维", softwood: "软木", stone: "石料", copper_ore: "铜矿石", rope: "绳索",
  worn_axe: "破旧斧", worn_pickaxe: "破旧镐", reinforced_axe: "强化斧", reinforced_pickaxe: "强化镐",
} as const satisfies Record<ItemId, string>;
const TOOL_CONTRACTS = {
  worn_axe: { slot: "axe", tier: 0, speedBps: 0, requiredSkillId: "woodcutting", requiredLevel: 1 },
  worn_pickaxe: { slot: "pickaxe", tier: 0, speedBps: 0, requiredSkillId: "mining", requiredLevel: 1 },
  reinforced_axe: { slot: "axe", tier: 1, speedBps: 1_000, requiredSkillId: "woodcutting", requiredLevel: 2 },
  reinforced_pickaxe: { slot: "pickaxe", tier: 1, speedBps: 1_000, requiredSkillId: "mining", requiredLevel: 2 },
} as const satisfies Record<ToolItemId, Readonly<{ slot: ToolSlot; tier: number; speedBps: number; requiredSkillId: ResourceSkillId; requiredLevel: number }>>;
const RECIPE_CONTRACTS = {
  rope: { displayName: "绳索", requiredLevel: 1, inputs: [["fiber", 2]], baseDurationMs: "12000", output: "rope", xp: 12 },
  reinforced_axe: { displayName: "强化斧", requiredLevel: 2, inputs: [["softwood", 4], ["rope", 2], ["stone", 2]], baseDurationMs: "30000", output: "reinforced_axe", xp: 30 },
  reinforced_pickaxe: { displayName: "强化镐", requiredLevel: 2, inputs: [["softwood", 4], ["rope", 2], ["stone", 3]], baseDurationMs: "30000", output: "reinforced_pickaxe", xp: 30 },
} as const satisfies Record<RecipeId, Readonly<{
  displayName: string;
  requiredLevel: number;
  inputs: readonly (readonly [MaterialItemId, number])[];
  baseDurationMs: string;
  output: ItemId;
  xp: number;
}>>;

function isResourcePrototype(value: unknown): value is ResourcePrototypeId {
  return typeof value === "string" && (RESOURCE_PROTOTYPE_IDS as readonly string[]).includes(value);
}

function isMaterialItem(value: unknown): value is MaterialItemId {
  return typeof value === "string" && (MATERIAL_ITEM_IDS as readonly string[]).includes(value);
}

function isToolItem(value: unknown): value is ToolItemId {
  return typeof value === "string" && (TOOL_ITEM_IDS as readonly string[]).includes(value);
}

function isResourceSkill(value: unknown): value is ResourceSkillId {
  return typeof value === "string" && (RESOURCE_SKILL_IDS as readonly string[]).includes(value);
}

function isSkill(value: unknown): value is SkillId {
  return typeof value === "string" && (SKILL_IDS as readonly string[]).includes(value);
}

function isRecipe(value: unknown): value is RecipeId {
  return typeof value === "string" && (RECIPE_IDS as readonly string[]).includes(value);
}

function isItem(value: unknown): value is ItemId {
  return isMaterialItem(value) || isToolItem(value);
}

function expectedDurationMs(baseDurationMs: string, speedBps: number): string {
  const base = BigInt(baseDurationMs);
  const divisor = BigInt(10_000 + speedBps);
  const duration = (base * 10_000n + divisor - 1n) / divisor;
  const floorDuration = (base * 2_500n + 9_999n) / 10_000n;
  return (duration > floorDuration ? duration : floorDuration).toString();
}

function taskPrototypeMapping(kind: unknown, prototypeId: unknown): boolean {
  return (kind === "Gather" && prototypeId === "wild_fiber")
    || (kind === "Woodcut" && prototypeId === "softwood_tree")
    || (kind === "Mine" && (prototypeId === "surface_stone" || prototypeId === "shallow_copper_deposit"));
}

export function isSafeUint(value: unknown): value is SafeUint {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isU32(value: unknown): value is U32 {
  return isSafeUint(value) && value <= 0xffff_ffff;
}

export function isCanonicalUnsignedDecimal(value: unknown, maximum = MAX_EXACT): value is UnsignedDecimal {
  return typeof value === "string" && UNSIGNED_DECIMAL.test(value) && BigInt(value) <= maximum;
}

export function isCanonicalSignedDecimal(value: unknown, minimum: bigint, maximum: bigint): value is SignedDecimal {
  if (typeof value !== "string" || !SIGNED_DECIMAL.test(value)) return false;
  const parsed = BigInt(value);
  return parsed >= minimum && parsed <= maximum;
}

export function isWorldPoint(value: unknown): value is WorldPoint {
  return hasExactKeys(value, ["x", "y"]) && isCanonicalSignedDecimal(value.x, MIN_NAV, MAX_NAV) && isCanonicalSignedDecimal(value.y, MIN_NAV, MAX_NAV);
}

function hasExactKeys<const K extends string>(value: unknown, keys: readonly K[]): value is Record<K, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedSessionId(value: unknown, pattern: RegExp): value is string {
  if (typeof value !== "string" || !pattern.test(value)) return false;
  const counterText = value.slice(value.lastIndexOf(":") + 1);
  return counterText.length <= 16 && BigInt(counterText) <= BigInt(Number.MAX_SAFE_INTEGER);
}

function boundedPairId(value: unknown, pattern: RegExp, firstMinimum: bigint, firstMaximum: bigint, secondMaximum: bigint): value is string {
  if (typeof value !== "string" || !pattern.test(value)) return false;
  const parts = value.split(":");
  const first = parts[1];
  const second = parts[2];
  if (first === undefined || second === undefined || first.length > 39 || second.length > 39) return false;
  const firstValue = BigInt(first);
  return firstValue >= firstMinimum && firstValue <= firstMaximum && BigInt(second) <= secondMaximum;
}

export function isRequestId(value: unknown): value is RequestId {
  return boundedSessionId(value, REQUEST_ID);
}

export function isCommandId(value: unknown): value is CommandId {
  return boundedSessionId(value, COMMAND_ID);
}

export function isTaskId(value: unknown): value is TaskId {
  return boundedSessionId(value, TASK_ID);
}

export function isPlacementId(value: unknown): value is PlacementId {
  return typeof value === "string" && PLACEMENT_ID.test(value);
}

export function isActionId(value: unknown): value is ActionId {
  return boundedPairId(value, ACTION_ID, 0n, MAX_EXACT, MAX_EXACT);
}

export function isTerrainRequestId(value: unknown): value is TerrainRequestId {
  return boundedPairId(value, TERRAIN_REQUEST_ID, 0n, BigInt(Number.MAX_SAFE_INTEGER), BigInt(Number.MAX_SAFE_INTEGER));
}

export function isTerrainRequestIdForEpoch(value: unknown, gameplayEpoch: unknown): value is TerrainRequestId {
  if (!isTerrainRequestId(value) || !isSafeUint(gameplayEpoch)) return false;
  const epochText = value.split(":")[1];
  return epochText !== undefined && BigInt(epochText) === BigInt(gameplayEpoch);
}

export function isClaimId(value: unknown): value is ClaimId {
  return boundedPairId(value, CLAIM_ID, 1n, BigInt(Number.MAX_SAFE_INTEGER), BigInt(Number.MAX_SAFE_INTEGER));
}

export function isDiagnosticId(value: unknown): value is DiagnosticId {
  return typeof value === "string" && DIAGNOSTIC_ID.test(value);
}

export function isChunkCoordinate(value: unknown): value is ChunkDecimal {
  return isCanonicalSignedDecimal(value, MIN_CHUNK, MAX_CHUNK);
}

export function isChunkIdentity(key: unknown, chunkX: unknown, chunkY: unknown): key is ChunkKey {
  return typeof key === "string" && isChunkCoordinate(chunkX) && isChunkCoordinate(chunkY) && key === `${chunkX},${chunkY}`;
}

export function isSeedDecimal(value: unknown): value is SeedDecimal {
  return isCanonicalUnsignedDecimal(value, MAX_SEED);
}

export function isGameplayCommand(value: unknown): value is GameplayCommand {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as Record<string, unknown>;
  if (!isCommandId(command.commandId) || !isSafeUint(command.wallClockMs)) return false;
  switch (command.type) {
    case "CreateWorld":
      return hasExactKeys(command, ["type", "commandId", "seed", "seedSource", "wallClockMs"])
        && isSeedDecimal(command.seed) && (command.seedSource === "automatic" || command.seedSource === "manual");
    case "SetTask": {
      if (!hasExactKeys(command, ["type", "commandId", "task", "wallClockMs"]) || command.task === null || typeof command.task !== "object") return false;
      const task = command.task as Record<string, unknown>;
      if (task.kind === "Gather" || task.kind === "Woodcut" || task.kind === "Mine") {
        return hasExactKeys(task, ["kind", "targetPrototypeId", "quantity"])
          && taskPrototypeMapping(task.kind, task.targetPrototypeId)
          && (task.quantity === null || (isSafeUint(task.quantity) && task.quantity > 0));
      }
      if (task.kind === "Produce") {
        return hasExactKeys(task, ["kind", "recipeId", "requestedQuantity"])
          && isRecipe(task.recipeId)
          && (task.requestedQuantity === null || (isSafeUint(task.requestedQuantity) && task.requestedQuantity > 0));
      }
      if (task.mode === "continuous") return hasExactKeys(task, ["kind", "mode", "destination"]) && task.kind === "Explore" && task.destination === null;
      return hasExactKeys(task, ["kind", "mode", "destination"]) && task.kind === "Explore" && task.mode === "destination" && isWorldPoint(task.destination);
    }
    case "EquipItem":
      return hasExactKeys(command, ["type", "commandId", "itemId", "wallClockMs"]) && isToolItem(command.itemId);
    case "UnequipSlot":
      return hasExactKeys(command, ["type", "commandId", "slot", "wallClockMs"]) && (command.slot === "axe" || command.slot === "pickaxe");
    case "CancelTask":
    case "ExportSave":
      return hasExactKeys(command, ["type", "commandId", "wallClockMs"]);
    case "ImportSave":
      return hasExactKeys(command, ["type", "commandId", "backupUtf8", "confirmed", "wallClockMs"])
        && command.backupUtf8 instanceof ArrayBuffer && command.backupUtf8.byteLength <= 33_554_432 && command.confirmed === true;
    case "ResetSave":
      return hasExactKeys(command, ["type", "commandId", "confirmed", "wallClockMs"]) && command.confirmed === true;
    default:
      return false;
  }
}

export function isMainToGameplayWorker(value: unknown): value is MainToGameplayWorker {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (message.protocolVersion !== GAMEPLAY_PROTOCOL_VERSION) return false;
  switch (message.type) {
    case "initialize":
      return hasExactKeys(message, ["type", "protocolVersion", "requestId", "generatorVersion", "wallClockMs"])
        && isRequestId(message.requestId) && isU32(message.generatorVersion) && isSafeUint(message.wallClockMs);
    case "command":
      return hasExactKeys(message, ["type", "protocolVersion", "requestId", "command"])
        && isRequestId(message.requestId) && isGameplayCommand(message.command);
    case "flush":
      return hasExactKeys(message, ["type", "protocolVersion", "requestId", "wallClockMs"])
        && isRequestId(message.requestId) && isSafeUint(message.wallClockMs);
    case "shutdown":
      return hasExactKeys(message, ["type", "protocolVersion", "requestId"]) && isRequestId(message.requestId);
    case "terrain-result":
      return hasExactKeys(message, ["type", "protocolVersion", "terrainRequestId", "gameplayEpoch", "chunkKey", "chunkX", "chunkY", "generatorVersion", "baseTerrain"])
        && isTerrainRequestIdForEpoch(message.terrainRequestId, message.gameplayEpoch)
        && isChunkIdentity(message.chunkKey, message.chunkX, message.chunkY) && isU32(message.generatorVersion)
        && message.baseTerrain instanceof ArrayBuffer && message.baseTerrain.byteLength === 4096;
    case "terrain-error":
      return hasExactKeys(message, ["type", "protocolVersion", "terrainRequestId", "gameplayEpoch", "code", "transient", "diagnosticId"])
        && isTerrainRequestIdForEpoch(message.terrainRequestId, message.gameplayEpoch)
        && (message.code === "terrain/generation_failed" || message.code === "terrain/payload_invalid")
        && typeof message.transient === "boolean" && isDiagnosticId(message.diagnosticId);
    default:
      return false;
  }
}

function isVersionParams(value: unknown): value is Readonly<{ expected: U32; actual: U32; version: "db" | "save" | "rules" | "content" | "generator" }> {
  return hasExactKeys(value, ["expected", "actual", "version"]) && isU32(value.expected) && isU32(value.actual)
    && ["db", "save", "rules", "content", "generator"].includes(value.version as string);
}

function isLifecycleError(value: unknown): value is LifecycleError {
  if (!hasExactKeys(value, ["code", "params", "diagnosticId"]) || typeof value.code !== "string") return false;
  if (value.code === "save/incompatible_version") return isVersionParams(value.params) && isDiagnosticId(value.diagnosticId);
  if (["storage/unavailable", "storage/write_failed", "storage/quota_exceeded", "storage/integrity_failed", "integrity/quantity_overflow", "undefined_failure"].includes(value.code)) {
    return value.params === null && isDiagnosticId(value.diagnosticId);
  }
  if (value.code === "platform/web_locks_unavailable" || value.code === "active_in_other_tab") {
    return value.params === null && (value.diagnosticId === null || isDiagnosticId(value.diagnosticId));
  }
  return false;
}

function isProtocolError(value: unknown): value is ProtocolError {
  if (!hasExactKeys(value, ["code", "params", "diagnosticId"]) || !isDiagnosticId(value.diagnosticId)) return false;
  if (value.code === "protocol/unknown_message" || value.code === "protocol/invalid_message") return value.params === null;
  return value.code === "protocol/version_mismatch" && hasExactKeys(value.params, ["expected", "actual"])
    && value.params.expected === 1 && (value.params.actual === null || isU32(value.params.actual));
}

function isCommandError(value: unknown): value is CommandError {
  if (!hasExactKeys(value, ["code", "params", "diagnosticId"]) || typeof value.code !== "string") return false;
  if (value.code === "command/id_conflict") return hasExactKeys(value.params, ["commandId"]) && isCommandId(value.params.commandId) && value.diagnosticId === null;
  if (["command/invalid_seed", "command/unknown_target_prototype", "command/content_placement_failed", "command/item_unavailable", "command/invalid_equipment", "save/not_found"].includes(value.code)) return value.params === null && value.diagnosticId === null;
  if (value.code === "command/skill_level_too_low") {
    return hasExactKeys(value.params, ["prototypeId", "skillId", "requiredLevel", "actualLevel"])
      && isResourcePrototype(value.params.prototypeId) && isResourceSkill(value.params.skillId)
      && isSafeUint(value.params.requiredLevel) && isSafeUint(value.params.actualLevel) && value.diagnosticId === null;
  }
  if (value.code === "command/recipe_level_too_low") {
    return hasExactKeys(value.params, ["recipeId", "skillId", "requiredLevel", "actualLevel"])
      && isRecipe(value.params.recipeId) && value.params.skillId === "crafting"
      && isSafeUint(value.params.requiredLevel) && isSafeUint(value.params.actualLevel) && value.diagnosticId === null;
  }
  if (value.code === "command/equipment_level_too_low") {
    return hasExactKeys(value.params, ["itemId", "skillId", "requiredLevel", "actualLevel"])
      && isToolItem(value.params.itemId) && isResourceSkill(value.params.skillId)
      && isSafeUint(value.params.requiredLevel) && isSafeUint(value.params.actualLevel) && value.diagnosticId === null;
  }
  if (value.code === "command/invalid_destination") return hasExactKeys(value.params, ["destination"]) && isWorldPoint(value.params.destination) && value.diagnosticId === null;
  if (value.code === "command/confirmation_required") return hasExactKeys(value.params, ["command"]) && (value.params.command === "ImportSave" || value.params.command === "ResetSave") && value.diagnosticId === null;
  if (value.code === "save/incompatible_version") return isVersionParams(value.params) && isDiagnosticId(value.diagnosticId);
  if (value.code === "platform/web_locks_unavailable" || value.code === "active_in_other_tab") return value.params === null && (value.diagnosticId === null || isDiagnosticId(value.diagnosticId));
  const diagnosticOnly = [
    "storage/unavailable", "storage/write_failed", "storage/quota_exceeded", "storage/integrity_failed",
    "backup/file_too_large", "backup/invalid_utf8", "backup/invalid_json", "backup/invalid_product",
    "backup/incompatible_export_version", "backup/incompatible_version", "backup/invalid_shape", "backup/invalid_id",
    "backup/non_canonical_decimal", "backup/coordinate_out_of_range", "backup/unsafe_integer", "backup/duplicate_chunk",
    "backup/checksum_mismatch", "integrity/quantity_overflow", "undefined_failure",
  ];
  return diagnosticOnly.includes(value.code) && value.params === null && isDiagnosticId(value.diagnosticId);
}

export function isActivityReason(value: unknown): value is ActivityReason {
  if (!hasExactKeys(value, ["code", "params", "allowedActions", "diagnosticId"]) || !Array.isArray(value.allowedActions)) return false;
  switch (value.code) {
    case "TaskCompleted":
    case "NoReachableTargetOrFrontier":
      return value.params === null && value.diagnosticId === null && value.allowedActions.length === 1 && value.allowedActions[0] === "set_task";
    case "DestinationUnreachable":
      return hasExactKeys(value.params, ["destination"]) && isWorldPoint(value.params.destination) && value.diagnosticId === null
        && value.allowedActions.length === 1 && value.allowedActions[0] === "set_task";
    case "MissingTool":
      return hasExactKeys(value.params, ["slot", "minimumTier"])
        && (value.params.slot === "axe" || value.params.slot === "pickaxe") && isSafeUint(value.params.minimumTier)
        && value.diagnosticId === null && JSON.stringify(value.allowedActions) === JSON.stringify(["equip_item", "set_task"]);
    case "MaterialsMissing":
      if (!(hasExactKeys(value.params, ["recipeId", "materials"]) && isRecipe(value.params.recipeId)
        && Array.isArray(value.params.materials) && value.params.materials.length > 0)) return false;
      {
        const expectedInputs = new Map<MaterialItemId, number>(RECIPE_CONTRACTS[value.params.recipeId].inputs);
        const materialIds = new Set<MaterialItemId>();
        if (!value.params.materials.every((material: unknown) => {
          if (!(hasExactKeys(material, ["itemId", "displayName", "required", "available", "missing"])
            && isMaterialItem(material.itemId))) return false;
          const expectedRequired = expectedInputs.get(material.itemId);
          if (expectedRequired === undefined || materialIds.has(material.itemId)) return false;
          materialIds.add(material.itemId);
          return material.displayName === ITEM_DISPLAY_NAMES[material.itemId]
            && material.required === expectedRequired && isSafeUint(material.available)
            && isSafeUint(material.missing) && material.missing > 0
            && material.missing === Math.max(expectedRequired - material.available, 0);
        })) return false;
      }
      return value.diagnosticId === null && value.allowedActions.length === 1 && value.allowedActions[0] === "set_task";
    case "storage_write_failed":
      return value.params === null && isDiagnosticId(value.diagnosticId) && JSON.stringify(value.allowedActions) === JSON.stringify(["open_system", "export", "reset", "retry"]);
    case "incompatible_save":
      return isVersionParams(value.params) && isDiagnosticId(value.diagnosticId) && JSON.stringify(value.allowedActions) === JSON.stringify(["export", "reset"]);
    case "active_in_other_tab":
      return value.params === null && value.diagnosticId === null && value.allowedActions.length === 1 && value.allowedActions[0] === "retry";
    case "integrity/quantity_overflow":
      return value.params === null && isDiagnosticId(value.diagnosticId) && JSON.stringify(value.allowedActions) === JSON.stringify(["open_system", "export", "reset"]);
    case "undefined_failure":
      return value.params === null && isDiagnosticId(value.diagnosticId) && JSON.stringify(value.allowedActions) === JSON.stringify(["open_system", "export", "reset"]);
    default:
      return false;
  }
}

export function isExploreTask(value: unknown): value is ExploreTask {
  return hasExactKeys(value, ["taskId", "kind", "mode", "destination", "createdWorldTimeMs"])
    && isTaskId(value.taskId) && value.kind === "Explore" && (value.mode === "continuous" || value.mode === "destination")
    && ((value.mode === "continuous" && value.destination === null) || (value.mode === "destination" && isWorldPoint(value.destination)))
    && isCanonicalUnsignedDecimal(value.createdWorldTimeMs);
}

export function isGatherTask(value: unknown): value is GatherTask {
  return hasExactKeys(value, ["taskId", "kind", "targetPrototypeId", "quantity", "completedQuantity", "createdWorldTimeMs"])
    && isTaskId(value.taskId) && value.kind === "Gather" && value.targetPrototypeId === "wild_fiber"
    && (value.quantity === null || (isSafeUint(value.quantity) && value.quantity > 0))
    && isSafeUint(value.completedQuantity)
    && (value.quantity === null || value.completedQuantity <= value.quantity)
    && isCanonicalUnsignedDecimal(value.createdWorldTimeMs);
}

export function isWoodcutTask(value: unknown): value is WoodcutTask {
  return hasExactKeys(value, ["taskId", "kind", "targetPrototypeId", "quantity", "completedQuantity", "createdWorldTimeMs"])
    && isTaskId(value.taskId) && value.kind === "Woodcut" && value.targetPrototypeId === "softwood_tree"
    && (value.quantity === null || (isSafeUint(value.quantity) && value.quantity > 0))
    && isSafeUint(value.completedQuantity) && (value.quantity === null || value.completedQuantity <= value.quantity)
    && isCanonicalUnsignedDecimal(value.createdWorldTimeMs);
}

export function isMineTask(value: unknown): value is MineTask {
  return hasExactKeys(value, ["taskId", "kind", "targetPrototypeId", "quantity", "completedQuantity", "createdWorldTimeMs"])
    && isTaskId(value.taskId) && value.kind === "Mine" && (value.targetPrototypeId === "surface_stone" || value.targetPrototypeId === "shallow_copper_deposit")
    && (value.quantity === null || (isSafeUint(value.quantity) && value.quantity > 0))
    && isSafeUint(value.completedQuantity) && (value.quantity === null || value.completedQuantity <= value.quantity)
    && isCanonicalUnsignedDecimal(value.createdWorldTimeMs);
}

export function isProduceTask(value: unknown): value is ProduceTask {
  return hasExactKeys(value, ["taskId", "kind", "recipeId", "requestedQuantity", "completedQuantity", "createdWorldTimeMs"])
    && isTaskId(value.taskId) && value.kind === "Produce" && isRecipe(value.recipeId)
    && (value.requestedQuantity === null || (isSafeUint(value.requestedQuantity) && value.requestedQuantity > 0))
    && isSafeUint(value.completedQuantity)
    && (value.requestedQuantity === null || value.completedQuantity <= value.requestedQuantity)
    && isCanonicalUnsignedDecimal(value.createdWorldTimeMs);
}

export function isTaskIntent(value: unknown): value is TaskIntent {
  return isExploreTask(value) || isGatherTask(value) || isWoodcutTask(value) || isMineTask(value) || isProduceTask(value);
}

function isNonCombatActionSummary(value: unknown): value is NonCombatActionSummary {
  if (value !== null && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).kind === "Produce") {
    return hasExactKeys(value, ["kind", "actionId", "recipeId", "baseDurationMs", "durationMs", "remainingMs", "skillSpeedBps", "totalSpeedBps"])
      && isActionId(value.actionId) && isRecipe(value.recipeId)
      && isCanonicalUnsignedDecimal(value.baseDurationMs) && isCanonicalUnsignedDecimal(value.durationMs) && isCanonicalUnsignedDecimal(value.remainingMs)
      && BigInt(value.remainingMs) <= BigInt(value.durationMs) && isSafeUint(value.skillSpeedBps) && value.skillSpeedBps <= 2_500
      && isSafeUint(value.totalSpeedBps) && value.totalSpeedBps === value.skillSpeedBps;
  }
  return hasExactKeys(value, ["kind", "actionId", "placementId", "prototypeId", "baseDurationMs", "durationMs", "remainingMs", "skillSpeedBps", "toolSpeedBps", "totalSpeedBps"])
    && value.kind === "Resource" && isActionId(value.actionId) && isPlacementId(value.placementId) && isResourcePrototype(value.prototypeId)
    && isCanonicalUnsignedDecimal(value.baseDurationMs) && isCanonicalUnsignedDecimal(value.durationMs) && isCanonicalUnsignedDecimal(value.remainingMs)
    && BigInt(value.remainingMs) <= BigInt(value.durationMs) && isSafeUint(value.skillSpeedBps) && value.skillSpeedBps <= 2_500
    && isSafeUint(value.toolSpeedBps) && isSafeUint(value.totalSpeedBps) && value.totalSpeedBps === value.skillSpeedBps + value.toolSpeedBps;
}

function isActivity(value: unknown): value is Activity {
  if (!hasExactKeys(value, ["state", "phase", "route", "routePurpose", "routeIndex", "etaMs", "progressPermille", "targetPlacementId", "action", "reason"]) || !Array.isArray(value.route)) return false;
  if (!["idle", "planning", "moving", "acting", "waiting", "paused"].includes(value.state as string)
    || !["idle", "exploring", "acquiring_target", "moving_to_target", "resource_action", "production_action", "auto_exploring", "waiting", "paused"].includes(value.phase as string)
    || value.route.length > 65_536 || !value.route.every(isWorldPoint)) return false;
  if (!(value.routePurpose === null || ["explore", "task_target", "auto_explore"].includes(value.routePurpose as string))) return false;
  if (!isSafeUint(value.routeIndex) || (value.route.length === 0 ? value.routeIndex !== 0 : value.routeIndex >= value.route.length)) return false;
  if (!(value.etaMs === null || isCanonicalUnsignedDecimal(value.etaMs))) return false;
  if (!(value.progressPermille === null || (Number.isInteger(value.progressPermille) && (value.progressPermille as number) >= 0 && (value.progressPermille as number) <= 1000))) return false;
  if (!(value.targetPlacementId === null || isPlacementId(value.targetPlacementId))) return false;
  if (!(value.action === null || isNonCombatActionSummary(value.action))) return false;
  if (value.state === "acting" && value.action === null) return false;
  if (value.state !== "acting" && value.action !== null) return false;
  if (value.action?.kind === "Produce" && !(value.phase === "production_action" && value.route.length === 0
    && value.routePurpose === null && value.routeIndex === 0 && value.targetPlacementId === null && value.etaMs === value.action.remainingMs)) return false;
  if (value.action?.kind === "Resource" && !(value.phase === "resource_action" && value.targetPlacementId === value.action.placementId)) return false;
  return value.reason === null || isActivityReason(value.reason);
}

function isResourcePlacementSummary(value: unknown): value is ResourcePlacementSummary {
  const displayNames: Record<ResourcePrototypeId, string> = { wild_fiber: "野生纤维", softwood_tree: "软木树", surface_stone: "地表石", shallow_copper_deposit: "浅层铜矿" };
  const taskKinds: Record<ResourcePrototypeId, ResourceTaskKind> = { wild_fiber: "Gather", softwood_tree: "Woodcut", surface_stone: "Mine", shallow_copper_deposit: "Mine" };
  const skillIds: Record<ResourcePrototypeId, ResourceSkillId> = { wild_fiber: "gathering", softwood_tree: "woodcutting", surface_stone: "mining", shallow_copper_deposit: "mining" };
  const requiredLevels: Record<ResourcePrototypeId, number> = { wild_fiber: 1, softwood_tree: 1, surface_stone: 1, shallow_copper_deposit: 5 };
  const toolSlots: Record<ResourcePrototypeId, ToolSlot | null> = { wild_fiber: null, softwood_tree: "axe", surface_stone: "pickaxe", shallow_copper_deposit: "pickaxe" };
  const mapColors: Record<ResourcePrototypeId, string> = { wild_fiber: "#85d59a", softwood_tree: "#6fbd78", surface_stone: "#b8b7ad", shallow_copper_deposit: "#cf8658" };
  return hasExactKeys(value, ["placementId", "prototypeId", "displayName", "taskKind", "skillId", "requiredLevel", "locked", "requiredTool", "mapColor", "point", "state", "respawnRemainingMs", "reachable"])
    && isPlacementId(value.placementId) && isResourcePrototype(value.prototypeId) && value.displayName === displayNames[value.prototypeId]
    && value.taskKind === taskKinds[value.prototypeId] && value.skillId === skillIds[value.prototypeId]
    && value.requiredLevel === requiredLevels[value.prototypeId] && typeof value.locked === "boolean"
    && (toolSlots[value.prototypeId] === null ? value.requiredTool === null : hasExactKeys(value.requiredTool, ["slot", "minimumTier"])
      && value.requiredTool.slot === toolSlots[value.prototypeId] && value.requiredTool.minimumTier === 0)
    && value.mapColor === mapColors[value.prototypeId]
    && isWorldPoint(value.point) && ["active", "depleted", "respawning"].includes(value.state as string)
    && (value.respawnRemainingMs === null || isCanonicalUnsignedDecimal(value.respawnRemainingMs))
    && ["reachable", "unreachable", "unknown"].includes(value.reachable as string);
}

function isCanonicalFogBase64(value: unknown): value is string {
  if (typeof value !== "string" || !PADDED_FOG_BASE64.test(value)) return false;
  try {
    return atob(value).length === 512;
  } catch {
    return false;
  }
}

function isRevealedChunk(value: unknown): value is RevealedChunk {
  return hasExactKeys(value, ["chunkKey", "chunkX", "chunkY", "revealedBase64"])
    && isChunkIdentity(value.chunkKey, value.chunkX, value.chunkY) && isCanonicalFogBase64(value.revealedBase64);
}

export function isOfflineReport(value: unknown): value is OfflineReport {
  return hasExactKeys(value, ["claimId", "rawElapsedMs", "clockSkew", "creditedDurationMs", "discardedDurationMs", "fromWorldTimeMs", "toWorldTimeMs", "taskBefore", "taskAfter", "revealedTiles", "itemDeltas", "skillXpGains", "stopReason", "committedRevision"])
    && isClaimId(value.claimId) && typeof value.rawElapsedMs === "number" && Number.isSafeInteger(value.rawElapsedMs)
    && (value.clockSkew === "none" || value.clockSkew === "backward") && isCanonicalUnsignedDecimal(value.creditedDurationMs)
    && isCanonicalUnsignedDecimal(value.discardedDurationMs) && isCanonicalUnsignedDecimal(value.fromWorldTimeMs)
    && isCanonicalUnsignedDecimal(value.toWorldTimeMs) && (value.taskBefore === null || isTaskIntent(value.taskBefore))
    && (value.taskAfter === null || isTaskIntent(value.taskAfter)) && isSafeUint(value.revealedTiles)
    && Array.isArray(value.itemDeltas) && value.itemDeltas.every((delta: unknown) => hasExactKeys(delta, ["itemId", "displayName", "quantity"])
      && isItem(delta.itemId) && typeof delta.displayName === "string" && typeof delta.quantity === "number"
      && Number.isSafeInteger(delta.quantity) && delta.quantity !== 0)
    && Array.isArray(value.skillXpGains) && value.skillXpGains.every((gain: unknown) => hasExactKeys(gain, ["skillId", "displayName", "xp"])
      && (gain.skillId === "exploration" || isSkill(gain.skillId)) && typeof gain.displayName === "string" && isSafeUint(gain.xp) && gain.xp > 0)
    && (value.stopReason === null || isActivityReason(value.stopReason)) && isSafeUint(value.committedRevision)
    && (value.clockSkew !== "backward" || (value.rawElapsedMs < 0 && value.creditedDurationMs === "0" && value.discardedDurationMs === "0" && value.toWorldTimeMs === value.fromWorldTimeMs));
}

export function isGameplayReadModel(value: unknown): value is GameplayReadModelV1 {
  if (!hasExactKeys(value, ["protocolVersion", "readModelRevision", "gameplayEpoch", "startup", "generatorVersion", "player", "task", "activity", "exploration", "skills", "inventory", "equipment", "toolCandidates", "recipes", "knownTargetPrototypeIds", "map", "save", "offlineReport"])) return false;
  if (value.protocolVersion !== 1 || !isSafeUint(value.readModelRevision) || !isSafeUint(value.gameplayEpoch)
    || !["acquiring_lock", "loading_save", "new_world", "processing_offline", "ready", "active_in_other_tab", "incompatible_save", "storage_blocked"].includes(value.startup as string)
    || !(value.generatorVersion === null || isU32(value.generatorVersion))) return false;
  if (value.player !== null && !(hasExactKeys(value.player, ["position", "hp", "combatScope"]) && isWorldPoint(value.player.position)
    && hasExactKeys(value.player.hp, ["current", "max"]) && value.player.hp.current === 100 && value.player.hp.max === 100
    && value.player.combatScope === "not_implemented_phase_2c")) return false;
  if (!(value.task === null || isTaskIntent(value.task)) || !isActivity(value.activity)) return false;
  if (value.activity.action?.kind === "Produce" && !(value.task?.kind === "Produce" && value.task.recipeId === value.activity.action.recipeId)) return false;
  if (value.activity.action?.kind === "Resource" && !(value.task !== null && value.task.kind !== "Explore" && value.task.kind !== "Produce"
    && value.task.targetPrototypeId === value.activity.action.prototypeId)) return false;
  if (value.activity.reason?.code === "MaterialsMissing" && !(value.task?.kind === "Produce"
    && value.task.recipeId === value.activity.reason.params.recipeId)) return false;
  if (value.exploration !== null && !(hasExactKeys(value.exploration, ["level", "totalXp", "currentLevelXp", "nextLevelXp", "observationRadiusTiles", "revealedTileCount"])
    && isSafeUint(value.exploration.level) && isSafeUint(value.exploration.totalXp) && isSafeUint(value.exploration.currentLevelXp)
    && (value.exploration.nextLevelXp === null || isSafeUint(value.exploration.nextLevelXp)) && isSafeUint(value.exploration.observationRadiusTiles)
    && isSafeUint(value.exploration.revealedTileCount))) return false;
  if (value.skills !== null) {
    if (!hasExactKeys(value.skills, ["gathering", "woodcutting", "mining", "crafting"])) return false;
    for (const skillId of SKILL_IDS) {
      const skill = value.skills[skillId];
      if (!hasExactKeys(skill, ["level", "totalXp", "currentLevelXp", "nextLevelXp", "skillSpeedBps"])
        || !isSafeUint(skill.level) || !isSafeUint(skill.totalXp) || !isSafeUint(skill.currentLevelXp)
        || !(skill.nextLevelXp === null || isSafeUint(skill.nextLevelXp)) || !isSafeUint(skill.skillSpeedBps) || skill.skillSpeedBps > 2_500) return false;
    }
  }
  if (value.inventory !== null && !(hasExactKeys(value.inventory, ["items"]) && Array.isArray(value.inventory.items)
    && value.inventory.items.length <= 9 && value.inventory.items.every((item: unknown) => hasExactKeys(item, ["itemId", "displayName", "category", "quantity"])
      && (isMaterialItem(item.itemId) || isToolItem(item.itemId)) && (item.category === "material" || item.category === "equipment")
      && (isMaterialItem(item.itemId) ? item.category === "material" : item.category === "equipment")
      && item.displayName === ITEM_DISPLAY_NAMES[item.itemId] && isSafeUint(item.quantity) && item.quantity > 0)
    && new Set(value.inventory.items.map((item) => item.itemId)).size === value.inventory.items.length)) return false;
  if (value.equipment !== null) {
    if (!hasExactKeys(value.equipment, ["axe", "pickaxe"])) return false;
    const equipment = value.equipment;
    for (const slot of ["axe", "pickaxe"] as const) {
      const equipped = equipment[slot];
      if (equipped !== null) {
        if (!(hasExactKeys(equipped, ["itemId", "displayName", "tier", "speedBps"]) && isToolItem(equipped.itemId))) return false;
        const expected = TOOL_CONTRACTS[equipped.itemId];
        if (expected.slot !== slot || equipped.displayName !== ITEM_DISPLAY_NAMES[equipped.itemId]
          || equipped.tier !== expected.tier || equipped.speedBps !== expected.speedBps) return false;
      }
    }
  }
  if (!Array.isArray(value.toolCandidates) || (value.player === null ? value.toolCandidates.length !== 0 : value.toolCandidates.length !== 4)) return false;
  if (value.player !== null && (value.skills === null || value.inventory === null || value.equipment === null)) return false;
  const readSkills = value.skills as GameplayReadModelV1["skills"];
  const readInventory = value.inventory as GameplayReadModelV1["inventory"];
  const readEquipment = value.equipment as GameplayReadModelV1["equipment"];
  if (value.toolCandidates.some((candidate: unknown, index: number) => {
    if (!(hasExactKeys(candidate, ["itemId", "displayName", "slot", "tier", "speedBps", "requiredSkillId", "requiredLevel", "actualLevel", "canEquip", "inventoryQuantity", "equipped"])
      && isToolItem(candidate.itemId))) return true;
    const expectedItemId = TOOL_ITEM_IDS[index];
    const expected = TOOL_CONTRACTS[candidate.itemId];
    const actualSkillLevel = readSkills?.[expected.requiredSkillId].level;
    const inventoryQuantity = readInventory?.items.find((item) => item.itemId === candidate.itemId)?.quantity ?? 0;
    const equipped = readEquipment?.[expected.slot]?.itemId === candidate.itemId;
    return candidate.itemId !== expectedItemId || candidate.displayName !== ITEM_DISPLAY_NAMES[candidate.itemId]
      || candidate.slot !== expected.slot || candidate.tier !== expected.tier || candidate.speedBps !== expected.speedBps
      || candidate.requiredSkillId !== expected.requiredSkillId || candidate.requiredLevel !== expected.requiredLevel
      || candidate.actualLevel !== actualSkillLevel || candidate.canEquip !== (actualSkillLevel !== undefined && actualSkillLevel >= expected.requiredLevel)
      || candidate.inventoryQuantity !== inventoryQuantity || candidate.equipped !== equipped;
  })) return false;
  if (!Array.isArray(value.recipes) || (value.player === null ? value.recipes.length !== 0 : value.recipes.length !== 3)) return false;
  const craftingLevel = readSkills?.crafting.level;
  if (value.recipes.some((recipe: unknown, index: number) => {
    if (!(hasExactKeys(recipe, ["recipeId", "displayName", "skillId", "requiredLevel", "locked", "inputs", "output", "baseDurationMs", "durationMs", "skillSpeedBps", "totalSpeedBps", "xp", "station"])
      && isRecipe(recipe.recipeId) && Array.isArray(recipe.inputs)
      && hasExactKeys(recipe.output, ["itemId", "displayName", "quantity"]) && isItem(recipe.output.itemId))) return true;
    const expectedRecipeId = RECIPE_IDS[index];
    const expected = RECIPE_CONTRACTS[recipe.recipeId];
    const expectedSkillSpeedBps = craftingLevel === undefined ? null : Math.min(Math.max(craftingLevel - expected.requiredLevel, 0) * 50, 2_500);
    if (recipe.inputs.length !== expected.inputs.length || recipe.inputs.some((input: unknown, inputIndex: number) => {
      if (!(hasExactKeys(input, ["itemId", "displayName", "required", "available", "missing"]) && isMaterialItem(input.itemId))) return true;
      const expectedInput = expected.inputs[inputIndex];
      const availableQuantity = readInventory?.items.find((item) => item.itemId === input.itemId)?.quantity ?? 0;
      return expectedInput === undefined || input.itemId !== expectedInput[0]
        || input.displayName !== ITEM_DISPLAY_NAMES[input.itemId] || input.required !== expectedInput[1]
        || input.available !== availableQuantity || input.missing !== Math.max(expectedInput[1] - input.available, 0);
    })) return true;
    return recipe.recipeId !== expectedRecipeId || recipe.displayName !== expected.displayName || recipe.skillId !== "crafting"
      || recipe.requiredLevel !== expected.requiredLevel || recipe.locked !== (craftingLevel !== undefined && craftingLevel < expected.requiredLevel)
      || recipe.output.itemId !== expected.output || recipe.output.displayName !== ITEM_DISPLAY_NAMES[expected.output] || recipe.output.quantity !== 1
      || recipe.baseDurationMs !== expected.baseDurationMs || expectedSkillSpeedBps === null
      || recipe.durationMs !== expectedDurationMs(expected.baseDurationMs, expectedSkillSpeedBps)
      || recipe.skillSpeedBps !== expectedSkillSpeedBps || recipe.totalSpeedBps !== expectedSkillSpeedBps
      || recipe.xp !== expected.xp || recipe.station !== "handcraft";
  })) return false;
  if (!Array.isArray(value.knownTargetPrototypeIds) || value.knownTargetPrototypeIds.some((id: unknown) => !isResourcePrototype(id))
    || new Set(value.knownTargetPrototypeIds).size !== value.knownTargetPrototypeIds.length) return false;
  if (!(hasExactKeys(value.map, ["revealedChunks", "resourcePlacements", "selectedDestination"]) && Array.isArray(value.map.revealedChunks)
    && value.map.revealedChunks.every(isRevealedChunk) && Array.isArray(value.map.resourcePlacements)
    && value.map.resourcePlacements.every(isResourcePlacementSummary) && value.map.selectedDestination === null)) return false;
  if (!(hasExactKeys(value.save, ["state", "revision", "committedWallClockMs", "localOnly", "evictionWarning", "lastError"])
    && ["none", "saving", "saved", "error", "incompatible", "active_in_other_tab"].includes(value.save.state as string)
    && isSafeUint(value.save.revision) && (value.save.committedWallClockMs === null || isSafeUint(value.save.committedWallClockMs))
    && value.save.localOnly === true && typeof value.save.evictionWarning === "boolean"
    && (value.save.lastError === null || isActivityReason(value.save.lastError)))) return false;
  return value.offlineReport === null || isOfflineReport(value.offlineReport);
}

export function isGameplayWorkerToMain(value: unknown): value is GameplayWorkerToMain {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (message.protocolVersion !== 1) return false;
  switch (message.type) {
    case "worker-ready":
      return hasExactKeys(message, ["type", "protocolVersion"]);
    case "request-result":
      return hasExactKeys(message, ["type", "protocolVersion", "requestId", "operation", "status", "readModelRevision", "saveRevision", "error"])
        && isRequestId(message.requestId) && ["initialize", "flush", "shutdown"].includes(message.operation as string)
        && (message.status === "accepted" || message.status === "rejected") && isSafeUint(message.readModelRevision) && isSafeUint(message.saveRevision)
        && ((message.status === "accepted" && message.error === null) || (message.status === "rejected" && isLifecycleError(message.error)));
    case "protocol-error":
      return hasExactKeys(message, ["type", "protocolVersion", "requestId", "error", "readModelRevision", "saveRevision"])
        && (message.requestId === null || isRequestId(message.requestId)) && isProtocolError(message.error)
        && isSafeUint(message.readModelRevision) && isSafeUint(message.saveRevision);
    case "terrain-request":
      return hasExactKeys(message, ["type", "protocolVersion", "terrainRequestId", "gameplayEpoch", "readModelRevision", "seed", "chunkKey", "chunkX", "chunkY"])
        && isTerrainRequestIdForEpoch(message.terrainRequestId, message.gameplayEpoch) && isSafeUint(message.readModelRevision)
        && isSeedDecimal(message.seed) && isChunkIdentity(message.chunkKey, message.chunkX, message.chunkY);
    case "read-model":
      return hasExactKeys(message, ["type", "protocolVersion", "readModel"]) && isGameplayReadModel(message.readModel);
    case "command-result":
      return hasExactKeys(message, ["type", "protocolVersion", "requestId", "commandId", "status", "readModelRevision", "saveRevision", "error"])
        && isRequestId(message.requestId) && isCommandId(message.commandId) && (message.status === "accepted" || message.status === "rejected")
        && isSafeUint(message.readModelRevision) && isSafeUint(message.saveRevision)
        && ((message.status === "accepted" && message.error === null) || (message.status === "rejected" && isCommandError(message.error)));
    case "offline-progress":
      return hasExactKeys(message, ["type", "protocolVersion", "claimId", "processedDurationMs", "creditedDurationMs", "sliceMaxMs"])
        && isClaimId(message.claimId) && isCanonicalUnsignedDecimal(message.processedDurationMs) && isCanonicalUnsignedDecimal(message.creditedDurationMs)
        && typeof message.sliceMaxMs === "number" && Number.isFinite(message.sliceMaxMs) && message.sliceMaxMs >= 0;
    case "export-ready":
      return hasExactKeys(message, ["type", "protocolVersion", "requestId", "commandId", "saveRevision", "filename", "backupUtf8"])
        && isRequestId(message.requestId) && isCommandId(message.commandId) && isSafeUint(message.saveRevision)
        && typeof message.filename === "string" && /^baiyue-rpg-save-r[0-9]+\.json$/.test(message.filename)
        && message.backupUtf8 instanceof ArrayBuffer && message.backupUtf8.byteLength <= 33_554_432;
    case "fatal":
      return hasExactKeys(message, ["type", "protocolVersion", "error", "readModelRevision", "saveRevision"])
        && isLifecycleError(message.error) && isSafeUint(message.readModelRevision) && isSafeUint(message.saveRevision);
    default:
      return false;
  }
}

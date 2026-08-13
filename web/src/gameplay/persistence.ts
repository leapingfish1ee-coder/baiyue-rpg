import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";

import { CHUNK_COORDINATE_MAX, CHUNK_COORDINATE_MIN, WORLD_POINT_NAV_MAX, WORLD_POINT_NAV_MIN, compareChunkKeysNumeric } from "../world-contract.ts";
import { canonicalJson } from "./canonical-json.ts";
import {
  CONTENT_VERSION,
  DB_SCHEMA_VERSION,
  GAME_RULES_VERSION,
  SAVE_ID,
  SAVE_SCHEMA_VERSION,
  isActivityReason,
  isActionId,
  isCanonicalUnsignedDecimal,
  isCanonicalSignedDecimal,
  isChunkIdentity,
  isCommandId,
  isDiagnosticId,
  isOfflineReport,
  isPlacementId,
  isSafeUint,
  isSeedDecimal,
  isTaskId,
  isWorldPoint,
  type ActivityReason,
  type CommandId,
  type DiagnosticId,
  type OfflineReport,
  type SeedDecimal,
  type WorldPoint,
} from "./contracts.ts";
import { base64ToFogBits, fogBitsToBase64, FOG_BYTES_PER_CHUNK } from "./fog.ts";
import { floorDiv, levelFromTotalXp } from "./math.ts";
import type { KnownResourcePlacement } from "./engine.ts";
import { isRecipeId, isResourcePrototypeId, taskKindMatchesPrototype, type RecipeId, type ResourcePrototypeId, type ToolItemId, type ToolSlot } from "./content.ts";

export const GAMEPLAY_DATABASE_NAME = "baiyue-rpg-gameplay";
export const GAMEPLAY_LOCK_NAME = "baiyue-rpg:active-save";
export const INTEGRITY_ALGORITHM = "sha256-record-v1" as const;

export type CommandReceiptRecord = Readonly<{
  command_id: CommandId;
  command_type: "CreateWorld" | "SetTask" | "CancelTask" | "EquipItem" | "UnequipSlot";
  payload_sha256: string;
  terminal_status: "accepted";
  save_revision: number;
  reason_code: null;
}>;

export type PersistedTask =
  | Readonly<{ task_id: string; kind: "Explore"; mode: "continuous" | "destination"; destination: WorldPoint | null; created_world_time_ms: string }>
  | Readonly<{ task_id: string; kind: "Gather"; target_prototype_id: "wild_fiber"; quantity: number | null; completed_quantity: number; created_world_time_ms: string }>
  | Readonly<{ task_id: string; kind: "Woodcut"; target_prototype_id: "softwood_tree"; quantity: number | null; completed_quantity: number; created_world_time_ms: string }>
  | Readonly<{ task_id: string; kind: "Mine"; target_prototype_id: "surface_stone" | "shallow_copper_deposit"; quantity: number | null; completed_quantity: number; created_world_time_ms: string }>
  | Readonly<{ task_id: string; kind: "Produce"; recipe_id: RecipeId; requested_quantity: number | null; completed_quantity: number; created_world_time_ms: string }>;

export type PersistedMotionLeg = Readonly<{
  start: WorldPoint;
  end: WorldPoint;
  start_world_time_ms: string;
  end_world_time_ms: string;
  accumulated_weighted_cost: string;
  total_weighted_cost: string;
  path_index: number;
}>;

export type PersistedExecution = Readonly<{
  state: "idle" | "planning" | "moving" | "acting" | "waiting" | "paused";
  route_purpose: "explore" | "task_target" | "auto_explore" | null;
  route: readonly WorldPoint[];
  route_index: number;
  motion: PersistedMotionLeg | null;
  target_placement_id: string | null;
  action: Readonly<{
    kind: "Resource";
    action_id: string;
    placement_id: string;
    prototype_id: ResourcePrototypeId;
    start_world_time_ms: string;
    end_world_time_ms: string;
    duration_ms: string;
    skill_speed_bps: number;
    tool_speed_bps: number;
    total_speed_bps: number;
  } | {
    kind: "Produce";
    action_id: string;
    recipe_id: RecipeId;
    start_world_time_ms: string;
    end_world_time_ms: string;
    duration_ms: string;
    skill_speed_bps: number;
    total_speed_bps: number;
  }> | null;
  waiting_reason: ActivityReason | null;
}>;

export type MetaRecord = Readonly<{
  save_id: typeof SAVE_ID;
  current_revision: number;
  created_wall_clock_ms: number;
  committed_wall_clock_ms: number;
  committed_world_time_ms: string;
  db_schema_version: 1;
  save_schema_version: 4;
  game_rules_version: 4;
  content_version: 4;
  generator_version: number;
  integrity_algorithm: typeof INTEGRITY_ALGORITHM;
  core_checksum_sha256: string;
  world_chunk_count: number;
}>;

export type CoreRecord = Readonly<{
  save_id: typeof SAVE_ID;
  revision: number;
  seed: SeedDecimal;
  world_time_ms: string;
  position: WorldPoint;
  camp_anchor: WorldPoint;
  hp: Readonly<{ current: 100; max: 100 }>;
  exploration: Readonly<{ level: number; total_xp: number }>;
  skills: Readonly<{
    gathering: Readonly<{ level: number; total_xp: number }>;
    woodcutting: Readonly<{ level: number; total_xp: number }>;
    mining: Readonly<{ level: number; total_xp: number }>;
    crafting: Readonly<{ level: number; total_xp: number }>;
  }>;
  inventory: Readonly<{
    fiber: number; softwood: number; stone: number; copper_ore: number; rope: number;
    worn_axe: number; worn_pickaxe: number; reinforced_axe: number; reinforced_pickaxe: number;
  }>;
  equipment: Readonly<Record<ToolSlot, ToolItemId | null>>;
  task: PersistedTask | null;
  execution: PersistedExecution;
  command_receipts: readonly CommandReceiptRecord[];
  next_event_ordinal: string;
  last_offline_report: OfflineReport | null;
}>;

export type WorldChunkRecord = Readonly<{
  chunk_key: string;
  chunk_x: string;
  chunk_y: string;
  revealed_bits: Uint8Array;
  known_placements: readonly KnownResourcePlacement[];
  revision: number;
  record_checksum_sha256: string;
}>;

export type ResumeClaimRecord = Readonly<{
  save_id: typeof SAVE_ID;
  claim_id: string;
  base_revision: number;
  base_world_time_ms: string;
  from_wall_clock_ms: number;
  target_wall_clock_ms: number;
  credited_duration_ms: string;
  processing_status: "pending";
  diagnostic_id: DiagnosticId;
}>;

export interface BaiyueGameplayDB extends DBSchema {
  meta: { key: typeof SAVE_ID; value: MetaRecord };
  core: { key: typeof SAVE_ID; value: CoreRecord };
  world_chunks: { key: string; value: WorldChunkRecord };
  resume_claim: { key: typeof SAVE_ID; value: ResumeClaimRecord };
}

export type PersistedSnapshot = Readonly<{
  meta: MetaRecord;
  core: CoreRecord;
  chunks: readonly WorldChunkRecord[];
  resumeClaim: ResumeClaimRecord | null;
}>;

export type BackupChunkV1 = Readonly<{
  chunkKey: string;
  chunkX: string;
  chunkY: string;
  revealedBase64: string;
  knownPlacements: readonly KnownResourcePlacement[];
  revision: number;
}>;

export type BackupEnvelopeV1 = Readonly<{
  product: "baiyue-rpg";
  exportFormatVersion: 1;
  versions: Readonly<{ dbSchema: number; saveSchema: number; gameRules: number; content: number; generator: number }>;
  metadata: Readonly<{
    saveId: typeof SAVE_ID;
    revision: number;
    createdWallClockMs: number;
    committedWallClockMs: number;
    committedWorldTimeMs: string;
    seed: SeedDecimal;
  }>;
  core: CoreRecord;
  chunks: readonly BackupChunkV1[];
  checksum: string;
}>;

type BackupErrorCode =
  | "save/not_found"
  | "backup/file_too_large" | "backup/invalid_utf8" | "backup/invalid_json" | "backup/invalid_product"
  | "backup/incompatible_export_version" | "backup/incompatible_version" | "backup/invalid_shape"
  | "backup/invalid_id" | "backup/non_canonical_decimal" | "backup/coordinate_out_of_range"
  | "backup/unsafe_integer" | "backup/duplicate_chunk" | "backup/checksum_mismatch";

export class BackupError extends Error {
  constructor(readonly code: BackupErrorCode, message: string, options?: ErrorOptions) { super(message, options); }
}

type PersistenceCode =
  | "platform/web_locks_unavailable"
  | "active_in_other_tab"
  | "save/incompatible_version"
  | "storage/unavailable"
  | "storage/write_failed"
  | "storage/quota_exceeded"
  | "storage/integrity_failed";

export class PersistenceError extends Error {
  readonly code: PersistenceCode;
  readonly version: Readonly<{ expected: number; actual: number; version: "db" | "save" | "rules" | "content" | "generator" }> | null;

  constructor(code: PersistenceCode, message: string, version: PersistenceError["version"] = null, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
    this.version = version;
  }
}

export type GameplayLock = Readonly<{ release: () => Promise<void> }>;

const STORE_KEY_PATHS = {
  meta: "save_id",
  core: "save_id",
  world_chunks: "chunk_key",
  resume_claim: "save_id",
} as const;
const STORE_NAMES = Object.keys(STORE_KEY_PATHS) as Array<keyof typeof STORE_KEY_PATHS>;
const LOWER_HEX_64 = /^[0-9a-f]{64}$/;

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function isHexChecksum(value: unknown): value is string {
  return typeof value === "string" && LOWER_HEX_64.test(value);
}

function isPersistedTask(value: unknown): value is PersistedTask {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const task = value as Record<string, unknown>;
  if (!isTaskId(task.task_id) || !isCanonicalUnsignedDecimal(task.created_world_time_ms)) return false;
  if (task.kind === "Gather" || task.kind === "Woodcut" || task.kind === "Mine") {
    return exactObject(task, ["task_id", "kind", "target_prototype_id", "quantity", "completed_quantity", "created_world_time_ms"])
      && isResourcePrototypeId(task.target_prototype_id) && taskKindMatchesPrototype(task.kind, task.target_prototype_id)
      && (task.quantity === null || (isSafeUint(task.quantity) && task.quantity > 0))
      && isSafeUint(task.completed_quantity) && (task.quantity === null || task.completed_quantity <= task.quantity);
  }
  if (task.kind === "Produce") {
    return exactObject(task, ["task_id", "kind", "recipe_id", "requested_quantity", "completed_quantity", "created_world_time_ms"])
      && isRecipeId(task.recipe_id)
      && (task.requested_quantity === null || (isSafeUint(task.requested_quantity) && task.requested_quantity > 0))
      && isSafeUint(task.completed_quantity)
      && (task.requested_quantity === null || task.completed_quantity <= task.requested_quantity);
  }
  if (!exactObject(task, ["task_id", "kind", "mode", "destination", "created_world_time_ms"]) || task.kind !== "Explore") return false;
  return task.mode === "continuous" ? task.destination === null : task.mode === "destination" && isWorldPoint(task.destination);
}

function isMotion(value: unknown): value is PersistedMotionLeg {
  return exactObject(value, ["start", "end", "start_world_time_ms", "end_world_time_ms", "accumulated_weighted_cost", "total_weighted_cost", "path_index"])
    && isWorldPoint(value.start) && isWorldPoint(value.end)
    && isCanonicalUnsignedDecimal(value.start_world_time_ms) && isCanonicalUnsignedDecimal(value.end_world_time_ms)
    && isCanonicalUnsignedDecimal(value.accumulated_weighted_cost) && isCanonicalUnsignedDecimal(value.total_weighted_cost)
    && isSafeUint(value.path_index) && BigInt(value.end_world_time_ms) > BigInt(value.start_world_time_ms)
    && BigInt(value.total_weighted_cost) >= BigInt(value.accumulated_weighted_cost);
}

function isExecution(value: unknown): value is PersistedExecution {
  if (!exactObject(value, ["state", "route_purpose", "route", "route_index", "motion", "target_placement_id", "action", "waiting_reason"]) || !Array.isArray(value.route)) return false;
  if (!["idle", "planning", "moving", "acting", "waiting", "paused"].includes(value.state as string)
    || value.route.length > 65_536 || !value.route.every(isWorldPoint) || !isSafeUint(value.route_index)) return false;
  if (!(value.route_purpose === null || ["explore", "task_target", "auto_explore"].includes(value.route_purpose as string))) return false;
  if (value.route.length === 0 ? value.route_index !== 0 : value.route_index >= value.route.length) return false;
  if (!(value.motion === null || isMotion(value.motion)) || !(value.waiting_reason === null || isActivityReason(value.waiting_reason))) return false;
  if (!(value.target_placement_id === null || isPlacementId(value.target_placement_id))) return false;
  if (value.action !== null) {
    if (typeof value.action !== "object" || Array.isArray(value.action)) return false;
    const action = value.action as Record<string, unknown>;
    const commonValid = isActionId(action.action_id)
      && isCanonicalUnsignedDecimal(action.start_world_time_ms) && isCanonicalUnsignedDecimal(action.end_world_time_ms)
      && isCanonicalUnsignedDecimal(action.duration_ms) && BigInt(action.end_world_time_ms) > BigInt(action.start_world_time_ms)
      && BigInt(action.end_world_time_ms) - BigInt(action.start_world_time_ms) === BigInt(action.duration_ms)
      && isSafeUint(action.skill_speed_bps) && action.skill_speed_bps <= 2_500 && isSafeUint(action.total_speed_bps);
    if (!commonValid) return false;
    if (action.kind === "Resource") {
      if (!exactObject(action, ["kind", "action_id", "placement_id", "prototype_id", "start_world_time_ms", "end_world_time_ms", "duration_ms", "skill_speed_bps", "tool_speed_bps", "total_speed_bps"])
        || !isPlacementId(action.placement_id) || !isResourcePrototypeId(action.prototype_id)
        || !isSafeUint(action.skill_speed_bps) || !isSafeUint(action.total_speed_bps) || !isSafeUint(action.tool_speed_bps)
        || action.total_speed_bps !== action.skill_speed_bps + action.tool_speed_bps) return false;
    } else if (action.kind === "Produce") {
      if (!exactObject(action, ["kind", "action_id", "recipe_id", "start_world_time_ms", "end_world_time_ms", "duration_ms", "skill_speed_bps", "total_speed_bps"])
        || !isRecipeId(action.recipe_id) || !isSafeUint(action.skill_speed_bps) || !isSafeUint(action.total_speed_bps)
        || action.total_speed_bps !== action.skill_speed_bps) return false;
    } else return false;
  }
  if (value.state === "moving" && value.motion === null) return false;
  if (value.state === "acting" && value.action === null) return false;
  return value.state === "waiting" || value.state === "paused" ? value.waiting_reason !== null : value.waiting_reason === null;
}

function isReceipt(value: unknown): value is CommandReceiptRecord {
  return exactObject(value, ["command_id", "command_type", "payload_sha256", "terminal_status", "save_revision", "reason_code"])
    && isCommandId(value.command_id) && ["CreateWorld", "SetTask", "CancelTask", "EquipItem", "UnequipSlot"].includes(value.command_type as string)
    && isHexChecksum(value.payload_sha256) && value.terminal_status === "accepted" && isSafeUint(value.save_revision)
    && value.save_revision >= 1 && value.reason_code === null;
}

export function isCoreRecord(value: unknown): value is CoreRecord {
  if (!exactObject(value, ["save_id", "revision", "seed", "world_time_ms", "position", "camp_anchor", "hp", "exploration", "skills", "inventory", "equipment", "task", "execution", "command_receipts", "next_event_ordinal", "last_offline_report"])) return false;
  if (value.save_id !== SAVE_ID || !isSafeUint(value.revision) || value.revision < 1 || !isSeedDecimal(value.seed)
    || !isCanonicalUnsignedDecimal(value.world_time_ms) || !isWorldPoint(value.position) || !isWorldPoint(value.camp_anchor)) return false;
  if (!exactObject(value.hp, ["current", "max"]) || value.hp.current !== 100 || value.hp.max !== 100) return false;
  if (!exactObject(value.exploration, ["level", "total_xp"]) || !isSafeUint(value.exploration.level)
    || value.exploration.level < 1 || value.exploration.level > 100 || !isSafeUint(value.exploration.total_xp)) return false;
  if (!exactObject(value.skills, ["gathering", "woodcutting", "mining", "crafting"])) return false;
  for (const skillId of ["gathering", "woodcutting", "mining", "crafting"] as const) {
    const skill = value.skills[skillId];
    if (!exactObject(skill, ["level", "total_xp"]) || !isSafeUint(skill.level) || skill.level < 1 || skill.level > 100
      || !isSafeUint(skill.total_xp) || skill.level !== levelFromTotalXp(skill.total_xp)) return false;
  }
  if (!exactObject(value.inventory, ["fiber", "softwood", "stone", "copper_ore", "rope", "worn_axe", "worn_pickaxe", "reinforced_axe", "reinforced_pickaxe"])
    || !isSafeUint(value.inventory.fiber) || !isSafeUint(value.inventory.softwood) || !isSafeUint(value.inventory.stone)
    || !isSafeUint(value.inventory.copper_ore) || !isSafeUint(value.inventory.rope)
    || !isSafeUint(value.inventory.worn_axe) || !isSafeUint(value.inventory.worn_pickaxe)
    || !isSafeUint(value.inventory.reinforced_axe) || !isSafeUint(value.inventory.reinforced_pickaxe)) return false;
  if (!exactObject(value.equipment, ["axe", "pickaxe"])
    || !(value.equipment.axe === null || value.equipment.axe === "worn_axe" || value.equipment.axe === "reinforced_axe")
    || !(value.equipment.pickaxe === null || value.equipment.pickaxe === "worn_pickaxe" || value.equipment.pickaxe === "reinforced_pickaxe")
    || value.inventory.worn_axe + (value.equipment.axe === "worn_axe" ? 1 : 0) !== 1
    || value.inventory.worn_pickaxe + (value.equipment.pickaxe === "worn_pickaxe" ? 1 : 0) !== 1) return false;
  if (!(value.task === null || isPersistedTask(value.task)) || !isExecution(value.execution)
    || !Array.isArray(value.command_receipts) || !value.command_receipts.every(isReceipt)
    || !isCanonicalUnsignedDecimal(value.next_event_ordinal) || !(value.last_offline_report === null || isOfflineReport(value.last_offline_report))) return false;
  const receipts = value.command_receipts;
  const revision = value.revision;
  const ids = receipts.map((receipt) => receipt.command_id);
  if (new Set(ids).size !== ids.length || !ids.every((id, index) => index === 0 || ids[index - 1]! < id)) return false;
  if (value.exploration.level !== levelFromTotalXp(value.exploration.total_xp)
    || receipts.some((receipt) => receipt.save_revision > revision)
    || receipts.some((receipt) => receipt.command_type === "CreateWorld" && receipt.save_revision !== 1)
    || receipts.filter((receipt) => receipt.command_type === "CreateWorld").length !== 1) return false;

  const execution = value.execution;
  if (execution.state === "idle" && (value.task !== null || execution.route.length !== 0 || execution.motion !== null || execution.waiting_reason !== null)) return false;
  if (execution.state === "planning" && (value.task === null || execution.route.length !== 0 || execution.motion !== null || execution.waiting_reason !== null)) return false;
  if ((execution.state === "waiting" || execution.state === "moving") && value.task === null) return false;
  if (execution.state === "waiting" && execution.motion !== null) return false;
  if (execution.state === "acting") {
    if (value.task === null || value.task.kind === "Explore" || execution.action === null) return false;
    if (execution.action.kind === "Resource") {
      if (value.task.kind === "Produce" || execution.target_placement_id !== execution.action.placement_id
        || value.task.target_prototype_id !== execution.action.prototype_id) return false;
    } else if (value.task.kind !== "Produce" || execution.target_placement_id !== null
      || value.task.recipe_id !== execution.action.recipe_id) return false;
  }
  if (execution.state !== "acting" && execution.action !== null) return false;
  if (execution.state === "acting" && execution.action !== null
    && (BigInt(execution.action.start_world_time_ms) > BigInt(value.world_time_ms)
      || BigInt(value.world_time_ms) >= BigInt(execution.action.end_world_time_ms))) return false;
  if (execution.state === "moving") {
    const motion = execution.motion;
    if (motion === null || execution.route.length < 2 || execution.route_index >= execution.route.length - 1
      || motion.path_index !== execution.route_index
      || canonicalJson(motion.start) !== canonicalJson(execution.route[execution.route_index])
      || canonicalJson(motion.end) !== canonicalJson(execution.route[execution.route_index + 1])
      || BigInt(motion.start_world_time_ms) > BigInt(value.world_time_ms)
      || BigInt(value.world_time_ms) >= BigInt(motion.end_world_time_ms)) return false;
  }
  if (value.task !== null) {
    const expectedCommandId = `cmd:${value.task.task_id.slice("task:".length)}`;
    if (BigInt(value.task.created_world_time_ms) > BigInt(value.world_time_ms)
      || !receipts.some((receipt) => receipt.command_type === "SetTask" && receipt.command_id === expectedCommandId)) return false;
  }
  if (value.last_offline_report !== null && value.last_offline_report.committedRevision > revision) return false;
  return true;
}

export function isMetaRecord(value: unknown): value is MetaRecord {
  return exactObject(value, ["save_id", "current_revision", "created_wall_clock_ms", "committed_wall_clock_ms", "committed_world_time_ms", "db_schema_version", "save_schema_version", "game_rules_version", "content_version", "generator_version", "integrity_algorithm", "core_checksum_sha256", "world_chunk_count"])
    && value.save_id === SAVE_ID && isSafeUint(value.current_revision) && value.current_revision >= 1
    && isSafeUint(value.created_wall_clock_ms) && isSafeUint(value.committed_wall_clock_ms)
    && value.created_wall_clock_ms <= value.committed_wall_clock_ms
    && isCanonicalUnsignedDecimal(value.committed_world_time_ms) && isVersion(value.db_schema_version)
    && isVersion(value.save_schema_version) && isVersion(value.game_rules_version) && isVersion(value.content_version)
    && isVersion(value.generator_version) && value.integrity_algorithm === INTEGRITY_ALGORITHM
    && isHexChecksum(value.core_checksum_sha256) && isSafeUint(value.world_chunk_count);
}

function isKnownPlacement(value: unknown): value is KnownResourcePlacement {
  return exactObject(value, ["placementId", "prototypeId", "source", "tileX", "tileY", "point", "availability", "spawnCycle", "depletedWorldTimeMs", "nextAvailableWorldTimeMs"])
    && isPlacementId(value.placementId) && isResourcePrototypeId(value.prototypeId) && (value.source === "ambient" || value.source === "guarantee")
    && isCanonicalSignedDecimal(value.tileX, -(1n << 31n), (1n << 31n) - 1n)
    && isCanonicalSignedDecimal(value.tileY, -(1n << 31n), (1n << 31n) - 1n) && isWorldPoint(value.point)
    && value.point.x === (BigInt(value.tileX) * 1024n + 512n).toString()
    && value.point.y === (BigInt(value.tileY) * 1024n + 512n).toString()
    && (value.availability === "active" || value.availability === "depleted") && isSafeUint(value.spawnCycle)
    && (value.depletedWorldTimeMs === null || isCanonicalUnsignedDecimal(value.depletedWorldTimeMs))
    && (value.nextAvailableWorldTimeMs === null || isCanonicalUnsignedDecimal(value.nextAvailableWorldTimeMs))
    && (value.availability === "active"
      ? value.depletedWorldTimeMs === null && value.nextAvailableWorldTimeMs === null
      : value.depletedWorldTimeMs !== null && value.nextAvailableWorldTimeMs !== null
        && BigInt(value.nextAvailableWorldTimeMs) > BigInt(value.depletedWorldTimeMs));
}

export function isWorldChunkRecord(value: unknown): value is WorldChunkRecord {
  if (!exactObject(value, ["chunk_key", "chunk_x", "chunk_y", "revealed_bits", "known_placements", "revision", "record_checksum_sha256"])
    || !isChunkIdentity(value.chunk_key, value.chunk_x, value.chunk_y) || !(value.revealed_bits instanceof Uint8Array)
    || value.revealed_bits.byteLength !== FOG_BYTES_PER_CHUNK || !Array.isArray(value.known_placements)
    || !value.known_placements.every(isKnownPlacement)) return false;
  const placements = value.known_placements;
  return new Set(placements.map((placement) => placement.placementId)).size === placements.length
    && placements.every((placement, index) => index === 0 || placements[index - 1]!.placementId < placement.placementId)
    && placements.every((placement) => `${floorDiv(BigInt(placement.tileX), 64n)},${floorDiv(BigInt(placement.tileY), 64n)}` === value.chunk_key)
    && isSafeUint(value.revision) && value.revision >= 1 && isHexChecksum(value.record_checksum_sha256);
}

function isResumeClaim(value: unknown): value is ResumeClaimRecord {
  return exactObject(value, ["save_id", "claim_id", "base_revision", "base_world_time_ms", "from_wall_clock_ms", "target_wall_clock_ms", "credited_duration_ms", "processing_status", "diagnostic_id"])
    && value.save_id === SAVE_ID && typeof value.claim_id === "string" && /^claim:(?:[1-9][0-9]*):(?:0|[1-9][0-9]*)$/.test(value.claim_id)
    && isSafeUint(value.base_revision) && value.base_revision >= 1 && value.claim_id === `claim:${value.base_revision}:${value.target_wall_clock_ms}`
    && isCanonicalUnsignedDecimal(value.base_world_time_ms) && isSafeUint(value.from_wall_clock_ms) && isSafeUint(value.target_wall_clock_ms)
    && value.target_wall_clock_ms >= value.from_wall_clock_ms
    && isCanonicalUnsignedDecimal(value.credited_duration_ms, 604_800_000n)
    && value.credited_duration_ms === Math.min(value.target_wall_clock_ms - value.from_wall_clock_ms, 604_800_000).toString()
    && value.processing_status === "pending"
    && isDiagnosticId(value.diagnostic_id);
}

function isBackupChunk(value: unknown): value is BackupChunkV1 {
  return exactObject(value, ["chunkKey", "chunkX", "chunkY", "revealedBase64", "knownPlacements", "revision"])
    && isChunkIdentity(value.chunkKey, value.chunkX, value.chunkY) && typeof value.revealedBase64 === "string"
    && (() => { try { base64ToFogBits(value.revealedBase64); return true; } catch { return false; } })()
    && Array.isArray(value.knownPlacements) && value.knownPlacements.every(isKnownPlacement)
    && isSafeUint(value.revision) && value.revision >= 1;
}

async function materializeBackup(snapshot: PersistedSnapshot, databaseVersion: number): Promise<BackupEnvelopeV1> {
  const withoutChecksum: Omit<BackupEnvelopeV1, "checksum"> = {
    product: "baiyue-rpg",
    exportFormatVersion: 1,
    versions: {
      dbSchema: databaseVersion,
      saveSchema: snapshot.meta.save_schema_version,
      gameRules: snapshot.meta.game_rules_version,
      content: snapshot.meta.content_version,
      generator: snapshot.meta.generator_version,
    },
    metadata: {
      saveId: SAVE_ID,
      revision: snapshot.meta.current_revision,
      createdWallClockMs: snapshot.meta.created_wall_clock_ms,
      committedWallClockMs: snapshot.meta.committed_wall_clock_ms,
      committedWorldTimeMs: snapshot.meta.committed_world_time_ms,
      seed: snapshot.core.seed,
    },
    core: snapshot.core,
    chunks: snapshot.chunks.map((chunk) => ({
      chunkKey: chunk.chunk_key, chunkX: chunk.chunk_x, chunkY: chunk.chunk_y,
      revealedBase64: fogBitsToBase64(chunk.revealed_bits), knownPlacements: chunk.known_placements, revision: chunk.revision,
    })),
  };
  return { ...withoutChecksum, checksum: await sha256Canonical(withoutChecksum) };
}

async function parseBackup(bytes: Uint8Array, generatorVersion: number): Promise<PersistedSnapshot> {
  if (bytes.byteLength > 33_554_432) throw new BackupError("backup/file_too_large", "backup exceeds 32 MiB");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch (error: unknown) { throw new BackupError("backup/invalid_utf8", "backup is not valid UTF-8", { cause: error }); }
  let input: unknown;
  try { input = JSON.parse(text); }
  catch (error: unknown) { throw new BackupError("backup/invalid_json", "backup is not valid JSON", { cause: error }); }
  if (!exactObject(input, ["product", "exportFormatVersion", "versions", "metadata", "core", "chunks", "checksum"])) {
    throw new BackupError("backup/invalid_shape", "backup envelope fields are invalid");
  }
  if (input.product !== "baiyue-rpg") throw new BackupError("backup/invalid_product", "backup product is invalid");
  if (input.exportFormatVersion !== 1) throw new BackupError("backup/incompatible_export_version", "backup export version is incompatible");
  if (!exactObject(input.versions, ["dbSchema", "saveSchema", "gameRules", "content", "generator"])
    || !exactObject(input.metadata, ["saveId", "revision", "createdWallClockMs", "committedWallClockMs", "committedWorldTimeMs", "seed"])
    || !Array.isArray(input.chunks) || !isHexChecksum(input.checksum)) {
    throw new BackupError("backup/invalid_shape", "backup metadata fields are invalid");
  }
  const versions = input.versions;
  if (!isVersion(versions.dbSchema) || !isVersion(versions.saveSchema) || !isVersion(versions.gameRules)
    || !isVersion(versions.content) || !isVersion(versions.generator)) {
    throw new BackupError("backup/invalid_shape", "backup versions must be U32 integers");
  }
  if (versions.dbSchema !== DB_SCHEMA_VERSION || versions.saveSchema !== SAVE_SCHEMA_VERSION
    || versions.gameRules !== GAME_RULES_VERSION || versions.content !== CONTENT_VERSION || versions.generator !== generatorVersion) {
    throw new BackupError("backup/incompatible_version", "backup runtime versions are incompatible");
  }
  const metadata = input.metadata;
  const specificError = classifyBackupSpecificFields(metadata, input.core, input.chunks);
  if (specificError !== null) throw specificError;
  if (metadata.saveId !== SAVE_ID || !isSafeUint(metadata.revision) || metadata.revision < 1
    || !isSafeUint(metadata.createdWallClockMs) || !isSafeUint(metadata.committedWallClockMs)
    || metadata.createdWallClockMs > metadata.committedWallClockMs
    || !isCanonicalUnsignedDecimal(metadata.committedWorldTimeMs) || !isSeedDecimal(metadata.seed)
    || !isCoreRecord(input.core) || !input.chunks.every(isBackupChunk)) {
    throw new BackupError("backup/invalid_shape", "backup records are invalid");
  }
  const chunks = input.chunks as BackupChunkV1[];
  if (new Set(chunks.map((chunk) => chunk.chunkKey)).size !== chunks.length) {
    throw new BackupError("backup/duplicate_chunk", "backup contains duplicate chunk keys");
  }
  const orderedChunks = [...chunks].sort((left, right) => compareChunkKeysNumeric(left.chunkKey, right.chunkKey));
  const normalizedWithoutChecksum = {
    product: input.product,
    exportFormatVersion: input.exportFormatVersion,
    versions,
    metadata,
    core: input.core,
    chunks: orderedChunks,
  };
  if (await sha256Canonical(normalizedWithoutChecksum) !== input.checksum) {
    throw new BackupError("backup/checksum_mismatch", "backup checksum does not match canonical content");
  }
  const core = input.core;
  if (metadata.revision !== core.revision || metadata.committedWorldTimeMs !== core.world_time_ms || metadata.seed !== core.seed) {
    throw new BackupError("backup/invalid_shape", "backup metadata does not match core");
  }
  const [coreChecksum, ...chunkChecksums] = await Promise.all([
    sha256Canonical(core),
    ...orderedChunks.map((chunk) => checksumChunkFields({
      chunk_key: chunk.chunkKey, chunk_x: chunk.chunkX, chunk_y: chunk.chunkY,
      revealed_bits: base64ToFogBits(chunk.revealedBase64), known_placements: chunk.knownPlacements, revision: chunk.revision,
    })),
  ]);
  const worldChunks: WorldChunkRecord[] = orderedChunks.map((chunk, index) => ({
    chunk_key: chunk.chunkKey, chunk_x: chunk.chunkX, chunk_y: chunk.chunkY,
    revealed_bits: base64ToFogBits(chunk.revealedBase64), known_placements: chunk.knownPlacements, revision: chunk.revision,
    record_checksum_sha256: chunkChecksums[index]!,
  }));
  const meta: MetaRecord = {
    save_id: SAVE_ID,
    current_revision: metadata.revision,
    created_wall_clock_ms: metadata.createdWallClockMs,
    committed_wall_clock_ms: metadata.committedWallClockMs,
    committed_world_time_ms: metadata.committedWorldTimeMs,
    db_schema_version: DB_SCHEMA_VERSION,
    save_schema_version: SAVE_SCHEMA_VERSION,
    game_rules_version: GAME_RULES_VERSION,
    content_version: CONTENT_VERSION,
    generator_version: generatorVersion,
    integrity_algorithm: INTEGRITY_ALGORITHM,
    core_checksum_sha256: coreChecksum,
    world_chunk_count: worldChunks.length,
  };
  const snapshot: PersistedSnapshot = { meta, core, chunks: worldChunks, resumeClaim: null };
  try { await validateSnapshot(snapshot, generatorVersion); }
  catch (error: unknown) { throw new BackupError("backup/invalid_shape", "backup state relations are invalid", { cause: error }); }
  return snapshot;
}

function classifyBackupSpecificFields(metadata: Record<string, unknown>, core: unknown, chunks: unknown[]): BackupError | null {
  const stack: unknown[] = [metadata, core, chunks];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value === "number" && (!Number.isSafeInteger(value) || Object.is(value, -0))) {
      return new BackupError("backup/unsafe_integer", "backup contains a non-safe integer");
    }
    if (Array.isArray(value)) stack.push(...value);
    else if (value !== null && typeof value === "object") stack.push(...Object.values(value));
  }
  if (metadata.saveId !== SAVE_ID) return new BackupError("backup/invalid_id", "backup save ID is invalid");
  const canonicalUnsigned = /^(?:0|[1-9][0-9]*)$/;
  const canonicalSigned = /^(?:0|-?[1-9][0-9]*)$/;
  const checkUnsigned = (value: unknown, maximum?: bigint): BackupError | null => {
    if (typeof value !== "string" || !canonicalUnsigned.test(value)) return new BackupError("backup/non_canonical_decimal", "backup contains a non-canonical unsigned decimal");
    if (maximum !== undefined && BigInt(value) > maximum) return new BackupError("backup/invalid_shape", "backup decimal exceeds its range");
    return null;
  };
  const checkPoint = (value: unknown): BackupError | null => {
    if (!exactObject(value, ["x", "y"])) return new BackupError("backup/invalid_shape", "backup WorldPoint shape is invalid");
    for (const coordinate of [value.x, value.y]) {
      if (typeof coordinate !== "string" || !canonicalSigned.test(coordinate)) return new BackupError("backup/non_canonical_decimal", "backup coordinate is not canonical");
      if (!isCanonicalSignedDecimal(coordinate, WORLD_POINT_NAV_MIN, WORLD_POINT_NAV_MAX)) {
        return new BackupError("backup/coordinate_out_of_range", "backup WorldPoint is outside the supported range");
      }
    }
    return null;
  };
  const metadataTimeError = checkUnsigned(metadata.committedWorldTimeMs);
  if (metadataTimeError !== null) return metadataTimeError;
  const metadataSeedError = checkUnsigned(metadata.seed, (1n << 64n) - 1n);
  if (metadataSeedError !== null) return metadataSeedError;
  if (core !== null && typeof core === "object" && !Array.isArray(core)) {
    const record = core as Record<string, unknown>;
    if (record.save_id !== SAVE_ID) return new BackupError("backup/invalid_id", "backup core save ID is invalid");
    const seedError = checkUnsigned(record.seed, (1n << 64n) - 1n);
    if (seedError !== null) return seedError;
    const timeError = checkUnsigned(record.world_time_ms);
    if (timeError !== null) return timeError;
    const pointError = checkPoint(record.position);
    if (pointError !== null) return pointError;
    const anchorError = checkPoint(record.camp_anchor);
    if (anchorError !== null) return anchorError;
    const task = record.task;
    if (task !== null && typeof task === "object" && !Array.isArray(task)) {
      const persistedTask = task as Record<string, unknown>;
      if (!isTaskId(persistedTask.task_id)) return new BackupError("backup/invalid_id", "backup task ID is invalid");
      const taskTimeError = checkUnsigned(persistedTask.created_world_time_ms);
      if (taskTimeError !== null) return taskTimeError;
      if (persistedTask.kind === "Explore" && persistedTask.destination !== null) {
        const destinationError = checkPoint(persistedTask.destination);
        if (destinationError !== null) return destinationError;
      }
    }
    if (Array.isArray(record.command_receipts)) {
      for (const receipt of record.command_receipts) {
        if (receipt !== null && typeof receipt === "object" && !Array.isArray(receipt)
          && !isCommandId((receipt as Record<string, unknown>).command_id)) {
          return new BackupError("backup/invalid_id", "backup command receipt ID is invalid");
        }
      }
    }
  }
  for (const chunk of chunks) {
    if (chunk === null || typeof chunk !== "object" || Array.isArray(chunk)) continue;
    const record = chunk as Record<string, unknown>;
    for (const coordinate of [record.chunkX, record.chunkY]) {
      if (typeof coordinate !== "string" || !canonicalSigned.test(coordinate)) return new BackupError("backup/non_canonical_decimal", "backup chunk coordinate is not canonical");
      if (!isCanonicalSignedDecimal(coordinate, CHUNK_COORDINATE_MIN, CHUNK_COORDINATE_MAX)) {
        return new BackupError("backup/coordinate_out_of_range", "backup chunk coordinate is outside the supported range");
      }
    }
    if (record.chunkKey !== `${record.chunkX},${record.chunkY}`) return new BackupError("backup/invalid_id", "backup chunk key is invalid");
  }
  return null;
}

function bytesToHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sha256Canonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  return bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
}

export async function commandPayloadSha256(canonicalPayload: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalPayload)));
}

async function checksumChunkFields(chunk: Pick<WorldChunkRecord, "chunk_key" | "chunk_x" | "chunk_y" | "revealed_bits" | "known_placements" | "revision">): Promise<string> {
  return sha256Canonical({
    chunk_key: chunk.chunk_key,
    chunk_x: chunk.chunk_x,
    chunk_y: chunk.chunk_y,
    revealed_base64: fogBitsToBase64(chunk.revealed_bits),
    known_placements: chunk.known_placements,
    revision: chunk.revision,
  });
}

function storageError(error: unknown, operation: "read" | "write"): PersistenceError {
  if (error instanceof PersistenceError) return error;
  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new PersistenceError("storage/quota_exceeded", "IndexedDB quota was exceeded", null, { cause: error });
  }
  return new PersistenceError(operation === "write" ? "storage/write_failed" : "storage/unavailable", `IndexedDB ${operation} failed`, null, { cause: error });
}

async function settleTransaction(txDone: Promise<unknown>, requests: readonly Promise<unknown>[]): Promise<void> {
  let requestFailure: unknown = null;
  try {
    await Promise.all(requests);
  } catch (error: unknown) {
    requestFailure = error;
  }
  let transactionFailure: unknown = null;
  try {
    await txDone;
  } catch (error: unknown) {
    transactionFailure = error;
  }
  if (requestFailure !== null) throw requestFailure;
  if (transactionFailure !== null) throw transactionFailure;
}

export async function acquireGameplayLock(...override: [] | [LockManager | undefined]): Promise<GameplayLock> {
  const locks = override.length === 0 ? globalThis.navigator?.locks : override[0];
  if (locks === undefined) throw new PersistenceError("platform/web_locks_unavailable", "Web Locks is unavailable");
  let announce!: (lock: GameplayLock | null) => void;
  let rejectAcquisition!: (error: unknown) => void;
  const acquired = new Promise<GameplayLock | null>((resolve, reject) => { announce = resolve; rejectAcquisition = reject; });
  let releaseHold!: () => void;
  const hold = new Promise<void>((resolve) => { releaseHold = resolve; });
  let request!: Promise<unknown>;
  try {
    request = locks.request(GAMEPLAY_LOCK_NAME, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (lock === null) { announce(null); return; }
      let released = false;
      announce({
        async release() {
          if (!released) { released = true; releaseHold(); }
          await request;
        },
      });
      await hold;
    });
  } catch (error: unknown) {
    throw new PersistenceError("storage/unavailable", "Web Lock request failed", null, { cause: error });
  }
  void request.catch((error: unknown) => rejectAcquisition(error));
  let lock: GameplayLock | null;
  try {
    lock = await acquired;
  } catch (error: unknown) {
    throw new PersistenceError("storage/unavailable", "Web Lock request failed before acquisition", null, { cause: error });
  }
  if (lock === null) {
    await request;
    throw new PersistenceError("active_in_other_tab", "the active save is locked by another tab");
  }
  return lock;
}

function createSchema(db: IDBPDatabase<BaiyueGameplayDB>, oldVersion: number): void {
  if (oldVersion !== 0) return;
  db.createObjectStore("meta", { keyPath: "save_id" });
  db.createObjectStore("core", { keyPath: "save_id" });
  db.createObjectStore("world_chunks", { keyPath: "chunk_key" });
  db.createObjectStore("resume_claim", { keyPath: "save_id" });
}

async function auditSchema(db: IDBPDatabase<BaiyueGameplayDB>): Promise<void> {
  const actual = [...db.objectStoreNames].sort();
  const expected = [...STORE_NAMES].sort();
  if (actual.length !== expected.length || actual.some((name, index) => name !== expected[index])) {
    throw new PersistenceError("storage/integrity_failed", "IndexedDB object stores do not match schema v1");
  }
  const tx = db.transaction(STORE_NAMES, "readonly");
  for (const name of STORE_NAMES) {
    const store = tx.objectStore(name);
    if (store.keyPath !== STORE_KEY_PATHS[name] || store.autoIncrement || store.indexNames.length !== 0) {
      tx.abort();
      throw new PersistenceError("storage/integrity_failed", `IndexedDB store ${name} does not match schema v1`);
    }
  }
  await tx.done;
}

function assertVersion(meta: MetaRecord, generatorVersion: number): void {
  const fields = [
    ["db", DB_SCHEMA_VERSION, meta.db_schema_version],
    ["save", SAVE_SCHEMA_VERSION, meta.save_schema_version],
    ["rules", GAME_RULES_VERSION, meta.game_rules_version],
    ["content", CONTENT_VERSION, meta.content_version],
    ["generator", generatorVersion, meta.generator_version],
  ] as const;
  for (const [version, expected, actual] of fields) {
    if (expected !== actual) throw new PersistenceError("save/incompatible_version", `${version} version is incompatible`, { expected, actual, version });
  }
}

async function validateSnapshot(snapshot: PersistedSnapshot, generatorVersion: number): Promise<void> {
  const { meta, core, chunks, resumeClaim } = snapshot;
  if (!isMetaRecord(meta) || !isCoreRecord(core) || !chunks.every(isWorldChunkRecord) || !(resumeClaim === null || isResumeClaim(resumeClaim))) {
    throw new PersistenceError("storage/integrity_failed", "save records have an invalid shape");
  }
  assertVersion(meta, generatorVersion);
  if (meta.current_revision !== core.revision || meta.committed_world_time_ms !== core.world_time_ms
    || meta.world_chunk_count !== chunks.length || new Set(chunks.map((chunk) => chunk.chunk_key)).size !== chunks.length
    || chunks.some((chunk) => chunk.revision > core.revision)) {
    throw new PersistenceError("storage/integrity_failed", "save revision, world time, or chunk count is inconsistent");
  }
  const placementIds = chunks.flatMap((chunk) => chunk.known_placements.map((placement) => placement.placementId));
  if (new Set(placementIds).size !== placementIds.length) {
    throw new PersistenceError("storage/integrity_failed", "known placement IDs are not globally unique");
  }
  if (core.execution.state === "acting") {
    const action = core.execution.action;
    if (action?.kind === "Resource") {
      const target = chunks.flatMap((chunk) => chunk.known_placements)
        .find((placement) => placement.placementId === action.placement_id);
      if (target === undefined || target.availability !== "active" || target.prototypeId !== action.prototype_id) {
        throw new PersistenceError("storage/integrity_failed", "active resource action does not reference an active known placement");
      }
    }
  }
  if (resumeClaim !== null && (resumeClaim.base_revision > core.revision
    || BigInt(resumeClaim.base_world_time_ms) > BigInt(core.world_time_ms)
    || BigInt(core.world_time_ms) - BigInt(resumeClaim.base_world_time_ms) > BigInt(resumeClaim.credited_duration_ms)
    || resumeClaim.from_wall_clock_ms !== meta.committed_wall_clock_ms)) {
    throw new PersistenceError("storage/integrity_failed", "offline claim does not match its committed base");
  }
  const [coreChecksum, ...chunkChecksums] = await Promise.all([
    sha256Canonical(core),
    ...chunks.map((chunk) => checksumChunkFields(chunk)),
  ]);
  if (coreChecksum !== meta.core_checksum_sha256 || chunks.some((chunk, index) => chunk.record_checksum_sha256 !== chunkChecksums[index])) {
    throw new PersistenceError("storage/integrity_failed", "save checksum verification failed");
  }
}

export class GameplayStorage {
  private currentSnapshot: PersistedSnapshot | null = null;
  private schemaAuditFailed = false;

  private constructor(private db: IDBPDatabase<BaiyueGameplayDB>, readonly generatorVersion: number) {}

  static async open(generatorVersion: number): Promise<GameplayStorage> {
    let db: IDBPDatabase<BaiyueGameplayDB> | null = null;
    try {
      db = await openDB<BaiyueGameplayDB>(GAMEPLAY_DATABASE_NAME, DB_SCHEMA_VERSION, {
        upgrade(database, oldVersion) { createSchema(database, oldVersion); },
      });
      const storage = new GameplayStorage(db, generatorVersion);
      try { await auditSchema(db); }
      catch (error: unknown) {
        if (!(error instanceof PersistenceError)) throw error;
        storage.schemaAuditFailed = true;
      }
      return storage;
    } catch (error: unknown) {
      db?.close();
      if (error instanceof DOMException && error.name === "VersionError") {
        try {
          const newer = await openDB<BaiyueGameplayDB>(GAMEPLAY_DATABASE_NAME);
          const storage = new GameplayStorage(newer, generatorVersion);
          try { await auditSchema(newer); }
          catch (auditError: unknown) {
            if (!(auditError instanceof PersistenceError)) { newer.close(); throw auditError; }
            storage.schemaAuditFailed = true;
          }
          return storage;
        } catch (inspectionError: unknown) {
          if (inspectionError instanceof PersistenceError) throw inspectionError;
          throw storageError(inspectionError, "read");
        }
      }
      throw storageError(error, "read");
    }
  }

  close(): void { this.db.close(); }

  private async materialize(): Promise<PersistedSnapshot | null> {
    try {
      const tx = this.db.transaction(STORE_NAMES, "readonly");
      const metaRequest = tx.objectStore("meta").get(SAVE_ID);
      const coreRequest = tx.objectStore("core").get(SAVE_ID);
      const chunksRequest = tx.objectStore("world_chunks").getAll();
      const claimRequest = tx.objectStore("resume_claim").get(SAVE_ID);
      await settleTransaction(tx.done, [metaRequest, coreRequest, chunksRequest, claimRequest]);
      const [meta, core, chunks, claim] = await Promise.all([metaRequest, coreRequest, chunksRequest, claimRequest]);
      if (meta === undefined && core === undefined && chunks.length === 0 && claim === undefined) {
        this.currentSnapshot = null;
        return null;
      }
      if (meta === undefined || core === undefined) throw new PersistenceError("storage/integrity_failed", "save is only partially present");
      const snapshot: PersistedSnapshot = {
        meta,
        core,
        chunks: chunks.sort((left, right) => compareChunkKeysNumeric(left.chunk_key, right.chunk_key)),
        resumeClaim: claim ?? null,
      };
      this.currentSnapshot = snapshot;
      return snapshot;
    } catch (error: unknown) {
      throw storageError(error, "read");
    }
  }

  async load(): Promise<PersistedSnapshot | null> {
    const snapshot = await this.materialize();
    if (this.db.version !== DB_SCHEMA_VERSION) {
      throw new PersistenceError("save/incompatible_version", "IndexedDB schema version is newer than supported", {
        expected: DB_SCHEMA_VERSION, actual: this.db.version, version: "db",
      });
    }
    if (this.schemaAuditFailed) throw new PersistenceError("storage/integrity_failed", "IndexedDB schema audit failed");
    if (snapshot !== null) await validateSnapshot(snapshot, this.generatorVersion);
    return snapshot;
  }

  async create(core: CoreRecord, worldChunks: readonly Readonly<{ chunkKey: string; revealedBase64: string; knownPlacements: readonly KnownResourcePlacement[] }>[], wallClockMs: number): Promise<PersistedSnapshot> {
    try {
      if (this.currentSnapshot !== null) throw new PersistenceError("storage/integrity_failed", "a committed save already exists");
      if (!isCoreRecord(core) || core.revision !== 1 || core.command_receipts.length !== 1
        || core.command_receipts[0]?.command_type !== "CreateWorld" || core.command_receipts[0].save_revision !== 1
        || !isSafeUint(wallClockMs)) throw new PersistenceError("storage/integrity_failed", "new-world snapshot is invalid");
      const chunksWithoutChecksums = worldChunks.map((chunk) => {
        const [chunkX, chunkY] = chunk.chunkKey.split(",");
        if (chunkX === undefined || chunkY === undefined || !isChunkIdentity(chunk.chunkKey, chunkX, chunkY)) {
          throw new PersistenceError("storage/integrity_failed", "new-world fog chunk identity is invalid");
        }
        const knownPlacements = [...chunk.knownPlacements].sort((left, right) => left.placementId < right.placementId ? -1 : 1);
        return { chunk_key: chunk.chunkKey, chunk_x: chunkX, chunk_y: chunkY, revealed_bits: base64ToFogBits(chunk.revealedBase64), known_placements: knownPlacements, revision: 1 };
      }).sort((left, right) => compareChunkKeysNumeric(left.chunk_key, right.chunk_key));
      const [coreChecksum, ...chunkChecksums] = await Promise.all([
        sha256Canonical(core),
        ...chunksWithoutChecksums.map((chunk) => checksumChunkFields(chunk)),
      ]);
      const chunks: WorldChunkRecord[] = chunksWithoutChecksums.map((chunk, index) => ({ ...chunk, record_checksum_sha256: chunkChecksums[index]! }));
      const meta: MetaRecord = {
        save_id: SAVE_ID,
        current_revision: 1,
        created_wall_clock_ms: wallClockMs,
        committed_wall_clock_ms: wallClockMs,
        committed_world_time_ms: core.world_time_ms,
        db_schema_version: DB_SCHEMA_VERSION,
        save_schema_version: SAVE_SCHEMA_VERSION,
        game_rules_version: GAME_RULES_VERSION,
        content_version: CONTENT_VERSION,
        generator_version: this.generatorVersion,
        integrity_algorithm: INTEGRITY_ALGORITHM,
        core_checksum_sha256: coreChecksum,
        world_chunk_count: chunks.length,
      };
      const snapshot: PersistedSnapshot = { meta, core, chunks, resumeClaim: null };
      await validateSnapshot(snapshot, this.generatorVersion);
      const tx = this.db.transaction(STORE_NAMES, "readwrite", { durability: "strict" });
      await settleTransaction(tx.done, [
        tx.objectStore("core").add(core),
        ...chunks.map((chunk) => tx.objectStore("world_chunks").add(chunk)),
        tx.objectStore("meta").add(meta),
      ]);
      this.currentSnapshot = snapshot;
      return snapshot;
    } catch (error: unknown) {
      throw storageError(error, "write");
    }
  }

  async commit(
    core: CoreRecord,
    worldChunks: readonly Readonly<{ chunkKey: string; revealedBase64: string; knownPlacements: readonly KnownResourcePlacement[] }>[],
    wallClockMs: number,
    deleteResumeClaim = false,
  ): Promise<PersistedSnapshot> {
    try {
      const previous = this.currentSnapshot;
      if (previous === null) throw new PersistenceError("storage/integrity_failed", "cannot commit without a base save");
      if (!isCoreRecord(core) || core.revision !== previous.meta.current_revision + 1 || !isSafeUint(wallClockMs)) {
        throw new PersistenceError("storage/integrity_failed", "commit core or revision is invalid");
      }
      const previousChunks = new Map(previous.chunks.map((chunk) => [chunk.chunk_key, chunk]));
      const incoming = new Map<string, Readonly<{ chunkKey: string; revealedBase64: string; knownPlacements: readonly KnownResourcePlacement[] }>>();
      for (const chunk of worldChunks) {
        const [chunkX, chunkY] = chunk.chunkKey.split(",");
        if (chunkX === undefined || chunkY === undefined || !isChunkIdentity(chunk.chunkKey, chunkX, chunkY)
          || incoming.has(chunk.chunkKey)) throw new PersistenceError("storage/integrity_failed", "commit fog chunk identity is invalid");
        base64ToFogBits(chunk.revealedBase64);
        incoming.set(chunk.chunkKey, chunk);
      }
      if ([...previousChunks.keys()].some((key) => !incoming.has(key))) {
        throw new PersistenceError("storage/integrity_failed", "commit cannot remove revealed fog chunks");
      }
      const dirtyWithoutChecksums: Array<Omit<WorldChunkRecord, "record_checksum_sha256">> = [];
      const finalChunks = new Map(previousChunks);
      for (const chunk of incoming.values()) {
        const prior = previousChunks.get(chunk.chunkKey);
        const nextBits = base64ToFogBits(chunk.revealedBase64);
        if (prior !== undefined) {
          for (let index = 0; index < prior.revealed_bits.length; index += 1) {
            const oldByte = prior.revealed_bits[index]!;
            if ((nextBits[index]! & oldByte) !== oldByte) {
              throw new PersistenceError("storage/integrity_failed", "commit cannot clear revealed fog bits");
            }
          }
          const priorById = new Map(prior.known_placements.map((placement) => [placement.placementId, placement]));
          const incomingById = new Map(chunk.knownPlacements.map((placement) => [placement.placementId, placement]));
          if ([...priorById.keys()].some((id) => !incomingById.has(id))) {
            throw new PersistenceError("storage/integrity_failed", "commit cannot remove known placements");
          }
          if (fogBitsToBase64(prior.revealed_bits) === chunk.revealedBase64
            && canonicalJson(prior.known_placements) === canonicalJson([...chunk.knownPlacements].sort((left, right) => left.placementId < right.placementId ? -1 : 1))) continue;
        }
        const [chunkX, chunkY] = chunk.chunkKey.split(",") as [string, string];
        dirtyWithoutChecksums.push({
          chunk_key: chunk.chunkKey, chunk_x: chunkX, chunk_y: chunkY,
          revealed_bits: nextBits,
          known_placements: [...chunk.knownPlacements].sort((left, right) => left.placementId < right.placementId ? -1 : 1),
          revision: core.revision,
        });
      }
      const [coreChecksum, ...dirtyChecksums] = await Promise.all([
        sha256Canonical(core),
        ...dirtyWithoutChecksums.map((chunk) => checksumChunkFields(chunk)),
      ]);
      const dirtyChunks = dirtyWithoutChecksums.map<WorldChunkRecord>((chunk, index) => ({
        ...chunk, record_checksum_sha256: dirtyChecksums[index]!,
      }));
      for (const chunk of dirtyChunks) finalChunks.set(chunk.chunk_key, chunk);
      const chunks = [...finalChunks.values()].sort((left, right) => compareChunkKeysNumeric(left.chunk_key, right.chunk_key));
      const meta: MetaRecord = {
        ...previous.meta,
        current_revision: core.revision,
        committed_wall_clock_ms: wallClockMs,
        committed_world_time_ms: core.world_time_ms,
        core_checksum_sha256: coreChecksum,
        world_chunk_count: chunks.length,
      };
      const snapshot: PersistedSnapshot = {
        meta,
        core,
        chunks,
        resumeClaim: deleteResumeClaim ? null : previous.resumeClaim,
      };
      await validateSnapshot(snapshot, this.generatorVersion);
      const stores = deleteResumeClaim ? STORE_NAMES : (["core", "world_chunks", "meta"] as const);
      const tx = this.db.transaction(stores, "readwrite", { durability: "strict" });
      await settleTransaction(tx.done, [
        tx.objectStore("core").put(core),
        ...dirtyChunks.map((chunk) => tx.objectStore("world_chunks").put(chunk)),
        tx.objectStore("meta").put(meta),
        ...(deleteResumeClaim ? [tx.objectStore("resume_claim").delete(SAVE_ID)] : []),
      ]);
      this.currentSnapshot = snapshot;
      return snapshot;
    } catch (error: unknown) {
      throw storageError(error, "write");
    }
  }

  async createResumeClaim(targetWallClockMs: number, diagnosticId: DiagnosticId): Promise<ResumeClaimRecord> {
    try {
      const previous = this.currentSnapshot;
      if (previous === null) throw new PersistenceError("storage/integrity_failed", "offline claim requires a committed save");
      if (previous.resumeClaim !== null) return previous.resumeClaim;
      if (!isSafeUint(targetWallClockMs) || targetWallClockMs < previous.meta.committed_wall_clock_ms || !isDiagnosticId(diagnosticId)) {
        throw new PersistenceError("storage/integrity_failed", "offline claim target is invalid");
      }
      const elapsed = targetWallClockMs - previous.meta.committed_wall_clock_ms;
      const credited = Math.min(elapsed, 604_800_000);
      const claim: ResumeClaimRecord = {
        save_id: SAVE_ID,
        claim_id: `claim:${previous.meta.current_revision}:${targetWallClockMs}`,
        base_revision: previous.meta.current_revision,
        base_world_time_ms: previous.core.world_time_ms,
        from_wall_clock_ms: previous.meta.committed_wall_clock_ms,
        target_wall_clock_ms: targetWallClockMs,
        credited_duration_ms: credited.toString(),
        processing_status: "pending",
        diagnostic_id: diagnosticId,
      };
      if (!isResumeClaim(claim)) throw new PersistenceError("storage/integrity_failed", "offline claim record is invalid");
      const snapshot: PersistedSnapshot = { ...previous, resumeClaim: claim };
      await validateSnapshot(snapshot, this.generatorVersion);
      const tx = this.db.transaction("resume_claim", "readwrite", { durability: "strict" });
      await settleTransaction(tx.done, [tx.objectStore("resume_claim").add(claim)]);
      this.currentSnapshot = snapshot;
      return claim;
    } catch (error: unknown) {
      throw storageError(error, "write");
    }
  }

  async reset(): Promise<void> {
    try {
      if (this.schemaAuditFailed || this.db.version !== DB_SCHEMA_VERSION) {
        this.db.close();
        await deleteDB(GAMEPLAY_DATABASE_NAME);
        this.db = await openDB<BaiyueGameplayDB>(GAMEPLAY_DATABASE_NAME, DB_SCHEMA_VERSION, {
          upgrade(database, oldVersion) { createSchema(database, oldVersion); },
        });
        await auditSchema(this.db);
        this.schemaAuditFailed = false;
        this.currentSnapshot = null;
        return;
      }
      const tx = this.db.transaction(STORE_NAMES, "readwrite", { durability: "strict" });
      await settleTransaction(tx.done, STORE_NAMES.map((name) => tx.objectStore(name).clear()));
      this.currentSnapshot = null;
    } catch (error: unknown) {
      throw storageError(error, "write");
    }
  }

  async exportBackup(): Promise<Uint8Array> {
    const snapshot = await this.materialize();
    if (snapshot === null) throw new BackupError("save/not_found", "there is no committed save to export");
    try { await validateSnapshot(snapshot, this.generatorVersion); }
    catch (error: unknown) {
      if (!(error instanceof PersistenceError)
        || (error.code !== "storage/integrity_failed" && error.code !== "save/incompatible_version")) throw error;
    }
    let bytes: Uint8Array;
    try { bytes = new TextEncoder().encode(canonicalJson(await materializeBackup(snapshot, this.db.version))); }
    catch (error: unknown) { throw new BackupError("backup/invalid_shape", "stored records cannot be represented as a backup", { cause: error }); }
    if (bytes.byteLength > 33_554_432) throw new BackupError("backup/file_too_large", "canonical backup exceeds 32 MiB");
    return bytes;
  }

  async prepareImport(bytes: Uint8Array): Promise<PersistedSnapshot> {
    return parseBackup(bytes, this.generatorVersion);
  }

  async replaceImportedSnapshot(snapshot: PersistedSnapshot): Promise<PersistedSnapshot> {
    await validateSnapshot(snapshot, this.generatorVersion);
    try {
      const tx = this.db.transaction(STORE_NAMES, "readwrite", { durability: "strict" });
      const requests: Promise<unknown>[] = STORE_NAMES.map((name) => tx.objectStore(name).clear());
      requests.push(
        tx.objectStore("core").put(snapshot.core),
        ...snapshot.chunks.map((chunk) => tx.objectStore("world_chunks").put(chunk)),
        tx.objectStore("meta").put(snapshot.meta),
      );
      await settleTransaction(tx.done, requests);
      this.currentSnapshot = snapshot;
      const verified = await this.load();
      if (verified === null) throw new PersistenceError("storage/integrity_failed", "import committed no save");
      return verified;
    } catch (error: unknown) {
      throw storageError(error, "write");
    }
  }

  async importBackup(bytes: Uint8Array): Promise<PersistedSnapshot> {
    return this.replaceImportedSnapshot(await this.prepareImport(bytes));
  }
}

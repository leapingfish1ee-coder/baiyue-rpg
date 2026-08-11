import { CHUNK_COORDINATE_MAX, CHUNK_COORDINATE_MIN, WORLD_POINT_NAV_MAX, WORLD_POINT_NAV_MIN } from "../world-contract.ts";

export const GAMEPLAY_PROTOCOL_VERSION = 1 as const;
export const DB_SCHEMA_VERSION = 1 as const;
export const SAVE_SCHEMA_VERSION = 2 as const;
export const GAME_RULES_VERSION = 2 as const;
export const CONTENT_VERSION = 2 as const;
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
  | Readonly<{ code: "command/unknown_target_prototype" | "command/content_placement_failed"; params: null; diagnosticId: null }>
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

export type TaskIntent = ExploreTask | GatherTask;

export type ResourceActionSummary = Readonly<{
  actionId: ActionId;
  placementId: PlacementId;
  prototypeId: "wild_fiber";
  durationMs: WorldTimeDecimal;
  remainingMs: WorldTimeDecimal;
  skillSpeedBps: SafeUint;
}>;

export type Activity = Readonly<{
  state: "idle" | "planning" | "moving" | "acting" | "waiting" | "paused";
  phase: "idle" | "exploring" | "acquiring_target" | "moving_to_target" | "gathering" | "auto_exploring" | "waiting" | "paused";
  route: readonly WorldPoint[];
  routePurpose: "explore" | "task_target" | "auto_explore" | null;
  routeIndex: SafeUint;
  etaMs: EtaDecimal | null;
  progressPermille: number | null;
  targetPlacementId: PlacementId | null;
  action: ResourceActionSummary | null;
  reason: ActivityReason | null;
}>;

export type ResourcePlacementSummary = Readonly<{
  placementId: PlacementId;
  prototypeId: "wild_fiber";
  displayName: "野生纤维";
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
  xpGained: SafeUint;
  levelsGained: SafeUint;
  revealedTiles: SafeUint;
  fiberGained: SafeUint;
  gatheringXpGained: SafeUint;
  stopReason: ActivityReason | null;
  committedRevision: SafeUint;
}>;

export type GameplayReadModelV1 = Readonly<{
  protocolVersion: 1;
  readModelRevision: SafeUint;
  gameplayEpoch: SafeUint;
  startup: "acquiring_lock" | "loading_save" | "new_world" | "processing_offline" | "ready" | "active_in_other_tab" | "incompatible_save" | "storage_blocked";
  generatorVersion: U32 | null;
  player: Readonly<{ position: WorldPoint; hp: Readonly<{ current: 100; max: 100 }>; combatScope: "not_implemented_phase_2a" }> | null;
  task: TaskIntent | null;
  activity: Activity;
  exploration: Readonly<{ level: SafeUint; totalXp: SafeUint; currentLevelXp: SafeUint; nextLevelXp: SafeUint | null; observationRadiusTiles: SafeUint; revealedTileCount: SafeUint }> | null;
  skills: Readonly<{ gathering: Readonly<{ level: SafeUint; totalXp: SafeUint; currentLevelXp: SafeUint; nextLevelXp: SafeUint | null; skillSpeedBps: SafeUint }> }> | null;
  inventory: Readonly<{ items: readonly Readonly<{ itemId: "fiber"; displayName: "纤维"; quantity: SafeUint }>[] }> | null;
  knownTargetPrototypeIds: readonly "wild_fiber"[];
  map: Readonly<{ revealedChunks: readonly RevealedChunk[]; resourcePlacements: readonly ResourcePlacementSummary[]; selectedDestination: null }>;
  save: Readonly<{ state: "none" | "saving" | "saved" | "error" | "incompatible" | "active_in_other_tab"; revision: SafeUint; committedWallClockMs: SafeUint | null; localOnly: true; evictionWarning: boolean; lastError: ActivityReason | null }>;
  offlineReport: OfflineReport | null;
}>;

export type GameplayCommand =
  | Readonly<{ type: "CreateWorld"; commandId: CommandId; seed: SeedDecimal; seedSource: "automatic" | "manual"; wallClockMs: SafeUint }>
  | Readonly<{ type: "SetTask"; commandId: CommandId; task: Readonly<{ kind: "Explore"; mode: "continuous"; destination: null }>; wallClockMs: SafeUint }>
  | Readonly<{ type: "SetTask"; commandId: CommandId; task: Readonly<{ kind: "Explore"; mode: "destination"; destination: WorldPoint }>; wallClockMs: SafeUint }>
  | Readonly<{ type: "SetTask"; commandId: CommandId; task: Readonly<{ kind: "Gather"; targetPrototypeId: "wild_fiber"; quantity: SafeUint | null }>; wallClockMs: SafeUint }>
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
const PLACEMENT_ID = /^place:wild-fiber:(?:ambient:(?:0|-?[1-9][0-9]*):(?:0|-?[1-9][0-9]*)|guarantee:(?:initial-observation|ring-a|ring-b))$/;
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
      if (task.kind === "Gather") {
        return hasExactKeys(task, ["kind", "targetPrototypeId", "quantity"])
          && task.targetPrototypeId === "wild_fiber"
          && (task.quantity === null || (isSafeUint(task.quantity) && task.quantity > 0));
      }
      if (task.mode === "continuous") return hasExactKeys(task, ["kind", "mode", "destination"]) && task.kind === "Explore" && task.destination === null;
      return hasExactKeys(task, ["kind", "mode", "destination"]) && task.kind === "Explore" && task.mode === "destination" && isWorldPoint(task.destination);
    }
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
  if (["command/invalid_seed", "command/unknown_target_prototype", "command/content_placement_failed", "save/not_found"].includes(value.code)) return value.params === null && value.diagnosticId === null;
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

export function isTaskIntent(value: unknown): value is TaskIntent {
  return isExploreTask(value) || isGatherTask(value);
}

function isResourceActionSummary(value: unknown): value is ResourceActionSummary {
  return hasExactKeys(value, ["actionId", "placementId", "prototypeId", "durationMs", "remainingMs", "skillSpeedBps"])
    && isActionId(value.actionId) && isPlacementId(value.placementId) && value.prototypeId === "wild_fiber"
    && isCanonicalUnsignedDecimal(value.durationMs) && isCanonicalUnsignedDecimal(value.remainingMs)
    && BigInt(value.remainingMs) <= BigInt(value.durationMs) && isSafeUint(value.skillSpeedBps) && value.skillSpeedBps <= 2_500;
}

function isActivity(value: unknown): value is Activity {
  if (!hasExactKeys(value, ["state", "phase", "route", "routePurpose", "routeIndex", "etaMs", "progressPermille", "targetPlacementId", "action", "reason"]) || !Array.isArray(value.route)) return false;
  if (!["idle", "planning", "moving", "acting", "waiting", "paused"].includes(value.state as string)
    || !["idle", "exploring", "acquiring_target", "moving_to_target", "gathering", "auto_exploring", "waiting", "paused"].includes(value.phase as string)
    || value.route.length > 65_536 || !value.route.every(isWorldPoint)) return false;
  if (!(value.routePurpose === null || ["explore", "task_target", "auto_explore"].includes(value.routePurpose as string))) return false;
  if (!isSafeUint(value.routeIndex) || (value.route.length === 0 ? value.routeIndex !== 0 : value.routeIndex >= value.route.length)) return false;
  if (!(value.etaMs === null || isCanonicalUnsignedDecimal(value.etaMs))) return false;
  if (!(value.progressPermille === null || (Number.isInteger(value.progressPermille) && (value.progressPermille as number) >= 0 && (value.progressPermille as number) <= 1000))) return false;
  if (!(value.targetPlacementId === null || isPlacementId(value.targetPlacementId))) return false;
  if (!(value.action === null || isResourceActionSummary(value.action))) return false;
  if (value.state === "acting" && value.action === null) return false;
  return value.reason === null || isActivityReason(value.reason);
}

function isResourcePlacementSummary(value: unknown): value is ResourcePlacementSummary {
  return hasExactKeys(value, ["placementId", "prototypeId", "displayName", "point", "state", "respawnRemainingMs", "reachable"])
    && isPlacementId(value.placementId) && value.prototypeId === "wild_fiber" && value.displayName === "野生纤维"
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
  return hasExactKeys(value, ["claimId", "rawElapsedMs", "clockSkew", "creditedDurationMs", "discardedDurationMs", "fromWorldTimeMs", "toWorldTimeMs", "taskBefore", "taskAfter", "xpGained", "levelsGained", "revealedTiles", "fiberGained", "gatheringXpGained", "stopReason", "committedRevision"])
    && isClaimId(value.claimId) && typeof value.rawElapsedMs === "number" && Number.isSafeInteger(value.rawElapsedMs)
    && (value.clockSkew === "none" || value.clockSkew === "backward") && isCanonicalUnsignedDecimal(value.creditedDurationMs)
    && isCanonicalUnsignedDecimal(value.discardedDurationMs) && isCanonicalUnsignedDecimal(value.fromWorldTimeMs)
    && isCanonicalUnsignedDecimal(value.toWorldTimeMs) && (value.taskBefore === null || isTaskIntent(value.taskBefore))
    && (value.taskAfter === null || isTaskIntent(value.taskAfter)) && isSafeUint(value.xpGained) && isSafeUint(value.levelsGained)
    && isSafeUint(value.revealedTiles) && isSafeUint(value.fiberGained) && isSafeUint(value.gatheringXpGained)
    && (value.stopReason === null || isActivityReason(value.stopReason)) && isSafeUint(value.committedRevision)
    && (value.clockSkew !== "backward" || (value.rawElapsedMs < 0 && value.creditedDurationMs === "0" && value.discardedDurationMs === "0" && value.toWorldTimeMs === value.fromWorldTimeMs));
}

export function isGameplayReadModel(value: unknown): value is GameplayReadModelV1 {
  if (!hasExactKeys(value, ["protocolVersion", "readModelRevision", "gameplayEpoch", "startup", "generatorVersion", "player", "task", "activity", "exploration", "skills", "inventory", "knownTargetPrototypeIds", "map", "save", "offlineReport"])) return false;
  if (value.protocolVersion !== 1 || !isSafeUint(value.readModelRevision) || !isSafeUint(value.gameplayEpoch)
    || !["acquiring_lock", "loading_save", "new_world", "processing_offline", "ready", "active_in_other_tab", "incompatible_save", "storage_blocked"].includes(value.startup as string)
    || !(value.generatorVersion === null || isU32(value.generatorVersion))) return false;
  if (value.player !== null && !(hasExactKeys(value.player, ["position", "hp", "combatScope"]) && isWorldPoint(value.player.position)
    && hasExactKeys(value.player.hp, ["current", "max"]) && value.player.hp.current === 100 && value.player.hp.max === 100
    && value.player.combatScope === "not_implemented_phase_2a")) return false;
  if (!(value.task === null || isTaskIntent(value.task)) || !isActivity(value.activity)) return false;
  if (value.exploration !== null && !(hasExactKeys(value.exploration, ["level", "totalXp", "currentLevelXp", "nextLevelXp", "observationRadiusTiles", "revealedTileCount"])
    && isSafeUint(value.exploration.level) && isSafeUint(value.exploration.totalXp) && isSafeUint(value.exploration.currentLevelXp)
    && (value.exploration.nextLevelXp === null || isSafeUint(value.exploration.nextLevelXp)) && isSafeUint(value.exploration.observationRadiusTiles)
    && isSafeUint(value.exploration.revealedTileCount))) return false;
  if (value.skills !== null && !(hasExactKeys(value.skills, ["gathering"]) && hasExactKeys(value.skills.gathering, ["level", "totalXp", "currentLevelXp", "nextLevelXp", "skillSpeedBps"])
    && isSafeUint(value.skills.gathering.level) && isSafeUint(value.skills.gathering.totalXp) && isSafeUint(value.skills.gathering.currentLevelXp)
    && (value.skills.gathering.nextLevelXp === null || isSafeUint(value.skills.gathering.nextLevelXp))
    && isSafeUint(value.skills.gathering.skillSpeedBps) && value.skills.gathering.skillSpeedBps <= 2_500)) return false;
  if (value.inventory !== null && !(hasExactKeys(value.inventory, ["items"]) && Array.isArray(value.inventory.items)
    && value.inventory.items.length <= 1 && value.inventory.items.every((item: unknown) => hasExactKeys(item, ["itemId", "displayName", "quantity"])
      && item.itemId === "fiber" && item.displayName === "纤维" && isSafeUint(item.quantity) && item.quantity > 0))) return false;
  if (!Array.isArray(value.knownTargetPrototypeIds) || value.knownTargetPrototypeIds.some((id: unknown) => id !== "wild_fiber")
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

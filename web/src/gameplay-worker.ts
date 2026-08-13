/// <reference lib="webworker" />

import { canonicalJson } from "./gameplay/canonical-json.ts";
import {
  GAMEPLAY_PROTOCOL_VERSION,
  isGameplayWorkerToMain,
  isMainToGameplayWorker,
  isRequestId,
  isU32,
  type ActivityReason,
  type CommandError,
  type FatalError,
  type GameplayCommand,
  type GameplayReadModelV2,
  type GameplayWorkerToMain,
  type LifecycleError,
  type MainToGameplayWorker,
  type OfflineReport,
  type TaskIntent,
} from "./gameplay/contracts.ts";
import { CombatLockedError, EquipmentLevelTooLowError, GameplayEngine, InvalidEquipmentError, InvalidWorldSeedError, ItemUnavailableError, QuantityOverflowError, RecipeLevelTooLowError, SkillLevelTooLowError, UnknownTargetPrototypeError, type EngineTerrainEffect } from "./gameplay/engine.ts";
import { ContentPlacementError } from "./gameplay/content.ts";
import { floorDiv, levelFromTotalXp, tileCoordinate } from "./gameplay/math.ts";
import { RUNTIME_CHUNK_SIZE } from "./world-contract.ts";
import {
  BackupError,
  GameplayStorage,
  PersistenceError,
  acquireGameplayLock,
  commandPayloadSha256,
  type CommandReceiptRecord,
  type CoreRecord,
  type GameplayLock,
  type PersistedSnapshot,
  type PersistedTask,
  type ResumeClaimRecord,
} from "./gameplay/persistence.ts";

const scope = self as DedicatedWorkerGlobalScope;
const TRANSIENT_TERRAIN_ATTEMPTS = 3;

type PendingTerrain = Readonly<{
  terrainRequestId: string;
  effect: EngineTerrainEffect;
  generatorVersion: number;
  promise: Promise<Uint8Array>;
  resolve: (bytes: Uint8Array) => void;
  reject: (error: Error) => void;
}>;

type TerminalCommand = Readonly<{
  commandId: string;
  status: "accepted" | "rejected";
  readModelRevision: number;
  saveRevision: number;
  error: CommandError | null;
  exportBackupUtf8?: Uint8Array;
}>;

type CommandRecord = Readonly<{ payloadSha256: string; terminal: Promise<TerminalCommand> }>;

class StaleTerrainError extends Error {}
class TerrainRequestError extends Error {
  readonly transient: boolean;
  constructor(message: string, transient: boolean) {
    super(message);
    this.transient = transient;
  }
}

let engine: GameplayEngine | null = null;
let storage: GameplayStorage | null = null;
let gameplayLock: GameplayLock | null = null;
let committedSnapshot: PersistedSnapshot | null = null;
let generatorVersion: number | null = null;
let diagnosticOrdinal = 0;
let terrainOrdinal = 0;
let terrainEpoch = -1;
let onlineTimer: ReturnType<typeof setInterval> | null = null;
let lastPerformanceNow = performance.now();
let fractionalOnlineMs = 0;
let lastPostedRevision = -1;
let workPromise: Promise<void> | null = null;
let fatal = false;
let blockedInitializationError: LifecycleError | null = null;
let sessionOfflineReport: OfflineReport | null = null;
let dirtyGeneration = 0;
let committedDirtyGeneration = 0;
let dirtySincePerformanceMs: number | null = null;
let tickQueued = false;
let saveState: GameplayReadModelV2["save"] = {
  state: "none", revision: 0, committedWallClockMs: null, localOnly: true, evictionWarning: false, lastError: null,
};
let startupOverride: GameplayReadModelV2["startup"] | null = null;
let inboxTail: Promise<void> = Promise.resolve();
const pendingTerrain = new Map<string, PendingTerrain>();
const commandRecords = new Map<string, CommandRecord>();
const retryableMutations = new Map<string, () => Promise<TerminalCommand>>();
let lastRetryableCommandId: string | null = null;
let failedCommitRetry: (() => Promise<PersistedSnapshot>) | null = null;
const terminalRequestIds = new Set<string>();

function diagnosticId(component: string, code: string): string {
  const suffix = diagnosticOrdinal.toString(16).padStart(16, "0");
  diagnosticOrdinal += 1;
  return `diag:${component}:${code}:${suffix}`;
}

function post(message: GameplayWorkerToMain, transfer: Transferable[] = []): void {
  if (!isGameplayWorkerToMain(message)) throw new TypeError("gameplay worker produced an invalid outbound message");
  scope.postMessage(message, transfer);
}

function currentRevision(): number { return engine?.revision ?? 0; }
function currentSaveRevision(): number { return committedSnapshot?.meta.current_revision ?? 0; }

function markDirty(): void {
  if (dirtyGeneration >= Number.MAX_SAFE_INTEGER) throw new RangeError("dirty generation exhausted");
  dirtyGeneration += 1;
  if (dirtySincePerformanceMs === null) dirtySincePerformanceMs = performance.now();
}

function emitReadModel(force = false): void {
  if (engine === null) return;
  if (!force && engine.revision === lastPostedRevision) return;
  lastPostedRevision = engine.revision;
  post({
    type: "read-model", protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
    readModel: engine.toReadModel(currentSaveRevision(), committedSnapshot?.meta.committed_wall_clock_ms ?? null, {
      saveState,
      startup: startupOverride ?? undefined,
      offlineReport: sessionOfflineReport ?? committedSnapshot?.core.last_offline_report ?? null,
    }),
  });
}

function cancelPendingTerrain(reason: string): void {
  for (const pending of pendingTerrain.values()) pending.reject(new StaleTerrainError(reason));
  pendingTerrain.clear();
}

function activateTerrainEpoch(epoch: number): void {
  if (terrainEpoch === epoch) return;
  cancelPendingTerrain("gameplay terrain epoch changed");
  terrainOrdinal = 0;
  terrainEpoch = epoch;
}

function requestTerrainOnce(effect: EngineTerrainEffect): Promise<Uint8Array> {
  if (generatorVersion === null) return Promise.reject(new Error("gameplay worker is not initialized"));
  activateTerrainEpoch(effect.gameplayEpoch);
  const shared = [...pendingTerrain.values()].find((pending) => pending.effect.gameplayEpoch === effect.gameplayEpoch
    && pending.effect.seed === effect.seed && pending.effect.chunkKey === effect.chunkKey);
  if (shared !== undefined) return shared.promise.then((bytes) => bytes.slice());

  const terrainRequestId = `terrain:${effect.gameplayEpoch}:${terrainOrdinal}`;
  terrainOrdinal += 1;
  let resolvePromise: (bytes: Uint8Array) => void = () => {};
  let rejectPromise: (error: Error) => void = () => {};
  const promise = new Promise<Uint8Array>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const pending: PendingTerrain = {
    terrainRequestId,
    effect,
    generatorVersion,
    promise,
    resolve(bytes) {
      resolvePromise(bytes.slice());
    },
    reject: rejectPromise,
  };
  pendingTerrain.set(terrainRequestId, pending);
  post({
    type: "terrain-request", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, terrainRequestId,
    gameplayEpoch: effect.gameplayEpoch, readModelRevision: currentRevision(), seed: effect.seed,
    chunkKey: effect.chunkKey, chunkX: effect.chunkX, chunkY: effect.chunkY,
  });
  return promise;
}

async function requestTerrain(effect: EngineTerrainEffect): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= TRANSIENT_TERRAIN_ATTEMPTS; attempt += 1) {
    try {
      return await requestTerrainOnce(effect);
    } catch (error: unknown) {
      if (error instanceof StaleTerrainError) throw error;
      if (!(error instanceof TerrainRequestError) || !error.transient || attempt === TRANSIENT_TERRAIN_ATTEMPTS) throw error;
    }
  }
  throw new Error("terrain retry loop exhausted");
}

function activityReasonForFatal(error: FatalError): ActivityReason {
  if (error.code === "storage/unavailable" || error.code === "storage/write_failed" || error.code === "storage/quota_exceeded" || error.code === "storage/integrity_failed") {
    return { code: "storage_write_failed", params: null, allowedActions: ["open_system", "export", "reset", "retry"], diagnosticId: error.diagnosticId };
  }
  if (error.code === "save/incompatible_version") {
    return { code: "incompatible_save", params: error.params, allowedActions: ["export", "reset"], diagnosticId: error.diagnosticId };
  }
  if (error.code === "active_in_other_tab") return { code: "active_in_other_tab", params: null, allowedActions: ["retry"], diagnosticId: null };
  if (error.code === "integrity/quantity_overflow") {
    return { code: error.code, params: null, allowedActions: ["open_system", "export", "reset"], diagnosticId: error.diagnosticId };
  }
  return { code: "undefined_failure", params: null, allowedActions: ["open_system", "export", "reset"], diagnosticId: error.diagnosticId ?? diagnosticId("worker", "fatal") };
}

function fatalPause(component: string, code: string, exactError?: FatalError): void {
  if (fatal) return;
  fatal = true;
  if (onlineTimer !== null) clearInterval(onlineTimer);
  onlineTimer = null;
  cancelPendingTerrain("gameplay worker entered fatal pause");
  const id = diagnosticId(component, code);
  const error: FatalError = exactError ?? { code: "undefined_failure", params: null, diagnosticId: id };
  const reason = activityReasonForFatal(error);
  startupOverride = error.code === "save/incompatible_version" ? "incompatible_save" : "storage_blocked";
  saveState = {
    state: error.code === "save/incompatible_version" ? "incompatible" : "error",
    revision: currentSaveRevision(), committedWallClockMs: committedSnapshot?.meta.committed_wall_clock_ms ?? null,
    localOnly: true, evictionWarning: false, lastError: reason,
  };
  engine?.pause(reason);
  emitReadModel(true);
  post({
    type: "fatal", protocolVersion: GAMEPLAY_PROTOCOL_VERSION,
    error,
    readModelRevision: currentRevision(), saveRevision: currentSaveRevision(),
  });
}

async function driveEngineWork(publishReadModels = true): Promise<void> {
  const activeEngine = engine;
  if (activeEngine === null) throw new Error("gameplay worker is not initialized");
  while (!fatal) {
    const revisionBefore = activeEngine.revision;
    const effect = activeEngine.step(512);
    if (activeEngine.revision !== revisionBefore) markDirty();
    if (publishReadModels) emitReadModel();
    if (effect.kind === "settled") return;
    if (effect.kind === "yield") {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      continue;
    }
    try {
      const bytes = await requestTerrain(effect);
      if (activeEngine !== engine || effect.gameplayEpoch !== activeEngine.epoch) return;
      activeEngine.provideTerrain(effect, bytes);
    } catch (error: unknown) {
      if (error instanceof StaleTerrainError || activeEngine !== engine || effect.gameplayEpoch !== activeEngine.epoch) return;
      throw error;
    }
  }
}

function startBackgroundWork(): void {
  if (fatal || engine === null || workPromise !== null || !engine.hasPendingWork) return;
  workPromise = driveEngineWork()
    .catch(() => fatalPause("terrain", "work-failed"))
    .finally(() => {
      workPromise = null;
      emitReadModel(true);
      if (!fatal && engine?.hasPendingWork) startBackgroundWork();
    });
}

function advanceOnlineClock(): void {
  if (fatal || engine === null || engine.snapshot().position === null) {
    lastPerformanceNow = performance.now();
    return;
  }
  const now = performance.now();
  const rawDelta = now - lastPerformanceNow + fractionalOnlineMs;
  lastPerformanceNow = now;
  if (!Number.isFinite(rawDelta) || rawDelta < 0) { fractionalOnlineMs = 0; return; }
  const wholeMs = Math.min(Math.floor(rawDelta), Number.MAX_SAFE_INTEGER);
  fractionalOnlineMs = rawDelta - wholeMs;
  if (wholeMs === 0) return;
  engine.advanceBy(BigInt(wholeMs));
  markDirty();
}

async function commitDirty(wallClockMs: number): Promise<void> {
  if (dirtyGeneration === committedDirtyGeneration) return;
  if (storage === null || committedSnapshot === null || engine === null) throw new PersistenceError("storage/unavailable", "cannot save without committed storage");
  const generation = dirtyGeneration;
  const revision = committedSnapshot.meta.current_revision + 1;
  const core = coreFromEngine(revision, committedSnapshot.core.command_receipts);
  const persisted = engine.persistedState();
  const operation = () => storage!.commit(core, persisted.worldChunks, wallClockMs);
  failedCommitRetry = operation;
  const next = await operation();
  failedCommitRetry = null;
  committedSnapshot = next;
  committedDirtyGeneration = generation;
  const fullyCommitted = dirtyGeneration === generation;
  if (fullyCommitted) dirtySincePerformanceMs = null;
  saveState = {
    state: fullyCommitted ? "saved" : "saving", revision: next.meta.current_revision, committedWallClockMs: next.meta.committed_wall_clock_ms,
    localOnly: true, evictionWarning: false, lastError: null,
  };
  engine.touchReadModel();
}

async function processOnlineTick(): Promise<void> {
  advanceOnlineClock();
  if (engine?.needsImmediateCommit && committedSnapshot !== null) {
    saveState = { ...saveState, state: "saving" };
    await commitDirty(Math.floor(Date.now()));
    engine.acknowledgeImmediateCommit();
  }
  const due = dirtySincePerformanceMs !== null && performance.now() - dirtySincePerformanceMs >= 5_000;
  if (due && committedSnapshot !== null) await commitDirty(Math.floor(Date.now()));
  emitReadModel();
  startBackgroundWork();
}

function startOnlineTimer(): void {
  if (onlineTimer !== null || fatal) return;
  lastPerformanceNow = performance.now();
  onlineTimer = setInterval(() => {
    if (tickQueued || fatal) return;
    tickQueued = true;
    inboxTail = inboxTail.then(processOnlineTick).catch((error: unknown) => {
      if (error instanceof QuantityOverflowError) {
        fatalPause("engine", "quantity-overflow", {
          code: "integrity/quantity_overflow", params: null, diagnosticId: diagnosticId("engine", "quantity-overflow"),
        });
        return;
      }
      const persistence = error instanceof PersistenceError ? persistenceLifecycleError(error) : undefined;
      fatalPause("storage", "autosave-failed", persistence);
    }).finally(() => { tickQueued = false; });
  }, 50);
}

function commandPayload(command: GameplayCommand): string {
  if (command.type !== "ImportSave") return canonicalJson(command);
  const bytes = new Uint8Array(command.backupUtf8);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return canonicalJson({ ...command, backupUtf8: btoa(binary) });
}

function persistenceLifecycleError(error: PersistenceError): LifecycleError {
  const id = error.code === "active_in_other_tab" || error.code === "platform/web_locks_unavailable"
    ? null : diagnosticId("storage", error.code.replace("/", "-"));
  if (error.code === "save/incompatible_version") {
    if (error.version !== null) {
      return { code: error.code, params: error.version, diagnosticId: id ?? diagnosticId("storage", "incompatible-version") };
    }
    return { code: "undefined_failure", params: null, diagnosticId: id ?? diagnosticId("storage", "incompatible-version-missing-detail") };
  }
  if (error.code === "active_in_other_tab" || error.code === "platform/web_locks_unavailable") {
    return { code: error.code, params: null, diagnosticId: null };
  }
  return { code: error.code, params: null, diagnosticId: id ?? diagnosticId("storage", "failure") };
}

function persistenceCommandError(error: PersistenceError): CommandError {
  return persistenceLifecycleError(error) as CommandError;
}

function backupCommandError(error: BackupError): CommandError {
  if (error.code === "save/not_found") return { code: error.code, params: null, diagnosticId: null };
  return { code: error.code, params: null, diagnosticId: diagnosticId("backup", error.code.replace("/", "-")) };
}

function persistTask(task: TaskIntent | null): PersistedTask | null {
  if (task === null) return null;
  if (task.kind === "Explore") return {
    task_id: task.taskId, kind: "Explore", mode: task.mode, destination: task.destination,
    created_world_time_ms: task.createdWorldTimeMs,
  };
  if (task.kind === "Hunt") return {
    task_id: task.taskId, kind: "Hunt", archetype_id: task.archetypeId,
    requested_kills: task.requestedKills, completed_kills: task.completedKills,
    created_world_time_ms: task.createdWorldTimeMs,
  };
  const common = { task_id: task.taskId, completed_quantity: task.completedQuantity, created_world_time_ms: task.createdWorldTimeMs };
  switch (task.kind) {
    case "Gather": return { ...common, kind: "Gather", target_prototype_id: "wild_fiber", quantity: task.quantity };
    case "Woodcut": return { ...common, kind: "Woodcut", target_prototype_id: "softwood_tree", quantity: task.quantity };
    case "Mine": return { ...common, kind: "Mine", target_prototype_id: task.targetPrototypeId, quantity: task.quantity };
    case "Produce": return { ...common, kind: "Produce", recipe_id: task.recipeId, requested_quantity: task.requestedQuantity };
  }
}

function restoreTask(task: PersistedTask | null): TaskIntent | null {
  if (task === null) return null;
  if (task.kind === "Explore") return {
    taskId: task.task_id, kind: "Explore", mode: task.mode, destination: task.destination,
    createdWorldTimeMs: task.created_world_time_ms,
  };
  if (task.kind === "Hunt") return {
    taskId: task.task_id, kind: "Hunt", archetypeId: task.archetype_id,
    requestedKills: task.requested_kills, completedKills: task.completed_kills,
    createdWorldTimeMs: task.created_world_time_ms,
  };
  const common = {
    taskId: task.task_id, completedQuantity: task.completed_quantity, createdWorldTimeMs: task.created_world_time_ms,
  };
  switch (task.kind) {
    case "Gather": return { ...common, kind: "Gather", targetPrototypeId: "wild_fiber", quantity: task.quantity };
    case "Woodcut": return { ...common, kind: "Woodcut", targetPrototypeId: "softwood_tree", quantity: task.quantity };
    case "Mine": return { ...common, kind: "Mine", targetPrototypeId: task.target_prototype_id, quantity: task.quantity };
    case "Produce": return { ...common, kind: "Produce", recipeId: task.recipe_id, requestedQuantity: task.requested_quantity };
  }
}

function coreFromEngine(
  revision: number,
  receipts: readonly CommandReceiptRecord[],
  offlineReport: OfflineReport | null = committedSnapshot?.core.last_offline_report ?? null,
): CoreRecord {
  if (engine === null) throw new Error("gameplay engine is unavailable");
  const state = engine.persistedState();
  const task = persistTask(state.task);
  return {
    save_id: "save:local",
    revision,
    seed: state.seed,
    world_time_ms: state.worldTimeMs,
    position: state.position,
    camp_anchor: state.campAnchor,
    hp: {
      current_micro: state.playerHpMicro,
      max_micro: state.playerMaxHpMicro,
      regen_numerator: state.hpRegenNumerator,
    },
    exploration: { level: levelFromTotalXp(state.totalXp), total_xp: state.totalXp },
    skills: {
      gathering: { level: levelFromTotalXp(state.gatheringXp), total_xp: state.gatheringXp },
      woodcutting: { level: levelFromTotalXp(state.woodcuttingXp), total_xp: state.woodcuttingXp },
      mining: { level: levelFromTotalXp(state.miningXp), total_xp: state.miningXp },
      crafting: { level: levelFromTotalXp(state.craftingXp), total_xp: state.craftingXp },
      melee: { level: levelFromTotalXp(state.meleeXp), total_xp: state.meleeXp },
      stealth: { level: levelFromTotalXp(state.stealthXp), total_xp: state.stealthXp },
    },
    inventory: {
      fiber: state.fiber, softwood: state.softwood, stone: state.stone, copper_ore: state.copperOre,
      rope: state.rope, raw_hide: state.rawHide, worn_axe: state.wornAxe, worn_pickaxe: state.wornPickaxe,
      reinforced_axe: state.reinforcedAxe, reinforced_pickaxe: state.reinforcedPickaxe,
    },
    equipment: { ...state.equipment },
    task,
    execution: {
      state: state.execution.state,
      route_purpose: state.execution.routePurpose,
      route: state.execution.route,
      route_index: state.execution.routeIndex,
      motion: state.execution.motion === null ? null : {
        start: state.execution.motion.start,
        end: state.execution.motion.end,
        start_world_time_ms: state.execution.motion.startWorldTimeMs,
        end_world_time_ms: state.execution.motion.endWorldTimeMs,
        accumulated_weighted_cost: state.execution.motion.accumulatedWeightedCost,
        total_weighted_cost: state.execution.motion.totalWeightedCost,
        path_index: state.execution.motion.pathIndex,
      },
      target_placement_id: state.execution.targetPlacementId,
      action: state.execution.action === null ? null : state.execution.action.kind === "Resource" ? {
        kind: "Resource",
        action_id: state.execution.action.actionId,
        placement_id: state.execution.action.placementId,
        prototype_id: state.execution.action.prototypeId,
        start_world_time_ms: state.execution.action.startWorldTimeMs,
        end_world_time_ms: state.execution.action.endWorldTimeMs,
        duration_ms: state.execution.action.durationMs,
        skill_speed_bps: state.execution.action.skillSpeedBps,
        tool_speed_bps: state.execution.action.toolSpeedBps,
        total_speed_bps: state.execution.action.totalSpeedBps,
      } : {
        kind: "Produce",
        action_id: state.execution.action.actionId,
        recipe_id: state.execution.action.recipeId,
        start_world_time_ms: state.execution.action.startWorldTimeMs,
        end_world_time_ms: state.execution.action.endWorldTimeMs,
        duration_ms: state.execution.action.durationMs,
        skill_speed_bps: state.execution.action.skillSpeedBps,
        total_speed_bps: state.execution.action.totalSpeedBps,
      },
      waiting_reason: state.execution.waitingReason,
    },
    combat: state.combat,
    respawn: state.respawn,
    revival_grace_until_world_time_ms: state.revivalGraceUntilWorldTimeMs,
    counters: {
      target_kills: state.targetKills,
      other_kills: state.otherKills,
      deaths: state.deaths,
      respawns: state.respawns,
    },
    command_receipts: [...receipts].sort((left, right) => left.command_id < right.command_id ? -1 : left.command_id > right.command_id ? 1 : 0),
    next_event_ordinal: state.nextEventOrdinal,
    last_offline_report: offlineReport,
  };
}

function restoreEngine(snapshot: PersistedSnapshot): void {
  if (generatorVersion === null) throw new Error("generator version is unavailable");
  const core = snapshot.core;
  if (engine === null) engine = new GameplayEngine(generatorVersion);
  engine.restore({
    seed: core.seed,
    worldTimeMs: core.world_time_ms,
    position: core.position,
    campAnchor: core.camp_anchor,
    totalXp: core.exploration.total_xp,
    gatheringXp: core.skills.gathering.total_xp,
    woodcuttingXp: core.skills.woodcutting.total_xp,
    miningXp: core.skills.mining.total_xp,
    craftingXp: core.skills.crafting.total_xp,
    meleeXp: core.skills.melee.total_xp,
    stealthXp: core.skills.stealth.total_xp,
    fiber: core.inventory.fiber,
    softwood: core.inventory.softwood,
    stone: core.inventory.stone,
    copperOre: core.inventory.copper_ore,
    rope: core.inventory.rope,
    rawHide: core.inventory.raw_hide,
    wornAxe: core.inventory.worn_axe,
    wornPickaxe: core.inventory.worn_pickaxe,
    reinforcedAxe: core.inventory.reinforced_axe,
    reinforcedPickaxe: core.inventory.reinforced_pickaxe,
    equipment: { ...core.equipment },
    task: restoreTask(core.task),
    executionState: core.execution.state,
    routePurpose: core.execution.route_purpose,
    targetPlacementId: core.execution.target_placement_id,
    action: core.execution.action === null ? null : core.execution.action.kind === "Resource" ? {
      kind: "Resource",
      actionId: core.execution.action.action_id,
      placementId: core.execution.action.placement_id,
      prototypeId: core.execution.action.prototype_id,
      startWorldTimeMs: core.execution.action.start_world_time_ms,
      endWorldTimeMs: core.execution.action.end_world_time_ms,
      durationMs: core.execution.action.duration_ms,
      skillSpeedBps: core.execution.action.skill_speed_bps,
      toolSpeedBps: core.execution.action.tool_speed_bps,
      totalSpeedBps: core.execution.action.total_speed_bps,
    } : {
      kind: "Produce",
      actionId: core.execution.action.action_id,
      recipeId: core.execution.action.recipe_id,
      startWorldTimeMs: core.execution.action.start_world_time_ms,
      endWorldTimeMs: core.execution.action.end_world_time_ms,
      durationMs: core.execution.action.duration_ms,
      skillSpeedBps: core.execution.action.skill_speed_bps,
      totalSpeedBps: core.execution.action.total_speed_bps,
    },
    waitingReason: core.execution.waiting_reason,
    worldChunks: snapshot.chunks.map((chunk) => ({
      chunkKey: chunk.chunk_key,
      revealedBase64: btoa(String.fromCharCode(...chunk.revealed_bits)),
      knownPlacements: chunk.known_placements,
      knownEnemyPlacements: chunk.known_enemy_placements,
    })),
    playerHpMicro: core.hp.current_micro,
    playerMaxHpMicro: core.hp.max_micro,
    hpRegenNumerator: core.hp.regen_numerator,
    combat: core.combat,
    respawn: core.respawn,
    revivalGraceUntilWorldTimeMs: core.revival_grace_until_world_time_ms,
    targetKills: core.counters.target_kills,
    otherKills: core.counters.other_kills,
    deaths: core.counters.deaths,
    respawns: core.counters.respawns,
    nextEventOrdinal: core.next_event_ordinal,
  });
  activateTerrainEpoch(engine.epoch);
  commandRecords.clear();
  for (const receipt of core.command_receipts) {
    const terminal: TerminalCommand = {
      commandId: receipt.command_id,
      status: "accepted",
      readModelRevision: engine.revision,
      saveRevision: receipt.save_revision,
      error: null,
    };
    commandRecords.set(receipt.command_id, { payloadSha256: receipt.payload_sha256, terminal: Promise.resolve(terminal) });
  }
}

async function primeTerrainBrokerForLoadedWorld(): Promise<void> {
  if (engine === null) return;
  const state = engine.persistedState();
  const chunkSize = BigInt(RUNTIME_CHUNK_SIZE);
  const chunkX = floorDiv(tileCoordinate(BigInt(state.position.x)), chunkSize);
  const chunkY = floorDiv(tileCoordinate(BigInt(state.position.y)), chunkSize);
  await requestTerrain({
    kind: "terrain-request",
    gameplayEpoch: engine.epoch,
    seed: state.seed,
    chunkKey: `${chunkX},${chunkY}`,
    chunkX: chunkX.toString(),
    chunkY: chunkY.toString(),
  });
}

function recoverCommittedSimulation(snapshot: PersistedSnapshot): void {
  committedSnapshot = snapshot;
  restoreEngine(snapshot);
  fatal = false;
  startupOverride = null;
  committedDirtyGeneration = dirtyGeneration;
  dirtySincePerformanceMs = dirtyGeneration === committedDirtyGeneration ? null : performance.now();
  saveState = {
    state: "saved", revision: snapshot.meta.current_revision, committedWallClockMs: snapshot.meta.committed_wall_clock_ms,
    localOnly: true, evictionWarning: false, lastError: null,
  };
  sessionOfflineReport = snapshot.core.last_offline_report;
  engine?.touchReadModel();
  emitReadModel(true);
  startOnlineTimer();
  startBackgroundWork();
}

function taskClone(task: ReturnType<GameplayEngine["snapshot"]>["task"]): ReturnType<GameplayEngine["snapshot"]>["task"] {
  return task === null ? null : structuredClone(task);
}

async function processOfflineClaim(claim: ResumeClaimRecord): Promise<void> {
  if (engine === null || storage === null || committedSnapshot === null) throw new PersistenceError("storage/unavailable", "offline processing requires a loaded save");
  const base = committedSnapshot;
  const before = engine.snapshot();
  const taskBefore = taskClone(before.task);
  const credited = BigInt(claim.credited_duration_ms);
  const alreadyProcessed = before.worldTimeMs - BigInt(claim.base_world_time_ms);
  if (alreadyProcessed < 0n || alreadyProcessed > credited) {
    throw new PersistenceError("storage/integrity_failed", "offline claim progress is outside the credited duration");
  }
  let remaining = credited - alreadyProcessed;
  let processed = alreadyProcessed;
  let maxSliceMs = 0;
  startupOverride = "processing_offline";
  engine.touchReadModel();
  emitReadModel(true);
  while (remaining > 0n) {
    const sliceStart = performance.now();
    await driveEngineWork(false);
    const worldBefore = engine.snapshot().worldTimeMs;
    const unconsumed = engine.advanceBy(remaining);
    const worldAfter = engine.snapshot().worldTimeMs;
    const advanced = worldAfter - worldBefore;
    processed += advanced;
    remaining = unconsumed;
    if (advanced > 0n) markDirty();
    const sliceDuration = performance.now() - sliceStart;
    if (sliceDuration > maxSliceMs) maxSliceMs = sliceDuration;
    post({
      type: "offline-progress", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, claimId: claim.claim_id,
      processedDurationMs: processed.toString(), creditedDurationMs: claim.credited_duration_ms, sliceMaxMs: maxSliceMs,
    });
    if (engine.needsImmediateCommit) {
      if (committedSnapshot === null) throw new PersistenceError("storage/unavailable", "offline settlement requires a committed save");
      const revision = committedSnapshot.meta.current_revision + 1;
      const generation = dirtyGeneration;
      const core = coreFromEngine(revision, committedSnapshot.core.command_receipts);
      committedSnapshot = await storage.commit(
        core,
        engine.persistedState().worldChunks,
        committedSnapshot.meta.committed_wall_clock_ms,
      );
      committedDirtyGeneration = generation;
      if (dirtyGeneration === generation) dirtySincePerformanceMs = null;
      engine.acknowledgeImmediateCommit();
    }
    if (advanced === 0n && engine.snapshot().activityState !== "planning") {
      throw new PersistenceError("storage/integrity_failed", "offline engine made no progress outside planning");
    }
    if (remaining > 0n) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  await driveEngineWork(false);
  const after = engine.snapshot();
  const nextRevision = committedSnapshot.meta.current_revision + 1;
  const rawElapsed = claim.target_wall_clock_ms - claim.from_wall_clock_ms;
  const report: OfflineReport = {
    claimId: claim.claim_id,
    rawElapsedMs: rawElapsed,
    clockSkew: "none",
    creditedDurationMs: claim.credited_duration_ms,
    discardedDurationMs: (BigInt(rawElapsed) - credited).toString(),
    fromWorldTimeMs: before.worldTimeMs.toString(),
    toWorldTimeMs: after.worldTimeMs.toString(),
    taskBefore,
    taskAfter: taskClone(after.task),
    revealedTiles: after.revealedTileCount - before.revealedTileCount,
    itemDeltas: [
      { itemId: "fiber" as const, displayName: "纤维" as const, quantity: after.fiber - before.fiber },
      { itemId: "softwood" as const, displayName: "软木" as const, quantity: after.softwood - before.softwood },
      { itemId: "stone" as const, displayName: "石料" as const, quantity: after.stone - before.stone },
      { itemId: "copper_ore" as const, displayName: "铜矿石" as const, quantity: after.copperOre - before.copperOre },
      { itemId: "rope" as const, displayName: "绳索" as const, quantity: after.rope - before.rope },
      { itemId: "raw_hide" as const, displayName: "生皮" as const, quantity: after.rawHide - before.rawHide },
      { itemId: "reinforced_axe" as const, displayName: "强化斧" as const, quantity: after.reinforcedAxe - before.reinforcedAxe },
      { itemId: "reinforced_pickaxe" as const, displayName: "强化镐" as const, quantity: after.reinforcedPickaxe - before.reinforcedPickaxe },
    ].filter((delta) => delta.quantity !== 0),
    skillXpGains: [
      { skillId: "exploration" as const, displayName: "探索" as const, xp: after.totalXp - before.totalXp },
      { skillId: "gathering" as const, displayName: "采集" as const, xp: after.gatheringXp - before.gatheringXp },
      { skillId: "woodcutting" as const, displayName: "伐木" as const, xp: after.woodcuttingXp - before.woodcuttingXp },
      { skillId: "mining" as const, displayName: "采矿" as const, xp: after.miningXp - before.miningXp },
      { skillId: "crafting" as const, displayName: "工艺" as const, xp: after.craftingXp - before.craftingXp },
      { skillId: "melee" as const, displayName: "近战" as const, xp: after.meleeXp - before.meleeXp },
      { skillId: "stealth" as const, displayName: "潜行" as const, xp: after.stealthXp - before.stealthXp },
    ].filter((gain) => gain.xp > 0),
    targetKills: after.targetKills - before.targetKills,
    otherKills: after.otherKills - before.otherKills,
    deaths: after.deaths - before.deaths,
    respawns: after.respawns - before.respawns,
    finalHpMicro: after.playerHpMicro.toString(),
    stopReason: engine.toReadModel().activity.reason,
    committedRevision: nextRevision,
  };
  const core = coreFromEngine(nextRevision, base.core.command_receipts, report);
  const generation = dirtyGeneration;
  const next = await storage.commit(core, engine.persistedState().worldChunks, claim.target_wall_clock_ms, true);
  committedSnapshot = next;
  committedDirtyGeneration = generation;
  dirtySincePerformanceMs = dirtyGeneration === generation ? null : performance.now();
  sessionOfflineReport = report;
  saveState = {
    state: dirtyGeneration === generation ? "saved" : "saving", revision: nextRevision,
    committedWallClockMs: claim.target_wall_clock_ms, localOnly: true, evictionWarning: false, lastError: null,
  };
  startupOverride = null;
  engine.touchReadModel();
  emitReadModel(true);
}

async function processOfflineAtInitialization(currentWallClockMs: number): Promise<void> {
  if (engine === null || storage === null || committedSnapshot === null) return;
  while (true) {
    const base = committedSnapshot;
    const pending = base.resumeClaim;
    if (pending !== null) {
      await processOfflineClaim(pending);
      continue;
    }
    const rawElapsed = currentWallClockMs - base.meta.committed_wall_clock_ms;
    if (rawElapsed < 0) {
      const snapshot = engine.snapshot();
      sessionOfflineReport = {
        claimId: `claim:${base.meta.current_revision}:${currentWallClockMs}`,
        rawElapsedMs: rawElapsed,
        clockSkew: "backward",
        creditedDurationMs: "0",
        discardedDurationMs: "0",
        fromWorldTimeMs: snapshot.worldTimeMs.toString(),
        toWorldTimeMs: snapshot.worldTimeMs.toString(),
        taskBefore: taskClone(snapshot.task),
        taskAfter: taskClone(snapshot.task),
        revealedTiles: 0,
        itemDeltas: [],
        skillXpGains: [],
        targetKills: 0,
        otherKills: 0,
        deaths: 0,
        respawns: 0,
        finalHpMicro: snapshot.playerHpMicro.toString(),
        stopReason: null,
        committedRevision: base.meta.current_revision,
      };
      engine.touchReadModel();
      emitReadModel(true);
      return;
    }
    if (rawElapsed === 0) return;
    const claim = await storage.createResumeClaim(currentWallClockMs, diagnosticId("offline", "resume-claim"));
    committedSnapshot = { ...base, resumeClaim: claim };
    await processOfflineClaim(claim);
    return;
  }
}

async function persistentMutation(
  command: GameplayCommand,
  operation: () => Promise<PersistedSnapshot>,
): Promise<PersistedSnapshot> {
  try {
    return await operation();
  } catch (error: unknown) {
    if (!(error instanceof PersistenceError)) throw error;
    const retry = async (): Promise<TerminalCommand> => {
      try {
        const snapshot = await operation();
        retryableMutations.delete(command.commandId);
        if (lastRetryableCommandId === command.commandId) lastRetryableCommandId = null;
        recoverCommittedSimulation(snapshot);
        const terminal: TerminalCommand = {
          commandId: command.commandId, status: "accepted", readModelRevision: currentRevision(),
          saveRevision: snapshot.meta.current_revision, error: null,
        };
        commandRecords.set(command.commandId, { payloadSha256: await commandPayloadSha256(commandPayload(command)), terminal: Promise.resolve(terminal) });
        return terminal;
      } catch (retryError: unknown) {
        const persistence = retryError instanceof PersistenceError
          ? retryError : new PersistenceError("storage/write_failed", "retry transaction failed", null, { cause: retryError });
        fatalPause("storage", "retry-failed", persistenceLifecycleError(persistence));
        return rejection(command.commandId, persistenceCommandError(persistence));
      }
    };
    retryableMutations.set(command.commandId, retry);
    lastRetryableCommandId = command.commandId;
    throw error;
  }
}

function completeResetState(): void {
  committedSnapshot = null;
  if (engine === null) {
    if (generatorVersion === null) throw new PersistenceError("storage/unavailable", "generator version is unavailable after reset");
    engine = new GameplayEngine(generatorVersion);
  } else {
    engine.resetToNewWorld();
  }
  activateTerrainEpoch(engine.epoch);
  dirtyGeneration += 1;
  committedDirtyGeneration = dirtyGeneration;
  dirtySincePerformanceMs = null;
  fatal = false;
  blockedInitializationError = null;
  startupOverride = null;
  saveState = { state: "none", revision: 0, committedWallClockMs: null, localOnly: true, evictionWarning: false, lastError: null };
  engine.touchReadModel();
  emitReadModel(true);
}

async function persistentReset(command: Extract<GameplayCommand, { type: "ResetSave" }>): Promise<void> {
  if (storage === null) throw new PersistenceError("storage/unavailable", "ResetSave requires initialized storage");
  const operation = () => storage!.reset();
  try {
    await operation();
  } catch (error: unknown) {
    if (!(error instanceof PersistenceError)) throw error;
    const retry = async (): Promise<TerminalCommand> => {
      try {
        await operation();
        retryableMutations.delete(command.commandId);
        if (lastRetryableCommandId === command.commandId) lastRetryableCommandId = null;
        completeResetState();
        const terminal: TerminalCommand = {
          commandId: command.commandId, status: "accepted", readModelRevision: currentRevision(), saveRevision: 0, error: null,
        };
        commandRecords.set(command.commandId, { payloadSha256: await commandPayloadSha256(commandPayload(command)), terminal: Promise.resolve(terminal) });
        return terminal;
      } catch (retryError: unknown) {
        const persistence = retryError instanceof PersistenceError
          ? retryError : new PersistenceError("storage/write_failed", "reset retry failed", null, { cause: retryError });
        fatalPause("storage", "reset-retry-failed", persistenceLifecycleError(persistence));
        return rejection(command.commandId, persistenceCommandError(persistence));
      }
    };
    retryableMutations.set(command.commandId, retry);
    lastRetryableCommandId = command.commandId;
    throw error;
  }
  completeResetState();
}

function rejection(commandId: string, error: CommandError): TerminalCommand {
  return { commandId, status: "rejected", readModelRevision: currentRevision(), saveRevision: currentSaveRevision(), error };
}

async function executeCommand(command: GameplayCommand, payloadSha256: string): Promise<TerminalCommand> {
  if ((engine === null && command.type !== "ExportSave" && command.type !== "ResetSave")
    || (fatal && command.type !== "ExportSave" && command.type !== "ResetSave")) {
    return rejection(command.commandId, { code: "undefined_failure", params: null, diagnosticId: diagnosticId("worker", "unavailable") });
  }
  try {
    switch (command.type) {
      case "CreateWorld":
        if (engine === null) throw new PersistenceError("storage/unavailable", "CreateWorld requires an initialized engine");
        if (storage === null) throw new PersistenceError("storage/unavailable", "gameplay storage is not initialized");
        if (committedSnapshot !== null) {
          return rejection(command.commandId, { code: "undefined_failure", params: null, diagnosticId: diagnosticId("storage", "save-already-exists") });
        }
        cancelPendingTerrain("new world command replaced terrain epoch");
        engine.beginCreateWorld(command.seed);
        activateTerrainEpoch(engine.epoch);
        await driveEngineWork(false);
        if (engine.snapshot().position === null) throw new Error("world creation did not settle");
        saveState = { state: "saving", revision: 0, committedWallClockMs: null, localOnly: true, evictionWarning: false, lastError: null };
        startupOverride = "new_world";
        const receipt: CommandReceiptRecord = {
          command_id: command.commandId,
          command_type: "CreateWorld",
          payload_sha256: payloadSha256,
          terminal_status: "accepted",
          save_revision: 1,
          reason_code: null,
        };
        const core = coreFromEngine(1, [receipt]);
        const worldChunks = engine.persistedState().worldChunks;
        committedSnapshot = await persistentMutation(command, () => storage!.create(core, worldChunks, command.wallClockMs));
        dirtyGeneration += 1;
        committedDirtyGeneration = dirtyGeneration;
        dirtySincePerformanceMs = null;
        startupOverride = null;
        saveState = { state: "saved", revision: 1, committedWallClockMs: command.wallClockMs, localOnly: true, evictionWarning: false, lastError: null };
        startOnlineTimer();
        emitReadModel(true);
        break;
      case "SetTask":
        if (engine === null) throw new PersistenceError("storage/unavailable", "SetTask requires an initialized engine");
        advanceOnlineClock();
        engine.setTask(command.commandId, command.task);
        cancelPendingTerrain("task command invalidated planning continuation");
        markDirty();
        if (storage === null || committedSnapshot === null) throw new PersistenceError("storage/unavailable", "SetTask requires a committed save");
        {
          const revision = committedSnapshot.meta.current_revision + 1;
          const receipt: CommandReceiptRecord = {
            command_id: command.commandId, command_type: "SetTask", payload_sha256: payloadSha256,
            terminal_status: "accepted", save_revision: revision, reason_code: null,
          };
          const generation = dirtyGeneration;
          const core = coreFromEngine(revision, [...committedSnapshot.core.command_receipts, receipt]);
          const worldChunks = engine.persistedState().worldChunks;
          committedSnapshot = await persistentMutation(command, () => storage!.commit(core, worldChunks, command.wallClockMs));
          committedDirtyGeneration = generation;
          if (dirtyGeneration === generation) dirtySincePerformanceMs = null;
          saveState = { state: "saved", revision, committedWallClockMs: command.wallClockMs, localOnly: true, evictionWarning: false, lastError: null };
          engine.touchReadModel();
        }
        emitReadModel(true);
        startBackgroundWork();
        break;
      case "CancelTask":
        if (engine === null) throw new PersistenceError("storage/unavailable", "CancelTask requires an initialized engine");
        advanceOnlineClock();
        cancelPendingTerrain("cancel command invalidated planning continuation");
        engine.cancelTask();
        markDirty();
        if (storage === null || committedSnapshot === null) throw new PersistenceError("storage/unavailable", "CancelTask requires a committed save");
        {
          const revision = committedSnapshot.meta.current_revision + 1;
          const receipt: CommandReceiptRecord = {
            command_id: command.commandId, command_type: "CancelTask", payload_sha256: payloadSha256,
            terminal_status: "accepted", save_revision: revision, reason_code: null,
          };
          const generation = dirtyGeneration;
          const core = coreFromEngine(revision, [...committedSnapshot.core.command_receipts, receipt]);
          const worldChunks = engine.persistedState().worldChunks;
          committedSnapshot = await persistentMutation(command, () => storage!.commit(core, worldChunks, command.wallClockMs));
          committedDirtyGeneration = generation;
          if (dirtyGeneration === generation) dirtySincePerformanceMs = null;
          saveState = { state: "saved", revision, committedWallClockMs: command.wallClockMs, localOnly: true, evictionWarning: false, lastError: null };
          engine.touchReadModel();
        }
        emitReadModel(true);
        break;
      case "EquipItem":
      case "UnequipSlot":
        if (engine === null) throw new PersistenceError("storage/unavailable", `${command.type} requires an initialized engine`);
        advanceOnlineClock();
        if (command.type === "EquipItem") engine.equipItem(command.itemId);
        else engine.unequipSlot(command.slot);
        cancelPendingTerrain("equipment command invalidated execution continuation");
        markDirty();
        if (storage === null || committedSnapshot === null) throw new PersistenceError("storage/unavailable", `${command.type} requires a committed save`);
        {
          const revision = committedSnapshot.meta.current_revision + 1;
          const receipt: CommandReceiptRecord = {
            command_id: command.commandId, command_type: command.type, payload_sha256: payloadSha256,
            terminal_status: "accepted", save_revision: revision, reason_code: null,
          };
          const generation = dirtyGeneration;
          const core = coreFromEngine(revision, [...committedSnapshot.core.command_receipts, receipt]);
          const worldChunks = engine.persistedState().worldChunks;
          committedSnapshot = await persistentMutation(command, () => storage!.commit(core, worldChunks, command.wallClockMs));
          committedDirtyGeneration = generation;
          if (dirtyGeneration === generation) dirtySincePerformanceMs = null;
          saveState = { state: "saved", revision, committedWallClockMs: command.wallClockMs, localOnly: true, evictionWarning: false, lastError: null };
          engine.touchReadModel();
        }
        emitReadModel(true);
        startBackgroundWork();
        break;
      case "ResetSave":
        if (onlineTimer !== null) clearInterval(onlineTimer);
        onlineTimer = null;
        cancelPendingTerrain("reset invalidated gameplay terrain");
        await persistentReset(command);
        retryableMutations.clear();
        lastRetryableCommandId = null;
        failedCommitRetry = null;
        break;
      case "ExportSave": {
        if (storage === null) throw new PersistenceError("storage/unavailable", "ExportSave requires initialized storage");
        const exportBackupUtf8 = await storage.exportBackup();
        return {
          commandId: command.commandId, status: "accepted", readModelRevision: currentRevision(),
          saveRevision: currentSaveRevision(), error: null, exportBackupUtf8,
        };
      }
      case "ImportSave": {
        if (storage === null) throw new PersistenceError("storage/unavailable", "ImportSave requires initialized storage");
        const backup = new Uint8Array(command.backupUtf8).slice();
        const prepared = await storage.prepareImport(backup);
        cancelPendingTerrain("import invalidated gameplay terrain");
        const imported = await persistentMutation(command, () => storage!.replaceImportedSnapshot(prepared));
        recoverCommittedSimulation(imported);
        await primeTerrainBrokerForLoadedWorld();
        dirtyGeneration += 1;
        committedDirtyGeneration = dirtyGeneration;
        dirtySincePerformanceMs = null;
        break;
      }
    }
    return { commandId: command.commandId, status: "accepted", readModelRevision: currentRevision(), saveRevision: currentSaveRevision(), error: null };
  } catch (error: unknown) {
    if (error instanceof InvalidWorldSeedError) return rejection(command.commandId, { code: "command/invalid_seed", params: null, diagnosticId: null });
    if (error instanceof UnknownTargetPrototypeError) return rejection(command.commandId, { code: "command/unknown_target_prototype", params: null, diagnosticId: null });
    if (error instanceof SkillLevelTooLowError) return rejection(command.commandId, {
      code: "command/skill_level_too_low",
      params: { prototypeId: error.prototypeId, skillId: error.skillId, requiredLevel: error.requiredLevel, actualLevel: error.actualLevel },
      diagnosticId: null,
    });
    if (error instanceof RecipeLevelTooLowError) return rejection(command.commandId, {
      code: "command/recipe_level_too_low",
      params: { recipeId: error.recipeId, skillId: error.skillId, requiredLevel: error.requiredLevel, actualLevel: error.actualLevel },
      diagnosticId: null,
    });
    if (error instanceof EquipmentLevelTooLowError) return rejection(command.commandId, {
      code: "command/equipment_level_too_low",
      params: { itemId: error.itemId, skillId: error.skillId, requiredLevel: error.requiredLevel, actualLevel: error.actualLevel },
      diagnosticId: null,
    });
    if (error instanceof ItemUnavailableError) return rejection(command.commandId, { code: "command/item_unavailable", params: null, diagnosticId: null });
    if (error instanceof InvalidEquipmentError) return rejection(command.commandId, { code: "command/invalid_equipment", params: null, diagnosticId: null });
    if (error instanceof CombatLockedError) return rejection(command.commandId, { code: "command/combat_locked", params: null, diagnosticId: null });
    if (error instanceof ContentPlacementError) return rejection(command.commandId, { code: "command/content_placement_failed", params: null, diagnosticId: null });
    if (error instanceof QuantityOverflowError) {
      const id = diagnosticId("engine", "quantity-overflow");
      fatalPause("engine", "quantity-overflow", { code: "integrity/quantity_overflow", params: null, diagnosticId: id });
      return rejection(command.commandId, { code: "integrity/quantity_overflow", params: null, diagnosticId: id });
    }
    if (error instanceof BackupError) return rejection(command.commandId, backupCommandError(error));
    if (error instanceof PersistenceError) {
      const fatalError = persistenceLifecycleError(error);
      fatalPause("storage", "command-failed", fatalError);
      return rejection(command.commandId, persistenceCommandError(error));
    }
    if (command.type === "ImportSave") {
      return rejection(command.commandId, {
        code: "backup/invalid_shape", params: null, diagnosticId: diagnosticId("backup", "invalid-shape"),
      });
    }
    fatalPause("engine", "command-failed");
    return rejection(command.commandId, { code: "undefined_failure", params: null, diagnosticId: diagnosticId("engine", "command-failed") });
  }
}

async function processCommandUnchecked(requestId: string, command: GameplayCommand): Promise<void> {
  const payload = commandPayload(command);
  const payloadSha256 = await commandPayloadSha256(payload);
  const prior = commandRecords.get(command.commandId);
  if (prior !== undefined && prior.payloadSha256 !== payloadSha256) {
    const result = rejection(command.commandId, { code: "command/id_conflict", params: { commandId: command.commandId }, diagnosticId: null });
    post({ type: "command-result", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, requestId, ...result });
    return;
  }
  const retry = retryableMutations.get(command.commandId);
  const terminal = retry !== undefined ? retry() : prior?.terminal ?? executeCommand(command, payloadSha256);
  if (prior === undefined) commandRecords.set(command.commandId, { payloadSha256, terminal });
  else if (retry !== undefined) commandRecords.set(command.commandId, { payloadSha256, terminal });
  const result = await terminal;
  if (command.type === "ExportSave" && result.status === "accepted" && result.exportBackupUtf8 !== undefined) {
    const owned = result.exportBackupUtf8.slice().buffer;
    post({
      type: "export-ready", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, requestId, commandId: command.commandId,
      saveRevision: result.saveRevision, filename: `baiyue-rpg-save-r${result.saveRevision}.json`, backupUtf8: owned,
    }, [owned]);
    return;
  }
  post({
    type: "command-result", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, requestId, commandId: result.commandId,
    status: result.status, readModelRevision: result.readModelRevision, saveRevision: result.saveRevision, error: result.error,
  });
}

async function processCommand(requestId: string, command: GameplayCommand): Promise<void> {
  try {
    await processCommandUnchecked(requestId, command);
  } catch (error: unknown) {
    if (command.type !== "ImportSave") throw error;
    const result = rejection(command.commandId, {
      code: "backup/invalid_shape", params: null, diagnosticId: diagnosticId("backup", "invalid-shape"),
    });
    post({
      type: "command-result", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, requestId, commandId: result.commandId,
      status: result.status, readModelRevision: result.readModelRevision, saveRevision: result.saveRevision, error: result.error,
    });
  }
}

function handleTerrainMessage(message: Extract<MainToGameplayWorker, { type: "terrain-result" | "terrain-error" }>): void {
  const pending = pendingTerrain.get(message.terrainRequestId);
  if (pending === undefined) return;
  if (pending.effect.gameplayEpoch !== message.gameplayEpoch) {
    pendingTerrain.delete(message.terrainRequestId);
    pending.reject(new TerrainRequestError("terrain response epoch mismatch", false));
    return;
  }
  if (message.type === "terrain-error") {
    pendingTerrain.delete(message.terrainRequestId);
    pending.reject(new TerrainRequestError(message.code, message.transient));
    return;
  }
  if (pending.generatorVersion !== message.generatorVersion || pending.effect.chunkKey !== message.chunkKey
    || pending.effect.chunkX !== message.chunkX || pending.effect.chunkY !== message.chunkY) {
    pendingTerrain.delete(message.terrainRequestId);
    pending.reject(new TerrainRequestError("terrain response correlation mismatch", false));
    return;
  }
  pendingTerrain.delete(message.terrainRequestId);
  pending.resolve(new Uint8Array(message.baseTerrain));
}

function claimTerminalRequest(requestId: string): boolean {
  if (terminalRequestIds.has(requestId)) return false;
  terminalRequestIds.add(requestId);
  return true;
}

function emitProtocolError(input: unknown): void {
  const record = input !== null && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
  const requestId = isRequestId(record?.requestId) ? record.requestId : null;
  if (requestId !== null && !claimTerminalRequest(requestId)) return;
  const knownTypes = ["initialize", "command", "terrain-result", "terrain-error", "flush", "shutdown"];
  const typeKnown = typeof record?.type === "string" && knownTypes.includes(record.type);
  const version = record?.protocolVersion;
  const error = isU32(version) && version !== GAMEPLAY_PROTOCOL_VERSION
    ? { code: "protocol/version_mismatch" as const, params: { expected: GAMEPLAY_PROTOCOL_VERSION, actual: version }, diagnosticId: diagnosticId("protocol", "version-mismatch") }
    : typeof record?.type === "string" && !typeKnown
      ? { code: "protocol/unknown_message" as const, params: null, diagnosticId: diagnosticId("protocol", "unknown-message") }
      : { code: "protocol/invalid_message" as const, params: null, diagnosticId: diagnosticId("protocol", "invalid-message") };
  post({ type: "protocol-error", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, requestId, error, readModelRevision: currentRevision(), saveRevision: currentSaveRevision() });
}

async function initializeWorker(input: Extract<MainToGameplayWorker, { type: "initialize" }>): Promise<void> {
  if (engine !== null || storage !== null || gameplayLock !== null || generatorVersion !== null) {
    post({
      type: "request-result", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, requestId: input.requestId, operation: "initialize", status: "rejected",
      readModelRevision: currentRevision(), saveRevision: currentSaveRevision(),
      error: { code: "undefined_failure", params: null, diagnosticId: diagnosticId("worker", "already-initialized") },
    });
    return;
  }
  let acquiredLock: GameplayLock | null = null;
  let openedStorage: GameplayStorage | null = null;
  try {
    acquiredLock = await acquireGameplayLock();
    openedStorage = await GameplayStorage.open(input.generatorVersion);
    let loaded: PersistedSnapshot | null;
    try {
      loaded = await openedStorage.load();
    } catch (error: unknown) {
      const persistence = error instanceof PersistenceError
        ? error : new PersistenceError("storage/unavailable", "save load failed", null, { cause: error });
      gameplayLock = acquiredLock;
      storage = openedStorage;
      generatorVersion = input.generatorVersion;
      blockedInitializationError = persistenceLifecycleError(persistence);
      post({
        type: "request-result", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, requestId: input.requestId, operation: "initialize", status: "rejected",
        readModelRevision: 0, saveRevision: 0, error: blockedInitializationError,
      });
      return;
    }
    gameplayLock = acquiredLock;
    storage = openedStorage;
    generatorVersion = input.generatorVersion;
    committedSnapshot = loaded;
    blockedInitializationError = null;
    if (loaded === null) {
      engine = new GameplayEngine(input.generatorVersion);
      saveState = { state: "none", revision: 0, committedWallClockMs: null, localOnly: true, evictionWarning: false, lastError: null };
    } else {
      restoreEngine(loaded);
      saveState = {
        state: "saved", revision: loaded.meta.current_revision, committedWallClockMs: loaded.meta.committed_wall_clock_ms,
        localOnly: true, evictionWarning: false, lastError: null,
      };
      await processOfflineAtInitialization(input.wallClockMs);
      await primeTerrainBrokerForLoadedWorld();
      startOnlineTimer();
      startBackgroundWork();
    }
    post({
      type: "request-result", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, requestId: input.requestId, operation: "initialize", status: "accepted",
      readModelRevision: currentRevision(), saveRevision: currentSaveRevision(), error: null,
    });
    emitReadModel(true);
  } catch (error: unknown) {
    openedStorage?.close();
    if (acquiredLock !== null) await acquiredLock.release();
    const persistence = error instanceof PersistenceError
      ? error : new PersistenceError("storage/unavailable", "gameplay initialization failed", null, { cause: error });
    post({
      type: "request-result", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, requestId: input.requestId, operation: "initialize", status: "rejected",
      readModelRevision: 0, saveRevision: 0, error: persistenceLifecycleError(persistence),
    });
  }
}

async function processInboxMessage(input: MainToGameplayWorker): Promise<void> {
  switch (input.type) {
    case "initialize":
      await initializeWorker(input);
      return;
    case "command":
      await processCommand(input.requestId, input.command);
      return;
    case "flush":
      try {
        if (fatal && lastRetryableCommandId !== null) {
          const retry = retryableMutations.get(lastRetryableCommandId);
          if (retry === undefined) throw new PersistenceError("storage/write_failed", "retryable command transaction is unavailable");
          const terminal = await retry();
          if (terminal.status !== "accepted") throw new PersistenceError("storage/write_failed", "retryable command transaction failed again");
        } else if (fatal && failedCommitRetry !== null) {
          const snapshot = await failedCommitRetry();
          failedCommitRetry = null;
          recoverCommittedSimulation(snapshot);
        } else if (fatal) {
          throw new PersistenceError("storage/write_failed", "no retryable save transaction is available");
        }
        advanceOnlineClock();
        if (committedSnapshot !== null) await commitDirty(input.wallClockMs);
        if (engine?.needsImmediateCommit) engine.acknowledgeImmediateCommit();
        emitReadModel(true);
        post({ type: "request-result", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, requestId: input.requestId, operation: "flush", status: "accepted",
          readModelRevision: currentRevision(), saveRevision: currentSaveRevision(), error: null });
      } catch (error: unknown) {
        const persistence = error instanceof PersistenceError
          ? error : new PersistenceError("storage/write_failed", "flush failed", null, { cause: error });
        const lifecycle = persistenceLifecycleError(persistence);
        fatalPause("storage", "flush-failed", lifecycle);
        post({ type: "request-result", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, requestId: input.requestId, operation: "flush", status: "rejected",
          readModelRevision: currentRevision(), saveRevision: currentSaveRevision(), error: lifecycle });
      }
      return;
    case "shutdown":
      if (onlineTimer !== null) clearInterval(onlineTimer);
      onlineTimer = null;
      cancelPendingTerrain("worker shutdown");
      storage?.close();
      storage = null;
      if (gameplayLock !== null) await gameplayLock.release();
      gameplayLock = null;
      post({ type: "request-result", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, requestId: input.requestId, operation: "shutdown", status: "accepted",
        readModelRevision: currentRevision(), saveRevision: currentSaveRevision(), error: null });
      scope.close();
      return;
    case "terrain-result":
    case "terrain-error":
      handleTerrainMessage(input);
  }
}

function receive(input: unknown): void {
  if (!isMainToGameplayWorker(input)) { emitProtocolError(input); return; }
  if (input.type === "terrain-result" || input.type === "terrain-error") {
    handleTerrainMessage(input);
    return;
  }
  if (!claimTerminalRequest(input.requestId)) return;
  inboxTail = inboxTail.then(() => processInboxMessage(input)).catch(() => fatalPause("worker", "inbox-failed"));
}

scope.onmessage = (event: MessageEvent<unknown>) => receive(event.data);
post({ type: "worker-ready", protocolVersion: GAMEPLAY_PROTOCOL_VERSION });

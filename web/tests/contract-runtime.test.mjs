import assert from "node:assert/strict";
import test from "node:test";

import {
  GAMEPLAY_PROTOCOL_VERSION,
  isGameplayWorkerToMain,
  isMainToGameplayWorker,
} from "../src/gameplay/contracts.ts";
import { isGenerateChunkRequest, isWorkerMessage } from "../src/protocol.ts";

const requestId = "req:0123456789abcdef:0";
const commandId = "cmd:0123456789abcdef:0";
const diagnosticId = "diag:protocol:invalid-message:0123456789abcdef";
const point = { x: "512", y: "512" };

const readModel = {
  protocolVersion: 2,
  readModelRevision: 0,
  gameplayEpoch: 0,
  startup: "new_world",
  generatorVersion: 3,
  player: null,
  task: null,
  activity: { state: "idle", phase: "idle", route: [], routePurpose: null, routeIndex: 0, etaMs: null, progressPermille: null, targetPlacementId: null, action: null, reason: null },
  exploration: null,
  skills: null,
  inventory: null,
  equipment: null,
  toolCandidates: [],
  recipes: [],
  knownTargetPrototypeIds: [],
  knownEnemyArchetypeIds: [],
  combat: null,
  respawn: null,
  map: { revealedChunks: [], resourcePlacements: [], enemyPlacements: [], selectedDestination: null },
  save: { state: "none", revision: 0, committedWallClockMs: null, localOnly: true, evictionWarning: false, lastError: null },
  offlineReport: null,
};

function assertExactBranches(validator, branches) {
  for (const branch of branches) {
    assert.equal(validator(branch), true, `${branch.type} valid branch`);
    const keys = Object.keys(branch);
    const missing = structuredClone(branch);
    delete missing[keys.at(-1)];
    assert.equal(validator(missing), false, `${branch.type} rejects a missing field`);
    const extra = structuredClone(branch);
    extra.unexpected = true;
    assert.equal(validator(extra), false, `${branch.type} rejects an unknown field`);
  }
}

test("every main-to-worker branch is exact and validates IDs, bounds, equality, and transferables", () => {
  const branches = [
    { type: "initialize", protocolVersion: 2, requestId, generatorVersion: 3, wallClockMs: 1 },
    { type: "command", protocolVersion: 2, requestId, command: { type: "CreateWorld", commandId, seed: "20260809", seedSource: "manual", wallClockMs: 1 } },
    { type: "command", protocolVersion: 2, requestId, command: { type: "SetTask", commandId, task: { kind: "Explore", mode: "continuous", destination: null }, wallClockMs: 1 } },
    { type: "command", protocolVersion: 2, requestId, command: { type: "SetTask", commandId, task: { kind: "Explore", mode: "destination", destination: point }, wallClockMs: 1 } },
    { type: "command", protocolVersion: 2, requestId, command: { type: "SetTask", commandId, task: { kind: "Gather", targetPrototypeId: "wild_fiber", quantity: 10 }, wallClockMs: 1 } },
    { type: "command", protocolVersion: 2, requestId, command: { type: "SetTask", commandId, task: { kind: "Woodcut", targetPrototypeId: "softwood_tree", quantity: 2 }, wallClockMs: 1 } },
    { type: "command", protocolVersion: 2, requestId, command: { type: "SetTask", commandId, task: { kind: "Mine", targetPrototypeId: "surface_stone", quantity: 1 }, wallClockMs: 1 } },
    { type: "command", protocolVersion: 2, requestId, command: { type: "SetTask", commandId, task: { kind: "Produce", recipeId: "rope", requestedQuantity: 1 }, wallClockMs: 1 } },
    { type: "command", protocolVersion: 2, requestId, command: { type: "EquipItem", commandId, itemId: "worn_axe", wallClockMs: 1 } },
    { type: "command", protocolVersion: 2, requestId, command: { type: "UnequipSlot", commandId, slot: "pickaxe", wallClockMs: 1 } },
    { type: "command", protocolVersion: 2, requestId, command: { type: "CancelTask", commandId, wallClockMs: 1 } },
    { type: "command", protocolVersion: 2, requestId, command: { type: "ExportSave", commandId, wallClockMs: 1 } },
    { type: "command", protocolVersion: 2, requestId, command: { type: "ImportSave", commandId, backupUtf8: new ArrayBuffer(2), confirmed: true, wallClockMs: 1 } },
    { type: "command", protocolVersion: 2, requestId, command: { type: "ResetSave", commandId, confirmed: true, wallClockMs: 1 } },
    { type: "terrain-result", protocolVersion: 2, terrainRequestId: "terrain:0:0", gameplayEpoch: 0, chunkKey: "-1,2", chunkX: "-1", chunkY: "2", generatorVersion: 3, baseTerrain: new ArrayBuffer(4096) },
    { type: "terrain-error", protocolVersion: 2, terrainRequestId: "terrain:0:0", gameplayEpoch: 0, code: "terrain/payload_invalid", transient: false, diagnosticId },
    { type: "flush", protocolVersion: 2, requestId, wallClockMs: 1 },
    { type: "shutdown", protocolVersion: 2, requestId },
  ];
  assertExactBranches(isMainToGameplayWorker, branches);

  assert.equal(isMainToGameplayWorker({ ...branches[0], protocolVersion: 1 }), false);
  assert.equal(isMainToGameplayWorker({ ...branches[0], requestId: "req:0123456789abcdef:9007199254740992" }), false);
  const terrainResult = branches.find((branch) => branch.type === "terrain-result");
  const terrainError = branches.find((branch) => branch.type === "terrain-error");
  assert.equal(isMainToGameplayWorker({ ...terrainResult, chunkKey: "2,-1" }), false);
  assert.equal(isMainToGameplayWorker({ ...terrainResult, gameplayEpoch: 1 }), false);
  assert.equal(isMainToGameplayWorker({ ...terrainError, terrainRequestId: "terrain:1:0" }), false);
  assert.equal(isMainToGameplayWorker({ ...terrainResult, chunkX: "-33554433" }), false);
  assert.equal(isMainToGameplayWorker({ ...terrainResult, baseTerrain: new Uint8Array(4096) }), false);
  assert.equal(isMainToGameplayWorker({ ...terrainError, diagnosticId: "anything" }), false);
  const taskWithExtra = structuredClone(branches[2]);
  taskWithExtra.command.task.future = null;
  assert.equal(isMainToGameplayWorker(taskWithExtra), false);
  const invalidRecipe = structuredClone(branches[7]);
  invalidRecipe.command.task.recipeId = "copper_blade";
  assert.equal(isMainToGameplayWorker(invalidRecipe), false);
  const zeroProduction = structuredClone(branches[7]);
  zeroProduction.command.task.requestedQuantity = 0;
  assert.equal(isMainToGameplayWorker(zeroProduction), false);
});

test("every worker-to-main branch is exact and uses closed error/read-model shapes", () => {
  const lifecycleError = { code: "storage/unavailable", params: null, diagnosticId: "diag:storage:unavailable:0123456789abcdef" };
  const commandError = { code: "command/id_conflict", params: { commandId }, diagnosticId: null };
  const protocolError = { code: "protocol/invalid_message", params: null, diagnosticId };
  const branches = [
    { type: "worker-ready", protocolVersion: 2 },
    { type: "request-result", protocolVersion: 2, requestId, operation: "initialize", status: "accepted", readModelRevision: 0, saveRevision: 0, error: null },
    { type: "request-result", protocolVersion: 2, requestId, operation: "flush", status: "rejected", readModelRevision: 0, saveRevision: 0, error: lifecycleError },
    { type: "protocol-error", protocolVersion: 2, requestId: null, error: protocolError, readModelRevision: 0, saveRevision: 0 },
    { type: "terrain-request", protocolVersion: 2, terrainRequestId: "terrain:0:0", gameplayEpoch: 0, readModelRevision: 0, seed: "20260809", chunkKey: "-1,2", chunkX: "-1", chunkY: "2" },
    { type: "read-model", protocolVersion: 2, readModel },
    { type: "command-result", protocolVersion: 2, requestId, commandId, status: "accepted", readModelRevision: 0, saveRevision: 0, error: null },
    { type: "command-result", protocolVersion: 2, requestId, commandId, status: "rejected", readModelRevision: 0, saveRevision: 0, error: commandError },
    { type: "offline-progress", protocolVersion: 2, claimId: "claim:1:2", processedDurationMs: "1", creditedDurationMs: "2", sliceMaxMs: 0.25 },
    { type: "export-ready", protocolVersion: 2, requestId, commandId, saveRevision: 1, filename: "baiyue-rpg-save-r1.json", backupUtf8: new ArrayBuffer(2) },
    { type: "fatal", protocolVersion: 2, error: lifecycleError, readModelRevision: 0, saveRevision: 0 },
  ];
  assertExactBranches(isGameplayWorkerToMain, branches);

  assert.equal(isGameplayWorkerToMain({ ...branches[1], error: lifecycleError }), false);
  assert.equal(isGameplayWorkerToMain({ ...branches[7], error: { code: "made-up", params: null, diagnosticId } }), false);
  assert.equal(isGameplayWorkerToMain({ ...branches[4], chunkKey: "2,-1" }), false);
  assert.equal(isGameplayWorkerToMain({ ...branches[4], gameplayEpoch: 1 }), false);
  const nestedExtra = structuredClone(branches[5]);
  nestedExtra.readModel.map.future = null;
  assert.equal(isGameplayWorkerToMain(nestedExtra), false);
  const unsafeRevision = structuredClone(branches[5]);
  unsafeRevision.readModel.readModelRevision = Number.MAX_SAFE_INTEGER + 1;
  assert.equal(isGameplayWorkerToMain(unsafeRevision), false);
});

test("a fully populated read model validates canonical fog and signed clock skew", () => {
  const fogBase64 = Buffer.alloc(512).toString("base64");
  const populated = structuredClone(readModel);
  populated.readModelRevision = 4;
  populated.startup = "ready";
  populated.player = {
    position: point,
    hp: { currentMicro: "100000000", maxMicro: "100000000" },
    state: "alive",
    naturalRegen: "1% max HP / 10s",
    revivalGraceRemainingMs: null,
  };
  populated.exploration = { level: 1, totalXp: 0, currentLevelXp: 0, nextLevelXp: 100, observationRadiusTiles: 4, revealedTileCount: 49 };
  populated.skills = {
    gathering: { level: 1, totalXp: 0, currentLevelXp: 0, nextLevelXp: 100, skillSpeedBps: 0 },
    woodcutting: { level: 1, totalXp: 0, currentLevelXp: 0, nextLevelXp: 100, skillSpeedBps: 0 },
    mining: { level: 1, totalXp: 0, currentLevelXp: 0, nextLevelXp: 100, skillSpeedBps: 0 },
    crafting: { level: 1, totalXp: 0, currentLevelXp: 0, nextLevelXp: 100, skillSpeedBps: 0 },
    melee: { level: 1, totalXp: 0, currentLevelXp: 0, nextLevelXp: 100, skillSpeedBps: 0 },
    stealth: { level: 1, totalXp: 0, currentLevelXp: 0, nextLevelXp: 100, skillSpeedBps: 0 },
  };
  populated.inventory = { items: [{ itemId: "fiber", displayName: "纤维", category: "material", quantity: 1 }] };
  populated.equipment = {
    weapon: { itemId: "worn_blade", displayName: "破旧短刃", damageMin: 4, damageMax: 6, accuracyBonus: 5, attackIntervalMs: "2500", requiredMeleeLevel: 1 },
    axe: { itemId: "worn_axe", displayName: "破旧斧", tier: 0, speedBps: 0 },
    pickaxe: { itemId: "worn_pickaxe", displayName: "破旧镐", tier: 0, speedBps: 0 },
  };
  populated.toolCandidates = [
    { itemId: "worn_axe", displayName: "破旧斧", slot: "axe", tier: 0, speedBps: 0, requiredSkillId: "woodcutting", requiredLevel: 1, actualLevel: 1, canEquip: true, inventoryQuantity: 0, equipped: true },
    { itemId: "worn_pickaxe", displayName: "破旧镐", slot: "pickaxe", tier: 0, speedBps: 0, requiredSkillId: "mining", requiredLevel: 1, actualLevel: 1, canEquip: true, inventoryQuantity: 0, equipped: true },
    { itemId: "reinforced_axe", displayName: "强化斧", slot: "axe", tier: 1, speedBps: 1000, requiredSkillId: "woodcutting", requiredLevel: 2, actualLevel: 1, canEquip: false, inventoryQuantity: 0, equipped: false },
    { itemId: "reinforced_pickaxe", displayName: "强化镐", slot: "pickaxe", tier: 1, speedBps: 1000, requiredSkillId: "mining", requiredLevel: 2, actualLevel: 1, canEquip: false, inventoryQuantity: 0, equipped: false },
  ];
  populated.recipes = [
    { recipeId: "rope", displayName: "绳索", skillId: "crafting", requiredLevel: 1, locked: false, inputs: [{ itemId: "fiber", displayName: "纤维", required: 2, available: 1, missing: 1 }], output: { itemId: "rope", displayName: "绳索", quantity: 1 }, baseDurationMs: "12000", durationMs: "12000", skillSpeedBps: 0, totalSpeedBps: 0, xp: 12, station: "handcraft" },
    { recipeId: "reinforced_axe", displayName: "强化斧", skillId: "crafting", requiredLevel: 2, locked: true, inputs: [{ itemId: "softwood", displayName: "软木", required: 4, available: 0, missing: 4 }, { itemId: "rope", displayName: "绳索", required: 2, available: 0, missing: 2 }, { itemId: "stone", displayName: "石料", required: 2, available: 0, missing: 2 }], output: { itemId: "reinforced_axe", displayName: "强化斧", quantity: 1 }, baseDurationMs: "30000", durationMs: "30000", skillSpeedBps: 0, totalSpeedBps: 0, xp: 30, station: "handcraft" },
    { recipeId: "reinforced_pickaxe", displayName: "强化镐", skillId: "crafting", requiredLevel: 2, locked: true, inputs: [{ itemId: "softwood", displayName: "软木", required: 4, available: 0, missing: 4 }, { itemId: "rope", displayName: "绳索", required: 2, available: 0, missing: 2 }, { itemId: "stone", displayName: "石料", required: 3, available: 0, missing: 3 }], output: { itemId: "reinforced_pickaxe", displayName: "强化镐", quantity: 1 }, baseDurationMs: "30000", durationMs: "30000", skillSpeedBps: 0, totalSpeedBps: 0, xp: 30, station: "handcraft" },
  ];
  populated.knownTargetPrototypeIds = ["wild_fiber"];
  populated.map.revealedChunks = [{ chunkKey: "0,0", chunkX: "0", chunkY: "0", revealedBase64: fogBase64 }];
  populated.save = { state: "saved", revision: 1, committedWallClockMs: 10, localOnly: true, evictionWarning: false, lastError: null };
  populated.offlineReport = {
    claimId: "claim:1:5", rawElapsedMs: -5, clockSkew: "backward", creditedDurationMs: "0", discardedDurationMs: "0",
    fromWorldTimeMs: "10", toWorldTimeMs: "10", taskBefore: null, taskAfter: null,
    revealedTiles: 0, itemDeltas: [], skillXpGains: [], targetKills: 0, otherKills: 0, deaths: 0, respawns: 0,
    finalHpMicro: "100000000", stopReason: null, committedRevision: 1,
  };
  assert.equal(isGameplayWorkerToMain({ type: "read-model", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, readModel: populated }), true);
  const recipeTamper = structuredClone(populated);
  recipeTamper.recipes[0].inputs[0].required = 3;
  assert.equal(isGameplayWorkerToMain({ type: "read-model", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, readModel: recipeTamper }), false);
  const toolTamper = structuredClone(populated);
  toolTamper.toolCandidates[2].speedBps = 999;
  assert.equal(isGameplayWorkerToMain({ type: "read-model", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, readModel: toolTamper }), false);
  const productionAction = structuredClone(populated);
  productionAction.task = { taskId: "task:0123456789abcdef:0", kind: "Produce", recipeId: "rope", requestedQuantity: 1, completedQuantity: 0, createdWorldTimeMs: "0" };
  productionAction.activity = {
    state: "acting", phase: "production_action", route: [], routePurpose: null, routeIndex: 0,
    etaMs: "12000", progressPermille: 0, targetPlacementId: null,
    action: { kind: "Produce", actionId: "action:0:0", recipeId: "rope", baseDurationMs: "12000", durationMs: "12000", remainingMs: "12000", skillSpeedBps: 0, totalSpeedBps: 0 },
    reason: null,
  };
  assert.equal(isGameplayWorkerToMain({ type: "read-model", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, readModel: productionAction }), true);
  productionAction.activity.action.recipeId = "reinforced_axe";
  assert.equal(isGameplayWorkerToMain({ type: "read-model", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, readModel: productionAction }), false);
  populated.offlineReport.creditedDurationMs = "1";
  assert.equal(isGameplayWorkerToMain({ type: "read-model", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, readModel: populated }), false);
});

test("generator worker protocol rejects malformed, non-canonical, and out-of-range messages", () => {
  const request = { type: "generate", requestId: 0, epoch: 0, seed: "18446744073709551615", chunkX: "-33554432", chunkY: "33554431" };
  assert.equal(isGenerateChunkRequest(request), true);
  for (const invalid of [
    null,
    { ...request, type: "other" },
    { ...request, extra: true },
    { ...request, seed: "01" },
    { ...request, seed: "18446744073709551616" },
    { ...request, chunkX: "-0" },
    { ...request, chunkY: "33554432" },
    { ...request, requestId: -1 },
    { ...request, epoch: Number.MAX_SAFE_INTEGER + 1 },
  ]) assert.equal(isGenerateChunkRequest(invalid), false);

  assert.equal(isWorkerMessage({ type: "error", message: "invalid generate request" }), true);
  assert.equal(isWorkerMessage({ type: "error", requestId: 1, epoch: 2, message: "failed" }), true);
  assert.equal(isWorkerMessage({ type: "error", requestId: 1, message: "missing epoch" }), false);
  assert.equal(isWorkerMessage({ type: "chunk", requestId: 1, epoch: 2, chunkX: "0", chunkY: "0", macroBiome: 6, buffer: new ArrayBuffer(8192) }), false);
});

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
  protocolVersion: 1,
  readModelRevision: 0,
  gameplayEpoch: 0,
  startup: "new_world",
  generatorVersion: 3,
  player: null,
  task: null,
  activity: { state: "idle", route: [], routeIndex: 0, etaMs: null, progressPermille: null, reason: null },
  exploration: null,
  map: { revealedChunks: [], selectedDestination: null },
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
    { type: "initialize", protocolVersion: 1, requestId, generatorVersion: 3, wallClockMs: 1 },
    { type: "command", protocolVersion: 1, requestId, command: { type: "CreateWorld", commandId, seed: "20260809", seedSource: "manual", wallClockMs: 1 } },
    { type: "command", protocolVersion: 1, requestId, command: { type: "SetTask", commandId, task: { kind: "Explore", mode: "continuous", destination: null }, wallClockMs: 1 } },
    { type: "command", protocolVersion: 1, requestId, command: { type: "SetTask", commandId, task: { kind: "Explore", mode: "destination", destination: point }, wallClockMs: 1 } },
    { type: "command", protocolVersion: 1, requestId, command: { type: "CancelTask", commandId, wallClockMs: 1 } },
    { type: "command", protocolVersion: 1, requestId, command: { type: "ExportSave", commandId, wallClockMs: 1 } },
    { type: "command", protocolVersion: 1, requestId, command: { type: "ImportSave", commandId, backupUtf8: new ArrayBuffer(2), confirmed: true, wallClockMs: 1 } },
    { type: "command", protocolVersion: 1, requestId, command: { type: "ResetSave", commandId, confirmed: true, wallClockMs: 1 } },
    { type: "terrain-result", protocolVersion: 1, terrainRequestId: "terrain:0:0", gameplayEpoch: 0, chunkKey: "-1,2", chunkX: "-1", chunkY: "2", generatorVersion: 3, baseTerrain: new ArrayBuffer(4096) },
    { type: "terrain-error", protocolVersion: 1, terrainRequestId: "terrain:0:0", gameplayEpoch: 0, code: "terrain/payload_invalid", transient: false, diagnosticId },
    { type: "flush", protocolVersion: 1, requestId, wallClockMs: 1 },
    { type: "shutdown", protocolVersion: 1, requestId },
  ];
  assertExactBranches(isMainToGameplayWorker, branches);

  assert.equal(isMainToGameplayWorker({ ...branches[0], protocolVersion: 2 }), false);
  assert.equal(isMainToGameplayWorker({ ...branches[0], requestId: "req:0123456789abcdef:9007199254740992" }), false);
  assert.equal(isMainToGameplayWorker({ ...branches[8], chunkKey: "2,-1" }), false);
  assert.equal(isMainToGameplayWorker({ ...branches[8], gameplayEpoch: 1 }), false);
  assert.equal(isMainToGameplayWorker({ ...branches[9], terrainRequestId: "terrain:1:0" }), false);
  assert.equal(isMainToGameplayWorker({ ...branches[8], chunkX: "-33554433" }), false);
  assert.equal(isMainToGameplayWorker({ ...branches[8], baseTerrain: new Uint8Array(4096) }), false);
  assert.equal(isMainToGameplayWorker({ ...branches[9], diagnosticId: "anything" }), false);
  const taskWithExtra = structuredClone(branches[2]);
  taskWithExtra.command.task.future = null;
  assert.equal(isMainToGameplayWorker(taskWithExtra), false);
});

test("every worker-to-main branch is exact and uses closed error/read-model shapes", () => {
  const lifecycleError = { code: "storage/unavailable", params: null, diagnosticId: "diag:storage:unavailable:0123456789abcdef" };
  const commandError = { code: "command/id_conflict", params: { commandId }, diagnosticId: null };
  const protocolError = { code: "protocol/invalid_message", params: null, diagnosticId };
  const branches = [
    { type: "worker-ready", protocolVersion: 1 },
    { type: "request-result", protocolVersion: 1, requestId, operation: "initialize", status: "accepted", readModelRevision: 0, saveRevision: 0, error: null },
    { type: "request-result", protocolVersion: 1, requestId, operation: "flush", status: "rejected", readModelRevision: 0, saveRevision: 0, error: lifecycleError },
    { type: "protocol-error", protocolVersion: 1, requestId: null, error: protocolError, readModelRevision: 0, saveRevision: 0 },
    { type: "terrain-request", protocolVersion: 1, terrainRequestId: "terrain:0:0", gameplayEpoch: 0, readModelRevision: 0, seed: "20260809", chunkKey: "-1,2", chunkX: "-1", chunkY: "2" },
    { type: "read-model", protocolVersion: 1, readModel },
    { type: "command-result", protocolVersion: 1, requestId, commandId, status: "accepted", readModelRevision: 0, saveRevision: 0, error: null },
    { type: "command-result", protocolVersion: 1, requestId, commandId, status: "rejected", readModelRevision: 0, saveRevision: 0, error: commandError },
    { type: "offline-progress", protocolVersion: 1, claimId: "claim:1:2", processedDurationMs: "1", creditedDurationMs: "2", sliceMaxMs: 0.25 },
    { type: "export-ready", protocolVersion: 1, requestId, commandId, saveRevision: 1, filename: "baiyue-rpg-save-r1.json", backupUtf8: new ArrayBuffer(2) },
    { type: "fatal", protocolVersion: 1, error: lifecycleError, readModelRevision: 0, saveRevision: 0 },
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
  populated.player = { position: point, hp: { current: 100, max: 100 }, combatScope: "not_implemented_phase_1" };
  populated.exploration = { level: 1, totalXp: 0, currentLevelXp: 0, nextLevelXp: 100, observationRadiusTiles: 4, revealedTileCount: 49 };
  populated.map.revealedChunks = [{ chunkKey: "0,0", chunkX: "0", chunkY: "0", revealedBase64: fogBase64 }];
  populated.save = { state: "saved", revision: 1, committedWallClockMs: 10, localOnly: true, evictionWarning: false, lastError: null };
  populated.offlineReport = {
    claimId: "claim:1:5", rawElapsedMs: -5, clockSkew: "backward", creditedDurationMs: "0", discardedDurationMs: "0",
    fromWorldTimeMs: "10", toWorldTimeMs: "10", taskBefore: null, taskAfter: null, xpGained: 0, levelsGained: 0,
    revealedTiles: 0, stopReason: null, committedRevision: 1,
  };
  assert.equal(isGameplayWorkerToMain({ type: "read-model", protocolVersion: GAMEPLAY_PROTOCOL_VERSION, readModel: populated }), true);
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

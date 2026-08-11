import assert from "node:assert/strict";
import test from "node:test";

import { ChunkManager } from "../src/chunk-manager.ts";
import { GameplayClient, GameplayTerrainBroker } from "../src/gameplay-client.ts";
import { isMainToGameplayWorker } from "../src/gameplay/contracts.ts";
import { TerrainSourceError } from "../src/terrain-source-error.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function terrainRequest(overrides = {}) {
  return {
    type: "terrain-request",
    protocolVersion: 1,
    terrainRequestId: "terrain:1:0",
    gameplayEpoch: 1,
    readModelRevision: 0,
    seed: "20260809",
    chunkKey: "0,0",
    chunkX: "0",
    chunkY: "0",
    ...overrides,
  };
}

async function drainMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

class FakeWorker {
  onmessage = null;
  onerror = null;
  sent = [];
  terminated = false;
  throwOnPost = null;

  postMessage(message) {
    if (this.throwOnPost !== null) throw this.throwOnPost;
    this.sent.push(message);
  }

  terminate() { this.terminated = true; }
  emit(message) { this.onmessage?.({ data: message }); }
  crash() { this.onerror?.({ message: "injected crash" }); }
}

function readyChunkManager() {
  const worker = new FakeWorker();
  const manager = new ChunkManager(() => worker);
  worker.emit({ type: "ready", chunkSize: 64, generatorVersion: 3 });
  return { manager, worker };
}

function validGeneratedBuffer() {
  const bytes = new Uint8Array(8192);
  bytes.fill(3, 0, 4096);
  return bytes.buffer;
}

test("terrain broker binds immutable request identity and suppresses duplicate completion", async () => {
  const calls = [];
  const sent = [];
  const pending = deferred();
  const broker = new GameplayTerrainBroker(
    { getBaseTerrain(seed, x, y, version) { calls.push({ seed, x, y, version }); return pending.promise; } },
    { postMessage(message) { sent.push(message); } },
    () => 3,
  );
  const request = terrainRequest();
  broker.handle(request);
  broker.handle(request);
  assert.deepEqual(calls, [{ seed: "20260809", x: "0", y: "0", version: 3 }]);
  pending.resolve(new Uint8Array(4096).fill(3));
  await drainMicrotasks();
  assert.equal(sent.length, 1);
  assert.equal(isMainToGameplayWorker(sent[0]), true);
  assert.deepEqual({
    terrainRequestId: sent[0].terrainRequestId,
    gameplayEpoch: sent[0].gameplayEpoch,
    chunkKey: sent[0].chunkKey,
    chunkX: sent[0].chunkX,
    chunkY: sent[0].chunkY,
    generatorVersion: sent[0].generatorVersion,
  }, {
    terrainRequestId: "terrain:1:0", gameplayEpoch: 1, chunkKey: "0,0", chunkX: "0", chunkY: "0", generatorVersion: 3,
  });
  broker.handle(request);
  assert.equal(calls.length, 1, "a completed request ID cannot be replayed");
});

test("epoch/import switch cancels old correlation and takes seed only from the new Worker request", async () => {
  const calls = [];
  const sent = [];
  const oldPending = deferred();
  const importedPending = deferred();
  const source = {
    getBaseTerrain(seed, x, y, version) {
      calls.push({ seed, x, y, version });
      return seed === "9" ? importedPending.promise : oldPending.promise;
    },
  };
  const broker = new GameplayTerrainBroker(source, { postMessage(message) { sent.push(message); } }, () => 3);
  broker.handle(terrainRequest({ gameplayEpoch: 4, terrainRequestId: "terrain:4:0", seed: "7" }));
  broker.handle(terrainRequest({ gameplayEpoch: 5, terrainRequestId: "terrain:5:0", seed: "9", chunkKey: "-1,2", chunkX: "-1", chunkY: "2" }));
  broker.handle(terrainRequest({ gameplayEpoch: 5, terrainRequestId: "terrain:5:1", seed: "10", chunkKey: "1,1", chunkX: "1", chunkY: "1" }));
  oldPending.resolve(new Uint8Array(4096).fill(3));
  await drainMicrotasks();
  assert.equal(sent.length, 1, "cross-seed request receives a terminal permanent error instead of hanging");
  assert.equal(sent[0].type, "terrain-error");
  assert.equal(sent[0].code, "terrain/payload_invalid");
  assert.equal(sent[0].transient, false);
  importedPending.resolve(new Uint8Array(4096).fill(3));
  await drainMicrotasks();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].gameplayEpoch, 5);
  assert.equal(sent[1].chunkKey, "-1,2");
  assert.deepEqual(calls.map((call) => call.seed), ["7", "9"], "cross-seed request in one epoch is rejected before terrain source access");

  const refreshedCalls = [];
  const refreshed = new GameplayTerrainBroker(
    { async getBaseTerrain(seed) { refreshedCalls.push(seed); return new Uint8Array(4096).fill(3); } },
    { postMessage() {} },
    () => 3,
  );
  refreshed.handle(terrainRequest({ gameplayEpoch: 12, terrainRequestId: "terrain:12:0", seed: "18446744073709551615" }));
  await drainMicrotasks();
  assert.deepEqual(refreshedCalls, ["18446744073709551615"], "refresh broker has no default/save seed and uses the authoritative request seed");
});

test("same terrain request ID with different fields terminates the original correlation", async () => {
  const sourcePending = deferred();
  const sent = [];
  const broker = new GameplayTerrainBroker(
    { getBaseTerrain() { return sourcePending.promise; } },
    { postMessage(message) { sent.push(message); } },
    () => 3,
  );
  broker.handle(terrainRequest());
  broker.handle(terrainRequest({ chunkKey: "1,0", chunkX: "1" }));
  assert.equal(broker.pendingCount, 0);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "terrain-error");
  assert.equal(sent[0].terrainRequestId, "terrain:1:0");
  sourcePending.resolve(new Uint8Array(4096).fill(3));
  await drainMicrotasks();
  assert.equal(sent.length, 1, "late source completion is discarded after correlation failure");
});

test("current stale failure and throwing version lookup each settle broker pending exactly once", async () => {
  for (const scenario of ["stale", "version-throw"]) {
    const sourcePending = deferred();
    const sent = [];
    let versionCalls = 0;
    const broker = new GameplayTerrainBroker(
      { getBaseTerrain() { return sourcePending.promise; } },
      { postMessage(message) { sent.push(message); } },
      () => {
        versionCalls += 1;
        if (scenario === "version-throw" && versionCalls > 1) throw new Error("generator unavailable");
        return 3;
      },
    );
    broker.handle(terrainRequest());
    if (scenario === "stale") sourcePending.reject(new TerrainSourceError("stale", "current source invalidated"));
    else sourcePending.resolve(new Uint8Array(4096).fill(3));
    await drainMicrotasks();
    assert.equal(broker.pendingCount, 0, scenario);
    assert.equal(sent.length, 1, scenario);
    assert.equal(sent[0].type, "terrain-error");
    assert.equal(sent[0].transient, false);
  }
});

test("invalid BaseTerrain ID is a permanent broker payload error", async () => {
  const sent = [];
  const invalid = new Uint8Array(4096).fill(3);
  invalid[7] = 9;
  const broker = new GameplayTerrainBroker(
    { async getBaseTerrain() { return invalid; } },
    { postMessage(message) { sent.push(message); } },
    () => 3,
  );
  broker.handle(terrainRequest());
  await drainMicrotasks();
  assert.equal(broker.pendingCount, 0);
  assert.equal(sent[0].code, "terrain/payload_invalid");
  assert.equal(sent[0].transient, false);
});

test("GameplayClient worker crash and synchronous send failures are terminal and leak no pending request", async () => {
  for (const scenario of ["crash", "post-throw", "validator-throw"]) {
    const worker = new FakeWorker();
    if (scenario === "post-throw") worker.throwOnPost = new Error("injected postMessage failure");
    const chunks = {
      whenReady: async () => scenario === "validator-throw" ? -1 : 3,
      async getBaseTerrain() { return new Uint8Array(4096).fill(3); },
    };
    const client = new GameplayClient(chunks, "0123456789abcdef", () => worker);
    const initializing = client.initialize(1);
    await drainMicrotasks();
    if (scenario === "crash") {
      assert.equal(client.pendingRequestCount, 1);
      worker.crash();
    }
    await assert.rejects(initializing);
    assert.equal(client.pendingRequestCount, 0, scenario);
    assert.equal(worker.terminated, true, scenario);
    const sentBefore = worker.sent.length;
    await assert.rejects(client.flush(2));
    assert.equal(worker.sent.length, sentBefore, `${scenario} future request must not reach an unavailable Worker`);
  }
});

test("ChunkManager settles success, generation failure, cancellation, epoch invalidation, and correlation mismatch", async () => {
  {
    const { manager, worker } = readyChunkManager();
    const result = manager.getBaseTerrain("7", "0", "0", 3);
    await drainMicrotasks();
    const request = worker.sent.at(-1);
    worker.emit({ type: "chunk", requestId: request.requestId, epoch: request.epoch, chunkX: "0", chunkY: "0", macroBiome: 0, buffer: validGeneratedBuffer() });
    assert.equal((await result).byteLength, 4096);
    assert.equal(manager.pendingCount, 0);
    manager.dispose();
  }
  {
    const { manager, worker } = readyChunkManager();
    const result = manager.getBaseTerrain("7", "0", "0", 3);
    await drainMicrotasks();
    const request = worker.sent.at(-1);
    worker.emit({ type: "error", requestId: request.requestId, epoch: request.epoch, message: "injected generation failure" });
    await assert.rejects(result, TerrainSourceError);
    assert.equal(manager.pendingCount, 0);
    manager.dispose();
  }
  {
    const { manager } = readyChunkManager();
    const result = manager.getBaseTerrain("7", "0", "0", 3);
    await drainMicrotasks();
    manager.dispose();
    await assert.rejects(result, TerrainSourceError);
    assert.equal(manager.pendingCount, 0);
  }
  {
    const { manager } = readyChunkManager();
    const result = manager.getBaseTerrain("7", "0", "0", 3);
    await drainMicrotasks();
    manager.setSeed(8n);
    await assert.rejects(result, TerrainSourceError);
    assert.equal(manager.pendingCount, 0);
    manager.dispose();
  }
  {
    const { manager, worker } = readyChunkManager();
    const result = manager.getBaseTerrain("7", "0", "0", 3);
    await drainMicrotasks();
    const request = worker.sent.at(-1);
    worker.emit({ type: "chunk", requestId: request.requestId, epoch: request.epoch, chunkX: "1", chunkY: "0", macroBiome: 0, buffer: validGeneratedBuffer() });
    await assert.rejects(result, TerrainSourceError);
    assert.equal(manager.pendingCount, 0);
    manager.dispose();
  }
});

test("ChunkManager crash makes ready state and all future requests terminally unavailable", async () => {
  const { manager, worker } = readyChunkManager();
  const result = manager.getBaseTerrain("7", "0", "0", 3);
  await drainMicrotasks();
  assert.equal(manager.pendingCount, 1);
  worker.crash();
  await assert.rejects(result, TerrainSourceError);
  assert.equal(manager.pendingCount, 0);
  assert.deepEqual(manager.getStatus(), { ready: false, generatorVersion: null, error: "terrain generator worker crashed" });
  await assert.rejects(manager.whenReady(), TerrainSourceError);
  const sentBefore = worker.sent.length;
  await assert.rejects(manager.getBaseTerrain("7", "1", "0", 3), TerrainSourceError);
  assert.equal(worker.sent.length, sentBefore);
  assert.equal(worker.terminated, true);
});

test("ChunkManager rejects invalid Decoration IDs and Decoration outside Land without leaking pending", async () => {
  for (const scenario of ["invalid-id", "not-land"]) {
    const { manager, worker } = readyChunkManager();
    const result = manager.getBaseTerrain("7", "0", "0", 3);
    await drainMicrotasks();
    const request = worker.sent.at(-1);
    const bytes = new Uint8Array(validGeneratedBuffer());
    if (scenario === "invalid-id") bytes[4096] = 3;
    else { bytes[0] = 2; bytes[4096] = 1; }
    worker.emit({ type: "chunk", requestId: request.requestId, epoch: request.epoch, chunkX: "0", chunkY: "0", macroBiome: 0, buffer: bytes.buffer });
    await assert.rejects(result, TerrainSourceError);
    assert.equal(manager.pendingCount, 0, scenario);
    manager.dispose();
  }
});

test("ChunkManager bounds render preload, schedules center first, and reserves immediate gameplay capacity", async () => {
  const first = readyChunkManager();
  const second = readyChunkManager();
  for (const { manager } of [first, second]) manager.ensureVisible(0, 0, 64, 64, 1, 8);
  const identity = (message) => ({ chunkX: message.chunkX, chunkY: message.chunkY, epoch: message.epoch });
  assert.deepEqual(first.worker.sent.map(identity), second.worker.sent.map(identity), "render scheduling order must be deterministic");
  assert.deepEqual(identity(first.worker.sent[0]), { chunkX: "0", chunkY: "0", epoch: 0 });
  assert.equal(first.manager.pendingCount, 7, "render work leaves one generator slot reserved");
  assert.ok(first.manager.queuedRenderCount > 0);

  const gameplay = first.manager.getBaseTerrain("20260808", "50", "50", 3);
  await drainMicrotasks();
  assert.equal(first.manager.pendingCount, 8);
  assert.deepEqual(identity(first.worker.sent.at(-1)), { chunkX: "50", chunkY: "50", epoch: 0 }, "gameplay bypasses unsent preload");
  const request = first.worker.sent.at(-1);
  first.worker.emit({ type: "chunk", requestId: request.requestId, epoch: request.epoch, chunkX: "50", chunkY: "50", macroBiome: 0, buffer: validGeneratedBuffer() });
  assert.equal((await gameplay).byteLength, 4096);
  assert.ok(first.manager.pendingCount <= 7);
  first.manager.dispose();
  second.manager.dispose();
  assert.equal(first.manager.pendingCount, 0);
  assert.equal(second.manager.pendingCount, 0);
});

test("ChunkManager treats malformed worker output as terminal and clears pending plus queues", async () => {
  const { manager, worker } = readyChunkManager();
  manager.ensureVisible(0, 0, 64, 64, 1, 8);
  assert.equal(manager.pendingCount, 7);
  assert.ok(manager.queuedRenderCount > 0);
  worker.emit(null);
  assert.equal(manager.pendingCount, 0);
  assert.equal(manager.queuedRenderCount, 0);
  assert.equal(manager.getStatus().ready, false);
  assert.equal(worker.terminated, true);
  await assert.rejects(manager.whenReady(), TerrainSourceError);
});

test("ChunkManager remembers permanent render failure for the current epoch", () => {
  const { manager, worker } = readyChunkManager();
  manager.ensureVisible(0, 0, 64, 64, 1, 8);
  const failed = worker.sent[0];
  worker.emit({ type: "error", requestId: failed.requestId, epoch: failed.epoch, message: "permanent render failure" });
  manager.ensureVisible(0, 0, 64, 64, 1, 8);
  manager.ensureVisible(0, 0, 64, 64, 1, 8);
  assert.equal(worker.sent.filter((message) => message.chunkX === failed.chunkX && message.chunkY === failed.chunkY).length, 1);
  manager.setSeed(9n);
  manager.ensureVisible(0, 0, 64, 64, 1, 8);
  assert.equal(worker.sent.filter((message) => message.chunkX === failed.chunkX && message.chunkY === failed.chunkY).length, 2,
    "seed/epoch change clears the render failure tombstone");
  manager.dispose();
});

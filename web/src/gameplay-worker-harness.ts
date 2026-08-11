import { ChunkManager } from "./chunk-manager.ts";
import { GameplayClient, GameplayTerrainBroker } from "./gameplay-client.ts";
import { canonicalJson } from "./gameplay/canonical-json.ts";
import {
  isGameplayWorkerToMain,
  type GameplayReadModelV1,
  type GameplayWorkerToMain,
  type MainToGameplayWorker,
  type WorldPoint,
} from "./gameplay/contracts.ts";
import { GameplayEngine, type EngineTerrainEffect } from "./gameplay/engine.ts";
import { PersistenceError, acquireGameplayLock } from "./gameplay/persistence.ts";

const HARNESS_NONCE = "0123456789abcdef";
const SEED = "20260809";
const DESTINATION: WorldPoint = { x: "6656", y: "3584" };

type SourceEffect = Readonly<{ seed: string; generatorVersion: number; chunkKey: string; chunkX: string; chunkY: string }>;

async function driveDirect(
  engine: GameplayEngine,
  chunks: ChunkManager,
  generatorVersion: number,
  effects: SourceEffect[],
): Promise<void> {
  for (let iteration = 0; iteration < 200_000; iteration += 1) {
    const result = engine.step(128);
    if (result.kind === "settled") return;
    if (result.kind === "yield") {
      await Promise.resolve();
      continue;
    }
    effects.push(sourceEffect(result, generatorVersion));
    const bytes = await chunks.getBaseTerrain(result.seed, result.chunkX, result.chunkY, generatorVersion);
    engine.provideTerrain(result, bytes);
  }
  throw new Error("direct engine harness exceeded its operation budget");
}

async function finishDirectDestination(
  engine: GameplayEngine,
  chunks: ChunkManager,
  generatorVersion: number,
  effects: SourceEffect[],
): Promise<void> {
  for (let iteration = 0; iteration < 256; iteration += 1) {
    await driveDirect(engine, chunks, generatorVersion, effects);
    const readModel = engine.toReadModel();
    if (readModel.activity.state === "waiting") return;
    if (readModel.activity.state !== "moving" || readModel.activity.etaMs === null) {
      throw new Error(`direct destination entered unexpected activity ${readModel.activity.state}`);
    }
    engine.advanceBy(BigInt(readModel.activity.etaMs));
  }
  throw new Error("direct destination did not settle");
}

function waitForReadModel(
  client: GameplayClient,
  predicate: (readModel: GameplayReadModelV1) => boolean,
  timeoutMs = 30_000,
): Promise<GameplayReadModelV1> {
  const current = client.readModel;
  if (current !== null && predicate(current)) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    let unsubscribe = (): void => {};
    let settled = false;
    const cleanup = (): void => {
      clearTimeout(timeout);
      unsubscribe();
    };
    const listener = (readModel: GameplayReadModelV1): void => {
      if (!predicate(readModel) || settled) return;
      settled = true;
      cleanup();
      resolve(readModel);
    };
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("timed out waiting for gameplay read model"));
    }, timeoutMs);
    const actualUnsubscribe = client.subscribe(listener);
    unsubscribe = actualUnsubscribe;
    if (settled) actualUnsubscribe();
  });
}

function semanticReadModel(readModel: GameplayReadModelV1): unknown {
  return {
    startup: readModel.startup,
    generatorVersion: readModel.generatorVersion,
    player: readModel.player,
    task: readModel.task === null ? null : { ...readModel.task, createdWorldTimeMs: "<command-time>" },
    activity: readModel.activity,
    exploration: readModel.exploration,
    map: readModel.map,
    save: { ...readModel.save, revision: 0, committedWallClockMs: null },
    offlineReport: readModel.offlineReport,
  };
}

function sourceEffect(effect: EngineTerrainEffect, generatorVersion: number): SourceEffect {
  return { seed: effect.seed, generatorVersion, chunkKey: effect.chunkKey, chunkX: effect.chunkX, chunkY: effect.chunkY };
}

function movingSemantic(readModel: GameplayReadModelV1): unknown {
  return {
    player: readModel.player,
    task: readModel.task === null ? null : { ...readModel.task, createdWorldTimeMs: "<command-time>" },
    activity: readModel.activity,
    exploration: readModel.exploration,
    map: readModel.map,
  };
}

async function runWorkerEquivalence(): Promise<unknown> {
  const directChunks = new ChunkManager();
  const workerChunks = new ChunkManager();
  let client: GameplayClient | null = null;
  let shutdown = false;
  try {
    const [directGeneratorVersion, workerGeneratorVersion] = await Promise.all([directChunks.whenReady(), workerChunks.whenReady()]);
    if (directGeneratorVersion !== workerGeneratorVersion) throw new Error("generator Workers reported different versions");
    const generatorVersion = directGeneratorVersion;
    const directEffects: SourceEffect[] = [];
    const workerEffects: SourceEffect[] = [];
    const originalWorkerTerrain = workerChunks.getBaseTerrain.bind(workerChunks);
    workerChunks.getBaseTerrain = async (seed, chunkX, chunkY, version) => {
      workerEffects.push({ seed, generatorVersion: version, chunkKey: `${chunkX},${chunkY}`, chunkX, chunkY });
      return originalWorkerTerrain(seed, chunkX, chunkY, version);
    };

    const direct = new GameplayEngine(generatorVersion);
    direct.beginCreateWorld(SEED);
    await driveDirect(direct, directChunks, generatorVersion, directEffects);

    client = new GameplayClient(workerChunks, HARNESS_NONCE);
    await client.initialize(1_000);
    const createdResult = await client.command({ type: "CreateWorld", seed: SEED, seedSource: "manual" }, 1_000);
    if (createdResult.status !== "accepted") throw new Error(`Worker CreateWorld rejected: ${createdResult.error?.code}`);
    const workerCreated = await waitForReadModel(client, (model) => model.startup === "ready" && model.player !== null);
    const directCreated = direct.toReadModel(1, 1_000);

    direct.setTask(`cmd:${HARNESS_NONCE}:1`, { kind: "Explore", mode: "destination", destination: DESTINATION });
    await driveDirect(direct, directChunks, generatorVersion, directEffects);
    const directMoving = direct.toReadModel();
    if (directMoving.activity.state !== "moving") throw new Error("direct engine did not expose moving state");

    const movingPromise = waitForReadModel(client, (model) => model.task?.taskId === `task:${HARNESS_NONCE}:1`
      && model.activity.state === "moving");
    const setResult = await client.command({ type: "SetTask", task: { kind: "Explore", mode: "destination", destination: DESTINATION } }, 1_001);
    if (setResult.status !== "accepted") throw new Error(`Worker SetTask rejected: ${setResult.error?.code}`);
    const workerMoving = await movingPromise;

    await finishDirectDestination(direct, directChunks, generatorVersion, directEffects);
    const directCompleted = direct.toReadModel(1, 1_000);
    const workerCompleted = await waitForReadModel(client, (model) => model.player?.position.x === DESTINATION.x
      && model.player.position.y === DESTINATION.y && model.activity.state === "waiting"
      && model.activity.reason?.code === "TaskCompleted");

    direct.cancelTask();
    const cancelResult = await client.command({ type: "CancelTask" }, 1_002);
    if (cancelResult.status !== "accepted") throw new Error(`Worker CancelTask rejected: ${cancelResult.error?.code}`);
    const workerCancelled = await waitForReadModel(client, (model) => model.task === null && model.activity.state === "idle");
    const directCancelled = direct.toReadModel(1, 1_000);

    const createdCanonical = canonicalJson(semanticReadModel(workerCreated));
    const movingCanonical = canonicalJson(movingSemantic(workerMoving));
    const completedCanonical = canonicalJson(semanticReadModel(workerCompleted));
    const cancelledCanonical = canonicalJson(semanticReadModel(workerCancelled));
    const directEffectsCanonical = canonicalJson(directEffects);
    const workerEffectsCanonical = canonicalJson(workerEffects);
    await client.shutdown();
    shutdown = true;

    return {
      createdEqual: createdCanonical === canonicalJson(semanticReadModel(directCreated)),
      movingEqual: movingCanonical === canonicalJson(movingSemantic(directMoving)),
      completedEqual: completedCanonical === canonicalJson(semanticReadModel(directCompleted)),
      cancelledEqual: cancelledCanonical === canonicalJson(semanticReadModel(directCancelled)),
      effectsEqual: directEffectsCanonical === workerEffectsCanonical,
      destination: DESTINATION,
      movingRoute: workerMoving.activity.route,
      createdXp: workerCreated.exploration?.totalXp,
      completedXp: workerCompleted.exploration?.totalXp,
      createdRevealed: workerCreated.exploration?.revealedTileCount,
      completedRevealed: workerCompleted.exploration?.revealedTileCount,
      directEffects,
      workerEffects,
    };
  } finally {
    if (client !== null && !shutdown) {
      try { await client.shutdown(); } catch { client.dispose(); }
    }
    client?.dispose();
    directChunks.dispose();
    workerChunks.dispose();
  }
}

type MessageMatch = Readonly<{ message: GameplayWorkerToMain; index: number }>;

class RawGameplaySession {
  readonly worker = new Worker(new URL("./gameplay-worker.ts", import.meta.url), { type: "module" });
  readonly messages: GameplayWorkerToMain[] = [];
  private readonly waiters = new Set<{
    after: number;
    predicate: (message: GameplayWorkerToMain) => boolean;
    resolve: (match: MessageMatch) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private readonly hooks = new Set<(message: GameplayWorkerToMain) => void>();

  constructor() {
    this.worker.onmessage = (event: MessageEvent<unknown>) => {
      if (!isGameplayWorkerToMain(event.data)) {
        this.rejectWaiters(new Error("gameplay Worker emitted an invalid message"));
        return;
      }
      const message = event.data;
      const index = this.messages.push(message) - 1;
      for (const hook of this.hooks) hook(message);
      for (const waiter of [...this.waiters]) {
        if (index < waiter.after || !waiter.predicate(message)) continue;
        clearTimeout(waiter.timeout);
        this.waiters.delete(waiter);
        waiter.resolve({ message, index });
      }
    };
    this.worker.onerror = () => this.rejectWaiters(new Error("raw gameplay Worker crashed"));
  }

  send(message: unknown, transfer: Transferable[] = []): void { this.worker.postMessage(message, transfer); }
  addHook(hook: (message: GameplayWorkerToMain) => void): () => void {
    this.hooks.add(hook);
    return () => this.hooks.delete(hook);
  }

  waitFor(predicate: (message: GameplayWorkerToMain) => boolean, after = 0, timeoutMs = 20_000): Promise<MessageMatch> {
    for (let index = after; index < this.messages.length; index += 1) {
      const message = this.messages[index]!;
      if (predicate(message)) return Promise.resolve({ message, index });
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        after,
        predicate,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error("timed out waiting for raw gameplay Worker message"));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  async ready(): Promise<void> { await this.waitFor((message) => message.type === "worker-ready"); }
  dispose(): void {
    this.rejectWaiters(new Error("raw gameplay session disposed"));
    this.worker.terminate();
  }

  private rejectWaiters(error: Error): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.waiters.clear();
  }
}

function requestId(ordinal: number): string { return `req:${HARNESS_NONCE}:${ordinal}`; }
function commandId(ordinal: number): string { return `cmd:${HARNESS_NONCE}:${ordinal}`; }
function landBuffer(): ArrayBuffer { return new Uint8Array(4096).fill(3).buffer; }
function terrainResult(request: Extract<GameplayWorkerToMain, { type: "terrain-request" }>): MainToGameplayWorker {
  return {
    type: "terrain-result", protocolVersion: 1, terrainRequestId: request.terrainRequestId,
    gameplayEpoch: request.gameplayEpoch, chunkKey: request.chunkKey, chunkX: request.chunkX, chunkY: request.chunkY,
    generatorVersion: 3, baseTerrain: landBuffer(),
  };
}

async function runRawProtocolAndIdempotency(): Promise<unknown> {
  const session = new RawGameplaySession();
  const chunks = new ChunkManager();
  try {
    const version = await chunks.whenReady();
    await session.ready();
    const broker = new GameplayTerrainBroker(
      { getBaseTerrain: (seed, x, y, expected) => chunks.getBaseTerrain(seed, x, y, expected) },
      { postMessage: (message, transfer = []) => session.send(message, transfer) },
      () => version,
    );
    session.addHook((message) => { if (message.type === "terrain-request") broker.handle(message); });

    const initialize = { type: "initialize", protocolVersion: 1, requestId: requestId(0), generatorVersion: version, wallClockMs: 1 } as const;
    session.send(initialize);
    session.send(initialize);
    await session.waitFor((message) => message.type === "request-result" && message.requestId === requestId(0));

    const create = { type: "command", protocolVersion: 1, requestId: requestId(1), command: {
      type: "CreateWorld", commandId: commandId(0), seed: SEED, seedSource: "manual", wallClockMs: 2,
    } } as const;
    session.send(create);
    session.send(create);
    const created = await session.waitFor((message) => message.type === "command-result" && message.requestId === requestId(1));
    const terrainCountAfterCreate = session.messages.filter((message) => message.type === "terrain-request").length;

    session.send({ ...create, requestId: requestId(2) });
    const replayed = await session.waitFor((message) => message.type === "command-result" && message.requestId === requestId(2));
    session.send({ ...create, requestId: requestId(3), command: { ...create.command, seed: "20260810" } });
    const conflict = await session.waitFor((message) => message.type === "command-result" && message.requestId === requestId(3));

    session.send({ type: "flush", requestId: requestId(4) });
    session.send({ type: "unknown-message", protocolVersion: 1, requestId: requestId(5) });
    session.send({ type: "flush", protocolVersion: 2, requestId: requestId(6), wallClockMs: 3 });
    const invalid = await session.waitFor((message) => message.type === "protocol-error" && message.requestId === requestId(4));
    const unknown = await session.waitFor((message) => message.type === "protocol-error" && message.requestId === requestId(5));
    const mismatch = await session.waitFor((message) => message.type === "protocol-error" && message.requestId === requestId(6));
    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      initializeTerminalCount: session.messages.filter((message) => "requestId" in message && message.requestId === requestId(0)).length,
      createTerminalCount: session.messages.filter((message) => message.type === "command-result" && message.requestId === requestId(1)).length,
      createdStatus: created.message.type === "command-result" ? created.message.status : null,
      replayRevisionEqual: created.message.type === "command-result" && replayed.message.type === "command-result"
        && created.message.readModelRevision === replayed.message.readModelRevision,
      conflictCode: conflict.message.type === "command-result" ? conflict.message.error?.code : null,
      terrainCountUnchangedByReplayAndConflict: session.messages.filter((message) => message.type === "terrain-request").length === terrainCountAfterCreate,
      protocolCodes: [invalid.message, unknown.message, mismatch.message].map((message) => message.type === "protocol-error" ? message.error.code : null),
      brokerPending: broker.pendingCount,
    };
  } finally {
    session.dispose();
    chunks.dispose();
  }
}

async function runRawTerrainCorrelation(): Promise<unknown> {
  const session = new RawGameplaySession();
  let firstEpochRequest: Extract<GameplayWorkerToMain, { type: "terrain-request" }> | null = null;
  let duplicated = false;
  let staleInjected = false;
  try {
    await session.ready();
    session.addHook((message) => {
      if (message.type !== "terrain-request") return;
      if (message.gameplayEpoch === 1 && firstEpochRequest === null) firstEpochRequest = message;
      if (message.gameplayEpoch === 3 && !staleInjected && firstEpochRequest !== null) {
        staleInjected = true;
        const stale = terrainResult(firstEpochRequest);
        session.send(stale, stale.type === "terrain-result" ? [stale.baseTerrain] : []);
      }
      const response = terrainResult(message);
      session.send(response, response.type === "terrain-result" ? [response.baseTerrain] : []);
      if (!duplicated) {
        duplicated = true;
        const duplicate = terrainResult(message);
        session.send(duplicate, duplicate.type === "terrain-result" ? [duplicate.baseTerrain] : []);
      }
    });
    session.send({ type: "initialize", protocolVersion: 1, requestId: requestId(0), generatorVersion: 3, wallClockMs: 1 });
    await session.waitFor((message) => message.type === "request-result" && message.requestId === requestId(0));
    session.send({ type: "command", protocolVersion: 1, requestId: requestId(1), command: {
      type: "CreateWorld", commandId: commandId(0), seed: SEED, seedSource: "manual", wallClockMs: 2,
    } });
    await session.waitFor((message) => message.type === "command-result" && message.requestId === requestId(1));
    session.send({ type: "command", protocolVersion: 1, requestId: requestId(2), command: {
      type: "ResetSave", commandId: commandId(1), confirmed: true, wallClockMs: 3,
    } });
    await session.waitFor((message) => message.type === "command-result" && message.requestId === requestId(2));
    session.send({ type: "command", protocolVersion: 1, requestId: requestId(3), command: {
      type: "CreateWorld", commandId: commandId(2), seed: "20260810", seedSource: "manual", wallClockMs: 4,
    } });
    const second = await session.waitFor((message) => message.type === "command-result" && message.requestId === requestId(3));
    await new Promise((resolve) => setTimeout(resolve, 100));
    const requests = session.messages.filter((message): message is Extract<GameplayWorkerToMain, { type: "terrain-request" }> => message.type === "terrain-request");
    return {
      secondStatus: second.message.type === "command-result" ? second.message.status : null,
      firstIds: requests.filter((message) => message.gameplayEpoch === 1).map((message) => message.terrainRequestId),
      secondIds: requests.filter((message) => message.gameplayEpoch === 3).map((message) => message.terrainRequestId),
      duplicateInjected: duplicated,
      staleInjected,
      fatalCount: session.messages.filter((message) => message.type === "fatal").length,
      unscopedProtocolErrors: session.messages.filter((message) => message.type === "protocol-error" && message.requestId === null).length,
    };
  } finally {
    session.dispose();
  }
}

async function runTerrainFailureScenario(mode: "malformed" | "transient" | "permanent"): Promise<unknown> {
  const session = new RawGameplaySession();
  let terrainRequests = 0;
  try {
    await session.ready();
    session.addHook((message) => {
      if (message.type !== "terrain-request") return;
      terrainRequests += 1;
      if (mode === "malformed") {
        if (terrainRequests > 1) return;
        const response = terrainResult(message);
        if (response.type !== "terrain-result") return;
        const malformed = { ...response, chunkKey: "1,0", chunkX: "1" };
        session.send(malformed, [malformed.baseTerrain]);
        return;
      }
      const suffix = terrainRequests.toString(16).padStart(16, "0");
      session.send({
        type: "terrain-error", protocolVersion: 1, terrainRequestId: message.terrainRequestId,
        gameplayEpoch: message.gameplayEpoch, code: "terrain/generation_failed", transient: mode === "transient",
        diagnosticId: `diag:terrain:generation-failed:${suffix}`,
      });
    });
    session.send({ type: "initialize", protocolVersion: 1, requestId: requestId(0), generatorVersion: 3, wallClockMs: 1 });
    await session.waitFor((message) => message.type === "request-result" && message.requestId === requestId(0));
    session.send({ type: "command", protocolVersion: 1, requestId: requestId(1), command: {
      type: "CreateWorld", commandId: commandId(0), seed: SEED, seedSource: "manual", wallClockMs: 2,
    } });
    await session.waitFor((message) => message.type === "fatal");
    await new Promise((resolve) => setTimeout(resolve, 150));
    const paused = [...session.messages].reverse().find((message) => message.type === "read-model");
    return {
      mode,
      terrainRequests,
      fatalCount: session.messages.filter((message) => message.type === "fatal").length,
      paused: paused?.type === "read-model" ? paused.readModel.activity.state === "paused" : false,
    };
  } finally {
    session.dispose();
  }
}

async function runGeneratorWorkerBoundary(): Promise<unknown> {
  const worker = new Worker(new URL("./generator-worker.ts", import.meta.url), { type: "module" });
  const messages: unknown[] = [];
  const waitFor = (predicate: (message: unknown) => boolean): Promise<unknown> => new Promise((resolve, reject) => {
    const current = messages.find(predicate);
    if (current !== undefined) { resolve(current); return; }
    const timeout = setTimeout(() => reject(new Error("timed out waiting for generator Worker")), 20_000);
    const prior = worker.onmessage;
    worker.onmessage = (event) => {
      prior?.call(worker, event);
      messages.push(event.data);
      if (predicate(event.data)) { clearTimeout(timeout); resolve(event.data); }
    };
  });
  try {
    worker.onmessage = (event) => { messages.push(event.data); };
    await waitFor((message) => typeof message === "object" && message !== null && (message as { type?: unknown }).type === "ready");
    worker.postMessage(null);
    await waitFor((message) => typeof message === "object" && message !== null && (message as { type?: unknown }).type === "error");
    worker.postMessage({ type: "generate", requestId: 1, epoch: 2, seed: SEED, chunkX: "0", chunkY: "0" });
    const chunk = await waitFor((message) => typeof message === "object" && message !== null && (message as { type?: unknown }).type === "chunk");
    return {
      invalidErrorCount: messages.filter((message) => typeof message === "object" && message !== null && (message as { type?: unknown }).type === "error").length,
      validAfterMalformed: typeof chunk === "object" && chunk !== null && (chunk as { type?: unknown }).type === "chunk",
    };
  } finally {
    worker.terminate();
  }
}

async function inspectGameplayDatabase(): Promise<unknown> {
  const request = indexedDB.open("baiyue-rpg-gameplay");
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("failed to inspect gameplay database"));
    request.onsuccess = () => resolve(request.result);
  });
  try {
    const storeNames = [...database.objectStoreNames];
    const tx = database.transaction(storeNames, "readonly");
    const keyPaths = Object.fromEntries(storeNames.map((name) => [name, tx.objectStore(name).keyPath]));
    const storeOptions = Object.fromEntries(storeNames.map((name) => {
      const store = tx.objectStore(name);
      return [name, { autoIncrement: store.autoIncrement, indexNames: [...store.indexNames] }];
    }));
    const get = <T>(storeName: string, key: IDBValidKey): Promise<T | undefined> => new Promise((resolve, reject) => {
      const operation = tx.objectStore(storeName).get(key);
      operation.onerror = () => reject(operation.error ?? new Error(`failed to read ${storeName}`));
      operation.onsuccess = () => resolve(operation.result as T | undefined);
    });
    const count = (storeName: string): Promise<number> => new Promise((resolve, reject) => {
      const operation = tx.objectStore(storeName).count();
      operation.onerror = () => reject(operation.error ?? new Error(`failed to count ${storeName}`));
      operation.onsuccess = () => resolve(operation.result);
    });
    const [meta, core, chunkCount, claimCount] = await Promise.all([
      get<Record<string, unknown>>("meta", "save:local"),
      get<Record<string, unknown>>("core", "save:local"),
      count("world_chunks"),
      count("resume_claim"),
    ]);
    return { storeNames, keyPaths, storeOptions, meta, core, chunkCount, claimCount };
  } finally {
    database.close();
  }
}

async function deleteGameplayDatabase(): Promise<void> {
  const request = indexedDB.deleteDatabase("baiyue-rpg-gameplay");
  await new Promise<void>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("failed to delete gameplay test database"));
    request.onblocked = () => reject(new Error("gameplay test database deletion was blocked"));
    request.onsuccess = () => resolve();
  });
}

type RawGameplayRecords = {
  meta: Record<string, unknown> | undefined;
  core: Record<string, unknown> | undefined;
  chunks: Array<Record<string, unknown>>;
  claim: Record<string, unknown> | undefined;
};

async function readRawGameplayRecords(): Promise<RawGameplayRecords> {
  const request = indexedDB.open("baiyue-rpg-gameplay");
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("failed to open gameplay records"));
    request.onsuccess = () => resolve(request.result);
  });
  try {
    const tx = database.transaction(["meta", "core", "world_chunks", "resume_claim"], "readonly");
    const get = (store: string, key: IDBValidKey): Promise<Record<string, unknown> | undefined> => new Promise((resolve, reject) => {
      const operation = tx.objectStore(store).get(key);
      operation.onerror = () => reject(operation.error ?? new Error(`failed to read ${store}`));
      operation.onsuccess = () => resolve(operation.result as Record<string, unknown> | undefined);
    });
    const getAll = (store: string): Promise<Array<Record<string, unknown>>> => new Promise((resolve, reject) => {
      const operation = tx.objectStore(store).getAll();
      operation.onerror = () => reject(operation.error ?? new Error(`failed to read ${store}`));
      operation.onsuccess = () => resolve(operation.result as Array<Record<string, unknown>>);
    });
    const [meta, core, chunks, claim] = await Promise.all([
      get("meta", "save:local"), get("core", "save:local"), getAll("world_chunks"), get("resume_claim", "save:local"),
    ]);
    return { meta, core, chunks, claim };
  } finally {
    database.close();
  }
}

type SchemaVariant = "exact" | "extra-index" | "auto-increment";

async function writeRawGameplayDatabase(records: RawGameplayRecords, variant: SchemaVariant = "exact", version = 1): Promise<void> {
  await deleteGameplayDatabase();
  const request = indexedDB.open("baiyue-rpg-gameplay", version);
  request.onupgradeneeded = () => {
    const database = request.result;
    database.createObjectStore("meta", { keyPath: "save_id" });
    const core = database.createObjectStore("core", { keyPath: "save_id", autoIncrement: variant === "auto-increment" });
    database.createObjectStore("world_chunks", { keyPath: "chunk_key" });
    database.createObjectStore("resume_claim", { keyPath: "save_id" });
    if (variant === "extra-index") core.createIndex("unexpected", "revision");
  };
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error("failed to create gameplay fixture database"));
    request.onsuccess = () => resolve(request.result);
  });
  try {
    const tx = database.transaction(["meta", "core", "world_chunks", "resume_claim"], "readwrite");
    if (records.meta !== undefined) tx.objectStore("meta").put(records.meta);
    if (records.core !== undefined) tx.objectStore("core").put(records.core);
    for (const chunk of records.chunks) tx.objectStore("world_chunks").put(chunk);
    if (records.claim !== undefined) tx.objectStore("resume_claim").put(records.claim);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("gameplay fixture database transaction aborted"));
      tx.onerror = () => reject(tx.error ?? new Error("gameplay fixture database transaction failed"));
    });
  } finally {
    database.close();
  }
}

async function sha256Hex(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function probeGameplayInitialization(): Promise<{ status: string | null; code: string | null; readModels: number }> {
  const session = new RawGameplaySession();
  try {
    await session.ready();
    session.send({ type: "initialize", protocolVersion: 1, requestId: requestId(0), generatorVersion: 3, wallClockMs: 2_000 });
    const result = await session.waitFor((message) => message.type === "request-result" && message.requestId === requestId(0));
    session.send({ type: "shutdown", protocolVersion: 1, requestId: requestId(1) });
    await session.waitFor((message) => message.type === "request-result" && message.requestId === requestId(1));
    return {
      status: result.message.type === "request-result" ? result.message.status : null,
      code: result.message.type === "request-result" ? result.message.error?.code ?? null : null,
      readModels: session.messages.filter((message) => message.type === "read-model").length,
    };
  } finally {
    session.dispose();
  }
}

async function runPersistenceCreateRestore(): Promise<unknown> {
  await deleteGameplayDatabase();
  const chunks = new ChunkManager();
  let client: GameplayClient | null = null;
  let second: GameplayClient | null = null;
  let third: GameplayClient | null = null;
  try {
    client = new GameplayClient(chunks, HARNESS_NONCE);
    await client.initialize(1_000);
    const create = await client.command({ type: "CreateWorld", seed: SEED, seedSource: "manual" }, 1_000);
    const ready = await waitForReadModel(client, (model) => model.startup === "ready" && model.save.state === "saved");
    const database = await inspectGameplayDatabase() as {
      storeNames: string[];
      keyPaths: Record<string, string>;
      storeOptions: Record<string, { autoIncrement: boolean; indexNames: string[] }>;
      meta: Record<string, unknown>;
      core: Record<string, unknown>;
      chunkCount: number;
      claimCount: number;
    };
    await client.shutdown();
    client = null;

    const secondChunks = new ChunkManager();
    let replayTerrainRequests = 0;
    const originalGet = secondChunks.getBaseTerrain.bind(secondChunks);
    secondChunks.getBaseTerrain = (...args) => { replayTerrainRequests += 1; return originalGet(...args); };
    try {
      second = new GameplayClient(secondChunks, HARNESS_NONCE);
      await second.initialize(1_000);
      const restored = await waitForReadModel(second, (model) => model.startup === "ready" && model.save.revision === 1);
      const replay = await second.command({ type: "CreateWorld", seed: SEED, seedSource: "manual" }, 1_000);
      await second.shutdown();
      second = null;

      const thirdChunks = new ChunkManager();
      try {
        third = new GameplayClient(thirdChunks, HARNESS_NONCE);
        await third.initialize(1_000);
        const conflict = await third.command({ type: "CreateWorld", seed: "20260810", seedSource: "manual" }, 1_000);
        await third.shutdown();
        third = null;
        return {
          createStatus: create.status,
          createSaveRevision: create.saveRevision,
          readySave: ready.save,
          storeNames: database.storeNames,
          keyPaths: database.keyPaths,
          storeOptions: database.storeOptions,
          metaRevision: database.meta.current_revision,
          coreRevision: database.core.revision,
          receiptCount: Array.isArray(database.core.command_receipts) ? database.core.command_receipts.length : -1,
          chunkCount: database.chunkCount,
          claimCount: database.claimCount,
          restoredPosition: restored.player?.position,
          replayStatus: replay.status,
          replaySaveRevision: replay.saveRevision,
          replayTerrainRequests,
          conflictCode: conflict.error?.code,
        };
      } finally {
        third?.dispose();
        thirdChunks.dispose();
      }
    } finally {
      second?.dispose();
      secondChunks.dispose();
    }
  } finally {
    client?.dispose();
    chunks.dispose();
  }
}

async function runWebLockExclusion(): Promise<unknown> {
  await deleteGameplayDatabase();
  const chunks = new ChunkManager();
  const first = new RawGameplaySession();
  const second = new RawGameplaySession();
  try {
    const version = await chunks.whenReady();
    await Promise.all([first.ready(), second.ready()]);
    first.send({ type: "initialize", protocolVersion: 1, requestId: requestId(0), generatorVersion: version, wallClockMs: 1 });
    const firstResult = await first.waitFor((message) => message.type === "request-result" && message.requestId === requestId(0));
    second.send({ type: "initialize", protocolVersion: 1, requestId: requestId(1), generatorVersion: version, wallClockMs: 1 });
    const blocked = await second.waitFor((message) => message.type === "request-result" && message.requestId === requestId(1));
    const blockedReadModels = second.messages.filter((message) => message.type === "read-model").length;
    first.send({ type: "shutdown", protocolVersion: 1, requestId: requestId(2) });
    await first.waitFor((message) => message.type === "request-result" && message.requestId === requestId(2));
    second.send({ type: "initialize", protocolVersion: 1, requestId: requestId(3), generatorVersion: version, wallClockMs: 2 });
    const retried = await second.waitFor((message) => message.type === "request-result" && message.requestId === requestId(3));
    second.send({ type: "shutdown", protocolVersion: 1, requestId: requestId(4) });
    await second.waitFor((message) => message.type === "request-result" && message.requestId === requestId(4));
    return {
      firstStatus: firstResult.message.type === "request-result" ? firstResult.message.status : null,
      blockedStatus: blocked.message.type === "request-result" ? blocked.message.status : null,
      blockedCode: blocked.message.type === "request-result" ? blocked.message.error?.code : null,
      blockedReadModels,
      retryStatus: retried.message.type === "request-result" ? retried.message.status : null,
    };
  } finally {
    first.dispose();
    second.dispose();
    chunks.dispose();
  }
}

async function runWebLocksUnavailableBoundary(): Promise<unknown> {
  await deleteGameplayDatabase();
  let code: string | null = null;
  try {
    await acquireGameplayLock(undefined);
  } catch (error: unknown) {
    code = error instanceof PersistenceError ? error.code : String(error);
  }
  const databases = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
  return { code, databaseCreated: databases.some((database) => database.name === "baiyue-rpg-gameplay") };
}

async function runPersistenceTamperMatrix(): Promise<unknown> {
  await deleteGameplayDatabase();
  const chunks = new ChunkManager();
  const client = new GameplayClient(chunks, HARNESS_NONCE);
  try {
    await client.initialize(1_000);
    await client.command({ type: "CreateWorld", seed: SEED, seedSource: "manual" }, 1_000);
    await client.shutdown();
  } finally {
    client.dispose();
    chunks.dispose();
  }
  const valid = await readRawGameplayRecords();
  if (valid.meta === undefined || valid.core === undefined || valid.chunks.length === 0) throw new Error("valid tamper baseline was not created");
  const results: Record<string, unknown> = {};

  const run = async (name: string, mutate: (records: RawGameplayRecords) => Promise<void> | void, variant: SchemaVariant = "exact", version = 1) => {
    const records = structuredClone(valid);
    await mutate(records);
    await writeRawGameplayDatabase(records, variant, version);
    results[name] = await probeGameplayInitialization();
  };

  await run("partial", (records) => { records.core = undefined; });
  await run("checksum", (records) => { records.meta!.core_checksum_sha256 = "0".repeat(64); });
  await run("chunkRevision", async (records) => {
    const chunk = records.chunks[0]!;
    const coreRevision = records.core!.revision as number;
    chunk.revision = coreRevision + 1;
    const bits = chunk.revealed_bits as Uint8Array;
    chunk.record_checksum_sha256 = await sha256Hex({
      chunk_key: chunk.chunk_key, chunk_x: chunk.chunk_x, chunk_y: chunk.chunk_y,
      revealed_base64: btoa(String.fromCharCode(...bits)), revision: chunk.revision,
    });
  });
  await run("xpLevel", async (records) => {
    (records.core!.exploration as Record<string, unknown>).level = 2;
    records.meta!.core_checksum_sha256 = await sha256Hex(records.core);
  });
  await run("execution", async (records) => {
    const execution = records.core!.execution as Record<string, unknown>;
    execution.route = [records.core!.position];
    records.meta!.core_checksum_sha256 = await sha256Hex(records.core);
  });
  await run("version", (records) => { records.meta!.content_version = 1; });
  await run("extraIndex", () => {}, "extra-index");
  await run("autoIncrement", () => {}, "auto-increment");
  await run("higherDbVersion", () => {}, "exact", 2);
  return results;
}

async function runBackupRoundTrip(): Promise<unknown> {
  await deleteGameplayDatabase();
  const chunks = new ChunkManager();
  const client = new GameplayClient(chunks, HARNESS_NONCE);
  let stage = "initialize";
  try {
    await client.initialize(1_000);
    stage = "create";
    await client.command({ type: "CreateWorld", seed: SEED, seedSource: "manual" }, 1_000);
    stage = "created-read-model";
    const before = await waitForReadModel(client, (model) => model.player !== null && model.save.revision === 1);
    stage = "first-export";
    const exported = await client.command({ type: "ExportSave" }, 1_002);
    const firstBytes = new Uint8Array(exported.backupUtf8).slice();
    const firstHash = await crypto.subtle.digest("SHA-256", firstBytes);
    stage = "reset";
    await client.command({ type: "ResetSave", confirmed: true }, 1_003);
    stage = "import";
    const imported = await client.command({ type: "ImportSave", backupUtf8: firstBytes.slice().buffer, confirmed: true }, 1_004);
    stage = "restored-read-model";
    const restored = await waitForReadModel(client, (model) => model.startup === "ready" && model.save.revision === exported.saveRevision && model.player !== null);
    stage = "second-export";
    const exportedAgain = await client.command({ type: "ExportSave" }, 1_005);
    const secondBytes = new Uint8Array(exportedAgain.backupUtf8).slice();
    stage = "invalid-import";
    const invalid = JSON.parse(new TextDecoder().decode(firstBytes)) as Record<string, unknown>;
    invalid.product = "other";
    const invalidResult = await client.command({
      type: "ImportSave", backupUtf8: new TextEncoder().encode(JSON.stringify(invalid)).buffer, confirmed: true,
    }, 1_006);
    stage = "post-invalid-export";
    const afterInvalid = await client.command({ type: "ExportSave" }, 1_007);
    const afterInvalidBytes = new Uint8Array(afterInvalid.backupUtf8);

    return {
      importStatus: imported.status,
      revisionPreserved: restored.save.revision === exported.saveRevision,
      semanticCorePreserved: canonicalJson({ player: restored.player, task: restored.task, exploration: restored.exploration, map: restored.map })
        === canonicalJson({ player: before.player, task: before.task, exploration: before.exploration, map: before.map }),
      byteIdentical: canonicalJson([...firstBytes]) === canonicalJson([...secondBytes]),
      invalidImportRejected: invalidResult.status === "rejected" && invalidResult.error?.code.startsWith("backup/") === true,
      invalidImportPreservedBytes: canonicalJson([...secondBytes]) === canonicalJson([...afterInvalidBytes]),
      firstHash: [...new Uint8Array(firstHash)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
    };
  } catch (error: unknown) {
    throw new Error(`${stage}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    try { await client.shutdown(); } catch { client.dispose(); }
    client.dispose();
    chunks.dispose();
  }
}

async function runOfflineCapResume(): Promise<unknown> {
  await deleteGameplayDatabase();
  const firstChunks = new ChunkManager();
  const first = new GameplayClient(firstChunks, HARNESS_NONCE);
  try {
    await first.initialize(1_000);
    await first.command({ type: "CreateWorld", seed: SEED, seedSource: "manual" }, 1_000);
    await first.shutdown();
  } finally {
    first.dispose();
    firstChunks.dispose();
  }

  const targetWallClockMs = 604_813_345;
  const secondChunks = new ChunkManager();
  const second = new GameplayClient(secondChunks, "fedcba9876543210");
  try {
    const startedAt = performance.now();
    await second.initialize(targetWallClockMs);
    const elapsedMs = performance.now() - startedAt;
    const resumed = await waitForReadModel(second, (model) => model.offlineReport !== null && model.startup === "ready");
    const database = await inspectGameplayDatabase() as { core: { world_time_ms: string }; claimCount: number };
    return {
      creditedDurationMs: resumed.offlineReport?.creditedDurationMs,
      discardedDurationMs: resumed.offlineReport?.discardedDurationMs,
      rawElapsedMs: resumed.offlineReport?.rawElapsedMs,
      worldTimeMs: database.core.world_time_ms,
      saveRevision: resumed.save.revision,
      claimCount: database.claimCount,
      elapsedMs,
    };
  } finally {
    try { await second.shutdown(); } catch { second.dispose(); }
    second.dispose();
    secondChunks.dispose();
  }
}

declare global {
  interface Window {
    phase1WorkerHarness: {
      runWorkerEquivalence: typeof runWorkerEquivalence;
      runRawProtocolAndIdempotency: typeof runRawProtocolAndIdempotency;
      runRawTerrainCorrelation: typeof runRawTerrainCorrelation;
      runTerrainFailureScenario: typeof runTerrainFailureScenario;
      runGeneratorWorkerBoundary: typeof runGeneratorWorkerBoundary;
      runPersistenceCreateRestore: typeof runPersistenceCreateRestore;
      runWebLockExclusion: typeof runWebLockExclusion;
      runWebLocksUnavailableBoundary: typeof runWebLocksUnavailableBoundary;
      runPersistenceTamperMatrix: typeof runPersistenceTamperMatrix;
      runBackupRoundTrip: typeof runBackupRoundTrip;
      runOfflineCapResume: typeof runOfflineCapResume;
    };
  }
}

window.phase1WorkerHarness = {
  runWorkerEquivalence,
  runRawProtocolAndIdempotency,
  runRawTerrainCorrelation,
  runTerrainFailureScenario,
  runGeneratorWorkerBoundary,
  runPersistenceCreateRestore,
  runWebLockExclusion,
  runWebLocksUnavailableBoundary,
  runPersistenceTamperMatrix,
  runBackupRoundTrip,
  runOfflineCapResume,
};

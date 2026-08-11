import type { ChunkManager } from "./chunk-manager.ts";
import { canonicalJson } from "./gameplay/canonical-json.ts";
import {
  GAMEPLAY_PROTOCOL_VERSION,
  isGameplayWorkerToMain,
  isMainToGameplayWorker,
  type GameplayCommand,
  type GameplayReadModelV1,
  type GameplayWorkerToMain,
  type MainToGameplayWorker,
} from "./gameplay/contracts.ts";
import { isBaseTerrainId } from "./world-contract.ts";
import { TerrainSourceError } from "./terrain-source-error.ts";

type TerrainRequestMessage = Extract<GameplayWorkerToMain, { type: "terrain-request" }>;

export type TerrainSource = Readonly<{
  getBaseTerrain(seed: string, chunkX: string, chunkY: string, generatorVersion: number): Promise<Uint8Array>;
}>;

export type GameplayCommandInput<T extends GameplayCommand = GameplayCommand> = T extends GameplayCommand
  ? Omit<T, "commandId" | "wallClockMs">
  : never;

export type GameplayMessageSink = Readonly<{
  postMessage(message: MainToGameplayWorker, transfer?: Transferable[]): void;
}>;

type BrokerPending = Readonly<{
  terrainRequestId: string;
  gameplayEpoch: number;
  seed: string;
  generatorVersion: number;
  chunkKey: string;
  chunkX: string;
  chunkY: string;
}>;

export class GameplayTerrainBroker {
  private readonly source: TerrainSource;
  private readonly sink: GameplayMessageSink;
  private readonly currentGeneratorVersion: () => number;
  private readonly pending = new Map<string, BrokerPending>();
  private readonly seenTerrainRequests = new Map<string, BrokerPending>();
  private currentEpoch = -1;
  private currentSeed: string | null = null;
  private diagnosticOrdinal = 0;

  constructor(
    source: TerrainSource,
    sink: GameplayMessageSink,
    currentGeneratorVersion: () => number,
  ) {
    this.source = source;
    this.sink = sink;
    this.currentGeneratorVersion = currentGeneratorVersion;
  }

  get pendingCount(): number { return this.pending.size; }

  handle(request: TerrainRequestMessage): void {
    if (request.gameplayEpoch < this.currentEpoch) return;
    if (request.gameplayEpoch > this.currentEpoch) {
      this.pending.clear();
      this.seenTerrainRequests.clear();
      this.currentEpoch = request.gameplayEpoch;
      this.currentSeed = request.seed;
    }
    let generatorVersion: number;
    try {
      generatorVersion = this.currentGeneratorVersion();
    } catch {
      const failed: BrokerPending = {
        terrainRequestId: request.terrainRequestId, gameplayEpoch: request.gameplayEpoch, seed: request.seed,
        generatorVersion: 0, chunkKey: request.chunkKey, chunkX: request.chunkX, chunkY: request.chunkY,
      };
      this.seenTerrainRequests.set(request.terrainRequestId, failed);
      this.sendError(failed, "terrain/payload_invalid", false);
      return;
    }
    const pending: BrokerPending = {
      terrainRequestId: request.terrainRequestId,
      gameplayEpoch: request.gameplayEpoch,
      seed: request.seed,
      generatorVersion,
      chunkKey: request.chunkKey,
      chunkX: request.chunkX,
      chunkY: request.chunkY,
    };
    const seen = this.seenTerrainRequests.get(request.terrainRequestId);
    if (seen !== undefined) {
      const exactDuplicate = seen.gameplayEpoch === pending.gameplayEpoch && seen.seed === pending.seed
        && seen.generatorVersion === pending.generatorVersion && seen.chunkKey === pending.chunkKey
        && seen.chunkX === pending.chunkX && seen.chunkY === pending.chunkY;
      if (!exactDuplicate) {
        this.pending.delete(seen.terrainRequestId);
        this.sendError(seen, "terrain/payload_invalid", false);
      }
      return;
    }
    this.seenTerrainRequests.set(request.terrainRequestId, pending);
    if (request.seed !== this.currentSeed) {
      this.sendError(pending, "terrain/payload_invalid", false);
      return;
    }
    this.pending.set(request.terrainRequestId, pending);
    void this.source.getBaseTerrain(pending.seed, pending.chunkX, pending.chunkY, pending.generatorVersion)
      .then((bytes) => this.complete(pending, bytes))
      .catch((error: unknown) => this.fail(pending, error));
  }

  private isCurrent(pending: BrokerPending): boolean {
    return this.currentEpoch === pending.gameplayEpoch && this.pending.get(pending.terrainRequestId) === pending;
  }

  private complete(pending: BrokerPending, bytes: Uint8Array): void {
    if (!this.isCurrent(pending)) return;
    let versionMatches = false;
    try {
      versionMatches = pending.generatorVersion === this.currentGeneratorVersion();
    } catch {
      this.sendError(pending, "terrain/payload_invalid", false);
      return;
    }
    if (!versionMatches || bytes.byteLength !== 4096 || !bytes.every(isBaseTerrainId)) {
      this.sendError(pending, "terrain/payload_invalid", false);
      return;
    }
    const owned = bytes.slice().buffer;
    try {
      this.sink.postMessage({
        type: "terrain-result",
        protocolVersion: 1,
        terrainRequestId: pending.terrainRequestId,
        gameplayEpoch: pending.gameplayEpoch,
        chunkKey: pending.chunkKey,
        chunkX: pending.chunkX,
        chunkY: pending.chunkY,
        generatorVersion: pending.generatorVersion,
        baseTerrain: owned,
      }, [owned]);
      this.pending.delete(pending.terrainRequestId);
    } catch {
      this.sendError(pending, "terrain/payload_invalid", false);
    }
  }

  private fail(pending: BrokerPending, error: unknown): void {
    if (!this.isCurrent(pending)) return;
    if (error instanceof TerrainSourceError && error.kind === "stale") {
      this.sendError(pending, "terrain/payload_invalid", false);
      return;
    }
    const transient = error instanceof TerrainSourceError && error.kind === "generation" && error.transient;
    if (error instanceof TerrainSourceError && error.kind === "generation") this.sendError(pending, "terrain/generation_failed", transient);
    else this.sendError(pending, "terrain/payload_invalid", false);
  }

  private sendError(pending: BrokerPending, code: "terrain/generation_failed" | "terrain/payload_invalid", transient = false): void {
    const suffix = this.diagnosticOrdinal.toString(16).padStart(16, "0");
    this.diagnosticOrdinal += 1;
    try {
      this.sink.postMessage({
        type: "terrain-error",
        protocolVersion: 1,
        terrainRequestId: pending.terrainRequestId,
        gameplayEpoch: pending.gameplayEpoch,
        code,
        transient,
        diagnosticId: `diag:terrain:${code === "terrain/generation_failed" ? "generation-failed" : "payload-invalid"}:${suffix}`,
      });
    } finally {
      this.pending.delete(pending.terrainRequestId);
    }
  }
}

type PendingRequest = Readonly<{
  expectedType: "request-result" | "command-result" | "export-ready";
  expectedOperation: "initialize" | "flush" | "shutdown" | null;
  expectedCommandId: string | null;
  resolve: (message: Extract<GameplayWorkerToMain, { type: "request-result" | "command-result" | "export-ready" }>) => void;
  reject: (error: Error) => void;
}>;

export class GameplayClient {
  private readonly chunks: ChunkManager;
  private readonly worker: Worker;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly listeners = new Set<(readModel: GameplayReadModelV1) => void>();
  private readonly broker: GameplayTerrainBroker;
  private readonly nonce: string;
  private requestOrdinal = 0;
  private commandOrdinal = 0;
  private generatorVersion: number | null = null;
  private latestReadModel: GameplayReadModelV1 | null = null;
  private latestReadModelCanonical: string | null = null;
  private failed: Error | null = null;

  constructor(
    chunks: ChunkManager,
    nonce = GameplayClient.randomNonce(),
    workerFactory: () => Worker = () => new Worker(new URL("./gameplay-worker.ts", import.meta.url), { type: "module" }),
  ) {
    this.chunks = chunks;
    this.nonce = nonce;
    this.worker = workerFactory();
    this.broker = new GameplayTerrainBroker(
      { getBaseTerrain: (seed, x, y, version) => chunks.getBaseTerrain(seed, x, y, version) },
      { postMessage: (message, transfer = []) => {
        try {
          this.send(message, transfer);
        } catch (error: unknown) {
          const failure = error instanceof Error ? error : new Error(String(error));
          this.failClient(failure);
          throw failure;
        }
      } },
      () => {
        if (this.generatorVersion === null) throw new Error("gameplay client is not initialized");
        return this.generatorVersion;
      },
    );
    this.worker.onmessage = (event: MessageEvent<unknown>) => this.receive(event.data);
    this.worker.onerror = () => this.failClient(new Error("gameplay worker failed"));
  }

  static randomNonce(): string {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  get readModel(): GameplayReadModelV1 | null { return this.latestReadModel; }
  get pendingRequestCount(): number { return this.pendingRequests.size; }

  subscribe(listener: (readModel: GameplayReadModelV1) => void): () => void {
    this.listeners.add(listener);
    if (this.latestReadModel !== null) listener(this.latestReadModel);
    return () => this.listeners.delete(listener);
  }

  async initialize(wallClockMs = Date.now()): Promise<void> {
    const version = await this.chunks.whenReady();
    this.generatorVersion = version;
    const requestId = this.nextRequestId();
    const result = await this.request({ type: "initialize", protocolVersion: 1, requestId, generatorVersion: version, wallClockMs });
    if (result.type !== "request-result" || result.status !== "accepted") throw new Error("gameplay worker initialization was rejected");
  }

  async command<T extends GameplayCommandInput>(
    command: T,
    wallClockMs = Date.now(),
  ): Promise<T extends { type: "ExportSave" }
      ? Extract<GameplayWorkerToMain, { type: "export-ready" }>
      : Extract<GameplayWorkerToMain, { type: "command-result" }>> {
    const commandId = `cmd:${this.nonce}:${this.commandOrdinal}`;
    this.commandOrdinal += 1;
    const requestId = this.nextRequestId();
    const fullCommand = { ...command, commandId, wallClockMs } as GameplayCommand;
    const transfer = command.type === "ImportSave"
      ? [(fullCommand as Extract<GameplayCommand, { type: "ImportSave" }>).backupUtf8]
      : [];
    const result = await this.request({ type: "command", protocolVersion: 1, requestId, command: fullCommand }, transfer);
    const expected = command.type === "ExportSave" ? "export-ready" : "command-result";
    if (result.type !== expected) throw new Error("gameplay worker returned the wrong terminal result");
    return result as T extends { type: "ExportSave" }
      ? Extract<GameplayWorkerToMain, { type: "export-ready" }>
      : Extract<GameplayWorkerToMain, { type: "command-result" }>;
  }

  async flush(wallClockMs = Date.now()): Promise<void> {
    const requestId = this.nextRequestId();
    const result = await this.request({ type: "flush", protocolVersion: 1, requestId, wallClockMs });
    if (result.type !== "request-result" || result.status !== "accepted") throw new Error("gameplay flush was rejected");
  }

  async shutdown(): Promise<void> {
    const requestId = this.nextRequestId();
    const result = await this.request({ type: "shutdown", protocolVersion: 1, requestId });
    if (result.type !== "request-result" || result.status !== "accepted") throw new Error("gameplay shutdown was rejected");
    this.failClient(new Error("gameplay client shut down"));
  }

  dispose(): void { this.failClient(new Error("gameplay client disposed")); }

  private nextRequestId(): string {
    const requestId = `req:${this.nonce}:${this.requestOrdinal}`;
    this.requestOrdinal += 1;
    return requestId;
  }

  private request(message: MainToGameplayWorker, transfer: Transferable[] = []): Promise<Extract<GameplayWorkerToMain, { type: "request-result" | "command-result" | "export-ready" }>> {
    const requestId = "requestId" in message ? message.requestId : null;
    if (requestId === null) return Promise.reject(new Error("terminal request requires requestId"));
    if (this.failed !== null) return Promise.reject(this.failed);
    const expectedType = message.type === "command"
      ? message.command.type === "ExportSave" ? "export-ready" : "command-result"
      : "request-result";
    const expectedOperation = message.type === "initialize" || message.type === "flush" || message.type === "shutdown" ? message.type : null;
    const expectedCommandId = message.type === "command" ? message.command.commandId : null;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { expectedType, expectedOperation, expectedCommandId, resolve, reject });
      try {
        this.send(message, transfer);
      } catch (error: unknown) {
        this.pendingRequests.delete(requestId);
        const failure = error instanceof Error ? error : new Error(String(error));
        reject(failure);
        this.failClient(failure);
      }
    });
  }

  private send(message: MainToGameplayWorker, transfer: Transferable[] = []): void {
    if (!isMainToGameplayWorker(message)) throw new TypeError("main thread produced an invalid gameplay message");
    this.worker.postMessage(message, transfer);
  }

  private receive(input: unknown): void {
    if (!isGameplayWorkerToMain(input)) {
      this.failClient(new TypeError("gameplay worker sent an invalid message"));
      return;
    }
    if (input.type === "terrain-request") { this.broker.handle(input); return; }
    if (input.type === "read-model") {
      if (this.latestReadModel !== null) {
        if (input.readModel.readModelRevision < this.latestReadModel.readModelRevision) return;
        const canonical = canonicalJson(input.readModel);
        if (input.readModel.readModelRevision === this.latestReadModel.readModelRevision) {
          if (canonical !== this.latestReadModelCanonical) this.failClient(new TypeError("same read-model revision carried different canonical state"));
          return;
        }
        this.latestReadModelCanonical = canonical;
      } else {
        this.latestReadModelCanonical = canonicalJson(input.readModel);
      }
      this.latestReadModel = input.readModel;
      for (const listener of this.listeners) listener(input.readModel);
      return;
    }
    if (input.type === "request-result" || input.type === "command-result" || input.type === "export-ready") {
      const pending = this.pendingRequests.get(input.requestId);
      if (pending === undefined) return;
      const matches = input.type === pending.expectedType
        && (input.type !== "request-result" || input.operation === pending.expectedOperation)
        && (input.type === "request-result" || input.commandId === pending.expectedCommandId);
      if (!matches) {
        this.failClient(new TypeError("gameplay terminal response correlation mismatch"));
        return;
      }
      this.pendingRequests.delete(input.requestId);
      pending.resolve(input);
      return;
    }
    if (input.type === "protocol-error" && input.requestId !== null) {
      const pending = this.pendingRequests.get(input.requestId);
      if (pending !== undefined) {
        this.pendingRequests.delete(input.requestId);
        pending.reject(new Error(input.error.code));
      }
      return;
    }
    if (input.type === "fatal" || (input.type === "protocol-error" && input.requestId === null)) {
      const diagnostic = input.error.diagnosticId === null ? "" : ` (${input.error.diagnosticId})`;
      this.failClient(new Error(`${input.error.code}${diagnostic}`));
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pendingRequests.values()) pending.reject(error);
    this.pendingRequests.clear();
  }

  private failClient(error: Error): void {
    if (this.failed !== null) return;
    this.failed = error;
    this.rejectAll(error);
    this.worker.terminate();
  }
}

if (GAMEPLAY_PROTOCOL_VERSION !== 1) throw new Error("unsupported gameplay protocol version");

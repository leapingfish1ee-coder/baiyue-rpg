export type GenerateChunkRequest = {
  type: "generate";
  requestId: number;
  epoch: number;
  seed: string;
  chunkX: string;
  chunkY: string;
};

export type WorkerReadyMessage = {
  type: "ready";
  chunkSize: number;
  generatorVersion: number;
};

export type ChunkGeneratedMessage = {
  type: "chunk";
  requestId: number;
  epoch: number;
  chunkX: string;
  chunkY: string;
  macroBiome: number;
  buffer: ArrayBuffer;
};

export type WorkerErrorMessage = {
  type: "error";
  message: string;
} | {
  type: "error";
  requestId: number;
  epoch: number;
  message: string;
};

export type WorkerMessage = WorkerReadyMessage | ChunkGeneratedMessage | WorkerErrorMessage;

const UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const SIGNED_DECIMAL = /^(?:0|-?[1-9][0-9]*)$/;
const MAX_SEED = (1n << 64n) - 1n;
const MIN_CHUNK = -33_554_432n;
const MAX_CHUNK = 33_554_431n;

function hasExactKeys(value: unknown, keys: readonly string[]): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isSafeUint(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isU32(value: unknown): value is number {
  return isSafeUint(value) && value <= 0xffff_ffff;
}

function isUnsignedDecimal(value: unknown, maximum: bigint): value is string {
  return typeof value === "string" && UNSIGNED_DECIMAL.test(value) && BigInt(value) <= maximum;
}

function isChunkDecimal(value: unknown): value is string {
  if (typeof value !== "string" || !SIGNED_DECIMAL.test(value)) return false;
  const parsed = BigInt(value);
  return parsed >= MIN_CHUNK && parsed <= MAX_CHUNK;
}

export function isGenerateChunkRequest(value: unknown): value is GenerateChunkRequest {
  if (!hasExactKeys(value, ["type", "requestId", "epoch", "seed", "chunkX", "chunkY"])) return false;
  const request = value as Record<string, unknown>;
  return request.type === "generate" && isSafeUint(request.requestId) && isSafeUint(request.epoch)
    && isUnsignedDecimal(request.seed, MAX_SEED) && isChunkDecimal(request.chunkX) && isChunkDecimal(request.chunkY);
}

export function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  if (message.type === "ready") {
    return hasExactKeys(message, ["type", "chunkSize", "generatorVersion"])
      && isSafeUint(message.chunkSize) && isU32(message.generatorVersion);
  }
  if (message.type === "chunk") {
    return hasExactKeys(message, ["type", "requestId", "epoch", "chunkX", "chunkY", "macroBiome", "buffer"])
      && isSafeUint(message.requestId) && isSafeUint(message.epoch) && isChunkDecimal(message.chunkX) && isChunkDecimal(message.chunkY)
      && isSafeUint(message.macroBiome) && message.macroBiome <= 5 && message.buffer instanceof ArrayBuffer;
  }
  if (message.type === "error") {
    return (hasExactKeys(message, ["type", "message"]) || (hasExactKeys(message, ["type", "requestId", "epoch", "message"])
      && isSafeUint(message.requestId) && isSafeUint(message.epoch))) && typeof message.message === "string";
  }
  return false;
}

/// <reference lib="webworker" />

import { isGenerateChunkRequest, type WorkerMessage } from "./protocol.ts";
import { GENERATED_CHUNK_BYTES, RUNTIME_CHUNK_SIZE } from "./world-contract";

type TerrainWasmModule = {
  default: (wasmUrl?: string | URL) => Promise<unknown>;
  generate_chunk: (seed: bigint, chunkX: bigint, chunkY: bigint) => Uint8Array;
  macro_cell_biome: (seed: bigint, macroX: bigint, macroY: bigint) => number;
  chunk_size: () => number;
  generator_version: () => number;
};

const scope = self as DedicatedWorkerGlobalScope;

async function loadWasm(): Promise<TerrainWasmModule> {
  const baseUrl = import.meta.env.BASE_URL;
  const moduleUrl = `${baseUrl}wasm/terrain_wasm.js`;
  const wasmUrl = `${baseUrl}wasm/terrain_wasm_bg.wasm`;
  const wasm = (await import(/* @vite-ignore */ moduleUrl)) as TerrainWasmModule;
  await wasm.default(wasmUrl);
  return wasm;
}

const wasmPromise = loadWasm();

wasmPromise
  .then((wasm) => {
    const chunkSize = wasm.chunk_size();
    if (chunkSize !== RUNTIME_CHUNK_SIZE) {
      throw new Error(`WASM chunk size ${chunkSize} does not match shared contract ${RUNTIME_CHUNK_SIZE}`);
    }
    const message: WorkerMessage = {
      type: "ready",
      chunkSize,
      generatorVersion: wasm.generator_version(),
    };
    scope.postMessage(message);
  })
  .catch((error: unknown) => {
    const message: WorkerMessage = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(message);
  });

scope.onmessage = async (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isGenerateChunkRequest(request)) {
    const message: WorkerMessage = { type: "error", message: "invalid generate request" };
    scope.postMessage(message);
    return;
  }

  try {
    const wasm = await wasmPromise;
    const seed = BigInt(request.seed);
    const chunkX = BigInt(request.chunkX);
    const chunkY = BigInt(request.chunkY);
    const wasmTiles = wasm.generate_chunk(seed, chunkX, chunkY);
    if (wasmTiles.byteLength !== GENERATED_CHUNK_BYTES) {
      throw new Error(`WASM chunk payload must be ${GENERATED_CHUNK_BYTES} bytes, got ${wasmTiles.byteLength}`);
    }
    const macroBiome = wasm.macro_cell_biome(seed, chunkX, chunkY);

    // Transfer an owned buffer. Do not transfer WebAssembly.Memory itself.
    const tiles = new Uint8Array(wasmTiles);
    const message: WorkerMessage = {
      type: "chunk",
      requestId: request.requestId,
      epoch: request.epoch,
      chunkX: request.chunkX,
      chunkY: request.chunkY,
      macroBiome,
      buffer: tiles.buffer,
    };
    scope.postMessage(message, [tiles.buffer]);
  } catch (error: unknown) {
    const message: WorkerMessage = {
      type: "error",
      requestId: request.requestId,
      epoch: request.epoch,
      message: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(message);
  }
};

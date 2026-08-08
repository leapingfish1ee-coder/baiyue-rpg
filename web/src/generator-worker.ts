/// <reference lib="webworker" />

import type { GenerateChunkRequest, WorkerMessage } from "./protocol";

type TerrainWasmModule = {
  default: (wasmUrl?: string | URL) => Promise<unknown>;
  generate_chunk: (seed: bigint, chunkX: bigint, chunkY: bigint) => Uint8Array;
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
    const message: WorkerMessage = {
      type: "ready",
      chunkSize: wasm.chunk_size(),
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

scope.onmessage = async (event: MessageEvent<GenerateChunkRequest>) => {
  const request = event.data;
  if (request.type !== "generate") return;

  try {
    const wasm = await wasmPromise;
    const wasmTiles = wasm.generate_chunk(
      BigInt(request.seed),
      BigInt(request.chunkX),
      BigInt(request.chunkY),
    );

    // Transfer an owned buffer. Do not transfer WebAssembly.Memory itself.
    const tiles = new Uint8Array(wasmTiles);
    const message: WorkerMessage = {
      type: "chunk",
      requestId: request.requestId,
      epoch: request.epoch,
      chunkX: request.chunkX,
      chunkY: request.chunkY,
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

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
  requestId?: number;
  epoch?: number;
  message: string;
};

export type WorkerMessage = WorkerReadyMessage | ChunkGeneratedMessage | WorkerErrorMessage;

export type TerrainSourceFailureKind = "stale" | "generation" | "payload" | "version" | "worker";

export class TerrainSourceError extends Error {
  readonly kind: TerrainSourceFailureKind;
  readonly transient: boolean;

  constructor(kind: TerrainSourceFailureKind, message: string, transient = false) {
    super(message);
    this.kind = kind;
    this.transient = transient;
  }
}

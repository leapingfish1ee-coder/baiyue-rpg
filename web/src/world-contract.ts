export const RUNTIME_CHUNK_SIZE = 64;
export const RUNTIME_CHUNK_AREA = RUNTIME_CHUNK_SIZE * RUNTIME_CHUNK_SIZE;
export const GENERATED_CHUNK_BYTES = RUNTIME_CHUNK_AREA * 2;
export const NAV_UNITS_PER_TILE = 1024n;
export const TILE_COORDINATE_MIN = -(1n << 31n);
export const TILE_COORDINATE_MAX = (1n << 31n) - 1n;
export const WORLD_POINT_NAV_MIN = TILE_COORDINATE_MIN * NAV_UNITS_PER_TILE;
export const WORLD_POINT_NAV_MAX = (TILE_COORDINATE_MAX + 1n) * NAV_UNITS_PER_TILE - 1n;
export const CHUNK_COORDINATE_MIN = TILE_COORDINATE_MIN / BigInt(RUNTIME_CHUNK_SIZE);
export const CHUNK_COORDINATE_MAX = TILE_COORDINATE_MAX / BigInt(RUNTIME_CHUNK_SIZE);

export const BASE_TERRAIN_ID = {
  DeepWater: 0,
  Water: 1,
  Sand: 2,
  Land: 3,
  Rock: 4,
  Snow: 5,
} as const;

export type BaseTerrainId = (typeof BASE_TERRAIN_ID)[keyof typeof BASE_TERRAIN_ID];

export const BASE_TERRAIN_ID_MAX = BASE_TERRAIN_ID.Snow;

export const DECORATION_ID = { None: 0, Grass: 1, Grove: 2 } as const;
export const DECORATION_ID_MAX = DECORATION_ID.Grove;

export function isBaseTerrainId(value: number): value is BaseTerrainId {
  return Number.isInteger(value) && value >= BASE_TERRAIN_ID.DeepWater && value <= BASE_TERRAIN_ID_MAX;
}

export function isPassableBaseTerrain(value: number): value is BaseTerrainId {
  return isBaseTerrainId(value) && value !== BASE_TERRAIN_ID.DeepWater && value !== BASE_TERRAIN_ID.Water;
}

export function isDecorationId(value: number): boolean {
  return Number.isInteger(value) && value >= DECORATION_ID.None && value <= DECORATION_ID_MAX;
}

export function isTileCoordinateInBounds(value: bigint): boolean {
  return value >= TILE_COORDINATE_MIN && value <= TILE_COORDINATE_MAX;
}

export function isWorldNavCoordinateInBounds(value: bigint): boolean {
  return value >= WORLD_POINT_NAV_MIN && value <= WORLD_POINT_NAV_MAX;
}

export function isChunkCoordinateInBounds(value: bigint): boolean {
  return value >= CHUNK_COORDINATE_MIN && value <= CHUNK_COORDINATE_MAX;
}

export function compareChunkKeysNumeric(left: string, right: string): number {
  const canonicalCoordinate = /^(?:0|-?[1-9][0-9]*)$/;
  const leftParts = left.split(",");
  const rightParts = right.split(",");
  if (leftParts.length !== 2 || rightParts.length !== 2 || !leftParts.every((part) => canonicalCoordinate.test(part))
    || !rightParts.every((part) => canonicalCoordinate.test(part))) throw new TypeError("chunk keys must contain exactly two canonical decimal coordinates");
  const [leftXText, leftYText] = leftParts as [string, string];
  const [rightXText, rightYText] = rightParts as [string, string];
  const leftX = BigInt(leftXText);
  const leftY = BigInt(leftYText);
  const rightX = BigInt(rightXText);
  const rightY = BigInt(rightYText);
  if (leftY !== rightY) return leftY < rightY ? -1 : 1;
  return leftX < rightX ? -1 : leftX > rightX ? 1 : 0;
}

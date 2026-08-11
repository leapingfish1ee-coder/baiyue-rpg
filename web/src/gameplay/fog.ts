import { NAV_UNITS_PER_TILE, RUNTIME_CHUNK_AREA, RUNTIME_CHUNK_SIZE, compareChunkKeysNumeric, isTileCoordinateInBounds } from "../world-contract.ts";
import { floorDiv, tileCenter, tileCoordinate } from "./math.ts";

export const FOG_BYTES_PER_CHUNK = RUNTIME_CHUNK_AREA / 8;

export type FogMap = Map<string, Uint8Array>;

export type RevealResult = Readonly<{ newlyRevealed: number; touchedChunkKeys: readonly string[] }>;

export function fogChunkKey(chunkX: bigint, chunkY: bigint): string {
  return `${chunkX},${chunkY}`;
}

function bitLocation(tileX: bigint, tileY: bigint): Readonly<{ key: string; byteIndex: number; mask: number }> {
  if (!isTileCoordinateInBounds(tileX) || !isTileCoordinateInBounds(tileY)) throw new RangeError("fog tile is outside the phase-1 range");
  const size = BigInt(RUNTIME_CHUNK_SIZE);
  const chunkX = floorDiv(tileX, size);
  const chunkY = floorDiv(tileY, size);
  const localX = Number(tileX - chunkX * size);
  const localY = Number(tileY - chunkY * size);
  const index = localY * RUNTIME_CHUNK_SIZE + localX;
  return { key: fogChunkKey(chunkX, chunkY), byteIndex: index >> 3, mask: 1 << (index & 7) };
}

export function isRevealed(fog: FogMap, tileX: bigint, tileY: bigint): boolean {
  if (!isTileCoordinateInBounds(tileX) || !isTileCoordinateInBounds(tileY)) return false;
  const location = bitLocation(tileX, tileY);
  return ((fog.get(location.key)?.[location.byteIndex] ?? 0) & location.mask) !== 0;
}

export function revealTile(fog: FogMap, tileX: bigint, tileY: bigint): boolean {
  if (!isTileCoordinateInBounds(tileX) || !isTileCoordinateInBounds(tileY)) return false;
  const location = bitLocation(tileX, tileY);
  let bits = fog.get(location.key);
  if (bits === undefined) {
    bits = new Uint8Array(FOG_BYTES_PER_CHUNK);
    fog.set(location.key, bits);
  }
  const previous = bits[location.byteIndex]!;
  if ((previous & location.mask) !== 0) return false;
  bits[location.byteIndex] = previous | location.mask;
  return true;
}

export function revealObservation(fog: FogMap, centerX: bigint, centerY: bigint, radiusTiles: number): RevealResult {
  const radiusNav = BigInt(radiusTiles) * NAV_UNITS_PER_TILE;
  const radiusSquared = radiusNav * radiusNav;
  const centerTileX = tileCoordinate(centerX);
  const centerTileY = tileCoordinate(centerY);
  const touched = new Set<string>();
  let newlyRevealed = 0;

  for (let offsetY = -radiusTiles - 1; offsetY <= radiusTiles + 1; offsetY += 1) {
    for (let offsetX = -radiusTiles - 1; offsetX <= radiusTiles + 1; offsetX += 1) {
      const tileX = centerTileX + BigInt(offsetX);
      const tileY = centerTileY + BigInt(offsetY);
      if (!isTileCoordinateInBounds(tileX) || !isTileCoordinateInBounds(tileY)) continue;
      const dx = tileCenter(tileX) - centerX;
      const dy = tileCenter(tileY) - centerY;
      if (dx * dx + dy * dy > radiusSquared) continue;
      if (revealTile(fog, tileX, tileY)) {
        newlyRevealed += 1;
        const size = BigInt(RUNTIME_CHUNK_SIZE);
        touched.add(fogChunkKey(floorDiv(tileX, size), floorDiv(tileY, size)));
      }
    }
  }
  return { newlyRevealed, touchedChunkKeys: [...touched].sort(compareChunkKeysNumeric) };
}

export function fogBitsToBase64(bits: Uint8Array): string {
  if (bits.byteLength !== FOG_BYTES_PER_CHUNK) throw new RangeError("fog chunk must be exactly 512 bytes");
  let binary = "";
  for (let index = 0; index < bits.length; index += 1) binary += String.fromCharCode(bits[index]!);
  return btoa(binary);
}

export function base64ToFogBits(encoded: string): Uint8Array {
  const binary = atob(encoded);
  if (binary.length !== FOG_BYTES_PER_CHUNK) throw new RangeError("fog base64 must decode to exactly 512 bytes");
  const bits = new Uint8Array(FOG_BYTES_PER_CHUNK);
  for (let index = 0; index < binary.length; index += 1) bits[index] = binary.charCodeAt(index);
  if (fogBitsToBase64(bits) !== encoded) throw new RangeError("fog base64 must use canonical padded RFC 4648 spelling");
  return bits;
}

export function* revealedTiles(fog: FogMap): Iterable<Readonly<{ x: bigint; y: bigint }>> {
  const size = BigInt(RUNTIME_CHUNK_SIZE);
  const entries = [...fog.entries()].sort(([left], [right]) => compareChunkKeysNumeric(left, right));
  for (const [key, bits] of entries) {
    const [chunkXText, chunkYText] = key.split(",");
    if (chunkXText === undefined || chunkYText === undefined) throw new Error(`invalid fog chunk key ${key}`);
    const chunkX = BigInt(chunkXText);
    const chunkY = BigInt(chunkYText);
    for (let index = 0; index < RUNTIME_CHUNK_AREA; index += 1) {
      if (((bits[index >> 3]! >> (index & 7)) & 1) === 0) continue;
      yield {
        x: chunkX * size + BigInt(index % RUNTIME_CHUNK_SIZE),
        y: chunkY * size + BigInt(Math.floor(index / RUNTIME_CHUNK_SIZE)),
      };
    }
  }
}

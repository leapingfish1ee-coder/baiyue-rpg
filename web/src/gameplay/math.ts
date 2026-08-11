import { NAV_UNITS_PER_TILE, isTileCoordinateInBounds, isWorldNavCoordinateInBounds } from "../world-contract.ts";

export function floorDiv(value: bigint, divisor: bigint): bigint {
  if (divisor <= 0n) throw new RangeError("floorDiv divisor must be positive");
  const quotient = value / divisor;
  return value % divisor < 0n ? quotient - 1n : quotient;
}

export function ceilDiv(value: bigint, divisor: bigint): bigint {
  if (divisor <= 0n || value < 0n) throw new RangeError("ceilDiv requires a non-negative value and positive divisor");
  return (value + divisor - 1n) / divisor;
}

export function roundDivNearestEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError("roundDivNearestEven denominator must be positive");
  const quotient = floorDiv(numerator, denominator);
  const remainder = numerator - quotient * denominator;
  const doubled = remainder * 2n;
  if (doubled < denominator) return quotient;
  if (doubled > denominator) return quotient + 1n;
  return quotient % 2n === 0n ? quotient : quotient + 1n;
}

export function ceilSqrt(value: bigint): bigint {
  if (value < 0n) throw new RangeError("ceilSqrt value must be non-negative");
  if (value < 2n) return value;
  let low = 1n;
  let high = 1n;
  while (high * high < value) high *= 2n;
  while (low < high) {
    const middle = (low + high) / 2n;
    if (middle * middle >= value) high = middle;
    else low = middle + 1n;
  }
  return low;
}

export function euclideanLength(dx: bigint, dy: bigint): bigint {
  return ceilSqrt(dx * dx + dy * dy);
}

export function tileCoordinate(navCoordinate: bigint): bigint {
  if (!isWorldNavCoordinateInBounds(navCoordinate)) throw new RangeError("world nav coordinate is outside the phase-1 range");
  return floorDiv(navCoordinate, NAV_UNITS_PER_TILE);
}

export function tileCenter(tile: bigint): bigint {
  if (!isTileCoordinateInBounds(tile)) throw new RangeError("tile coordinate is outside the phase-1 range");
  return tile * NAV_UNITS_PER_TILE + NAV_UNITS_PER_TILE / 2n;
}

export function canonicalPoint(x: bigint, y: bigint): Readonly<{ x: string; y: string }> {
  if (!isWorldNavCoordinateInBounds(x) || !isWorldNavCoordinateInBounds(y)) throw new RangeError("WorldPoint is outside the phase-1 range");
  return { x: x.toString(), y: y.toString() };
}

export function xpForNextLevel(level: number): number | null {
  if (!Number.isInteger(level) || level < 1 || level > 100) throw new RangeError("level must be 1..100");
  if (level === 100) return null;
  const exponent = BigInt(level - 1);
  const numerator = 100n * 28n ** exponent;
  const denominator = 25n ** exponent;
  const roundedHalfUp = (2n * numerator + denominator) / (2n * denominator);
  const result = Number(roundedHalfUp);
  if (!Number.isSafeInteger(result)) throw new RangeError("XP curve exceeded safe integer storage");
  return result;
}

export function levelFromTotalXp(totalXp: number): number {
  if (!Number.isSafeInteger(totalXp) || totalXp < 0) throw new RangeError("XP must be a safe uint");
  let remaining = totalXp;
  let level = 1;
  while (level < 100) {
    const next = xpForNextLevel(level)!;
    if (remaining < next) break;
    remaining -= next;
    level += 1;
  }
  return level;
}

export function xpAtLevelStart(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 100) throw new RangeError("level must be 1..100");
  let total = 0;
  for (let current = 1; current < level; current += 1) total += xpForNextLevel(current)!;
  return total;
}

export function observationRadius(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 100) throw new RangeError("level must be 1..100");
  return Math.min(13, 4 + Math.floor((level - 1) / 10));
}

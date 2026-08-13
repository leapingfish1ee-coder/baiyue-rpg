import type { SeedDecimal } from "./contracts.ts";
import { roundDivNearestEven } from "./math.ts";

export const GAMEPLAY_RANDOM_VERSION = 1 as const;
export const MICRO_HP_PER_HP = 1_000_000n;
export const POWER_SCALE = 1_000_000n;
export const PROBABILITY_MIN_PPM = 50_000;
export const PROBABILITY_MAX_PPM = 950_000;

const U64_RANGE = 1n << 64n;
const U64_MASK = U64_RANGE - 1n;
const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;

function fnv1a64(text: string): bigint {
  let hash = FNV_OFFSET_BASIS_64;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME_64) & U64_MASK;
  }
  return hash;
}
function splitMix64Finalizer(value: bigint): bigint {
  let mixed = value & U64_MASK;
  mixed = ((mixed ^ (mixed >> 30n)) * 0xbf58476d1ce4e5b9n) & U64_MASK;
  mixed = ((mixed ^ (mixed >> 27n)) * 0x94d049bb133111ebn) & U64_MASK;
  return (mixed ^ (mixed >> 31n)) & U64_MASK;
}

function integerFifthRootFloor(value: bigint): bigint {
  if (value < 0n) throw new RangeError("fifth root requires a non-negative integer");
  if (value < 2n) return value;
  let low = 0n;
  let high = 1n;
  while (high ** 5n <= value) high <<= 1n;
  while (low + 1n < high) {
    const middle = (low + high) >> 1n;
    if (middle ** 5n <= value) low = middle;
    else high = middle;
  }
  return low;
}

/** floor(x^1.4 * POWER_SCALE), evaluated without platform floating point. */
export function powSevenFifthsScaled(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError("power input must be a positive safe integer");
  return integerFifthRootFloor(BigInt(value) ** 7n * POWER_SCALE ** 5n);
}

export function opposedChancePpm(attacker: number, defender: number): number {
  const attackPower = powSevenFifthsScaled(attacker);
  const defencePower = powSevenFifthsScaled(defender);
  const rounded = roundDivNearestEven(attackPower * 1_000_000n, attackPower + defencePower);
  return Number(rounded < BigInt(PROBABILITY_MIN_PPM)
    ? BigInt(PROBABILITY_MIN_PPM)
    : rounded > BigInt(PROBABILITY_MAX_PPM) ? BigInt(PROBABILITY_MAX_PPM) : rounded);
}

export type GameplayRandomPurpose = "detect" | "hit:player" | "hit:enemy" | "damage:player" | "damage:enemy";

function gameplayRandomU64(
  seed: SeedDecimal,
  encounterInstanceId: string,
  combatEventOrdinal: bigint,
  purpose: GameplayRandomPurpose,
  rejectionDrawOrdinal: bigint,
): bigint {
  const domain = `${GAMEPLAY_RANDOM_VERSION}|${seed}|${encounterInstanceId}|${combatEventOrdinal}|${purpose}|${rejectionDrawOrdinal}`;
  return splitMix64Finalizer(fnv1a64(domain));
}

export function deterministicRangeInclusive(
  seed: SeedDecimal,
  encounterInstanceId: string,
  combatEventOrdinal: bigint,
  purpose: GameplayRandomPurpose,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum > maximum) {
    throw new RangeError("random range must be an ordered safe-integer interval");
  }
  const width = BigInt(maximum - minimum + 1);
  const acceptanceLimit = (U64_RANGE / width) * width;
  for (let draw = 0n; ; draw += 1n) {
    const candidate = gameplayRandomU64(seed, encounterInstanceId, combatEventOrdinal, purpose, draw);
    if (candidate < acceptanceLimit) return minimum + Number(candidate % width);
  }
}

export function deterministicPpmRoll(
  seed: SeedDecimal,
  encounterInstanceId: string,
  combatEventOrdinal: bigint,
  purpose: Extract<GameplayRandomPurpose, "detect" | "hit:player" | "hit:enemy">,
): number {
  return deterministicRangeInclusive(seed, encounterInstanceId, combatEventOrdinal, purpose, 0, 999_999);
}

export function finalPhysicalDamage(rawDamage: number, armor: number): number {
  if (!Number.isSafeInteger(rawDamage) || rawDamage < 1 || !Number.isSafeInteger(armor) || armor < 0) {
    throw new RangeError("damage and armor must be non-negative safe integers");
  }
  const mitigationBps = Math.min(7_500, Math.floor(armor * 10_000 / (armor + 100)));
  return Math.max(1, Math.floor(rawDamage * (10_000 - mitigationBps) / 10_000));
}

export function applyNaturalRegen(
  currentHpMicro: bigint,
  maxHpMicro: bigint,
  regenNumerator: bigint,
  elapsedMs: bigint,
): Readonly<{ currentHpMicro: bigint; regenNumerator: bigint }> {
  if (currentHpMicro < 0n || maxHpMicro <= 0n || currentHpMicro > maxHpMicro || regenNumerator < 0n || elapsedMs < 0n) {
    throw new RangeError("invalid natural regeneration state");
  }
  if (currentHpMicro === maxHpMicro) return { currentHpMicro, regenNumerator: 0n };
  const numerator = regenNumerator + elapsedMs * maxHpMicro;
  const healed = numerator / MICRO_HP_PER_HP;
  const nextHp = currentHpMicro + healed;
  if (nextHp >= maxHpMicro) return { currentHpMicro: maxHpMicro, regenNumerator: 0n };
  return { currentHpMicro: nextHp, regenNumerator: numerator % MICRO_HP_PER_HP };
}

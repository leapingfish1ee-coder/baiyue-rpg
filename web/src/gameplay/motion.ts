import type { WorldPoint } from "./contracts.ts";
import { ceilDiv, roundDivNearestEven } from "./math.ts";
import { BASE_MOVE_SPEED_NAV_PER_SECOND, type Rational, type SegmentProfile, type TerrainCostRun } from "./navigation.ts";

const ZERO: Rational = { numerator: 0n, denominator: 1n };
const ONE: Rational = { numerator: 1n, denominator: 1n };

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function rational(numerator: bigint, denominator: bigint): Rational {
  if (denominator <= 0n) throw new RangeError("rational denominator must be positive");
  if (numerator === 0n) return ZERO;
  const divisor = gcd(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

export function compareRational(left: Rational, right: Rational): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function add(left: Rational, right: Rational): Rational {
  return rational(left.numerator * right.denominator + right.numerator * left.denominator, left.denominator * right.denominator);
}

function subtract(left: Rational, right: Rational): Rational {
  return rational(left.numerator * right.denominator - right.numerator * left.denominator, left.denominator * right.denominator);
}

function multiply(left: Rational, right: Rational): Rational {
  return rational(left.numerator * right.numerator, left.denominator * right.denominator);
}

function divide(left: Rational, right: Rational): Rational {
  if (right.numerator <= 0n) throw new RangeError("rational divisor must be positive");
  return rational(left.numerator * right.denominator, left.denominator * right.numerator);
}

function asRational(value: bigint): Rational { return { numerator: value, denominator: 1n }; }

function runForParameter(profile: SegmentProfile, parameter: Rational): TerrainCostRun {
  const run = profile.runs.find((candidate) => compareRational(parameter, candidate.endParameter) <= 0
    && compareRational(parameter, candidate.startParameter) >= 0);
  if (run === undefined) throw new RangeError("parameter is outside the segment profile");
  return run;
}

export function weightedCostAtParameter(profile: SegmentProfile, parameter: Rational): Rational {
  if (compareRational(parameter, ZERO) <= 0) return ZERO;
  if (compareRational(parameter, ONE) >= 0) return asRational(profile.cost);
  const run = runForParameter(profile, parameter);
  const runSpan = subtract(run.endParameter, run.startParameter);
  const progress = divide(subtract(parameter, run.startParameter), runSpan);
  return add(asRational(run.cumulativeCostBefore), multiply(asRational(run.cost), progress));
}

export function elapsedMsAtParameter(profile: SegmentProfile, parameter: Rational): bigint {
  const weighted = weightedCostAtParameter(profile, parameter);
  return ceilDiv(weighted.numerator * 1000n, weighted.denominator * BASE_MOVE_SPEED_NAV_PER_SECOND);
}

export function etaForProfile(profile: SegmentProfile): bigint {
  return ceilDiv(profile.cost * 1000n, BASE_MOVE_SPEED_NAV_PER_SECOND);
}

export function parameterAtElapsedMs(profile: SegmentProfile, elapsedMs: bigint): Rational {
  if (elapsedMs <= 0n || profile.cost === 0n) return ZERO;
  if (elapsedMs >= etaForProfile(profile)) return ONE;
  return parameterAtWeightedCost(profile, rational(elapsedMs * BASE_MOVE_SPEED_NAV_PER_SECOND, 1000n));
}

export function parameterAtWeightedCost(profile: SegmentProfile, available: Rational): Rational {
  if (available.numerator <= 0n || profile.cost === 0n) return ZERO;
  if (compareRational(available, asRational(profile.cost)) >= 0) return ONE;
  for (const run of profile.runs) {
    const runEndCost = asRational(run.cumulativeCostBefore + run.cost);
    if (compareRational(available, runEndCost) > 0) continue;
    const within = subtract(available, asRational(run.cumulativeCostBefore));
    if (within.numerator <= 0n) return run.startParameter;
    const progress = divide(within, asRational(run.cost));
    return add(run.startParameter, multiply(subtract(run.endParameter, run.startParameter), progress));
  }
  return ONE;
}

export function pointAtParameter(profile: SegmentProfile, parameter: Rational): WorldPoint {
  const startX = BigInt(profile.start.x);
  const startY = BigInt(profile.start.y);
  return {
    x: roundDivNearestEven(startX * parameter.denominator + (BigInt(profile.end.x) - startX) * parameter.numerator, parameter.denominator).toString(),
    y: roundDivNearestEven(startY * parameter.denominator + (BigInt(profile.end.y) - startY) * parameter.numerator, parameter.denominator).toString(),
  };
}

export function positionAtElapsedMs(profile: SegmentProfile, elapsedMs: bigint): WorldPoint {
  return pointAtParameter(profile, parameterAtElapsedMs(profile, elapsedMs));
}

export function positionAtWeightedCost(profile: SegmentProfile, weightedCost: Rational): WorldPoint {
  return pointAtParameter(profile, parameterAtWeightedCost(profile, weightedCost));
}

export function boundaryEventTimes(profile: SegmentProfile): readonly bigint[] {
  return profile.boundaryParameters.map((parameter) => elapsedMsAtParameter(profile, parameter));
}

export function routeEventTimeMs(cumulativeCostBefore: bigint, profile: SegmentProfile, parameter: Rational): bigint {
  const within = weightedCostAtParameter(profile, parameter);
  return ceilDiv((cumulativeCostBefore * within.denominator + within.numerator) * 1000n,
    within.denominator * BASE_MOVE_SPEED_NAV_PER_SECOND);
}

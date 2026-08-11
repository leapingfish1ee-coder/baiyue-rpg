import {
  NAV_UNITS_PER_TILE,
  RUNTIME_CHUNK_AREA,
  RUNTIME_CHUNK_SIZE,
  isBaseTerrainId,
  isPassableBaseTerrain,
  isChunkCoordinateInBounds,
  isTileCoordinateInBounds,
} from "../world-contract.ts";
import type { WorldPoint } from "./contracts.ts";
import { isRevealed, type FogMap } from "./fog.ts";
import { canonicalPoint, ceilDiv, ceilSqrt, euclideanLength, floorDiv, tileCenter, tileCoordinate } from "./math.ts";

export const BASE_MOVE_SPEED_NAV_PER_SECOND = 2048n;
export const PLAYER_RADIUS_NAV_UNITS = 256n;

const TERRAIN_FACTORS = [0n, 0n, 1100n, 1000n, 1400n, 1500n] as const;
const NEIGHBOR_OFFSETS = [
  [-1n, -1n], [0n, -1n], [1n, -1n], [-1n, 0n], [1n, 0n], [-1n, 1n], [0n, 1n], [1n, 1n],
] as const;

export type NavigationPoint = Readonly<{ x: bigint; y: bigint }>;
export type Rational = Readonly<{ numerator: bigint; denominator: bigint }>;
type Point = NavigationPoint;
type Fraction = Rational;
type TerrainRequiredSignal = Readonly<{ kind: "terrain-required"; chunkX: string; chunkY: string; chunkKey: string }>;
type PlannerSignal = TerrainRequiredSignal | Readonly<{ kind: "operation" }>;

export type TerrainCostRun = Readonly<{
  startParameter: Rational;
  endParameter: Rational;
  terrainFactor: bigint;
  cost: bigint;
  cumulativeCostBefore: bigint;
}>;
export type SegmentProfile = Readonly<{
  start: WorldPoint;
  end: WorldPoint;
  runs: readonly TerrainCostRun[];
  boundaryParameters: readonly Rational[];
  cost: bigint;
}>;
export type RoutePlan = Readonly<{
  points: readonly WorldPoint[];
  legCosts: readonly bigint[];
  legProfiles: readonly SegmentProfile[];
  cost: bigint;
}>;
export type PlanFinal =
  | Readonly<{ kind: "route"; plan: RoutePlan }>
  | Readonly<{ kind: "destination-unreachable"; destination: WorldPoint }>
  | Readonly<{ kind: "no-reachable-frontier" }>;
export type PlanResult = PlanFinal | TerrainRequiredSignal | Readonly<{ kind: "yield" }>;

export class TerrainPayloadError extends Error {
  readonly code = "terrain/payload_invalid" as const;
}

export class TerrainSnapshot {
  private readonly chunks = new Map<string, Uint8Array>();

  clear(): void {
    this.chunks.clear();
  }

  hasChunk(chunkX: bigint, chunkY: bigint): boolean {
    return this.chunks.has(`${chunkX},${chunkY}`);
  }

  provideChunk(chunkXText: string, chunkYText: string, bytes: Uint8Array): void {
    const chunkX = BigInt(chunkXText);
    const chunkY = BigInt(chunkYText);
    if (!isChunkCoordinateInBounds(chunkX) || !isChunkCoordinateInBounds(chunkY)) throw new TerrainPayloadError("terrain chunk coordinate is outside the phase-1 range");
    const key = `${chunkX},${chunkY}`;
    if (bytes.byteLength !== RUNTIME_CHUNK_AREA) throw new TerrainPayloadError(`terrain chunk ${key} must contain 4096 bytes`);
    for (const terrainId of bytes) {
      if (!isBaseTerrainId(terrainId)) throw new TerrainPayloadError(`terrain chunk ${key} contains invalid BaseTerrain id ${terrainId}`);
    }
    this.chunks.set(key, bytes.slice());
  }

  terrainAtLoaded(tileX: bigint, tileY: bigint): number {
    const size = BigInt(RUNTIME_CHUNK_SIZE);
    const chunkX = floorDiv(tileX, size);
    const chunkY = floorDiv(tileY, size);
    const chunk = this.chunks.get(`${chunkX},${chunkY}`);
    if (chunk === undefined) throw new Error("planner attempted to read an unloaded terrain chunk");
    const localX = Number(tileX - chunkX * size);
    const localY = Number(tileY - chunkY * size);
    return chunk[localY * RUNTIME_CHUNK_SIZE + localX]!;
  }
}

function* terrainAt(snapshot: TerrainSnapshot, tileX: bigint, tileY: bigint): Generator<PlannerSignal, number, void> {
  const size = BigInt(RUNTIME_CHUNK_SIZE);
  const chunkX = floorDiv(tileX, size);
  const chunkY = floorDiv(tileY, size);
  while (!snapshot.hasChunk(chunkX, chunkY)) {
    yield { kind: "terrain-required", chunkX: chunkX.toString(), chunkY: chunkY.toString(), chunkKey: `${chunkX},${chunkY}` };
  }
  yield { kind: "operation" };
  return snapshot.terrainAtLoaded(tileX, tileY);
}

function pointFromContract(point: WorldPoint): Point {
  return { x: BigInt(point.x), y: BigInt(point.y) };
}

function compareFraction(left: Fraction, right: Fraction): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function reduceFraction(numerator: bigint, denominator: bigint): Fraction {
  if (denominator <= 0n) throw new RangeError("fraction denominator must be positive");
  let left = numerator < 0n ? -numerator : numerator;
  let right = denominator;
  while (right !== 0n) [left, right] = [right, left % right];
  return { numerator: numerator / left, denominator: denominator / left };
}

class BoundaryCursor {
  private readonly start: bigint;
  private readonly end: bigint;
  private boundary: bigint;
  private readonly step: bigint;
  private readonly increasing: boolean;
  private readonly magnitude: bigint;

  constructor(start: bigint, end: bigint) {
    this.start = start;
    this.end = end;
    const delta = end - start;
    this.increasing = delta > 0n;
    this.magnitude = delta < 0n ? -delta : delta;
    if (delta > 0n) {
      this.boundary = (floorDiv(start, NAV_UNITS_PER_TILE) + 1n) * NAV_UNITS_PER_TILE;
      this.step = NAV_UNITS_PER_TILE;
    } else {
      this.boundary = floorDiv(start, NAV_UNITS_PER_TILE) * NAV_UNITS_PER_TILE;
      if (this.boundary === start) this.boundary -= NAV_UNITS_PER_TILE;
      this.step = -NAV_UNITS_PER_TILE;
    }
  }

  peek(): Fraction | null {
    if (this.magnitude === 0n) return null;
    if (this.increasing ? this.boundary >= this.end : this.boundary <= this.end) return null;
    const numerator = this.increasing ? this.boundary - this.start : this.start - this.boundary;
    return reduceFraction(numerator, this.magnitude);
  }

  advance(): void {
    this.boundary += this.step;
  }
}

function* factorAtParameter(
  snapshot: TerrainSnapshot,
  fog: FogMap,
  start: Point,
  delta: Point,
  parameter: Fraction,
): Generator<PlannerSignal, bigint, void> {
  const xNumerator = start.x * parameter.denominator + delta.x * parameter.numerator;
  const yNumerator = start.y * parameter.denominator + delta.y * parameter.numerator;
  const scaled = parameter.denominator * NAV_UNITS_PER_TILE;
  const tileX = floorDiv(xNumerator, scaled);
  const tileY = floorDiv(yNumerator, scaled);
  const candidates: Array<readonly [bigint, bigint]> = [[tileX, tileY]];
  if (delta.x === 0n && start.x % NAV_UNITS_PER_TILE === 0n) candidates.push([tileX - 1n, tileY]);
  if (delta.y === 0n && start.y % NAV_UNITS_PER_TILE === 0n) candidates.push([tileX, tileY - 1n]);
  if (candidates.length === 3) candidates.push([tileX - 1n, tileY - 1n]);
  let factor = 0n;
  for (const [candidateX, candidateY] of candidates) {
    if (!isRevealed(fog, candidateX, candidateY)) throw new Error("route cost cannot read unrevealed terrain");
    const terrainId = yield* terrainAt(snapshot, candidateX, candidateY);
    if (!isPassableBaseTerrain(terrainId)) throw new Error("route cost crossed blocked terrain");
    const candidateFactor = TERRAIN_FACTORS[terrainId]!;
    if (candidateFactor > factor) factor = candidateFactor;
  }
  return factor;
}

export function* segmentProfile(
  snapshot: TerrainSnapshot,
  fog: FogMap,
  start: Point,
  end: Point,
): Generator<PlannerSignal, SegmentProfile, void> {
  const delta = { x: end.x - start.x, y: end.y - start.y };
  const startContract = canonicalPoint(start.x, start.y);
  const endContract = canonicalPoint(end.x, end.y);
  if (delta.x === 0n && delta.y === 0n) {
    return { start: startContract, end: endContract, runs: [], boundaryParameters: [], cost: 0n };
  }
  const xBoundaries = new BoundaryCursor(start.x, end.x);
  const yBoundaries = new BoundaryCursor(start.y, end.y);
  const zero = { numerator: 0n, denominator: 1n };
  const one = { numerator: 1n, denominator: 1n };
  let cost = 0n;
  let intervalStart = zero;
  let runStart = zero;
  let runEnd = zero;
  let runFactor: bigint | null = null;
  const runs: TerrainCostRun[] = [];
  const boundaries: Rational[] = [];

  function settleRun(): void {
    if (runFactor === null || compareFraction(runStart, runEnd) === 0) return;
    const numerator = runEnd.numerator * runStart.denominator - runStart.numerator * runEnd.denominator;
    const denominator = runEnd.denominator * runStart.denominator;
    const length = ceilDiv(ceilSqrt((delta.x * delta.x + delta.y * delta.y) * numerator * numerator), denominator);
    const runCost = ceilDiv(length * runFactor, 1000n);
    runs.push({
      startParameter: runStart,
      endParameter: runEnd,
      terrainFactor: runFactor,
      cost: runCost,
      cumulativeCostBefore: cost,
    });
    cost += runCost;
  }

  while (compareFraction(intervalStart, one) < 0) {
    // This is deliberately the first work in every boundary interval. A host can
    // therefore pause even a segment spanning the full coordinate range without
    // an eager crossing array allocation or scan.
    yield { kind: "operation" };
    const xBoundary = xBoundaries.peek();
    const yBoundary = yBoundaries.peek();
    let intervalEnd = one;
    if (xBoundary !== null && compareFraction(xBoundary, intervalEnd) < 0) intervalEnd = xBoundary;
    if (yBoundary !== null && compareFraction(yBoundary, intervalEnd) < 0) intervalEnd = yBoundary;
    const intervalFactor = yield* factorAtParameter(snapshot, fog, start, delta, reduceFraction(
      intervalStart.numerator * intervalEnd.denominator + intervalEnd.numerator * intervalStart.denominator,
      2n * intervalStart.denominator * intervalEnd.denominator,
    ));

    if (runFactor === null) {
      runFactor = intervalFactor;
      runStart = intervalStart;
    } else if (intervalFactor !== runFactor) {
      settleRun();
      runStart = intervalStart;
      runFactor = intervalFactor;
    }
    runEnd = intervalEnd;

    if (xBoundary !== null && compareFraction(xBoundary, intervalEnd) === 0) xBoundaries.advance();
    if (yBoundary !== null && compareFraction(yBoundary, intervalEnd) === 0) yBoundaries.advance();
    if (compareFraction(intervalEnd, one) < 0) boundaries.push(intervalEnd);
    intervalStart = intervalEnd;
  }
  settleRun();
  return { start: startContract, end: endContract, runs, boundaryParameters: boundaries, cost };
}

export function* segmentCost(
  snapshot: TerrainSnapshot,
  fog: FogMap,
  start: Point,
  end: Point,
): Generator<PlannerSignal, bigint, void> {
  return (yield* segmentProfile(snapshot, fog, start, end)).cost;
}

function cross(a: Point, b: Point, c: Point): bigint {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point, b: Point, point: Point): boolean {
  return point.x >= (a.x < b.x ? a.x : b.x) && point.x <= (a.x > b.x ? a.x : b.x)
    && point.y >= (a.y < b.y ? a.y : b.y) && point.y <= (a.y > b.y ? a.y : b.y) && cross(a, b, point) === 0n;
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (((abC < 0n && abD > 0n) || (abC > 0n && abD < 0n)) && ((cdA < 0n && cdB > 0n) || (cdA > 0n && cdB < 0n))) return true;
  return (abC === 0n && onSegment(a, b, c)) || (abD === 0n && onSegment(a, b, d))
    || (cdA === 0n && onSegment(c, d, a)) || (cdB === 0n && onSegment(c, d, b));
}

function pointNearSegment(point: Point, start: Point, end: Point, radius: bigint): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const px = point.x - start.x;
  const py = point.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0n) return px * px + py * py <= radius * radius;
  const projection = px * dx + py * dy;
  if (projection <= 0n) return px * px + py * py <= radius * radius;
  if (projection >= lengthSquared) {
    const ex = point.x - end.x;
    const ey = point.y - end.y;
    return ex * ex + ey * ey <= radius * radius;
  }
  const area = px * dy - py * dx;
  return area * area <= radius * radius * lengthSquared;
}

function endpointNearRectangle(point: Point, minX: bigint, minY: bigint, maxX: bigint, maxY: bigint): boolean {
  const closestX = point.x < minX ? minX : point.x > maxX ? maxX : point.x;
  const closestY = point.y < minY ? minY : point.y > maxY ? maxY : point.y;
  const dx = point.x - closestX;
  const dy = point.y - closestY;
  return dx * dx + dy * dy <= PLAYER_RADIUS_NAV_UNITS * PLAYER_RADIUS_NAV_UNITS;
}

function capsuleTouchesTile(start: Point, end: Point, tileX: bigint, tileY: bigint): boolean {
  const minX = tileX * NAV_UNITS_PER_TILE;
  const minY = tileY * NAV_UNITS_PER_TILE;
  const maxX = minX + NAV_UNITS_PER_TILE;
  const maxY = minY + NAV_UNITS_PER_TILE;
  const corners = [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }] as const;
  if (endpointNearRectangle(start, minX, minY, maxX, maxY) || endpointNearRectangle(end, minX, minY, maxX, maxY)) return true;
  for (const corner of corners) if (pointNearSegment(corner, start, end, PLAYER_RADIUS_NAV_UNITS)) return true;
  for (let index = 0; index < 4; index += 1) if (segmentsIntersect(start, end, corners[index]!, corners[(index + 1) % 4]!)) return true;
  return false;
}

function* centerlineSupercover(start: Point, end: Point): Generator<Point, void, void> {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const stepX = deltaX < 0n ? -1n : deltaX > 0n ? 1n : 0n;
  const stepY = deltaY < 0n ? -1n : deltaY > 0n ? 1n : 0n;
  const magnitudeX = deltaX < 0n ? -deltaX : deltaX;
  const magnitudeY = deltaY < 0n ? -deltaY : deltaY;
  let tileX = tileCoordinate(start.x);
  let tileY = tileCoordinate(start.y);
  const endTileX = tileCoordinate(end.x);
  const endTileY = tileCoordinate(end.y);
  yield { x: tileX, y: tileY };

  while (tileX !== endTileX || tileY !== endTileY) {
    const boundaryX = stepX > 0n ? (tileX + 1n) * NAV_UNITS_PER_TILE : tileX * NAV_UNITS_PER_TILE;
    const boundaryY = stepY > 0n ? (tileY + 1n) * NAV_UNITS_PER_TILE : tileY * NAV_UNITS_PER_TILE;
    const xParameter = stepX === 0n ? null : reduceFraction(
      stepX > 0n ? boundaryX - start.x : start.x - boundaryX,
      magnitudeX,
    );
    const yParameter = stepY === 0n ? null : reduceFraction(
      stepY > 0n ? boundaryY - start.y : start.y - boundaryY,
      magnitudeY,
    );
    const comparison = xParameter === null ? 1 : yParameter === null ? -1 : compareFraction(xParameter, yParameter);
    if (comparison < 0) {
      tileX += stepX;
      yield { x: tileX, y: tileY };
    } else if (comparison > 0) {
      tileY += stepY;
      yield { x: tileX, y: tileY };
    } else {
      // A corner touch belongs to both orthogonal supercover cells as well as
      // the diagonal cell. Collision therefore cannot slip between blockers.
      yield { x: tileX + stepX, y: tileY };
      yield { x: tileX, y: tileY + stepY };
      tileX += stepX;
      tileY += stepY;
      yield { x: tileX, y: tileY };
    }
  }
}

export type LineOfSight = "clear" | "blocked" | "unknown";

export function* lineOfSight(
  snapshot: TerrainSnapshot,
  fog: FogMap,
  start: Point,
  end: Point,
): Generator<PlannerSignal, LineOfSight, void> {
  let touchesUnknown = false;
  const visited = new Set<string>();
  for (const centerlineTile of centerlineSupercover(start, end)) {
    for (let offsetY = -1n; offsetY <= 1n; offsetY += 1n) {
      for (let offsetX = -1n; offsetX <= 1n; offsetX += 1n) {
        const tileX = centerlineTile.x + offsetX;
        const tileY = centerlineTile.y + offsetY;
        if (!isTileCoordinateInBounds(tileX) || !isTileCoordinateInBounds(tileY)) {
          if (capsuleTouchesTile(start, end, tileX, tileY)) return "blocked";
          continue;
        }
        const key = nodeKey(tileX, tileY);
        if (visited.has(key)) continue;
        visited.add(key);
      yield { kind: "operation" };
      if (!capsuleTouchesTile(start, end, tileX, tileY)) continue;
      if (!isRevealed(fog, tileX, tileY)) {
        touchesUnknown = true;
        continue;
      }
      if (!isPassableBaseTerrain(yield* terrainAt(snapshot, tileX, tileY))) return "blocked";
      }
    }
  }
  return touchesUnknown ? "unknown" : "clear";
}

type SearchNode = {
  key: string;
  x: bigint;
  y: bigint;
  g: bigint;
  f: bigint;
  parentKey: string | null;
  parentX: bigint;
  parentY: bigint;
  incomingProfile: SegmentProfile;
  revision: number;
  closed: boolean;
};

type HeapEntry = Readonly<{
  node: SearchNode;
  revision: number;
  f: bigint;
  g: bigint;
  x: bigint;
  y: bigint;
  parentKey: string | null;
  parentX: bigint;
  parentY: bigint;
}>;

function compareParentCoordinates(leftX: bigint, leftY: bigint, rightX: bigint, rightY: bigint): number {
  if (leftY !== rightY) return leftY < rightY ? -1 : 1;
  return leftX < rightX ? -1 : leftX > rightX ? 1 : 0;
}

function compareEntry(left: HeapEntry, right: HeapEntry): number {
  if (left.f !== right.f) return left.f < right.f ? -1 : 1;
  if (left.g !== right.g) return left.g < right.g ? -1 : 1;
  if (left.y !== right.y) return left.y < right.y ? -1 : 1;
  if (left.x !== right.x) return left.x < right.x ? -1 : 1;
  return compareParentCoordinates(left.parentX, left.parentY, right.parentX, right.parentY);
}

function heapEntry(node: SearchNode): HeapEntry {
  return {
    node,
    revision: node.revision,
    f: node.f,
    g: node.g,
    x: node.x,
    y: node.y,
    parentKey: node.parentKey,
    parentX: node.parentX,
    parentY: node.parentY,
  };
}

class OpenHeap {
  private readonly entries: HeapEntry[] = [];

  get length(): number { return this.entries.length; }

  push(entry: HeapEntry): void {
    this.entries.push(entry);
    let index = this.entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareEntry(this.entries[parent]!, entry) <= 0) break;
      this.entries[index] = this.entries[parent]!;
      index = parent;
    }
    this.entries[index] = entry;
  }

  pop(): HeapEntry | undefined {
    const first = this.entries[0];
    const last = this.entries.pop();
    if (first === undefined || last === undefined || this.entries.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.entries.length) break;
      let child = left;
      if (right < this.entries.length && compareEntry(this.entries[right]!, this.entries[left]!) < 0) child = right;
      if (compareEntry(last, this.entries[child]!) <= 0) break;
      this.entries[index] = this.entries[child]!;
      index = child;
    }
    this.entries[index] = last;
    return first;
  }

  peekValid(): SearchNode | undefined {
    while (this.entries.length > 0) {
      const entry = this.entries[0]!;
      if (entry.node.revision === entry.revision && !entry.node.closed) return entry.node;
      this.pop();
    }
    return undefined;
  }
}

function nodeKey(x: bigint, y: bigint): string {
  return `${x},${y}`;
}

function heuristic(x: bigint, y: bigint, destination: Point | null): bigint {
  return destination === null ? 0n : euclideanLength(tileCenter(x) - destination.x, tileCenter(y) - destination.y);
}

function* coversUnknown(fog: FogMap, x: bigint, y: bigint, radiusTiles: number): Generator<PlannerSignal, boolean, void> {
  const centerX = tileCenter(x);
  const centerY = tileCenter(y);
  const radius = BigInt(radiusTiles) * NAV_UNITS_PER_TILE;
  const radiusSquared = radius * radius;
  for (let offsetY = -radiusTiles - 1; offsetY <= radiusTiles + 1; offsetY += 1) {
    for (let offsetX = -radiusTiles - 1; offsetX <= radiusTiles + 1; offsetX += 1) {
      yield { kind: "operation" };
      const checkX = x + BigInt(offsetX);
      const checkY = y + BigInt(offsetY);
      if (!isTileCoordinateInBounds(checkX) || !isTileCoordinateInBounds(checkY)) continue;
      const dx = tileCenter(checkX) - centerX;
      const dy = tileCenter(checkY) - centerY;
      if (dx * dx + dy * dy <= radiusSquared && !isRevealed(fog, checkX, checkY)) return true;
    }
  }
  return false;
}

function directRoute(start: WorldPoint, endpoint: WorldPoint, profile: SegmentProfile): RoutePlan {
  if (start.x === endpoint.x && start.y === endpoint.y) {
    if (profile.cost !== 0n) throw new Error("zero-length route cannot have non-zero cost");
    return { points: [start], legCosts: [], legProfiles: [], cost: 0n };
  }
  return { points: [start, endpoint], legCosts: [profile.cost], legProfiles: [profile], cost: profile.cost };
}

function reconstruct(
  nodes: Map<string, SearchNode>,
  node: SearchNode,
  start: WorldPoint,
  totalCost: bigint,
  endpoint: WorldPoint,
  endpointProfile: SegmentProfile | null,
): RoutePlan {
  const reversedNodes: SearchNode[] = [];
  let cursor: SearchNode | undefined = node;
  while (cursor !== undefined) {
    reversedNodes.push(cursor);
    cursor = cursor.parentKey === null ? undefined : nodes.get(cursor.parentKey);
    if (cursor === undefined && reversedNodes.at(-1)!.parentKey !== null) throw new Error("navigation parent is missing");
  }
  const chain = reversedNodes.reverse();
  const points: WorldPoint[] = [start];
  const legCosts: bigint[] = [];
  const legProfiles: SegmentProfile[] = [];
  let previousCost = 0n;
  const appendPoint = (point: WorldPoint, cumulativeCost: bigint, profile: SegmentProfile): void => {
    const previousPoint = points.at(-1)!;
    const legCost = cumulativeCost - previousCost;
    if (point.x === previousPoint.x && point.y === previousPoint.y) {
      if (legCost !== 0n) throw new Error("duplicate route point has non-zero cost");
    } else {
      points.push(point);
      legCosts.push(legCost);
      if (profile.cost !== legCost) throw new Error("route profile cost does not match cumulative search cost");
      legProfiles.push(profile);
    }
    previousCost = cumulativeCost;
  };
  for (const pathNode of chain) {
    appendPoint(canonicalPoint(tileCenter(pathNode.x), tileCenter(pathNode.y)), pathNode.g, pathNode.incomingProfile);
  }
  if (endpointProfile !== null) appendPoint(endpoint, totalCost, endpointProfile);
  else if (points.at(-1)?.x !== endpoint.x || points.at(-1)?.y !== endpoint.y) throw new Error("frontier endpoint is not the selected node");
  if (previousCost !== totalCost) throw new Error("route reconstruction did not account for total cost");
  return { points, legCosts, legProfiles, cost: totalCost };
}

type Candidate = Readonly<{
  node: SearchNode | null;
  cost: bigint;
  lowerBound: bigint;
  endpoint: WorldPoint;
  endpointProfile: SegmentProfile | null;
}>;

function compareCandidate(left: Candidate, right: Candidate): number {
  const leftScore = left.cost + left.lowerBound;
  const rightScore = right.cost + right.lowerBound;
  if (leftScore !== rightScore) return leftScore < rightScore ? -1 : 1;
  if (left.lowerBound !== right.lowerBound) return left.lowerBound < right.lowerBound ? -1 : 1;
  if (left.cost !== right.cost) return left.cost < right.cost ? -1 : 1;
  const leftY = left.node?.y ?? tileCoordinate(BigInt(left.endpoint.y));
  const rightY = right.node?.y ?? tileCoordinate(BigInt(right.endpoint.y));
  if (leftY !== rightY) return leftY < rightY ? -1 : 1;
  const leftX = left.node?.x ?? tileCoordinate(BigInt(left.endpoint.x));
  const rightX = right.node?.x ?? tileCoordinate(BigInt(right.endpoint.x));
  return leftX < rightX ? -1 : leftX > rightX ? 1 : 0;
}

function* planGenerator(
  snapshot: TerrainSnapshot,
  fog: FogMap,
  startContract: WorldPoint,
  observationRadiusTiles: number,
  destinationContract: WorldPoint | null,
): Generator<PlannerSignal, PlanFinal, void> {
  const start = pointFromContract(startContract);
  const destination = destinationContract === null ? null : pointFromContract(destinationContract);
  const destinationTileX = destination === null ? null : tileCoordinate(destination.x);
  const destinationTileY = destination === null ? null : tileCoordinate(destination.y);
  const destinationRevealed = destinationTileX !== null && destinationTileY !== null && isRevealed(fog, destinationTileX, destinationTileY);
  const destinationClearance = destinationRevealed ? yield* lineOfSight(snapshot, fog, destination!, destination!) : "unknown";
  if (destinationRevealed && destinationClearance === "blocked") {
    return { kind: "destination-unreachable", destination: destinationContract! };
  }
  const destinationKnown = destinationRevealed && destinationClearance === "clear";

  let best: Candidate | null = null;
  if (destinationKnown) {
    const directVisibility = yield* lineOfSight(snapshot, fog, start, destination!);
    if (directVisibility === "clear") {
      const profile = yield* segmentProfile(snapshot, fog, start, destination!);
      if (profile.cost === 0n) return { kind: "route", plan: directRoute(startContract, destinationContract!, profile) };
      best = { node: null, cost: profile.cost, lowerBound: 0n, endpoint: destinationContract!, endpointProfile: profile };
    }
  }

  const heuristicDestination = destinationContract !== null ? destination : null;
  const nodes = new Map<string, SearchNode>();
  const open = new OpenHeap();
  const startTileX = tileCoordinate(start.x);
  const startTileY = tileCoordinate(start.y);

  for (let offsetY = -1n; offsetY <= 1n; offsetY += 1n) {
    for (let offsetX = -1n; offsetX <= 1n; offsetX += 1n) {
      const x = startTileX + offsetX;
      const y = startTileY + offsetY;
      if (!isTileCoordinateInBounds(x) || !isTileCoordinateInBounds(y)) continue;
      if (!isRevealed(fog, x, y)) continue;
      if (!isPassableBaseTerrain(yield* terrainAt(snapshot, x, y))) continue;
      const point = { x: tileCenter(x), y: tileCenter(y) };
      if ((yield* lineOfSight(snapshot, fog, start, point)) !== "clear") continue;
      const incomingProfile = yield* segmentProfile(snapshot, fog, start, point);
      const g = incomingProfile.cost;
      const node: SearchNode = {
        key: nodeKey(x, y), x, y, g, f: g + heuristic(x, y, heuristicDestination),
        parentKey: null, parentX: start.x, parentY: start.y, incomingProfile, revision: 0, closed: false,
      };
      const existing = nodes.get(node.key);
      if (existing !== undefined && existing.g <= g) continue;
      nodes.set(node.key, node);
      open.push(heapEntry(node));
    }
  }

  while (open.length > 0) {
    const next = open.peekValid();
    if (next === undefined) break;
    if (best !== null && next.f > best.cost + best.lowerBound) break;
    const entry = open.pop()!;
    const current = entry.node;
    if (entry.revision !== current.revision || current.closed) continue;
    current.closed = true;
    yield { kind: "operation" };
    const currentPoint = { x: tileCenter(current.x), y: tileCenter(current.y) };

    if (destinationKnown) {
      if ((yield* lineOfSight(snapshot, fog, currentPoint, destination!)) === "clear") {
        const endpointProfile = yield* segmentProfile(snapshot, fog, currentPoint, destination!);
        const finalCost = current.g + endpointProfile.cost;
        const candidate: Candidate = { node: current, cost: finalCost, lowerBound: 0n, endpoint: destinationContract!, endpointProfile };
        if (best === null || compareCandidate(candidate, best) < 0) best = candidate;
      }
    } else if (yield* coversUnknown(fog, current.x, current.y, observationRadiusTiles)) {
      const lowerBound = destination === null ? 0n : euclideanLength(destination.x - currentPoint.x, destination.y - currentPoint.y);
      const candidate: Candidate = {
        node: current,
        cost: current.g,
        lowerBound,
        endpoint: canonicalPoint(currentPoint.x, currentPoint.y),
        endpointProfile: null,
      };
      if (best === null || compareCandidate(candidate, best) < 0) best = candidate;
    }

    for (const [offsetX, offsetY] of NEIGHBOR_OFFSETS) {
      const x = current.x + offsetX;
      const y = current.y + offsetY;
      if (!isTileCoordinateInBounds(x) || !isTileCoordinateInBounds(y)) continue;
      if (!isRevealed(fog, x, y)) continue;
      if (!isPassableBaseTerrain(yield* terrainAt(snapshot, x, y))) continue;
      const nextPoint = { x: tileCenter(x), y: tileCenter(y) };
      if ((yield* lineOfSight(snapshot, fog, currentPoint, nextPoint)) !== "clear") continue;

      let parentKey: string | null = current.key;
      let parentX = currentPoint.x;
      let parentY = currentPoint.y;
      let incomingProfile = yield* segmentProfile(snapshot, fog, currentPoint, nextPoint);
      let candidateCost = current.g + incomingProfile.cost;
      const parent = current.parentKey === null ? null : nodes.get(current.parentKey);
      const thetaPoint = parent === undefined || parent === null ? start : { x: tileCenter(parent.x), y: tileCenter(parent.y) };
      const thetaBaseCost = parent?.g ?? 0n;
      if ((yield* lineOfSight(snapshot, fog, thetaPoint, nextPoint)) === "clear") {
        const thetaProfile = yield* segmentProfile(snapshot, fog, thetaPoint, nextPoint);
        const thetaCost = thetaBaseCost + thetaProfile.cost;
        if (thetaCost < candidateCost || (thetaCost === candidateCost
          && compareParentCoordinates(thetaPoint.x, thetaPoint.y, parentX, parentY) < 0)) {
          candidateCost = thetaCost;
          parentKey = current.parentKey;
          parentX = thetaPoint.x;
          parentY = thetaPoint.y;
          incomingProfile = thetaProfile;
        }
      }

      const key = nodeKey(x, y);
      const existing = nodes.get(key);
      if (existing !== undefined && (existing.g < candidateCost || (existing.g === candidateCost
        && compareParentCoordinates(existing.parentX, existing.parentY, parentX, parentY) <= 0))) continue;
      // Stable open ordering makes the chosen parent final when a vertex closes.
      // Reopening a closed vertex for an equal-cost parent can create zero-cost
      // parent cycles without improving the route.
      if (existing !== undefined && existing.closed && existing.g <= candidateCost) continue;
      const node = existing ?? {
        key, x, y, g: candidateCost, f: 0n, parentKey, parentX, parentY, incomingProfile, revision: 0, closed: false,
      };
      node.g = candidateCost;
      node.f = candidateCost + heuristic(x, y, heuristicDestination);
      node.parentKey = parentKey;
      node.parentX = parentX;
      node.parentY = parentY;
      node.incomingProfile = incomingProfile;
      node.closed = false;
      node.revision += 1;
      nodes.set(key, node);
      open.push(heapEntry(node));
    }
  }

  if (best !== null) {
    const route = best.node === null
      ? directRoute(startContract, best.endpoint, best.endpointProfile!)
      : reconstruct(nodes, best.node, startContract, best.cost, best.endpoint, best.endpointProfile);
    return { kind: "route", plan: route };
  }
  return destinationKnown
    ? { kind: "destination-unreachable", destination: destinationContract! }
    : { kind: "no-reachable-frontier" };
}

export class PlannerStepper {
  private readonly generator: Generator<PlannerSignal, PlanFinal, void>;
  private final: PlanFinal | null = null;

  constructor(
    snapshot: TerrainSnapshot,
    fog: FogMap,
    start: WorldPoint,
    observationRadiusTiles: number,
    destination: WorldPoint | null,
  ) {
    this.generator = planGenerator(snapshot, fog, start, observationRadiusTiles, destination);
  }

  step(maxOperations: number): PlanResult {
    if (!Number.isInteger(maxOperations) || maxOperations < 1) throw new RangeError("planner operation budget must be a positive integer");
    if (this.final !== null) return this.final;
    let operations = 0;
    while (operations < maxOperations) {
      const result = this.generator.next();
      if (result.done) {
        this.final = result.value;
        return result.value;
      }
      if (result.value.kind === "terrain-required") return result.value;
      operations += 1;
    }
    return { kind: "yield" };
  }
}

export function etaForCost(cost: bigint): bigint {
  return ceilDiv(cost * 1000n, BASE_MOVE_SPEED_NAV_PER_SECOND);
}

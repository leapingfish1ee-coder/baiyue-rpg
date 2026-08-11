import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { canonicalJson, compareCodePoints } from "../src/gameplay/canonical-json.ts";
import { ambientPlacementCandidate, authoritativeGatherDuration, contentCellForTile } from "../src/gameplay/content.ts";
import { GameplayEngine } from "../src/gameplay/engine.ts";
import { revealObservation, revealTile, revealedTiles } from "../src/gameplay/fog.ts";
import { selectIntersectingCircleByStableId, sweptSegmentIntersectsCircle } from "../src/gameplay/geometry.ts";
import { ceilSqrt, floorDiv, observationRadius, roundDivNearestEven, tileCenter, tileCoordinate, xpAtLevelStart, xpForNextLevel } from "../src/gameplay/math.ts";
import { pointAtParameter, positionAtElapsedMs } from "../src/gameplay/motion.ts";
import { PlannerStepper, TerrainPayloadError, TerrainSnapshot, lineOfSight, segmentCost, segmentProfile } from "../src/gameplay/navigation.ts";
import {
  CHUNK_COORDINATE_MAX,
  CHUNK_COORDINATE_MIN,
  TILE_COORDINATE_MAX,
  TILE_COORDINATE_MIN,
  WORLD_POINT_NAV_MAX,
  WORLD_POINT_NAV_MIN,
  compareChunkKeysNumeric,
  isTileCoordinateInBounds,
} from "../src/world-contract.ts";

test("canonical JSON uses code-point keys and rejects non-canonical numbers and Unicode", () => {
  assert.equal(canonicalJson({ "𐀀": 2, "": 1 }), "{\"\":1,\"𐀀\":2}");
  assert.throws(() => canonicalJson(-0), /canonical safe integers/);
  assert.throws(() => canonicalJson("\ud800"), /lone high surrogate/);
  assert.throws(() => canonicalJson({ "\udc00": 1 }), /lone low surrogate/);
  const sparse = [];
  sparse.length = 1;
  assert.throws(() => canonicalJson(sparse), /sparse arrays/);
});

test("fixed-point math and exact rational XP curve are stable at boundaries", () => {
  assert.equal(ceilSqrt(0n), 0n);
  assert.equal(ceilSqrt(2n), 2n);
  assert.equal(ceilSqrt(9n), 3n);
  assert.equal(roundDivNearestEven(1n, 2n), 0n);
  assert.equal(roundDivNearestEven(3n, 2n), 2n);
  assert.equal(roundDivNearestEven(-1n, 2n), 0n);
  assert.equal(roundDivNearestEven(-3n, 2n), -2n);
  const curve = Array.from({ length: 99 }, (_, index) => xpForNextLevel(index + 1));
  assert.deepEqual(curve.slice(0, 12), [100, 112, 125, 140, 157, 176, 197, 221, 248, 277, 311, 348]);
  assert.equal(createHash("sha256").update(curve.join(",")).digest("hex"), "7108c68e0dfcfa0be8fdc0cfc1d67cacffcf4c89f724219084826c464dbde173");
  assert.equal(xpAtLevelStart(100), 62_143_714);
  assert.equal(observationRadius(1), 4);
  assert.equal(observationRadius(100), 13);
  for (const invalid of [0, 101, 1.5]) {
    assert.throws(() => xpForNextLevel(invalid), /1\.\.100/);
    assert.throws(() => xpAtLevelStart(invalid), /1\.\.100/);
    assert.throws(() => observationRadius(invalid), /1\.\.100/);
  }
});

test("chunk keys sort by numeric y/x and reject non-canonical forms", () => {
  assert.deepEqual(["10,-2", "-1,-2", "0,1", "2,-10"].sort(compareChunkKeysNumeric), ["2,-10", "-1,-2", "10,-2", "0,1"]);
  for (const invalid of ["1,2,3", "01,2", "-0,2", "1", "x,2"]) {
    assert.throws(() => compareChunkKeysNumeric(invalid, "0,0"), /canonical decimal/);
  }
});

function provideLand(snapshot, request) {
  snapshot.provideChunk(request.chunkX, request.chunkY, new Uint8Array(4096).fill(3));
}

function runPlanner(stepper, snapshot) {
  let yields = 0;
  for (let iteration = 0; iteration < 200_000; iteration += 1) {
    const result = stepper.step(32);
    if (result.kind === "terrain-required") {
      provideLand(snapshot, result);
      continue;
    }
    if (result.kind === "yield") {
      yields += 1;
      continue;
    }
    return { result, yields };
  }
  throw new Error("planner fixture exceeded deterministic operation budget");
}

function runSegment(generator, snapshot) {
  let input;
  for (let iteration = 0; iteration < 200_000; iteration += 1) {
    const step = generator.next(input);
    input = undefined;
    if (step.done) return step.value;
    if (step.value.kind === "terrain-required") provideLand(snapshot, step.value);
  }
  throw new Error("segment fixture exceeded deterministic operation budget");
}

function runNavigationGenerator(generator, snapshot, terrainByTile = new Map()) {
  for (let iteration = 0; iteration < 200_000; iteration += 1) {
    const step = generator.next();
    if (step.done) return step.value;
    if (step.value.kind !== "terrain-required") continue;
    const bytes = new Uint8Array(4096).fill(3);
    const chunkX = BigInt(step.value.chunkX);
    const chunkY = BigInt(step.value.chunkY);
    for (const [key, terrain] of terrainByTile) {
      const [tileXText, tileYText] = key.split(",");
      const tileX = BigInt(tileXText);
      const tileY = BigInt(tileYText);
      if (floorDiv(tileX, 64n) !== chunkX || floorDiv(tileY, 64n) !== chunkY) continue;
      const localX = Number(tileX - chunkX * 64n);
      const localY = Number(tileY - chunkY * 64n);
      bytes[localY * 64 + localX] = terrain;
    }
    snapshot.provideChunk(step.value.chunkX, step.value.chunkY, bytes);
  }
  throw new Error("navigation generator exceeded deterministic operation budget");
}

function revealedRectangle(minX, maxX, minY, maxY) {
  const fog = new Map();
  for (let y = minY; y <= maxY; y += 1n) for (let x = minX; x <= maxX; x += 1n) revealTile(fog, x, y);
  return fog;
}

test("(t-1,t] swept segment detects pass-through, tangent, open-start, and stable same-ms circle choice", () => {
  const start = { x: -10n, y: 0n };
  const end = { x: 10n, y: 0n };
  assert.equal(sweptSegmentIntersectsCircle(start, end, { x: 0n, y: 0n }, 2n), true,
    "both integer-ms endpoints are outside but the interior crosses the circle");
  assert.equal(sweptSegmentIntersectsCircle(start, end, { x: 0n, y: 2n }, 2n), true, "tangent contact counts");
  assert.equal(sweptSegmentIntersectsCircle(start, end, { x: 0n, y: 3n }, 2n), false);
  assert.equal(sweptSegmentIntersectsCircle({ x: 2n, y: 0n }, { x: 3n, y: 0n }, { x: 0n, y: 0n }, 2n), false,
    "a sole contact at excluded t-1 does not trigger");
  const candidates = [
    { id: "enc:2", center: { x: 1n, y: 0n }, radius: 2n },
    { id: "enc:1", center: { x: -1n, y: 0n }, radius: 2n },
  ];
  assert.equal(selectIntersectingCircleByStableId(start, end, candidates, compareCodePoints)?.id, "enc:1");
});

test("swept-circle clearance blocks Water, DeepWater, corner cutting, and mirrored negative coordinates", () => {
  for (const terrainId of [0, 1]) {
    const fog = revealedRectangle(-1n, 3n, -1n, 1n);
    const snapshot = new TerrainSnapshot();
    const result = runNavigationGenerator(lineOfSight(snapshot, fog, { x: 512n, y: 512n }, { x: 2560n, y: 512n }), snapshot,
      new Map([["1,0", terrainId]]));
    assert.equal(result, "blocked", `terrain ${terrainId}`);
  }

  for (const sign of [1n, -1n]) {
    const start = sign > 0n ? { x: 512n, y: 512n } : { x: -512n, y: -512n };
    const end = sign > 0n ? { x: 1536n, y: 1536n } : { x: -1536n, y: -1536n };
    const blocks = sign > 0n ? new Map([["1,0", 1], ["0,1", 1]]) : new Map([["-2,-1", 1], ["-1,-2", 1]]);
    const fog = revealedRectangle(-3n, 2n, -3n, 2n);
    const snapshot = new TerrainSnapshot();
    assert.equal(runNavigationGenerator(lineOfSight(snapshot, fog, start, end), snapshot, blocks), "blocked");
  }
});

test("chunk seam uses one continuous LOS, cost, observation, and numeric request order", () => {
  const fog = revealedRectangle(61n, 66n, -2n, 2n);
  const snapshot = new TerrainSnapshot();
  const requests = [];
  const generator = lineOfSight(snapshot, fog, { x: tileCenter(63n), y: 512n }, { x: tileCenter(64n), y: 512n });
  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    const step = generator.next();
    if (step.done) { assert.equal(step.value, "clear"); break; }
    if (step.value.kind === "terrain-required") {
      requests.push(step.value.chunkKey);
      snapshot.provideChunk(step.value.chunkX, step.value.chunkY, new Uint8Array(4096).fill(3));
    }
  }
  assert.deepEqual([...requests].sort(compareChunkKeysNumeric), requests);
  assert.equal(runSegment(segmentCost(snapshot, fog, { x: tileCenter(63n), y: 512n }, { x: tileCenter(64n), y: 512n }), snapshot), 1024n);
  const observation = revealObservation(new Map(), 64n * 1024n, 512n, 4);
  assert.deepEqual(observation.touchedChunkKeys, ["0,-1", "1,-1", "0,0", "1,0"]);
});

test("fog, navigation, and chunk input enforce the phase-1 coordinate extrema", () => {
  assert.equal(tileCoordinate(WORLD_POINT_NAV_MIN), TILE_COORDINATE_MIN);
  assert.equal(tileCoordinate(WORLD_POINT_NAV_MAX), TILE_COORDINATE_MAX);
  assert.throws(() => tileCoordinate(WORLD_POINT_NAV_MIN - 1n), /outside/);
  assert.throws(() => tileCenter(TILE_COORDINATE_MAX + 1n), /outside/);
  const fog = new Map();
  revealObservation(fog, WORLD_POINT_NAV_MIN, WORLD_POINT_NAV_MIN, 4);
  revealObservation(fog, WORLD_POINT_NAV_MAX, WORLD_POINT_NAV_MAX, 4);
  assert.ok([...revealedTiles(fog)].every((tile) => isTileCoordinateInBounds(tile.x) && isTileCoordinateInBounds(tile.y)));
  const snapshot = new TerrainSnapshot();
  assert.throws(() => snapshot.provideChunk((CHUNK_COORDINATE_MIN - 1n).toString(), "0", new Uint8Array(4096).fill(3)), TerrainPayloadError);
  assert.throws(() => snapshot.provideChunk((CHUNK_COORDINATE_MAX + 1n).toString(), "0", new Uint8Array(4096).fill(3)), TerrainPayloadError);

  const edgeFog = new Map();
  revealTile(edgeFog, TILE_COORDINATE_MIN, TILE_COORDINATE_MIN);
  const edgeSnapshot = new TerrainSnapshot();
  const boundaryPoint = { x: WORLD_POINT_NAV_MIN, y: WORLD_POINT_NAV_MIN };
  assert.equal(runNavigationGenerator(lineOfSight(edgeSnapshot, edgeFog, boundaryPoint, boundaryPoint), edgeSnapshot), "blocked",
    "a player circle cannot extend beyond the world boundary");
});

test("planner is resumable, requests terrain explicitly, and reaches an exact non-45-degree destination", () => {
  const fog = new Map();
  revealObservation(fog, 512n, 512n, 4);
  const snapshot = new TerrainSnapshot();
  const destination = { x: "2500", y: "1800" };
  const stepper = new PlannerStepper(snapshot, fog, { x: "512", y: "512" }, 4, destination);
  const { result, yields } = runPlanner(stepper, snapshot);
  assert.equal(result.kind, "route");
  assert.ok(yields > 0);
  assert.deepEqual(result.plan.points.at(-1), destination);
  const before = result.plan.points.at(-2);
  assert.ok(before);
  const dx = BigInt(destination.x) - BigInt(before.x);
  const dy = BigInt(destination.y) - BigInt(before.y);
  assert.notEqual(dx < 0n ? -dx : dx, dy < 0n ? -dy : dy, "last heading must not be constrained to 45 degrees");
  assert.equal(result.plan.legCosts.reduce((sum, cost) => sum + cost, 0n), result.plan.cost);
});

test("planner treats an exact current-position destination as a zero-cost single-point route", () => {
  const fog = new Map();
  revealObservation(fog, 600n, 600n, 4);
  const snapshot = new TerrainSnapshot();
  const point = { x: "600", y: "600" };
  const { result } = runPlanner(new PlannerStepper(snapshot, fog, point, 4, point), snapshot);
  assert.deepEqual(result, { kind: "route", plan: { points: [point], legCosts: [], legProfiles: [], cost: 0n } });
});

test("revealed destination with unknown adjacent clearance continues through a frontier", () => {
  const fog = new Map();
  revealTile(fog, 0n, 0n);
  const snapshot = new TerrainSnapshot();
  const start = { x: "512", y: "512" };
  const destination = { x: "1000", y: "512" };
  const { result } = runPlanner(new PlannerStepper(snapshot, fog, start, 4, destination), snapshot);
  assert.equal(result.kind, "route");
  assert.notEqual(result.kind, "destination-unreachable");
});

test("planner distinguishes a known but unreachable destination and still yields deterministically", () => {
  const fog = revealedRectangle(-2n, 4n, -3n, 3n);
  const snapshot = new TerrainSnapshot();
  const blockers = new Map();
  for (let y = -1n; y <= 1n; y += 1n) {
    for (let x = 1n; x <= 3n; x += 1n) {
      if (x !== 2n || y !== 0n) blockers.set(`${x},${y}`, 1);
    }
  }
  const stepper = new PlannerStepper(snapshot, fog, { x: "512", y: "512" }, 4, { x: "2560", y: "512" });
  let yields = 0;
  let result;
  for (let iteration = 0; iteration < 200_000; iteration += 1) {
    result = stepper.step(1);
    if (result.kind === "terrain-required") {
      const bytes = new Uint8Array(4096).fill(3);
      const chunkX = BigInt(result.chunkX);
      const chunkY = BigInt(result.chunkY);
      for (const [key, terrain] of blockers) {
        const [xText, yText] = key.split(",");
        const x = BigInt(xText);
        const y = BigInt(yText);
        if (floorDiv(x, 64n) === chunkX && floorDiv(y, 64n) === chunkY) {
          bytes[Number(y - chunkY * 64n) * 64 + Number(x - chunkX * 64n)] = terrain;
        }
      }
      snapshot.provideChunk(result.chunkX, result.chunkY, bytes);
    } else if (result.kind === "yield") yields += 1;
    else break;
  }
  assert.ok(yields > 0);
  assert.deepEqual(result, { kind: "destination-unreachable", destination: { x: "2560", y: "512" } });
});

test("segment cost streams long crossings and keeps near-boundary rational rounding exact", () => {
  const emptySnapshot = new TerrainSnapshot();
  const huge = segmentCost(emptySnapshot, new Map(),
    { x: -(2n ** 41n), y: -(2n ** 41n) + 1n },
    { x: 2n ** 41n - 1n, y: 2n ** 41n - 2n });
  assert.deepEqual(huge.next(), { done: false, value: { kind: "operation" } });

  const fog = new Map();
  revealTile(fog, -1n, 0n);
  revealTile(fog, 0n, 0n);
  const snapshot = new TerrainSnapshot();
  snapshot.provideChunk("-1", "0", new Uint8Array(4096).fill(3));
  snapshot.provideChunk("0", "0", new Uint8Array(4096).fill(3));
  assert.equal(runSegment(segmentCost(snapshot, fog, { x: -1n, y: 512n }, { x: 1n, y: 512n }), snapshot), 2n);
});

test("equal-cost symmetric detours keep the parent with lower (y,x)", () => {
  const fog = new Map();
  for (let y = -3n; y <= 3n; y += 1n) for (let x = -1n; x <= 5n; x += 1n) revealTile(fog, x, y);
  const snapshot = new TerrainSnapshot();
  const provideTerrain = (request) => {
    const bytes = new Uint8Array(4096).fill(3);
    const chunkX = BigInt(request.chunkX);
    const chunkY = BigInt(request.chunkY);
    const localX = Number(2n - chunkX * 64n);
    const localY = Number(0n - chunkY * 64n);
    if (localX >= 0 && localX < 64 && localY >= 0 && localY < 64) bytes[localY * 64 + localX] = 1;
    snapshot.provideChunk(request.chunkX, request.chunkY, bytes);
  };
  const stepper = new PlannerStepper(snapshot, fog, { x: "512", y: "512" }, 4, { x: "4608", y: "512" });
  let result;
  for (let iteration = 0; iteration < 200_000; iteration += 1) {
    result = stepper.step(32);
    if (result.kind === "terrain-required") {
      provideTerrain(result);
      continue;
    }
    if (result.kind === "yield") continue;
    break;
  }
  assert.equal(result?.kind, "route");
  assert.ok(result.plan.points.some((point) => BigInt(point.y) < 0n), JSON.stringify(result.plan.points));
  assert.ok(!result.plan.points.some((point) => BigInt(point.y) > 1024n), JSON.stringify(result.plan.points));
});

test("terrain payload validation rejects invalid IDs instead of reporting navigation failure", () => {
  const snapshot = new TerrainSnapshot();
  const invalid = new Uint8Array(4096).fill(3);
  invalid[19] = 255;
  assert.throws(() => snapshot.provideChunk("0", "0", invalid), TerrainPayloadError);
  assert.throws(() => snapshot.provideChunk("0", "0", new Uint8Array(4095)), TerrainPayloadError);
});

test("fog touched chunks use numeric ordering", () => {
  const fog = new Map();
  const result = revealObservation(fog, -1n, -1n, 4);
  assert.deepEqual([...result.touchedChunkKeys].sort(compareChunkKeysNumeric), result.touchedChunkKeys);
});

test("initial reveal, repeated observation, and next-observation level radius settle exactly once", () => {
  const fog = new Map();
  const initial = revealObservation(fog, 512n, 512n, observationRadius(1));
  assert.ok(initial.newlyRevealed > 0);
  assert.equal(revealObservation(fog, 512n, 512n, observationRadius(1)).newlyRevealed, 0, "repeat observation grants no XP");
  assert.equal(observationRadius(10), 4);
  assert.equal(observationRadius(11), 5);
  const afterUpgrade = revealObservation(fog, 512n, 512n, observationRadius(11));
  assert.ok(afterUpgrade.newlyRevealed > 0, "the expanded radius applies on the observation after level-up");
});

function driveEngine(engine, terrainForRequest, operationBudget = 32) {
  let yields = 0;
  for (let iteration = 0; iteration < 200_000; iteration += 1) {
    const result = engine.step(operationBudget);
    if (result.kind === "terrain-request") {
      engine.provideTerrain(result, terrainForRequest(result));
      continue;
    }
    if (result.kind === "yield") {
      yields += 1;
      continue;
    }
    return yields;
  }
  throw new Error("engine fixture exceeded deterministic operation budget");
}

function createLandEngine() {
  const requests = [];
  const engine = new GameplayEngine(3);
  engine.beginCreateWorld("20260809");
  driveEngine(engine, (request) => {
    requests.push(request);
    return new Uint8Array(4096).fill(3);
  });
  return { engine, requests };
}

test("phase 2A content placement fixes three reachable camp guarantees and Euclidean negative cells", () => {
  const { engine } = createLandEngine();
  assert.deepEqual(engine.guaranteePlacements, [
    { placementId: "place:wild-fiber:guarantee:initial-observation", prototypeId: "wild_fiber", source: "guarantee", tileX: "2", tileY: "-3", point: { x: "2560", y: "-2560" } },
    { placementId: "place:wild-fiber:guarantee:ring-a", prototypeId: "wild_fiber", source: "guarantee", tileX: "7", tileY: "-18", point: { x: "7680", y: "-17920" } },
    { placementId: "place:wild-fiber:guarantee:ring-b", prototypeId: "wild_fiber", source: "guarantee", tileX: "15", tileY: "-20", point: { x: "15872", y: "-19968" } },
  ]);
  const ambient = ambientPlacementCandidate("20260809", { x: "512", y: "512" }, -1n, -1n);
  assert.equal(contentCellForTile(BigInt(ambient.tileX)), -1n);
  assert.equal(contentCellForTile(BigInt(ambient.tileY)), -1n);
  assert.deepEqual(authoritativeGatherDuration(1), { durationMs: 6000n, skillSpeedBps: 0 });
  assert.deepEqual(engine.toReadModel().knownTargetPrototypeIds, ["wild_fiber"]);
});

test("one 6000ms gather action atomically depletes the node and settles fiber, XP, and task count", () => {
  const { engine } = createLandEngine();
  engine.setTask("cmd:0123456789abcdef:99", { kind: "Gather", targetPrototypeId: "wild_fiber", quantity: 1 });
  for (let iteration = 0; iteration < 20 && engine.snapshot().activityState !== "acting"; iteration += 1) {
    driveEngine(engine, () => new Uint8Array(4096).fill(3));
    const activity = engine.toReadModel().activity;
    if (activity.state === "moving") engine.advanceBy(BigInt(activity.etaMs));
  }
  const action = engine.toReadModel().activity.action;
  assert.equal(action?.durationMs, "6000");
  assert.equal(action?.remainingMs, "6000");
  assert.equal(action?.skillSpeedBps, 0);
  const saved = engine.persistedState();
  const reloaded = new GameplayEngine(3);
  reloaded.restore({
    seed: saved.seed, worldTimeMs: saved.worldTimeMs, position: saved.position, campAnchor: saved.campAnchor,
    totalXp: saved.totalXp, gatheringXp: saved.gatheringXp, fiber: saved.fiber, task: saved.task,
    executionState: saved.execution.state, routePurpose: saved.execution.routePurpose,
    targetPlacementId: saved.execution.targetPlacementId, action: saved.execution.action,
    waitingReason: saved.execution.waitingReason, worldChunks: saved.worldChunks, nextEventOrdinal: saved.nextEventOrdinal,
  });
  driveEngine(reloaded, () => new Uint8Array(4096).fill(3));
  assert.equal(engine.advanceBy(5999n), 0n);
  assert.equal(engine.snapshot().fiber, 0);
  assert.equal(engine.advanceBy(1n), 0n);
  const settled = engine.snapshot();
  assert.equal(settled.fiber, 1);
  assert.equal(settled.gatheringXp, 6);
  assert.equal(settled.task?.kind, "Gather");
  assert.equal(settled.task?.completedQuantity, 1);
  assert.equal(settled.activityState, "waiting");
  assert.equal(engine.toReadModel().map.resourcePlacements[0]?.state, "depleted");
  assert.equal(engine.needsImmediateCommit, true);
  assert.equal(reloaded.advanceBy(6000n), 0n);
  assert.deepEqual(
    { fiber: reloaded.snapshot().fiber, gatheringXp: reloaded.snapshot().gatheringXp, task: reloaded.snapshot().task, placements: reloaded.toReadModel().map.resourcePlacements },
    { fiber: settled.fiber, gatheringXp: settled.gatheringXp, task: settled.task, placements: engine.toReadModel().map.resourcePlacements },
    "one-shot offline-style advance and reload use the same action settlement",
  );
});

test("pure engine closes create world, explore, advance, and cancel with explicit terrain effects", () => {
  const requests = [];
  const engine = new GameplayEngine(3);
  engine.beginCreateWorld("20260809");
  const createYields = driveEngine(engine, (request) => {
    requests.push(request);
    return new Uint8Array(4096).fill(3);
  }, 1);
  const created = engine.snapshot();
  assert.deepEqual(created.position, { x: "512", y: "512" });
  assert.equal(created.totalXp, 0, "initial observation does not grant XP");
  assert.ok(created.revealedTileCount > 0);
  assert.ok(createYields > 0, "anchor work is resumable");

  engine.setTask("cmd:0123456789abcdef:0", { kind: "Explore", mode: "continuous", destination: null });
  driveEngine(engine, (request) => {
    requests.push(request);
    return new Uint8Array(4096).fill(3);
  });
  assert.equal(engine.snapshot().activityState, "moving");
  const unconsumed = engine.advanceBy(60_000n);
  assert.ok(unconsumed > 0n, "world time pauses when the next deterministic plan needs terrain/CPU work");
  assert.equal(engine.snapshot().activityState, "planning");
  assert.ok(engine.snapshot().totalXp > 0);

  engine.cancelTask();
  const cancelled = engine.snapshot();
  assert.equal(cancelled.task, null);
  assert.equal(cancelled.activityState, "idle");
  assert.deepEqual(cancelled.route, []);
  assert.ok(requests.every((request) => request.seed === "20260809" && request.gameplayEpoch === 1));
});

function horizontalLandProfile() {
  const boundaries = Array.from({ length: 8 }, (_, index) => ({ numerator: BigInt(index * 2 + 1), denominator: 16n }));
  return {
    start: { x: "512", y: "512" },
    end: { x: "8704", y: "512" },
    runs: [{
      startParameter: { numerator: 0n, denominator: 1n },
      endParameter: { numerator: 1n, denominator: 1n },
      terrainFactor: 1000n,
      cost: 8192n,
      cumulativeCostBefore: 0n,
    }],
    boundaryParameters: boundaries,
    cost: 8192n,
  };
}

function engineWithFixtureRoute() {
  const { engine } = createLandEngine();
  engine.setTask("cmd:0123456789abcdef:7", { kind: "Explore", mode: "continuous", destination: null });
  const profile = horizontalLandProfile();
  engine.installRoute({ points: [profile.start, profile.end], legCosts: [profile.cost], legProfiles: [profile], cost: profile.cost });
  return engine;
}

function semanticMovementSnapshot(engine) {
  const snapshot = engine.snapshot();
  return {
    seed: snapshot.seed,
    worldTimeMs: snapshot.worldTimeMs,
    position: snapshot.position,
    totalXp: snapshot.totalXp,
    revealedTileCount: snapshot.revealedTileCount,
    revealedChunks: snapshot.revealedChunks,
    task: snapshot.task,
    activityState: snapshot.activityState,
    route: snapshot.route,
    routeIndex: snapshot.routeIndex,
  };
}

test("movement boundary observations are invariant under one-shot, 1ms, and random host chunking", () => {
  const oneShot = engineWithFixtureRoute();
  oneShot.advanceBy(3000n);

  const oneMillisecond = engineWithFixtureRoute();
  for (let elapsed = 0; elapsed < 3000; elapsed += 1) oneMillisecond.advanceBy(1n);

  const randomChunks = engineWithFixtureRoute();
  let remaining = 3000;
  let state = 0x12345678;
  while (remaining > 0) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const chunk = Math.min(remaining, state % 97 + 1);
    randomChunks.advanceBy(BigInt(chunk));
    remaining -= chunk;
  }

  const expected = semanticMovementSnapshot(oneShot);
  assert.deepEqual(semanticMovementSnapshot(oneMillisecond), expected);
  assert.deepEqual(semanticMovementSnapshot(randomChunks), expected);
  assert.deepEqual(expected.position, { x: "6656", y: "512" });
  assert.equal(expected.totalXp, 39);
  assert.equal(expected.revealedTileCount, 88);
});

test("weighted subleg profile drives factor-boundary time, exact position, and deterministic recomputation", () => {
  const fog = new Map();
  for (let x = 0n; x <= 2n; x += 1n) revealTile(fog, x, 0n);
  const snapshot = new TerrainSnapshot();
  const bytes = new Uint8Array(4096).fill(3);
  bytes[1] = 5;
  bytes[2] = 5;
  snapshot.provideChunk("0", "0", bytes);
  const profile = runSegment(segmentProfile(snapshot, fog, { x: 512n, y: 512n }, { x: 2560n, y: 512n }), snapshot);
  assert.equal(profile.cost, 2816n);
  assert.deepEqual(profile.runs.map((run) => [run.terrainFactor, run.cost]), [[1000n, 512n], [1500n, 2304n]]);
  assert.deepEqual(positionAtElapsedMs(profile, 250n), { x: "1024", y: "512" });
  assert.deepEqual(positionAtElapsedMs(structuredClone(profile), 250n), { x: "1024", y: "512" }, "reload/recompute profile is identical");
  const tieProfile = { ...profile, start: { x: "-1", y: "1" }, end: { x: "0", y: "2" } };
  assert.deepEqual(pointAtParameter(tieProfile, { numerator: 1n, denominator: 2n }), { x: "0", y: "2" }, "negative and positive .5 ties round to even coordinates");
});

function shortProfile(startX, endX, cost) {
  return {
    start: { x: String(startX), y: "512" },
    end: { x: String(endX), y: "512" },
    runs: [{
      startParameter: { numerator: 0n, denominator: 1n }, endParameter: { numerator: 1n, denominator: 1n },
      terrainFactor: 1000n, cost, cumulativeCostBefore: 0n,
    }],
    boundaryParameters: [],
    cost,
  };
}

test("route-origin cumulative cost settles multiple short legs at the same millisecond without per-leg ceil drift", () => {
  const split = createLandEngine().engine;
  split.setTask("cmd:0123456789abcdef:8", { kind: "Explore", mode: "continuous", destination: null });
  const first = shortProfile(512, 513, 1n);
  const second = shortProfile(513, 514, 1n);
  split.installRoute({ points: [first.start, first.end, second.end], legCosts: [1n, 1n], legProfiles: [first, second], cost: 2n });
  split.advanceBy(1n);

  const combined = createLandEngine().engine;
  combined.setTask("cmd:0123456789abcdef:8", { kind: "Explore", mode: "continuous", destination: null });
  const whole = shortProfile(512, 514, 2n);
  combined.installRoute({ points: [whole.start, whole.end], legCosts: [2n], legProfiles: [whole], cost: 2n });
  combined.advanceBy(1n);

  assert.equal(split.snapshot().worldTimeMs, 1n);
  assert.deepEqual(split.snapshot().position, { x: "514", y: "512" });
  assert.equal(split.snapshot().activityState, "planning", "same-time endpoint transitions stabilize through the next leg");
  assert.deepEqual(split.snapshot().position, combined.snapshot().position);
  assert.equal(split.snapshot().worldTimeMs, combined.snapshot().worldTimeMs);
});

test("command interruption materializes the same snapshot position used by profile reload", () => {
  const interrupted = engineWithFixtureRoute();
  interrupted.advanceBy(1234n);
  const before = semanticMovementSnapshot(interrupted);
  const reloadedPosition = positionAtElapsedMs(horizontalLandProfile(), 1234n);
  assert.deepEqual(before.position, reloadedPosition);
  interrupted.setTask("cmd:0123456789abcdef:9", { kind: "Explore", mode: "continuous", destination: null });
  const replanning = interrupted.snapshot();
  assert.deepEqual(replanning.position, before.position);
  assert.equal(replanning.worldTimeMs, before.worldTimeMs);
  assert.equal(replanning.activityState, "planning");
  assert.deepEqual(replanning.route, []);
  interrupted.cancelTask();
  const cancelled = interrupted.snapshot();
  assert.deepEqual(cancelled.position, before.position);
  assert.equal(cancelled.worldTimeMs, before.worldTimeMs);
  assert.equal(cancelled.activityState, "idle");
});

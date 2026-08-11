import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  BASE_TERRAIN_ID,
  DECORATION_ID,
  GENERATED_CHUNK_BYTES,
  NAV_UNITS_PER_TILE,
  RUNTIME_CHUNK_AREA,
  RUNTIME_CHUNK_SIZE,
  isPassableBaseTerrain,
} from "../src/world-contract.ts";

const fixtureUrl = new URL("./fixtures/phase-1-contract.json", import.meta.url);
const contractDocUrl = new URL("../../docs/specifications/phase-1-runtime-contracts.md", import.meta.url);

const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));
const contractDoc = await readFile(contractDocUrl, "utf8");

function compareCodePoints(left, right) {
  const leftPoints = Array.from(left, (value) => value.codePointAt(0));
  const rightPoints = Array.from(right, (value) => value.codePointAt(0));
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index];
    }
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), "fixture numbers must be finite");
    assert.ok(Number.isSafeInteger(value), "fixture numbers must be safe integers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  assert.equal(typeof value, "object");
  const entries = Object.keys(value)
    .sort(compareCodePoints)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(",")}}`;
}

function expectPattern(pattern, accepted, rejected) {
  const expression = new RegExp(pattern);
  for (const value of accepted) assert.match(value, expression);
  for (const value of rejected) assert.doesNotMatch(value, expression);
}

function expectExactFields(actual, expected) {
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, actual.length, "message fields must be unique");
}

test("Gate A fixture is canonical and linked to the document", () => {
  assert.equal(fixture.schema, "baiyue-rpg.phase-1-contract-fixture/v1");
  assert.equal(fixture.gateStatus.gateA, "complete_schema_fixture_passed");
  assert.equal(fixture.gateStatus.gateB, "complete_anchor_materialized");
  const sha256 = createHash("sha256").update(canonicalJson(fixture), "utf8").digest("hex");
  assert.match(contractDoc, new RegExp(`contract-fixture-sha256 = ${sha256}`));
});

test("decimal and coordinate bounds preserve exact accepted ranges", () => {
  assert.equal(BigInt(fixture.bounds.seedMax), (1n << 64n) - 1n);
  assert.equal(BigInt(fixture.bounds.exactUnsignedMax), (1n << 127n) - 1n);
  assert.equal(BigInt(fixture.bounds.navMin), BigInt(fixture.bounds.tileMin) * 1024n);
  assert.equal(BigInt(fixture.bounds.navMax), (BigInt(fixture.bounds.tileMax) + 1n) * 1024n - 1n);
  assert.equal(BigInt(fixture.bounds.chunkMin), -33_554_432n);
  assert.equal(BigInt(fixture.bounds.chunkMax), 33_554_431n);
  assert.equal(fixture.bounds.safeIntMin, Number.MIN_SAFE_INTEGER);
  assert.equal(fixture.bounds.safeIntMax, Number.MAX_SAFE_INTEGER);
  assert.equal(fixture.bounds.safeUintMax, Number.MAX_SAFE_INTEGER);
});

test("shared TypeScript terrain constants match the static contract", () => {
  assert.equal(RUNTIME_CHUNK_SIZE, fixture.terrainContract.chunkSize);
  assert.equal(RUNTIME_CHUNK_AREA, fixture.terrainContract.chunkArea);
  assert.equal(GENERATED_CHUNK_BYTES, fixture.terrainContract.generatedBytes);
  assert.equal(NAV_UNITS_PER_TILE.toString(), fixture.terrainContract.navUnitsPerTile);
  assert.deepEqual(BASE_TERRAIN_ID, fixture.terrainContract.baseTerrainIds);
  assert.deepEqual(DECORATION_ID, fixture.terrainContract.decorationIds);
  assert.equal(fixture.terrainContract.decorationRequiresLand, true);
  assert.deepEqual(Object.values(BASE_TERRAIN_ID).filter(isPassableBaseTerrain), fixture.terrainContract.passableIds);
});

test("ID grammar rejects non-canonical spelling and component overflow", () => {
  expectPattern(fixture.idPatterns.requestId, ["req:0123456789abcdef:0"], ["req:ABC:1", "req:0123456789abcdef:01"]);
  expectPattern(fixture.idPatterns.commandId, ["cmd:0123456789abcdef:0"], ["cmd:ABC:1", "cmd:0123456789abcdef:-1"]);
  expectPattern(fixture.idPatterns.taskId, ["task:0123456789abcdef:0"], ["task:abcd:1", "task:0123456789abcdef:01"]);
  expectPattern(fixture.idPatterns.eventId, ["evt:1200:7"], ["evt:01:2", "evt:2:-1"]);
  expectPattern(fixture.idPatterns.terrainRequestId, ["terrain:3:19"], ["terrain:1:-1", "terrain:01:2"]);
  expectPattern(fixture.idPatterns.claimId, ["claim:7:1770000000000"], ["claim:01:2", "claim:-1:2"]);
  expectPattern(fixture.idPatterns.chunkKey, ["-12,4", "0,0"], ["-0,2", "01,2"]);

  const safeCounterMax = BigInt(fixture.idComponentBounds.requestCommandTaskCounter.max);
  assert.ok(BigInt("9007199254740991") <= safeCounterMax);
  assert.ok(BigInt("9007199254740992") > safeCounterMax);
  assert.equal(fixture.idComponentBounds.claimBaseRevision.min, 1);
  assert.equal(fixture.idComponentBounds.eventWorldTimeAndOrdinal.max, fixture.bounds.exactUnsignedMax);
});

test("message unions expose exact lifecycle correlation and no arbitrary error field", () => {
  expectExactFields(fixture.workerToMain["request-result"], ["type", "protocolVersion", "requestId", "operation", "status", "readModelRevision", "saveRevision", "error"]);
  expectExactFields(fixture.workerToMain["protocol-error"], ["type", "protocolVersion", "requestId", "error", "readModelRevision", "saveRevision"]);
  expectExactFields(fixture.workerToMain["command-result"], ["type", "protocolVersion", "requestId", "commandId", "status", "readModelRevision", "saveRevision", "error"]);
  expectExactFields(fixture.workerToMain.fatal, ["type", "protocolVersion", "error", "readModelRevision", "saveRevision"]);
  assert.equal(fixture.closedErrorCodes.command.includes("command/id_conflict"), true);
  assert.equal(fixture.closedErrorCodes.command.includes("command/invalid_seed"), true);
  assert.equal(fixture.closedErrorCodes.protocol.includes("protocol/invalid_message"), true);
  assert.match(contractDoc, /type ActivityReason =/);
  assert.match(contractDoc, /type CommandError =/);
  assert.match(contractDoc, /type FatalError =/);
  assert.doesNotMatch(contractDoc, /reason_code: string/);
});

test("offline skew, transferables, receipt ownership, and IDB keyPaths are closed", () => {
  assert.equal(fixture.offlineClockSkew.rawElapsedType, "signed-safe-integer");
  assert.deepEqual(fixture.offlineClockSkew.backward, {
    clockSkew: "backward",
    creditedDurationMs: "0",
    discardedDurationMs: "0",
    worldTimeRollsBack: false,
    uiWarningRequired: true,
  });
  assert.equal(fixture.transferables["terrain-result.baseTerrain"].exactBytes, 4096);
  assert.equal(fixture.transferables["read-model.map.revealedBase64"].decodedBytes, 512);
  assert.deepEqual(fixture.receiptPolicy.persistedCommandTypes, ["CreateWorld", "SetTask", "CancelTask"]);
  assert.deepEqual(fixture.receiptPolicy.memoryOnlyCommandTypes, ["ExportSave", "ImportSave", "ResetSave"]);
  assert.equal(fixture.receiptPolicy.importPreservesAuthoritativeRevision, true);
  assert.deepEqual(Object.fromEntries(Object.entries(fixture.database.stores).map(([name, store]) => [name, store.keyPath])), {
    meta: "save_id",
    core: "save_id",
    world_chunks: "chunk_key",
    resume_claim: "save_id",
  });
  assert.match(contractDoc, /transaction 关闭后才执行 canonicalization、Web Crypto SHA-256/);
});

test("Gate B contains the materialized generator-v3 anchor identity", () => {
  assert.deepEqual(fixture.benchmark.start, { x: "512", y: "512" });
  assert.deepEqual(fixture.benchmark.anchorTile, { x: "0", y: "0" });
  const input = canonicalJson({ anchor: fixture.benchmark.start, generatorVersion: fixture.benchmark.generatorVersion, seed: fixture.benchmark.seed });
  assert.equal(createHash("sha256").update(input, "utf8").digest("hex"), fixture.benchmark.anchorFixtureChecksum);
});

import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { findCampAnchor } from "../src/gameplay/anchor.ts";
import { canonicalJson } from "../src/gameplay/canonical-json.ts";
import { compareChunkKeysNumeric } from "../src/world-contract.ts";

const wasmModule = await import("../public/wasm/terrain_wasm.js");
const wasmBytes = await readFile(new URL("../public/wasm/terrain_wasm_bg.wasm", import.meta.url));
await wasmModule.default({ module_or_path: wasmBytes });

const seed = "20260809";
const generatorVersion = wasmModule.generator_version();
const accessedChunks = new Map();
const anchor = await findCampAnchor(async (chunkX, chunkY) => {
  const generated = wasmModule.generate_chunk(BigInt(seed), BigInt(chunkX), BigInt(chunkY));
  if (!(generated instanceof Uint8Array) || generated.byteLength !== 8192) {
    throw new Error("generate_chunk must return exactly 8192 bytes");
  }
  const checksum = generated.reduce(
    (value, byte) => BigInt.asUintN(64, (value ^ BigInt(byte)) * 0x100000001b3n),
    0xcbf29ce484222325n,
  ).toString(16).padStart(16, "0");
  accessedChunks.set(`${chunkX},${chunkY}`, checksum);
  return generated.slice(0, 4096);
});

if (anchor === null) throw new Error("seed 20260809 has no valid phase 1 camp anchor within ring 16");

const checksumInput = canonicalJson({ anchor: anchor.point, generatorVersion, seed });
const anchorFixtureChecksum = createHash("sha256").update(checksumInput, "utf8").digest("hex");
const fixture = JSON.parse(await readFile(new URL("./fixtures/phase-1-contract.json", import.meta.url), "utf8"));
const nativeFixture = (await readFile(new URL("./fixtures/phase1-anchor-terrain.tsv", import.meta.url), "utf8"))
  .trim()
  .split("\n")
  .filter((line) => !line.startsWith("#"))
  .map((line) => {
    const [chunkX, chunkY, checksum] = line.split("\t");
    return [`${chunkX},${chunkY}`, checksum];
  });
const wasmChecksums = [...accessedChunks.entries()].sort(([left], [right]) => compareChunkKeysNumeric(left, right));
const nativeChecksums = nativeFixture.sort(([left], [right]) => compareChunkKeysNumeric(left, right));
assert.deepEqual(wasmChecksums, nativeChecksums);
assert.equal(seed, fixture.benchmark.seed);
assert.deepEqual(anchor.point, fixture.benchmark.start);
assert.deepEqual({ x: anchor.tileX, y: anchor.tileY }, fixture.benchmark.anchorTile);
assert.equal(generatorVersion, fixture.benchmark.generatorVersion);
assert.equal(anchorFixtureChecksum, fixture.benchmark.anchorFixtureChecksum);
process.stdout.write(`${JSON.stringify({ anchor, anchorFixtureChecksum, checksumInput, generatorVersion, seed, verifiedChunkCount: wasmChecksums.length }, null, 2)}\n`);

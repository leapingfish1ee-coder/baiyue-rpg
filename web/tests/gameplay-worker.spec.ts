import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.goto("./worker-harness.html");
  await expect.poll(() => page.evaluate(() => typeof window.phase1WorkerHarness)).toBe("object");
});

test("real module Worker, broker, and WASM generator match direct engine through nonzero exploration and cancel", async ({ page }) => {
  const result = await page.evaluate(() => window.phase1WorkerHarness.runWorkerEquivalence()) as {
    createdEqual: boolean;
    movingEqual: boolean;
    completedEqual: boolean;
    cancelledEqual: boolean;
    effectsEqual: boolean;
    destination: { x: string; y: string };
    movingRoute: Array<{ x: string; y: string }>;
    createdXp: number;
    completedXp: number;
    createdRevealed: number;
    completedRevealed: number;
  };
  expect(result).toMatchObject({ createdEqual: true, movingEqual: true, completedEqual: true, cancelledEqual: true, effectsEqual: true });
  expect(result.destination).toEqual({ x: "6656", y: "3584" });
  expect(result.completedXp).toBeGreaterThan(result.createdXp);
  expect(result.completedRevealed).toBeGreaterThan(result.createdRevealed);
  expect(result.movingRoute.length).toBeGreaterThan(1);
  expect(result.movingRoute.some((point, index) => {
    const previous = result.movingRoute[index - 1];
    if (!previous) return false;
    const dx = BigInt(point.x) - BigInt(previous.x);
    const dy = BigInt(point.y) - BigInt(previous.y);
    const absX = dx < 0n ? -dx : dx;
    const absY = dy < 0n ? -dy : dy;
    return dx !== 0n && dy !== 0n && absX !== absY;
  })).toBe(true);
});

test("raw Worker closes request correlation, command idempotency, conflicts, and protocol classifications", async ({ page }) => {
  const result = await page.evaluate(() => window.phase1WorkerHarness.runRawProtocolAndIdempotency()) as {
    initializeTerminalCount: number;
    createTerminalCount: number;
    createdStatus: string;
    replayRevisionEqual: boolean;
    conflictCode: string;
    terrainCountUnchangedByReplayAndConflict: boolean;
    protocolCodes: string[];
    brokerPending: number;
  };
  expect(result).toEqual({
    initializeTerminalCount: 1,
    createTerminalCount: 1,
    createdStatus: "accepted",
    replayRevisionEqual: true,
    conflictCode: "command/id_conflict",
    terrainCountUnchangedByReplayAndConflict: true,
    protocolCodes: ["protocol/invalid_message", "protocol/unknown_message", "protocol/version_mismatch"],
    brokerPending: 0,
  });
});

test("raw Worker ignores stale and duplicate terrain while resetting ordinal on epoch switch", async ({ page }) => {
  const result = await page.evaluate(() => window.phase1WorkerHarness.runRawTerrainCorrelation()) as {
    secondStatus: string;
    firstIds: string[];
    secondIds: string[];
    duplicateInjected: boolean;
    staleInjected: boolean;
    fatalCount: number;
    unscopedProtocolErrors: number;
  };
  expect(result.secondStatus).toBe("accepted");
  expect(result.firstIds[0]).toBe("terrain:1:0");
  expect(result.secondIds[0]).toBe("terrain:3:0");
  expect(result.duplicateInjected).toBe(true);
  expect(result.staleInjected).toBe(true);
  expect(result.fatalCount).toBe(0);
  expect(result.unscopedProtocolErrors).toBe(0);
});

for (const scenario of [
  { mode: "malformed", requests: 1 },
  { mode: "transient", requests: 3 },
  { mode: "permanent", requests: 1 },
] as const) {
  test(`raw Worker pauses exactly once for ${scenario.mode} terrain failure`, async ({ page }) => {
    const result = await page.evaluate((mode) => window.phase1WorkerHarness.runTerrainFailureScenario(mode), scenario.mode) as {
      terrainRequests: number;
      fatalCount: number;
      paused: boolean;
    };
    expect(result).toEqual({ mode: scenario.mode, terrainRequests: scenario.requests, fatalCount: 1, paused: true });
  });
}

test("real generator Worker reports malformed input and remains able to serve a canonical request", async ({ page }) => {
  const result = await page.evaluate(() => window.phase1WorkerHarness.runGeneratorWorkerBoundary()) as {
    invalidErrorCount: number;
    validAfterMalformed: boolean;
  };
  expect(result.invalidErrorCount).toBeGreaterThanOrEqual(1);
  expect(result.validAfterMalformed).toBe(true);
});

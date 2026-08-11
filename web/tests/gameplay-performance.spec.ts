import { expect, test } from "@playwright/test";

test("168-hour offline resume is capped, committed, and completes within 15 seconds", async ({ page }) => {
  await page.goto("./worker-harness.html");
  await expect.poll(() => page.evaluate(() => typeof window.phase1WorkerHarness)).toBe("object");
  const result = await page.evaluate(() => window.phase1WorkerHarness.runOfflineCapResume()) as {
    creditedDurationMs: string;
    discardedDurationMs: string;
    rawElapsedMs: number;
    worldTimeMs: string;
    saveRevision: number;
    claimCount: number;
    elapsedMs: number;
  };
  expect(result).toMatchObject({
    creditedDurationMs: "604800000",
    discardedDurationMs: "12345",
    rawElapsedMs: 604_812_345,
    worldTimeMs: "604800000",
    saveRevision: 2,
    claimCount: 0,
  });
  expect(result.elapsedMs).toBeLessThanOrEqual(15_000);
});

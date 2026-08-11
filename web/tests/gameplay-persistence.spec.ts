import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ page }) => {
  await page.goto("./worker-harness.html");
  await expect.poll(() => page.evaluate(() => typeof window.phase1WorkerHarness)).toBe("object");
});

test("atomic new world commit creates the exact schema and restores persisted receipts", async ({ page }) => {
  const result = await page.evaluate(() => window.phase1WorkerHarness.runPersistenceCreateRestore()) as {
    createStatus: string;
    createSaveRevision: number;
    readySave: { state: string; revision: number; committedWallClockMs: number };
    storeNames: string[];
    keyPaths: Record<string, string>;
    storeOptions: Record<string, { autoIncrement: boolean; indexNames: string[] }>;
    metaRevision: number;
    coreRevision: number;
    receiptCount: number;
    chunkCount: number;
    claimCount: number;
    restoredPosition: { x: string; y: string };
    replayStatus: string;
    replaySaveRevision: number;
    replayTerrainRequests: number;
    conflictCode: string;
  };
  expect(result).toEqual({
    createStatus: "accepted",
    createSaveRevision: 1,
    readySave: {
      state: "saved",
      revision: 1,
      committedWallClockMs: 1_000,
      localOnly: true,
      evictionWarning: false,
      lastError: null,
    },
    storeNames: ["core", "meta", "resume_claim", "world_chunks"],
    keyPaths: { core: "save_id", meta: "save_id", resume_claim: "save_id", world_chunks: "chunk_key" },
    storeOptions: {
      core: { autoIncrement: false, indexNames: [] },
      meta: { autoIncrement: false, indexNames: [] },
      resume_claim: { autoIncrement: false, indexNames: [] },
      world_chunks: { autoIncrement: false, indexNames: [] },
    },
    metaRevision: 1,
    coreRevision: 1,
    receiptCount: 1,
    chunkCount: 4,
    claimCount: 0,
    restoredPosition: { x: "512", y: "512" },
    replayStatus: "accepted",
    replaySaveRevision: 1,
    replayTerrainRequests: 3,
    conflictCode: "command/id_conflict",
  });
});

test("exclusive Web Lock prevents a second gameplay authority and permits explicit retry after release", async ({ page }) => {
  const result = await page.evaluate(() => window.phase1WorkerHarness.runWebLockExclusion());
  expect(result).toEqual({
    firstStatus: "accepted",
    blockedStatus: "rejected",
    blockedCode: "active_in_other_tab",
    blockedReadModels: 0,
    retryStatus: "accepted",
  });
});

test("explicitly unavailable Web Locks fails before opening IndexedDB", async ({ page }) => {
  const result = await page.evaluate(() => window.phase1WorkerHarness.runWebLocksUnavailableBoundary());
  expect(result).toEqual({ code: "platform/web_locks_unavailable", databaseCreated: false });
});

test("tampered records and schema never start simulation", async ({ page }) => {
  const result = await page.evaluate(() => window.phase1WorkerHarness.runPersistenceTamperMatrix()) as Record<
    string,
    { status: string; code: string; readModels: number }
  >;
  for (const name of ["partial", "checksum", "chunkRevision", "xpLevel", "execution", "extraIndex", "autoIncrement"]) {
    expect(result[name]).toMatchObject({ status: "rejected", readModels: 0 });
    expect(["storage/integrity_failed", "storage/unavailable"]).toContain(result[name]?.code);
  }
  for (const name of ["version", "higherDbVersion"]) {
    expect(result[name]).toMatchObject({ status: "rejected", readModels: 0 });
  }
});

test("backup export, confirmed reset, and import preserve canonical gameplay bytes", async ({ page }) => {
  const result = await page.evaluate(() => window.phase1WorkerHarness.runBackupRoundTrip()) as {
    importStatus: string;
    revisionPreserved: boolean;
    semanticCorePreserved: boolean;
    byteIdentical: boolean;
    invalidImportRejected: boolean;
    invalidImportPreservedBytes: boolean;
    firstHash: string;
  };
  expect(result).toMatchObject({
    importStatus: "accepted",
    revisionPreserved: true,
    semanticCorePreserved: true,
    byteIdentical: true,
    invalidImportRejected: true,
    invalidImportPreservedBytes: true,
  });
  expect(result.firstHash).toMatch(/^[0-9a-f]{64}$/);
});

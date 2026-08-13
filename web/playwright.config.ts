import { defineConfig, devices } from "@playwright/test";

const rawBasePath = process.env.SMOKE_BASE_PATH ?? "/";
const basePath = `/${rawBasePath.replace(/^\/+|\/+$/g, "")}/`.replace("//", "/");
const testPort = process.env.BAIYUE_TEST_PORT ?? "4173";
const serverOrigin = `http://127.0.0.1:${testPort}`;
const serverUrl = `${serverOrigin}${basePath}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 1,
  reporter: "line",
  use: {
    baseURL: serverUrl,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    launchOptions: {
      args: [
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--use-gl=angle",
        "--use-angle=swiftshader",
      ],
    },
  },
  webServer: {
    command: process.env.BAIYUE_WORKER_TEST === "1"
      ? `./node_modules/.bin/vite preview --outDir dist-worker-test --host 127.0.0.1 --port ${testPort}`
      : `./node_modules/.bin/vite preview --host 127.0.0.1 --port ${testPort}`,
    url: serverUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});

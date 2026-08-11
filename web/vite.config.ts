import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages project sites live under /<repository>/.
  // CI sets VITE_BASE_PATH accordingly; local development keeps root '/'.
  base: process.env.VITE_BASE_PATH ?? "/",
  build: {
    rollupOptions: {
      input: {
        main: "index.html",
        worldDebug: "world-debug.html",
        lightingLab: "lighting-lab/index.html",
        ...(process.env.BAIYUE_TEST_HARNESS === "1" ? { workerHarness: "worker-harness.html" } : {}),
      },
    },
  },
});

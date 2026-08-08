import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages project sites live under /<repository>/.
  // CI sets VITE_BASE_PATH accordingly; local development keeps root '/'.
  base: process.env.VITE_BASE_PATH ?? "/",
});

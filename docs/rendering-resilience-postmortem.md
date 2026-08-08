# Rendering Resilience Postmortem

Date: 2026-08-08

## Summary

The initial WebGL2 texture-shader integration treated the GPU layer as the owner of active texture rendering. When the shader was enabled, Canvas2D stopped drawing static terrain and decoration textures.

Initial WebGL2 creation and shader-compilation failures did have a fallback path, but the architecture was still unsafe for production because a WebGL2 context can fail after initialization. A runtime context loss, GPU-process reset, driver failure, or later WebGL error could therefore remove the texture layer from an otherwise healthy world.

This was a progressive-enhancement violation: an optional visual effect was allowed to become a dependency of the baseline renderer.

## User impact

Potential failure modes included:

- WebGL2 unavailable at startup: static fallback worked, but the UI incorrectly reduced several possible causes to “browser does not support WebGL2”.
- GLSL/program/resource initialization failure: static fallback worked, but diagnostics were too coarse.
- WebGL2 context loss after successful startup: Canvas2D had already suppressed static textures, so textures could disappear.
- Runtime WebGL errors after successful startup: there was no health boundary that disabled the enhancement and returned to a known-good visual state.
- CI validated Rust, WASM, TypeScript and Vite, but did not launch a browser or exercise WebGL/fallback behavior.

## Root cause

The design confused two responsibilities:

1. **Baseline rendering availability** — must work on every supported browser/device that can run the application.
2. **GPU visual enhancement** — may improve appearance when available but must be disposable at any frame.

The renderer contained a `textureShaderEnabled` switch that explicitly stopped Canvas2D from drawing base/decorative texture sprites. That created a hidden coupling between WebGL health and basic texture visibility.

## Corrective architecture

The renderer now follows these invariants:

1. Canvas2D always draws the complete static world: background, optional base colors, all base-terrain textures, all decoration textures, and grid.
2. WebGL2 never suppresses or replaces Canvas2D pixels.
3. The GPU shader outputs only a translucent light/dark modulation overlay using the validated world-space rotated multi-octave noise.
4. If WebGL2 is unavailable, fails to initialize, loses its context, or reports a runtime error, only the overlay is disabled.
5. The world and its static textures remain visible without rebuilding chunks or reloading the page.
6. Failure diagnostics distinguish unavailable context, initialization failure, context loss, and runtime error.
7. The HUD exposes the actual rendering mode: Canvas2D baseline or Canvas2D + WebGL2 enhancement.

## Runtime failure boundary

`TextureShaderRenderer` owns its failure state. It listens for `webglcontextlost`, checks `gl.isContextLost()`, checks WebGL errors after draws, and converts any failure into a one-way session fallback.

The main application responds by:

- disabling the GPU enhancement toggle;
- disabling shader parameter controls;
- hiding the WebGL overlay canvas;
- leaving Canvas2D untouched;
- showing `Canvas2D（GPU 增强已降级）` in the HUD.

The user can continue using the world normally.

## CI correction

Pages deployment is now gated by Playwright/Chromium smoke tests in addition to Rust/WASM/TypeScript/Vite checks.

The browser tests cover:

1. forced WebGL2 unavailability by intercepting `canvas.getContext("webgl2")` and returning `null`; the world must still load and the Canvas2D canvas must contain non-black rendered pixels;
2. normal startup followed, when supported by the CI browser, by `WEBGL_lose_context`; the application must switch to fallback mode while the Canvas2D world remains rendered.

A `?shader=off` mode is also available for deterministic manual/automation fallback checks.

## Production rule

Optional rendering accelerators/effects must never own world availability.

Future WebGPU, post-processing, lighting, particles, weather shaders, or other GPU effects must follow the same dependency direction:

```text
World data
   ↓
Complete Canvas2D baseline
   ↓
Optional GPU enhancement
```

Never:

```text
World data
   ↓
GPU-only visual ownership
   ↓
Fallback attempted after failure
```

The fallback must already be present underneath the enhancement before the enhancement is allowed to run.

# Rendering Resilience Postmortem

Date: 2026-08-08

## Summary

The first WebGL2 integration had a real availability risk: when the GPU layer owned active textures, a runtime context loss could leave the world without those textures. The first corrective pass removed that risk by keeping complete static Canvas2D textures permanently underneath WebGL2.

That correction overreached. To avoid double-rendering, the validated water shader was rewritten from a complete water composition into a low-alpha light/dark modulation overlay. The application became more fault-tolerant, but the already-approved water appearance changed substantially.

The final correction separates two requirements that must both hold:

1. a complete Canvas2D fallback must be independently renderable from current in-memory world and texture data at any time;
2. the normal WebGL2 path must be allowed to own dynamic texture pixels so that its approved visual composition is not forced into a translucent overlay model.

A fallback does not have to be simultaneously composited underneath the enhanced result. It has to be immediately switchable and independent of GPU state.

## Root causes

### Availability defect

The original GPU path could fail after successful startup. Startup fallback alone was insufficient because `webglcontextlost`, GPU process reset, driver failure, or later WebGL errors can happen after the Canvas renderer has already suppressed static textures.

### Visual-regression defect

The first resilience fix confused “fallback must always be available” with “the complete fallback pixels must always be visible underneath the GPU layer”. That forced a different compositing architecture and changed the approved water shader.

The validated baseline was commit `b67e8bad260b3816447e067fcedd2524da0c46f3`, whose water result is defined by:

- rotated three-octave world-space value noise;
- quintic interpolation;
- no texture displacement;
- texture RGB multiplied by dynamic brightness;
- dynamic ambient water color;
- texture alpha mixing ambient and texture colors;
- the original deep/shallow ambient-alpha and final-alpha formulas.

Those formulas are now treated as a visual contract rather than an implementation detail.

## Corrective architecture

The renderer now has two explicit modes.

### Enhanced mode

```text
World data
   ↓
Canvas2D: background + optional terrain base colors + grid
   ↓
WebGL2: complete dynamic base/decorative texture rendering
```

For deep and shallow water, WebGL2 uses the approved `b67e8bad...` water composition. For the other six texture slots, WebGL2 uses the same validated world-space noise field to modulate the actual texture RGB and alpha; it does not place a second translucent copy over a static texture.

### Canvas fallback mode

```text
World data + in-memory texture sprites
   ↓
Canvas2D: background + optional base colors + all base textures + all decorations + grid
```

Switching modes clears the Canvas surface cache. The next frame reconstructs the complete static surfaces from already-loaded chunk and sprite data. No world regeneration, page reload, WebGL resource, or network request is required.

The maximum expected visual interruption at runtime failure is therefore one animation frame rather than loss of world availability.

## Runtime failure boundary

`TextureShaderRenderer` still owns GPU failure detection. It handles:

- WebGL2 context creation failure;
- GLSL compilation/program link/resource initialization failure;
- `webglcontextlost`;
- `gl.isContextLost()`;
- runtime WebGL errors after drawing.

On a failure the application:

1. disables and hides the WebGL texture canvas;
2. switches `Renderer` back to complete Canvas2D texture ownership;
3. clears cached base-only Canvas surfaces;
4. disables GPU controls for the session;
5. reports the actual fallback state in the HUD.

## CI gates

Pages deployment is gated by Rust/WASM/TypeScript/Vite checks and real Chromium/Playwright tests.

The browser tests cover:

1. forced WebGL2 unavailability: the application must still load a non-black Canvas2D world;
2. normal SwiftShader WebGL2 startup: the application must enter `enhanced` mode, so shader compile/link/resource failures cannot silently pass as fallback;
3. forced `WEBGL_lose_context`: the application must switch to Canvas fallback without losing the world;
4. the approved water-composition GLSL block and baseline commit identifier are pinned as a source-level visual contract.

`?shader=off` forces the complete Canvas2D path. `?shaderTime=<seconds>` freezes GPU animation time for deterministic visual diagnostics and future screenshot-golden tests.

## Production rules

Optional GPU rendering must never own *world availability*, but it may own *enhanced visual pixels* when a complete CPU fallback can be reconstructed immediately from independent data.

Do not change an accepted visual algorithm merely to satisfy fault tolerance. Preserve both contracts separately:

```text
Availability contract:
current world data → complete non-GPU fallback at any time

Visual contract:
approved enhanced algorithm → unchanged output unless an explicit visual change is reviewed
```

Build/runtime tests and visual-regression tests are different classes of protection. Passing one must never be described as proving the other.

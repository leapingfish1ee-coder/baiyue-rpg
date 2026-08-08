# Infinite TileMap Terrain MVP

Browser MVP for deterministic, chunked, effectively-infinite 2D terrain generation.

## Scope

- 64×64 semantic tile chunks.
- Rust/WASM is the only terrain-generation authority.
- FastNoiseLite continuous world-coordinate sampling.
- Dedicated Web Worker keeps generation off the UI thread.
- Canvas2D renderer uses one pixel per tile in cached chunk surfaces, then scales them with nearest-neighbor rendering.
- Mouse drag / WASD panning and wheel zoom.
- `u64` seed and Rust `i64` chunk/world coordinates at the generator boundary.
- No rivers, roads, buildings, collision, navigation, WFC, persistence, or player edits.

Terrain IDs:

| ID | Terrain |
|---:|---|
| 0 | DeepWater |
| 1 | Water |
| 2 | Sand |
| 3 | Grass |
| 4 | Forest |
| 5 | Rock |
| 6 | Snow |

## Prerequisites

- Node.js compatible with Vite 8 (Node 22.12+ is a safe choice).
- Rust toolchain.
- `wasm-pack` in `PATH`.

Install wasm-pack using the method documented by the wasm-pack project for your platform.

## Run

```bash
cd web
npm install
npm run dev
```

`npm run dev` first compiles `../rust` to `web/public/wasm`, then starts Vite.

Production build:

```bash
cd web
npm install
npm run build
```

Rust tests:

```bash
cd rust
cargo test
```

Native generator benchmark:

```bash
cd rust
cargo run --release --example benchmark
```

## Architecture

```text
camera / UI
    │
    ▼
ChunkManager (TypeScript)
    │ request seed + chunk coordinate
    ▼
Dedicated Web Worker
    │ BigInt boundary
    ▼
Rust/WASM generate_chunk(seed, chunk_x, chunk_y)
    │
    ├─ SplitMix64-derived field seeds
    ├─ FastNoiseLite domain warp
    ├─ elevation + detail + moisture continuous fields
    └─ semantic terrain classification
    │
    ▼
Uint8Array[4096]
    │ transferable ArrayBuffer
    ▼
Canvas2D chunk surface cache
```

## Determinism contract

Generation depends only on:

1. generator version,
2. world seed,
3. absolute world tile coordinates,
4. fixed generation parameters.

Chunk visitation order is not an input. The generator samples absolute coordinates, so adjacent chunk boundaries are samples at consecutive world positions rather than independently generated edges.

If generation parameters or algorithms change later, increment `GENERATOR_VERSION` in `rust/src/lib.rs`. Do not silently change an existing version if saved worlds must remain reproducible.

## Coordinate limits

The Rust generator uses `i64` coordinates. The current browser camera uses JavaScript `number`, so interactive navigation is intentionally limited to JavaScript safe-integer chunk coordinates. This is still far beyond a practical rendered world. A later version can store the camera as `(BigInt chunk origin + local floating offset)` if exact navigation beyond ±2^53 chunks is required.

## MVP acceptance checks

1. Same seed + same chunk coordinate returns byte-identical output.
2. Different visit order does not change output.
3. Negative chunk coordinates render continuously across `(−1, 0)` and `(0, 0)`.
4. Fast panning does not block the main thread on terrain generation.
5. Changing seed clears the cache and regenerates visible chunks.
6. Returning to a previously visited coordinate regenerates the same terrain after eviction.

## Next technical step

Do not add WFC or WebGPU first. Add an automated seam/determinism harness that hashes thousands of generated chunks, then tune biome parameters or add cross-chunk features such as rivers on top of the stable generator contract.

## GitHub Pages deployment

This repository includes `.github/workflows/pages.yml`. On every push to `main`, GitHub Actions will install Rust/WASM and Node, run Rust tests, build the Vite site, and deploy `web/dist` to GitHub Pages.

Expected Pages URL for this repository:

```text
https://leapingfish1ee-coder.github.io/baiyue-rpg/
```

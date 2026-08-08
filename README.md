# Baiyue RPG — Hierarchical Terrain MVP

Browser MVP for deterministic, streamed, effectively-infinite 2D terrain where one macro-map pixel expands into a real playable TileMap region.

## Current world model

```text
WorldSeed
   ↓
Macro map (deterministic pixels)
   ↓ each pixel = one MacroCell
MacroCell(x, y): elevation + moisture + dominant biome
   ↓ read 3×3 macro neighborhood
Smooth macro interpolation + absolute-coordinate local detail
   ↓
64×64 playable semantic tiles
   ↓
Web Worker → Uint8Array[4096] → Canvas2D chunk cache
```

The important invariant is now:

```text
1 macro pixel = 1 streamed runtime chunk = 64 × 64 playable tiles
1 logical tile = 32 × 32 px base art/grid size
1 MacroCell = 2048 × 2048 px at camera zoom 1.0
```

The 32×32 pixel size belongs only to rendering/art assets. Rust/WASM generation, persistence and world addressing continue to use integer tile coordinates, so changing camera zoom or future display resolution does not change generated terrain.

The macro pixel is **not** nearest-neighbor enlarged. It acts as the dominant regional descriptor. Each playable tile is derived from the current macro cell plus its 8 neighbors, then receives low-amplitude local variation sampled in absolute world tile coordinates.

## Why adjacent regions remain continuous

Macro descriptors are sampled at macro-cell centers. A tile converts its absolute world coordinate back into macro-space and smoothstep-interpolates the surrounding macro centers. A cell only needs a `3×3` macro neighborhood to evaluate all of its own tiles. Adjacent cells therefore evaluate the same shared macro field instead of running independent random generators.

Local elevation/moisture detail is also sampled from absolute world tile coordinates, so local noise cannot reset at a chunk boundary.

## Edge contract

`rust/src/macro_world.rs` defines a deterministic symmetric `EdgeContract` for adjacent macro cells. For terrain-only generation the continuous field already solves seams, so the edge signature is intentionally not used to force terrain shapes. It is reserved for discrete cross-region structures such as:

- rivers,
- roads,
- walls/gates,
- cave/region entrances.

Both sides of an edge derive the same signature regardless of generation order. Future structure generators can derive shared exit positions and widths from it.

## Terrain IDs

| ID | Terrain |
|---:|---|
| 0 | DeepWater |
| 1 | Water |
| 2 | Sand |
| 3 | Grass |
| 4 | Forest |
| 5 | Rock |
| 6 | Snow |

## Runtime stack

- Rust/WASM: authoritative macro and playable terrain generation.
- FastNoiseLite: deterministic macro fields and local absolute-coordinate detail.
- Dedicated Web Worker: generation off the UI thread.
- TypeScript/Vite: camera, streaming, cache and browser lifecycle.
- Canvas2D: current validation renderer using a 32×32 px base tile grid.

No rivers, roads, buildings, collision, navigation, WFC, persistence or player edits are generated yet.

## Validation built into Rust tests

The generator currently tests:

1. same seed + same region is byte deterministic;
2. different seeds change output;
3. negative region coordinates map contiguously;
4. all semantic terrain IDs are valid;
5. adjacent `3×3` neighborhoods produce exactly the same macro field on a shared boundary;
6. opposite sides derive the same `EdgeContract`;
7. an `8×8` macro region generates identical checksums regardless of visit order.

`GENERATOR_VERSION` is `2` because the world-generation contract changed from direct tile noise to hierarchical macro-region generation. The 32×32 rendering change does not alter this generation contract.

## Run locally

Prerequisites: Node.js 22+, Rust stable, `wasm32-unknown-unknown`, and `wasm-pack`.

```bash
cd web
npm install
npm run dev
```

Rust tests:

```bash
cd rust
cargo test
```

Production build:

```bash
cd web
npm run build
```

## GitHub Pages

Pushes to `main` run Rust tests, compile Rust → WASM, type-check/build the Vite application and deploy `web/dist`.

```text
https://leapingfish1ee-coder.github.io/baiyue-rpg/
```

## Next world-generation layer

Keep the macro-cell contract stable. The next high-value addition is a discrete cross-region structure layer driven by `EdgeContract`: first rivers, then roads/POIs. Do not add WFC globally; use it only inside bounded regions that already have fixed edge exits.

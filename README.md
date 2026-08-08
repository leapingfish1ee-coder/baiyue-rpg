# Baiyue RPG — Hierarchical Terrain MVP

Browser MVP for deterministic, streamed, effectively-infinite 2D terrain where one macro-map pixel expands into a real playable TileMap region.

## Current world model

```text
WorldSeed
   ↓
Macro map: elevation + moisture
   ↓ each pixel = one MacroCell
3×3 macro neighborhood + absolute-coordinate local detail
   ↓
BaseTerrain plane (64×64)
   ├─ DeepWater
   ├─ Water
   ├─ Sand
   ├─ Land      ← primary walkable surface
   ├─ Rock
   └─ Snow
   ↓
Decoration plane (64×64, Land only)
   ├─ None
   ├─ Grass     ← sparse visual modifier
   └─ Grove     ← clustered + singleton modifier
   ↓
Web Worker → one 8192-byte ArrayBuffer → two zero-copy Uint8Array views
```

The important invariants are:

```text
1 macro pixel = 1 streamed runtime chunk = 64 × 64 playable tiles
1 logical tile art = 32 × 32 px
1 tile spacing = 4 px
1 rendered tile pitch = 36 px at zoom 1.0
```

The 32×32 art size and 4 px spacing belong only to rendering. Rust/WASM generation, persistence and world addressing continue to use integer tile coordinates.

## Base terrain vs decoration

Generator version 3 separates simulation terrain from visual surface modifiers.

Base terrain IDs:

| ID | BaseTerrain |
|---:|---|
| 0 | DeepWater |
| 1 | Water |
| 2 | Sand |
| 3 | Land |
| 4 | Rock |
| 5 | Snow |

Decoration IDs:

| ID | Decoration |
|---:|---|
| 0 | None |
| 1 | Grass |
| 2 | Grove |

Land is now the default result for ordinary non-water/non-mountain elevation. Moisture no longer replaces Land with a different base terrain. Instead it modulates decoration density.

Grass uses a deterministic per-world-tile coordinate hash, so it naturally produces isolated points and small accidental groups. Grove uses sparse deterministic cluster seeds in 8×8 coarse cells plus a low-probability singleton stream, producing small groves while still allowing isolated tree patches. Decorations are generated only when the base terrain is Land.

## Continuity

Macro descriptors are sampled at macro-cell centers. A tile converts its absolute world coordinate back into macro-space and smooth-interpolates the surrounding macro centers. A cell only needs a `3×3` macro neighborhood to evaluate all of its own tiles. Adjacent cells therefore evaluate the same shared macro field instead of running independent random generators.

Local elevation/moisture detail and decoration hashes use absolute world coordinates, so neither base terrain nor decoration randomness resets at a chunk boundary.

## Chunk payload

`generate_chunk(seed, chunk_x, chunk_y)` still performs one WASM call, but version 3 returns two contiguous byte planes:

```text
bytes 0..4095       BaseTerrain
bytes 4096..8191    Decoration
```

The Worker transfers the single owned ArrayBuffer. `ChunkManager` creates two `Uint8Array` views over the same buffer without another payload copy.

## Texture slots

The browser texture tool now reads eight 8×8 slots from left to right, top to bottom:

```text
0 DeepWater
1 Water
2 Sand
3 Land
4 Rock
5 Snow
6 Grass decoration
7 Grove decoration
```

Slots may be empty. Base terrain draws its dark base color and optional texture; Grass/Grove are separate overlays on top of Land. The HUD base-color toggle can hide the base-color layer independently.

## Edge contract

`rust/src/macro_world.rs` defines a deterministic symmetric `EdgeContract` for adjacent macro cells. For terrain-only generation the continuous field already solves seams, so the edge signature is reserved for discrete cross-region structures such as rivers, roads, walls/gates and entrances.

## Runtime stack

- Rust/WASM: authoritative macro, base-terrain and decoration generation.
- FastNoiseLite: deterministic macro fields and local absolute-coordinate detail.
- SplitMix64 coordinate hashes: sparse Grass/Grove placement independent of visit order.
- Dedicated Web Worker: generation off the UI thread.
- TypeScript/Vite: camera, streaming, cache and browser lifecycle.
- Canvas2D: base terrain and decoration rendering.
- WebGL2 overlay: animated DeepWater/Water color noise.

No rivers, roads, buildings, collision, navigation, persistence or player edits are generated yet.

## Validation built into Rust tests

The generator tests:

1. same seed + same region is byte deterministic;
2. different seeds change output;
3. negative region coordinates map contiguously;
4. BaseTerrain and Decoration IDs stay in range;
5. decorations only occur on Land;
6. Land remains the primary surface while Grass/Grove stay sparse;
7. adjacent macro neighborhoods share the same continuous field;
8. opposite sides derive the same `EdgeContract`;
9. an `8×8` macro region generates identical checksums regardless of visit order.

`GENERATOR_VERSION` is `3` because the semantic world contract changed from one terrain plane to `BaseTerrain + Decoration`.

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

Keep BaseTerrain and Decoration separate. The next high-value world layer is discrete cross-region structure generation driven by `EdgeContract`: rivers first, then roads/POIs. Collision should remain its own semantic layer rather than being inferred from textures.

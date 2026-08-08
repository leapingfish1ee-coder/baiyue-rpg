# Baiyue Terrain Sheet v3

This document defines the browser texture-sheet contract for the current BaseTerrain + Decoration renderer.

## File contract

- Format: PNG
- Exact image size: `48×16 px`
- Cell size: `8×8 px`
- Physical layout: `6 columns × 2 rows`
- Empty/transparent cells are valid.
- The browser does not broadcast or reuse another cell when a slot is empty.

## Layout

```text
Row 0 — BaseTerrain

┌────────┬────────┬────────┬────────┬────────┬────────┐
│   0    │   1    │   2    │   3    │   4    │   5    │
│ Deep   │ Water  │ Sand   │ Land   │ Rock   │ Snow   │
│ Water  │        │        │        │        │        │
└────────┴────────┴────────┴────────┴────────┴────────┘

Row 1 — Decoration / Reserved

┌────────┬────────┬────────┬────────┬────────┬────────┐
│   6    │   7    │ reserve│ reserve│ reserve│ reserve│
│ Grass  │ Grove  │        │        │        │        │
└────────┴────────┴────────┴────────┴────────┴────────┘
```

Pixel coordinates:

| Logical slot | Meaning | Cell | Source rectangle |
|---:|---|---|---|
| 0 | DeepWater | row 0, col 0 | `x=0,  y=0,  w=8, h=8` |
| 1 | Water | row 0, col 1 | `x=8,  y=0,  w=8, h=8` |
| 2 | Sand | row 0, col 2 | `x=16, y=0,  w=8, h=8` |
| 3 | Land | row 0, col 3 | `x=24, y=0,  w=8, h=8` |
| 4 | Rock | row 0, col 4 | `x=32, y=0,  w=8, h=8` |
| 5 | Snow | row 0, col 5 | `x=40, y=0,  w=8, h=8` |
| 6 | Grass decoration | row 1, col 0 | `x=0,  y=8,  w=8, h=8` |
| 7 | Grove decoration | row 1, col 1 | `x=8,  y=8,  w=8, h=8` |

The four cells at row 1, columns 2–5 are reserved and ignored by the current renderer.

## Layer semantics

BaseTerrain cells describe the material of the ground. They may use broader texture coverage because every tile has exactly one base terrain.

Decoration cells are overlays on top of Land. They should normally contain substantially more transparent area than a base texture. Grass and Grove do not replace Land and do not provide their own base color.

Current composition order:

```text
world background
  ↓
BaseTerrain dark base color
  ↓
BaseTerrain texture mask
  ↓
Grass / Grove decoration mask
  ↓
Water shader for DeepWater / Water
```

## Mask semantics

The current renderer treats the sheet as a mask-and-tint source rather than full-color sprite artwork.

Preferred PNG authoring:

- transparent pixel: no texture contribution;
- white/gray opaque pixel: texture contribution;
- RGB color in the source PNG is not the final in-game terrain color;
- the renderer applies the terrain/decor palette after extracting the mask.

For compatibility, a fully opaque cell can still be interpreted by luminance, but transparent-background PNG is the normative v3 format.

## Display scale

The source art remains `8×8 px` per cell. The current renderer displays each tile at `32×32 px` using nearest-neighbor scaling, with an additional `4 px` inter-tile gap. The sheet itself has no inter-cell gap: its physical cells are contiguous 8×8 blocks.

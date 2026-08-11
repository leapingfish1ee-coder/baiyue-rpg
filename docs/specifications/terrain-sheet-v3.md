# Terrain Sheet v3 规范

本规范定义当前浏览器 `BaseTerrain + Decoration` renderer 接受的纹理文件。

## 文件契约

- 格式：PNG。
- 精确尺寸：`48×16 px`。
- cell 尺寸：`8×8 px`。
- 布局：`6 columns × 2 rows`，cell 之间没有间隔。
- 透明或空 cell 有效；renderer 不会广播或复用其他 cell。

## 布局

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

| Logical slot | 含义 | Cell | Source rectangle |
|---:|---|---|---|
| 0 | `DeepWater` | row 0, col 0 | `x=0, y=0, w=8, h=8` |
| 1 | `Water` | row 0, col 1 | `x=8, y=0, w=8, h=8` |
| 2 | `Sand` | row 0, col 2 | `x=16, y=0, w=8, h=8` |
| 3 | `Land` | row 0, col 3 | `x=24, y=0, w=8, h=8` |
| 4 | `Rock` | row 0, col 4 | `x=32, y=0, w=8, h=8` |
| 5 | `Snow` | row 0, col 5 | `x=40, y=0, w=8, h=8` |
| 6 | `Grass` decoration | row 1, col 0 | `x=0, y=8, w=8, h=8` |
| 7 | `Grove` decoration | row 1, col 1 | `x=8, y=8, w=8, h=8` |

Row 1 的 columns 2–5 为保留 cell。当前 renderer 忽略它们。

## Layer 语义

`BaseTerrain` 表示 ground material。每个 tile 恰有一个基础地形。`Decoration` 是 `Land` 上的 overlay，不替代 `Land`，也没有独立 base color。

Canvas2D 合成顺序：

```text
black world background
  ↓ optional BaseTerrain dark base color
  ↓ BaseTerrain texture mask
  ↓ Grass / Grove decoration mask
  ↓ grid
```

Enhanced mode 中，Canvas2D 保留 background、可选 base color 和 grid；WebGL2 完整合成动态 base texture、decoration、exposure 和 cloud shadow。两条路径都必须保持 decoration 在 base 之上。

## Mask 规范化

runtime 把 sheet 视为 mask-and-tint source，不把输入 RGB 当作最终 terrain color。

- 含透明像素的 cell：输出 alpha 直接取输入 alpha。
- 所有像素 alpha 均不低于 `250` 的 cell：输出 alpha 取每个像素 `max(R, G, B)`。
- 规范化后 RGB 设为白色，再由 runtime palette 着色。

推荐使用透明背景、白色或灰色前景。全不透明 RGB 转 mask 是当前实现仍接受的路径，但不是新资产的推荐格式。

## 显示尺度

source art 每格保持 `8×8 px`。renderer 使用 nearest-neighbor 将 tile art 显示为 `32×32 px`，并加入 `4 px` tile gap，因此 zoom 1.0 的 tile pitch 为 `36 px`。这些数字只属于渲染；生成、导航和世界 addressing 使用整数 tile 坐标。

## 浏览器保存

上传文件必须通过 MIME（若浏览器提供）和精确尺寸校验。当前实现把不超过 `1,500,000` 字符的 data URL 保存到 `localStorage` key `baiyue-rpg:terrain-sheet:v3`。文件过大或 storage 被拒绝时，只在当前 session 应用。

这不是游戏世界持久化。MVP 不承诺读取 Terrain Sheet v2；当前代码仍清理 v2 storage key，该旧路径记录为[技术债](../product/current-state.md#已知技术债)。

## 一致性要求

下列位置必须保持同一尺寸、槽位和语义：

- `web/src/renderer.ts`；
- `web/src/texture-tool.ts`；
- `web/src/texture-shader.ts`；
- `web/index.html` UI copy；
- `web/public/sprites/terrain-sheet.png`；
- 浏览器测试；
- 本规范。

当前仓库尚未满足完整一致性：`web/public/sprites/terrain-sheet.png` 是未被源码引用的 `64×64` 旧资产，现有 Playwright 也没有覆盖 v3 上传和槽位。两项均记录在[当前状态](../product/current-state.md#已知技术债)，本次文档变更不修改资产或测试。

# Streaming 与渲染

## 数据流

1. `ChunkManager` 根据 camera 和 viewport 计算可见范围，并额外 preload 一圈 chunk。
2. 主线程向 dedicated Worker 发送 `seed`、chunk 坐标、`requestId` 和 `epoch`。
3. Worker 调用 WASM `generate_chunk`，复制到独立 `Uint8Array`，再转移其 `ArrayBuffer`。
4. `ChunkManager` 校验 epoch、请求身份和 `8192` 字节长度。
5. 主线程从同一 buffer 创建 `baseTiles` 和 `decorations` 两个 view，并放入内存 cache。
6. Canvas2D 和可选 WebGL2 读取同一 chunk 数据。

当前 cache 上限是 `144` 个 chunk，Canvas surface cache 上限是 `32`。这些是当前实现参数，不是产品永久规格。

## 请求生命周期契约

目标契约如下：

- 生成必须在 Worker 内完成，不阻塞 UI 线程。
- 限制 outstanding work；优先当前可见中心，再处理外围可见区和 preload。
- 请求在成功、失败、取消或 epoch 失效后都必须离开 `pending`。
- stale epoch 的结果和错误都不得改变当前 cache 或错误状态。
- 只对确定为瞬时的错误执行有界重试；永久错误应显示，同时允许其他 chunk 继续工作。
- Worker/WASM/main-thread 每一边界都校验消息身份、整数范围、版本和 payload shape。

当前实现尚未满足错误清理、stale error、并发上限、距离优先级和 retry policy。它们是[已知技术债](../product/current-state.md#已知技术债)，不能被本文的目标契约误写为现状。

## 渲染所有权

Canvas2D 拥有世界可用性；WebGL2 是 progressive enhancement。

### Enhanced mode

```text
world + texture data
        │
        ├─ Canvas2D: black background + optional base colors + grid
        └─ WebGL2: complete dynamic base/decor textures + exposure + cloud shadows
```

WebGL2 使用一个 `TEXTURE_2D_ARRAY` 承载 8 个活动纹理槽。基础和修饰在 shader 中按层合成，`Decoration` 位于 `Land` 基础之上。所有视觉噪声使用 world-space 坐标，避免 chunk 边界重置。

### Canvas2D mode

```text
world + in-memory texture sprites
        ↓
Canvas2D: black background + optional base colors + base textures + decorations + grid
```

Canvas2D 必须仅用当前内存 chunk 和 texture data 重建完整静态世界。它不能依赖 WebGL resource、世界重新生成、页面刷新或网络请求。

WebGL2 创建失败、shader/resource 初始化失败、`webglcontextlost`、`gl.isContextLost()` 或 draw 后 WebGL error 时，应用禁用并隐藏 GPU canvas、清除 Canvas surface cache，并在下一帧使用完整 Canvas2D。GPU controls 随后在当前 session 禁用。

这项切换是运行时韧性，不是旧协议或旧存档兼容。取舍见[ADR-0001](../decisions/0001-rendering-resilience.md)。

## 视觉契约

`WATER_VISUAL_BASELINE_VERSION` 当前固定为 `b67e8bad260b3816447e067fcedd2524da0c46f3`。水面基线包含旋转三 octave world-space value noise、quintic interpolation、无 texture displacement、动态 brightness、ambient water color 和现行 alpha composition。

修改接受的视觉算法必须是显式视觉决策，并提供 before/after screenshot evidence。`?shaderTime=<seconds>` 可冻结动画；`?shader=off` 强制完整 Canvas2D。源码字符串断言只证明代码块未变，不能证明像素输出未变。

Terrain Sheet 的 layer 和 mask 规则见[Terrain Sheet v3](../specifications/terrain-sheet-v3.md)。

## 坐标精度

Canvas2D 当前以 JavaScript number 计算 full-world pixel 坐标。WebGL2 instance buffer 当前直接写入 full-world tile 坐标，并以 `Float32Array` 上传；camera uniform 也是 float32。该实现会在远距离丢失 tile 精度。

目标契约要求使用 chunk-local 或 camera-relative 坐标，并传递明确 origin。完成重构和边界测试前，不得宣称 distant rendering 精度或无限世界范围。

[自由向量移动协议](../requirements/movement-navigation-protocol.md#坐标)规定 gameplay `WorldPoint` 使用整数 nav units 和 canonical decimal strings。实现 render bridge 时，必须先相对 camera origin 重基准化，再转换为 `Number`/float；renderer 插值不能回写 gameplay state。该 Accepted 契约尚未实现，也不改变本节对当前实现的事实审计。

## 测试边界

现有 Playwright 测试验证 WebGL2 正常启动、强制不可用和 context loss 后世界仍可显示。现有 water test 固定源码 block 和版本标识；仓库尚无生产地图 screenshot golden。渲染所有权或 failure path 改动必须同时测试正常 WebGL2、`?shader=off`、强制不可用和 context loss。

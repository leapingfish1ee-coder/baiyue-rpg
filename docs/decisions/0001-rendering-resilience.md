# ADR-0001：Canvas2D 拥有世界可用性

- 状态：Accepted
- 日期：2026-08-08
- 决策范围：浏览器 terrain renderer

## 背景

首次 WebGL2 集成让 GPU layer 持有 active textures。WebGL2 在启动后发生 context loss 或 runtime error 时，Canvas2D 无法独立恢复完整纹理，造成世界可用性风险。

第一轮修复让完整 Canvas2D textures 始终显示在 WebGL2 下方。为避免重复合成，water shader 被改成低 alpha modulation overlay，导致已接受的水面视觉明显变化。问题来自把两个要求混为一体：fallback 必须随时可重建，不代表 fallback pixels 必须始终参与 enhanced compositing。

## 决策

Canvas2D 拥有 world availability，WebGL2 只作为 progressive enhancement：

- Enhanced mode 中，Canvas2D 绘制 background、可选 base colors 和 grid；WebGL2 完整绘制动态 base/decor textures、exposure 和 cloud shadows。
- Canvas fallback mode 中，Canvas2D 从当前内存 chunk 和 texture sprites 完整绘制 base textures 与 decorations。
- WebGL2 failure 后，应用禁用 GPU layer、清除 Canvas surface cache，并在下一帧切换到完整 Canvas2D。
- fallback 不得要求 regeneration、reload、WebGL resource 或 network request。
- `WATER_VISUAL_BASELINE_VERSION` 单独固定已接受的 enhanced water composition。韧性重构不能暗中改写视觉契约。

这项机制是运行时韧性，不是旧协议、旧资源或旧存档兼容。

## 后果

正面结果：

- GPU failure 不再让世界纹理消失。
- Enhanced renderer 可以保留完整的动态视觉算法，不必强制降级为透明 overlay。
- 可用性测试与视觉回归测试拥有清晰、独立的验收边界。

成本与风险：

- Renderer 必须保留足以重建 Canvas surfaces 的内存数据和 CPU texture sprites。
- mode 切换必须清除依赖渲染所有权的 surface cache。
- Canvas2D 和 WebGL2 必须分别保持 base/decor layer 语义一致。
- 现有 source-level water assertion 只能固定代码文本，仍需 screenshot golden 才能证明视觉输出。

## 被否决方案

### WebGL2 独占纹理

实现简单，但 context loss 后没有完整非 GPU 世界。启动 fallback 不能覆盖运行期 failure。

### Canvas2D 完整纹理永久垫底

fallback pixels 始终存在，但迫使 enhanced path 采用不同 compositing，已经造成 water visual regression。它还混淆“可重建”与“同时可见”。

### 完全移除 WebGL2

可降低 failure surface，但会放弃已接受的动态纹理、曝光和 world-space cloud shadows，不满足现有视觉目标。

## 验证

- 强制 WebGL2 unavailable 时，Canvas2D 显示非黑世界。
- 正常 SwiftShader WebGL2 必须进入 `enhanced`，不能用静默 fallback 掩盖 shader 初始化错误。
- 强制 `WEBGL_lose_context` 后必须进入 Canvas fallback，世界保持可见。
- `?shader=off` 必须强制完整 Canvas2D。
- `?shaderTime=<seconds>` 用于冻结视觉诊断和未来 screenshot golden。

现行实现契约见[Streaming 与渲染](../architecture/streaming-rendering.md)。

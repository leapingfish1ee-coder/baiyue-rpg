# 架构总览

## 当前边界

```text
World seed + generator version + chunk coordinates
                         │
                         ▼
              Rust deterministic generator
                         │ WASM: 8192-byte payload
                         ▼
                dedicated Web Worker
                         │ transferable ArrayBuffer
                         ▼
                 ChunkManager cache
                    ┌────┴────┐
                    ▼         ▼
                 Canvas2D   WebGL2
                 完整静态    可选动态增强
```

当前系统只覆盖确定性地形生成、浏览器 streaming 和渲染。未来 RPG 必须新增玩家世界状态、导航、玩法和持久化层，不能把这些语义塞进生成器或纹理。

## Accepted 玩法运行时目标

[存档与离线结算协议](../requirements/save-offline-protocol.md)接受以下目标运行时。它尚未实现；当前仓库仍不存在 gameplay worker 或 IndexedDB gameplay save。

```text
main thread UI / rendering
          │ validated commands / read model
          ▼
   gameplay worker ──► deterministic gameplay engine
          │
          └──────────► IndexedDB gameplay save

   generator worker ─► terrain WASM ─► terrain chunk cache
```

目标架构把 gameplay worker 设为玩法状态、事件时间、离线快进和存档的唯一写入者。现有 generator worker 继续独占 terrain WASM 调用。两条 worker 边界不能合并，也不能让 main thread 直接改写 gameplay state。

## 分层职责

| 层 | 责任 | 禁止承担 |
|---|---|---|
| 世界生成 | 由 `seed`、`GENERATOR_VERSION` 和绝对坐标生成稳定地形语义 | 玩家发现、任务进度、角色状态、渲染样式 |
| 玩家世界状态 | 已揭示地图、可见目标、特殊发现和未来玩家改动 | 改写确定性基础地形 |
| 导航与碰撞 | Accepted fixed-point `WorldPoint`、角色圆、weighted Theta*、通行成本、可达性与整数毫秒 motion event | 从纹理颜色或 mask 反推规则，或读取迷雾后 terrain |
| 玩法模拟 | 任务、技能、遭遇、战斗、奖励和时间推进 | 依赖帧率或渲染结果 |
| 持久化 | 保存版本化玩家状态和已结算结果 | 当前尚未实现，不得由 `localStorage` 调试设置冒充 |
| streaming | 请求、epoch、优先级、cache 和失败策略 | 改变生成语义 |
| 渲染 | 展示已有 world/chunk/texture 数据 | 成为世界数据唯一持有者 |

## 仓库映射

- `rust/`：权威确定性世界生成，以及 native tests。
- `web/src/generator-worker.ts`：唯一 WASM 生成调用桥接层。
- `web/src/protocol.ts`：Worker 消息类型。
- `web/src/chunk-manager.ts`：请求生命周期、epoch 和内存 chunk cache。
- `web/src/renderer.ts`：Canvas2D 世界背景、底色、网格、surface cache 和完整静态纹理。
- `web/src/texture-shader.ts`：可选 WebGL2 动态纹理、曝光和世界空间云影。
- `web/src/texture-tool.ts`：Terrain Sheet v3 校验、规范化、预览和浏览器保存。
- `web/tests/`：Chromium/Playwright 运行时、fallback、光照和调试控制测试。
- `.github/workflows/pages.yml`：生产构建、测试和 Pages 部署门禁。

## Runtime stack

- Rust/WASM：权威 macro、`BaseTerrain` 和 `Decoration` 生成。
- FastNoiseLite：macro fields 和绝对坐标 local detail。
- SplitMix64 coordinate hashes：与访问顺序无关的稀疏 `Grass`/`Grove` 放置和对称 edge signature。
- Dedicated Web Worker：把生成移出 UI 线程。
- TypeScript/Vite：camera、streaming、cache 和浏览器 lifecycle。
- Canvas2D：世界 background、base colors、grid 和完整 static texture path。
- WebGL2：8 个纹理槽的动态着色、exposure 和 world-space cloud shadows。

## 核心契约

- 世界生成：[世界生成架构](world-generation.md)。
- 玩法与玩家状态：[玩法状态边界](gameplay-state.md)。
- 存档与离线恢复：[存档与离线结算协议](../requirements/save-offline-protocol.md)（Accepted，尚未实现）。
- 自由向量移动、导航、迷雾与目标索取：[移动协议](../requirements/movement-navigation-protocol.md)（Accepted；fixtures 与 benchmark 属于实现验收）。
- Worker、streaming 与渲染：[Streaming 与渲染](streaming-rendering.md)。
- 纹理文件：[Terrain Sheet v3](../specifications/terrain-sheet-v3.md)。
- 渲染韧性决策：[ADR-0001](../decisions/0001-rendering-resilience.md)。

## 当前限制

- 没有玩家世界状态、导航、玩法模拟或游戏持久化实现。
- 浏览器 camera 和 chunk 坐标受 JavaScript safe integer、Rust `i64`、噪声采样和 float32 GPU 精度共同约束；当前没有经过验证的端到端范围。
- 当前 streaming 尚未满足目标并发、优先级、失败清理和 stale epoch 错误契约。详见[当前状态](../product/current-state.md#已知技术债)。
- Accepted 首个切片架构尚未实现；实现状态只能由源码与[当前状态](../product/current-state.md)更新，不能由规范状态推断。

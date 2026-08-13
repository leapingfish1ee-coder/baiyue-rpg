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

当前系统同时包含确定性地形生成、浏览器 streaming/rendering，以及阶段 1 至 2C 的玩家世界状态、导航、生活技能任务和本地持久化。生成、玩家世界状态、玩法模拟和渲染保持分层；尚未实现的战斗、死亡与叙事也不得进入生成器或纹理语义。

## 玩法运行时

[存档与离线结算协议](../requirements/save-offline-protocol.md)接受的以下运行时已用于阶段 1 至 2C：

```text
main thread UI / rendering
          │ validated commands / read model
          ▼
   gameplay worker ──► deterministic gameplay engine
          │
          └──────────► IndexedDB gameplay save

   generator worker ─► terrain WASM ─► terrain chunk cache
```

gameplay worker 是玩法状态、事件时间、离线快进和存档的唯一写入者。generator worker 继续独占 terrain WASM 调用。两条 worker 边界不能合并，main thread 不能直接改写 gameplay state。

## 分层职责

| 层 | 责任 | 禁止承担 |
|---|---|---|
| 世界生成 | 由 `seed`、`GENERATOR_VERSION` 和绝对坐标生成稳定地形语义 | 玩家发现、任务进度、角色状态、渲染样式 |
| 玩家世界状态 | 已揭示地图、可见目标、特殊发现和未来玩家改动 | 改写确定性基础地形 |
| 导航与碰撞 | Accepted fixed-point `WorldPoint`、角色圆、weighted Theta*、通行成本、可达性与整数毫秒 motion event | 从纹理颜色或 mask 反推规则，或读取迷雾后 terrain |
| 玩法模拟 | 任务、技能、遭遇、战斗、奖励和时间推进 | 依赖帧率或渲染结果 |
| 持久化 | 通过 IndexedDB 四-store 事务保存版本化玩家状态和已结算结果 | 由 `localStorage` 调试设置冒充 gameplay save |
| streaming | 请求、epoch、优先级、cache 和失败策略 | 改变生成语义 |
| 渲染 | 展示已有 world/chunk/texture 数据 | 成为世界数据唯一持有者 |

## 仓库映射

- `rust/`：权威确定性世界生成，以及 native tests。
- `web/src/generator-worker.ts`：唯一 WASM 生成调用桥接层。
- `web/src/gameplay-worker.ts`：唯一 gameplay authority、离线推进和持久化协调者。
- `web/src/gameplay/`：确定性事件引擎、内容表、严格契约、导航、玩家世界状态和 IndexedDB schema。
- `web/src/gameplay-client.ts`：main thread 到 gameplay worker 的命令/read-model 桥接。
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
- 存档与离线恢复：[存档与离线结算协议](../requirements/save-offline-protocol.md)；阶段 2C 精确增量见[阶段 2C 运行时契约](../specifications/phase-2c-runtime-contracts.md)。
- 自由向量移动、导航、迷雾与目标索取：[移动协议](../requirements/movement-navigation-protocol.md)（Accepted；fixtures 与 benchmark 属于实现验收）。
- Worker、streaming 与渲染：[Streaming 与渲染](streaming-rendering.md)。
- 纹理文件：[Terrain Sheet v3](../specifications/terrain-sheet-v3.md)。
- 渲染韧性决策：[ADR-0001](../decisions/0001-rendering-resilience.md)。

## 当前限制

- 阶段 1 至 2C 只覆盖探索、采集、伐木、采矿、手工工艺和工具升级。战斗、死亡、叙事、工作站与锻造尚未实现。
- gameplay 坐标使用有边界的 canonical integer `WorldPoint`；renderer 只接收 camera-relative `Number`/float。完整范围见移动协议与边界 fixture。
- 当前实现状态、已知技术债和未实现范围以[当前状态](../product/current-state.md)为准。

# 当前状态

审计基准：2026-08-09，依据仓库源码、测试、package scripts 和 Pages workflow。

## 已实现

### 确定性世界生成

- Rust 是地形语义的权威实现，并编译为 native tests 和 WebAssembly。
- `GENERATOR_VERSION` 当前为 `3`。
- 一个 macro cell 对应一个 `64×64` runtime chunk。
- `generate_chunk(seed, chunk_x, chunk_y)` 返回 `8192` 字节：前 `4096` 字节是 `BaseTerrain`，后 `4096` 字节是 `Decoration`。
- `BaseTerrain` 包含 `DeepWater`、`Water`、`Sand`、`Land`、`Rock`、`Snow`；`Decoration` 包含 `None`、`Grass`、`Grove`。
- `Decoration` 只生成在 `Land`。宏观场跨 chunk 连续，局部细节和修饰使用绝对世界坐标。
- `EdgeContract` 能为相邻 macro cell 生成对称签名，但尚未用于河流、道路或其他跨区结构。

### 浏览器运行时

- `generator-worker.ts` 是 UI 线程与 WASM 生成器之间的桥接层。
- `ChunkManager` 使用 epoch 区分 seed，维护内存 cache，最多保留 `144` 个 chunk。
- Worker 转移一个 `ArrayBuffer`；主线程创建两个 `Uint8Array` 视图。
- 相机支持拖拽、键盘移动和 `0.35–4` 倍缩放。
- Canvas2D 绘制黑色背景、可选地形底色、网格和完整静态纹理。
- WebGL2 渐进增强绘制 8 个纹理槽、动态纹理、曝光和世界空间云影；初始化失败、context loss 和运行错误会切到 Canvas2D。
- `WATER_VISUAL_BASELINE_VERSION` 当前为 `b67e8bad260b3816447e067fcedd2524da0c46f3`。
- Terrain Sheet v3 接受严格 `48×16` PNG，支持预览、浏览器本地保存和恢复。
- 调试面板可调整并保存纹理/光照参数，导出调试 JSON；Lighting Lab 提供独立光照实验页。

### 自动化

- Rust tests 覆盖 payload 长度、确定性、seed 差异、负坐标、ID 范围、`Land` 限制、稀疏修饰、共享边界场、对称 `EdgeContract` 和访问顺序独立性。
- Playwright 覆盖 WebGL2 初始化、强制不可用、context loss、渲染参数、本地保存、调试导出和光照诊断模式。
- Pages workflow 使用 Rust stable、Node.js 22 和 `wasm-pack 0.15.0`，通过 Rust tests、生产构建和 Chromium smoke tests 后部署。

## 未实现

当前没有可玩 RPG 系统，包括：

- 角色、移动语义、碰撞、导航和可达性；
- 技能等级、经验、内容解锁、装备软专精或目标熟练度；
- 任务、采集、伐木、采矿、生产、狩猎和自动执行；
- 迷雾、世界知识、探索经验、地标或叙事线索；
- 敌人、侦测、潜行、战斗、生命/法力、增益/减益、经验、战利品、死亡或复活；
- 离线任务模拟、回归报告、游戏规则版本或存档 schema；
- 游戏世界状态、任务状态、奖励或角色状态持久化；
- 河流、道路、建筑、POI、玩家编辑、地下城或敌群/波次；
- 网络、异步交互、自由市场或任何多人接口。

浏览器 `localStorage` 只保存 Terrain Sheet、shader/光照参数和面板状态，不等于游戏状态持久化。

## 已知技术债

| 技术债 | 当前证据 | 风险 |
|---|---|---|
| 缺少固定 golden checksum fixtures 和 native/WASM 对照 | Rust tests 只在运行时比较结果或访问顺序，没有提交代表性 checksum 向量 | 无法证明同一版本的跨构建输出一致；下次生成语义变更前必须补齐 |
| 缺少 `Cargo.lock` 和前端 lockfile | 仓库未提交 lockfile | 依赖虽写明精确版本，完整依赖图仍可能漂移 |
| Worker 错误不会清理对应 `pending` | `ChunkManager` 的 `error` 分支只写入状态 | 失败坐标可能在当前 epoch 内永久无法重试 |
| stale epoch 错误仍会显示 | `error` 分支没有先校验 epoch | 旧 seed 的错误可能污染新 seed 状态 |
| 请求无并发上限、距离优先级和重试策略 | `ensureVisible` 按矩形循环直接发送全部缺失 chunk | 大视口或快速移动时可能堆积工作，并延迟可见中心 |
| GPU 使用完整世界 float32 坐标 | instance attribute 写入 `baseX + localX`，camera uniform 也是 float | 远距离 tile 精度没有保证；仓库也没有端到端坐标范围文档和边界测试 |
| JavaScript/WASM 坐标范围未形成统一契约 | chunk 请求先受 `Number.isSafeInteger` 限制，再转换为 `BigInt`/Rust `i64` | 不能宣称无限精度或完整 `i64` 范围可用 |
| 保留旧兼容路径 | `Chunk.tiles` 别名、旧 shader 参数迁移、Terrain Sheet v2 storage key 清理仍存在 | 增加状态分支；MVP 政策已不要求旧格式兼容，应另行删除并验证 |
| Terrain Sheet 默认资产不符合 v3 | `web/public/sprites/terrain-sheet.png` 是未被源码引用的 `64×64` PNG，不是规范要求的 `48×16` | 资产名称会误导维护者，且无法作为 v3 示例或 fixture |
| Terrain Sheet v3 缺少浏览器测试 | 现有 Playwright 未覆盖 PNG 类型/尺寸校验、槽位提取、保留槽或 storage failure | code、UI、资产和规范可能再次漂移 |

本页只记录技术债，不授权在文档任务中修改实现。

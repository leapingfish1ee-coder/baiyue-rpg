# Baiyue RPG 执行护栏

完整文档入口：[`docs/index.md`](docs/index.md)。先按真源地图定位需求、架构、规范和验证标准，不在本文件复制正文。

## 硬性规则

- 将仓库描述为“确定性流式地形引擎 MVP”，不得把未实现的 RPG 系统写成现状。
- 世界生成、玩家世界状态、渲染和玩法语义必须分层。
- 技能与任务必须遵守 [`docs/requirements/index.md`](docs/requirements/index.md)；平衡数值必须标记为“首轮平衡基线”，不得写成已实现事实。
- MVP/demo 产品规则变更时直接修订真源并删除旧规则；不得为废弃需求增加兼容层。
- 一个 macro cell 等于一个 `64×64` runtime chunk。
- `generate_chunk` 必须返回 `8192` 字节：`4096` 字节 `BaseTerrain`，再接 `4096` 字节 `Decoration`。
- `Decoration` 只能出现在 `Land`；碰撞和导航不得从纹理推断。
- 生成结果只能取决于 `seed`、`GENERATOR_VERSION` 和绝对整数世界坐标；禁止访问顺序、全局可变 RNG、帧时间和 chunk 内重置的随机流。
- 负坐标必须连续；相邻 chunk 必须采样同一连续场；离散跨区结构必须使用对称、版本化的 `EdgeContract`。
- 任何可能改变生成字节的改动都必须显式修改 `GENERATOR_VERSION`，并更新固定 golden checksums。MVP 不保留旧生成器、旧世界或旧存档，也不写迁移层。
- 生成必须留在 Worker。请求在成功、失败、取消或 epoch 失效后都必须离开 `pending`；忽略 stale epoch 的结果和错误。
- 限制并发任务；优先可见中心，再处理 preload；只对瞬时错误做有界重试。
- 禁止把未重基的完整世界坐标写入 float32 GPU attribute。坐标范围必须有文档和边界测试。
- Canvas2D 拥有世界可用性。WebGL2 初始化失败、context loss 或运行错误后，必须在一帧内切到完整 Canvas2D，不得重新生成、刷新或联网。
- 保留 `WATER_VISUAL_BASELINE_VERSION` 对应视觉契约。视觉改动必须提供冻结时间的前后截图证据；源码断言不能替代视觉证据。
- Terrain Sheet v3 必须在代码、UI、测试、默认资产和规范中一致：PNG、`48×16`、`6×2`、每格 `8×8`、6 个基础槽、2 个修饰槽、4 个保留槽。
- 保持 TypeScript strict；校验 Rust/WASM/Worker/main-thread 边界；协议或 payload 变化必须同步类型、版本、测试和文档。
- 不手工修改 `web/public/wasm/` 生成文件；通过 package script 重建。
- 不新增生产依赖，除非说明现有平台和仓库代码为何不足。
- 保留用户改动。未经明确授权，不得 commit、push、PR、部署或改写历史。

## 验证路由

- Rust 或世界语义：按 [`docs/engineering/validation.md#rust-或世界语义变更`](docs/engineering/validation.md#rust-或世界语义变更) 执行。
- TypeScript、UI、Worker 或渲染：按 [`docs/engineering/validation.md#typescriptuiworker-或渲染变更`](docs/engineering/validation.md#typescriptuiworker-或渲染变更) 执行。
- 仅文档：核对源码事实、检查链接和 `git diff/status`，无需运行无关渲染测试。
- 工具不可用时，必须逐项报告未运行检查及原因；CI 不能证明未在本地执行的验证。

## 完成条件

- 行为位于正确语义层；边界与失败路径有测试。
- 相关检查通过，或明确列出未运行项。
- 文档只陈述当前事实、已确认要求和已标记的不确定性。
- `git status --short` 只包含预期改动。

# 阶段 1：探索垂直切片实施包

- 状态：Implemented；验证结果和剩余技术债以[当前状态](../product/current-state.md)及验证记录为准
- 前提：[Decision-0003](../decisions/0003-first-playable-slice-baseline.md) 已 Accepted
- 适用范围：首个可运行的端到端 gameplay 阶段
- 当前实现：阶段 1 探索主路径已落地；以[当前状态](../product/current-state.md)为准

## 交付目标

交付一个真实可运行的探索闭环：玩家创建本地世界，设置持续探索或带目的地的探索任务；角色在现有确定性地形上按 Accepted 自由向量协议自动移动，永久揭露迷雾并获得 `Exploration XP`；gameplay state 原子保存；关闭页面后按同一事件语义离线推进；重新打开后从已提交状态继续。

产品根使用最小 map-first shell。产品 UI 与现有 terrain、texture、lighting 调试工具分离。本阶段必须贯通 terrain、gameplay engine、Worker、存档、离线、UI 和渲染回退，不接受“模块已创建”“接口已占位”或仅有测试桩作为完成证据。

本包只拆解实现工作，不重述产品规则。冲突时按以下真源处理：

1. [Decision-0003](../decisions/0003-first-playable-slice-baseline.md)；
2. [自由向量移动、导航、迷雾与目标索取](../requirements/movement-navigation-protocol.md)；
3. [存档与离线结算协议](../requirements/save-offline-protocol.md)；
4. [玩法界面信息架构](../requirements/gameplay-information-architecture.md)；
5. [探索与目标索取](../requirements/exploration.md)与[玩法状态边界](../architecture/gameplay-state.md)；
6. [世界生成](../architecture/world-generation.md)、[Streaming 与渲染](../architecture/streaming-rendering.md)和 [Terrain Sheet v3](../specifications/terrain-sheet-v3.md)。

MVP 中的新规则直接替换旧规则。专项不得为本包创建旧任务、旧存档、旧移动或旧 UI 兼容层。

## 用户可观察的完成结果

阶段完成后，用户必须能够：

1. 在无存档时创建一个 unsigned 64-bit seed 世界。
2. 看到地图、角色位置、永久迷雾、保存状态和当前活动状态。
3. 在 Task drawer 选择持续探索，或预填并确认一个连续 `WorldPoint` 目的地。
4. 看到角色沿包含非 `45°` 航向的路线自动移动。
5. 看到首次揭露 tile、`Exploration XP` 和等级状态持久变化。
6. 取消唯一探索任务，并看到角色停止主动移动。
7. 刷新或重新打开页面，恢复已提交位置、迷雾、XP 和任务。
8. 在离线处理提交后查看 credited time、状态变化、XP 和停止原因。
9. 在 WebGL2 不可用或丢失时继续使用 Canvas2D，并保留同一 gameplay state。

## 范围边界

### 必须实现

- 一个不依赖 DOM、renderer 或帧循环的纯 gameplay engine。
- gameplay worker、terrain broker、IndexedDB save、离线 claim 和单写入者锁。
- 新世界创建、营地 anchor、探索任务、自由向量导航、永久揭雾和探索经验。
- map-first 最小产品壳、Explore Task drawer、save/offline System UI 和 Debug 分离。
- 本文规定的 unit、integration、E2E、回归和性能证据。

### 明确不实现

- 采集、伐木、采矿、生产、狩猎和对应资源或工作站执行；
- 库存、装备、掉落和物品定义；
- 敌人、潜行、战斗、死亡、复活和 `RevivalGrace` runtime；
- 碎片叙事、`Journal`、`Fact`、`Insight` 或 `Lead`；
- `探索` 之外的技能；
- 多人、市场、异步交互或服务器时间；
- 手动角色移动、WASD gameplay command、摇杆或点击地面即时移动；
- navmesh、Recast/Detour、动态障碍或 crowd avoidance；
- 旧协议、旧 schema、旧任务或旧 UI 兼容层。

产品 UI 不显示上述系统的入口、disabled placeholder、空面板或灰色未来功能。

## 编码前门禁

精确实现契约见[阶段 1 运行时契约](../specifications/phase-1-runtime-contracts.md)。Gate A 已通过 `npm run test:contract` 封闭 ID、Worker/UI union、command 幂等、IndexedDB schema、backup/error code 和 benchmark runner。Gate B 已通过 `npm run fixture:anchor` 使用正式搜索与实际 WASM generator v3 物化 `168h` fixture 的 start/checksum。两项编码前门禁均已闭合；这不表示 `168h` performance fixture 已运行或通过。

专项必须先在 `docs/` 写入并交叉链接以下实现级契约。它们只能细化 Accepted 边界，不能改变产品方向：

| 契约 | 必须封闭的内容 | 最低验收 |
|---|---|---|
| stable ID grammar | `save_id`、command ID、event ID、chunk key、content placement ID 和 diagnostic ID 的语法、排序与唯一性 | 正反例、规范化和稳定排序 fixture |
| Worker/UI protocol | discriminated unions、request/response correlation、read-model revision、command accepted/rejected、错误码和传输边界 | exhaustive TypeScript 检查、未知消息拒绝和协议 fixture |
| command idempotency | `CreateWorld`、`SetTask`、`CancelTask`、import/reset 的重复提交与重试语义 | 相同 command ID 不重复应用状态变化或 revision |
| IndexedDB schema | database name、store keyPath、record key、transaction ownership、dirty chunk 集合和 revision 规则 | schema 创建、原子提交、失败回滚和版本不匹配 fixture |
| backup canonicalization | JSON 字段顺序、decimal string、UTF-8 bytes、SHA-256 输入、size limit、未知字段和 error code | 相同状态产生相同 bytes/checksum；非法输入不改变存档 |
| navigation benchmark | fixture seed、起点、持续时间、CI runner image/resources、采样方法、heap 口径和 profile 输出 | 本文性能门槛可重复执行并比较 |

门禁未完成时，不得以临时代码常量、宽松 `Record<string, unknown>`、隐式 keyPath 或任意错误字符串开始持久化和 Worker 集成。

## 权威运行时边界

### Gameplay engine 与 Worker

- gameplay worker 是 gameplay state、`world_time_ms`、事件顺序、command、read model、offline fast-forward 和 save 的唯一写入者。
- 纯 gameplay engine 与 Worker host 分离。engine 输入只包含已验证 command、确定性 terrain/content 数据和整数时间推进请求；输出是权威状态变化、terrain request、save intent 和 read model。
- main thread 只代理 terrain 请求、验证 UI/Worker 边界、转发 command 并渲染 read model。main thread 不计算路径、XP、迷雾、离线结果或保存状态。
- renderer 只接收 camera-relative `Number`/float。renderer 插值不能回写 command、snapshot、autosave 或 gameplay state。
- Worker processing 按预算分片并报告进度。yield 只暂停计算，不推进或丢弃 `world_time_ms`。

### Terrain bridge

- 现有 `generator-worker.ts` 继续是 WASM `generate_chunk` 的唯一调用者。
- gameplay worker 通过 main-thread broker 请求 canonical chunk coordinates。它不能导入 WASM generator、复制 terrain 公式或维护第二套生成器。
- broker 必须关联 request ID、gameplay revision/epoch 和 canonical coordinate，并拒绝 stale response。
- chunk generation、加载和分片搜索属于基础设施等待，不消耗 `world_time_ms`。
- terrain 数据返回后，online、offline 和 reload 都从同一 gameplay engine 入口继续。

### 初始版本常量

首个实现固定使用：

| 常量 | 初值 |
|---|---:|
| `DB_SCHEMA_VERSION` | `1` |
| `SAVE_SCHEMA_VERSION` | `1` |
| `GAME_RULES_VERSION` | `1` |
| `CONTENT_VERSION` | `1` |
| `EXPORT_FORMAT_VERSION` | `1` |

`GENERATOR_VERSION` 必须从现有 generator worker/WASM ready contract 读取并写入存档，不得在 gameplay 模块复制源码数值。任一必需版本不匹配时拒绝加载；允许导出原始存档，并在用户明确确认后重置。MVP 不迁移、不兼容读取，也不自动删除不兼容存档。

## 工作包与验收

除非工作包另行注明，责任主体均为接手阶段 1 的 Codex 专项任务。专项必须按顺序交付工作包 `0–7`；后续包可以与已通过门禁的前序包并行开发，但不能跳过前序通过条件。

### 工作包 0：契约、fixtures 与测试入口

动作：

1. 完成“编码前门禁”中的六份精确契约。
2. 建立纯 engine、Worker integration、IndexedDB、E2E 和 performance 的测试入口。
3. 把新增命令写入 `package.json` 并在[开发说明](development.md)和[验证标准](validation.md)记录其准确动作。
4. 固定 benchmark runner 和 fixture 输入，不使用随机当前时间或访问顺序。

通过条件：新专项可以只依靠仓库文档确定 message、ID、store、backup 和 benchmark 语义；所有测试命令能够在空实现阶段明确失败，而不是静默跳过。

### 工作包 1：纯 engine、gameplay worker 与 terrain broker

动作：

1. 建立纯 gameplay engine 和 Worker host，保持 TypeScript strict。
2. 建立 command validation、idempotency、read-model revision 和 stable error code。
3. 实现 main-thread terrain broker，复用现有 generator worker。
4. 在 terrain 未就绪时暂停 engine，并向 UI 提供基础设施 processing 状态。
5. 保持 `ChunkManager`、Canvas2D 和 WebGL2 现有数据所有权，不让 gameplay worker 持有 GPU 或 DOM 状态。

通过条件：相同 command/terrain/time 输入在直接 engine harness 与 Worker host 中产生相同状态、terrain request 和 read model；stale、duplicate 和 malformed message 不改变权威状态。

### 工作包 2：新世界与初始状态

动作：

1. 接受自动生成或手动输入的 unsigned 64-bit seed，并使用 canonical decimal string。
2. 按 Accepted 起始区域规则确定性搜索营地 anchor。默认 seed 可以在首次事务前按规则确定性重试；手动 seed 失败时明确拒绝，不静默换 seed。
3. 在可站立 anchor 上创建 fixed-point `WorldPoint`、`Exploration level 1`、零 XP、无活动任务和最小 `WorldKnowledge`。
4. 执行起点观察并永久揭雾，但不授予 Exploration XP。
5. 在同一 IndexedDB 创建事务写入 seed、版本、初始 core、world chunks 和 revision。
6. 只有事务成功后才把启动状态切换为 `ready`。

通过条件：同一 seed 和版本产生同一 anchor、初始位置、揭雾和 save bytes；创建失败不进入临时无存档模式。

### 工作包 3：探索 TaskIntent 与自由向量执行

本包只定义两个 gameplay command：

- `SetTask`：提交一个 `Explore TaskIntent`，模式为 continuous 或带可选 destination；
- `CancelTask`：原子清除当前唯一任务。

不得为其他五类任务建立空 union branch、placeholder state 或兼容字段。后续生活技能包直接扩展当时真源，并按 MVP 政策替换 schema。

动作：

1. 完整实现 Accepted `NAV_UNITS_PER_TILE`、BigInt/canonical decimal、Euclidean floor division 和 gameplay coordinate range。
2. 实现 weighted Basic Theta*、swept-circle clearance、supercover traversal、terrain factor、stable open-set tie-break 和 multi-frontier selection。
3. 实现 `ceilSqrt`、rational crossing、`roundDivNearestEven`、整数毫秒 `positionAt(t)` 和 same-time event order。
4. 实现 `(t-1,t]` swept-segment/circle 基础几何。阶段内没有敌人，但不得删除或改写该 Accepted fixture。
5. 实现 continuous motion leg、tile boundary event、path/destination arrival、负坐标和跨 chunk path。
6. 实现永久 `Unrevealed/Revealed`、Accepted 首轮观察半径、frontier、初始观察例外、首次揭露每 tile `1 XP` 和去重。
7. destination 位于迷雾时只沿已知 frontier 增量前进，不能向终点 teleport、预读迷雾 terrain 或使用简化直线算法。
8. `SetTask`、`CancelTask` 成功后立即请求原子保存。

通过条件：UI 能观察到非 `45°` 路线、连续 fixed-point 位置、永久揭雾和 XP；online、offline、reload 对相同输入产生相同 path、事件毫秒、揭雾与 XP。

### 工作包 4：IndexedDB、单写入者与备份

动作：

1. 实现时重新核对 `idb` 的当前稳定版、TypeScript types、Worker 支持和包体影响；精确 pin 版本并提交适用 lockfile。不得自行实现 Promise wrapper。
2. 使用 origin-scoped exclusive Web Lock；第二标签页只显示 `active_in_other_tab`，不能启动第二个模拟器。
3. 建立 `meta`、`core`、`world_chunks`、`resume_claim` stores。只保存本阶段真实字段，不保存 inventory、combat、narrative 等空对象。
4. 在一个 readwrite transaction 中提交 core、dirty world chunks 和 meta revision。
5. dirty gameplay state 最迟在 Accepted `5s` 基线内提交；`SetTask`、`CancelTask`、创建、import/reset 和 offline completion 立即提交。
6. transaction、quota 或 integrity failure 时暂停 gameplay simulation，保留内存状态，并显示可导出阻塞错误。
7. 实现本阶段完整 backup envelope：product、export version、五个版本、metadata、core、ordered chunk records 和 SHA-256 checksum。
8. import 限制大小，验证类型、范围、canonical coordinates、唯一 ID、版本和 checksum；用户确认后用单一事务原子替换并重启 gameplay worker。
9. reset 必须确认，只删除 gameplay stores；不删除 texture、lighting 或其他 render preferences。

通过条件：失败事务不推进权威 revision；重复 command、崩溃恢复、非法 import、第二标签页和版本不匹配都不能产生第二份或部分 gameplay state。所有安全整数和坐标越界在事务前拒绝；shared quantity validator 必须覆盖 `Number.MAX_SAFE_INTEGER` 边界，但本阶段不创建库存字段。

### 工作包 5：离线 claim 与同语义快进

动作：

1. 用 `committed_wall_clock_ms` 计算候选离线时间；负 delta credit `0`，正 delta 最多 credit Accepted 首轮 `168h`。
2. 在事务中从 committed revision 创建唯一 `resume_claim`，固定 base revision、target wall clock 和 credited duration。
3. 使用在线同一个 event engine、Theta*、frontier、motion、observation 和 XP settlement 推进。
4. 分片 yield 并报告进度；不得设置丢弃剩余 credited time 的事件数上限。
5. 完成后在单一事务提交 core/chunks/meta 并删除 claim；崩溃时从同一 base/target 重算，不扩大既有 claim。
6. commit 成功后才进入 `ready` 并显示离线报告。

通过条件：持续探索离线期间不 teleport、不绕过迷雾、不使用第二套路线或 XP 公式；同一初始状态与 credited duration 的 online/offline/reload 结果一致。

### 工作包 6：最小产品 UI 与 Debug 分离

产品根只实现：

- new-world screen；
- top bar：固定 full HP 展示、位置、save state 和 System；
- map：terrain、fog、player、route、selected destination；
- Task drawer：continuous Explore、destination Explore、确认提交和 Cancel；
- bottom activity bar：唯一 `TaskIntent`、`ExecutionState`、进度、ETA、processing/waiting reason；
- Skills：只显示 `Exploration`；
- System：save state、最近 offline report、export、import 和 reset。

固定 full HP 只表达本阶段角色未受到伤害。UI 和 read model 必须明确 combat 尚未进入范围，不能让用户误以为战斗、恢复或死亡已经实现。Inventory、Equipment、Journal、Combat 和其他 Skills 入口不显示。

地图点击只在 main-thread UI state 中预填 destination。玩家确认后才发送统一 `SetTask`；不存在 `SetExplorationDestination` command。核心操作必须有键盘/表单路径，不能只依赖 canvas。

Debug 处理：

1. production root 删除 `World Debug` panel、texture upload、lighting/shader 参数和 debug JSON 控件。
2. 把现有 terrain、texture、lighting、chunk 和 renderer 诊断迁到明确 dev-only route 或 build-time dev gate。
3. 复用现有诊断能力，不删除验证入口；Lighting Lab 保持独立开发入口。
4. 产品 Settings 不显示 generator、chunk、FPS 或 shader controls。

通过条件：不打开 drawer 也能判断任务、执行状态、XP 变化和保存状态；production root 不包含 Debug 控件；developer 入口仍能完成现有诊断。

### 工作包 7：回归、性能和状态审计

动作：

1. 运行本文全部验证矩阵。
2. 记录 production build、浏览器、runner、fixture、三次性能结果、median、peak heap 和 profile。
3. 对失败路径做可观察断言，不能只检查模块或 DOM 存在。
4. 更新[当前状态](../product/current-state.md)，逐项区分已实现、未实现和剩余技术债。
5. 检查文档、源码常量、scripts、workflow 和链接一致性。

通过条件：用户可观察流程真实运行；证据可由新 checkout 按固定命令复现；`git status --short` 只包含专项预期变化。

## 验证矩阵

### Unit 与 deterministic fixtures

必须覆盖：

- BigInt/fixed-point 运算和 canonical decimal strings；
- `ceilSqrt` 与 rational terrain-boundary crossing；
- 正负 `0.5` 的 `roundDivNearestEven`；
- `1ms` 内端点均在圆外但线段穿圆、相切圆和同毫秒多圆；
- swept-circle 对 Water/DeepWater、阻挡边界和角点的 clearance；
- weighted route cost、terrain factor、ETA 和 position sampling；
- 相同 route cost 的 stable tie-break；
- 正负坐标、Euclidean floor division 和 `[-2^31, 2^31-1]` tile 边界；
- chunk seam 路线、成本、观察和请求顺序；
- frontier 选择、destination frontier、不可达和 search yield；
- reveal/XP 首次结算、初始观察例外、重复观察去重和升级后下一观察半径；
- same-time ordering、command interruption、snapshot 和 reload position。

### Direct engine、Worker、online/offline/reload 等价

固定 seed、初始 state、command 和有效时间。直接调用纯 engine 与通过 gameplay worker 运行必须得到相同：

- path 与 path index；
- motion/event world time；
- canonical `WorldPoint`；
- revealed tiles 与 `Exploration XP`；
- task/activity/read-model state；
- save revision 与恢复后状态。

比较使用权威状态，不比较 renderer 浮点插值或批处理进度消息。

### Persistence 与故障恢复

必须覆盖：

- 首次创建成功和事务失败；
- dirty 后 `5s` 内 autosave；
- `SetTask`/`CancelTask` immediate save；
- offline claim 创建后、处理中和提交前崩溃；
- write/quota failure 暂停 simulation；
- 五个必需版本任一不匹配；
- invalid product、checksum、ID、类型、quantity、安全整数或 coordinate bounds；
- import validation 失败不改变当前 save；
- import/reset 确认和原子替换；
- 第二标签页 exclusive lock；
- negative clock delta 与超过 `168h` cap。

### E2E

至少包含以下真实浏览器流程：

1. 新建世界 → 设置持续探索 → 出现非 `45°` 路线 → 揭雾并增加 XP → 保存 → 刷新后继续。
2. 点击 fog coordinate → 只预填 destination → 玩家确认 → `SetTask` → 沿 frontier 增量探索。
3. 取消探索 → 唯一 `TaskIntent` 清除 → 角色停止主动移动 → immediate save。
4. 构造离线 claim → 分片处理 → commit → 进入 ready → 显示已提交报告。
5. 强制 WebGL2 不可用和 context loss → Canvas2D 继续显示 → gameplay state、任务、迷雾和 XP 不丢失。
6. production root 不显示 Debug；developer route/gate 和 Lighting Lab 保留诊断能力。

### 性能门槛

使用编码前固定的 `168h continuous exploration` fixture，在 production build 和 pinned CI runner 上连续运行 `3` 次：

- wall-clock 中位数不超过 `15s`；
- peak heap 不超过 `256 MiB`；
- Worker 每个主动 processing slice 不超过 `16ms`；
- Worker 定期 yield，并向 UI 报告可单调解释的进度。

未达到门槛时，专项必须保留完整 credited time 和确定性结果，记录 profile 并继续优化。不得通过截断事件、减少揭雾、teleport、跳过路径搜索、改变 RNG/event order 或降低离线时间来通过 benchmark。

### 必跑命令与运行模式

实现专项必须运行并报告：

1. `cd rust && cargo test`。即使未改 terrain semantics，也作为生成回归。
2. `cd web && npm run typecheck`。
3. `cd web && npm run build`。
4. production preview smoke。
5. normal WebGL2。
6. `?shader=off`。
7. forced WebGL2 unavailable。
8. WebGL context loss。
9. 新增的 unit、Worker integration、persistence、E2E 和 performance scripts。

新增脚本的准确名称、前置服务、fixture 和输出必须在编码时写回[开发说明](development.md)与[验证标准](validation.md)。CI 结果不能替代未运行的本地检查。

## 阶段完成定义

只有同时满足以下条件，阶段 1 才能标记完成：

- 用户可观察的九项结果全部真实运行；
- gameplay worker 是唯一玩法写入者，main thread 没有复制 gameplay outcome；
- generator worker 仍是唯一 WASM terrain bridge；
- Accepted 自由向量、迷雾、XP、存档和离线语义没有简化分支；
- persistence、故障、second-tab、版本和 import 边界全部有通过证据；
- terrain generation、streaming、Canvas2D fallback、WebGL2 resilience、`shaderTime` 和 Terrain Sheet v3 无回归；
- 性能门槛在固定环境通过；
- `product/current-state.md` 已按源码和证据更新；
- 所有新增或变更 contract 已交叉链接；
- `git status --short` 只包含预期变化。

阶段完成表示“探索垂直切片已经可运行并通过证据”，不表示其余 RPG 系统已实现。后续生活技能包必须在这个运行中的产品上增量扩展，不能另建第二套 gameplay engine、任务状态机、存档或 UI shell。

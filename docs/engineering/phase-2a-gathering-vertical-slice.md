# 阶段 2A：基础采集垂直切片

- 状态：Implemented
- 确认日期：2026-08-11
- 决策者：项目负责人
- 前置实现：[阶段 1 当前状态](../product/current-state.md)
- Accepted 决策：[Decision-0004：阶段 2A 资源内容放置边界](../decisions/0004-gathering-content-placement.md)

> 本文是阶段 2A 实施基线。当前实现范围和技术债以[当前状态](../product/current-state.md)及[阶段 2A 运行时契约](../specifications/phase-2a-runtime-contracts.md)为准。

## 目标

在阶段 1 已运行的探索、导航、唯一 gameplay worker、IndexedDB、离线事件引擎和 map-first UI 上，交付一条最小但真实的基础采集闭环：

```text
初始观察发现野生纤维
→ 玩家提交唯一采集 TaskIntent
→ 索取已知可达节点
→ 按既有自由向量路径移动
→ 执行权威 6s 采集行动
→ 原子结算节点、fiber、采集 XP 和任务计数
→ 节点耗尽后重新索取或为原任务自动探索
→ online、offline、reload 使用同一事件语义
```

阶段 2A 只证明资源内容、采集任务、行动结算、最小库存和产品 UI 已贯通。它不预建后续生活技能或完整物品系统。

## Accepted 真源

本文必须服从以下已封板文档：

- [Decision-0002：技能与任务系统设计基线](../decisions/0002-skill-task-system-baseline.md)；
- [Decision-0003：首个端到端可玩切片设计基线](../decisions/0003-first-playable-slice-baseline.md)；
- [首个可玩区域内容与进度设计](../requirements/first-playable-region.md)；
- [自动任务](../requirements/automation-tasks.md)；
- [探索与目标索取](../requirements/exploration.md)；
- [技能成长](../requirements/skill-progression.md)；
- [物品与装备系统](../requirements/item-equipment.md)；
- [自由向量移动协议](../requirements/movement-navigation-protocol.md)；
- [存档与离线结算协议](../requirements/save-offline-protocol.md)；
- [玩法 UI](../requirements/gameplay-ui.md)与[玩法界面信息架构](../requirements/gameplay-information-architecture.md)。

Accepted 真源与本文共同约束阶段 2A。实现发现矛盾时必须保留 Accepted 真源并提出最小决策请求，不得自行建立兼容分支。

## 范围

### 包含

- `野生纤维` 一个资源 prototype；
- `fiber` 一个 material item；
- `采集` 一项新增可训练技能；
- `采集` 一类新增 `TaskIntent`；
- ambient content-cell placement 和营地保证层；
- active、depleted、respawning 三种地图资源状态；
- 采集行动、重生、任务计数、库存数量和采集 XP；
- 同一 action/event engine 的 online、offline 和 reload；
- Task、Skills、Inventory 所需最小产品 UI。

### 明确排除

- 伐木、采矿、生产、锻造、工艺和狩猎；
- 斧、镐或其他工具；
- 装备、装备槽、属性比较和自动换装；
- 敌人、潜行、战斗、伤害、死亡和掉落表；
- 配方、工作站、地面掉落、容量、重量、仓库和搬运；
- 叙事、Journal、Fact、Insight 和 Lead；
- 任务队列、pending intent、schedule 和条件式任务；
- 手动角色移动、navmesh、多人、市场或旧存档兼容层。

产品 UI 不显示上述排除系统的按钮、空 drawer、disabled placeholder 或假数据。

## 内容与稳定标识

以下标识是阶段 2A 稳定内容表基线，不是已实现事实：

| 对象 | 稳定 ID | 显示名 |
|---|---|---|
| resource prototype | `wild_fiber` | 野生纤维 |
| material item | `fiber` | 纤维 |
| skill | `gathering` | 采集 |
| task category | `Gather` | 采集 |

编码前必须把 placement ID、prototype ID、item ID、task ID 和 action event ID 的 grammar 写入阶段 2A runtime contract。ID 只服务本包实际进入范围的对象，不为伐木、采矿、生产、敌人或装备预留空分支。

## 内容放置

### ambient 层

- 世界按绝对 `32×32 tiles` content cell 划分。content cell 与 `64×64` runtime chunk 不是同一语义层。
- 负坐标使用 Euclidean floor division。
- 每个 content cell 对 `wild_fiber` 最多有一个 candidate slot。
- candidate slot 的身份和 cell 内 tile offset 只取决于 world seed、`CONTENT_VERSION`、prototype ID、营地 anchor 绝对坐标、绝对 `cell_x` 和 `cell_y`。
- content hash 不读取 chunk 访问顺序、容器遍历顺序、帧率、world time 或 gameplay event RNG。
- candidate slot 不写入 terrain payload，不修改 Rust generator，也不把 `GENERATOR_VERSION` 纳入 content hash。
- gameplay 内容层通过现有 terrain broker 读取 candidate interaction point 周围的有界 terrain。ambient candidate 只在 placement tile 是 `Land`、角色圆可站立、interaction point 合法且坐标在权威范围内时物化；不在 placement/materialization 时验证从营地或角色当前位置全局可达。不合格 ambient 候选不在 cell 内重复抽样。
- ambient placement 不需要预生成相邻 content cell，也不扫描营地到节点的路径，因此可以随 streaming 按 cell 局部、访问顺序无关地计算。

### 营地保证层

新世界创建必须在提交 revision `1` 前验证：

1. 阶段 1 初始 observation 事件实际揭露的范围内至少有一个 `wild_fiber` 节点。
2. 营地 anchor 的 `6–20 tiles` 保证环内至少有两个额外 `wild_fiber` 节点。
3. 三个保证节点拥有 distinct placement IDs 和 distinct placement tiles。
4. 每个节点都位于 `Land`，角色圆可以在 interaction point 站立，并可从营地通过既有导航语义到达。
5. 保证节点与 ambient 节点按稳定 placement ID 和绝对坐标去重。
6. guarantee candidate 枚举和排序不依赖 chunk 请求或加载顺序。

每个 guarantee candidate 使用与 ambient 相同的 world seed、`CONTENT_VERSION`、prototype ID 和营地 anchor 绝对坐标，并额外加入稳定 guarantee slot ID；保证层不以访问顺序或数组下标充当 identity。

只有上述三个营地保证节点需要在创建世界时通过既有 planner 证明从营地可达。该全局可达要求不扩展到普通 ambient 节点。

`6–20 tiles` 精确定义为相对营地 anchor 的 Chebyshev tile distance。

保证层只影响玩法内容 placement。若手动 seed 在既有搜索边界内无法满足保证，创建世界返回稳定的 content-placement 错误，不静默替换 seed，也不提交部分存档。

### 已知类型门禁

Accepted Task drawer 只显示已知 target 类型，也可以显示已发现但暂时无有效实例的类型。因此：

- 初始 observation 必须在创建世界事务前发现保证节点及 `wild_fiber` 类型；
- `Gather` 进入 Task drawer 前，read model 必须已经把 `wild_fiber` 标记为 known；
- UI 不得硬编码或预先显示迷雾后尚未发现的资源类型；
- 未知类型不能通过表单、URL、旧 command 或 fallback 被选中。

普通 ambient 节点被 observation 揭露后进入 WorldKnowledge。其可达性由既有 target acquisition/planner 使用当时已知 terrain 判断：不可达节点继续保留在 WorldKnowledge 和地图知识中，但不进入当前任务候选集；placement 层不得因此删除、移动或重新抽取节点。

## 野生纤维内容表

以下数值复用 Accepted 首轮平衡基线：

| 字段 | 实施基线 |
|---|---:|
| required skill | `gathering` level `1` |
| required tool | 无 |
| base action duration | `6000ms` |
| primary output | `fiber ×1` |
| gathering XP | `6` |
| respawn duration | `60000ms` world time |
| actions before depletion | `1` |
| interaction point | placement tile center |

一次成功行动后，节点立即进入 depleted，设置规范整数 `next_available_world_time_ms`。重生事件到达时，节点恢复 active，并单调推进其持久化 spawn cycle。重生前不能再次进入候选集。

## TaskIntent 与执行语义

阶段 2A 扩展现有唯一 `TaskIntent` union，不建立第二套任务状态机。

`Gather` intent 必须包含：

- `targetPrototypeId`，阶段 2A 只能是已知 `wild_fiber`；
- `quantity`，为正安全整数或 `null`；`null` 表示持续执行；
- `completedQuantity`，非负安全整数；
- 既有 task identity 和 canonical `created_world_time_ms`。

执行顺序固定为：

1. 验证 target 已知、永久 `gathering` level 和工具要求。
2. 在已知世界中筛选 active、类型匹配、可站立且可达的节点。
3. 按既有权威 route cost 选择最近目标；cost 相同按稳定 placement ID。
4. 到达 placement tile center 后开始一个权威 resource action。
5. action 完成时执行一次原子 settlement。
6. 节点耗尽后重新索取，不在原地等待该节点重生。
7. 没有已知有效目标但存在可达 frontier 时，保留原 intent 和计数，进入为该 intent 服务的自动探索。
8. 自动探索发现合格节点时，立即停止自动探索，重新规划并恢复原 `Gather` intent。
9. 没有目标和可达 frontier 时进入 `NoReachableTargetOrFrontier`；节点重生可以唤醒重新索取。
10. finite quantity 达到或超过目标后保留完整产出，清除活动执行并原地待机；continuous intent 继续重新索取，直到玩家取消或替换。

系统不得自动切换资源 prototype、任务类别、技能、装备或策略。任务替换和取消继续使用阶段 1 的 `SetTask`/`CancelTask` command 与幂等、持久化语义。

## 行动时间与整数速度

阶段 2A 只实现 `wild_fiber` 所需的技能速度来源，不实现工具、装备、饰品或 effect 速度。

使用整数 basis points：

```text
skill_speed_bps = min(max(gathering_level - required_level, 0) × 50, 2500)
authoritative_duration_ms = ceil(base_duration_ms × 10000 / (10000 + skill_speed_bps))
duration_floor_ms = ceil(base_duration_ms × 2500 / 10000)
final_duration_ms = max(authoritative_duration_ms, duration_floor_ms)
```

该公式落实 Accepted 的每高一级 `+0.5%`、技能来源上限 `25%` 和总持续时间不低于基础值 `25%`。该公式属于 `GAME_RULES_VERSION = 2` 的权威语义。

engine 使用同一个 `final_duration_ms` 安排 action completion、保存 remaining time、离线推进和 reload。Worker read model直接提供权威 duration、remaining time 和技能来源 bps。UI 只显示这些字段，不重算 duration。

## 原子 settlement 与持久化

一次 resource action completion 是一个不可拆分的权威事件。它必须先验证所有新值，再同时更新：

- placement 的 depleted、spawn cycle 和 `next_available_world_time_ms`；
- inventory 中 `fiber` 数量 `+1`；
- `gathering` 累计 XP `+6` 以及由同一版本曲线推导的等级；
- 当前 `Gather` intent 的 `completedQuantity +1`；
- event ordinal、revision、dirty generation 和 read model。

任何 quantity 超过 `Number.MAX_SAFE_INTEGER` 时，沿用 `integrity/quantity_overflow`，整个 settlement 不生效并暂停 simulation。不得只更新节点、只发物品、只发 XP 或截断任务计数。

持久化继续使用阶段 1 gameplay worker 和四-store transaction 边界：core 保存 inventory、skills、唯一 intent 和 action；对应 `world_chunks` 保存已知 placement 与 mutated node state；meta 保存同一 committed revision。阶段 2A 不增加第二个数据库或本地缓存真源。

每次成功采集 settlement 必须立即提交一个包含 core、dirty world chunks 和 meta 的事务。`tx.done` 前不得把该 settlement 显示为已保存或最终完成；同一 settlement 的字段不得跨 revision 分拆。阶段 1 不超过 `5s` 的 dirty commit 只继续处理不要求立即提交的 mutation。

## Online、offline 与 reload

- resource action completion、resource respawn、movement、observation、target acquisition 和 inventory/XP settlement 全部进入现有整数 world-time event engine。
- infrastructure 等待、terrain 请求和 planner yield 不推进 world time。
- offline fast-forward 使用同一 target selection、route、action duration、completion、respawn 和 settlement transition，不写第二套批量收益公式。
- 相同起始 save 与 credited duration 必须得到相同 position、fog、known placements、node state、fiber、gathering XP、task count 和 world time。
- save 保存 current action 的 target placement、开始/结束 world time 或足以精确恢复的 remaining duration。reload 不得重新开始已完成行动或重复 settlement。
- finite task 在 offline 中完成后，剩余 credited time 原地待机；continuous task 继续索取和探索。

## 版本基线

| 版本 | 当前阶段 1 | 阶段 2A | 理由 |
|---|---:|---:|---|
| `DB_SCHEMA_VERSION` | `1` | `1` | 保持四个 store、既有 keyPath 和无 index 的物理 schema；若实现需要物理 schema 变化，必须另提版本决策 |
| `SAVE_SCHEMA_VERSION` | `1` | `2` | core 和 world chunk 新增 inventory、gathering skill、Gather intent/action 与 resource mutation |
| `GAME_RULES_VERSION` | `1` | `2` | 新增 target acquisition、action、respawn、settlement 和权威 duration 公式 |
| `CONTENT_VERSION` | `1` | `2` | 新增 content cell、保证层、prototype 和 item definition |
| `GENERATOR_VERSION` | `3` | `3` | terrain bytes 和 Rust generator 语义不变 |

MVP 不迁移阶段 1 存档，不兼容读取旧 gameplay state，也不增加旧任务或旧内容分支。版本不匹配继续拒绝加载，保留原始导出和用户确认重置路径。系统不得自动删除旧存档。

## 产品 UI

阶段 2A 保持 map-first shell，只为本包实际交付的能力增加最小入口：

### Task

- Task drawer 在 `wild_fiber` 已知后显示 `采集`。
- target 必填且只列出已知类型；阶段 2A 只有野生纤维。
- quantity 接受正安全整数；空白明确显示“持续”。
- 提交时说明会替换当前唯一任务和旧 task counter。
- bottom activity 显示 intent、索取/移动/行动/自动探索、finite count 或 continuous、权威 remaining time 和稳定 waiting reason。

### Skills

- 只增加本包实际交付的 `采集` 条目：等级、累计 XP、当前等级进度、下一级 XP 和当前技能速度 bps。
- 不显示伐木、采矿、锻造、工艺、潜行或近战占位。

### Inventory

- 只显示实际已获得的 `fiber` 和安全整数数量。
- 不显示容量、重量、格数、装备、品质、价格或空物品类型。

### Map

- 只显示已观察到的 resource placements。
- 已知节点至少区分 active、depleted 和 respawning；respawn remaining time由 Worker 提供。
- 迷雾后节点不渲染、不进入列表、不参与索取。
- 显示前往资源和为原任务自动探索的路线差异；UI 不重算 route、target、duration 或 ETA。

## 工作包

### 工作包 0：运行时契约门禁

1. 将 Decision-0004、content-cell 距离、IDs、速度公式和版本表落实为精确运行时常量与 schema。
2. 在独立阶段 2A runtime contract 中封闭新增 Worker union、read model、save record、placement/action/event ID 和错误码。
3. 固定一个 content-placement seed + camp-anchor fixture，包含初始保证、保证环、负坐标和 chunk seam。

通过条件：版本、ID 和协议不再由实现者猜测；contract fixture 能与本文逐项对应。门禁未闭合时不得开始后续运行时代码。

### 工作包 1：内容 placement 与世界知识

1. 在 gameplay 内容层实现 absolute content cell 和营地保证层。
2. 通过既有 terrain effect/broker 对 ambient 做有界局部 Land、站立和 interaction-point 校验，不依赖 renderer、Rust 内部实现或全局路径搜索。
3. 只对三个营地保证节点执行从营地可达验证。
4. observation 将节点和 prototype 首次发现写入既有 WorldKnowledge/fog 结算；已知节点的可达性由 target acquisition/planner 判断。

通过条件：初始已知野生纤维与两个额外可达保证节点稳定存在；ambient placement 可以按 cell 局部流式计算；访问和加载顺序不改变 placement；已观察但不可达的 ambient 节点保留知识且不进入候选集。

### 工作包 2：状态、存档与版本

1. 扩展 core 的 inventory、gathering skill、Gather intent/action。
2. 扩展 world chunk 的 known placement 与 resource mutation。
3. 按版本基线拒绝阶段 1 存档，并保留 export/confirmed reset。
4. 保持 command receipt、Web Lock、四-store transaction 和 backup checksum 边界。

通过条件：新世界、settlement、reload、export/import/reset 不产生部分 resource state。

### 工作包 3：采集执行与离线等价

1. 复用现有 target acquisition、navigation、movement 和自动探索。
2. 加入权威 resource action、depletion、respawn 和原子 settlement。
3. 使用同一 event engine 推进 online、offline 和 reload。

通过条件：同一状态和有效时间得到相同 placement、position、fiber、XP、任务计数和节点状态。

### 工作包 4：最小产品 UI

1. 在单一 drawer 增加 Task、Skills、Inventory 的最小实际交付内容。
2. 在地图与 bottom activity 显示资源状态、采集路线、行动和自动探索。
3. 保持 System、save/offline report 与独立 Debug 路由。

通过条件：用户无需 Debug 工具即可完成真实采集闭环；产品不显示排除能力。

### 工作包 5：缩减发布门槛

只执行以下发布检查，不扩展字段级 classifier 或故障注入矩阵：

1. 一条真实浏览器采集 E2E：创建世界 → 初始发现野生纤维 → 提交 finite `Gather` → 任意角移动 → 完成 action → 节点耗尽 → `fiber`、采集 XP 和 task count 同时更新 → 完成后待机 → reload 后状态不重复结算。
2. TypeScript strict typecheck。
3. fixed Rust/WASM 工具链 production build，并确认 `GENERATOR_VERSION = 3` 的既有 terrain fixture 不变。
4. 阶段 1 现有 unit、contract、Worker、persistence、核心探索 E2E 和 Canvas2D/WebGL2 smoke 主路径回归。

发布记录必须列出未运行项目和原因。CI 不能替代本地未运行检查。

## 与 Accepted 真源的冲突审查

未发现需要覆盖 Accepted 真源才能实施的冲突。早期版本曾遗漏 ambient placement 的营地 anchor 输入；现已通过“全部内容放置保留营地 anchor 绝对坐标，ambient 再加入绝对 content-cell 坐标，保证层再加入稳定 guarantee slot ID”消解，不需要修改 Accepted 真源。

实施基线按以下方式保留既有语义：

| Accepted 语义 | 实施基线处理 |
|---|---|
| 所有内容放置包含营地 anchor 绝对坐标 | ambient 和 guarantee 都保留 anchor；ambient 追加绝对 content-cell 坐标，guarantee 追加稳定 slot ID |
| Task drawer 只显示已知 target type | 初始 observation 保证至少一个野生纤维节点和类型已知；未知类型不能选择 |
| 同时只有一个 `TaskIntent` | `Gather` 加入现有 union；不增加 pending task 或 queue |
| 玩家决定类别和 target | 自动系统只索取已选 `wild_fiber` placement；不切类别或 prototype |
| 迷雾后目标不可读取 | ambient placement 可以确定性重建，但只有 observation 后才能进入 WorldKnowledge、UI 和候选集 |
| 已知但不可达目标保留在 WorldKnowledge | ambient placement 不做全局可达过滤；observation 后由 target acquisition/planner 判断，不可达节点保留知识但从候选集排除 |
| 最近目标按权威 route cost | 复用阶段 1 planner；不按直线距离或 cell 顺序选择 |
| 没有目标时自动探索 | 保留原 intent 和计数；发现合格节点后立即恢复 |
| 无容量库存 | 只保存 `fiber` 安全整数数量，不增加容量或搬运 |
| 有效行动才发 XP | 寻路、等待、取消和失败不发 XP；成功 settlement 固定发 `6 XP` |
| resource/action/inventory/XP 原子结算 | 同一 engine event 与同一 save revision 更新全部字段 |
| online/offline 共用语义 | 不建立离线收益捷径或第二套行动公式 |
| 内容与 terrain version 分离 | content hash 和表由 `CONTENT_VERSION` 治理；terrain bytes 不变，`GENERATOR_VERSION` 保持 `3` |
| MVP 不迁移旧存档 | 版本升至 `2` 后拒绝阶段 1 save，只保留 export/confirmed reset |

以下新增决定已经封板：

- `32×32 tiles` content cell；
- initial observation 一个节点与 `6–20 tiles` 两个额外节点的保证数量；
- guarantee ring 的 Chebyshev 距离定义；
- 稳定 IDs；
- basis-point duration 公式；
- `SAVE_SCHEMA_VERSION`、`GAME_RULES_VERSION`、`CONTENT_VERSION` 升至 `2`；
- settlement 立即提交，而不是只依赖 `5s` dirty commit。

缩减发布门槛只用于阶段 2A 增量，不替代 Accepted 首个可玩区域对完整采集、伐木、采矿、生产、敌人、战斗和叙事闭环的最终验收。阶段 2A 通过后不能据此宣称完整 Accepted 首个可玩区域已经实现。

## 完成定义

只有代码真实实现、缩减发布门槛全部通过且[当前状态](../product/current-state.md)按源码事实更新后，阶段 2A 才能从 Ready for implementation 进入已实现状态。

# 首个可玩区域内容与进度设计

- 状态：Accepted
- 决策者：项目负责人
- 确认日期：2026-08-09
- 适用范围：首个端到端可玩切片

> 本文已封板。区域选择、内容覆盖、内容表、无容量库存、`CONTENT_VERSION` 和体验目标均为首个切片的 Accepted 设计基线，不是已实现事实。本文中的数值是“Accepted 首轮平衡基线”，未来只能通过显式、版本化的平衡决策调整。

> [自由向量移动、导航、迷雾与目标索取](movement-navigation-protocol.md)已经 Accepted，并封闭 weighted Theta*、角色圆 clearance、fixed-point 与整数毫秒算术。跨 chunk fixture 与性能 benchmark 属于实现验收，不再是产品方向阻塞项。

## 设计目标

首个可玩切片采用“小型开放区域 + 确定性玩法内容覆盖层”。它用有限、可验证的内容覆盖测试已经 Accepted 的[技能](skill-progression.md)、[任务](automation-tasks.md)、[探索](exploration.md)、[战斗与死亡](combat-stealth.md)和[离线](offline-progression.md)语义，同时不把可玩区域变成世界硬边界。物品、叙事和 gameplay shell 分别见[物品与装备系统](item-equipment.md)、[碎片叙事与线索簿](narrative-cluebook.md)和[玩法界面信息架构](gameplay-information-architecture.md)；这些规范均已 Accepted。

不采用以下路线：

- 完全手工地图：会让首个切片脱离现有确定性 terrain generator。
- 完全随机内容：不能保证关键资源、敌人、工作站和叙事发现形成可测试闭环。
- 把玩法内容塞入地形 payload：会混淆地形语义与玩家世界内容，并让内容平衡错误触发地形版本变化。

## 分层与版本

地形继续由现有 terrain generator 生成。以下对象属于独立玩法内容层：

- 资源实例；
- 敌人实例；
- 工作站；
- 叙事发现。

玩法内容层不进入 `8192-byte` terrain payload。只改变内容放置或内容表时，不修改 `GENERATOR_VERSION`；地形 bytes 本身变化时，仍按世界生成契约修改 `GENERATOR_VERSION` 并更新 golden fixtures。

本设计新增独立 `CONTENT_VERSION`，用于决定确定性玩法内容放置和内容表。它与以下版本分离：

| 版本 | 责任 |
|---|---|
| `GENERATOR_VERSION` | 确定性地形 bytes |
| `CONTENT_VERSION` | 玩法内容放置、原型和内容表 |
| 游戏规则版本 | 任务、技能、遭遇、战斗和结算语义 |
| 存档 schema 版本 | 玩家状态序列化结构 |

MVP/demo 阶段修改内容规则时，直接替换旧规则和旧内容表，不保留兼容层。`CONTENT_VERSION` 的具体表示、存放位置和与存档的字段关系由实现专项在编码前补齐，并写入版本与存档文档。

## 起点确定

系统以原点附近 chunk 为候选，按 `(Chebyshev ring, y, x)` 稳定顺序搜索营地 anchor，最大半径为 `16 chunks`。同一 chunk 内按绝对 tile `(y, x)` 排序。

营地 anchor 必须位于 `Land`，其 `3×3 tiles` 邻域可通行。半径 `256 nav units` 的角色圆必须能在营地和全部必要目标的中心点站立。营地所在连通区域跨中心 chunk 和至少一个正交相邻 chunk；所有首阶段必要内容必须能在完整 terrain 上由 weighted Theta* 从营地到达。

起点周围 `3×3 chunks` 构成首个内容保证区，但不是世界硬边界。保证区只确保首个切片所需内容能够出现；玩家和 streaming 可以继续跨出该区域。

所有内容放置结果只能由以下输入决定：

```text
world seed
+ CONTENT_VERSION
+ 内容原型 ID
+ 锚点绝对坐标
→ 确定性玩法内容
```

结果不得依赖 chunk 访问顺序、容器遍历顺序、帧率或 gameplay 随机流。默认 seed 找不到合格区域时，可以在存档创建前按确定性规则换 seed 重试；玩家手动输入的 seed 不得静默替换，超过搜索范围时必须拒绝创建并说明原因。

## 空间分层

以下距离均为 Accepted 首轮布局基线。实际放置必须使用可达路径和地形候选约束，不能用圆形覆盖强行把内容放到水面、不可通行地形或其他不合格位置。

| 分层 | 提议距离 | 内容保证 |
|---|---:|---|
| 安全圈 | 营地周围约 `0–20 tiles` | 无主动敌人；锻造工作站和基础资源 |
| 学习圈 | 约 `20–64 tiles` | 全部 T1 资源、第一类狩猎目标和两种叙事发现方式 |
| 边界圈 | 约 `64–96 tiles` | 必须跨出起始 chunk；更危险的主动敌人、铜矿、第三个叙事碎片、下一阶段地图线索 |

内容实例的保证数量、密度、最小间距和同类目标冗余仍待内容覆盖规则确定。

所有首阶段内容都位于营地周围 `3×3 chunks`。至少一个浅层铜矿、T2 敌人和叙事碎片必须位于起始 chunk 外。必要放置点不得重叠，也不得位于阻挡格。首版不保证人为放置不可达目标；不可达行为只通过固定 fixture 验证。

## 起始状态

- 营地锻造工作站已经激活。
- 初始装备为 `worn_axe`、`worn_pickaxe` 和 `worn_blade`。它们只提供最低可用能力，不形成额外教学系统。
- `body` 和 `accessory` 槽位初始为空。
- 八项首版技能均从等级 `1` 开始。
- 地图在起点执行半径 `4 tiles` 的连续圆形初始观察，且不授予探索经验。
- 不预设活动任务；玩家必须作出第一次任务选择。
- 本切片不引入库存容量和搬运玩法。库存按物品 ID 累积整数数量，持续任务不因容量停止。

无容量库存是本设计的 Accepted 产品语义，不是“临时给一个很大容量”的占位实现。它用于保持持续任务可持续，并让首个切片的主要成本继续由时间表达。

## 首轮内容表

本节全部数值均为 Accepted 首轮平衡基线，不是已实现事实或发布承诺。

### 资源

| 原型 | 技能要求 | 工具 | 基础时间 | 固定产出 | 固定经验 | 重生时间 | 放置要求 |
|---|---:|---|---:|---|---:|---:|---|
| `野生纤维` | `采集 1` | 无 | `6s` | `1 纤维` | `6 XP` | `60s` | 安全圈或学习圈 |
| `软木树` | `伐木 1` | 斧 | `10s` | `1 软木` | `10 XP` | `120s` | 安全圈或学习圈 |
| `地表石` | `采矿 1` | 镐 | `12s` | `1 石料` | `12 XP` | `120s` | 安全圈或学习圈 |
| `浅层铜矿` | `采矿 5` | 镐 | `18s` | `1 铜矿石` | `23 XP` | `240s` | 边界圈；至少一个保证矿点位于起始 chunk 外 |

资源行动仍遵守已确认的固定行动经验规则。速度加成和实际耗时不改变单次基础经验，额外产量也不增加单次经验。

### 物品与装备内容

本节只汇总区域闭环使用的物品。完整定义、装备槽、库存、原子结算和掉落表见[物品与装备系统](item-equipment.md)。

| `item_id` | 角色 | 首轮属性或用途 |
|---|---|---|
| `worn_blade` | 起始 `weapon` | damage `4–6`；accuracy `+5`；interval `2.5s`；`近战 1` |
| `worn_axe` | 起始 `axe` | tier `0`；伐木 speed `0%`；`伐木 1` |
| `worn_pickaxe` | 起始 `pickaxe` | tier `0`；采矿 speed `0%`；`采矿 1` |
| `reinforced_axe` | 工艺工具升级 | tier `1`；伐木 speed `+10%`；`伐木 2` |
| `reinforced_pickaxe` | 工艺工具升级 | tier `1`；采矿 speed `+10%`；`采矿 2` |
| `copper_blade` | 锻造武器升级 | damage `8–12`；accuracy `+10`；interval `2.4s`；永久要求 `近战 2` |
| `raw_hide` | T1 狩猎材料 | 每次目标击杀 guaranteed drop `×1` |
| `rope` | 工艺中间材料 | `工艺 1` 配方；单周期产出 `×1` |
| `hunter_coat` | `body` 防具 | max HP `+10`；armor `+10` |
| `trail_charm` | `accessory` | stealth `+5` |

已实现基础材料的稳定 `item_id` 为 `fiber`、`softwood`、`stone` 和 `copper_ore`。本阶段确认 `rope`、`reinforced_axe` 和 `reinforced_pickaxe`；尚未进入实现的战斗与锻造材料仍由对应内容专项在编码前补齐。相同装备按 `item_id` 堆叠，不生成物品实例；库存不因容量停止持续任务。

### 工艺配方

| 配方 | 技能要求 | 材料 | 基础时间 | 固定经验 | 完整输出或效果 |
|---|---:|---|---:|---:|---|
| `rope` | `工艺 1` | `2 纤维` | `12s` | `12 XP` | `rope ×1` |
| `reinforced_axe` | `工艺 2` | `4 软木 + rope ×2 + 2 石料` | `30s` | `30 XP` | `reinforced_axe ×1`；伐木装备速度 `+10%` |
| `reinforced_pickaxe` | `工艺 2` | `4 软木 + rope ×2 + 3 石料` | `30s` | `30 XP` | `reinforced_pickaxe ×1`；采矿装备速度 `+10%` |
| `hunter_coat` | `工艺 2` | `raw_hide ×4 + rope ×2` | `45s` | `45 XP` | `body`；max HP `+10`；armor `+10`；单周期数量由首版内容表补齐 |
| `trail_charm` | `工艺 2` | `raw_hide ×2 + rope ×2` | `30s` | `30 XP` | `accessory`；stealth `+5`；单周期数量由首版内容表补齐 |

配方按完整周期原子结算。装备速度属于装备来源，必须与技能来源分开显示。

production task 先验证 recipe/level/equipment，再检查材料；材料足够时才索取最近已知可达 compatible station。`station requirement` 为空的 handcraft recipe 原地执行。空间索取直接遵守已接受的[移动协议](movement-navigation-protocol.md)。

资源和工作站的 interaction point 是 placement tile center。内容对象不阻挡，角色可以到达该中心；首版不增加 interaction radius。

### 锻造配方

以下配方必须在营地锻造工作站执行：

| 配方 | 技能要求 | 材料 | 基础时间 | 固定经验 | 完整输出或效果 |
|---|---:|---|---:|---:|---|
| `铜锭` | `锻造 1` | `3 铜矿石 + 1 软木` | `30s` | `30 XP` | 铜锭；单周期数量由首版内容表补齐 |
| `copper_blade` | `锻造 2` | `2 铜锭 + 2 软木 + rope ×1` | `45s` | `45 XP` | 单周期数量由首版内容表补齐；战斗属性见[战斗数值系统](combat-numerics.md#武器) |

### 敌人原型

| 原型 | 区域与行为 | 重生 | 待决内容 |
|---|---|---:|---|
| T1 狩猎目标 | 分布在学习圈；可以主动发现玩家；目标体验是可用初始武器击杀；guaranteed drop `raw_hide ×1` | `180s` | 正式名称、属性和掉落 entry ID |
| T2 边界威胁 | 分布在边界圈；感知和战斗强度高于 T1；弱装备角色具有较高死亡风险；可以潜行绕过，目标体验是在取得铜刃后挑战 | `300s` | 正式名称、玩家/敌人属性、战斗周期、奖励 |

敌人强度描述是待验证的体验目标，不代替战斗数值。首个切片不设计敌群、波次、远程或魔法敌人。

T1/T2 的 Accepted 首轮属性、战斗公式和首轮蒙特卡洛记录见[战斗数值系统](combat-numerics.md)。铜刃与猎人护衣组合的物品影响记录见[物品与装备系统](item-equipment.md#战斗平衡影响)。模拟记录不构成必胜保证，仍须由可复现脚本和路径级验证复核。

敌人巢点使用跨重生稳定的 `placement_id`；每次有效重生令持久化 `spawn_cycle +1`；`encounter_instance_id` 由两者组成。地图知识和重生时间使用 `placement_id`，遭遇、潜行 XP 与 combat RNG 使用 `encounter_instance_id`。

敌人静止在 placement point。T1/T2 detection radius 的 Accepted 首轮平衡基线分别为 `2/3 tiles`。整数毫秒 `(t-1,t]` 的权威 motion swept segment 与 detection circle 相交时触发遭遇；同毫秒多敌按 `encounter_instance_id`，当前狩猎 archetype 跳过潜行判定。

## 碎片叙事与线索簿

首个切片谜题线的工作标题为“弃置的营地”，核心问题是“营地的使用者去了哪里？”。完整知识模型、触发器、可信度和 UI 见[碎片叙事与线索簿](narrative-cluebook.md)。具体正文和正式名称仍由世界观内容专项编写。

| Fact | 首次触发条件 | 信息性质 | 核心信息 |
|---|---|---|---|
| A：褪色路标 | `observe_landmark`：观察学习圈内确定地标 | `observed` | 重新刻写的方向指向边界高地 |
| B：修补过的矿痕 | `complete_action_at_target`：首次完成带标记浅层铜矿行动 | `observed` | 新近凿痕只支持一次小型修补 |
| C：残留的营地标记 | `kill_enemy_archetype`：首次击杀指定 T2 边界威胁 | `observed` | 营地标记和痕迹继续通向边界外 |

三个 Fact 可以按任意顺序发现。两端 Fact 已知时揭示对应 Relation；三个 Fact 全部已知时，只生成一次 `inferred` Insight，将谜题线标记为 `resolved`，并创建指向下一阶段方向的 `exact_marker` Lead。

叙事发现不进入库存或掉落表，不额外发放 Relation、Insight 或 Lead 的探索 XP，也不自动创建任务。玩家必须主动选择“预填探索任务”并提交确认。阶段成果是新知识和新方向，不建立传统任务清单，也不显示无限世界完成率。

## 预期体验路径

以下路径用于检查内容闭环，不是强制顺序：

```text
探索迷雾
→ 发现资源与敌人
→ 采集 / 伐木 / 采矿
→ 制作加固工具
→ 狩猎 T1 并取得 raw_hide
→ 制作 `hunter_coat` 或 `trail_charm`
→ 取得铜矿
→ 锻造铜刃
→ 设置有限狩猎
→ 经历强制战斗或死亡
→ 复活并继续
→ 取得三个 Fact
→ 生成推论和下一阶段 Lead
```

玩家可以跳过、交错或反向完成没有前置依赖的步骤。任务系统不能替玩家切换活动类别。

T1 的 Accepted 首轮 combat XP 为 `30`。按当前 Accepted 曲线，等级 `1 → 2` 需要 `100 XP`；约 `4` 次 T1 击杀同时提供 `120 XP` 和 `raw_hide ×4`，满足 `copper_blade` 的 `近战 2` 准入并形成 `hunter_coat` 材料闭环。该节奏不是试玩事实，仍须用实际路径与恢复规则验证。

## 必测脚本

1. 设置“`伐木：软木 ×10`”。没有已知树木时进入自动探索；发现后恢复原任务；敌人打断后继续；完成后原地待机。
2. 设置“`生产：铜锭 ×3`”且材料不足。任务与进度保留，角色原地等待并显示缺少材料；不得自动采矿。
3. 设置“`狩猎：T1 ×3`”。非目标敌人不计数；死亡后等待 `60s`，在精确死亡位置以满 HP 复活；致死敌人重置；motion/action 取消；任务计数不重置。验证 `5s RevivalGrace` 可以离开非目标 detection circle，但继续狩猎会立即主动重战。
4. 分别验证两种探索语义：无目的地 `探索` 任务持续前往最近可达迷雾边界；资源或狩猎任务进入 `自动探索` 后，一旦发现合格目标，立即让位给原任务。
5. 使用固定不可达 fixture 揭露一个隔水或受阻目标。目标保留在世界知识中但从候选集排除，系统选择其他可达目标；正常起始世界不要求人为包含该样例。
6. 在 T2 威胁区分别验证潜行成功、潜行失败后强制战斗；同一 `encounter_instance_id` 不重复判定或发 XP，新 `spawn_cycle` 可以形成新资格。
7. 以不同顺序从三个渠道发现 Fact；每条 Relation、最终 Insight 和 Lead 只触发一次。发现不暂停任务，也不自动创建或提交 Lead 对应的探索任务。
8. 保证至少一个必需目标位于相邻 chunk，验证 streaming 和绝对世界坐标连续。
9. 持续任务和离线推进不因库存容量停止。
10. 至少一条路径包含非 `45°` 倍数航向，不吸附 tile center；path cost、候选选择与 ETA 使用同一 weighted cost。
11. swept circle 不得擦过 Water/DeepWater 或阻挡角；跨 chunk 与负坐标结果稳定。
12. online/offline/reload 对相同状态产生相同 motion events、揭雾和遭遇时刻。

界面验收使用已接受的[玩法界面信息架构](gameplay-information-architecture.md)：不打开 drawer 也能看到 HP、任务意图、执行状态、进度与等待原因；六类任务可由同一 Task drawer 设置；Inventory/Equipment、Journal 和 offline report 只展示同一 gameplay read model。

## 体验指标假设

以下数值是需要试玩验证的测试目标，不是事实、SLA 或发布承诺：

- 进入游戏 `2 分钟`内能够设置第一项任务。
- `5 分钟`内看到第一次有效行动结算。
- `20–30 分钟`内能够完成第一次工具升级。
- `45–90 分钟`主动游玩或数小时放置内可以经历完整切片。

试玩必须记录实际分布和失败原因，再决定保留、调整或删除这些指标。

## 明确排除

- 教程任务链；
- 手动角色移动；
- 任务队列；
- 库存容量和搬运；
- 自动存取和自动采购；
- 装备耐久；
- 品质；
- 随机生产失败；
- 食物和药剂；
- 远程和魔法；
- 地下城；
- 市场和多人。
- 战后恢复期或冷却期。

## 内容与验证工作

- 内容专项须补齐各圈层内容实例的保证数量、密度、间距和冗余，并写入版本化内容表。
- 战斗与锻造内容专项须补齐尚未进入实现的配方产出数量、稳定 `item_id` 和正式显示名称。
- 实现专项须写明 `CONTENT_VERSION` 的表示、存放位置和与存档字段的关系。
- 导航专项须完成 `ceilSqrt`、`roundDivNearestEven`、毫秒量化 circle detection、collision、path cost、frontier、起始扫描和跨 chunk fixtures/benchmark。
- 战斗专项须归档可复现模拟脚本、seed、数值精度，并加入真实路径恢复、敌人密度与重生的端到端验证。
- 世界观专项须完成“弃置的营地”、三个 `Fact`、综合推论、下一阶段 `Lead`、敌人和其他临时原型的正式名称与正文。
- 试玩专项须记录首轮样本、计时口径、结果分布和失败原因；当前体验指标不是发布承诺。

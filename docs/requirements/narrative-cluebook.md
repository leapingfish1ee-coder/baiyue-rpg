# 碎片叙事与线索簿

- 状态：Accepted
- 决策者：项目负责人
- 确认日期：2026-08-09
- 适用范围：首个端到端可玩切片

> 本文已封板。谜题线、事实、关系、推论、线索、发现触发器、线索簿 UI 和首个区域叙事结构均为 Accepted 设计基线，不是已实现事实。正式世界观名称与正文仍属于内容制作工作。

## 关系与边界

叙事系统记录玩家已经知道什么，不替玩家决定接下来做什么。本文在既有 [WorldKnowledge](../architecture/gameplay-state.md#worldknowledge) 边界内补充叙事结构，并复用[探索与目标索取](exploration.md)、[自动任务](automation-tasks.md)和[离线推进](offline-progression.md)已有事件。叙事正文和碎片不进入[物品与装备系统](item-equipment.md)定义的库存或掉落表。

首个区域内容见[弃置的营地谜题线](first-playable-region.md#碎片叙事与线索簿)。外部参考事实见[可比游戏研究](../research/comparable-games.md)。

## 路线与取舍

基线采用“环境/行动碎片 + 关系式线索簿”。

### 不采用线性 quest log

逐项目标会把开放世界自动任务改写成勾选清单，并混淆玩家任务意图与叙事知识。

### 不采用纯散落文本

只保留散落文本能够强化氛围，但玩家经过长时间自动执行或离线回归后难以重建关系，也缺少明确的后续方向。

### 不采用随机稀有 lore drop

关键叙事如果依赖稀有 RNG，可能长期阻塞世界理解和阶段推进。

Outer Wilds 的 Rumor Mode 用 entries、facts 和连接组织发现；Melvor Archaeology 的图表类发现可以揭示地图位置。本文只借鉴“组织知识”和“由发现产生地图方向”的模式。Baiyue RPG 的关键叙事使用确定性触发，不照搬其内容结构或随机掉落。

## 术语

中文 UI 统一使用以下名称；代码标识符保留英文：

| 中文术语 | 英文标识 | 定义 |
|---|---|---|
| 谜题线 | `Thread` | 围绕一个核心问题组织的叙事主题 |
| 事实 | `Fact` | 一次发现后永久记录的最小信息单元 |
| 关系 | `Relation` | 连接两个已知事实，并说明两者为何相关 |
| 推论 | `Insight` | 满足一组已知事实后自动生成的明确判断 |
| 线索 | `Lead` | 推论产生的可行动方向，可以是概念、模糊区域或准确地图标记 |
| 发现事件 | `DiscoveryEvent` | 使一个 `Fact` 首次变为 known 的玩法事件 |

`Lead` 只提供信息和玩家可选操作，不是任务，也不自动创建 `TaskIntent`。

## 信息可信度

每个显示的知识节点必须标明信息性质：

| 标识 | 适用对象 | 含义 |
|---|---|---|
| `observed` | `Fact` | 玩家直接观察，或亲自完成行动后确认 |
| `recorded` | `Fact` | 遗留记录、刻文或其他固定媒介中的陈述；只证明该媒介如此记载 |
| `inferred` | `Insight` | 系统根据多个已知 `Fact` 生成的推论 |

首版 `Fact.evidence_kind` 只允许 `observed` 或 `recorded`；推断只能进入 `Insight`，并显示所依据的 `Fact`。这避免内容作者把判断包装成观察事实。首版没有 NPC testimony，因此不加入 `reported`；只有未来 NPC 对话进入范围时才评估新增。

## 数据最小模型

### `Thread`

- 稳定 `thread_id`；
- `central_question`；
- `status: open | resolved`；
- 可选 authored node positions。

### `Fact`

- 稳定 `fact_id`；
- `thread_id`；
- `title`；
- concise summary；
- 可选 detail text；
- `evidence_kind: observed | recorded`；
- discovery trigger；
- 可选来源绝对坐标或 content instance；
- 可选 map visibility。

### `Relation`

- 稳定 `relation_id`；
- 两端 `fact_id`；
- relationship summary；
- reveal requirement：两端 `Fact` 都 known。

### `Insight`

- 稳定 `insight_id`；
- `thread_id`；
- `all_of` 前置 `fact_id`；
- inference text；
- 可选 `Lead` output；
- one-time flag；
- 固定信息性质 `inferred`。

首版只支持 `all_of` 全部满足，不实现通用布尔规则引擎。

### `Lead`

- 稳定 `lead_id`；
- `type: concept | approximate_area | exact_marker`；
- display text；
- 可选 map geometry 或绝对坐标；
- 不自动创建任务。

玩家状态只保存：

- `known_fact_ids`；
- `revealed_relation_ids`；
- `known_insight_ids`；
- `known_lead_ids`；
- read/unread 状态。

这些 ID 与 read state 只由 core narrative 保存。`world_chunks` 不复制 Fact known flag；chunk 只保存叙事来源对应的已知或已改变 world content source state。触发器判断 Fact 是否已经获得时，只查询 core `known_fact_ids`。

正文、关系、推论前置条件和线索定义属于版本化内容数据，不复制进玩家存档作为第二真源。存档所有权见[存档与离线结算协议](save-offline-protocol.md#indexeddb-stores)。内容与存档专项必须在编码前补齐稳定 ID 的命名 grammar 和内容版本关系。

## 首版发现触发器

首版只实现三种触发器：

1. `observe_landmark`：地标首次满足有效观察条件。
2. `complete_action_at_target`：在带叙事标记的资源或生产目标上完成一次有效行动。
3. `kill_enemy_archetype`：首次击杀指定敌人原型。

触发器消费现有确定性玩法事件，不新增帧级检测。一个 `Fact` 首次发现后永久 known；重复触发不重复写入叙事，也不重复发放探索 XP。

`observe_landmark` 只消费[移动协议](movement-navigation-protocol.md#知识与观察)产生的权威观察/发现事件，不自行计算视野。该 Accepted 协议已定义连续 `WorldPoint` 观察圆、tile reveal unit、触发时点和整数事件顺序。起始初始揭示不发 Exploration XP；后续 Fact 首次发现可以按内容表获得一次固定“特殊发现”XP，但同一 Fact 不因 Relation、Insight 或 Lead 再次结算。

关键 `Fact` 不得使用 chance、稀有掉落、限定时刻、一次性可错过对象或互斥选择。发现事件的稳定身份必须与帧率、事件访问顺序和 terrain RNG 无关。

## 自动执行与玩家控制

- 自动探索、资源任务或狩猎都可以触发发现。
- 发现不会弹出阻塞式对话。系统显示简短通知并写入线索簿，原任务继续。
- 新 `Lead` 不自动创建、替换或重排任务。
- `Lead` 带地图位置时，玩家可以在地图或线索簿主动选择“预填探索任务”；位置使用连续 `WorldPoint`，可以仍在迷雾中，但 UI 不读取其周边 terrain 或 target。只有玩家随后通过 `SetTask` 提交，才创建或替换探索任务。
- 事实发现可以让目标或地图位置进入 `WorldKnowledge`，但任务系统仍只按当前 `TaskIntent` 判断它是否相关。

叙事发现不改变[任务执行优先级](automation-tasks.md#执行优先级)，也不增加隐藏任务队列。

## 离线推进

- 离线事件使用与在线相同的 `DiscoveryEvent` 规则。
- 回归报告按发生顺序汇总新 `Fact`、`Relation`、`Insight` 和 `Lead`。
- 离线期间最后一个前置 `Fact` 到达时，可以生成 `Insight` 和地图标记，但不会自动移动到该标记。
- read/unread 状态不影响游戏进度。
- 死亡、任务替换和内容实例重生不删除已经获得的叙事知识。

在线与离线从相同初始状态处理相同事件序列时，必须得到相同知识状态。

## 线索簿 UI

线索簿采用“谜题线列表 + 固定布局关系图 + 事实详情”。首版不提供自由拖拽或运行时物理布局。

- 只显示已发现节点，不显示 `0/3`、空白插槽或剩余节点数量。
- `Thread` 只显示 `open` 或 `resolved`，不显示百分比。
- 新 `Fact` 和新 `Relation` 显示 unread 标记。
- `Fact` 卡显示 title、summary、evidence kind 和来源位置或事件。
- `Relation` 只在两端 `Fact` 都 known 后显示。
- `Insight` 使用不同样式，并明确标注“推论”及依据事实。
- `exact_marker` 或 `approximate_area` 类型 `Lead` 提供“在地图查看”和“预填探索任务”；预填不会直接启动任务。
- open `Thread` 可以显示“仍有未解释的关联”，但不能泄露剩余数量、来源或准确目标。
- 地图和线索簿引用同一个 `Lead` 状态，不能复制两套真源。

Journal drawer 在 gameplay shell 中的位置、宽窄屏层级导航和地图交互见已接受的[玩法界面信息架构](gameplay-information-architecture.md#journal-drawer)。

## 内容写作约束

每个 `Fact` 只陈述一个主要事实。建议长度如下：

- title 不超过 `12` 个汉字；
- summary 不超过 `60` 个汉字；
- detail 不超过 `200` 个汉字，只在需要保留原始刻文或现场细节时使用。

这些长度是作者质量标准，不是运行时截断规则。

每个小型 `Thread` 应满足：

- 包含 `3–7` 个 `Fact`；
- 使用至少两种发现渠道；
- 任何发现顺序都能理解；
- 没有一个 `Fact` 单独给出完整答案；
- 关键路线没有 RNG；
- 每个 `Insight` 明确引用其前置 `Fact`。

## 首个区域谜题线

- 工作标题：`弃置的营地`
- 核心问题：营地的使用者去了哪里？
- 状态：结构稿；正式名词和文案属于世界观内容制作工作

### Fact A：褪色路标

- trigger：`observe_landmark`；
- evidence kind：`observed`；
- 来源：学习圈内确定地标；
- 信息：路标曾被重新刻写，后来的方向指向边界高地；现场没有长期停留痕迹。

### Fact B：修补过的矿痕

- trigger：`complete_action_at_target`；
- evidence kind：`observed`；
- 来源：带叙事标记的浅层铜矿；首次有效开采必定发现；
- 信息：矿面存在与营地工具一致的新近凿痕，开采量只够完成一次小型修补。

### Fact C：残留的营地标记

- trigger：`kill_enemy_archetype`；
- evidence kind：`observed`；
- 来源：首次击杀指定 T2 边界威胁；
- 信息：敌人活动区域留有与营地相同的标记和继续通往边界外的痕迹。

Fact C 直接进入 `WorldKnowledge`，不生成掉落物品。

### Relations

- A ↔ B：重新刻写的方向和临时开采都指向一次仓促移动。
- B ↔ C：修补材料与边界处残留标记属于同一行动轨迹。
- A ↔ C：路标方向与边界痕迹一致。

每条 `Relation` 在两端 `Fact` 都 known 后一次性揭示。Fact 可以任意顺序取得；第三个 Fact 到达时揭示尚未出现且前置已满足的 Relation，并生成以下 Insight。

### Insight 与 Lead

- `all_of`：A、B、C；
- evidence kind：`inferred`；
- 文本结构：营地使用者并非在营地结束行动；现有证据支持他们携带临时修补物资前往边界高地；
- 输出：一个 `exact_marker` 类型 `Lead`，标记下一阶段方向；
- 状态变化：将 `Thread` 标记为 `resolved`；
- 只触发一次。

该推论不发物品，不发额外技能 XP，也不弹出任务完成奖励。阶段成果只有新知识和新方向。

## 与探索 XP 的边界

- `Fact` 首次发现可以按已确认的“特殊发现”规则发放一次探索 XP。
- 同一 `Fact` 只发放一次。
- `Relation`、`Insight` 和 `Lead` 是已知事实的组织结果，不额外发探索 XP，避免同一次发现多重结算。
- 叙事发现不创建独立 Narration skill。

每个 `Fact` 的具体探索 XP 必须由内容表声明；本文不新增数值。

## 阶段成果

首版把“resolved `Thread` + 新 `Lead`”定义为叙事阶段成果。

- 不显示传统任务完成框。
- 不提供货币、装备或永久属性奖励。
- 不设计排行榜、首杀或多人比较。
- 玩家获得更深的世界知识和可以继续探索的方向。

未来异步互动若进入范围，可以重新评估是否比较已公开的知识阶段；当前不预建字段。

## 明确排除

- NPC 对话树和对话选择；
- 道德阵营；
- 任务接取、交付和目标列表；
- 叙事物品；
- 随机 lore drop；
- 可错过关键 `Fact`；
- 通用条件表达式；
- 程序生成正文或 AI 动态故事；
- 自由拖拽关系图；
- 百分比完成度；
- 知识货币；
- 排行榜和多人共享线索。

## 验收标准

- A、B、C 按任意发现顺序都得到相同的 Relation、Insight 和 Lead 集合。
- 每个 `Fact`、`Relation`、`Insight` 和 `Lead` 只触发一次并持久化。
- 重复资源行动或击杀不重复发放 `Fact` 或探索 XP。
- 在线与离线对相同事件序列产生相同知识状态。
- 死亡和任务替换不丢失知识。
- 发现不暂停自动任务，也不自动设置新任务。
- 玩家预填并提交后，系统才能把 `Lead` 转成探索目的地任务。
- UI 区分 `observed`、`recorded` 和 `inferred`，不能把推论写成观察事实。
- UI 不泄露未发现节点或剩余数量。
- 叙事正文不进入 inventory 或 drop table。
- 叙事内容变化不修改 terrain payload 或 `GENERATOR_VERSION`。
- 内容作者可以从每个 `Insight` 追溯全部依据 `Fact`。

## 实现、内容与验证工作

- 内容与存档专项须在编码前补齐 `thread_id`、`fact_id`、`relation_id`、`insight_id` 和 `lead_id` grammar，以及叙事内容与 `CONTENT_VERSION`、游戏规则版本和存档 schema 的字段边界。
- 事件实现专项须记录发现事件的稳定身份和离线汇总格式；同刻全局顺序直接遵守已接受的移动与存档协议。
- 内容专项须在内容表声明各 `Fact` 的特殊发现 XP、有效观察条件和 `exact_marker` 坐标。
- 世界观专项须完成“弃置的营地”、三项 `Fact`、`Insight` 和 `Lead` 的正式名称与正文。
- 首个切片只使用一次性 `open → resolved`；未来若需要重新打开 Thread，必须作为新的产品范围决策。
- UI 专项须按已接受的[玩法界面信息架构](gameplay-information-architecture.md)完成 Journal drawer、地图预填、窄屏层级导航和可访问性 fixtures。

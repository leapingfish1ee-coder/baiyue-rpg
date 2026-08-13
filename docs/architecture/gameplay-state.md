# 玩法状态边界

状态：已确认概念设计；阶段 1 至 2C 子集已实现，战斗、死亡与叙事边界尚未实现。

玩法状态必须与确定性地形生成、渲染和内容定义分离。本文定义所有权和持久化边界，不规定代码语言、数据库或序列化格式。

[存档与离线结算协议](../requirements/save-offline-protocol.md)已经接受 IndexedDB store 边界、gameplay worker 单写入者和 offline claim。阶段 1 至 2C 的精确 keyPath 与字段已经实现；当前增量见[阶段 2C 运行时契约](../specifications/phase-2c-runtime-contracts.md)。未来战斗、死亡和叙事字段仍须在对应实现专项中封板。

## 状态关系

```text
TaskIntent ───────────────┐
                         ▼
WorldKnowledge ──► ExecutionState ──► CombatState
        │                │                 │
        │                ▼                 ▼
        └────────► SkillProgress      RespawnState
```

`TaskIntent` 表达玩家决定；`ExecutionState` 表达系统此刻正在做什么。战斗和死亡可以改变执行状态，但不能静默改写任务意图。

## SkillProgress

每个已发布技能保存：

- 技能标识；
- 永久基础等级；
- 累计经验。

等级和累计经验必须与当前游戏规则版本定义的升级曲线一致。装备和临时效果不写入永久基础等级。

技能解锁内容来自版本化内容表，不复制到 `SkillProgress` 作为第二真源。界面可以缓存派生结果，但必须能重建。

## TaskIntent

一个活动任务保存：

- 任务类别；
- 目标类型、配方或连续世界坐标探索目的地；
- 可选数量；
- 已完成数量；
- 创建时间。

替换或取消结束旧任务实例并丢弃其已完成数量。已结算的物品、击杀、经验和世界知识属于各自永久状态，不由 `TaskIntent` 回滚。

战斗中 `SetTask` 或 `CancelTask` 立即原子替换或清除唯一 `TaskIntent`，并立即丢弃旧 task counter。`ExecutionState` 仍保持 `战斗`，直到战斗结束或角色复活后执行当时唯一的 `TaskIntent`。状态中不保存 pending task、第二个 active intent 或 queue。

## ExecutionState

当前执行状态至少保存：

- 状态类型；
- 当前目标实例；
- 当前路径或可重建路径所需输入；
- 可暂停或重建的当前 movement progress，或 non-combat action 的剩余时间；
- 等待原因。

[自由向量移动协议](../requirements/movement-navigation-protocol.md#存档与离线契约)要求 `ExecutionState` 保存 canonical fixed-point `WorldPoint`、当前任意角 path/path index，以及 motion leg 的 start/end、world time 和累计加权成本。字段编码由实现专项补齐，但语义已经 Accepted。

状态类型至少覆盖 `索取目标`、`前往目标`、`执行行动`、`自动探索`、`战斗`、`等待复活`、`等待条件`、`已完成`。

forced combat 打断 movement execution 或 non-combat action 时，可恢复进度保存在 `ExecutionState`。战斗结束后，只有 `TaskIntent`、action target 和 prerequisites 未改变，才继续有效进度。自由向量协议规定从精确交战位置继续剩余 path。任务替换、任务取消或装备变化会先物化当前位置，再取消旧 route/action 并重新计算；未完成周期不产出、不消耗材料，也不发 XP。

路径如果作为缓存保存，必须能在导航或目标状态变化后失效并重建，不能成为世界知识的第二真源。

## WorldKnowledge

玩家世界状态保存：

- 每个已知 tile 的永久 `Revealed` 状态；
- 已知目标及其最近已知状态；
- 地标、资源类型、敌人类型和叙事线索的首次发现记录。

世界知识不改变地形生成 bytes。目标当前是否有效由世界内容状态决定；不可达、耗尽或死亡的目标可以保留知识，但不进入候选集。

[碎片叙事与线索簿](../requirements/narrative-cluebook.md)已经接受 `Fact`、`Relation`、`Insight` 和 `Lead` 的持久化结构；稳定 ID grammar 由内容与存档专项在编码前补齐。

存档只在 core narrative 保存 `known_fact_ids` 与 read state。chunk records 只保存叙事来源对应的已知或已改变 world content state，不能复制 Fact known flag。Fact 是否已经触发只查询 core `known_fact_ids`。

## CombatState

战斗状态至少保存：

- 当前交战对象；
- 生命和其他已定义持续战斗资源；
- 限时增益与减益及其世界时间截止点；
- 未来多种战斗方式使用的有效伤害贡献。

当前近战版本仍应把经验作为击杀结算，而不是把逐次攻击持久化为经验。伤害贡献只有未来多战斗方式进入范围时才参与经验包分配。

敌人身份必须区分 `placement_id`、单调持久化的 `spawn_cycle` 和由两者构成的 `encounter_instance_id`。地图知识与 `next_available_time` 使用 `placement_id`；一次性遭遇、潜行 XP 去重和 combat RNG 使用 `encounter_instance_id`。

## RespawnState

死亡状态至少保存：

- 精确死亡 `WorldPoint`；
- 复活等待截止时间。

HP 归零时立即结束战斗、清除 temporary effects、令导致死亡且仍存活的敌人恢复满状态，并取消当前 movement execution 或 non-combat action cycle。死亡前未完成的 movement/action progress 不再属于有效恢复状态。

死亡等待期间 world time 和其他 world events 继续，但 dead player 的 HP 和其他战斗资源不自然恢复。等待结束后，角色在精确死亡位置复活，并从头重新评估当时唯一的 `TaskIntent`、目标和路径。

自由向量协议把 Accepted 首轮 respawn baseline 具体化为 `max_hp` 和其他首版战斗资源的默认值，并增加 world-time 截止的 `5s RevivalGrace` 系统状态。它不是 buff/debuff；具体强制遭遇豁免见[移动协议](../requirements/movement-navigation-protocol.md#revivalgrace)。

## 库存与内容定义边界

库存的具体 schema 不在本文定义，但必须由独立玩家状态层拥有。生产系统只在周期完成时通过原子结算消费材料并产生输出；库存变化必须发布可用于唤醒 `等待条件` 的状态事件。

[物品与装备系统](../requirements/item-equipment.md)已经接受库存语义、装备槽和原子结算边界；精确 schema 由物品与存档专项在编码前补齐。

目标、配方、工具和装备等内容表至少需要声明与本文相关的：永久等级要求、基础持续时间、固定基础经验、输入、完整输出、工具要求、目标有效性和重生规则。内容表不是玩家存档。

## 随机域

地形生成随机性和游戏事件随机性必须分离：

- 地形生成只使用 world seed、`GENERATOR_VERSION` 和绝对世界坐标。
- 遭遇、战斗和其他玩法随机事件使用独立游戏规则版本、事件身份和稳定随机流。
- 任何玩法结果不得依赖帧率、容器遍历顺序或 chunk 访问顺序。

## 版本边界

以下版本必须独立：

| 版本 | 责任 |
|---|---|
| 地形 generator version | 决定确定性地形 bytes |
| 游戏规则版本 | 决定技能曲线、平衡参数、遭遇和玩法结算规则 |
| 存档 schema 版本 | 决定玩家状态的序列化结构 |

技能平衡变化不得修改地形 `GENERATOR_VERSION`。存档字段变化也不能被伪装成地形生成变更。

在首次稳定存档格式确定前，首轮平衡基线可以通过显式游戏规则决策调整。稳定格式建立后，曲线或存档语义变化必须单独决定 schema 处理方式；MVP 不因此保留旧地形生成器。

[存档协议](../requirements/save-offline-protocol.md#独立版本)把 `DB_SCHEMA_VERSION`、`SAVE_SCHEMA_VERSION`、`GAME_RULES_VERSION`、`CONTENT_VERSION` 和 `GENERATOR_VERSION` 分开记录，并规定版本不匹配时拒绝加载。这一模型已由 [Decision-0003](../decisions/0003-first-playable-slice-baseline.md) 接受；各版本初值由实现专项在编码前记录。

## 在线与离线

离线推进从同一持久化状态开始，使用相同任务、执行、世界知识、战斗和复活语义。批处理只是一种计算方式，不得建立第二套结果模型。

本地时钟限制和离线报告见[离线推进](../requirements/offline-progression.md)。

`resume_claim`、same-time ordering 和 gameplay worker 所有权见已接受的[存档与离线结算协议](../requirements/save-offline-protocol.md)。

## 持久化时点

至少在以下有效结算后持久化对应永久状态：

- 资源或生产行动完整完成；
- 首次揭露或首次发现；
- 击杀、掉落和经验包结算；
- 技能升级和内容解锁派生变化；
- 任务创建、替换、取消或完成；
- 死亡、复活和离线推进结束。

未完成生产周期、未击杀敌人和未完整通过威胁区不生成对应永久奖励。

加载时可以根据保存的有效 movement/action progress 恢复被中断执行，或从相同权威输入稳定重算。死亡时已经取消的 movement/action 不得恢复。完整 path 仍是可失效 cache，不是持久化真源；两种恢复路线不能产生不同结算结果。

事务 commit、dirty chunk records、自动保存和导入导出已按[存档协议](../requirements/save-offline-protocol.md)实现阶段 1 至 2C 范围。未来系统仍须复用同一四-store 边界，不得建立第二套持久化真源。

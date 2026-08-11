# 阶段 2A 运行时契约

- 状态：Implemented
- 适用范围：[阶段 2A：基础采集垂直切片](../engineering/phase-2a-gathering-vertical-slice.md)
- 基础契约：[阶段 1 运行时契约](phase-1-runtime-contracts.md)
- 审计日期：2026-08-11

本文只记录阶段 2A 对既有 gameplay Worker、事件引擎、read model 和四-store 存档的增量。未列出的阶段 1 协议继续有效。源码中的 strict union 和 validator 是运行时最终边界。

## 版本与固定 ID

| 字段 | 值 |
|---|---:|
| `GAMEPLAY_PROTOCOL_VERSION` | `1` |
| `DB_SCHEMA_VERSION` | `1` |
| `SAVE_SCHEMA_VERSION` | `2` |
| `GAME_RULES_VERSION` | `2` |
| `CONTENT_VERSION` | `2` |
| `GENERATOR_VERSION` | `3` |

阶段 2A 固定 `prototypeId = "wild_fiber"`、`itemId = "fiber"`、`skillId = "gathering"` 和 `task.kind = "Gather"`。产品和 runtime union 不包含其他采集、生产、装备、敌人或战斗 ID。

新增 ID grammar：

```text
placement-id = "place:wild-fiber:ambient:" signed-decimal ":" signed-decimal
             | "place:wild-fiber:guarantee:initial-observation"
             | "place:wild-fiber:guarantee:ring-a"
             | "place:wild-fiber:guarantee:ring-b"
action-id    = "action:" unsigned-decimal ":" unsigned-decimal
event-id     = "evt:" unsigned-decimal ":" unsigned-decimal
```

ambient placement 的两个整数依次是绝对 `cell_x`、`cell_y`。action 和 event 的两个整数依次是权威 `world_time_ms`、单存档 event ordinal。当前 action/save/read model 使用 `action-id`；settlement 通过同一持久化 ordinal 保持确定顺序，不增加第二个事件日志。

## 内容放置

- ambient 内容层使用绝对 `32×32 tiles` cell。负坐标通过 Euclidean floor division 计算。
- 每个 cell 只有一个 `wild_fiber` candidate。hash 输入为 seed、`CONTENT_VERSION`、prototype ID、营地 anchor 和绝对 cell 坐标。
- ambient 只在 candidate tile 为 `Land` 时物化。interaction point 是 tile center；角色半径小于半格，因此 Land tile center 满足当前局部站立边界。全局可达性只由既有 planner 判断。
- 新世界 revision `1` 提交前，Worker 验证 initial-observation、ring-a 和 ring-b 三个稳定保证节点。后两个节点的营地 Chebyshev 距离为 `6..20 tiles`。三个节点必须位于 distinct Land tiles，并由既有 planner 证明可从营地到达。
- observation 只把已揭露 placement 写入 WorldKnowledge。初始 observation 至少写入 initial-observation 节点，因此 `knownTargetPrototypeIds` 包含 `wild_fiber`。迷雾后的另外两个保证节点不会提前进入 read model。

## Task、action 与 read model

`TaskIntent` 增加：

```ts
type GatherTask = {
  taskId: TaskId;
  kind: "Gather";
  targetPrototypeId: "wild_fiber";
  quantity: SafeUint | null;
  completedQuantity: SafeUint;
  createdWorldTimeMs: WorldTimeDecimal;
};
```

`quantity` 为正安全整数或 `null`。`null` 表示持续任务。`SetTask` 只接受已知 `wild_fiber`；未知类型返回 `command/unknown_target_prototype`。

Worker read model 增加：

- `activity.phase`、`routePurpose`、`targetPlacementId` 和权威 action 摘要；
- action 的 `durationMs`、`remainingMs` 和 `skillSpeedBps`；
- `skills.gathering`、已获得的 `inventory.items[fiber]`；
- `knownTargetPrototypeIds` 和已观察的 `map.resourcePlacements`；
- offline report 的 `fiberGained` 和 `gatheringXpGained`。

UI 只显示 Worker 提供的 duration、remaining 和 bps，不重算行动时间。

## 数值与事件顺序

`wild_fiber` 的实施基线为：行动 `6000ms`、产出 `fiber ×1`、采集 XP `6`、一次行动后耗尽、`60000ms` world-time 后重生。

权威行动时间使用：

```text
skill_speed_bps = min(max(gathering_level - 1, 0) × 50, 2500)
duration_ms = max(ceil(6000 × 10000 / (10000 + skill_speed_bps)), ceil(6000 × 2500 / 10000))
```

候选索取按既有 route cost 取最小值，同 cost 按 placement ID。节点失效后重新索取；没有已知 active 节点时，保留原 `Gather` intent 并使用 `routePurpose = "auto_explore"`。finite 任务完成后保留完整产出并进入 `TaskCompleted` 待机。

## 存档与原子提交

物理数据库仍为 `meta`、`core`、`world_chunks`、`resume_claim` 四个 store。`core` 增加营地 anchor、`skills.gathering`、`inventory.fiber`、Gather intent、action、target 和 event ordinal。`world_chunks` 增加已知 placement 及 active/depleted、spawn cycle、耗尽时间和重生时间。

action completion 先验证 fiber、采集 XP、任务计数和 spawn cycle 的安全整数上限，再在 engine 中同时更新全部字段。任一数量溢出时 settlement 整体不生效，并以 `integrity/quantity_overflow` 暂停 simulation。

每次成功 settlement 立即通过一个 IndexedDB transaction 提交 core、dirty world chunks 和 meta。在线 read model 在 `tx.done` 后才显示该 settlement 为已保存。离线 fast-forward 复用同一事件引擎；每次 settlement 先提交 checkpoint，再继续使用剩余 credited duration。reload 通过保存的 action 起止时间和 ordinal 恢复，不重新开始已结算 action。

阶段 1 存档因版本不匹配而拒绝加载。实现不迁移旧存档；原始导出和确认重置仍可用。

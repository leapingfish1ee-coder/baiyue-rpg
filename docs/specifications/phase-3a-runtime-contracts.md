# 阶段 3A 运行时契约

- 状态：Implemented
- 适用范围：[阶段 3A：T1 狩猎与连续战斗](../engineering/phase-3a-t1-hunting-combat.md)
- 基础契约：[阶段 2C 运行时契约](phase-2c-runtime-contracts.md)
- 审计日期：2026-08-13

本文记录阶段 3A 对内容、gameplay Worker、确定性事件引擎、read model 和四-store 存档的增量。未列出的阶段 1 至 2C 边界继续有效。strict union、runtime validator 和源码内容表是最终运行时边界。

## 版本

| 字段 | 值 |
|---|---:|
| `GAMEPLAY_PROTOCOL_VERSION` | `2` |
| `DB_SCHEMA_VERSION` | `1` |
| `SAVE_SCHEMA_VERSION` | `5` |
| `GAME_RULES_VERSION` | `5` |
| `CONTENT_VERSION` | `5` |
| `CONTENT_PLACEMENT_VERSION` | `3` |
| `ENEMY_PLACEMENT_VERSION` | `1` |
| `GAMEPLAY_RANDOM_VERSION` | `1` |
| `GENERATOR_VERSION` | `3` |

protocol v1 与阶段 2C 存档因版本不匹配而拒绝。实现不包含迁移、兼容字段或旧内容 fallback。资源 placement 和 terrain bytes 未改变。

## 敌人内容、知识与任务

内容表只发布 `graymane_boar`、`raw_hide` 和固定 `worn_blade`。三个保证巢点追加在既有八个资源 guarantee slot 后。ambient enemy 每个绝对 `32×32 tiles` cell 最多一个候选；安全圈、Land/站立检查或既有内容冲突失败时直接丢弃。

`world_chunks` 的敌人记录保存稳定 placement、`spawn_cycle`、active/dead、重生 deadline，以及当前 spawn cycle 的遭遇、pending stealth pass 和结算状态。迷雾后的敌人不进入记录、read model、遭遇或目标候选。

`TaskIntent` 增加 `Hunt`：

```ts
type HuntTask = {
  taskId: TaskId;
  kind: "Hunt";
  archetypeId: "graymane_boar";
  requestedKills: SafeUint | null;
  completedKills: SafeUint;
  createdWorldTimeMs: WorldTimeDecimal;
};
```

Worker 只接受已知 archetype。`requestedKills = null` 表示持续狩猎。候选按权威 route cost 和 placement ID 排序；无 active 目标时保留原任务并自动探索。

## 遭遇与战斗

非狩猎 motion 使用 swept segment 的首次入圈事件。发现、命中和伤害分别使用版本化 purpose；同一 `placement_id + spawn_cycle` 不重复发现判定。未被发现时保存 pending pass，完整出圈才结算 Stealth XP。

`CombatState` 是 `TaskIntent` 上方的高优先级 overlay。它保存双方开战属性、enemy micro-HP、独立攻击 deadline、combat event ordinal、最近一次攻击和被暂停执行。暂停 movement 会保存 route、segment profile、route index、已用 route 时间和 boundary index；reload 后战斗时间不推进 movement。任务、目标与 prerequisites 未改变时，胜利后从精确交战坐标恢复同一路径。暂停 action 保存剩余时间并按相同条件恢复。

同刻先执行玩家攻击。击杀在一个 transition 中写入 enemy dead/重生 deadline、Melee XP、`raw_hide`、匹配 Hunt 计数和统计计数，并标记 immediate commit。安全整数失败时不写入部分结果。

## 生命、死亡与恢复

HP 使用 `1 HP = 1,000,000 micro-HP`。`core.hp` 保存 current、max 和自然恢复余数。存活世界时间按 Decision-0007 的整数公式恢复；满生命清空余数，死亡等待不恢复。

玩家死亡会结束战斗、清除被暂停执行、令致死敌人保持 active 满状态，并在精确位置创建 `60000ms` RespawnState。复活设置满生命和零余数，再创建 `5000ms` RevivalGrace。唯一 `TaskIntent` 保留并从头重评。

## 存档、离线与 read model

数据库继续只使用 `meta`、`core`、`world_chunks` 和 `resume_claim`。`core` 增加 Melee/Stealth、`raw_hide`、HP、CombatState、RespawnState、RevivalGrace 和击杀/死亡/复活计数。备份、import/export/reset、checksum 和 command receipt 复用同一 v5 schema。

online tick、offline claim 和 reload 调用同一个整数世界时间事件引擎。离线报告增加 Melee/Stealth XP、`raw_hide` 净变化、目标/其他击杀、死亡、复活和最终 HP；不保存第二套战斗日志。

产品 read model 和 UI 增加 Hunt、Melee/Stealth、当前/最大生命、固定武器、敌人状态、战斗双方生命与攻击 ETA、复活倒计时、`raw_hide` 和离线战斗摘要。T2、工作站、Smithing、可更换武器、防具、饰品、消耗品、远程、魔法和叙事不进入本契约。

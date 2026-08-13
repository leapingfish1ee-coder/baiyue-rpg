# 阶段 2B 运行时契约

- 状态：Implemented
- 适用范围：[阶段 2B：伐木与采矿垂直切片](../engineering/phase-2b-woodcutting-mining-vertical-slice.md)
- 基础契约：[阶段 2A 运行时契约](phase-2a-runtime-contracts.md)
- 审计日期：2026-08-13

本文记录阶段 2B 对 gameplay Worker、事件引擎、read model 和四-store 存档的增量。未列出的阶段 1 和阶段 2A 边界继续有效。源码中的 strict union 和 runtime validator 是最终运行时边界。

## 版本

| 字段 | 值 |
|---|---:|
| `GAMEPLAY_PROTOCOL_VERSION` | `1` |
| `DB_SCHEMA_VERSION` | `1` |
| `SAVE_SCHEMA_VERSION` | `3` |
| `GAME_RULES_VERSION` | `3` |
| `CONTENT_VERSION` | `3` |
| `GENERATOR_VERSION` | `3` |

阶段 2A 存档因版本不匹配而拒绝加载。实现不包含迁移、旧 schema 分支或旧内容 fallback；原始导出和确认重置入口继续保留。terrain bytes 未改变，因此 `GENERATOR_VERSION` 保持 `3`。

## 资源、工具与任务

资源定义表是内容与结算数值的唯一真源：

| prototype | task | skill | level | tool | duration | output | XP | respawn |
|---|---|---|---:|---|---:|---|---:|---:|
| `wild_fiber` | `Gather` | `gathering` | 1 | 无 | `6000ms` | `fiber ×1` | 6 | `60000ms` |
| `softwood_tree` | `Woodcut` | `woodcutting` | 1 | `axe` tier 0 | `10000ms` | `softwood ×1` | 10 | `120000ms` |
| `surface_stone` | `Mine` | `mining` | 1 | `pickaxe` tier 0 | `12000ms` | `stone ×1` | 12 | `120000ms` |
| `shallow_copper_deposit` | `Mine` | `mining` | 5 | `pickaxe` tier 0 | `18000ms` | `copper_ore ×1` | 23 | `240000ms` |

`TaskIntent` 保留显式 `Explore | Gather | Woodcut | Mine` union。runtime validator 固定 task 与 prototype 映射；`Woodcut` 只能选择软木树，`Mine` 只能选择地表石或浅层铜矿。三个资源任务共用一条 prerequisite、target acquisition、movement、action、settlement 与重新索取 transition。

等级不足时，Worker 返回 `command/skill_level_too_low`，且不创建任务。缺少工具时，Worker 保留任务并进入 `Waiting: MissingTool`；角色不移动，也不为该任务自动探索。

## 内容放置

- ambient 内容继续使用绝对 `32×32 tiles` cell、Euclidean 负坐标和 prototype-domain hash。
- 同一 cell 中各 prototype 最多一个 candidate。冲突顺序固定为 `wild_fiber`、`softwood_tree`、`surface_stone`、`shallow_copper_deposit`；guarantee 优先于 ambient。
- 新世界 revision `1` 前验证八个 guarantee slot：三个野生纤维、两个软木树、两个地表石和一个浅层铜矿。
- 浅层铜矿位于起始 chunk 外、营地周围 `3×3 chunks` 内，距营地 `64..96 tiles`，并由既有 planner 证明可达。
- placement 只在 observation 后进入 WorldKnowledge 和 read model。已发现的浅层铜矿在 mining 5 前以 locked 状态显示。

## 装备与行动中断

阶段 2B 只定义 `axe`、`pickaxe` 两个槽位，以及 `worn_axe`、`worn_pickaxe` 两件 tier 0、`0 bps` 工具。新世界创建时两件工具已装备；卸下后进入 inventory，重新装备必须由 `EquipItem` command 明确触发。

`EquipItem` 与 `UnequipSlot` 先物化权威世界时间和精确位置，再取消 route 与未完成资源 action，然后重新评估保留的任务。取消的 action 不产生材料、XP、任务进度或节点变化。

read model 的 action 摘要提供 `baseDurationMs`、`skillSpeedBps`、`toolSpeedBps`、`totalSpeedBps`、`durationMs` 和 `remainingMs`。UI 只显示这些权威字段，不重算行动时间。

## 结算、存档与离线

资源完成事件在一次 engine transition 中验证并更新节点耗尽与重生、材料数量、对应技能 XP、任务计数和 event ordinal。任一安全整数溢出时，settlement 整体拒绝并暂停 simulation。

成功 settlement 立即通过既有 IndexedDB transaction 提交 `core`、dirty `world_chunks` 和 `meta`；数据库仍只包含 `meta`、`core`、`world_chunks`、`resume_claim` 四个 store。online、offline 和 reload 复用同一移动、发现、行动、结算与重生事件语义。

offline report 使用增量列表，且列表只保留非零条目：

```ts
itemGains: Array<{ itemId: "fiber" | "softwood" | "stone" | "copper_ore"; quantity: number }>
skillXpGains: Array<{ skillId: "exploration" | "gathering" | "woodcutting" | "mining"; xp: number }>
```

阶段 2A 的单资源离线收益字段不再存在。

## 产品 read model

产品只显示已发布内容：探索、采集、伐木和采矿技能；四种材料；实际持有的两件工具；axe/pickaxe 装备；已知资源、锁定等级、MissingTool、任务路线和权威活动。生产、其他装备槽、敌人、战斗和叙事不进入阶段 2B read model 或产品入口。

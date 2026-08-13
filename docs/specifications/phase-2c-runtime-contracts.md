# 阶段 2C 运行时契约

- 状态：Implemented
- 适用范围：[阶段 2C：手工工艺与工具升级垂直切片](../engineering/phase-2c-crafting-tool-upgrades.md)
- 基础契约：[阶段 2B 运行时契约](phase-2b-runtime-contracts.md)
- 审计日期：2026-08-13

本文记录阶段 2C 对 gameplay Worker、事件引擎、read model 和四-store 存档的增量。未列出的阶段 1、2A 和 2B 边界继续有效。源码中的 strict union、runtime validator 和内容表是最终运行时边界。

## 版本

| 字段 | 值 |
|---|---:|
| `GAMEPLAY_PROTOCOL_VERSION` | `1` |
| `DB_SCHEMA_VERSION` | `1` |
| `SAVE_SCHEMA_VERSION` | `4` |
| `GAME_RULES_VERSION` | `4` |
| `CONTENT_VERSION` | `4` |
| `GENERATOR_VERSION` | `3` |

阶段 2B 存档因版本不匹配而拒绝加载。实现不包含迁移、旧 schema 分支、兼容字段或旧内容 fallback；原始导出和确认重置入口继续保留。

`CONTENT_VERSION = 4` 管理新增配方与物品。既有资源 placement 继续使用显式 `CONTENT_PLACEMENT_VERSION = 3`，因此内容版本升级不会移动阶段 2B 已冻结的节点。terrain bytes 未改变，`GENERATOR_VERSION` 保持 `3`。

## 内容表

生产内容是闭合集合：

| recipe | level | inputs | base duration | output | XP | station |
|---|---:|---|---:|---|---:|---|
| `rope` | 1 | `fiber ×2` | `12000ms` | `rope ×1` | 12 | handcraft |
| `reinforced_axe` | 2 | `softwood ×4 + rope ×2 + stone ×2` | `30000ms` | `reinforced_axe ×1` | 30 | handcraft |
| `reinforced_pickaxe` | 2 | `softwood ×4 + rope ×2 + stone ×3` | `30000ms` | `reinforced_pickaxe ×1` | 30 | handcraft |

三项配方从新世界开始均为已知。read model 保留等级不足的配方并标记 `locked`；`SetTask` 绕过 UI 时由 Worker 返回 `command/recipe_level_too_low`。存档不保存 recipe unlock 集合。

## 任务、等待与行动

`TaskIntent` 增加生产分支：

```ts
type ProduceTask = {
  taskId: TaskId;
  kind: "Produce";
  recipeId: "rope" | "reinforced_axe" | "reinforced_pickaxe";
  requestedQuantity: SafeUint | null;
  completedQuantity: SafeUint;
  createdWorldTimeMs: WorldTimeDecimal;
};
```

`requestedQuantity = null` 表示持续生产。正整数表示 finite 任务。生产仍使用唯一 `TaskIntent`；`SetTask` 替换旧任务，`CancelTask` 清除旧任务。两者都会取消未完成生产周期。

生产在当前位置执行，不创建 route、placement 或 target identity。生产 action 保存：

- `actionId`；
- `recipeId`；
- `startWorldTimeMs`、`endWorldTimeMs` 和 `durationMs`；
- `skillSpeedBps` 和 `totalSpeedBps`。

材料不足时保留任务及已完成数量，并进入 `Waiting: MaterialsMissing`。reason 保存当前配方的全部缺口：`itemId`、显示名、`required`、`available` 和 `missing`。缺口只包含 `missing > 0` 的合法 recipe input。加载、离线 claim 或其他库存变化事件会重新评估；等待状态不按时间轮询，也不自动采集或替换任务。

## 速度与结算

Crafting duration 使用 Decision-0006 的整数 basis-point 公式。本阶段只有永久 Crafting 等级来源，`totalSpeedBps = skillSpeedBps`。read model 提供基础时间、权威实际时间和速度来源；UI 不重算。

一个生产完成事件在同一 engine transition 中：

1. 重新验证全部 inputs。
2. 计算全部扣减与完整 output。
3. 验证物品、Crafting XP 和任务计数不会超过安全整数。
4. 同时写入库存、Crafting XP、任务计数、event ordinal 和 revision。
5. 标记 immediate commit。

任一检查失败时不写入部分结果。成功 settlement 通过既有 IndexedDB transaction 提交 `core`、dirty `world_chunks` 和 `meta`；生产本身不产生 dirty world chunk。finite 任务到量后进入 `TaskCompleted`。continuous 任务重新检查材料；不足时进入 `MaterialsMissing`。

online、offline 和 reload 使用同一 action deadline 与完成 transition。加载中的有效生产 action 按原 `endWorldTimeMs` 恢复；已提交 settlement 不会在 reload 后重复。

## 工具升级

| item | slot | tier | permanent requirement | action speed |
|---|---|---:|---|---:|
| `reinforced_axe` | `axe` | 1 | Woodcutting 2 | woodcutting `+1000 bps` |
| `reinforced_pickaxe` | `pickaxe` | 1 | Mining 2 | mining `+1000 bps` |

两件工具复用阶段 2B 的 `EquipItem`、`UnequipSlot` 和原子 swap。等级读取永久技能等级。等级不足返回 `command/equipment_level_too_low`，且库存和原槽位不变。

装备变更先物化当前世界时间和位置，再取消当前 route 或未完成 non-combat action，并重新评估保留的任务。强化工具只影响之后开始的对应资源行动。它不改变产量、XP、准入等级或重生。

技能等级 2 对 required-level 1 的软木树和地表石提供 `50 bps`。强化工具再提供 `1000 bps`，因此 action read model 报告 `skillSpeedBps = 50`、`toolSpeedBps = 1000` 和 `totalSpeedBps = 1050`。对应实际时间为软木树 `9050ms`、地表石 `10860ms`。

## 存档与离线报告

数据库继续只使用 `meta`、`core`、`world_chunks` 和 `resume_claim` 四个 store。`core` 增加：

- `skills.crafting`；
- `inventory.rope`、`reinforced_axe` 和 `reinforced_pickaxe`；
- `Produce` task；
- `Produce` action；
- 扩展后的 axe/pickaxe equipment item union。

离线报告使用有符号非零 `itemDeltas`。生产可以同时报告负的 input delta 与正的 output delta。`skillXpGains` 增加 `crafting`。报告不保存按 recipe 展开的第二套统计。

## 产品 read model

产品 read model 增加：

- Crafting 等级、累计 XP、当前等级 XP 和速度；
- 三项配方的稳定 input/output、等级、锁定、基础时间、实际时间、XP 和 handcraft 标记；
- `rope` 与两件强化工具库存；
- 四件工具候选的 slot、tier、速度、永久等级要求、持有数量和装备状态；
- `production_action`、`MaterialsMissing` 和生产任务进度。

产品只发布 Crafting、上述三项配方、`rope` 和两件强化工具。工作站、Smithing、铜刃、战斗装备、敌人、战斗、叙事和配方解锁不进入 schema、read model 或 UI。

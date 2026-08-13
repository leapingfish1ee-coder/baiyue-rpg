# 阶段 2B：伐木与采矿垂直切片

- 状态：Implemented
- 起草日期：2026-08-11
- 决策者：项目负责人
- 前置实现：[阶段 2A 当前状态](../product/current-state.md)
- Accepted 决策：[Decision-0005](../decisions/0005-resource-actions-and-tools.md)

> 本文是阶段 2B 的封板实施基线。它只定义阶段 2B 增量，不改变尚未进入范围的生产、战斗和叙事需求。

## 目标

在已工作的探索与采集产品上交付第二条生活技能闭环：

```text
新世界发现软木树与地表石
→ 玩家明确选择伐木或采矿及目标
→ 已装备工具时索取、移动和行动
→ 缺少工具时保留任务并明确等待
→ 玩家重新装备后从当前状态继续评估
→ 原子结算材料、技能 XP、任务计数和节点重生
→ 提升采矿等级后发现并开采边界浅层铜矿
→ online、offline、reload 使用同一资源执行器
```

## 范围

### 包含

- `softwood_tree`、`surface_stone`、`shallow_copper_deposit`；
- `softwood`、`stone`、`copper_ore`；
- `woodcutting`、`mining`；
- `Woodcut`、`Mine` `TaskIntent`；
- `axe`、`pickaxe` 两个装备槽；
- `worn_axe`、`worn_pickaxe` 两件定义型起始工具；
- equip、unequip、`MissingTool` 等待和行动取消；
- 多 prototype placement、已知类型、锁定要求和地图状态；
- 在线、离线、reload 与立即 settlement commit；
- Task、Skills、Inventory、Equipment、Map 和 bottom activity 的实际 UI。

### 明确排除

- `reinforced_axe`、`reinforced_pickaxe` 及其他工具；
- `weapon`、`body`、`accessory` 和 `worn_blade`；
- 配方、生产任务、锻造、工艺和工作站；
- 敌人、潜行、战斗、死亡、掉落和叙事；
- 容量、重量、仓库、耐久、品质、强化、loadout 和自动换装；
- 旧存档迁移、兼容层或旧内容版本 fallback。

## 稳定内容表

| prototype | task | skill | required level | tool | base duration | output | XP | respawn |
|---|---|---|---:|---|---:|---|---:|---:|
| `wild_fiber` | `Gather` | `gathering` | 1 | 无 | `6000ms` | `fiber ×1` | 6 | `60000ms` |
| `softwood_tree` | `Woodcut` | `woodcutting` | 1 | `axe` tier 0 | `10000ms` | `softwood ×1` | 10 | `120000ms` |
| `surface_stone` | `Mine` | `mining` | 1 | `pickaxe` tier 0 | `12000ms` | `stone ×1` | 12 | `120000ms` |
| `shallow_copper_deposit` | `Mine` | `mining` | 5 | `pickaxe` tier 0 | `18000ms` | `copper_ore ×1` | 23 | `240000ms` |

一次行动耗尽一个节点。行动速度和额外来源不改变固定 XP；阶段 2B 不增加额外产量。

稳定显示名：软木树、地表石、浅层铜矿、软木、石料、铜矿石、伐木、采矿、破旧斧、破旧镐。

## 状态与执行契约

### 资源定义与任务

阶段 2B 将阶段 2A 的单 prototype 常量改为穷尽资源定义表。`TaskIntent` 仍是显式 union：

```ts
type ResourceTask = GatherTask | WoodcutTask | MineTask;
```

每个变体保存 task identity、目标 prototype、finite/continuous quantity、completed quantity 和 created world time。runtime validator 必须验证 task kind、prototype、skill 和 tool 的合法映射；不能让 `Woodcut` 指向矿石，或让 `Mine` 指向纤维。

三个任务变体走同一个资源执行 transition：prerequisite → known active candidates → route cost → movement → action → settlement → re-acquire/auto-explore/wait/complete。

### 等级与工具门禁

评估顺序固定为：

1. task kind 与 prototype 映射；
2. target 已知；
3. 永久基础技能等级；
4. 已装备工具 type/tier；
5. active、可达目标；
6. frontier；
7. action。

等级不足时不创建任务。缺少工具时允许创建任务并进入 `Waiting: MissingTool`；任务计数保留，角色不移动、不自动探索。装备恢复后立即重新评估，不靠轮询。

### 装备状态

新世界起始装备：

```text
equipment.axe = worn_axe
equipment.pickaxe = worn_pickaxe
```

已装备物品不再同时保留在 inventory。卸下将物品 `+1` 放回 inventory；装备从 inventory `-1`。swap、no-op 和 quantity overflow 使用一个原子事务。

阶段 2B 只暴露 `EquipItem` 与 `UnequipSlot` 所需 command。更换装备物化当前精确位置，取消 route 和未完成 non-combat action，并重新评估唯一任务。取消周期不产出、不发 XP、不改变节点。

## 内容放置

- 延续绝对 `32×32 tiles` content cell、Euclidean 负坐标和 prototype-domain hash。
- 每个已发布 prototype 每 cell 最多一个 ambient candidate；不合格 candidate 不重抽。
- 同 tile 冲突按 Decision-0005 固定 prototype 顺序处理；guarantee 优先 ambient。
- observation 后才写入 WorldKnowledge、UI 和候选集；迷雾后的确定性 candidate 不能提前读取。
- 已知但不可达节点保留知识并排除于候选。

新世界 revision `1` 前验证：

1. 既有三个 `wild_fiber` guarantee 的 ID 与角色保持不变；`CONTENT_VERSION = 3` 可以改变具体 tile。
2. initial observation 内各一个软木树和地表石。
3. `6–20 tiles` 各一个额外软木树和地表石。
4. `64–96 tiles` 至少一个浅层铜矿，位于起始 chunk 外和营地 `3×3 chunks` 内。
5. 全部 guarantee 使用 distinct ID/tile、Land interaction point，并由既有 planner 证明从营地可达。

手动 seed 无法满足保证时，在存档创建前返回稳定 placement 错误，不替换 seed，不提交部分世界。

## 行动、结算与唤醒

权威 duration 使用 Decision-0005 的整数 skill + tool basis-point 公式。Worker read model 提供 base duration、skill bps、tool bps、total bps、duration 和 remaining；UI 不重算。

resource completion 在验证全部安全整数后同时更新：

- placement depletion、spawn cycle、depleted/respawn time；
-对应 material quantity；
- 对应 skill total XP；
- resource task completed quantity；
- event ordinal、revision、dirty generation 和 read model。

成功 settlement 立即用既有四-store transaction 提交 core、dirty world chunks 和 meta。任一字段溢出时整体拒绝并暂停 simulation。

节点耗尽后重新索取；没有已知 active 目标且有 frontier 时自动探索，不原地等待单个节点。节点重生、装备变化、技能升级或 target discovery 都是明确唤醒事件。

## 版本

| 版本 | 阶段 2A | 阶段 2B 基线 | 理由 |
|---|---:|---:|---|
| `DB_SCHEMA_VERSION` | 1 | 1 | 四个 store、keyPath 和 index 不变 |
| `SAVE_SCHEMA_VERSION` | 2 | 3 | 增加技能、材料、equipment、task/action 和多 prototype 状态 |
| `GAME_RULES_VERSION` | 2 | 3 | 增加任务映射、工具门禁、装备操作和多资源速度来源 |
| `CONTENT_VERSION` | 2 | 3 | 增加三个 prototype、两个 item/skill 组、工具定义和 guarantee |
| `GENERATOR_VERSION` | 3 | 3 | terrain bytes 不变 |

阶段 2B 不迁移阶段 2A save。版本不匹配时保留原始导出与确认重置；删除所有旧 schema 分支和 fallback。

offline report 将阶段 2A 的单资源增量字段替换为已发布 item/skill 增量列表，避免每新增一种物品都扩展顶层字段。该替换不保留旧 read-model 兼容字段。

## 产品 UI

- Task：只显示已知 target；明确区分采集、伐木、采矿；有限数量和持续任务继续替换唯一 intent。
- locked target：显示永久等级要求，不能提交；不得隐藏已经发现的浅层铜矿。
- MissingTool：提交前警告，提交后在 task 和 bottom activity 同时显示所需 slot/tier。
- Skills：显示探索、采集、伐木、采矿实际条目；不显示生产或战斗技能。
- Inventory：按 material/equipment 分组，只显示实际持有数量；不显示容量。
- Equipment：只显示 axe/pickaxe 及 equip/unequip；不显示其他空槽。
- Map：已知资源使用可区分的 prototype/state 标记；迷雾后资源不显示。
- Offline report：显示本次 item gains 和 skill XP gains，不显示未发生的空类别。

## 实施顺序

1. 将 `content.ts` 重构为严格资源定义表，但保持现有 `wild_fiber` 行为不变。
2. 先打通 `softwood_tree + Woodcut + worn_axe` 的端到端闭环。
3. 在同一执行器加入 `surface_stone + Mine + worn_pickaxe`。
4. 加入 mining level gate 与起始 chunk 外 `shallow_copper_deposit`。
5. 接入 equipment commands、存档、offline/reload 和产品 UI。
6. 更新 runtime contract、current-state 和验证记录。

每一步都必须保持产品可运行；不得先建立空的生产、战斗或完整装备框架。

## 缩减发布门槛

只保留能证明阶段 2B 可玩的证据：

1. TypeScript strict 与 production build。
2. 固定 placement fixture：初始木/石、环内冗余、边界铜矿、负坐标和冲突顺序。
3. 固定 settlement fixture：木、石、铜的 duration、item、XP、task count 和 depletion。
4. 一条真实产品 E2E：创建世界 → 设置 `Woodcut ×2` → 第一周期结算 → 第二周期完成前卸下斧并确认周期取消 → `MissingTool` → 重新装备并完成任务 → 设置 `Mine ×1` 并结算地表石 → reload 不重复结算。
5. 一个 level-5 engine fixture 证明边界铜矿可索取并结算 `copper_ore`。
6. 既有阶段 1/2A gameplay、存档、离线和渲染主路径回归。

不扩展完整配额、崩溃时点、字段分类、长时间重生或全 prototype 浏览器矩阵。非阻断边角项记录为技术债。

## 完成定义

用户无需 Debug 工具即可完成伐木、地表石采矿、工具缺失/恢复和 reload；达到 mining 5 后可以发现并开采边界浅层铜矿。代码、runtime contract、current-state 与产品 UI 对同一能力范围一致，且不显示排除系统。

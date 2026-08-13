# Decision-0005：阶段 2B 保留显式任务类别并共享资源执行器

- 状态：Accepted
- 日期：2026-08-11
- 决策者：项目负责人
- Supersedes：无
- Superseded by：无

## 背景

阶段 2A 已实现 `Gather`、确定性资源放置、目标索取、行动结算、库存、技能经验和在线/离线/reload 共用事件语义。阶段 2B 需要加入软木树、地表石、浅层铜矿、伐木、采矿、斧、镐和缺少工具等待。

产品要求玩家明确选择任务类别和目标。实现同时需要避免为每项生活技能复制 placement、navigation、action、respawn、settlement 和 persistence 状态机。

## 决策

保留显式 `Gather`、`Woodcut` 和 `Mine` `TaskIntent` 变体。三个变体共享一个由版本化资源定义表驱动的资源执行器。

资源定义表负责声明：

- prototype、item、skill 和 task category；
- required level、required tool type 和 minimum tool tier；
- base duration、固定产出、固定 XP 和 respawn duration；
- placement domain、显示信息和地图样式。

共享执行器负责：

- 已知目标筛选、权威路径成本排序和自动探索；
- 到达 interaction point 后启动权威 action；
- depletion、respawn 和 spawn cycle；
- item、skill XP、task count 和 placement 的原子结算；
- online、offline 和 reload 的同一事件推进。

阶段 2B 只实现 `axe` 和 `pickaxe` 两个装备槽，以及 `worn_axe`、`worn_pickaxe` 两件起始工具。新世界创建时两件工具已装备。玩家可以卸下和重新装备；系统不自动装备库存中的工具。

`weapon`、`body`、`accessory`、强化工具和装备比较不进入阶段 2B。它们在实际内容进入对应阶段时再实现。

## 方案比较

### 方案 A：为伐木和采矿复制阶段 2A 代码

- 原理：分别增加 placement、planning、action 和 settlement 分支。
- 适用条件：资源类型永远很少，且规则不会继续扩展。
- 优势：单个分支局部直观，短期修改范围较小。
- 风险与成本：目标索取、离线推进和原子结算会形成三套近似状态机。修复一个分支时容易遗漏其他分支，阶段 2C 和战斗中断会进一步放大差异。

### 方案 B：把任务合并为通用 `ResourceTask`

- 原理：任务只保存 prototype，由 prototype 反推出技能和类别。
- 适用条件：产品不需要区分采集、伐木和采矿意图。
- 优势：运行时 union 最小，执行器容易统一。
- 风险与成本：玩家确认的任务类别会退化为 UI 推断值。日志、等待原因、技能展示和未来类别规则难以保持显式，违背已确认的任务控制边界。

### 方案 C：显式任务变体 + 共享资源执行器

- 原理：`TaskIntent` 保留产品类别，资源定义表承载差异，执行器承载共同 transition。
- 适用条件：类别语义需要稳定，同时多种资源共享大部分运行时行为。
- 优势：玩家意图清楚；不会复制状态机；内容扩展只增加真实定义和必要 union 成员；阶段 2C 可直接复用库存、装备和速度来源。
- 风险与成本：需要把阶段 2A 的单一 prototype 常量重构为严格内容表。资源定义与 task/prototype 映射必须有穷尽检查。

推荐方案 C。它在不隐藏产品类别的前提下，把共同复杂度集中到一个已经工作的执行路径。

## 内容与放置边界

阶段 2B 沿用绝对 `32×32 tiles` content cell。每个已发布 prototype 在每个 cell 最多产生一个 ambient candidate。候选身份和 tile offset继续只取决于 seed、`CONTENT_VERSION`、prototype ID、营地 anchor 和绝对 cell 坐标。

同一 tile 的内容冲突按固定 prototype 顺序处理：

```text
wild_fiber
softwood_tree
surface_stone
shallow_copper_deposit
```

顺序靠前的 candidate 保留，后续 candidate 丢弃；不得在 cell 内重抽。guarantee placement 优先于 ambient，并使用全局 occupied tile set 去重。

新世界提交前增加以下保证：

- 初始 observation 内各有一个 `softwood_tree` 和 `surface_stone`；
- 营地 `6–20 tiles` 保证环内各有一个额外软木树和地表石；
- 营地 `64–96 tiles` 边界圈内至少有一个 `shallow_copper_deposit`，位于起始 chunk 外、营地周围 `3×3 chunks` 内，并可从营地到达。

既有三个野生纤维保证节点继续存在。普通 ambient 节点仍只做局部 Land 与站立校验；只有 guarantee 节点在创建世界时做从营地可达验证。

guarantee slot 使用以下固定顺序枚举和占位：

```text
wild_fiber / initial-observation
softwood_tree / initial-observation
surface_stone / initial-observation
wild_fiber / ring-a
wild_fiber / ring-b
softwood_tree / ring-a
surface_stone / ring-a
shallow_copper_deposit / boundary-a
```

稳定 placement ID 由 prototype 与 slot ID 组成。改变数组或 UI 排序不得改变占位结果。

## 工具与任务门禁

- `worn_axe` 固定为 `axe` tier `0`、伐木速度 `0 bps`、永久要求 `woodcutting 1`。
- `worn_pickaxe` 固定为 `pickaxe` tier `0`、采矿速度 `0 bps`、永久要求 `mining 1`。
- 软木树要求已装备 `axe` tier `0`；地表石和浅层铜矿要求已装备 `pickaxe` tier `0`。
- 缺少工具不拒绝 `SetTask`。任务保留并进入 `MissingTool` 等待；UI 在提交前警告并显示缺少的 slot/tier。
- 系统只读取已装备槽位，不扫描库存，不自动装备。
- 已知但永久技能等级不足的 target 可以显示锁定要求，但不能提交。Worker 使用 `command/skill_level_too_low` 拒绝绕过 UI 的 command。
- 装备或卸下工具在一个事务中更新 inventory、equipment、execution 和 meta。装备变化取消当前 route 和未完成 non-combat action，从当前精确位置重新评估唯一任务；已结算进度不回滚。

## 速度公式

阶段 2B 沿用阶段 2A 的整数 basis-point 公式，并加入实际存在的工具来源：

```text
skill_speed_bps = min(max(skill_level - required_level, 0) * 50, 2500)
total_speed_bps = skill_speed_bps + equipped_tool_speed_bps
duration_ms = max(
  ceil(base_duration_ms * 10000 / (10000 + total_speed_bps)),
  ceil(base_duration_ms * 2500 / 10000)
)
```

阶段 2B 的两件 worn tool 速度均为 `0 bps`。公式仍需实现工具来源，以封闭装备边界；不得预建 accessory 或 active effect 状态。

## 后果

### 正面

- 用户仍明确决定采集、伐木或采矿类别。
- 新资源复用已经验证的移动、自动探索、事件与结算语义。
- 缺少工具、取消行动和重载具有单一权威路径。
- 阶段 2C 可以在真实 inventory/equipment 边界上加入生产工具升级。

### 负面

- 阶段 2A 的单一资源实现需要一次直接重构。
- 新世界内容保证需要读取更远的边界圈 terrain，创建成本会上升。
- 阶段 2A 存档不再兼容；MVP 直接升级版本并拒绝旧存档。

## 验证

- 固定 seed 锁定全部 guarantee IDs、tiles、可达性、负 content cell 和 ambient 冲突顺序。
- 一条真实产品 E2E 覆盖伐木、采矿、缺少工具等待、重新装备、原子结算和 reload。
- 固定 engine fixture 覆盖 `mining 5` 的浅层铜矿、起始 chunk 外放置和 `18000ms` 结算。
- 同一初始状态与 credited duration 的 online/offline 结果一致。

## 后续行动

- 阶段 2B 专项实现任务按[阶段 2B 实施包](../engineering/phase-2b-woodcutting-mining-vertical-slice.md)实现本决策列出的资源、技能、工具和 UI。
- 不预建生产或战斗；阶段 2B 验收后再起草阶段 2C 实施包。

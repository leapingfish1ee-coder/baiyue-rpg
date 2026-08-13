# 阶段 2C：手工工艺与工具升级垂直切片

- 状态：Implemented
- 起草日期：2026-08-13
- 决策者：项目负责人
- 前置实现：[阶段 2B 当前状态](../product/current-state.md)
- Accepted 决策：[Decision-0006](../decisions/0006-crafting-tool-upgrade-slice.md)

> 本文只定义阶段 2C 增量。实现必须复用现有 gameplay worker、事件引擎、四-store 存档、库存和装备事务，不建立第二套生产时钟或任务状态机。

## 目标

交付第一个具有实际收益的生产闭环：

```text
玩家采集纤维、软木和石料
→ 明确选择一个已知工艺配方及数量
→ 缺料时原地等待并显示完整缺口
→ 材料恢复后在当前位置自动继续
→ 周期完成时原子消耗、产出、发放 XP 和增加任务计数
→ 玩家制作并装备强化斧或强化镐
→ 对应伐木或采矿行动使用更短的权威持续时间
→ online、offline、reload 保持同一结算结果
```

## 范围

### 包含

- `crafting` 技能，初始等级 1、总 XP 0；
- `Produce` `TaskIntent`，目标是一个稳定 `recipe_id`；
- `rope`、`reinforced_axe`、`reinforced_pickaxe` 三个 handcraft 配方；
- `rope` material 和两件 equipment item；
- finite quantity 与未填数量的 continuous production；
- `MaterialsMissing`、库存事件唤醒和完整材料缺口；
- 生产周期、任务替换、取消和装备变更语义；
- 强化工具的装备等级门禁、原子 swap 和 `+1000 bps` 对应行动速度；
- 生产任务、Crafting 技能、配方、材料、装备和活动状态的产品 UI；
- online、offline、reload 和立即 settlement commit。

### 明确排除

- Smithing、铜锭、`copper_blade`、工作站和工作站目标索取；
- `hunter_coat`、`trail_charm`、`weapon`、`body`、`accessory`；
- 配方解锁、配方物品、随机失败、品质、批量加速、队列和自动补料；
- 敌人、潜行、战斗、死亡、掉落和叙事；
- 旧存档迁移、兼容字段、旧版本 fallback 或双读写。

## 稳定内容表

| recipe ID | skill | required level | inputs | base duration | output | XP | station |
|---|---|---:|---|---:|---|---:|---|
| `rope` | `crafting` | 1 | `fiber ×2` | `12000ms` | `rope ×1` | 12 | 无 |
| `reinforced_axe` | `crafting` | 2 | `softwood ×4 + rope ×2 + stone ×2` | `30000ms` | `reinforced_axe ×1` | 30 | 无 |
| `reinforced_pickaxe` | `crafting` | 2 | `softwood ×4 + rope ×2 + stone ×3` | `30000ms` | `reinforced_pickaxe ×1` | 30 | 无 |

稳定显示名：工艺、生产、绳索、强化斧、强化镐。

全部配方在新世界中已知。UI 显示等级不足的已知配方及要求，但禁用提交。Worker 必须拒绝绕过 UI 的低等级命令。阶段 2C 不持久化空的 recipe unlock 集合。

## 状态与命令契约

`TaskIntent` 增加显式生产分支：

```ts
type ProduceTask = {
  kind: "Produce";
  recipeId: "rope" | "reinforced_axe" | "reinforced_pickaxe";
  requestedQuantity: number | null;
  completedQuantity: number;
  createdWorldTimeMs: number;
};
```

runtime validator 验证 task kind、recipe、skill 和 quantity 的完整组合。生产任务仍是唯一活动任务；`SetTask` 立即替换旧任务，`CancelTask` 立即清除。

`ExecutionState` 复用现有 non-combat action 表示，并增加生产 action identity、recipe、开始时间、结束时间和 remaining duration。生产不创建 route、placement 或 target identity，也不读取 terrain。

生产评估顺序固定为：

1. 验证 recipe 与永久 Crafting 等级；
2. 验证安全整数和 finite quantity；
3. 检查完整 inputs；
4. 缺料时进入 `Waiting: MaterialsMissing`；
5. 材料足够时在当前位置开始一个完整周期；
6. 到期时重新检查 inputs 并执行原子 settlement；
7. 完成 finite quantity 后待机，否则从第 3 步重新评估。

`MaterialsMissing` 保存或派生全部 `{ itemId, required, available, missing }`。它只因库存变化事件、任务替换、加载或离线 claim 重新评估，不使用定时轮询。

## 生产结算

周期完成时，一个权威 transition 必须同时：

- 再次验证全部 inputs；
- 扣除全部 inputs；
- 增加完整 output；
- 增加 Crafting total XP；
- 按实际 output quantity 增加任务完成数量；
- 更新 event ordinal、revision、dirty generation 和 read model。

三个配方均产出 `×1`，因此一个完成周期增加一个任务数量。任一数量会溢出时整体拒绝并暂停 simulation；不得部分扣料或部分产出。

成功 settlement 立即使用既有四-store transaction 提交。取消、替换任务、装备变化、reset 或版本拒绝会丢弃未完成生产 action；被丢弃周期不改变 inventory、XP 或 task count。

## 工具升级

| item ID | slot | tier | permanent requirement | speed source |
|---|---|---:|---|---:|
| `reinforced_axe` | `axe` | 1 | `woodcutting 2` | woodcutting `+1000 bps` |
| `reinforced_pickaxe` | `pickaxe` | 1 | `mining 2` | mining `+1000 bps` |

两件物品复用现有 equip/unequip command 和原子 swap。装备等级读取永久基础等级，不读取装备或效果加成。等级不足时库存和原槽位不变，并返回稳定错误。

阶段 2B 的资源 duration 公式不变。装备强化工具后，required-level 等级 1 的基础行动在技能等级 2 时总速度为 `1050 bps`：`50 bps` 来自技能，`1000 bps` 来自工具。Worker read model 分别报告来源；UI 不重算。

## 速度与离线推进

Crafting duration 使用 Decision-0006 的整数公式。阶段 2C 不增加生产工具、accessory 或 effect 来源。

offline claim 继续调用相同事件推进器。生产可能在预算内完成多个周期，也可能在首次材料不足时稳定停止并把剩余 credited duration 记为待机。离线报告只显示实际 item deltas 和 Crafting XP，不增加按 recipe 展开的固定字段。

## 版本

| 版本 | 阶段 2B | 阶段 2C 基线 | 理由 |
|---|---:|---:|---|
| `DB_SCHEMA_VERSION` | 1 | 1 | store、keyPath 和 index 不变 |
| `SAVE_SCHEMA_VERSION` | 3 | 4 | 增加 Crafting、recipe task/action 和生产等待状态 |
| `GAME_RULES_VERSION` | 3 | 4 | 增加生产评估、原子结算和强化工具速度 |
| `CONTENT_VERSION` | 3 | 4 | 增加三个配方和三个 item 定义 |
| `GENERATOR_VERSION` | 3 | 3 | terrain bytes 与 placement 不变 |

版本不匹配时保留原始导出与确认重置入口。删除阶段 2B schema 分支，不迁移旧存档，不保留旧 read-model 字段。

## 产品 UI

- Task：增加“生产”类别。选择一个已知配方，再选择有限数量或持续执行。
- Recipe：显示 inputs、output、等级、基础时间、权威实际时间、固定 XP 和 handcraft；等级不足时显示锁定要求。
- Waiting：同时列出全部材料缺口，不显示自动补料按钮。
- Skills：增加 Crafting 实际条目；不显示 Smithing 或战斗技能。
- Inventory：显示 `rope` 和持有的强化工具；保留 material/equipment 分组。
- Equipment：仍只显示 axe/pickaxe。强化工具候选显示精确 tier、速度和永久等级要求。
- Activity：区分正在生产、缺料等待、任务完成和取消；不伪造工作站位置。
- Offline report：沿用 item/skill delta 列表，显示生产的消耗、产出净变化和 Crafting XP。

## 实施顺序

1. 增加严格 recipe/item 定义和 `crafting` skill，不改变既有资源执行。
2. 在同一 `TaskIntent`、event engine 和 persistence schema 中加入 `Produce` 与 handcraft action。
3. 先打通 `rope` 的缺料等待、材料唤醒、原子结算和 reload。
4. 加入两个强化工具配方、装备门禁和真实资源 duration 收益。
5. 接入 offline claim、报告和产品 UI。
6. 更新 runtime contract、current-state、路线图和验证记录。

每一步保持产品可启动。不得先建立 station、Smithing、战斗装备或通用配方 DSL。

## 缩减发布门槛

只保留能证明本切片可玩的证据：

1. TypeScript strict 与 production build。
2. recipe/validator fixture：三组稳定 inputs、outputs、level、duration、XP 和非法组合拒绝。
3. engine fixture：缺料等待、库存唤醒、原子结算、取消、finite/continuous 和 offline/reload。
4. tool fixture：制作两件强化工具，验证等级门禁、原子 swap 和资源 duration 的 `+1000 bps` 来源。
5. 一条真实产品 E2E：新世界设置 `rope ×1` → `MaterialsMissing` → 取得两份纤维 → 恢复生产并结算 → reload 后 `rope ×1`、Crafting XP 12 且不重复结算。
6. 既有阶段 1/2A/2B gameplay、存档、离线和渲染主路径回归。

不增加工作站、锻造、全配方浏览器矩阵、长时间生产、全事务崩溃点或旧存档兼容测试。非阻断边角项记录为技术债。

## 完成定义

玩家无需 Debug 工具即可选择生产任务、理解缺料、制作绳索和强化工具、装备满足等级要求的强化工具，并观察对应伐木或采矿实际时间下降。代码、runtime contract、current-state、路线图和产品 UI 对同一能力范围一致，且不显示排除系统。

实现边界见[阶段 2C 运行时契约](../specifications/phase-2c-runtime-contracts.md)，实际检查与环境限制见[阶段 2C 验证记录](phase-2c-validation-record.md)。

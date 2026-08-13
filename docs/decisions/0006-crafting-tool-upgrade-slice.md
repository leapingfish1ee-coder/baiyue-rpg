# Decision-0006：阶段 2C 只交付手工工艺与工具升级闭环

- 状态：Accepted
- 日期：2026-08-13
- 决策者：项目负责人
- Supersedes：无
- Superseded by：无

## 背景

阶段 2B 已实现纤维、软木、石料和铜矿石的获取，斧与镐装备边界，以及采集、伐木和采矿的持续任务。阶段 2C 需要让已有材料产生实际用途，并验证生产任务的缺料等待、原子结算和可逆装备收益。

完整生产设计还包含工作站、锻造、铜刃、身体防具和饰品。当前尚无战斗、敌人或兽皮来源。此时一次实现全部生产内容，会产生没有用途或无法获得材料的产品，并迫使本阶段提前建立工作站索取和战斗装备边界。

## 决策

阶段 2C 只实现 `Crafting` 技能、`Produce` 任务和三个 handcraft 配方：

| recipe ID | level | inputs | duration | output | XP |
|---|---:|---|---:|---|---:|
| `rope` | Crafting 1 | `fiber ×2` | `12000ms` | `rope ×1` | 12 |
| `reinforced_axe` | Crafting 2 | `softwood ×4 + rope ×2 + stone ×2` | `30000ms` | `reinforced_axe ×1` | 30 |
| `reinforced_pickaxe` | Crafting 2 | `softwood ×4 + rope ×2 + stone ×3` | `30000ms` | `reinforced_pickaxe ×1` | 30 |

三个配方从新世界创建时均为已知。等级不足的配方显示要求但不能提交；本阶段不建立配方掉落、学习或解锁系统。

生产在当前位置执行，不索取目标或工作站。每个周期完成时，在同一权威结算中重新验证并扣除全部材料，增加完整产物，发放固定 XP，并增加任务完成数量。取消、替换任务或更换装备会取消未完成周期；未完成周期不消耗材料、不产出、不发放 XP。

材料不足时保留任务和已完成数量，进入 `MaterialsMissing`。系统显示全部缺口，只在库存变化事件后重新评估，不自动采集、不自动换任务、不轮询。

阶段 2C 增加两件可装备工具：

- `reinforced_axe`：`axe` tier 1，伐木速度 `+1000 bps`，永久要求 Woodcutting 2；
- `reinforced_pickaxe`：`pickaxe` tier 1，采矿速度 `+1000 bps`，永久要求 Mining 2。

强化工具复用阶段 2B 已实现的 `axe`、`pickaxe` 槽位和装备事务。工具只影响未来对应资源行动的持续时间，不改变产量、XP、资源准入或重生。

工作站、Smithing、铜锭、`copper_blade`、`hunter_coat`、`trail_charm`、`weapon`、`body` 和 `accessory` 不进入阶段 2C。工作站与锻造在战斗武器能够产生实际用途时作为独立纵向切片实现；兽皮装备在敌人和掉落存在后实现。

## 方案比较

### 方案 A：一次实现完整生产与五个装备槽

- 原理：同时加入 Crafting、Smithing、handcraft、工作站、全部首批配方和五槽装备。
- 适用条件：敌人、兽皮、战斗属性和工作站内容已经可用。
- 优势：设计表面上一次完整，后续无需再次扩展生产 UI。
- 风险与成本：当前三类产品没有材料来源或玩法用途；工作站索取、武器、防具和战斗属性扩大状态空间，延迟可玩闭环。失败时难以判断问题来自生产、导航还是战斗前置。

### 方案 B：只实现绳索

- 原理：用一个 handcraft 配方验证材料消耗、产出和 Crafting XP。
- 适用条件：目标仅是验证最小生产事务。
- 优势：代码和验证范围最小。
- 风险与成本：绳索在当前版本没有消费端。玩家投入材料后只得到中间物，不能感知生产带来的能力变化，阶段仍停留在技术演示。

### 方案 C：手工工艺与工具升级

- 原理：先用绳索建立中间材料，再制作并装备强化斧、强化镐，使生产结果直接提高现有生活技能效率。
- 适用条件：采集、伐木、采矿、库存和工具槽已经稳定，战斗尚未进入实现。
- 优势：形成“收集材料 → 制作 → 装备 → 行动提速”的端到端收益闭环；复用现有模块；不引入无用途内容；后续工作站生产仍可按同一 `Produce` 语义扩展。
- 风险与成本：本阶段只证明 handcraft，尚未证明工作站索取；锻造要在后续独立切片补齐。

采用方案 C。它是当前约束下最小但完整的生产闭环。

## 生产速度

Crafting 使用与资源行动相同的整数 basis-point 换算，但本阶段只有技能来源：

```text
skill_speed_bps = min(max(skill_level - required_level, 0) * 50, 2500)
duration_ms = max(
  ceil(base_duration_ms * 10000 / (10000 + skill_speed_bps)),
  ceil(base_duration_ms * 2500 / 10000)
)
```

配方的固定 XP 不随实际持续时间变化。UI 读取 Worker 给出的权威 duration 和来源，不自行计算。

## 版本与兼容性

阶段 2C 直接升级 save、game rules 和 content version。MVP 不迁移阶段 2B 存档，不保留旧 recipe、task、item 或 read-model 分支。terrain bytes 和 gameplay placement 不变，因此 `GENERATOR_VERSION` 保持不变。

## 验证

- 一个固定 engine fixture 覆盖 `MaterialsMissing`、库存事件唤醒、周期原子结算、取消不结算和 finite/continuous 数量。
- 一个固定 engine fixture 从预置合法状态制作两件强化工具，验证装备等级、原子 swap 和伐木/采矿持续时间各缩短约 `9.09%`。
- 一条真实产品 E2E 覆盖缺少纤维等待、取得材料、制作 `rope ×1`、Crafting XP 和 reload 不重复结算。
- 既有探索、资源、装备、offline、reload 和渲染主路径继续通过。

## 后续行动

- 阶段 2C 专项任务按[阶段 2C 实施包](../engineering/phase-2c-crafting-tool-upgrades.md)实现本决策。
- 基础战斗可用后，再封板工作站锻造与武器升级切片；不得在阶段 2C 预建空接口。

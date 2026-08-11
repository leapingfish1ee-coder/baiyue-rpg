# 物品与装备系统

- 状态：Accepted
- 决策者：项目负责人
- 确认日期：2026-08-09
- 适用范围：首个端到端可玩切片

> 本文已封板。定义型物品、库存数量、装备槽、装备操作、掉落表、首轮物品内容和 UI 字段均为 Accepted 设计基线，不是已实现事实。本文数值属于“Accepted 首轮平衡基线”；设计验证记录不构成必胜保证。

## 关系与边界

本文为[首个可玩区域](first-playable-region.md)定义物品内容，为[战斗数值系统](combat-numerics.md)定义武器、防具和饰品来源。[碎片叙事与线索簿](narrative-cluebook.md)定义不进入库存的叙事知识。技能准入、任务结算、死亡保留和离线语义继续以[技能成长](skill-progression.md)、[自动任务](automation-tasks.md)、[战斗、潜行与死亡](combat-stealth.md)和[离线推进](offline-progression.md)为准。外部产品只提供研究依据，见[可比游戏研究](../research/comparable-games.md)。

## 路线与取舍

基线采用定义型物品。一个稳定 `item_id` 唯一决定物品名称、类别、要求、静态属性和内容来源。玩家状态只保存 `item_id` 与整数数量；装备槽只保存当前装备的 `item_id`。相同装备按同一 `item_id` 堆叠，不生成独立物品实例。

首版不采用以下状态：

- 随机词缀或品质 roll；
- 强化等级或插槽；
- 耐久、绑定或鉴定；
- 同名但属性不同的物品实例。

这些状态会给离线结算、生产、掉落和未来市场引入额外身份与兼容语义，但首版没有对应玩法需求。Milky Way Idle 的大量装备槽、enhancement 和 loadout 只说明后期可以表达多种构筑；IdleOn 的技能工具关系可作为工具槽参考；Melvor 的 bank slot 压力不适合当前持续任务。竞品模式不构成本项目规范。

## 物品类别

首版只有两类物品：

| 类别 | 用途 |
|---|---|
| `material` | 资源、敌人材料和生产中间材料 |
| `equipment` | 武器、防具、饰品和工具 |

首版不加入 `currency`、`consumable`、`container`、`quest item` 或 `recipe item`。叙事事实、推论和线索属于 [`WorldKnowledge`](../architecture/gameplay-state.md#worldknowledge) 与线索簿，不占库存；详细语义见[碎片叙事与线索簿](narrative-cluebook.md)。配方属于内容解锁，不是背包物品。

## 数量与库存

- 每个 `item_id` 保存一个非负安全整数数量。
- 数量上限为 JavaScript `Number.MAX_SAFE_INTEGER`。
- 每次加减都必须通过 `Number.isSafeInteger` 验证；不得保存浮点数、负数或发生静默溢出。
- 首版没有重量、格数、背包扩容、地面掉落或营地仓库。库存随角色全局携带。
- 资源产出、生产产物和战利品在有效结算时直接进入库存。
- 玩家死亡不丢失库存。
- 持续任务不因库存容量停止。

无容量库存是 Accepted 产品选择，不是“临时提供很大容量”的占位。首个切片关注时间投入和目标选择，不建立搬运或回城循环。

未来市场若进入范围，再决定交易库存边界。当前不预建市场接口。

任何结算若会使 quantity 超过 `Number.MAX_SAFE_INTEGER`，必须在事务开始前拒绝整个结算，暂停 gameplay simulation，并返回稳定错误 `integrity/quantity_overflow`。系统不得截断、wrap、丢弃 loot 或部分结算。该边界不是库存容量玩法；它是权威状态的完整性保护。

## 物品定义最小字段

每个内容定义至少包含：

- 稳定 `item_id`；
- 显示名称或 localization key；
- `category`；
- 可选 `equipment_slot`；
- 最多一项永久技能等级要求；
- 静态 modifier；
- 供 UI 使用的已知来源与用途；
- 堆叠数量语义。

同一 `item_id` 不得因来源不同而拥有不同属性。MVP/demo 阶段调整物品属性时，直接修改定义并删除旧规则，不保留旧物品实例。进入稳定经济前，再决定内容版本与市场兼容边界；当前不为其预留实例字段或兼容层。

## 装备槽

首版固定五个槽：

| 槽位 | 内容 |
|---|---|
| `weapon` | 近战武器 |
| `body` | 单件身体防具，可承载 HP、`armor`、`evasion` 等属性 |
| `accessory` | 生活技能或潜行等单一主要用途的可逆专精 |
| `axe` | 伐木工具 |
| `pickaxe` | 采矿工具 |

`采集` 首版不需要工具；`锻造` 使用世界工作站；`工艺` 通过徒手或工作界面执行。远程、魔法、盾牌以及头、手、腿、脚等槽位只在对应内容端到端成立后新增，首版不预留空 UI。

## 装备操作

- 角色只有在存活且非战斗状态下才能装备或卸下物品。
- 装备时从库存扣除 `1`，并把 `item_id` 写入对应槽位。
- 替换必须原子完成。系统先验证新物品、库存数量、槽位和永久技能要求，再把旧物品放回库存并扣除新物品。
- 任一验证失败时，库存和原槽位都不得变化。
- 卸下时把物品返回库存。
- 装备与当前槽位相同的 `item_id` 是 no-op。
- 系统不自动装备“最佳物品”，不随任务自动换装，也不提供 loadout 或 preset。

装备变更会在当前整数 world time 通过 `positionAt(t)` 物化 canonical `WorldPoint`，取消当前 route 和未完成的 non-combat action cycle，并重新评估唯一活动任务。已完成任务数量不回滚；被取消周期不产出、不消耗材料，也不发 XP。forced combat 只暂停 motion/action remaining state；若战斗期间没有任务、装备、目标或 prerequisites 变化，战斗后可以从精确交战位置继续。

如果活动任务缺少已装备的必要工具，系统保留任务，令 `ExecutionState` 进入 `等待条件`，并记录 `waiting_reason = MissingTool`。UI 必须指出缺少的工具类型或 tier。系统不得扫描库存后自动装备工具。

## 装备属性

### `weapon`

- `damage_min`；
- `damage_max`；
- `weapon_accuracy`；
- `base_attack_interval`；
- `required_melee_level`。

### `body`

- `flat_max_hp`；
- `armor`；
- `evasion`；
- 可选 `stealth`。

同一件首版身体防具不应同时强化全部防御维度。

### `accessory`

饰品只提供一个主要用途的 modifier 组，例如 `stealth` 或某项生活技能速度。首版不提供全局万能饰品。

### `axe` 与 `pickaxe`

- `tool_type`；
- `tool_tier`；
- 对应任务速度加成；
- 对应技能的永久等级要求。

首版工具不改变产量、XP、稀有掉落或资源等级要求，只改变对应行动时间。

生活行动总速度来源为：

```text
skill speed
+ equipped tool speed
+ equipped accessory speed
+ active effect speed
```

换算后的行动持续时间不得低于基础持续时间的 `25%`。各来源由加法汇总后如何换算为持续时间，仍以[技能成长中的待决叠加公式](skill-progression.md#资源与生产速度)为准；本文不新增未经确认的换算式。

## 行动与工具

- 每个资源行动声明 `required_tool_type` 和 `minimum_tool_tier`；不需要工具时两者为空。
- 工具检查只读取对应的已装备槽位，不扫描库存。
- 任务设置器允许提交缺少工具的任务，但必须先显示警告；提交后任务进入明确等待，不能静默失败。
- 任何装备变更都会取消当前未完成行动周期，不能在行动完成前临时换入工具获利。
- 装备属性只影响装备后的未来事件，不追溯修改已经结算的事件。

## 原子物品结算

### 资源行动

完成时一次性增加固定 primary output。首版没有 secondary drop。

### 生产

周期完成时，在同一事务中再次检查完整 inputs，扣除完整 inputs，增加完整 outputs，再发放 XP 和任务数量。任一步失败时，整个周期都不结算。

### 战斗

敌人死亡后，系统按稳定规则决定全部战利品并一次性加入库存，再结算任务数量与 XP。叙事发现按[线索簿规范](narrative-cluebook.md#首版发现触发器)单独写入 `WorldKnowledge` 与日志。

首版没有容量失败，因此战利品不会落地或丢失。所有物品变化都必须是整数、原子且可记录的结算事件。

## 掉落表

每种敌人可以声明：

- `guaranteed drops`：固定 `item_id`，数量为固定整数或整数闭区间；
- `independent drops`：每项独立声明 chance 和整数数量闭区间；同一次击杀可以获得多项。

首版不采用互斥权重池。只有未来内容确实需要“只能获得其中一项”时，才单独设计该语义。

每个 drop entry 使用独立、稳定的 entry ID，并将其作为 deterministic RNG purpose 的一部分。调整显示顺序不得改变掉落结果。叙事必得、首次发现和阶段解锁不得进入概率掉落表。

## 首个区域物品

本节与[首个可玩区域内容表](first-playable-region.md#物品与装备内容)共同构成 Accepted 首轮平衡基线。

### 起始装备

| `item_id` | 槽位 | 永久等级要求 | 属性 |
|---|---|---|---|
| `worn_blade` | `weapon` | `近战 1` | damage `4–6`；accuracy `+5`；interval `2.5s` |
| `worn_axe` | `axe` | `伐木 1` | tool tier `0`；speed `0%` |
| `worn_pickaxe` | `pickaxe` | `采矿 1` | tool tier `0`；speed `0%` |

### 生产装备

| `item_id` | 槽位 | 永久等级要求 | 属性或来源 |
|---|---|---|---|
| `reinforced_axe` | `axe` | `伐木 2` | tier `1`；伐木 speed `+10%`；`工艺 2` 配方 |
| `reinforced_pickaxe` | `pickaxe` | `采矿 2` | tier `1`；采矿 speed `+10%`；`工艺 2` 配方 |
| `copper_blade` | `weapon` | `近战 2` | damage `8–12`；accuracy `+10`；interval `2.4s`；`锻造 2` 配方 |
| `hunter_coat` | `body` | 无装备等级要求 | max HP `+10`；armor `+10`；`工艺 2` 配方 |
| `trail_charm` | `accessory` | 无装备等级要求 | stealth `+5`；`工艺 2` 配方 |

`copper_blade` 的 permanent melee requirement 固定为 `近战 2`。T1 的 Accepted 首轮 combat XP 为 `30`；按当前升级曲线，从等级 `1` 到 `2` 需要 `100 XP`，因此约 `4` 次 T1 击杀达到等级 `2`，并同时取得 `raw_hide ×4`。这形成近战准入与 `hunter_coat` 材料的首轮节奏闭环；相关数值均为 Accepted 首轮平衡基线，不是试玩事实。

首轮配方使用 `raw_hide` 和 `rope`；其他基础材料和中间材料的稳定 `item_id` 由内容专项在编码前补齐，不能从中文显示名自动推导。

### 普通狩猎与新增配方

- T1 狩猎目标 guaranteed drop：`raw_hide ×1`。
- `hunter_coat`：`工艺 2`；`raw_hide ×4 + rope ×2`；`45s`；`45 XP`；内容表须声明完整输出数量。
- `trail_charm`：`工艺 2`；`raw_hide ×2 + rope ×2`；`30s`；`30 XP`；内容表须声明完整输出数量。

这组内容用于验证“普通狩猎材料 → 工艺防具/潜行饰品”和“采矿 → 锻造武器”两条生产链。它是设计目的，不是已完成体验结论。

## 战斗平衡影响

- 状态：设计验证记录，不能单独证明平衡目标
- 采样次数：`100,000`
- 方法：用户提供的确定性伪随机蒙特卡洛结果
- 本次文档任务：未取得或运行模拟脚本、gameplay seed、数值精度与完整输入 fixture

等级 `1` 玩家装备 `copper_blade + hunter_coat`，即 `110 HP`、`10 armor`，对当前 T2 样例的结果为：胜率约 `95.05%`，胜利时平均剩余 HP `41.52`，平均战斗时间 `35.06s`。

同一验证记录中，只有 `copper_blade` 时胜率约为 `80.20%`。结果支持“铜刃显著改善胜率，猎人护衣进一步降低挑战风险”的方向，并让两条生产链共同服务边界挑战。该判断只适用于给定模拟输入，不构成必胜保证；Accepted 首轮数值仍需包含寻路恢复、敌人密度和重生的端到端验证。完整记录见[战斗数值系统](combat-numerics.md#设计验证记录首轮蒙特卡洛)。

## UI

### 库存

- 按 `material` 与 `equipment` 分组。
- 显示 item name、quantity、已知来源与已知用途。
- 不显示空格数、重量、品质、耐久或出售价格。

### 装备

- 显示五个槽及当前物品。
- 选择替换时显示精确属性差异和永久等级要求。
- 战斗中禁用装备操作，并说明原因。

### 任务设置器

- 显示所需 tool type/tier、当前装备、速度来源和缺失原因。
- 缺少工具时允许提交，但必须显示警告和后续等待语义。

### 物品 tooltip

显示固定属性、装备槽、等级要求、已知来源和已知用途。不得使用含糊的“战力”替代具体属性。

## 明确排除

- 容量、重量和仓库；
- 自动存取和地面掉落；
- 自动拾取策略；
- 货币、商店和出售；
- 绑定；
- 耐久和修理；
- 品质和随机词缀；
- 强化、升级槽和宝石；
- 套装奖励；
- 双持和盾牌；
- 多个饰品；
- 装备 preset、loadout 和自动换装；
- 消耗品和市场。

## 验收标准

- 相同 `item_id` 永远具有相同属性，并按整数数量堆叠。
- 玩家状态不存在物品实例的隐藏状态。
- equip swap 原子完成；验证失败不改变原装备或库存。
- 战斗中不能换装，死亡不丢失物品。
- 缺少已装备工具时保留任务，并显示明确的 `MissingTool` 等待原因。
- 库存中的工具不会被自动使用或自动装备。
- 资源、生产和击杀只在完成事件中原子修改库存。
- quantity overflow 在事务前拒绝整次结算并暂停模拟；不截断、不丢弃、不部分提交。
- 重排 drop entry 不改变确定性掉落结果。
- 叙事发现不进入物品随机表。
- 持续任务不会被容量系统中止。
- UI 能把每项物品数值变化追溯到具体装备来源。

## 实现、内容与验证工作

- 内容专项须补齐基础材料与中间材料的稳定 `item_id`、显示名称、localization key，以及全部配方的单周期完整输出数量。
- 技能与物品实现专项须在编码前把生活技能速度来源到行动持续时间的统一公式写入需求和 fixtures。
- 存档专项须写明物品定义、库存状态的 schema、持久化表示及游戏规则/内容版本边界。
- 验证专项须归档模拟脚本、gameplay seed、完整 fixtures，以及包含路径恢复的装备平衡验证。
- 市场仍明确排除首个切片；只有负责人未来把稳定经济或市场纳入新产品范围后，才设计交易库存边界。

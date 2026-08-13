# Decision-0007：阶段 3A 交付单一 T1 敌人的完整连续战斗闭环

- 状态：Accepted
- 日期：2026-08-13
- 决策者：项目负责人
- Supersedes：无
- Superseded by：无

## 背景

阶段 1 至 2C 已形成探索、资源任务、生产、装备、离线和 reload 的统一事件运行时。初版 MVP 尚未实现敌人、潜行、狩猎、生命、自然恢复、近战、击杀、死亡和复活。

战斗不是独立副本或临时任务模式。敌人必须存在于开放世界中，可以在角色执行其他任务时触发强制战斗；玩家也可以明确设置狩猎目标和数量。只实现一个脱离世界的战斗演示，不能证明这些产品规则。

## 决策

阶段 3A 只发布一个敌人 archetype：

| 字段 | 值 |
|---|---|
| archetype ID | `graymane_boar` |
| 显示名称 | 灰鬃野猪 |
| 区域 | 学习圈；营地 Chebyshev `0..20 tiles` 安全圈外 |
| detection radius | `2 tiles` |
| `max_hp` | 30 |
| `accuracy` / `evasion` / `armor` | 14 / 10 / 0 |
| `damage_min..damage_max` | 3..5 |
| `attack_interval` | `3000ms` |
| `perception` | 12 |
| 击杀经验 | Melee XP 30 |
| guaranteed drop | `loot:graymane_boar:raw_hide:guaranteed` → `raw_hide ×1` |
| 潜行成功经验 | Stealth XP 12 |
| 重生 | `180000ms` |

玩家在阶段 3A 固定装备 `worn_blade`，基础 `max_hp = 100`、`evasion = 10`、`armor = 0`，Melee 与 Stealth 均从等级 1、XP 0 开始。阶段 3A 显示 weapon 槽和武器属性，但不提供卸下、替换或自动换装；完整 weapon 装备操作在第二件武器实际进入内容时实现。

新世界在学习圈保证三个可达灰鬃野猪巢点。至少一个位于距营地 `21..28 tiles`，其余两个位于 `32..56 tiles`；全部位于安全圈外、互不重叠且不占用已有资源。ambient enemy 每个绝对 `32×32 tiles` content cell 最多生成一个候选；安全圈内候选丢弃，不重抽。

阶段 3A 完整实现：

- 已知敌人目标索取、有限或持续 `Hunt` 任务和自动探索；
- 非狩猎目标的一次性确定性发现判定和完整通过威胁区后的 Stealth XP；
- 当前狩猎目标跳过潜行并在进入 detection circle 时强制战斗；
- 一对一近战、独立攻击计时器、命中、伤害、持续 HP 恢复和跨战斗伤势；
- 击杀时原子结算 Melee XP、`raw_hide`、狩猎计数和敌人重生；
- 玩家死亡、`60s` 等待、精确死亡位置满 HP 复活、致死敌人满状态重置和 `5s RevivalGrace`；
- 战斗对 movement/non-combat action 的暂停、任务变更语义，以及 online/offline/reload 等价。

阶段 3A 不实现 T2、Smithing、铜锭、`copper_blade`、`hunter_coat`、`trail_charm`、身体/饰品槽操作、临时效果内容、远程、魔法、消耗品或叙事。

## 方案比较

### 方案 A：一次实现完整战斗与装备生产

- 原理：同时加入 T1、T2、潜行、近战、死亡、工作站锻造和全部战斗装备。
- 适用条件：基础战斗事件、敌人 placement、工作站生产和装备属性已经分别验证。
- 优势：可以一次呈现首个区域的完整战斗进度链。
- 风险与成本：战斗、生产、导航、装备和平衡同时变化。错误难以归因，首个可玩战斗会被 T2 和锻造前置拖延。

### 方案 B：仅实现主动战斗目标或木桩

- 原理：玩家点击一个固定目标后进入自动攻击，不实现世界侦测、潜行和死亡恢复。
- 适用条件：目标只是独立验证攻击公式。
- 优势：实现范围最小，战斗 trace 容易观察。
- 风险与成本：它把战斗变成独立模式，不能证明敌人会打断生活任务、潜行降低触发概率、伤势跨战斗累积或死亡只消耗时间。后续必须重写进入与退出边界。

### 方案 C：单一 T1 敌人的完整连续战斗闭环

- 原理：只发布一个敌人，但把开放世界遭遇、潜行、狩猎、战斗、恢复、击杀、死亡、重生和持久化完整贯通。
- 适用条件：现有任务、移动、内容 placement、事件引擎和存档已经稳定。
- 优势：形成真实可玩的最小战斗循环；每个新增状态都有当前用途；T2 和装备生产可以建立在已工作的战斗上。
- 风险与成本：即使只有一个敌人，事件优先级、确定性随机和暂停/恢复仍是较大的状态增量；需要严格控制验证范围。

采用方案 C。它减少内容宽度，但不削弱已经确认的战斗语义。

## 确定性数值

HP 使用 `1 HP = 1,000,000 micro-HP` 的无符号整数。整数伤害先换算为 micro-HP。自然恢复按世界时间累计：

```text
regen_numerator += elapsed_ms × max_hp_micro
healed_micro = floor(regen_numerator / 1,000,000)
regen_numerator %= 1,000,000
```

HP 达到上限时清零余数，不能预存恢复。死亡等待期间不推进恢复；复活设置满 HP 和零余数。

命中与发现公式中的 `x^1.4` 使用确定性整数近似，而不直接依赖平台浮点：

```text
POWER_SCALE = 1,000,000
pow_7_5_scaled(x) = floor_fifth_root(x^7 × POWER_SCALE^5)
chance_ppm = round_half_even(
  pow_7_5_scaled(a) × 1,000,000
  / (pow_7_5_scaled(a) + pow_7_5_scaled(b))
)
```

最终 probability clamp 为 `50000..950000 ppm`。固定 fixture 锁定本阶段全部实际属性组合。

玩法随机使用独立 `GAMEPLAY_RANDOM_VERSION = 1`、64-bit FNV-1a 输入哈希和 SplitMix64 finalizer。输入必须包含 seed、`encounter_instance_id`、combat event ordinal、用途标签和 rejection draw ordinal。`detect`、`hit`、`damage` 使用不同用途；整数区间和 ppm roll 使用 rejection sampling，不能以 modulo bias 或全局可变 RNG 代替。

## 后果

### 正面

- 玩家第一次获得可持续狩猎、近战成长和敌人材料。
- 敌人对探索与生活任务产生自然风险，Stealth 具有实际用途。
- HP、恢复和死亡成为同一世界时间上的持续状态，不引入恢复期或冷却期。
- 后续 T2、铜刃、防具和饰品可以建立在真实战斗结果上。

### 负面

- save、Worker protocol、read model 和 world chunk entity state 都需要直接升级。
- combat overlay 必须保存被暂停执行的剩余进度，并在任务或 prerequisites 改变时丢弃。
- 本阶段只有一个敌人，不能代表长期敌人多样性或最终平衡。

## 版本与兼容性

阶段 3A 使用 `GAMEPLAY_PROTOCOL_VERSION = 2`、`SAVE_SCHEMA_VERSION = 5`、`GAME_RULES_VERSION = 5` 和 `CONTENT_VERSION = 5`。`DB_SCHEMA_VERSION = 1`、资源 `CONTENT_PLACEMENT_VERSION = 3` 与 `GENERATOR_VERSION = 3` 不变；新增 `ENEMY_PLACEMENT_VERSION = 1`。

MVP 不迁移阶段 2C 存档，不保留 protocol v1、旧 read model、旧 save 或旧 content fallback。

## 验证

- 固定 placement fixture 锁定三个保证巢点、安全圈排除、ambient 负 cell 和资源冲突顺序。
- 固定 combat trace 锁定命中阈值、伤害、同刻玩家优先、击杀结算和 reload。
- 固定 encounter fixture 覆盖非目标发现成功/失败、完整通过后 Stealth XP、狩猎目标跳过潜行和同 instance 不重复判定。
- 固定 death fixture 覆盖 `60s`、精确位置、满 HP、敌人重置、任务保留和 `5s RevivalGrace`。
- online/offline fixture 从同一初始状态得到相同 HP、攻击 trace、击杀、掉落、任务计数和 world entity state。
- 一条真实产品 E2E 覆盖发现灰鬃野猪、`Hunt ×1`、强制战斗、`raw_hide ×1`、Melee XP 30、任务完成和 reload 不重复结算。

## 后续行动

- 阶段 3A 专项任务按[阶段 3A 实施包](../engineering/phase-3a-t1-hunting-combat.md)实现本决策。
- 阶段 3A 验收后，再依据真实战斗结果封板 T2 与工作站锻造/战斗装备；不得提前加入兼容层或空系统。

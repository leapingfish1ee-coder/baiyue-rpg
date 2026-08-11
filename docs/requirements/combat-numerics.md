# 战斗数值系统

- 状态：Accepted
- 决策者：项目负责人
- 确认日期：2026-08-09
- 适用范围：首个端到端可玩切片

> 本文已封板。属性、公式、事件顺序和数值是首个切片的 Accepted 设计基线；其中数值属于“Accepted 首轮平衡基线”，不是已实现事实，可通过显式、版本化的平衡决策调整。设计验证记录只提供证据，不构成必胜保证。

## 关系与边界

本文为已确认的[战斗、潜行与死亡](combat-stealth.md)补充数值模型，并为[首个可玩区域](first-playable-region.md)提供 `worn_blade`、`copper_blade`、T1 和 T2 的首轮平衡样例。武器、防具、饰品、装备槽和掉落表定义见[物品与装备系统](item-equipment.md)。经验结算继续遵守[技能成长](skill-progression.md)，在线与离线继续遵守[离线推进](offline-progression.md)。外部参考事实见[可比游戏研究](../research/comparable-games.md)。

## 路线与取舍

基线采用“独立攻击计时器 + 命中/闪避 + 护甲减伤 + 持续自然恢复”的最小自动战斗模型。

### 不采用纯固定 DPS

固定 DPS 无法表达武器精度、闪避、独立攻击间隔和装备差异，也不能生成离散的命中、伤害与死亡事件。

### 不采用多战斗技能拆分

不采用 RuneScape 式 `Attack`、`Strength`、`Defence`、`Hitpoints` 多技能。首版只保留已确认的 `近战` 技能，避免技能表膨胀和通过承伤刷级。

### 不采用完整技能循环

首版不加入主动技能、暴击、格挡、元素、抗性、姿态、仇恨、自动消耗品或群战。本基线只建立首个内容切片必需的属性和事件边界。

竞品只提供可比较模式。本文公式是项目综合判断，不声称照搬 Milky Way Idle、Melvor 或 RuneScape。

## 首版战斗资源与属性

首版只有 `HP` 一种战斗资源。未来远程或魔法建立端到端消耗循环后，再为对应玩法设计资源；当前不预留空 `MP` 或 `Stamina` 系统。

玩家和敌人共同拥有：

| 属性 | 含义 |
|---|---|
| `max_hp` | 最大生命 |
| `current_hp` | 当前生命，不得超过 `max_hp` |
| `accuracy` | 攻击命中能力 |
| `evasion` | 避开攻击能力 |
| `armor` | 命中后的物理伤害减免来源 |
| `damage_min` / `damage_max` | 单次命中的 raw damage 闭区间 |
| `attack_interval` | 基础攻击间隔 |

玩家另有 `hp_regen`。敌人是否恢复由内容明确；首版规定敌人在单场战斗中不自然恢复。

`perception` 和 `stealth_rating` 属于战斗前的遭遇系统，不参与已经开始的战斗命中计算。

## 玩家属性

### 生命

```text
base_max_hp = 100
max_hp = 100 + 装备固定 HP 总和
```

首版没有百分比最大生命加成。

### 闪避

```text
evasion = max(1, 10 + 装备闪避固定值总和)
```

### 近战命中

```text
melee_accuracy = max(
  1,
  10
  + 2 × 近战等级
  + 武器命中
  + 其他装备命中
)
```

武器等级要求只检查永久 `近战` 等级。装备和临时效果不能绕过等级准入。

### 近战伤害

```text
level_damage_multiplier = 1 + 0.01 × (近战等级 - 1)
player_damage_min = floor(武器 damage_min × level_damage_multiplier)
player_damage_max = floor(武器 damage_max × level_damage_multiplier)
```

`近战` 等级只影响内容准入、近战命中和近战伤害。它不影响攻速、最大生命、闪避、护甲或恢复，避免一个技能同时放大全部战斗维度。

本文没有给出角色基础 `armor`。首轮 `hunter_coat` 防具由[物品与装备系统](item-equipment.md#生产装备)定义；不能从装备名称推断未在内容表声明的属性。

## 命中

```text
hit_chance = clamp(
  0.05,
  0.95,
  accuracy^1.4 / (accuracy^1.4 + evasion^1.4)
)
```

- `accuracy` 与 `evasion` 相等时，命中率为 `50%`。
- 上下限防止绝对命中和绝对闪避。
- 每次攻击事件只进行一次命中判定。
- 未命中不造成伤害，也不触发其他首版效果。

## 伤害与护甲

命中后，在 `damage_min..=damage_max` 闭区间内取得一个整数 `raw_damage`。战斗实现专项必须在编码前记录具体分布和确定性随机数到闭区间整数的无偏映射，并用固定 fixture 验证；UI 在该 contract 落地前不能自行计算权威预期 DPS。

```text
mitigation = min(0.75, armor / (armor + 100))
final_damage = max(1, floor(raw_damage × (1 - mitigation)))
```

采用比例减伤而不是 flat subtraction，避免低伤攻击突然完全无效。`75%` 上限保留持续风险。一次成功命中至少造成 `1` 点最终伤害。

首版没有暴击、格挡、穿透、元素伤害、反伤、吸血或伤害浮动之外的额外乘区。

## 攻击间隔

玩家和敌人分别保存下一次攻击的世界时间。

```text
effective_interval = max(
  0.8s,
  0.4 × base_interval,
  base_interval / (1 + attack_speed_bonus_total)
)
```

- `attack_speed_bonus_total` 是比例总和，例如 `+10% = 0.10`。
- 首版攻速只来自武器和明确装备，不来自 `近战` 等级。
- 开战时，双方第一次攻击都在各自完整攻击间隔后发生，不立即攻击。
- 两个攻击事件同刻到期时，玩家攻击先结算；如果敌人因此死亡，敌人的同刻攻击取消。
- 装备只能在非战斗状态更换。进入战斗后，装备提供的攻击参数固定；有期限效果仍按世界时间生效和到期。

负攻速修正的合法范围和 `1 + attack_speed_bonus_total` 的下限尚未定义。首个无具体 Debuff 的内容切片不得借此引入未定义行为。

## 自然恢复

```text
base_hp_regen_per_second = max_hp × 0.001
```

这等价于每 `10s` 恢复最大生命的 `1%`。

- 使用连续世界时间。在任何事件发生前，先结算自上一个事件时间以来的恢复。
- 恢复不得依赖渲染帧、固定 UI tick 或在线专用循环。
- `current_hp` 不得超过 `max_hp`。
- 角色存活时，移动、生活技能行动、战斗、待机和离线期间都推进恢复时间。
- 玩家进入 `RespawnState` 后不恢复 HP 或其他战斗资源；复活事件在精确死亡位置一次性设置 Accepted 首轮 baseline：HP 为 `max_hp`，其他首版战斗资源为各自默认值。
- 首版装备可以提供固定 HP，或额外的“每 `10s` 最大生命百分比”恢复。具体内容必须受内容表限制。
- 系统不建立独立恢复期或冷却期。
- 首版敌人在单场战斗中不自然恢复；玩家死亡时，致死敌人按已确认规则完全重置。

连续恢复产生的数值精度、存档精度、显示取整和跨平台确定性仍待统一。

## 战斗事件顺序

战斗 attack 属于[自由向量协议全局同刻顺序](movement-navigation-protocol.md#同一-world-time-的全局顺序)中的 combat slot。每次到期 attack 在该 slot 内按以下顺序处理：

1. 推进世界时间；仅当玩家存活时结算自然恢复，并处理效果到期。
2. 选择到期的攻击者；同刻时玩家优先。
3. 进行一次命中判定。
4. 命中时生成 `raw_damage`。
5. 应用目标 `armor`。
6. 扣减 `current_hp`。
7. 立即判断死亡。玩家 HP 到 `0` 时结束战斗、清除 temporary effects、重置存活敌人、物化精确死亡位置、取消 motion/action 并进入 `RespawnState`；reward settlement 不得继续把未击杀敌人算作击杀。
8. 敌人死亡时，立即标记唯一 kill outcome，并为同一 world time 的全局 settlement slot 登记 XP、掉落、狩猎计数和发现事件；不得提前或重复提交。
9. 战斗继续时，为本次攻击者安排下一攻击时间。

不得按帧模拟。在线和离线不得使用不同公式、不同事件排序或不同随机流。

## 战斗进入与退出

- 敌人发现角色，或当前狩猎目标进入有效接触范围时，开始一对一战斗。
- 首版同时只能与一个敌人交战。
- 多个敌人在同一整数 world time 触发时，不比较 sub-millisecond 交点，按 `encounter_instance_id` 选择一个；其余敌人不加入当前战斗。
- 战斗结束后，对仍在范围内且本 `spawn_cycle` 尚未完成 encounter check 的敌人按 `encounter_instance_id` 重新评估，可能连续进入下一场一对一战斗。
- 战斗锁定移动和生活技能动作，并暂停当前 motion leg 或 non-combat action progress。战斗后只有唯一 `TaskIntent`、action target 和 prerequisites 未变时，才从精确交战位置继续剩余 path/action；任务替换、取消、装备或目标变化会取消旧执行，且不产出、不消耗材料、不发 XP。
- 首版没有逃跑。取消或替换任务不能结束战斗。
- 敌人死亡后，在精确交战位置完成结算并恢复被中断任务。
- 玩家死亡后，执行已确认的 `60s` 首轮等待、精确死亡位置复活、临时效果清除、致死敌人满状态重置和唯一任务从头重评；未完成 motion/action 不恢复。
- 战斗结束后不存在恢复期或冷却期。

## 战斗经验与掉落

- 每种敌人声明固定 `base_combat_xp`；经验只在击杀时发放。
- 首版只有近战方式。玩家对被击杀敌人造成过有效伤害时，全部 `base_combat_xp` 进入 `近战`。
- 强制进入的非目标战斗同样结算 XP 和掉落，但不增加狩猎计数。
- 未击杀、玩家死亡或任务取消均不给部分 XP 或部分掉落。
- 后续多战斗方式使用“击杀经验包按有效伤害占比分配”；首版不实现多方式分配抽象。
- 掉落在击杀事件中按独立用途标签取随机数。叙事必掉物不进入随机掉落表。

## 确定性随机

玩法随机流与 terrain generator 完全分离。

敌人身份使用以下分层：

- `placement_id`：固定 content placement 或巢点；
- `spawn_cycle`：每次有效重生单调加 `1`；
- `encounter_instance_id = placement_id + spawn_cycle`。

地图知识和 `next_available_time` 使用 `placement_id`。潜行一次性判定、潜行 XP 和战斗随机使用 `encounter_instance_id`。

每个战斗随机数只由以下持久化或稳定输入决定：

```text
gameplay seed
+ encounter_instance_id
+ combat event ordinal
+ 用途标签：hit / damage / loot
→ 单个确定性随机数
```

不得使用帧时间、访问顺序或会被无关事件消耗的全局 RNG。不同用途标签必须防止命中、伤害和掉落互相改变随机序列。

相同初始状态、玩家决策和有效世界时间必须让在线与离线得到相同的攻击、命中、伤害、死亡和掉落序列。

## 潜行公式

[自由向量移动协议](movement-navigation-protocol.md#敌人检测的毫秒量化)规定：T1/T2 detection radius 的 Accepted 首轮平衡基线分别为 `2/3 tiles`；整数毫秒 `(t-1,t]` swept segment 与 detection circle 相交时触发判定，同毫秒多敌按 `encounter_instance_id`。狩猎目标直接开战；非目标敌人的同一 `encounter_instance_id` 判定成功后，在该 spawn cycle 内不再强制遭遇。

```text
stealth_rating = max(
  1,
  10 + 2 × 潜行等级 + 装备潜行
)

detect_chance = clamp(
  0.05,
  0.95,
  perception^1.4 / (perception^1.4 + stealth_rating^1.4)
)
```

- 敌人的 `perception` 由内容表声明。
- 判定只在首次进入检测区时进行。
- 当前狩猎目标直接开战，不使用该公式。
- 同一 `encounter_instance_id` 最多结算一次成功潜行经验；新 `spawn_cycle` 形成新的结算资格。
- 侦测随机数使用 gameplay seed、`encounter_instance_id` 和独立 `detect` 用途标签，不使用战斗或地形随机流。

复活后 `5s RevivalGrace` 阻止非狩猎目标敌人强制遭遇。主动狩猎/主动进入战斗立即结束 grace；它不是 Buff/Debuff，不进入属性修正或 stack policy。

## 首个区域平衡样例

本节与[首个可玩区域](first-playable-region.md#敌人原型)共同构成 Accepted 首轮平衡基线。

### 武器

| 原型 | `damage_min..damage_max` | 武器命中 | 基础攻击间隔 |
|---|---:|---:|---:|
| `worn_blade` | `4–6` | `+5` | `2.5s` |
| `copper_blade` | `8–12` | `+10` | `2.4s` |

`copper_blade` 的 permanent melee requirement 固定为 `近战 2`。该数值是 Accepted 首轮平衡基线。

### 敌人

| 属性 | T1 狩猎目标 | T2 边界威胁 |
|---|---:|---:|
| `max_hp` | `30` | `70` |
| `accuracy` | `14` | `24` |
| `evasion` | `10` | `18` |
| `armor` | `0` | `10` |
| `damage_min..damage_max` | `3–5` | `7–11` |
| `attack_interval` | `3.0s` | `2.8s` |
| `perception` | `12` | `25` |
| `base_combat_xp` | `30` | `80` |
| 重生时间 | `180s` | `300s` |

设计目标是：`worn_blade` 对单个 T1 具有高成功率，但连续战斗累积伤势；`worn_blade` 挑战 T2 基本失败；`copper_blade` 显著改善对 T2 的胜率；增加 `hunter_coat` 后形成更安全的边界挑战。概率上下限意味着任何有限样例都不能证明必胜。该目标必须通过确定性模拟、概率分析和包含路径恢复的端到端模拟验证。

## 设计验证记录：首轮蒙特卡洛

- 状态：设计验证记录，不能单独证明平衡目标
- 采样次数：`100,000`
- 方法：用户提供的确定性伪随机蒙特卡洛结果
- 本次文档任务：未取得或运行模拟脚本、gameplay seed、数值精度与完整输入 fixture

### 单场结果

| 场景 | 胜率 | 胜利时平均剩余 HP | 平均战斗时间 |
|---|---:|---:|---:|
| 等级 `1` + `worn_blade` 对 T1 | `100,000` 次样例中未观察到失败 | `83.96` | `23.62s` |
| 等级 `1` + `worn_blade` 对 T2 | 约 `0.07%` | 未提供 | 未提供 |
| 等级 `1` + `copper_blade` 对 T2 | 约 `80.20%` | `28.15` | `33.97s` |
| 等级 `1` + `copper_blade` + `hunter_coat` 对 T2 | 约 `95.05%` | `41.52` | `35.06s` |

最后一项使用 `110 HP` 和 `10 armor`。它来自[物品与装备系统](item-equipment.md#战斗平衡影响)的 Accepted 首轮防具内容。

### 连续 T1 结果

忽略移动和寻敌期间的恢复，并在胜利后立即挑战下一个 T1。在“玩家死亡或达到 `10` 杀”前，平均完成 `5.97` 杀，主要分布在 `5–7` 杀。该最坏情形说明 `current_hp` 跨战斗持续和伤势累积会改变连续狩猎结果。

### 关键命中率

| 攻击关系 | 命中率 |
|---|---:|
| `worn_blade` 攻击 T1 | `67.76%` |
| T1 攻击玩家 | `61.56%` |
| `worn_blade` 攻击 T2 | `48.00%` |
| `copper_blade` 攻击 T2 | `56.98%` |
| T2 攻击玩家 | `77.31%` |

### 判断

在该模拟输入下，结果支持以下设计方向：

- 本次 `100,000` 次样例中，初始装备对单个 T1 未观察到失败；这不是数学上的必胜保证；
- 连续战斗存在可观察的状态累积风险；
- T2 构成装备门槛；
- `copper_blade` 显著改变对 T2 的胜率；
- `hunter_coat` 进一步降低当前 T2 样例的挑战风险，使狩猎/工艺与采矿/锻造两条生产链共同影响边界挑战。

该记录只验证给定数值模型，不证明端到端体验已经成立，也不构成必胜保证。规范的 Accepted 状态来自负责人决策，不来自该模拟。

### 风险与后续验证

实际寻路和索取目标会经过世界时间，并自然恢复 HP。因此真实连续狩猎的死亡频率可能低于“立即连续挑战”的最坏情形。

下一轮必须加入真实路径距离、敌人密度、目标重生和自动探索时间，再评估是否调整 `hp_regen`、敌人密度或 T1 伤害。模拟脚本、seed、精度/取整、玩家 `armor` 和全部初始 fixture 也必须保存，才能把结果作为可复现验证证据。

## Buff/Debuff 最小契约

首个内容切片可以没有具体效果，但状态模型必须支持有期限的属性修正：

- `effect ID`；
- `source ID`；
- `start world time` 和 `end world time`；
- 属性修正；
- `stack policy`。

同一 `effect ID` 在首版只能选择以下一种规则，并由效果内容明确声明：

- `refresh duration`；
- `replace if stronger`。

不得默认无限叠层。属性结算顺序统一为：

```text
base
→ flat bonuses
→ summed percentage bonuses
→ clamp / round
```

死亡清除全部临时效果。离线期间按世界时间到期。各属性的具体 clamp、精度和取整方式仍需形成统一表。

## UI

已发现敌人显示：

- HP；
- 双方命中概率；
- 双方应用当前护甲后的伤害范围；
- 双方攻击间隔；
- 玩家自然恢复；
- 预期 DPS 和承伤 DPS；
- 当前生命是否低于敌人一次最大最终伤害。

预计值必须标记为估算，不能承诺一定生存。伤害分布确定前，预计 DPS 只能作为待实现字段，不能显示伪精确数值。

战斗状态显示当前敌人、下一次双方攻击倒计时、HP、最近事件和狩猎进度。事件日志只记录攻击结果和结算，不输出帧级数据。

## 明确排除

- `Defence` 或 `Hitpoints` 独立技能；
- `MP` 或 `Stamina`；
- 主动技能；
- 暴击和格挡；
- 元素和抗性；
- 异常状态具体内容；
- 群战、仇恨和敌群；
- 逃跑；
- 自动食物或药剂；
- 耐久；
- 复活损失；
- 战后恢复期和冷却期。

## 验收标准

- 相等 `accuracy`/`evasion` 得到 `50%`，命中概率始终在 `5%–95%`。
- `armor` 单调降低伤害且减伤不超过 `75%`，命中最低造成 `1` 点伤害。
- `近战` 等级不改变攻速、HP、闪避、护甲或恢复。
- 双方独立攻击，结果不因渲染 FPS 改变。
- 同刻玩家优先规则稳定。
- 持续恢复跨所有规定状态，且不生成恢复期。
- 击杀前没有 XP 或 loot；只有目标匹配才增加狩猎计数。
- 取消任务不能逃跑；死亡重置致死敌人并保留任务。
- 在线与离线从同状态和同有效时间得到语义等价结果。
- 随机数不依赖 terrain RNG 或无关事件访问顺序。
- 首个区域样例在进入实现验收前必须通过可复现确定性模拟、概率分析和路径级端到端模拟；验证失败时通过显式版本化平衡决策调整，不静默改值。

## 实现、内容与验证工作

- 战斗实现专项须在编码前补齐 `raw_damage` 分布、随机数到闭区间整数的无偏映射，以及连续恢复、属性、效果和存档的数值精度与取整 contract。
- 内容专项须在内容表声明角色基础 `armor`、T1/T2 正式名称、掉落内容和叙事必得标识；装备属性遵守[物品与装备系统](item-equipment.md)。
- 效果专项若引入负攻速效果，须先写明合法范围、分母下限和叠加规则；首个无此效果的切片不能产生未定义行为。
- movement、通行、迷雾、目标索取、路径恢复和中断重放直接遵守已接受的[自由向量移动协议](movement-navigation-protocol.md)。
- 验证专项须归档模拟脚本、gameplay seed、完整 fixtures、结果格式，以及包含真实路径恢复、敌人密度、重生和自动探索的端到端平衡验证。

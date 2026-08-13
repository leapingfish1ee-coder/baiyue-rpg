# 阶段 3A：T1 狩猎与连续战斗垂直切片

- 状态：Implemented
- 起草日期：2026-08-13
- 决策者：项目负责人
- 前置实现：[阶段 2C 当前状态](../product/current-state.md)
- Accepted 决策：[Decision-0007](../decisions/0007-t1-hunting-continuous-combat.md)

> 本文只定义阶段 3A 增量。实现必须扩展现有 gameplay worker、事件引擎、`TaskIntent`、内容层和四-store 存档，不建立独立战斗循环、在线专用 tick 或第二套离线模拟。

## 目标

交付首个真实开放世界战斗闭环：

```text
探索并发现灰鬃野猪
→ 玩家继续原任务时可能潜行通过或被强制战斗
→ 玩家也可以明确设置有限或持续狩猎
→ 狩猎目标进入 detection circle 后直接强制战斗
→ 双方按世界时间自动攻击，玩家 HP 跨战斗累积并持续恢复
→ 击杀原子结算近战 XP、兽皮、任务计数和敌人重生
→ 死亡只消耗 60 秒，原地满 HP 复活并保留永久状态与任务
→ online、offline、reload 得到同一结果
```

## 范围

### 包含

- `graymane_boar` 与 `raw_hide`；
- Melee、Stealth 两项技能；
- `Hunt` `TaskIntent`，finite kills 或 continuous；
- 学习圈三个保证巢点和 ambient enemy placement；
- enemy discovery、known target、route claim、auto-explore、death/respawn；
- 一次性非目标 detection、Stealth success pending/exit settlement；
- 一对一 CombatState、双方独立 attack deadlines、命中、整数伤害与同刻玩家优先；
- micro-HP、持续自然恢复、跨战斗伤势；
- `worn_blade` 固定 weapon loadout 与只读 weapon UI；
- 击杀、Melee XP、`raw_hide`、狩猎计数和敌人重生的原子结算；
- movement/non-combat action 暂停和恢复、战斗中任务变更、死亡取消执行；
- `60s` RespawnState、精确位置满 HP 复活和 `5s RevivalGrace`；
- online、offline、reload、备份和立即 settlement commit；
- Task、Skills、Inventory、Equipment、Map、Combat 和 bottom activity 的实际 UI。

### 明确排除

- T2 敌人、群战、敌人移动、巡逻、仇恨或逃跑；
- Smithing、工作站、铜锭、`copper_blade`；
- `hunter_coat`、`trail_charm`、body/accessory 操作和武器替换；
- temporary effect 内容、食物、药剂、主动技能、暴击、格挡、元素和战斗策略；
- 远程、魔法、多方式 XP 分配、地下城和叙事；
- 旧 protocol/save/content 迁移、兼容字段或 fallback。

## 稳定敌人内容表

| field | `graymane_boar` |
|---|---|
| display | 灰鬃野猪 |
| max HP | 30 |
| accuracy | 14 |
| evasion | 10 |
| armor | 0 |
| damage | 3..5 |
| attack interval | `3000ms` |
| perception | 12 |
| detection radius | `2048 nav units` |
| Melee XP | 30 |
| Stealth XP | 12 |
| loot | `raw_hide ×1` guaranteed |
| loot entry | `loot:graymane_boar:raw_hide:guaranteed` |
| respawn | `180000ms` |

玩家基线：`max_hp = 100`、`evasion = 10`、`armor = 0`、基础 HP 恢复每 `10s` 最大生命 `1%`。`worn_blade` 为 damage `4..6`、accuracy `+5`、interval `2500ms`、Melee 1。

## 内容放置与知识

- 资源 placement 保持 `CONTENT_PLACEMENT_VERSION = 3` 和既有字节结果。
- enemy 使用独立 `ENEMY_PLACEMENT_VERSION = 1` 和同一绝对 `32×32 tiles` content cell。
- 每 cell 最多一个 `graymane_boar` ambient candidate；Land 与站立检查失败时丢弃，不重抽。
- 营地 Chebyshev `0..20 tiles` 安全圈内的 ambient enemy 丢弃。
- enemy 与资源或 guarantee tile 冲突时，既有内容优先，enemy 丢弃。
- 在既有八个 guarantee slot 后追加 `graymane_boar/learning-a`、`learning-b`、`learning-c`。追加不得移动既有资源 ID 或 tile。
- `learning-a` 距营地 `21..28 tiles`；`learning-b/c` 距离 `32..56 tiles`。三者 distinct、Land、可站立、从营地可达。

迷雾后的敌人不进入 read model、目标候选或遭遇判定。观察首次揭露巢点后写入 WorldKnowledge。观察半径大于 detection radius，因此正常移动会先发现敌人，再进入威胁区。

enemy mutable state 以 `placement_id` 存入所属 `world_chunk`：`spawn_cycle`、active/dead、`next_available_world_time_ms` 和本 spawn cycle 的 encounter/stealth settlement 状态。非战斗 active enemy 默认为满 HP；当前敌人 HP 只保存在 CombatState。

## 任务与目标索取

`TaskIntent` 增加：

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

只有已知 archetype 可以提交。`requestedKills = null` 表示持续狩猎。索取按已知 active、可达敌人的权威 route cost 排序，同 cost 按 placement ID；无合格目标但有 frontier 时为原 Hunt 自动探索。系统不为等待单个重生停止探索。

当角色 motion 首次进入当前狩猎 archetype 的 detection circle，立即暂停 motion 并进入强制战斗，不进行潜行判定。只有击杀时当前唯一 Hunt 仍指向该 archetype，才增加 completed kills。

## 遭遇与潜行

非当前狩猎目标按以下事件语义执行：

1. 权威 swept motion 首次进入 detection circle 时生成一次 encounter check。
2. 同一 world time 多敌按 `encounter_instance_id` 排序。
3. `detect` roll 小于权威 `detect_chance_ppm` 时进入强制战斗，不发 Stealth XP。
4. 未被发现时记录 pending stealth pass，并继续原 motion。
5. 角色完整离开该 detection circle 时原子结算 Stealth XP 12；同 instance 只结算一次。
6. 停在圈内、任务切换为狩猎、敌人死亡或玩家死亡都不会把未完成 pass 结算为成功。

同一 `encounter_instance_id` 不因离开再进入重复判定。敌人有效重生后 `spawn_cycle +1`，形成新 identity 和新判定资格。敌人在角色圈内重生时立即评估；RevivalGrace 只阻止非狩猎目标。

## CombatState 与执行中断

CombatState 至少保存：

- combat/encounter identity、敌人 placement 与 archetype；
- 是否由当前 Hunt 触发；
- 玩家和敌人开战时固定属性；
- enemy current HP micro；
- player/enemy next attack world time；
- combat event ordinal；
- 被暂停 execution 的剩余 motion/action 与 task/prerequisite identity。

CombatState 是高优先级 overlay，不替换 `TaskIntent`。进入战斗时物化精确位置和剩余进度；战斗时不推进 movement 或 non-combat action deadline。

战斗中 `SetTask`/`CancelTask` 立即更新唯一 intent 并丢弃不再匹配的 paused execution，但 CombatState 继续。装备操作返回稳定 `command/combat_locked`。击杀后只有 task identity、action target 和 prerequisites 均未改变时，才从精确交战位置恢复剩余 path/action；否则从当前状态重评最新 intent。

## 攻击、随机与击杀

开战时双方第一次攻击均安排在完整 interval 后。同刻时先处理玩家攻击；若敌人死亡，取消敌人的同刻攻击。

命中、潜行和伤害使用 Decision-0007 的 fixed-point probability 和 versioned random。每次攻击：

1. 推进 world time 并结算存活玩家自然恢复；
2. 计算 `hit_chance_ppm` 并进行独立 `hit` roll；
3. 命中时用无偏闭区间映射生成 raw integer damage；
4. 应用 armor 公式并至少造成 1 点；
5. 立即处理死亡或安排攻击者下一次完整 interval。

击杀 transition 同时：

- 将 enemy 标记 dead，设置 `next_available = now + 180000ms`；
- 增加 `spawn_cycle` 只在实际 respawn event 发生时执行；
- 增加 Melee XP 30；
- 增加 `raw_hide ×1`；
- 若当前 Hunt 匹配则增加 completed kills；
- 更新 event ordinal、revision、dirty world chunk 和 read model；
- 标记 immediate commit。

任一安全整数检查失败时不写入部分结算。

## HP、死亡与复活

HP 使用 Decision-0007 的 micro-HP 与 regen remainder。每次 world time 前进都先把存活时间计入恢复；满 HP 不积攒余数。UI 显示一位小数，但不成为权威值。

玩家 HP 到 0 时：

- 结束 CombatState；
- 将致死敌人恢复满状态并保持 active；
- 丢弃 paused movement/action；
- 保留唯一 TaskIntent 及 completed count；
- 在精确位置进入 `RespawnState`，deadline 为 `now + 60000ms`；
- 死亡期间不恢复 HP。

deadline 到期时原地设置满 HP、零 regen remainder，并设置 `revival_grace_until = now + 5000ms`。系统从头重评当前 intent。主动 Hunt 触发战斗时立即清除 grace；非目标敌人在 grace 内不强制遭遇。

阶段 3A 没有实际 temporary effect 内容，不持久化空效果框架。

## 版本

| version | 阶段 2C | 阶段 3A |
|---|---:|---:|
| `GAMEPLAY_PROTOCOL_VERSION` | 1 | 2 |
| `DB_SCHEMA_VERSION` | 1 | 1 |
| `SAVE_SCHEMA_VERSION` | 4 | 5 |
| `GAME_RULES_VERSION` | 4 | 5 |
| `CONTENT_VERSION` | 4 | 5 |
| `CONTENT_PLACEMENT_VERSION` | 3 | 3 |
| `ENEMY_PLACEMENT_VERSION` | 无 | 1 |
| `GAMEPLAY_RANDOM_VERSION` | 无 | 1 |
| `GENERATOR_VERSION` | 3 | 3 |

协议、save 和 content 直接替换旧版本。阶段 3A 不保留 v1 Worker 分支或阶段 2C save migration。

## 产品 UI

- Task：在首次发现后显示“狩猎 · 灰鬃野猪”，支持有限击杀数和持续狩猎。
- Skills：增加 Melee 和 Stealth；不显示 Smithing。
- Player：显示实际 current/max HP、自然恢复来源、存活/战斗/死亡状态。
- Combat：战斗时显示敌人名称、双方 HP、下一攻击 ETA 和最近一次攻击结果。
- Inventory：显示 `raw_hide`；保留现有材料。
- Equipment：显示只读 `weapon = worn_blade` 与精确属性；不显示空 body/accessory。
- Map：已知 active/dead/respawning enemy 使用可区分状态；迷雾后敌人不显示。
- Activity：区分狩猎索取、自动探索、强制战斗、潜行通过、等待复活和 RevivalGrace。
- Offline report：沿用 item delta/skill XP，并增加击杀、死亡/复活和最终 HP 摘要所需的最小字段；不建立完整战斗日志。

## 实施结果

阶段 3A 已按单一 T1 闭环接入既有 gameplay worker、事件引擎、内容层和四-store 存档。实现事实与字段边界见[阶段 3A 运行时契约](../specifications/phase-3a-runtime-contracts.md)，本地检查结果见[阶段 3A 验证记录](phase-3a-validation-record.md)。

## 实施顺序

1. 增加 deterministic probability/random 与 micro-HP 模块及固定数值 fixture。
2. 增加 `graymane_boar` placement、知识和 mutable world entity state，不改变既有资源 placement。
3. 先打通 `Hunt ×1 → Combat → kill → raw_hide/XP/count`。
4. 加入自然恢复、跨战斗 HP、死亡/复活和 RevivalGrace。
5. 加入非目标 detection、Stealth 完整通过结算和生活任务暂停/恢复。
6. 接入 persistence、offline、read model 和产品 UI。
7. 更新 runtime contract、current-state、路线图和验证记录。

每一步保持产品可启动。不得先实现 T2、工作站、锻造、战斗装备或通用效果系统。

## 缩减发布门槛

只保留能证明阶段 3A 可玩的证据：

1. TypeScript strict 与 production build。
2. 数值 fixture：fixed-point probability、random purpose separation、无偏范围边界和 micro-HP regen。
3. placement/encounter fixture：三个 guarantee、安全圈、known-only、潜行成功/失败/去重和 Hunt bypass。
4. combat/death fixture：固定 attack trace、同刻顺序、击杀原子结算、paused execution、任务变更、`60s` respawn 和 `5s` grace。
5. online/offline/reload fixture：同一初态得到相同 HP、enemy state、XP、loot、task count 和 attack trace。
6. 一条真实产品 E2E：探索发现灰鬃野猪 → `Hunt ×1` → 战斗 → `raw_hide ×1`、Melee XP 30、任务完成 → reload 不重复。
7. 既有阶段 1/2A/2B/2C gameplay、存档、生产和渲染主路径回归。

不扩展 T2、全 seed 战斗胜率、长时间连续狩猎、全死亡时点、全敌人浏览器矩阵或旧存档兼容测试。非阻断平衡问题记录为技术债。

## 完成定义

玩家无需 Debug 工具即可在开放世界发现灰鬃野猪、被其发现或潜行通过、设置有限/持续狩猎、经历连续伤势与自然恢复、完成击杀并获得 Melee XP 和兽皮；死亡后只等待 60 秒并在原地继续。代码、runtime contract、current-state、路线图和产品 UI 对同一能力范围一致，且不显示排除系统。

# 自由向量移动、导航、迷雾与目标索取

- 状态：Accepted
- 决策者：项目负责人
- 确认日期：2026-08-09
- 适用范围：首个端到端可玩切片的自动移动、导航、迷雾、目标索取与空间事件

> 本协议已封板，完整替代此前的离散格步规则，不保留旧路线或兼容层。它是首个切片的实现与验收基线，不是已实现事实。文末 fixture 与性能 benchmark 是实现验收工作，不改变本协议的 Accepted 状态。

## 语义定义

“自由向量移动”表示：

- 角色权威位置是连续二维世界中的定点坐标。
- 自动导航路径由任意方向的直线段组成。
- 角色不吸附到 tile center，也不限制为离散固定方向或 `45°` 倍数航向。
- terrain tile 仍是生成、通行成本、迷雾知识和内容放置的语义栅格。
- 玩家仍通过 `TaskIntent` 指定活动类别和目标；系统自动索取目标、规划和移动。

首个切片不接受 WASD、摇杆或手动微操。未来若负责人把手动角色移动纳入新产品范围，必须重新设计输入所有权、任务中断、online/offline 等价和存档协议，不能把手动输入隐式塞进本协议。

## 路线比较与选择

### 普通 grid A* 后平滑：不采用

离散搜索先用一套成本选择路径，平滑后再用另一条连续几何执行。两者可能对目标远近、高成本 terrain 和阻挡角给出不一致结果。

### 每 chunk navmesh + Detour/funnel：暂不采用

navmesh 适合任意多边形障碍、多种 agent radius、动态障碍或多角色 avoidance。当前输入本身是规则 terrain grid；首版引入 navmesh 会增加 chunk seam、构建、序列化、版本、streaming 和 WASM 依赖。

未来只有在任意多边形障碍、多种角色半径、动态阻挡或多角色避让进入产品范围时，才重新评估 navmesh。当前不预留 Recast/Detour 兼容接口。

### Weighted Basic Theta* + fixed-point path follower：采用

Basic Theta* 保留 terrain grid 的规则真源，同时允许父节点通过 line of sight 产生任意角路径。首版在 gameplay worker 内实现职责单一的 weighted Theta* 模块；online、offline、reload 和 replay 共用同一模块与事件推进器。

当前 `web/package.json` 没有 production dependency。首版不添加 Recast 或通用寻路包。原因是现有 navmesh 工具解决了当前不存在的几何和群体问题，却不能直接提供本项目要求的迷雾隔离、BigInt fixed-point、stable tie-break 和离线重放语义。

研究依据：

- [Theta*: Any-Angle Path Planning on Grids](https://arxiv.org/abs/1401.3843)：Basic Theta*、非均匀 traversal cost 扩展和“不保证连续空间真实最短”的边界。
- [Godot NavigationAgents](https://docs.godotengine.org/en/stable/tutorials/navigation/navigation_using_navigationagents.html)：pathfinding、path following 与 avoidance 是可分离责任；navigation 不直接移动 actor。
- [Recast Navigation](https://github.com/recastnavigation/recastnavigation)：navmesh generation、Detour path query、tile cache streaming 与 crowd/avoidance 的模块和复杂度。

这些来源只支持路线判断，不构成本项目需求或已实现证据。

## 坐标、精度与角色形体

### 坐标

```text
NAV_UNITS_PER_TILE = 1024
tileCenter(tile) = tile * 1024 + 512
```

- 权威 `WorldPoint` 的 `x/y` 使用整数 nav units。
- 首版 gameplay tile coordinate 范围是 `[-2^31, 2^31-1]`。
- 位置、路径成本和需要避免溢出的中间量使用 `BigInt` 或等价精确整数。
- worker protocol 与存档使用 canonical decimal strings；禁止 leading zero 和 `-0`。
- 负坐标的 tile 换算使用 Euclidean floor division。
- renderer 只接收 camera-relative `Number`/float；完整世界坐标不得进入 float32 GPU attribute。

该范围是首版协议边界，不表示世界具有无限坐标精度。超出范围的 command、内容或存档必须被拒绝，不能截断、wrap 或转为不精确 `Number`。

### 角色

- 角色 collision body 是半径 `256 nav units`，即 `0.25 tile` 的圆。
- `BASE_MOVE_SPEED = 2048 nav units/s`，即 `Land` 上 `2 tiles/s`。
- 首版没有移动技能、移动速度装备或移动速度 buff。
- `探索` 等级不改变移动速度。

## 分层与导航映射

- 导航映射属于 `GAME_RULES_VERSION`。
- 映射不修改 Rust 生成器的 `8192-byte` terrain payload，也不触发 `GENERATOR_VERSION`。
- `DeepWater`、`Water` 阻挡。
- `Land`、`Sand`、`Rock`、`Snow` 可通行，成本系数分别为 `1000`、`1100`、`1400`、`1500`。
- `Grass`、`Grove` 等 `Decoration` 只影响视觉。
- 首版没有动态障碍；资源、生产站和敌人不阻挡导航。

内容生成器可以检查完整确定性 terrain。任务系统、路径规划、目标索取和 UI 只能读取 `Revealed` tile；`Unrevealed` tile 在规划中视为不可通过。内容放置能力不能成为穿透迷雾的旁路。

## Swept-circle line of sight

Theta* 的一条直线段只有在角色圆沿整段扫掠都不接触阻挡 tile 时才有 line of sight：

- 使用 supercover tile traversal 枚举线段接触的全部 terrain tile。
- swept circle 接触阻挡边界也算 collision。
- 角色不能从两个对角阻挡 tile 的角点间穿过。
- 判断只读取已经 `Revealed` 的 terrain。

资源、生产站和敌人不参与 collision sweep。未来若引入动态障碍，必须重新评估 path invalidation 和 navmesh/avoidance 路线，不能在首版算法中预留未使用的动态接口。

## Weighted Basic Theta*

### 顶点与接入

- 搜索的持久 grid vertex 使用 `Revealed`、角色圆可站立 tile 的中心。
- 当前连续位置作为临时 start vertex。
- 精确目的地作为临时 goal vertex。
- start/goal 只连接 swept-circle line of sight 成立的可见邻域。

### 非均匀路径成本

任意直线段按 tile boundary 切片。算术使用整数或规范有理数：

- segment `dx/dy` 是整数 nav units；
- supercover boundary crossing parameter 使用约分后的有理数；
- 连续且 terrain factor 相同的参数区间先合并为一个 same-cost subleg；
- subleg 的欧氏长度使用 `ceilSqrt(dx² + dy²)` 的 nav-unit 上取整；有理端点通过分子/分母的精确平方比较完成，不转为平台 float；
- 每个 same-cost subleg 分别向上取整成本，再累加 route cost。

```text
sublegLengthNavUnits = ceilSqrt(sublegDx² + sublegDy²)
sublegCost = ceil(sublegLengthNavUnits * terrainFactor / 1000)
segmentCost = sum(sublegCost)
routeCost = sum(segmentCost)
ETAms = ceil(routeCost * 1000 / BASE_MOVE_SPEED)
```

线段恰好沿两个 tile 的公共边界时，该 subleg 使用两侧较高 terrain factor。正负坐标使用相同 Euclidean division 和 rational crossing 规则。目标选择、路径搜索、path following ETA 和离线推进必须使用同一 `routeCost`，不能另用欧氏距离或未加权路径长度。

### Heuristic 与稳定顺序

- 精确目的地搜索使用最低 terrain factor 下、以相同 `ceilSqrt` 计算的 Euclidean admissible heuristic。
- open set 按 `(f, g, y, x, parentY, parentX)` 升序稳定排序。
- 同一 vertex 出现完全相同成本的父节点候选时，保留 `(parentY, parentX)` 词典序较小者。
- Array/Map 访问顺序、chunk 到达顺序、渲染帧和 Worker yield 都不能影响结果。

Basic Theta* 只保证当前版本规划器产生短的任意角 route。它不保证数学上的连续空间全局最短路径。因此产品中的“最近”严格定义为：当前 `GAME_RULES_VERSION` 的确定性 planner 返回的最低 `routeCost`，不是欧氏最近或理论最优。

多目标搜索必须推进到足以证明没有更低 planner cost 的已知候选。CPU/time-slice 预算只能让 gameplay worker 分批继续；“搜索未完成”不能被报告为无路径、无目标或 waiting reason。

## 连续运动与整数时间

Theta* 输出由任意方向 `WorldPoint` 组成的折线路径。gameplay engine 不按渲染帧修改权威状态。

当前 motion leg 至少保存：

- `start`；
- `end`；
- `start_world_time_ms`；
- expected `end_world_time_ms`；
- accumulated weighted distance/cost；
- path index。

UI 只在已提交 read model 之间插值；插值位置没有 gameplay 语义。

权威时间只使用整数 `world_time_ms`。权威位置、累计 route cost 和 event time 不按渲染帧累加。motion/event 时间由起点 world time 和精确累计加权成本计算：

```text
eventWorldTimeMs = motionStartWorldTimeMs
  + ceil(accumulatedRouteCost * 1000 / BASE_MOVE_SPEED)
```

terrain boundary、path endpoint 和其他连续几何事件都量化到首个覆盖该事件的整数毫秒，即 `ceil(exactElapsedMs)`。协议不保存无理数交点。

### `roundDivNearestEven`

`positionAt(t)` 使用精确整数或有理数累计 route cost 反推 path parameter，再把 `x/y` 分别量化为 canonical integer `WorldPoint`。除法统一使用 `roundDivNearestEven(n, d)`，其中 `d > 0`：

```text
q = floorDiv(n, d)
r = n - q * d
0 <= r < d

2r < d  -> q
2r > d  -> q + 1
2r = d  -> q 与 q + 1 中的偶数
```

正负坐标使用同一规则。实现不能通过 `Number`/float 近似商、余数或 tie。渲染可以根据权威 leg endpoints 和时间使用 camera-relative 浮点插值，但不能把插值结果回写 gameplay state。

### 毫秒物化与 crossing

在几何事件对应的整数 `world_time_ms`，engine 只物化一次 canonical `WorldPoint`。对于前一采样位置到当前 `positionAt(t)` 的 swept segment，engine 必须处理该毫秒内 route 扫过的全部 terrain boundary；不能只比较两个量化端点所在 tile。

motion interruption、player command、autosave 和 read-model snapshot 也必须在各自整数 world time 通过同一个 `positionAt(t)` 物化。任何模块都不能读取 renderer 插值位置作为权威状态。

### 敌人检测的毫秒量化

敌人检测不求解或保存含平方根的解析圆交点。对于整数毫秒 `t`，engine 检查权威 motion 在半开时间段 `(t-1, t]` 的 swept segment 是否与 detection circle 相交：

- segment-to-circle squared distance 使用整数或规范有理数比较；
- 首个满足相交条件的 `t` 是 encounter event time；
- 角色在该时刻物化为 `positionAt(t)`；
- 即使 `positionAt(t-1)` 与 `positionAt(t)` 都在圆外，只要中间 segment 穿过圆，仍会触发；
- 连续几何到整数时间的最大量化误差不超过 `1ms`。

同一毫秒与多个敌人的 detection circle 相交时，不比较无理数 sub-millisecond 根，统一按 `encounter_instance_id` 选择。该顺序是产品的决定性语义，不声称还原真实连续交点的先后。

gameplay worker 每次推进到以下事件中最早者：

- terrain tile boundary crossing；
- path point 或 destination arrival；
- observation settlement；
- 按上述毫秒量化判定的最早敌人 detection-circle intersection；
- timed effect expiry；
- resource/enemy respawn；
- combat attack、non-combat action completion、player respawn 或其他既有 world event。

若同一毫秒穿越多个 tile boundary，先按真实 rational crossing parameter，再按 tile `(y, x)` 排序。同一毫秒的 movement 只执行一次 observation。

### 同一 world time 的全局顺序

同一整数 world time `T` 固定按以下顺序处理：

1. 把 continuous recovery 推进到 `T`。
2. 使到期的 temporary effect 和 `RevivalGrace` 失效；它们不影响该时刻后续事件。
3. 处理 player respawn，再按稳定 entity ID 处理 entity respawn。
4. 处理已经存在的 combat attack：player attack 优先，再按稳定 actor ID 处理 enemy attack。
5. 处理 non-combat action completion。
6. 处理 movement：物化 `positionAt(T)`；按 rational crossing parameter、再按 `(y, x)` 处理全部 tile crossing；执行一次 observation/reveal/discovery；评估 encounter；若没有进入 combat，再处理 path/destination arrival 和 task re-evaluation。
7. 按 stable event ID 处理 kill、action、discovery reward 与 inventory/knowledge settlement。

同一时刻产生的即时状态转换重复执行到稳定。死亡或 storage/integrity failure 导致 simulation pause 后，engine 必须删除同刻已经不再有资格的后续事件。

online、offline、reload 和 replay 使用同一事件推进器。离线不能使用简化移动、直线 teleport 或不同的观察/遭遇采样。所需 chunk 尚未生成或载入时，模拟暂停等待基础设施数据；该等待不推进 `world_time_ms`。

## 永久迷雾与探索

### 知识与观察

- 每个 terrain tile 永久保存 `Unrevealed | Revealed`。
- 首版不做 terrain LOS 遮挡、临时视野、隐藏目标或迷雾回卷。

```text
radiusTiles = min(13, 4 + floor((ExplorationLevel - 1) / 10))
```

观察事件发生于：

- 新存档起点；
- motion 跨入新的 tile；
- path endpoint；
- action target arrival。

观察圆以事件发生时的连续 `WorldPoint` 为圆心。tile center 与圆心距离不大于 `radiusTiles * 1024` 时，该 tile 被揭示。

- 新存档初始观察不授予探索 XP。
- 后续每个首次揭示 tile 授予 `1 Exploration XP`。
- 地标、资源类型、敌人类型和叙事内容的首次发现可以另给固定 XP。
- 重复观察不授予 XP。
- 单次观察使用事件开始时的永久探索等级；该事件引发升级后，扩大半径从下一次观察生效。
- tile 首次揭示时，其中所有首版可见内容同步进入 WorldKnowledge。

### Frontier

一个 frontier 是同时满足以下条件的 tile：

1. 已 `Revealed`。
2. 角色圆可站立。
3. 可从当前已知空间到达。
4. 以其 tile center 为观察圆心时，至少覆盖一个 `Unrevealed` tile。

frontier 的导航目的地是 tile center。无目的地探索选择最小 `(routeCost, y, x)` frontier。

### 指定探索目的地

探索目的地是连续 `WorldPoint`：

- 目的地已经揭示、角色圆可站立且可达时，直接规划到该点。
- 目的地未知时，选择最小 `(routeCost + EuclideanLowerBoundToDestination, lowerBound, routeCost, y, x)` frontier；抵达并观察后重算。
- 目的地已经揭示且阻挡时，进入 `DestinationUnreachable`。
- 没有可达 frontier 时，进入 `NoReachableTargetOrFrontier`。

地图点击或叙事 `Lead` 只预填探索 destination。玩家确认后统一发送 `SetTask`；不存在 `SetExplorationDestination` command。

## 目标索取与交互

目标必须同时满足：

1. 所在 tile 已揭示。
2. 类型与当前 `TaskIntent` 匹配。
3. 当前可用。
4. 任务级永久等级、已装备工具和材料等 prerequisites 满足。
5. planner 可以到达其交互点。

系统先检查任务级 prerequisites。`MissingTool`、`MaterialsMissing` 或等级不足不能被误判为“没有目标”并触发自动探索。

planner `routeCost` 最低的候选获选；相同成本按稳定 `placement_id` 选择。有效目标在途中不因新发现的更近目标而改道。系统只在以下事件后重新索取：

- 目标失效；
- 一次 action 或击杀完成；
- `TaskIntent` 被替换；
- AutoExplore 首次发现合格目标。

AutoExplore 停止后，从全部当前已知候选中重新选择最低 `routeCost`。资源耗尽或敌人死亡后退出候选；刷新/复活后重新可用，并可以唤醒 waiting task。

资源和生产站的 interaction point 是 placement tile center。内容对象不阻挡角色，角色可以到达该中心。首版不增加 interaction radius 或 navmesh goal region。

狩猎目标按 enemy archetype 匹配。motion line 首次进入匹配敌人的 detection circle 时主动交战，不进行潜行判定。非匹配敌人按普通强制遭遇与潜行规则处理。

Production task 按固定顺序评估：

1. recipe、永久等级和 required equipment；
2. 材料；
3. 最近已知可达 compatible station；
4. 没有已知可达 station、但有 frontier 时自动探索；
5. station 和 frontier 都不存在时 `NoReachableTargetOrFrontier`；
6. 抵达 station 后执行周期，并在每周期结算后重检。

`station requirement` 为空的 handcraft recipe 在当前位置执行。

## 敌人、潜行与同时遭遇

- 首版敌人静止在自己的 placement point。
- T1 detection radius 为 `2 tiles`，即 `2048 nav units`。
- T2 detection radius 为 `3 tiles`，即 `3072 nav units`。
- `placement_id` 标识跨重生稳定的放置点。
- `spawn_cycle` 每次有效重生后单调加 `1` 并持久化。
- `encounter_instance_id = placement_id + spawn_cycle`。

地图知识与可用性使用 `placement_id`。潜行一次性判定、潜行 XP 去重和 combat RNG 使用 `encounter_instance_id`。

每个 encounter instance 只进行一次决定性潜行检查。成功后，该实例不再强制角色战斗；只有敌人死亡并进入新 `spawn_cycle` 后才形成新的检查资格。失败时，在首个满足 `(t-1,t]` swept-segment 相交条件的整数毫秒开始战斗。

敌人在角色已经处于 detection circle 内时复活，必须在该 respawn event 立即评估遭遇。多个敌人同刻触发时按 `encounter_instance_id` 选择一个；当前战斗结束后重新评估仍满足条件的敌人。

战斗暂停当前 motion leg。若 `TaskIntent`、目标和 prerequisites 未变且角色获胜，角色从精确交战位置继续剩余 path。任务、装备或目标变化时，丢弃旧 path 并重算。

## 中断、死亡与防锁死

### 任务与装备

- `SetTask`/`CancelTask` 始终原子替换或清除唯一 `TaskIntent`，包括战斗中。
- 当前 `CombatState` 继续；旧 task counter 在 command 成功时立即丢弃。
- 不保存 pending task、第二个 active intent 或 queue。
- 任务替换、取消或装备变化时，先物化当前连续位置，再取消当前 route 和未结算 action cycle，然后重评唯一任务。
- 被取消 action 不产生物品、XP 或材料消耗。

### 死亡

HP 到 `0` 时：

1. 立即结束战斗。
2. 令致死且仍存活的敌人恢复满状态。
3. 清除全部 temporary effects。
4. 物化精确死亡位置，并取消 motion/action。
5. 在该位置进入 `60s RespawnState`。

死亡期间 world time 和其他世界事件继续，但 dead player 不自然恢复 HP 或其他战斗资源。

等待结束后：

- 角色在精确死亡位置复活。
- HP 设为 `max_hp`；首版其他战斗资源若存在，则设为各自默认 respawn value。
- 保留装备、库存、永久技能、WorldKnowledge、唯一 `TaskIntent` 及其已完成数量。
- 从死亡位置重新规划并从头重评任务。

首版不设置营地传送、复苏点、尸体跑、掉落、耐久损失或其他死亡惩罚。

### RevivalGrace

复活后创建 `5s RevivalGrace` 系统状态，防止角色在同一非目标敌人 detection circle 中无限瞬时死亡：

- 非狩猎目标敌人不能在 grace 期间强制遭遇。
- 角色主动狩猎或主动进入战斗时，grace 立即结束。
- `5s` 到期时自动结束。
- 它不是 buff/debuff，不可叠加，也不受技能、装备或 effect modifier 影响。
- online、offline 和 reload 使用相同 world-time 截止时间。

## 起始内容与跨 chunk

- 营地与全部首阶段必要目标的中心点必须允许半径 `256 nav units` 的角色圆站立。
- 所有必要目标必须在完整 terrain 上由 weighted Theta* 从营地到达。
- 原点附近 chunk 按 `(Chebyshev ring, y, x)` 稳定顺序搜索，最大半径 `16 chunks`。
- 营地 tile 必须为 `Land`，`3×3 tiles` 邻域可通行，且其连通区域跨中心 chunk 和至少一个正交相邻 chunk。
- 首阶段内容位于营地周围 `3×3 chunks`；至少一个铜矿、T2 敌人和叙事碎片位于起始 chunk 外。
- 默认 seed 可以在创建存档前按确定性规则换 seed；玩家手动输入的 seed 不得静默修改。失败时拒绝创建并说明原因。
- 正常世界不保证人为制造不可达目标；不可达行为只使用 fixed fixture 验证。

## 存档与离线契约

存档至少保存：

- canonical fixed-point current `WorldPoint`；
- 当前 path 的 canonical `WorldPoint` 列表和 path index，或足以稳定重算的输入；
- current motion leg 的 start/end、start/end world time 与 accumulated weighted cost；
- 当前 destination/target identity；
- `RevivalGrace` 截止 world time；
- `RespawnState` 的精确死亡位置和截止 world time。

完整 path 是可失效 cache，不是 WorldKnowledge 的第二真源。加载时必须验证 path、目标与 `GAME_RULES_VERSION`；失效时从同一权威状态重算。

online/offline 使用同一 movement event、Theta*、line-of-sight、route cost、observation、target selection、encounter 和 tie-break。只有在批处理区间内不存在 tile crossing、观察、发现、敌人检测、effect 到期、entity/player respawn 或 action settlement 边界时，才允许合并推进。

chunk generation/loading 是基础设施等待。数据未就绪时不推进 `world_time_ms`；数据到达后从相同权威状态继续。

## 必测 fixture

1. 路径包含不是 `45°` 倍数的航向，且位置不吸附 tile center。
2. swept circle 不能擦过 `Water`/`DeepWater` 或穿阻挡角；负坐标边界结果一致。
3. 非均匀 terrain cost 的路径、候选选择和 ETA 使用同一成本。
4. 相同 seed/state 在线、离线、reload 和 replay 产生相同 path、事件时刻、揭雾和遭遇。
5. 跨 chunk 直线与 terrain cost 连续；chunk loading 等待不推进 world time。
6. 跨入新 tile 和 endpoint observation 不漏、不重复发 XP；升级后的半径从下一次 observation 生效。
7. motion segment 在首个覆盖相交事件的整数毫秒触发；同一 instance 潜行只判一次；同刻多敌结果稳定。
8. 战斗中换任务后不恢复旧 path；未换任务且获胜时从精确交战位置继续。
9. 死亡位置复活与 `RevivalGrace` 允许角色离开非目标敌人 detection circle；继续狩猎时可以立即主动重战。
10. 多目标同 route cost 时按 `placement_id`；搜索分片不能误报无路径。
11. production prerequisites 顺序与 no-target → AutoExplore 保持规定语义。
12. 工作区中不存在被替代移动方案的规范表述，且 `git status` 只有文档变化。
13. `roundDivNearestEven` 覆盖正负 `0.5` tie，并在两个方向都选择偶数结果。
14. 一条 motion 在 `1ms` 内穿过 detection circle，但前后整数毫秒采样点都在圆外；仍触发一次 encounter。
15. 覆盖相切 detection circle、circle 与 terrain boundary 同毫秒、同毫秒多敌和 `RevivalGrace` expiry 与 detection 同毫秒。
16. 跨 terrain factor 的 `positionAt(t)` 与 ETA 使用同一精确成本；reload 后在相同 world time 物化相同位置。

## Accepted 精确算术契约

- `dx/dy`、cost、ETA 和 world time 使用 `BigInt` 或等价精确整数。
- tile boundary parameter 使用约分有理数；比较使用交叉相乘，不转为 float。
- 欧氏长度使用 `ceilSqrt` 的 nav-unit 上取整。
- 连续相同 terrain factor 合并后才结算一个 subleg，避免人为多次向上取整。
- 每个 same-cost subleg 的 terrain cost 和总 ETA 使用整数 `ceil`。
- 多个 boundary crossing 量化到同一毫秒时，先按真实 rational crossing parameter，再按 `(y, x)`。
- 相同 route cost 的 target 仍按 `placement_id`；相同 search cost 的 open-set 顺序仍使用规范 tuple。
- 连续几何事件取 `ceil(exactElapsedMs)`；位置使用 `roundDivNearestEven`，不保存无理数交点。
- detection circle 使用 `(t-1,t]` swept-segment 与 exact squared-distance 比较，不使用解析平方根。
- 同毫秒多敌按 `encounter_instance_id`；circle/boundary 与其他系统事件按本文全局顺序处理。
- 不得逐帧使用 float 累加权威位置、成本或时间。
- 渲染插值可以使用 camera-relative float，但不能反馈到 gameplay engine。

精度 fixture 必须覆盖长斜线、切角、沿 tile boundary、正负坐标、正负 `0.5` ties-to-even、`1ms` 内圆穿越、相切 detection circle、circle/boundary 同毫秒、同毫秒多敌、grace expiry/detection 同毫秒、跨 terrain factor 的 `positionAt`/ETA、reload 一致性、跨 chunk、相同 route cost 和接近整数范围边界。协议已经封闭算术选择；剩余工作是通过 fixture 与 benchmark 验证，不是补充未定义语义。

## 明确排除

- 手动移动输入；
- navmesh、Recast/Detour 或第三方寻路 dependency；
- 动态障碍；
- 多角色 avoidance 或 crowd simulation；
- interaction radius/navmesh goal region；
- 移动技能、移速装备和移速 buff；
- terrain LOS 视野遮挡和迷雾回卷；
- 离线近似移动；
- 营地复活或复苏点。

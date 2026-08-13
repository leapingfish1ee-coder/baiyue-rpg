# 当前状态

审计基准：2026-08-13，依据当前工作区源码、测试入口和本地验证结果。

## 已实现

### 确定性世界与浏览器渲染

- Rust/WASM 是地形语义真源。`GENERATOR_VERSION` 为 `3`。
- 一个 macro cell 对应一个 `64×64` runtime chunk。`generate_chunk` 返回 `4096` 字节 `BaseTerrain` 和 `4096` 字节 `Decoration`。
- 地形结果只取决于 seed、生成器版本和绝对整数坐标。native/WASM anchor fixture 固定 seed `20260809`、起点 `WorldPoint(512,512)` 和校验和。
- `generator-worker.ts` 是 WASM 生成器边界。`ChunkManager` 有界调度 gameplay 与 render 请求，优先 gameplay 和可视中心，并按 epoch 丢弃过期结果。
- Canvas2D 保留完整静态地图能力。独立 `world-debug.html` 保留 WebGL2、纹理、光照和 Canvas2D 降级诊断；Lighting Lab 保持独立。

### 阶段 1 探索垂直切片

- gameplay worker 是 gameplay state、整数世界时间、command、离线快进和存档的唯一写入者。
- 纯 TypeScript engine 实现确定性营地 anchor、自由向量导航、swept-circle clearance、固定点移动、迷雾、探索经验和任务取消。
- 产品根是 map-first 探索界面。用户可以创建 seed 世界、持续探索、在地图或 Tile 坐标表单中选择目的地、确认任务和取消任务。
- 产品地图显示地形、永久迷雾、角色、路线和目的地。状态面板显示当前/最大生命、位置、活动、ETA、探索等级、XP、观察半径和已揭露格数。
- 产品界面不显示叙事、市场或多人入口。

### 阶段 2A 基础采集能力

- gameplay 内容层按绝对 `32×32 tiles` content cell 确定性放置 `wild_fiber` ambient candidate。placement hash 使用 seed、显式 `CONTENT_PLACEMENT_VERSION = 3`、prototype ID、营地 anchor 和绝对 cell 坐标，不修改 terrain payload；阶段 3A 的独立 enemy placement 不会移动已冻结节点，`GENERATOR_VERSION` 保持 `3`。
- 新世界 revision `1` 前验证三个稳定野生纤维保证节点。初始 observation 内至少发现一个节点；另外两个节点位于营地 Chebyshev 距离 `6..20 tiles`，并由既有 planner 证明可达。
- `TaskIntent` 的显式 `Gather` 分支支持 finite 或 continuous 任务。Worker 按已知 active 节点的权威 route cost 索取最近目标；同 cost 按 placement ID。没有已知有效节点时为原任务自动探索，不读取迷雾后 placement。
- `wild_fiber` 行动基础时间为 `6000ms`。Worker 使用 basis-point 速度公式提供权威 duration、remaining 和 bps；产品 UI 不重算。
- 一次成功行动原子结算节点耗尽、`fiber ×1`、采集 XP `6` 和任务计数。节点按 `60000ms` world time 重生并推进 spawn cycle。数量超过安全整数上限时 settlement 整体拒绝并暂停 simulation。
- 产品根保留 finite 或持续采集、采集等级与 XP、无容量纤维库存、已知资源 active/depleted/respawning 状态、任务路线、自动探索路线和底部活动。未知资源类型不进入 UI。
- online、offline 和 reload 复用同一 movement、observation、target acquisition、action、settlement 和 respawn 事件语义。每次在线或离线采集 settlement 都立即提交 core、dirty world chunks 和 meta。

### 阶段 2B 伐木与采矿垂直切片

- 内容层使用穷尽资源定义表发布 `wild_fiber`、`softwood_tree`、`surface_stone` 和 `shallow_copper_deposit`。四种资源保持固定 task、skill、等级、工具、duration、产出、XP 和重生映射。
- `TaskIntent` 保留显式 `Gather`、`Woodcut` 和 `Mine` 分支。三种任务复用同一资源执行 transition，不复制路线、行动或结算状态机。
- 新世界 revision `1` 前验证八个稳定 guarantee slot。初始 observation 内各有一棵软木树和一个地表石；`6..20 tiles` 环内各有一个冗余节点；浅层铜矿位于起始 chunk 外、营地周围 `3×3 chunks` 内、距营地 `64..96 tiles` 且可达。
- `softwood_tree` 使用 `10000ms`、`softwood ×1`、伐木 XP `10` 和 `120000ms` 重生。`surface_stone` 使用 `12000ms`、`stone ×1`、采矿 XP `12` 和 `120000ms` 重生。`shallow_copper_deposit` 要求 mining 5，并使用 `18000ms`、`copper_ore ×1`、采矿 XP `23` 和 `240000ms` 重生。
- 新世界已装备 tier 0、`0 bps` 的 `worn_axe` 和 `worn_pickaxe`。产品只提供 axe/pickaxe 的卸下与重新装备；已装备工具不同时保留在 inventory，系统不自动装备。
- 缺少工具时任务保留并进入 `MissingTool`。装备变化物化精确位置，取消 route 和未完成 action，再重新评估任务；取消周期不产生材料、XP、任务进度或节点变化。
- 产品根保留四种资源、三个资源任务、axe/pickaxe 装备、采矿等级锁定、MissingTool 和权威行动时间。阶段 2C 在这些边界上增加生产，不建立第二套资源执行器或装备槽。

### 阶段 2C 手工工艺与工具升级

- `TaskIntent` 增加显式 `Produce` 分支，支持 finite quantity 和 continuous production。生产复用唯一 gameplay worker、整数世界时间、事件推进器和立即 settlement commit。
- 内容表只发布 `rope`、`reinforced_axe` 和 `reinforced_pickaxe` 三个 handcraft 配方。三项配方从新世界开始已知；等级不足时 read model 显示锁定要求，Worker 拒绝低等级 command。
- `MaterialsMissing` 保留原生产任务和已完成数量，并显示全部材料缺口。等待不按时间轮询，不自动采集、购买或切换任务；加载、离线 claim 或库存变化事件会重新评估。
- 生产周期完成时，engine 在一个 transition 中重新验证并扣除全部 inputs，增加完整 output、Crafting XP、任务计数、event ordinal 和 revision。安全整数溢出时不写入部分结果。
- 新世界增加 Crafting 等级 1、XP 0。产品显示 Crafting 等级、XP、配方 input/output、基础与实际时间、固定 XP、手工标记、生产进度和活动状态。
- `reinforced_axe` 与 `reinforced_pickaxe` 是 tier 1 工具，分别要求 Woodcutting 2 和 Mining 2，并为对应行动提供 `+1000 bps`。装备复用 axe/pickaxe 原子 swap；等级不足时库存和原槽位不变。
- 技能等级 2 装备强化工具后，软木树和地表石行动的总速度均为 `1050 bps`。权威实际时间分别为 `9050ms` 和 `10860ms`；UI 只读取 Worker 字段。
- 产品根保留五项生活/探索技能、五种阶段 2C 材料、四件工具候选、两种工具槽、三项配方、MaterialsMissing 和有符号离线物品净变化。阶段 3A 在同一界面增加敌人、战斗和只读固定武器，不增加工作站、Smithing、铜刃、可更换战斗装备、叙事或配方解锁。

### 阶段 3A T1 狩猎与连续战斗

- 内容层使用独立 `ENEMY_PLACEMENT_VERSION = 1` 发布 `graymane_boar`。三个保证巢点追加在八个既有资源 guarantee slot 后；ambient enemy 每个绝对 `32×32 tiles` cell 最多一个候选，并排除营地 Chebyshev `0..20 tiles` 安全圈与既有内容占位。
- 敌人只有在巢点被永久迷雾揭露后才进入 WorldKnowledge、read model、遭遇判定和狩猎候选。`Hunt` 支持有限击杀数或持续执行；没有已知 active 目标时保留原任务并自动探索。
- 非狩猎 motion 首次进入威胁圈时使用 `GAMEPLAY_RANDOM_VERSION = 1` 的 FNV-1a/SplitMix64 独立随机域进行一次发现判定。成功潜行必须完整离开威胁圈才原子结算 Stealth XP `12`；同一 `placement_id + spawn_cycle` 不重复判定或发奖。
- 当前狩猎目标进入威胁圈后跳过潜行并强制进入一对一连续战斗。玩家固定使用只读 `worn_blade`；双方保留独立 attack deadline，同刻玩家先攻击。命中、无偏闭区间伤害、armor 和 micro-HP 恢复均使用确定性整数运算。
- 玩家生命在战斗之间持续保留，并按每 `10s` 最大生命 `1%` 自然恢复。战斗暂停 movement 或 non-combat action；任务、目标和 prerequisites 未改变时，胜利后从精确交战位置恢复剩余路径或行动时间。
- 击杀在一个 transition 中结算 enemy dead/`180000ms` 重生、Melee XP `30`、`raw_hide ×1` 和匹配 Hunt 计数，并要求立即提交。玩家死亡保留唯一任务，原地等待 `60000ms` 后满生命复活，并获得 `5000ms` 非狩猎 RevivalGrace。
- 产品根显示灰鬃野猪任务、Melee/Stealth、当前生命、只读破旧短刃、敌人状态、战斗双方生命和攻击 ETA、`raw_hide`、复活倒计时，以及离线击杀、死亡、复活和最终生命摘要。
- online、offline、reload 和备份复用同一事件引擎、四-store 存档和结算 transition；阶段 3A 没有在线专用战斗 tick 或第二套离线模拟。

### 本地存档、备份与离线

- `idb 8.0.3` 管理 IndexedDB。数据库使用 `meta`、`core`、`world_chunks` 和 `resume_claim` 四个无索引 store。
- `SAVE_SCHEMA_VERSION`、`GAME_RULES_VERSION` 和 `CONTENT_VERSION` 为 `5`；`GAMEPLAY_PROTOCOL_VERSION` 为 `2`，`DB_SCHEMA_VERSION` 保持 `1`。阶段 2C 存档与 protocol v1 不迁移；版本不匹配时保留原始导出和确认重置。
- Web Lock 限制同一 origin 只有一个 gameplay 写入者。锁成功且存档完成读取与校验后才启动在线计时。
- 新世界、`SetTask`、`CancelTask`、`EquipItem` 和 `UnequipSlot` 在 command accepted 前原子提交。在线 dirty state 最迟按 5 秒基线自动保存。
- command receipt 随 core 持久化。Worker 重启后，相同 command ID 与 payload 不重复修改状态；冲突 payload 被拒绝。
- 导出从一次 readonly materialization 生成 canonical JSON 与 SHA-256。导入在停止当前工作前完成解析、版本、关系和 checksum 校验，再用四 store 事务原子替换。
- 重置需要确认。导出、导入和重置入口位于产品 System 面板。
- 重载时创建 `resume_claim`。同一 gameplay engine 按整数时间快进，正向离线时间最多计入 `604800000ms`，完成事务同时提交 core/chunks/meta 并删除 claim。系统时间倒退时不回滚世界时间且不发放收益。
- 产品界面显示最近一次已提交离线报告，包括计入时间、丢弃时间、有符号非零 item delta、非空 skill XP 增量、揭露格数、目标/其他击杀、死亡/复活和最终生命。生产消耗、掉落和产出使用同一净变化列表。

## 未实现

- 工作站生产、Smithing、铜刃、T2 敌人和配方解锁；
- 已发布材料、生活工具、`raw_hide` 和固定 `worn_blade` 之外的物品、装备、掉落、容量和重量；
- 群战、敌人移动、主动战斗技能、可更换武器、防具、饰品、消耗品、远程和魔法；
- 叙事、Journal、Fact、Insight、Lead 和地标内容；
- 探索、采集、伐木、采矿、工艺、近战和潜行之外的技能；
- 手动角色移动、摇杆、navmesh、动态障碍和 crowd avoidance；
- 建筑、道路、河流、地下城、玩家编辑和多人/市场/服务器时间。

## 已知技术债

| 技术债 | 当前影响 |
|---|---|
| `168h` 浏览器性能 smoke 使用空闲存档验证 cap、claim 和提交；尚未完成固定 continuous-exploration fixture 的三次 median、peak heap 和 profile 记录 | 不能据此宣称 continuous 168h 已满足完整性能门槛 |
| backup classifier 尚未对每个深层 decimal、ID 和 coordinate 字段做表驱动专用错误分类 | 非法深层字段会被拒绝，但部分字段可能返回较宽泛的 `backup/invalid_shape` |
| 持久化测试保留基础 schema、锁、rollback、tamper 和 round-trip；未覆盖所有 quota、崩溃时点和 retry 故障注入组合 | 主路径已有浏览器证据，罕见故障恢复仍需补充专项测试 |
| 离线 fast-forward 会在每次资源 settlement 后写入可恢复 checkpoint；若浏览器恰在 claim 中途重启，最终状态与剩余 credited duration 正确，但本次离线报告只统计重启后的增量 | 权威状态不重复结算；报告可能少报 checkpoint 前已提交的材料、技能 XP 和揭露格数 |
| 阶段 2B 产品 E2E 固定验证两次伐木、工具中断与恢复、一次地表石采矿和 reload；continuous、铜矿产品路径与长时间重生未扩展为浏览器矩阵 | 核心 transition 使用同一 engine，placement/settlement 与 mining 5 铜矿由固定 engine fixture 覆盖；浏览器覆盖按实施包保持最小范围 |
| 阶段 2C rope 产品 E2E 在紧邻采集 settlement 时仍可能点击到 command busy 按钮；单条重跑曾通过，最终聚焦重跑未稳定通过 | 权威 engine fixture 的生产结算、Crafting XP、reload 和不重复结算通过；产品测试仍需改为等待按钮重新启用后再提交生产命令 |
| 阶段 3A 产品 E2E 固定验证发现灰鬃野猪、`Hunt ×1`、击杀结算和 reload；持续狩猎、死亡和完整潜行路径未扩展为产品浏览器矩阵 | 确定性 engine fixture 覆盖 placement、潜行、固定攻击 trace、精确 movement 恢复、死亡/复活、reload 和 online/offline 共用事件推进器 |
| 仓库完整 `npm run build` 的 WASM release 步骤受本机 Homebrew Rust 缺少 `wasm32-unknown-unknown` target 阻塞 | TypeScript strict、既有 generator-v3 WASM 的 Vite production build 和浏览器主路径可验证；本次未重新生成 release WASM，也未修改生成器或忽略产物 |
| 产品地图目的地表单使用 Tile 坐标并提交 tile center `WorldPoint` | engine 支持连续 `WorldPoint`，但当前产品表单没有 nav-unit 精确输入 |
| 调试路由仍包含在生产构建产物中，但产品根不显示其入口 | 诊断能力与产品 UI 已分离；若部署策略要求不可访问，需要增加构建环境 gate |

本页只描述当前实现。未实现项不构成界面占位或兼容承诺。

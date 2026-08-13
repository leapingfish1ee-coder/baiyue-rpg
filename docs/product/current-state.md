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
- 产品地图显示地形、永久迷雾、角色、路线和目的地。状态面板显示固定满生命、位置、活动、ETA、探索等级、XP、观察半径和已揭露格数。
- 产品界面不显示战斗、生产、未实现技能、叙事、市场或多人入口。

### 阶段 2A 基础采集能力

- gameplay 内容层按绝对 `32×32 tiles` content cell 确定性放置 `wild_fiber` ambient candidate。内容 hash 使用 seed、当前 `CONTENT_VERSION = 3`、prototype ID、营地 anchor 和绝对 cell 坐标，不修改 terrain payload；`GENERATOR_VERSION` 保持 `3`。
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
- 产品根显示实际发布的任务、四项技能、四种材料、实际持有工具、axe/pickaxe 装备、已知资源、采矿等级锁定、MissingTool 和权威行动时间。不显示其他装备槽、生产、敌人、战斗或叙事。

### 本地存档、备份与离线

- `idb 8.0.3` 管理 IndexedDB。数据库使用 `meta`、`core`、`world_chunks` 和 `resume_claim` 四个无索引 store。
- `SAVE_SCHEMA_VERSION`、`GAME_RULES_VERSION` 和 `CONTENT_VERSION` 为 `3`；`DB_SCHEMA_VERSION` 保持 `1`。阶段 2A 存档不迁移，版本不匹配时保留原始导出和确认重置。
- Web Lock 限制同一 origin 只有一个 gameplay 写入者。锁成功且存档完成读取与校验后才启动在线计时。
- 新世界、`SetTask`、`CancelTask`、`EquipItem` 和 `UnequipSlot` 在 command accepted 前原子提交。在线 dirty state 最迟按 5 秒基线自动保存。
- command receipt 随 core 持久化。Worker 重启后，相同 command ID 与 payload 不重复修改状态；冲突 payload 被拒绝。
- 导出从一次 readonly materialization 生成 canonical JSON 与 SHA-256。导入在停止当前工作前完成解析、版本、关系和 checksum 校验，再用四 store 事务原子替换。
- 重置需要确认。导出、导入和重置入口位于产品 System 面板。
- 重载时创建 `resume_claim`。同一 gameplay engine 按整数时间快进，正向离线时间最多计入 `604800000ms`，完成事务同时提交 core/chunks/meta 并删除 claim。系统时间倒退时不回滚世界时间且不发放收益。
- 产品界面显示最近一次已提交离线报告，包括计入时间、丢弃时间、非空 item 增量列表、非空 skill XP 增量列表和揭露格数。

## 未实现

- 生产、狩猎、工作站和配方；
- 已发布四种材料和两件工具之外的物品、装备、掉落、容量和重量；
- 敌人、潜行、战斗、伤害、恢复、死亡和复活；
- 叙事、Journal、Fact、Insight、Lead 和地标内容；
- 探索、采集、伐木和采矿之外的技能；
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
| 仓库完整 `npm run build` 要求 `wasm-pack 0.15.0`，本机 PATH 当前只有 `0.14.0` | TypeScript strict、现有 generator-v3 WASM 的 Vite production build 和浏览器主路径已通过；本次未重新生成 release WASM |
| 产品地图目的地表单使用 Tile 坐标并提交 tile center `WorldPoint` | engine 支持连续 `WorldPoint`，但当前产品表单没有 nav-unit 精确输入 |
| 调试路由仍包含在生产构建产物中，但产品根不显示其入口 | 诊断能力与产品 UI 已分离；若部署策略要求不可访问，需要增加构建环境 gate |

本页只描述当前实现。未实现项不构成界面占位或兼容承诺。

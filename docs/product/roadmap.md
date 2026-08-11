# 产品路线图

路线图表达推荐实施顺序，不等于发布日期或已实现承诺。完整产品行为以[需求索引](../requirements/index.md)为真源；所有明确数值都是需求中标记的 Accepted 首轮平衡基线。

## 阶段 0：守住世界与运行时契约

目标：让现有地形引擎具备可重复验证的基础。

- 增加固定 golden checksum fixtures，并对照 native 与 WASM 输出。
- 提交适用 lockfile，固定完整依赖图。
- 修复 Worker `pending` 生命周期、stale epoch 错误、并发上限、中心优先级和有界重试。
- 使用 camera-relative 或 chunk-local GPU 坐标，并定义端到端支持范围。
- 为接受的视觉契约增加冻结 `shaderTime` 的 screenshot golden。
- 上述生成门禁建立后，以版本化 `EdgeContract` 先实现河流，再评估道路和 POI；碰撞继续由独立语义层拥有。

完成标准见[验证标准](../engineering/validation.md)。

## 阶段 1：探索垂直切片

目标：交付第一个真实可运行的端到端 gameplay 闭环，而不是只建立水平模块。

设计状态：**Ready for implementation**。这表示产品与系统设计已经封板，不表示代码已经实现，也不免除 fixtures、benchmark 和专项 contract 验收。

- 创建本地世界，并以独立 gameplay worker 运行唯一权威 gameplay state 与 world time。
- 实现 Explore `TaskIntent`、Accepted 自由向量导航、永久迷雾、`Exploration XP` 和跨 chunk 自动探索。
- 实现 IndexedDB 单写入者、离线 claim、在线/离线同事件推进和 import/export/reset。
- 把产品根改为最小 map-first UI，并把现有 World Debug 工具迁到明确 developer 入口。
- 保持 terrain generator、streaming、Canvas2D/WebGL2 resilience 和 Terrain Sheet v3 无回归。

直接执行[阶段 1：探索垂直切片实施包](../engineering/phase-1-exploration-vertical-slice.md)。该包以 [Decision-0003](../decisions/0003-first-playable-slice-baseline.md) 为前提，并把 Accepted 移动、存档、离线和 UI 规范拆成可交付工作包。fixed-point fixtures、跨 chunk benchmark、serialization contract 和真实性能门槛不能通过简化语义绕过。

概念契约见[玩法状态边界](../architecture/gameplay-state.md)。

## 阶段 2：生活技能与任务扩展

阶段 2 的拆分顺序已确认。各子阶段必须继续复用阶段 1 的唯一 gameplay worker、`TaskIntent`、事件引擎、存档和产品 shell。

### 阶段 2A：基础采集垂直切片

设计状态：**Ready for implementation**。设计与参数已经封板，不表示代码已经实现。

目标：先用一个资源类型证明开放世界内容 placement、采集任务、行动结算、无容量库存、技能 XP 和 offline/reload 已形成真实闭环。

- 使用 absolute `32×32 tiles` content cell 和营地保证层放置野生纤维。
- 初始 observation 内保证一个已知节点，近营地保证两个额外可达节点，使 Task drawer 不需要显示未知类型。
- 在唯一 `TaskIntent` 中加入目标必填的采集任务，并复用路径成本目标索取与自动探索。
- 只加入 `fiber` 数量、采集技能、一次行动后耗尽和世界时间重生。
- 产品 UI 只增加 Task、Skills、Inventory 和地图资源状态所需的最小入口。
- 不进入伐木、采矿、生产、工具、装备、敌人、战斗或叙事。

直接实施包见[阶段 2A：基础采集垂直切片](../engineering/phase-2a-gathering-vertical-slice.md)和已接受的 [Decision-0004](../decisions/0004-gathering-content-placement.md)。

### 阶段 2B：伐木与采矿

状态：**Planned**。尚无实施包，也不表示已实现。

目标：在 2A 已验证的 resource placement、target acquisition、action settlement 和库存边界上增加工具型资源行动。

- 加入软木树、地表石和浅层铜矿内容。
- 加入伐木、采矿技能和对应 `TaskIntent` 分支。
- 加入本阶段实际使用的斧、镐和最小装备边界。
- 验证缺少工具的稳定等待、工具速度来源和不同资源重生。
- 不加入生产配方、工作站、敌人、战斗或叙事。

阶段 2A 完成验收后再起草阶段 2B 实施包，不在 2A 代码中预留空模块。

### 阶段 2C：生产与装备

状态：**Planned**。尚无实施包，也不表示已实现。

目标：在已有资源、库存和工具边界上加入首批生产链与可逆装备软专精。

- 加入锻造、工艺和生产 `TaskIntent`。
- 加入首批已确认配方、材料检查、handcraft 与 compatible station 索取。
- 加入生产周期原子结算和本阶段实际使用的装备槽与属性。
- 保持缺料等待，不自动采集、购买或切换任务。
- 不加入敌人、战斗、狩猎或叙事。

阶段 2B 完成验收后再起草阶段 2C 实施包，不提前建立配方或装备兼容层。

阶段 2 各子阶段继续服从[技能成长](../requirements/skill-progression.md)、[自动任务](../requirements/automation-tasks.md)、[探索与目标索取](../requirements/exploration.md)、[物品与装备系统](../requirements/item-equipment.md)和[玩法 UI](../requirements/gameplay-ui.md)。

## 阶段 3：近战、潜行与死亡闭环

目标：让敌人和战斗成为世界中的连续状态。

- 实现独立游戏事件随机域和一次性确定性遭遇判定。
- 扩展已有技能和任务 schema，加入 `潜行`、`近战` 与狩猎 `TaskIntent`；不另建第二套状态机。
- 实现狩猎目标强制战斗、非目标敌人侦测和潜行成功结算。
- 实现近战击杀经验包、掉落和伤害状态。
- 实现连续恢复、限时效果、死亡等待、精确死亡位置复活、致死敌人恢复和 Accepted 首轮 `RevivalGrace`。
- 实现战斗中 `TaskIntent` 立即原子替换、`CombatState` 继续和对应 UI。

真源见[战斗、潜行与死亡](../requirements/combat-stealth.md)。

## 阶段 4：离线等价范围扩展

目标：把阶段 1 已运行的离线事件引擎扩展到生活技能、敌人、战斗和死亡。

- 对任务、自由向量 motion、观察、目标重生、生产、遭遇、战斗、恢复、效果到期、死亡和复活进行同一套整数毫秒事件驱动推进。
- 保留既有离线预算、claim、停止条件和剩余时间待机规则。
- 生成可解释的回归报告。
- 验证相同初始状态与有效经过时间的在线/离线语义等价。
- 保持单机本地时钟边界，不预建服务器权威时间接口。

真源见[离线推进](../requirements/offline-progression.md)。

## 阶段 5：内容扩展与条件式专精

目标：只在基础闭环稳定后扩展技能和长期选择。

- 先扩展装备软专精；新增战斗方式端到端成立后，再实现按有效伤害贡献分配击杀经验包。
- `远程`、`烹饪`、`炼金`、`捕鱼` 只有在对应玩法端到端成立后才进入范围。
- `魔法` 必须先确认世界观和战斗资源设计，不预留空系统。
- 目标熟练度只有满足内容数量和选择价值门槛后才进入实现。
- 目标熟练度评估之后，才能评估训练计划、排行榜或称号；这些方向当前不是已确认需求。
- 异步交互、市场或多人需要独立立项和新的时间权威决策。

本阶段仍不引入职业锁定、多角色分工或现实时间被动训练。

# Decision-0003：接受首个端到端可玩切片设计基线

- 状态：Accepted
- 日期：2026-08-09
- 决策范围：首个端到端可玩切片
- 实现状态：尚未实现

## 决策

负责人已接受以下七份规范。它们共同构成首个可玩切片的实现与验收基线：

- [自由向量移动、导航、迷雾与目标索取](../requirements/movement-navigation-protocol.md)；
- [首个可玩区域内容与进度设计](../requirements/first-playable-region.md)；
- [战斗数值系统](../requirements/combat-numerics.md)；
- [物品与装备系统](../requirements/item-equipment.md)；
- [碎片叙事与线索簿](../requirements/narrative-cluebook.md)；
- [存档与离线结算协议](../requirements/save-offline-protocol.md)；
- [玩法界面信息架构](../requirements/gameplay-information-architecture.md)。

详细规则只由上述规范拥有。本记录不复制公式、内容表或 UI 字段，避免形成第二真源。

## 共同约束

- 地形生成、玩法内容、玩家世界状态、玩法规则、存档和渲染保持分层。
- 角色使用 fixed-point `WorldPoint` 和自动自由向量移动；首版不接受手动角色控制。
- weighted Basic Theta*、`roundDivNearestEven`、整数 `world_time_ms`、`(t-1,t]` swept-circle detection 和 same-time order 都是 Accepted 语义。
- 同时只有一个 `TaskIntent`；不接受 pending task、任务队列或自动改变玩家成长方向。
- 地形迷雾不能被目标索取、路径规划或 UI 穿透读取。
- gameplay worker 是玩法状态、离线推进和存档的唯一写入者；IndexedDB 是 gameplay save 的唯一持久化真源。
- 在线、离线、reload 和 replay 使用同一确定性事件语义和稳定随机域。
- 死亡在精确死亡位置复活；死亡期间不自然恢复，首版没有恢复期或冷却期。
- 玩法内容层不进入 terrain payload；内容、规则、存档和 generator version 分别治理。
- Accepted 规范是设计 Ready for implementation，不表示当前仓库已经实现 RPG 系统。

## Accepted 首轮平衡基线

观察半径、`60s` 复活等待、`5s RevivalGrace`、`168h` 离线上限、升级曲线、战斗/物品数值、内容持续时间、重生时间和区域内容数量均为 Accepted 首轮平衡基线。

调整这些数值时必须：

1. 记录调整依据与影响。
2. 更新对应需求、内容表和 fixtures。
3. 显式决定 `GAME_RULES_VERSION`、`CONTENT_VERSION` 或存档 schema 是否变化。
4. 不修改 `GENERATOR_VERSION`，除非 terrain bytes 发生变化。

有限样本和蒙特卡洛结果只提供平衡证据，不构成必胜保证或已完成体验证明。

## 首个切片明确排除

- 手动角色移动；
- 任务队列；
- 地下城、敌群或波次；
- 市场、多人或异步交互；
- 库存容量、搬运和装备耐久；
- 自动购买、自动换装和自动消耗品；
- 战后恢复期或冷却期。

这些内容不能以兼容层、空接口、隐藏状态或未启用 UI 预留进首版。

## 实现治理

Worker 字段、store keyPath、稳定 ID grammar、导入错误分类、正式世界观文案、视觉 token、fixtures、benchmark、可复现模拟和实际试玩结果，属于实现、内容与验证工作。各专项必须在相关编码或验收前把精确 contract 和结果写入 docs，但这些工作不重新打开已接受的产品方向。

MVP/demo 阶段若新规则与本基线冲突，负责人确认后直接修订真源并删除旧规则，不保留兼容层或双轨实现。

## 后果

- 阶段 1 设计可标记为 Ready for implementation。
- 工程专项可以按七份规范拆分实现与验收任务。
- 当前状态仍是确定性流式地形引擎 MVP；只有代码、测试和状态审计可以证明功能已实现。

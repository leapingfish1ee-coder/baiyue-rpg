# Baiyue RPG 文档总览

仓库文档是已确认产品需求、验收标准、架构契约和工程决策的真源。Accepted 规范可以进入实现，但不表示已经实现；实现状态只以源码、测试和当前状态审计为准。Codex 专项任务和 GitHub Issue 只记录执行状态，不替代仓库文档。

## 真源地图

| 问题 | 真源 |
|---|---|
| 项目为何存在、面向什么体验 | [产品愿景](product/vision.md) |
| 当前已实现、未实现和技术债 | [当前状态](product/current-state.md) |
| 下一阶段按什么顺序推进 | [路线图](product/roadmap.md) |
| 当前首个端到端实施包 | [阶段 1：探索垂直切片](engineering/phase-1-exploration-vertical-slice.md) |
| 当前采集实施包 | [阶段 2A：基础采集垂直切片](engineering/phase-2a-gathering-vertical-slice.md)（Implemented） |
| 已确认的玩法行为和验收标准 | [需求索引](requirements/index.md) |
| 首个可玩区域的内容与进度基线 | [首个可玩区域](requirements/first-playable-region.md) |
| 战斗属性、公式和首轮数值 | [战斗数值系统](requirements/combat-numerics.md) |
| 物品、库存、装备和掉落 | [物品与装备系统](requirements/item-equipment.md) |
| 碎片叙事、知识关系和线索簿 | [碎片叙事与线索簿](requirements/narrative-cluebook.md) |
| gameplay 存档、离线 claim 与事务恢复 | [存档与离线结算协议](requirements/save-offline-protocol.md) |
| map-first gameplay shell 与界面信息层级 | [玩法界面信息架构](requirements/gameplay-information-architecture.md) |
| 自由向量移动、导航、迷雾与目标索取 | [自由向量移动协议](requirements/movement-navigation-protocol.md) |
| 角色如何获得技能经验并形成专精 | [技能成长](requirements/skill-progression.md) |
| 离线期间如何推进与停止 | [离线推进](requirements/offline-progression.md) |
| 玩法状态如何向玩家解释 | [玩法 UI](requirements/gameplay-ui.md) |
| 任务、执行、战斗与存档状态如何分层 | [玩法状态边界](architecture/gameplay-state.md) |
| 系统边界与当前技术契约 | [架构总览](architecture/overview.md) |
| Terrain Sheet 文件格式 | [Terrain Sheet v3](specifications/terrain-sheet-v3.md) |
| 阶段 1 ID、Worker、存档、备份和性能 fixture | [阶段 1 运行时契约](specifications/phase-1-runtime-contracts.md) |
| 阶段 2A 内容、采集、行动与存档增量 | [阶段 2A 运行时契约](specifications/phase-2a-runtime-contracts.md) |
| 已接受的资源内容放置取舍 | [Decision-0004](decisions/0004-gathering-content-placement.md) |
| 本地开发和变更验证 | [开发说明](engineering/development.md)、[验证标准](engineering/validation.md) |
| 阶段 1 本地验证结果与未覆盖项 | [阶段 1 验证记录](engineering/phase-1-validation-record.md) |
| 阶段 2A 本地验证结果与未覆盖项 | [阶段 2A 验证记录](engineering/phase-2a-validation-record.md) |
| 已接受且需要长期保留的取舍 | [决策记录](decisions/index.md) |
| 竞品事实与可借鉴模式 | [可比游戏研究](research/comparable-games.md) |

源码和测试是“当前实现行为”的最终证据。文档与实现冲突时，不得静默选择其一：先把冲突记录为技术债，再由负责人确认是修正文档、修改实现还是更新需求。

## 文档结构

- `product/`：愿景、当前状态和路线图。
- `requirements/`：已确认玩法需求、Accepted 首个切片规范、验收标准和未来范围问题。
- `architecture/`：系统边界、数据流和实现契约。
- `specifications/`：稳定文件格式和协议规范。
- `engineering/`：开发环境、命令、验证路由，以及 Proposed 或 Ready for implementation 实施包。
- `decisions/`：Architecture Decision Record（ADR）。
- `research/`：外部参考事实，不构成本项目需求。
- `templates/`：新需求和 ADR 的最小模板。

## 维护规则

1. 每项事实只保留一个详细真源；其他位置使用摘要和链接。
2. README 只保留公开入口；`AGENTS.md` 只保留执行代理无法推断的硬性护栏。
3. 新需求先标记状态。只有负责人确认的内容才能写为“已确认”。
4. 不把路线图、研究启示或待决问题写成已实现事实。
5. 需求变化同步更新验收标准；架构取舍变化新增或替代 ADR。
6. 源码常量、命令、协议和尺寸变化时，同一改动必须更新对应文档。
7. MVP 不维护旧世界、旧协议或旧存档兼容，不添加迁移文档或兼容层。
8. 移动或删除文档后，检查所有相对 Markdown 链接。
9. MVP/demo 阶段的新需求一经确认并与旧规则冲突，直接修订真源并删除被替代的旧规则或旧候选；不增加需求兼容层。
10. Accepted 不表示已实现；实现状态必须由源码、测试和 `product/current-state.md` 证明。

新内容可从[需求模板](templates/requirement.md)或[决策模板](templates/decision.md)开始。

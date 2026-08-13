# 决策记录

Decision Record 保存待确认或已接受的产品与架构取舍。Proposed 记录只供评审，不约束实现；Accepted 记录才会约束后续实现。需求说明“系统必须做什么”，Decision Record 说明“哪些边界已被接受、哪些参数仍可调，以及改变时如何治理”。

| 编号 | 状态 | 决策 |
|---|---|---|
| [0001](0001-rendering-resilience.md) | Accepted | Canvas2D 拥有世界可用性，WebGL2 只拥有 enhanced visual pixels |
| [0002](0002-skill-task-system-baseline.md) | Accepted | 技能与任务系统设计基线；产品语义与首轮平衡参数分离 |
| [0003](0003-first-playable-slice-baseline.md) | Accepted | 首个端到端可玩切片设计基线；七份规范统一封板 |
| [0004](0004-gathering-content-placement.md) | Accepted | 阶段 2A 资源内容采用绝对 content cell 与营地保证层 |
| [0005](0005-resource-actions-and-tools.md) | Accepted | 阶段 2B 保留显式任务类别并共享资源执行器；只实现实际使用的斧与镐槽位 |
| [0006](0006-crafting-tool-upgrade-slice.md) | Accepted | 阶段 2C 只交付手工工艺与工具升级闭环；工作站和锻造延后 |

新增决策使用[决策模板](../templates/decision.md)。一般情况下，已发布决策变化时新增记录并标记 supersedes/superseded by。MVP/demo 产品需求例外：负责人确认新规则后，直接修订需求真源并删除旧规则，不为了旧需求增加兼容层；Decision Record 只保留仍有解释价值的取舍。

# 决策记录

Decision Record 保存已接受且会约束后续实现的产品或架构取舍。需求说明“系统必须做什么”，Decision Record 说明“哪些边界已被接受、哪些参数仍可调，以及改变时如何治理”。

| 编号 | 状态 | 决策 |
|---|---|---|
| [0001](0001-rendering-resilience.md) | Accepted | Canvas2D 拥有世界可用性，WebGL2 只拥有 enhanced visual pixels |
| [0002](0002-skill-task-system-baseline.md) | Accepted | 技能与任务系统设计基线；产品语义与首轮平衡参数分离 |
| [0003](0003-first-playable-slice-baseline.md) | Accepted | 首个端到端可玩切片设计基线；七份规范统一封板 |

新增决策使用[决策模板](../templates/decision.md)。一般情况下，已发布决策变化时新增记录并标记 supersedes/superseded by。MVP/demo 产品需求例外：负责人确认新规则后，直接修订需求真源并删除旧规则，不为了旧需求增加兼容层；Decision Record 只保留仍有解释价值的取舍。

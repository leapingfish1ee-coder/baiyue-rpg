# Decision-0004：阶段 2A 资源内容放置边界

- 状态：Accepted
- 确认日期：2026-08-11
- 决策者：项目负责人
- Supersedes：无
- Superseded by：无
- 关联实施包：[阶段 2A：基础采集垂直切片](../engineering/phase-2a-gathering-vertical-slice.md)

> 本记录已封板资源内容放置边界，但不表示阶段 2A 已经实现。实现状态仍只由源码、测试和[当前状态](../product/current-state.md)证明。

## 背景

阶段 1 已提供确定性地形、探索、迷雾、唯一 gameplay worker、持久化、离线推进和 map-first 产品壳。阶段 2A 需要在这些边界上加入首个真实资源行动，而不是建立第二套地图、任务、时间或存档系统。

已接受需求要求：

- 任务只能索取已知、类型匹配、当前有效、满足前置条件且可达的目标；
- Task drawer 的 target 只显示已知类型；
- 资源内容与 `8192-byte` terrain payload、terrain `GENERATOR_VERSION` 分层；
- 内容放置不能依赖访问顺序、容器遍历顺序、帧率或 gameplay 随机流；
- 资源必须位于 `Land` 且角色圆可以站立；营地保证的三个首阶段必要节点还必须从营地可达；
- 没有合格目标时，系统为原任务自动探索，不能读取迷雾后的目标。

因此，首个采集类型必须同时解决开放世界持续放置和新世界首次可选目标保证。

## 决策

采用“绝对 content cell + 营地保证层”。

1. ambient 资源使用绝对 `32×32 tiles` content cell。每个 cell 对每个 prototype 最多提供一个候选。
2. 候选身份和 cell 内位置只由 world seed、`CONTENT_VERSION`、prototype ID、营地 anchor 绝对坐标与绝对 content-cell 坐标决定。
3. content hash 和候选数据不进入 terrain payload，也不把 `GENERATOR_VERSION` 纳入 content 随机域。ambient candidate 只做有界的局部 eligibility：placement tile 是 `Land`、角色圆可站立且 interaction point 合法；不在 placement/materialization 时执行从营地或角色当前位置出发的全局路径搜索。不合格 ambient 候选不在同 cell 内随机重试。
4. 营地保证层在上述共同输入之外加入独立、稳定的 guarantee slot ID。初始 observation 半径内保证至少一个野生纤维节点；距营地 `6–20 tiles` 的保证环内至少放置两个额外节点。
5. 所有保证节点互不重叠，并与 ambient placement 去重。保证层只能从 `Land`、角色圆可站立且从营地可达的候选中按稳定顺序选择。
6. 放置搜索和 tie-break 不读取生成/访问顺序。相同 seed、版本、营地 anchor 和绝对坐标必须得到相同 placement IDs 与位置。

content candidate 与 terrain eligibility 的分层含义是：content 随机域不调用或复制 Rust 地形生成器；玩法层通过既有 terrain broker 请求候选点附近有界范围的已验证 `BaseTerrain`，并使用既有角色圆局部几何判断候选是否可以实例化。terrain bytes 改变时仍由 `GENERATOR_VERSION` 治理；内容规则改变时由 `CONTENT_VERSION` 治理。节点被 observation 揭露后，是否能从角色当前位置到达由现有 target acquisition/planner 在当前已知 terrain 上判断，不属于 placement 算法。

## 与现有 Accepted 真源的一致性

[首个可玩区域内容与进度设计](../requirements/first-playable-region.md#起点确定)规定，所有内容放置结果的输入包含营地 anchor 绝对坐标。本提案把该 anchor 保留为 ambient 与 guarantee 的共同稳定输入；ambient 再加入绝对 content-cell 坐标，保证层再加入稳定 guarantee slot ID。

该组合已消解早期版本与 Accepted anchor 输入之间的不一致，不需要修改 Accepted 真源。

## 方案比较

### 方案 A：只放营地附近固定节点

- 原理：只在营地周边写入少量固定资源位置，不生成开放世界 ambient 资源。
- 适用条件：仅适合一次性教程或有明确边界的小地图。
- 优势：起点保证直接，fixture 数量少，首次实现成本低。
- 风险与成本：离开营地后没有持续采集内容，无法支持开放世界持续任务、目标索取和长期探索。
- 决策结论：拒绝。该方案不能满足阶段 2A 的开放世界持续采集目标。

### 方案 B：每个 runtime chunk 独立随机

- 原理：以 chunk 坐标为随机域，在每个 `64×64` runtime chunk 内独立决定资源数量和位置。
- 适用条件：内容只按 chunk 加载，且不要求独立内容尺度、稳定跨边界分布或营地最低保证。
- 优势：容易接入现有 streaming，局部生成和缓存直接。
- 风险与成本：chunk 成为内容分布的人为边界；起点仍可能没有已知资源；边缘密度和长期版本一致性较弱；容易让 gameplay 内容错误绑定 terrain chunk 生命周期。
- 决策结论：拒绝。该方案不能单独封闭首次可选目标和内容层长期边界。

### 方案 C：绝对 content cell + 营地保证层

- 原理：ambient 层以营地 anchor 和绝对 `32×32 tiles` content cell 生成稳定候选；营地层在相同基础输入上按稳定 guarantee slots 补足首次观察与近营地冗余。
- 适用条件：内容放置与 terrain payload 分层，玩法层可以通过 terrain broker 做有界局部 eligibility，并把全局可达性留给已有 target acquisition/planner。
- 优势：同时支持开放世界持续放置、局部流式计算、访问顺序无关、独立内容版本和可测试的新手起点保证；content cell 不等同于 runtime chunk，也不要求从营地扫描无限世界。
- 风险与成本：必须定义稳定 placement ID、重复消解、负坐标 floor division、局部 eligibility、保证搜索上限和创建失败语义；普通 ambient 节点可能在 observation 后被证明不可达，必须作为知识保留但不能进入当前候选集；营地保证会形成独立于 ambient 的第二个 placement source，需要同一排序和去重规则。
- 决策结论：采用。

## 精确边界

- content cell 坐标使用绝对 tile 坐标的 Euclidean floor division：`cell = floorDiv(tile, 32)`。负坐标不得向零截断。
- 每个 cell/prototype 只有一个 candidate slot。候选 tile offset 来自包含 world seed、`CONTENT_VERSION`、prototype ID、营地 anchor 绝对坐标和绝对 content-cell 坐标的稳定 content hash。
- ambient materialization 只读取候选 interaction point 周围角色圆碰撞所需的有界 terrain，不查询从营地或角色位置到该点的 route。
- `6–20 tiles` 定义为营地 anchor 与 placement tile 的 Chebyshev tile distance。
- 初始保证节点不依赖距离近似；其 placement tile 必须确实由阶段 1 初始 observation 事件揭露。
- guarantee slot 在共同 content 输入上额外加入稳定 guarantee slot ID，并与 ambient slot 使用不同 purpose tag。排序使用规范整数坐标和稳定 placement ID，不使用 locale collation。
- 如果手动 seed 在既有 anchor 搜索上限内无法满足全部保证，创建世界必须拒绝并说明原因；不得静默替换 seed。默认 seed 按既有 Accepted 规则执行确定性重试。

## 后果

### 正面

- 初始 Task drawer 可以合法显示已知的野生纤维类型，不需要泄露迷雾后内容。
- ambient 内容可以跨 runtime chunk 持续存在，并拥有独立 `CONTENT_VERSION`。
- ambient placement 只依赖 content cell 和局部 terrain，可以随 streaming 按需计算，不产生跨无限世界的全局可达性扫描。
- 营地保证不需要改写 Rust generator 或 terrain bytes。
- placement 可以由 gameplay worker 在 online、offline 和 reload 中重建并验证。

### 负面

- 世界创建增加 content guarantee 验证步骤。
- 内容生成必须处理 ambient 与 guarantee 两种来源的稳定去重。
- `CONTENT_VERSION` 或 terrain version 改变后，MVP 会拒绝旧存档；本决策不提供迁移或兼容读取。

## 验证

实施至少证明：

- 固定 seed 与营地 anchor 在 native browser run 中得到相同 ambient/guarantee placement IDs 和坐标；
- 正负 content-cell 边界和 runtime chunk seam 不改变候选；
- ambient eligibility 只请求候选附近的固定有界 terrain；扩大已加载区域或改变营地到节点的已知路线不改变 placement；
- 初始 observation 后至少一个野生纤维类型已知；
- `6–20 tiles` 保证环内存在至少两个额外、distinct、可站立、可达节点；
- 一个已观察但不可达的 ambient 节点保留在 WorldKnowledge，并由 target acquisition 排除，不被 placement 层删除或重抽；
- 访问顺序、chunk 加载顺序和 reload 不改变 placement；
- terrain payload bytes 与 `GENERATOR_VERSION = 3` 保持不变。

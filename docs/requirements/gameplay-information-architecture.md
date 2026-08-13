# 玩法界面信息架构

- 状态：Accepted
- 决策者：项目负责人
- 确认日期：2026-08-09
- 适用范围：首个端到端可玩切片的 gameplay shell

> 本文已封板。map-first shell、stable waiting reasons、Worker/UI read model 和启动流程已实现阶段 1 至 2C 子集。战斗、死亡、叙事和完整 contextual drawer 尚未实现。

> [自由向量移动、导航、迷雾与目标索取协议](movement-navigation-protocol.md)已经 Accepted。相关 route、fog destination、target list 和 waiting action 直接按该协议实现；fixed-point fixture 与性能 benchmark 属于实现验收。

## 当前证据

审计基准：2026-08-13。当前详细事实见[当前状态](../product/current-state.md)。

- [`web/index.html`](../../web/index.html) 是 map-first 产品根，提供玩家状态、任务、技能、库存、装备、已知资源、存档和离线报告。
- 产品已发布 Explore、Gather、Woodcut、Mine 和 Produce，以及对应稳定等待原因。Journal、战斗和死亡 UI 尚未实现。
- World Debug 与 Lighting Lab 保持独立开发页面，产品根不显示 Debug 入口。
- 地图相机支持拖拽、WASD、滚轮和 zoom presets；任务表单为键盘用户提供非 canvas 路径。

正式玩法不能继续把功能叠加进 Debug panel。产品 UI 与开发工具必须分离。

## 路线与取舍

基线采用 map-first shell：地图永久作为主画布；常驻区域只展示角色生存、当前意图和当前执行状态；详细功能通过同一个 contextual drawer 打开。

### 不采用左右常驻三栏

技能、任务和库存长期占据左右栏可以提高信息密度，但会持续遮挡地图，弱化开放世界的空间感。

### 不采用纯地图 HUD

只用小型 HUD 无法承载技能里程碑、生产输入输出、装备比较、库存和线索关系。

### 不采用多浮窗桌面

自由浮窗会产生重叠、状态重复和额外的窄屏适配路径。

设计参考包括 IdleOn 的固定功能导航、Milky Way Idle 的任务进度可见性和 Outer Wilds 的关系图。Baiyue RPG 按自己的任务、地图和知识真源重新组织这些模式，不复制竞品布局。

## 产品 UI 与 Debug 分离

- production root 不渲染 `World Debug` panel、lighting/texture parameter controls 或 texture upload tool。
- 开发控件放到仅开发环境或明确 developer route，不能与 gameplay UI 共用状态组件。
- Lighting Lab 保持独立开发工具。
- gameplay Settings 不暴露 shader 参数。未来可以加入经过产品确认的显示开关，但本文不预设。
- 不保留“旧 Debug HUD 上叠玩法面板”的兼容布局。

现有 Debug UI 仍是当前实现事实。产品/Debug 分离是 Accepted 实现目标，但本次文档封板不删除现有工具，也不把目标写成现状。

## 信息层级

### Level 0：始终可见

- current HP / max HP；
- 当前 `TaskIntent`；
- 当前 `ExecutionState`；
- finite progress 或 continuous 标记；
- 当前动作、移动或攻击进度；
- 明确 waiting/error reason；
- 最近成功保存状态。

### Level 1：一次操作打开

- 任务设置；
- 当前选择的地图目标；
- 技能；
- 库存与装备；
- 线索簿；
- 系统与存档。

### Level 2：drawer 内查看

- 单项技能里程碑；
- 配方输入与输出；
- 装备属性比较；
- 敌人精确战斗估算；
- `Fact`、`Relation` 和 `Insight` 详情；
- 导入导出和存储诊断。

Level 2 内容不能常驻覆盖地图。

## 响应式语义布局

### 宽屏

| 区域 | 责任 |
|---|---|
| top status bar | 左侧角色 HP；中部位置或当前发现区域；右侧 save indicator 与 System menu |
| left navigation rail | Task、Skills、Inventory、Journal 四个主入口；Map 是默认背景，不设入口按钮 |
| center world viewport | 地图、路线、选择与反馈的主画布 |
| right contextual drawer | 同时最多打开一个功能或地图选择对象 |
| bottom activity bar | `TaskIntent`、`ExecutionState`、progress/timer 与 contextual primary action |

drawer 打开时地图仍可见、可平移。`Esc` 或再次点击当前入口关闭 drawer。

### 中窄布局

- 中宽度保留 navigation rail，drawer 覆盖部分地图。
- 窄宽度使用 bottom navigation 替代 rail，drawer 变为 bottom sheet。
- 同一时间只打开一个 drawer/sheet。
- 地图、任务、技能、库存和线索语义不随 breakpoint 变化。
- MVP 先验证 desktop/tablet；窄屏必须能查看状态、设置任务、装备和阅读线索，但不要求同时显示地图与详情。

具体像素 breakpoint 属于实现和视觉测试参数，本文不指定。

## Top status bar

始终显示：

- HP bar 与数字；
- 世界/区域名称，未知时显示“未命名区域”，以及可选当前位置；
- `SaveState: saving | saved | error | local-only`；
- System 按钮。

正常 saved 状态应低干扰。Top bar 不显示全部技能等级、资源总数、generator version 或 FPS。

## Bottom activity bar

Bottom activity bar 是最重要的常驻 gameplay 组件。

### 普通状态

- Task label，例如“伐木｜软木”；
- finite progress，例如 `7/20`，或“持续”；
- Execution label，例如“前往目标”“自动探索”“执行伐木”“等待材料”；
- 当前事件进度条与 remaining time；
- 当前 motion leg 使用 planner ETA；地图路线可以是任意角折线，不能显示为 tile-center 步进；
- Cancel 或 Edit Task。

### 战斗状态

- 当前任务继续作为次级信息显示；
- 玩家与敌人 HP；
- 双方下一次攻击倒计时；
- 敌人名称或类型；
- 狩猎 progress；
- 不显示逃跑按钮。

### 复活状态

- “等待复活 `00:42`”；
- 精确死亡 `WorldPoint`；
- 原任务及已有进度。

复活后若 Accepted 首轮平衡基线 `5s RevivalGrace` 仍有效，状态栏以低干扰方式显示其剩余时间和“仅阻止非狩猎目标敌人强制遭遇”的范围。它不是 buff、无敌或战后恢复期。

### 完成与等待

- 任务完成时只显示一次 toast，并把 bar 改为“任务完成｜原地待机”。
- waiting 必须显示 stable reason 和允许的人工动作，不能只显示泛化“失败”。

## Task drawer

Task drawer 使用单表单，不使用多页 wizard。

共同字段：

1. category：探索、采集、伐木、采矿、生产、狩猎。
2. target：除探索外必填；只显示已知类型，也可以显示已发现但当前没有有效实例的类型。
3. quantity：正安全整数；空白表示持续。
4. requirement/preview：技能等级、工具、配方材料、工作站、风险或目的地。
5. primary submit：开始任务，或替换当前任务。

### 探索

- 选择“持续探索”，或预填地图 destination。
- 玩家可以点击 fog coordinate。系统语义是向该位置方向逐步探索当前已知 frontier，不能读取迷雾后 path 或 target。
- 选择 exact `Lead` 可以预填 destination，但仍需提交确认。

自由向量目的地与 frontier 排序见[移动协议](movement-navigation-protocol.md#指定探索目的地)。玩家仍必须提交 `SetTask`，UI 不能读取迷雾后 terrain 或 target。

### 生产

- target 是 recipe。
- 显示每周期输入/输出、当前库存、finite quantity 对应的完整周期数和预计总输入。
- 材料不足仍可提交，并明确说明任务会进入等待。
- 显示所需的已知工作站。
- preview 按 recipe/level/equipment → materials → compatible station 的固定评估顺序展示；handcraft recipe 的 station requirement 为空。

### 狩猎

- target 是已知 enemy archetype。
- 显示双方 hit chance、应用当前护甲后的 damage range、interval、expected DPS、incoming DPS 和当前 HP 风险。
- 估算必须标记为 estimate，不能显示“必胜”或“安全”。
- quantity 空白表示持续狩猎。

战斗字段由 gameplay worker 按已接受的[战斗数值系统](combat-numerics.md)提供。UI 不重新计算公式。

### 替换

- 已有任务时，submit 文案明确为“替换当前任务”。
- 旧任务已有 finite progress 时，确认框只说明旧 task counter 会丢弃；已结算的物品、XP 和 knowledge 不回滚。
- 战斗中提交 replacement 或 cancel 时，command 立即原子替换或清除唯一 `TaskIntent`，并立即丢弃旧 counter；UI 同时说明当前 `CombatState` 继续，战斗结束或复活后执行当时唯一 intent。
- UI 不显示 pending task，不维护第二个 active intent，也不把 replacement 表现为 queue。
- 不提供 queue、schedule 或 conditional actions。

## Map

- 已揭露 terrain 是主层；fog 不显示 target details。
- 可见层包括 player、已知 target、active route、selected destination 和 known `Lead`。
- 点击 known target 打开 Target inspector。
- 点击 fog 或 known coordinate 打开 Location inspector，并可预填探索 destination。
- inspector action 只能查看详情或“预填探索 Task drawer”，不能单击立即改变任务。
- current route 必须区分前往任务目标、为任务自动探索和玩家探索 destination。
- current route 按任意角 `WorldPoint` 折线显示；ETA 使用 gameplay worker 提供的 planner route cost，UI 不按欧氏直线或 tile 数重算。
- known but unreachable target 保留在 `WorldKnowledge`，并显示不可达状态和原因。
- 提供 Center on Player；camera 可以与角色分离。
- 不显示无限世界 completion percentage。
- Task drawer 提供 nearby known targets 的 list/form 替代，不能要求玩家只能点击 canvas。

## Skills drawer

按 World、Gathering、Production 和 Combat 分组显示八项技能。

每项显示：

- level；
- current/next XP；
- 当前技能效果；
- 下一 milestone；
- 最近解锁。

详情显示已解锁 targets/recipes/equipment、当前 level-derived bonus 和来源。未来内容不以空树或灰色图标提前展示。界面没有 talent tree、skill points、virtual levels 或全局“战力”。

## Inventory 与 Equipment drawer

宽屏可以在同一 drawer 内使用两列；窄屏使用 Inventory/Equipment tabs。

### Inventory

- material/equipment filters；
- item name 与 quantity；
- known sources/uses；
- 不显示 slots、weight 或 capacity。

### Equipment

- `weapon`、`body`、`accessory`、`axe`、`pickaxe` 五槽；
- 选择候选时显示 exact before/after modifier diff；
- 战斗中禁用控件并说明原因；
- 不提供“最佳装备”、auto-equip 或 loadout。

任务缺工具时，reason action 可以打开 drawer 并定位对应工具，但玩家必须点击 equip。完整现行语义见[物品与装备系统](item-equipment.md)。

## Journal drawer

- Thread list 位于左侧或上方；主体是 fixed-layout relation graph；详情显示 `Fact` 或 `Insight`。
- 只显示 known nodes，不显示 undiscovered count。
- `Thread` 只显示 `open`/`resolved`，不显示百分比。
- `Fact` 显示 `observed`/`recorded`；`Insight` 显示 `inferred` 及依据。
- `Lead` 提供 map view 和“预填探索任务”，不直接启动。
- unread badge 不影响进度。
- 窄屏可以在 Thread list → graph → detail 间层级导航，但状态真源不变。

叙事数据与关系规则见[碎片叙事与线索簿](narrative-cluebook.md)。

## Offline processing 与报告

启动阶段按以下顺序：

1. acquiring exclusive save lock；
2. loading/validating save；
3. processing offline claim，并显示 credited time 与分片进度；
4. committing new revision；
5. `ready`，并显示 offline report。

只有 commit 成功后，才能显示最终报告并进入 `ready`。

报告信息优先级：

1. 最终 Task/`ExecutionState` 和停止原因。
2. raw elapsed、credited elapsed 和 discarded cap time。
3. deaths、levels、new Facts/Insights/Leads。
4. item、kill 和 XP aggregate。
5. committed revision 与 save time。

- 不显示逐攻击或逐行动日志。
- 没有实质变化时显示 compact report。
- 报告可以关闭，并在 System 中重新查看最近一次。
- 离线叙事发现统一列在报告中，不连续弹出 modal。
- storage failure 显示 blocking error，不能进入可变更 gameplay 状态。

claim 与 commit 真源见[存档与离线结算协议](save-offline-protocol.md)。

## Notifications

Toast 只用于：

- task completed；
- level up；
- first discovery 或 new `Insight`；
- death/respawn；
- save error。

重复资源、普通击杀和每次攻击不显示 toast。同一批离线事件聚合展示。Event log 只保留结算级摘要，可以截断，不是 save recovery source。

## Waiting reason contract

UI 使用 stable code 与 localized params，不能依靠任意错误字符串：

| code | 必需参数或语义 |
|---|---|
| `MaterialsMissing` | 缺少的 item 与 quantity |
| `MissingTool` | tool type 与 tier |
| `NoKnownTarget` | 正常应转为 auto-explore，而不是 waiting |
| `NoReachableTargetOrFrontier` | 没有可达目标或 frontier |
| `DestinationUnreachable` | 目的地已被证明不可达 |
| `TaskCompleted` | 有数量任务已完成并待机 |
| `storage_write_failed` | 存档事务失败，阻塞模拟 |
| `incompatible_save` | 必需版本不匹配 |
| `active_in_other_tab` | 另一个标签页持有 save lock |
| `integrity/quantity_overflow` | 结算会超过 `Number.MAX_SAFE_INTEGER`；阻塞并暂停模拟 |
| `undefined_failure` | 必须包含 diagnostic ID；产品 UI 显示“无法继续”，developer UI 显示详情 |

UI 不自行推断 reason。gameplay worker read model 提供 code、params 和 allowed actions。

chunk generation/loading 或分片 path search 尚未完成属于基础设施处理中，不是 `NoReachableTargetOrFrontier`。UI 可以显示处理进度，但该等待不推进 `world_time_ms`，也不能把未完成搜索表示成“无路径”。

## Worker/UI contract

main thread 不计算 gameplay outcome，也不重新实现公式。

涉及完整世界坐标的 read model 使用 canonical decimal strings。main thread 只把已 rebased 的 camera-relative 数值交给 renderer，并可以在两个权威 read model 间做显示插值；插值位置不能回传 gameplay worker，也不能用于 command、autosave 或 snapshot。

read model 至少提供：

- `PlayerSummary`；
- `TaskSummary`；
- `ActivitySummary`；
- `CombatSummary`；
- `MapSelectionSummary`；
- `SkillSummaries`；
- `InventorySummary`；
- `EquipmentSummary`；
- `JournalSummary`；
- `SaveSummary`。

commands 至少包含：

- `SetTask` / `CancelTask`；
- `Equip` / `Unequip`；
- `MarkNarrativeRead`；
- `ExportSave` / `ImportSave` / `ResetSave`。

地图点击、Target inspector 或 `Lead` 只能在 UI 内预填一个 exploration `TaskIntent`。玩家明确提交后统一发送 `SetTask`；不存在独立 `SetExplorationDestination` gameplay command。所有 command 返回 `accepted | rejected` 与 stable reason；UI 只格式化返回值。

协议的精确字段、command 幂等性、request ID 和错误恢复仍待实现前形成版本化 contract。

## 新世界与启动页

没有 save 时显示最小创建页：

- 产品名称；
- “新建世界”；
- seed 默认自动生成；advanced 展开后可以手动输入 unsigned 64-bit seed；
- 本地存档和浏览器清理说明；
- 创建按钮。

第一份 save transaction 成功后，才进入地图。已有 save 默认进入 lock → load → offline 流程。System 提供 export、import 和 reset；reset 必须明确确认。

## 可访问性与输入

- 所有核心动作都可以使用键盘和表单完成；canvas 不是唯一入口。
- 首版不提供 WASD、摇杆、点击地面即时移动或其他手动角色控制；现有 WASD 只控制 Debug 地图相机，不是 gameplay command。
- 建议快捷键：`T` Task、`K` Skills、`I` Inventory、`J` Journal、`Space` Center Player、`Esc` Close。
- 文本输入聚焦时，不劫持快捷键。
- 进度条提供文本与 `aria-valuenow`；状态不只用颜色表达。
- focus order 与 drawer visual order 一致。
- drawer 打开后管理焦点，关闭后把焦点归还触发按钮。
- 尊重 `prefers-reduced-motion`；动画不承载唯一状态信息。

touch target、字号和具体视觉 token 属于后续视觉规格。

## 开发诊断

production gameplay UI 只显示可行动错误。developer UI 可以查看：

- generator/content/rules/save versions；
- chunk/pending counts；
- deterministic IDs/event ordinals；
- canonical `WorldPoint`、motion leg、path index、route cost、rational boundary crossing 和整数 event time；
- save revision/claim；
- renderer mode/shader controls。

developer UI 必须通过明确 dev gate 打开，不能与 System settings 混合。

## 明确排除

- 任务队列和快捷自动策略；
- 全局资源常驻栏；
- 多窗自由布局；
- 聊天、公会、市场和排行榜；
- 多角色切换；
- 技能树；
- 装备推荐和自动换装；
- 自动材料获取；
- 世界完成率；
- 逐帧战斗日志；
- production shader controls。
- 手动角色移动和 navmesh 调试入口。

## 验收标准

- 不打开 drawer 也能判断角色意图、执行状态、HP、进度和等待原因。
- 所有六类任务都能在一个 drawer 中完成设置。
- 地图点击只预填或查看，不能绕过玩家确认直接换任务。
- 战斗和死亡期间仍能看到原 `TaskIntent` 与 progress。
- 战斗中的 task replacement 立即更新唯一 intent，界面不存在 pending/active 双任务。
- waiting reason 显示明确缺失条件和 allowed actions。
- Skills、Inventory 和 Journal 不重复保存 gameplay state。
- 键盘用户不依赖 canvas 就能设置已知目标任务。
- offline report 来自已经提交的结算摘要。
- production UI 不显示 debug shader、seed 或 chunk controls；seed 只出现在新世界 advanced 区域。
- 窄屏复用相同组件和 command，不建立第二套业务语义。
- UI 不计算命中、伤害、材料或任务结果，只展示 gameplay worker read model。
- save error、second tab 和 incompatible save 都阻止第二份权威模拟。
- quantity overflow 显示稳定 integrity error 并暂停模拟，不把丢弃物品包装成成功结算。
- route 可以显示任意角航向，但不提供手动移动；UI 不计算 Theta*、route cost、ETA、观察范围或 detection-circle intersection。
- motion、command、autosave 和 snapshot 显示的位置来自同一整数 world time 的 canonical `positionAt(t)`，不使用 renderer 插值状态。

## 实现、视觉与验证工作

- UI/Worker 专项须在编码前补齐 stable waiting reason code、localized params、allowed actions，以及 read model/command protocol 的精确字段、版本和幂等性。
- 视觉专项须确定 desktop/tablet/narrow breakpoint、drawer 尺寸、视觉 token，以及任意角 route、known/unreachable target、`Lead`、精确死亡位置和 `RevivalGrace` 的视觉编码。
- 战斗 UI 必须使用 worker 按 Accepted 战斗公式给出的估算值；专项须记录精度、取整和风险文案，不能显示必胜保证。
- 离线 UI 专项须定义时间片反馈、compact report 判定和最近报告保留范围。
- 开发工具专项须实现明确 developer route/dev gate、production build exclusion 和测试方式，不能把 shader/debug controls 混入产品 Settings。
- 可访问性专项须验证快捷键冲突、焦点管理、screen reader、窄屏流程和 reduced-motion fixtures。
- 导航专项须完成 fixed-point fixtures 与 benchmark；这些验证不改变本信息架构的 Accepted 状态。

# 存档与离线结算协议

- 状态：Accepted
- 决策者：项目负责人
- 确认日期：2026-08-09
- 适用范围：单机浏览器 MVP 的 gameplay persistence 与离线恢复

> 本文已封板。IndexedDB、`idb`、gameplay worker、Web Lock、store 边界、offline claim、自动保存和导入导出均为 Accepted 架构，不是已实现事实。实现时仍须重新核对 `idb` 正式版本、TypeScript types 和 Web Worker 支持，并精确 pin 依赖与 lockfile。

> [自由向量移动、导航、迷雾与目标索取](movement-navigation-protocol.md)已经 Accepted，并封闭 weighted Theta*、fixed-point motion、整数毫秒量化和同刻事件顺序。offline/reload fixture 与性能 benchmark 属于实现验收工作。

## 当前证据

审计基准：2026-08-09。

- [`web/package.json`](../../web/package.json) 只有 TypeScript、Vite 和 Playwright devDependencies，没有 production dependency。
- 当前 `localStorage` 只保存 Terrain Sheet、texture/shader、lighting 和面板偏好；见[当前状态](../product/current-state.md#未实现)。仓库没有 gameplay persistence。
- [`generator-worker.ts`](../../web/src/generator-worker.ts) 是现有 WASM terrain generator 的唯一调用桥接。
- [`ChunkManager`](../../web/src/chunk-manager.ts) 只维护内存 chunk cache 和生成请求生命周期。
- 当前没有 IndexedDB、Web Locks、BroadcastChannel 或 gameplay worker 实现。

`localStorage` 是同步、字符串型 Web Storage。平台文档给出的通用上限是每个 origin 最多约 `5 MiB` local storage；具体可用空间仍受浏览器策略影响。无论容量如何，它都不提供本协议需要的跨 object-store 事务，因此不作为 gameplay save。

## 存储路线

基线采用：

```text
IndexedDB
+ idb Promise/TypeScript wrapper
+ 事务快照
+ chunk-scoped dirty records
+ 一个 resume claim journal
```

### 不采用 `localStorage` gameplay JSON

`localStorage` 同步阻塞，只保存字符串，容量有限，也没有跨记录事务。随着 `WorldKnowledge` 和 chunk-scoped 世界状态增长，单个 gameplay JSON 会放大序列化、写入和故障恢复成本。

### 不采用 OPFS

当前存档是需要按 record 与 transaction 更新的结构化状态，不是大型文件或流式二进制资产。OPFS 没有提供本阶段必须使用的优势。

### 不采用完整 event sourcing

保存全部事件会引入无限日志、完整重放、事件 schema 演进和压缩治理，而当前需求只需要可靠恢复到最新已提交状态。

### 采用混合快照

`core` 保存小型权威快照，`world_chunks` 只更新 dirty chunk records，`meta` 指向同一事务提交的 revision。`resume_claim` 只保护一次离线区间，不能扩展为完整事件日志。

[`idb` 官方仓库](https://github.com/jakearchibald/idb)把该库描述为约 `1.19 kB` brotli 的 IndexedDB Promise 薄封装，并提供 TypeScript schema typing。实现时优先评估 `idb`，精确 pin 当时的稳定版本；不得根据本文日期猜测版本，也不得自行重写 Promise wrapper。

## 权威边界

```text
validated player commands
          │
          ▼
 gameplay worker ──► deterministic gameplay engine
      │                         │
      │                         ├─ online event advancement
      │                         └─ offline event advancement
      ▼
 IndexedDB gameplay save
      │
      └────────► read model ─────────► main-thread UI/rendering

 generator worker ──► terrain WASM ──► terrain payload/cache
```

- 新的 gameplay worker 是玩法状态、`world_time_ms`、事件顺序、离线快进和 gameplay save 的唯一写入者。
- main thread 只发送经过边界验证的玩家命令，并渲染 read model；它不直接修改 gameplay state。
- generator worker 继续是唯一调用 terrain WASM 的组件。gameplay worker 不复制 terrain generation。
- gameplay engine 必须是不依赖 DOM、渲染帧或 Worker API 的确定性事件模块；gameplay worker 在线和离线共用该模块。
- texture、lighting 和面板设置继续作为非关键 `localStorage` preferences，与 gameplay save 分离。
- IndexedDB 可以从 Web Worker 异步访问。storage 和 simulation 都不应阻塞 UI thread。

## 单存档与多标签页

- MVP 只有一个 active local save。
- gameplay worker 必须持有一个 origin-scoped exclusive Web Lock，例如 `baiyue-rpg:active-save`。
- 第一个标签页取得锁后，才加载存档并启动模拟。
- 其他标签页不能启动第二个模拟器或写入存档，只显示“此存档已在另一个标签页运行”。
- 只读标签页可以使用 `BroadcastChannel` 接收锁释放通知，并允许玩家手动重试。
- 首版不实现多标签合并、last-write-wins 或 leader fallback。
- Web Locks 不可用时显示不支持错误。MVP 不使用 `localStorage` lease 兼容回退。

Web Locks 是 secure-context API，作用域为 origin，并可在 worker 中使用。GitHub Pages 支持 HTTPS；`localhost` 和 loopback 地址在现代浏览器中属于 potentially trustworthy origins。实现仍必须使用 feature detection，不能只根据 URL 假设 API 可用。

## 独立版本

存档分别记录：

| 版本 | 责任 |
|---|---|
| `DB_SCHEMA_VERSION` | IndexedDB object store 与 index 结构 |
| `SAVE_SCHEMA_VERSION` | 序列化 gameplay state 契约 |
| `GAME_RULES_VERSION` | 任务、战斗、世界时间和公式语义 |
| `CONTENT_VERSION` | 玩法内容放置、物品、敌人、配方和叙事定义 |
| `GENERATOR_VERSION` | terrain bytes |

这些版本不能互相代替。技能平衡、物品定义或叙事内容变化不得触发 terrain `GENERATOR_VERSION`。

MVP/demo 不保留旧存档兼容。任一必需版本不匹配时：

1. 拒绝加载。
2. 不自动迁移、不兼容读取，也不回退旧规则。
3. 允许导出原始存档。
4. 只有玩家明确确认后，才删除旧存档并新建。

系统不得自动删除不兼容存档。

## IndexedDB stores

### `meta`

- `save_id`；
- `current_revision`；
- `created_wall_clock_ms`；
- `committed_wall_clock_ms`；
- `committed_world_time_ms`；
- 五项独立版本；
- integrity metadata。

### `core`

- `save_id`；
- player state；
- inventory 与 equipment；
- skills；
- 唯一 `TaskIntent` 与 progress；不保存 pending task 或 queue；
- `ExecutionState`；
- `CombatState`；
- `RespawnState`；
- `RevivalGrace` 的 world-time 截止点；
- active effects；
- gameplay seed 与 event counters；
- core narrative 的 `known_fact_ids`、known relation/insight/lead IDs 与 read state。

物品字段遵守[物品与装备系统](item-equipment.md)，叙事字段遵守[碎片叙事与线索簿](narrative-cluebook.md)。存档实现专项必须在编码前把这些边界落实为精确 store fields，并更新本文或独立 schema 规范。

### `world_chunks`

- canonical chunk key；
- revealed fog bitset；
- 使用 `placement_id` 的 known target/content source IDs；
- mutated generated entity state，包括 `placement_id`、单调 `spawn_cycle`、depleted/dead 与 `next_available_world_time`；
- 叙事来源对应的已知或已改变 world content source state。

`world_chunks` 不保存或复制 Fact known flag。Fact 是否已经触发只读取 core `known_fact_ids`。敌人的 `encounter_instance_id` 由 `placement_id + spawn_cycle` 构成，不作为跨重生稳定地图 identity。

### `resume_claim`

最多保存一个 pending offline claim：

- base revision；
- from wall clock；
- target wall clock；
- credited duration；
- processing status 与 diagnostics。

一次 save commit 必须在一个 IndexedDB `readwrite` transaction 中写入 `core`、全部 dirty `world_chunks` 和 `meta` revision。事务成功前，旧 revision 仍是权威状态。禁止先更新 `meta` pointer，再分散写入其他状态。

## 不持久化的状态

- terrain chunk byte payloads；它们由 seed、`GENERATOR_VERSION` 和 coordinates 重建；
- Canvas/WebGL surfaces、GPU resources 和内存 chunk cache；
- camera、hover、panel open/closed 等 UI 临时状态；
- pending worker requests、request IDs 和 render frames；
- 不影响恢复结果的冗余 path/query cache；
- 无限事件日志。

自由向量状态保存 canonical fixed-point `WorldPoint`，以及 current path/path index 或足以稳定重算的权威输入。current motion leg 保存 start/end、start/end world time、累计 weighted route cost 和 path index。non-combat action 保存 current action 与 remaining time。`RespawnState` 保存精确死亡 `WorldPoint` 与复活截止时间；`RevivalGrace` 保存截止 world time。加载后允许恢复仍有效的 motion/action progress 或从相同权威输入稳定重算；死亡时已取消的执行不得恢复。任一恢复路线都通过协议规定的 `positionAt(t)`、`roundDivNearestEven` 和整数 world time 物化位置。UI 日志可以截断，属于 read model，不是恢复真源。

## 世界坐标与数值编码

- world seed 保存为 unsigned 64-bit canonical decimal string。
- `NAV_UNITS_PER_TILE = 1024`；首版 tile coordinate 范围为 `[-2^31, 2^31-1]`。
- `WorldPoint`、tile/chunk coordinate、path cost 和精确算术中间量使用 `BigInt` 或等价精确整数。
- worker protocol 与存档把各坐标分量编码为 canonical signed decimal strings；禁止 leading zero 和 `-0`。
- chunk key 使用两个 canonical chunk coordinate 的可逆 `"x,y"` 编码。path 使用有序 canonical `WorldPoint` 列表。
- 时间和当前区域内有限计数使用安全整数毫秒。
- renderer 只接收 camera-relative `Number`/float。渲染插值不能回写权威位置、cost 或 event time。

规范十进制字符串不表示无限精度。tile/world-point 越界必须拒绝加载或 command，不能截断、wrap 或舍入。负坐标 tile 换算使用 Euclidean floor division。

## 权威时间

存档区分：

- `world_time_ms`：只随游戏认可的时间单调增加；恢复、效果、重生、移动、任务和战斗都使用它。dead player 不因其推进而恢复 HP/resource；
- `committed_wall_clock_ms`：上次成功事务提交时的 `Date.now()`；只用于计算关闭后的候选经过时间。

### 在线

- gameplay worker 使用 `performance.now()` 计算活动会话 delta，并累加 `world_time_ms`。
- 不得把 `Date.now()` 直接作为 world time。
- `visibilitychange → hidden` 和 `pagehide` 请求立即保存，但周期事务才是可靠基础；不得假设 unload save 一定完成。

### 恢复

```text
raw_elapsed = Date.now() - committed_wall_clock_ms

if raw_elapsed < 0:
  credited = 0
else:
  credited = min(raw_elapsed, 168h)
```

- `raw_elapsed < 0` 时显示“系统时间倒退”警告，不回滚 `world_time_ms`。
- 超过 `168h` 的部分不产生进度。`168h` 是首轮平衡参数和计算预算，不是 schema 常量。
- offline claim 成功提交后，`committed_wall_clock_ms` 推进到该 claim 的 target wall clock。完成遗留 claim 后，再按其 target 到当前 wall clock 建立新 claim。
- 连续刷新不得重复领取被上限丢弃的时间。

单机 MVP 接受本地时钟不可信。本文不引入服务器时间或防作弊接口。

## Offline claim 与崩溃恢复

1. 在事务中读取 committed snapshot，并创建 `resume_claim`。claim 记录 base revision、target wall clock 和 credited duration，但不修改 committed snapshot。
2. gameplay worker 从 base revision 确定性快进。
3. 完成后，在一个事务中提交新的 `core`、dirty chunks 和 `meta` revision，并删除 claim。
4. 中途崩溃时，下次启动读取同一 claim，从同一 base revision 重算到同一 target，不扩大原区间。
5. 完成遗留 claim 后，再为 target 至当前 wall clock 创建新 claim。

`resume_claim` 是唯一 journal。系统不保存全部 gameplay events，也不能把处理中间状态写成新的 committed revision。

## 事件驱动快进

快进不得逐帧模拟。每轮选择不晚于目标 `world_time_ms` 的下一权威事件：

- timed effect expiry；
- player respawn；
- resource/enemy availability；
- combat attacks；
- non-combat action completion；
- motion tile-boundary crossing、path/destination arrival、observation、按 `(t-1,t]` swept segment 量化的最早 detection-circle intersection 或 discovery；
- task completion、acquisition 或 wait transition。

同一时刻 `T` 使用以下全局顺序：

1. 把连续属性推进到 `T`；只为存活角色结算自然恢复，`RespawnState` 中的 dead player 不恢复 HP/resource。
2. 令到期 effect 和 `RevivalGrace` 失效；它们在 `T` 时刻不再影响后续事件。
3. 完成 player respawn：在精确死亡位置设置 `max_hp`/默认资源并创建 `5s RevivalGrace`。再处理 world entity respawns；同类按稳定 ID。敌人在角色 detection circle 内复活时，在同一时间点生成遭遇检查，并受当时 grace/狩猎语义约束。
4. 处理已经存在的 combat attacks；玩家优先，再按稳定 actor ID。一次攻击造成玩家死亡时，立即结束战斗、清除 temporary effects、重置致死敌人、物化精确位置、取消 motion/action，并写入 `RespawnState`；死亡转换不延迟到后续 settlement。敌人被击杀时立即失去后续同刻攻击资格，其 reward settlement 在第 7 步完成。
5. 处理 active non-combat action completion；按稳定 action ID。
6. 处理 movement：通过 `positionAt(T)` 物化 canonical `WorldPoint`；按 rational crossing parameter、再按 `(y,x)` 处理全部 tile crossing；执行一次 observation/reveal/discovery；评估 encounter；只有没有进入 combat 时，才处理 path/destination arrival、task re-evaluation 和满足条件的 action start。同毫秒敌人按 `encounter_instance_id`。
7. 按 stable event ID 处理 kill、action、discovery reward，以及 inventory/knowledge settlement。
8. 重复执行同一时刻产生的即时状态转换，直到状态稳定，再选择下一事件。

死亡或 storage/integrity failure 导致 simulation pause 后，engine 删除同刻已经不再有资格的后续事件。任何模块都不得把 Array 当前顺序、Map 插入顺序、chunk 访问顺序或渲染顺序作为 tie-break。稳定 event ID grammar 和防止同刻无限即时转换的诊断规则仍待存档协议确认；全局事件先后已经由移动协议封闭。

## 等待不停止世界时间

本协议区分“任务执行等待”和“世界时间停止”：

- production missing materials、`MissingTool`、无可达目标或无可达迷雾边界，只使 task execution 进入等待。
- `world_time_ms` 仍推进；存活角色的 HP 恢复、effect 到期和 enemy/resource respawn 继续发生。dead player 的 HP/resource 不恢复。
- 定时事件使等待条件满足时，task 可以重新评估。
- 缺材料不会自行满足，因为离线期间没有外部库存变化；生产保持等待。
- 有数量任务完成后，剩余离线时间角色 idle，但 world time 与 timed world events 继续推进。
- 持续狩猎可以经历多次死亡、复活并继续，直到预算耗尽或出现其他停止条件。

forced combat 暂停 current motion leg 或 non-combat action progress。战斗后只有唯一 `TaskIntent`、action target 和 prerequisites 未改变时，才从精确交战位置继续 path/action；任务替换、取消或装备变化会物化位置并取消旧执行，且不产生结算。

玩家死亡会取消 current motion/non-combat action。`RespawnState` 保存精确死亡位置和 Accepted 首轮平衡基线 `60s` 截止时间；复活后从头重评唯一 `TaskIntent`、目标与路径，并应用 Accepted 首轮平衡基线 `5s RevivalGrace`。

这段规则细化[离线需求](offline-progression.md#完成与停止)，并与该页共同构成 Accepted 离线语义。

## 批处理与响应

- 没有中断、随机或发现边界的重复资源/生产周期可以数学批量推进，但结果必须等价于逐事件执行。
- 自由向量移动只有在不跨越 tile boundary、观察、发现、敌人检测、effect/grace 到期、实体/玩家复活或 action settlement 边界时才允许批处理。
- 权威 `WorldPoint`、route cost 和 event time 使用 BigInt/有理数与 `ceilSqrt` 算术；不得逐帧 float 累加。
- combat RNG 必须保持相同 event ordinal；批处理不能跳过 roll 或改变序列。
- 快进在 gameplay worker 中运行。每处理固定事件预算或短时间片后 yield，并向 UI 报告进度。
- 不设置会丢弃剩余 credited time 的事件数量上限。性能不足时分段继续。
- 用户关闭页面导致处理未完成时，依靠 `resume_claim` 从 base revision 重算。

具体事件预算、时间片、进度节流和最坏 `168h` 性能目标仍待基准测试确定。

## 自动保存

- gameplay mutation 后设置 dirty。
- dirty 状态最迟在 `5s` 内提交一次；`5s` 是 Accepted 首轮可靠性基线。
- 设置、取消或替换任务，装备变更，世界/存档创建，以及离线快进完成后立即提交。command、autosave 与 read-model snapshot 都在对应整数 world time 通过同一 `positionAt(t)` 物化，不能读取 renderer 插值位置。
- `visibilitychange → hidden` 和 `pagehide` 触发 best-effort immediate save，但不能作为唯一保障。
- commit 成功后，UI 才能报告“已保存”。
- write、transaction 或 quota failure 时暂停 gameplay simulation，保留内存状态，并显示阻塞错误与导出选项。系统不得继续产生无法持久化的进度。
- 请求 `navigator.storage.persist()`，但 UI 必须说明浏览器仍可能清除本地站点数据。
- 使用 `navigator.storage.estimate()` 显示空间诊断，不把 estimate 结果用于游戏规则。

`persist()` 的请求时机、用户手势要求和各浏览器行为必须在实现时重新核对。

## 导入与导出

### Backup envelope

单个 JSON backup envelope 包含：

- product identifier；
- export format version；
- `DB_SCHEMA_VERSION`、`SAVE_SCHEMA_VERSION`、`GAME_RULES_VERSION`、`CONTENT_VERSION` 和 `GENERATOR_VERSION`；
- save metadata 与 timestamps；
- `core` state；
- 按 canonical chunk key 排序的 chunk records；
- canonical serialization 的 SHA-256 checksum。

checksum 只检测意外损坏，不表示防篡改。

### 导出

- 在只读 IndexedDB transaction 中取得一致视图。
- canonical serialization 后计算 checksum。
- 下载本地文件，不上传。

### 导入

1. 限制文件大小并解析。
2. 验证 product、format、versions、类型、范围、唯一 ID、坐标规范与 checksum。
3. 显示 world seed、创建/保存时间、角色概要和将被替换的当前存档。
4. 取得玩家明确确认。
5. 在单一事务中替换全部当前 save records。
6. 成功后重启 gameplay worker。

不支持合并、部分导入或旧版本迁移。文件大小上限、canonical JSON 规则、checksum 字段排除方式和导入错误分类仍待精确规范。

### 删除与重置

- 必须取得明确确认。
- UI 建议玩家先导出，但不强迫。
- 在事务中删除全部 gameplay stores。
- 不清除 terrain texture 或 render preferences，除非玩家另选“清除全部站点数据”。

## 首次创建

- 第一份 gameplay save 成功提交后，才允许进入可玩状态。
- seed、全部版本、初始 world time、起始角色状态和起始内容锚点必须在同一个创建事务中提交。
- 创建失败时，不进入临时无存档模式。

## UI

启动 shell、常驻 save indicator、System drawer 和 offline report 的布局见[玩法界面信息架构](gameplay-information-architecture.md)。本节只定义存档协议必须向 read model 提供的信息；两份文档均已 Accepted。

### 启动状态

- `acquiring lock`；
- `loading save`；
- `processing offline`；
- `ready`；
- `incompatible save`；
- `storage unavailable/write failed`。

### 离线报告

- raw elapsed；
- credited elapsed；
- capped/discarded elapsed；
- simulated world-time range；
- task before/after；
- outputs、kills 和 deaths；
- XP 与 levels；
- new Facts、Relations、Insights 和 Leads；
- final waiting/idle reason；
- committed save revision。

报告来自结算摘要，不是第二次模拟。叙事字段遵守已接受的[碎片叙事与线索簿](narrative-cluebook.md)。

### 存档状态

- 最近成功保存时间；
- current revision；
- local-only 与 eviction warning；
- export、import 和 reset；
- storage usage diagnostic。

## 依赖与实现约束

- 实现时优先使用 `idb`，重新核对当时稳定版本、TypeScript types 和 Web Worker 支持，精确 pin 并提交适用 lockfile。
- 当前设计不足以证明需要 Dexie，不引入更大的 abstraction。
- 不自行实现 IndexedDB Promise wrapper。
- 不把 gameplay state 塞入现有 texture-setting `localStorage` helpers。
- gameplay worker protocol 使用 strict discriminated unions，并验证 UI/worker/storage boundaries。
- 依赖加入、lockfile 和 package script 变化必须由后续实现任务完成；本文不修改它们。

## 明确排除

- 多存档；
- 云同步和账号；
- 服务器时间和防作弊；
- 跨设备同步；
- 旧 schema migration；
- 存档合并；
- 后台 service worker 模拟；
- 完整 event sourcing；
- OPFS；
- 压缩和加密；
- 多人经济兼容；
- 渲染参数迁移。

## 验收标准

- IndexedDB 是 gameplay save 唯一持久化真源；`localStorage` 不含 gameplay state。
- 同一 save 同时只有一个 writer；第二个标签页不能模拟或覆盖。
- 每次 commit 跨 `core`、dirty chunks 和 `meta` 原子完成。
- offline processing 在任意位置崩溃后，同一 claim 可重算且不重复领取。
- 负 wall-clock delta 只 credit `0`；超过 `168h` 只 credit `168h`。
- task execution 等待时，world time 与 timed events 继续。
- chunk generation/loading 和尚未完成的分片寻路不消耗 world time，也不能被解释为不可达。
- tile coordinate 超出 `[-2^31, 2^31-1]` 或 `WorldPoint` 超出由该范围导出的 nav-unit 边界时必须拒绝；不得宣称无限精度。
- online/offline 从同状态和同 credited duration 得到相同结果。
- same-timestamp tie-break 与容器访问顺序无关。
- write failure 暂停模拟，不能静默丢失进度。
- quantity 结算超过 `Number.MAX_SAFE_INTEGER` 时，在事务前以 `integrity/quantity_overflow` 拒绝整个结算并暂停模拟。
- terrain bytes、cache、GPU 和 UI 临时状态不进入 save。
- import validation 失败不改变当前 save。
- 版本不匹配时拒绝加载，不走兼容或迁移。
- export checksum 能发现意外损坏。
- `168h` 快进在 worker 中分段执行，不阻塞主线程。

## 实现与验证工作

- Worker 专项须在编码前补齐 gameplay worker 与 generator worker 的 discriminated-union protocol、生命周期、request identity 和错误恢复 contract。
- 存档专项须声明 `DB_SCHEMA_VERSION`、`SAVE_SCHEMA_VERSION`、export format version 的初值与变更规则，以及 object-store keyPath、index、canonical chunk key、decimal grammar 和精确 gameplay store schema。
- 自由向量 path/motion、rational boundary、`ceilSqrt`、`roundDivNearestEven`、毫秒量化 circle detection、fog reveal、target search、`RevivalGrace` 和 production station acquisition 直接遵守[移动协议](movement-navigation-protocol.md)；实现须补齐 serialization 与 fixtures。
- 存档专项须定义 stable event ID grammar、无限即时转换诊断、write failure 后允许的只读操作和内存状态导出格式；same-time 全局顺序不再开放选择。
- 导入导出专项须定义 backup canonical serialization、文件大小限制、SHA-256 输入和稳定导入错误分类。
- 性能专项须验证 `5s` 自动保存基线、time-slice/event budget 和 Accepted 首轮 `168h` 最坏快进目标。
- 浏览器专项须记录支持矩阵、feature detection、存储持久化请求和 eviction UX，并按已接受的[玩法界面信息架构](gameplay-information-architecture.md)实现 save/offline read model。
- 单机 MVP 接受本地时钟不可信，不设计服务器权威时间；只有市场或异步交互未来进入新产品范围时重新决策。

## 平台依据

- [`idb` repository](https://github.com/jakearchibald/idb)：Promise wrapper、TypeScript typing、transaction lifetime 和 `tx.done`。
- [IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)：结构化事务存储与 Web Worker 可用性。
- [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)：origin-scoped lock、worker 支持与 secure-context 限制。
- [Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)：Web Storage 配额及浏览器存储驱逐边界。
- [Secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts)：HTTPS 与 localhost/loopback 的 potentially trustworthy 规则。
- [GitHub Pages HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https)：Pages HTTPS 支持与强制设置。

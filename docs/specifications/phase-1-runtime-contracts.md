# 阶段 1 运行时契约

- 状态：Gate A complete（静态 schema fixture 已通过）；Gate B complete（generator v3 anchor 已物化）
- 适用范围：[阶段 1：探索垂直切片](../engineering/phase-1-exploration-vertical-slice.md)
- 协议版本：`GAMEPLAY_PROTOCOL_VERSION = 1`
- 审计日期：2026-08-09

本文只细化阶段 1 已接受的探索、Worker、存档、离线和验证边界。本文不引入其他任务、战斗、库存、物品或叙事状态。

## Stable ID grammar

### 基础语法

```text
unsigned-decimal  = "0" | [1-9][0-9]*
signed-decimal    = "0" | "-"?[1-9][0-9]*
lower-hex-16      = [0-9a-f]{16}
lower-hex-32      = [0-9a-f]{32}
slug              = [a-z][a-z0-9]*(?:-[a-z0-9]+)*
chunk-key         = signed-decimal "," signed-decimal
save-id           = "save:local"
request-id        = "req:" lower-hex-16 ":" unsigned-decimal
command-id        = "cmd:" lower-hex-16 ":" unsigned-decimal
task-id           = "task:" lower-hex-16 ":" unsigned-decimal
event-id          = "evt:" unsigned-decimal ":" unsigned-decimal
terrain-request-id = "terrain:" unsigned-decimal ":" unsigned-decimal
claim-id          = "claim:" unsigned-decimal ":" unsigned-decimal
content-placement-id = "place:" slug ":" signed-decimal ":" signed-decimal
diagnostic-id     = "diag:" slug ":" slug ":" lower-hex-16
```

`request-id`、`command-id` 和 `task-id` 的两段分别是一次 UI session 的随机 `64-bit` nonce 和该类型在该 session 从 `0` 开始单调递增的 safe-uint counter。nonce 覆盖 `0..2^64-1`；counter 覆盖 `0..9007199254740991`。`task-id` 在接受 `SetTask` 时由该 command 的 nonce/counter 派生，因此重试不产生新任务。`event-id` 的两段分别是 `world_time_ms` 和同一存档中单调递增的 event ordinal；两段均覆盖 `0..2^127-1`。`terrain-request-id` 的两段分别是 gameplay epoch 和该 epoch 内单调递增的 request ordinal；两段均为 safe uint。每个 terrain message 的 `terrainRequestId` 第一段必须与同一 message 的 `gameplayEpoch` 数值相等。`claim-id` 的两段分别是 base save revision 和 target wall-clock milliseconds；两段均为 safe uint，且 revision 至少为 `1`。单存档同一 base/target 只能存在一个 claim。grammar 只识别字符形状；validator 还必须执行上述数值范围与关联相等检查。`content-placement-id` 只封闭后续内容层所需 grammar；阶段 1 不创建 content placement。

所有十进制字段必须满足 canonical decimal：禁止 `+`、空白、leading zero 和 `-0`。精确边界如下：

| 字段 | 编码 | 闭区间 |
|---|---|---:|
| seed | canonical unsigned decimal string | `0..18446744073709551615` |
| tile x/y | canonical signed decimal string | `-2147483648..2147483647` |
| `WorldPoint.x/y` nav units | canonical signed decimal string | `-2199023255552..2199023255551` |
| chunk x/y | canonical signed decimal string | `-33554432..33554431` |
| authoritative world/motion/event time、route cost、ETA、event ordinal | canonical unsigned decimal string；engine 内为 `bigint` | `0..2^127-1` |
| wall clock、`performance.now()` 量化 delta、save/read-model revision、UI counter | JSON number | `0..9007199254740991` 且为 safe integer |
| offline `rawElapsedMs` | JSON number | `-9007199254740991..9007199254740991` 且为 safe integer |
| generator/protocol/schema version | JSON number | `0..4294967295` 且为 integer |
| progress | JSON number | `0..1000` 且为 integer |

`WorldPoint` 的下界是 `-2147483648 × 1024`；上界是 `(2147483647 + 1) × 1024 - 1`。因此最大 tile 内的最后一个 nav unit 有效，下一 tile 的第一个 nav unit 无效。chunk coordinate 是合法 tile coordinate 的 Euclidean floor division by `64`。解析后再序列化必须得到原字符串，否则拒绝。

ID 使用 UTF-8 bytes 和 ASCII code-point 排序，不使用 locale collation。需要数值顺序时必须解析 grammar 后按数值 tuple 排序：request/command/task 按 `(nonce bytes, counter)`；event 按 `(world_time_ms, ordinal)`；terrain request 按 `(epoch, ordinal)`；claim 按 `(base_revision, target_wall_clock_ms)`；placement 按 `(prototype slug, tile_y, tile_x)`；chunk 按 `(chunk_y, chunk_x)`。每类 ID 在其 authority scope 内唯一。禁止直接用十进制字符串的词典序代替数值顺序。

正例：

```text
save:local
cmd:0123456789abcdef:0
req:0123456789abcdef:0
task:0123456789abcdef:0
evt:1200:7
terrain:3:19
claim:7:1770000000000
-12,4
place:camp-anchor:-12:4
diag:storage:write-failed:0123456789abcdef
```

反例：`save:1`、`req:ABC:1`、`cmd:ABC:1`、`task:abcd:1`、`evt:01:2`、`terrain:1:-1`、`claim:01:2`、`-0,2`、`place:Camp:1:2`、`diag:storage:any message:abcd`。

规范 fixture 固定输入 `0`、`-1`、`1`、全部 tile/nav/chunk 边界及其边界外一个单位、乱序 chunk keys 和上述正反例。fixture 必须验证 parse → normalize → serialize、拒绝非规范输入和稳定 tuple 排序。

## Worker/UI protocol

所有消息都是 `GAMEPLAY_PROTOCOL_VERSION = 1` 的 strict discriminated union。边界验证失败不得进入 engine、IndexedDB 或 terrain broker。未知 `type` 返回 `protocol/unknown_message`；已知消息含未知字段、字段缺失或字段类型错误返回 `protocol/invalid_message`。两类错误都不改变 gameplay state、read-model revision 或 save revision。

### 精确 TypeScript 形状

下列定义是文档真源。源码必须一一映射，不得扩大为 `Record<string, unknown>`。`Exact<T>` 表示 validator 必须校验列出的全部字段，拒绝未知字段；它不是允许 index signature 的运行时类型。

```ts
type Exact<T> = T;
type ProtocolVersion = 1;
type U32 = number;        // integer, 0..4294967295
type SafeUint = number;   // safe integer, 0..9007199254740991
type SafeInt = number;    // safe integer, -9007199254740991..9007199254740991
type Permille = number;   // integer, 0..1000

type SignedDecimal = string;
type UnsignedDecimal = string;
type SeedDecimal = UnsignedDecimal;      // 0..2^64-1
type WorldTimeDecimal = UnsignedDecimal; // 0..2^127-1
type CostDecimal = UnsignedDecimal;      // 0..2^127-1
type EtaDecimal = UnsignedDecimal;       // 0..2^127-1
type TileDecimal = SignedDecimal;        // -2^31..2^31-1
type ChunkDecimal = SignedDecimal;       // -33554432..33554431
type NavDecimal = SignedDecimal;         // -2199023255552..2199023255551

type RequestId = string;        // request-id grammar
type CommandId = string;        // command-id grammar
type TaskId = string;           // task-id grammar
type TerrainRequestId = string; // terrain-request-id grammar
type ClaimId = string;          // claim-id grammar
type DiagnosticId = string;     // diagnostic-id grammar
type ChunkKey = string;         // chunk-key grammar and coordinate equality

type WorldPoint = Exact<{ x: NavDecimal; y: NavDecimal }>;

type RuntimeErrorCode =
  | "protocol/unknown_message" | "protocol/invalid_message" | "protocol/version_mismatch"
  | "command/id_conflict" | "command/invalid_seed" | "command/invalid_destination" | "command/confirmation_required"
  | "save/not_found" | "save/incompatible_version"
  | "storage/unavailable" | "storage/write_failed" | "storage/quota_exceeded" | "storage/integrity_failed"
  | "platform/web_locks_unavailable" | "active_in_other_tab"
  | "terrain/stale_response" | "terrain/payload_invalid" | "terrain/generation_failed"
  | "navigation/no_reachable_frontier" | "navigation/destination_unreachable"
  | "backup/file_too_large" | "backup/invalid_utf8" | "backup/invalid_json" | "backup/invalid_product"
  | "backup/incompatible_export_version" | "backup/incompatible_version" | "backup/invalid_shape" | "backup/invalid_id"
  | "backup/non_canonical_decimal" | "backup/coordinate_out_of_range" | "backup/unsafe_integer" | "backup/duplicate_chunk"
  | "backup/checksum_mismatch" | "integrity/quantity_overflow" | "undefined_failure";

type ActivityReason =
  | Exact<{ code: "TaskCompleted"; params: null; allowedActions: readonly ["set_task"]; diagnosticId: null }>
  | Exact<{ code: "NoReachableTargetOrFrontier"; params: null; allowedActions: readonly ["set_task"]; diagnosticId: null }>
  | Exact<{ code: "DestinationUnreachable"; params: Exact<{ destination: WorldPoint }>; allowedActions: readonly ["set_task"]; diagnosticId: null }>
  | Exact<{ code: "storage_write_failed"; params: null; allowedActions: readonly ["open_system", "export", "reset", "retry"]; diagnosticId: DiagnosticId }>
  | Exact<{ code: "incompatible_save"; params: Exact<{ expected: U32; actual: U32; version: "db" | "save" | "rules" | "content" | "generator" }>; allowedActions: readonly ["export", "reset"]; diagnosticId: DiagnosticId }>
  | Exact<{ code: "active_in_other_tab"; params: null; allowedActions: readonly ["retry"]; diagnosticId: null }>
  | Exact<{ code: "undefined_failure"; params: null; allowedActions: readonly ["open_system", "export", "reset"]; diagnosticId: DiagnosticId }>;

type ProtocolError =
  | Exact<{ code: "protocol/unknown_message" | "protocol/invalid_message"; params: null; diagnosticId: DiagnosticId }>
  | Exact<{ code: "protocol/version_mismatch"; params: Exact<{ expected: 1; actual: U32 | null }>; diagnosticId: DiagnosticId }>;

type LifecycleError =
  | Exact<{ code: "save/incompatible_version"; params: Exact<{ expected: U32; actual: U32; version: "db" | "save" | "rules" | "content" | "generator" }>; diagnosticId: DiagnosticId }>
  | Exact<{ code: "storage/unavailable" | "storage/write_failed" | "storage/quota_exceeded" | "storage/integrity_failed"; params: null; diagnosticId: DiagnosticId }>
  | Exact<{ code: "platform/web_locks_unavailable" | "active_in_other_tab"; params: null; diagnosticId: DiagnosticId | null }>
  | Exact<{ code: "undefined_failure"; params: null; diagnosticId: DiagnosticId }>;

type CommandError =
  | Exact<{ code: "command/id_conflict"; params: Exact<{ commandId: CommandId }>; diagnosticId: null }>
  | Exact<{ code: "command/invalid_seed"; params: null; diagnosticId: null }>
  | Exact<{ code: "command/invalid_destination"; params: Exact<{ destination: WorldPoint }>; diagnosticId: null }>
  | Exact<{ code: "command/confirmation_required"; params: Exact<{ command: "ImportSave" | "ResetSave" }>; diagnosticId: null }>
  | Exact<{ code: "save/not_found"; params: null; diagnosticId: null }>
  | Exact<{ code: "save/incompatible_version"; params: Exact<{ expected: U32; actual: U32; version: "db" | "save" | "rules" | "content" | "generator" }>; diagnosticId: DiagnosticId }>
  | Exact<{ code: "storage/unavailable" | "storage/write_failed" | "storage/quota_exceeded" | "storage/integrity_failed"; params: null; diagnosticId: DiagnosticId }>
  | Exact<{ code: "platform/web_locks_unavailable" | "active_in_other_tab"; params: null; diagnosticId: DiagnosticId | null }>
  | Exact<{ code: "backup/file_too_large" | "backup/invalid_utf8" | "backup/invalid_json" | "backup/invalid_product" | "backup/incompatible_export_version" | "backup/incompatible_version" | "backup/invalid_shape" | "backup/invalid_id" | "backup/non_canonical_decimal" | "backup/coordinate_out_of_range" | "backup/unsafe_integer" | "backup/duplicate_chunk" | "backup/checksum_mismatch"; params: null; diagnosticId: DiagnosticId }>
  | Exact<{ code: "integrity/quantity_overflow"; params: null; diagnosticId: DiagnosticId }>
  | Exact<{ code: "undefined_failure"; params: null; diagnosticId: DiagnosticId }>;

type FatalError =
  | Exact<{ code: "storage/unavailable" | "storage/write_failed" | "storage/quota_exceeded" | "storage/integrity_failed"; params: null; diagnosticId: DiagnosticId }>
  | Exact<{ code: "platform/web_locks_unavailable" | "active_in_other_tab"; params: null; diagnosticId: DiagnosticId | null }>
  | Exact<{ code: "save/incompatible_version"; params: Exact<{ expected: U32; actual: U32; version: "db" | "save" | "rules" | "content" | "generator" }>; diagnosticId: DiagnosticId }>
  | Exact<{ code: "undefined_failure"; params: null; diagnosticId: DiagnosticId }>;

type ExploreTask = Exact<{
  taskId: TaskId;
  kind: "Explore";
  mode: "continuous" | "destination";
  destination: WorldPoint | null;
  createdWorldTimeMs: WorldTimeDecimal;
}>;

type Activity = Exact<{
  state: "idle" | "planning" | "moving" | "waiting" | "paused";
  route: readonly WorldPoint[]; // 0..65536 entries
  routeIndex: SafeUint;         // 0 when route is empty; otherwise < route.length
  etaMs: EtaDecimal | null;     // non-null only while moving
  progressPermille: Permille | null;
  reason: ActivityReason | null; // non-null only for waiting/paused or one-shot completed state
}>;

type RevealedChunk = Exact<{
  chunkKey: ChunkKey;
  chunkX: ChunkDecimal;
  chunkY: ChunkDecimal;
  revealedBase64: string; // canonical RFC 4648 base64; decodes to exactly 512 bytes
}>;

type OfflineReport = Exact<{
  claimId: ClaimId;
  rawElapsedMs: SafeInt;
  clockSkew: "none" | "backward";
  creditedDurationMs: UnsignedDecimal;
  discardedDurationMs: UnsignedDecimal;
  fromWorldTimeMs: WorldTimeDecimal;
  toWorldTimeMs: WorldTimeDecimal;
  taskBefore: ExploreTask | null;
  taskAfter: ExploreTask | null;
  xpGained: SafeUint;
  levelsGained: SafeUint;
  revealedTiles: SafeUint;
  stopReason: ActivityReason | null;
  committedRevision: SafeUint;
}>;

type GameplayReadModelV1 = Exact<{
  protocolVersion: ProtocolVersion;
  readModelRevision: SafeUint;
  gameplayEpoch: SafeUint;
  startup: "acquiring_lock" | "loading_save" | "new_world" | "processing_offline" | "ready" | "active_in_other_tab" | "incompatible_save" | "storage_blocked";
  generatorVersion: U32 | null;
  player: Exact<{ position: WorldPoint; hp: Exact<{ current: 100; max: 100 }>; combatScope: "not_implemented_phase_1" }> | null;
  task: ExploreTask | null;
  activity: Activity;
  exploration: Exact<{ level: SafeUint; totalXp: SafeUint; currentLevelXp: SafeUint; nextLevelXp: SafeUint | null; observationRadiusTiles: SafeUint; revealedTileCount: SafeUint }> | null;
  map: Exact<{ revealedChunks: readonly RevealedChunk[]; selectedDestination: null }>;
  save: Exact<{ state: "none" | "saving" | "saved" | "error" | "incompatible" | "active_in_other_tab"; revision: SafeUint; committedWallClockMs: SafeUint | null; localOnly: true; evictionWarning: boolean; lastError: ActivityReason | null }>;
  offlineReport: OfflineReport | null;
}>;

type GameplayCommand =
  | Exact<{ type: "CreateWorld"; commandId: CommandId; seed: SeedDecimal; seedSource: "automatic" | "manual"; wallClockMs: SafeUint }>
  | Exact<{ type: "SetTask"; commandId: CommandId; task: Exact<{ kind: "Explore"; mode: "continuous"; destination: null }>; wallClockMs: SafeUint }>
  | Exact<{ type: "SetTask"; commandId: CommandId; task: Exact<{ kind: "Explore"; mode: "destination"; destination: WorldPoint }>; wallClockMs: SafeUint }>
  | Exact<{ type: "CancelTask"; commandId: CommandId; wallClockMs: SafeUint }>
  | Exact<{ type: "ExportSave"; commandId: CommandId; wallClockMs: SafeUint }>
  | Exact<{ type: "ImportSave"; commandId: CommandId; backupUtf8: ArrayBuffer; confirmed: true; wallClockMs: SafeUint }>
  | Exact<{ type: "ResetSave"; commandId: CommandId; confirmed: true; wallClockMs: SafeUint }>;

type MainToGameplayWorker =
  | Exact<{ type: "initialize"; protocolVersion: ProtocolVersion; requestId: RequestId; generatorVersion: U32; wallClockMs: SafeUint }>
  | Exact<{ type: "command"; protocolVersion: ProtocolVersion; requestId: RequestId; command: GameplayCommand }>
  | Exact<{ type: "terrain-result"; protocolVersion: ProtocolVersion; terrainRequestId: TerrainRequestId; gameplayEpoch: SafeUint; chunkKey: ChunkKey; chunkX: ChunkDecimal; chunkY: ChunkDecimal; generatorVersion: U32; baseTerrain: ArrayBuffer }>
  | Exact<{ type: "terrain-error"; protocolVersion: ProtocolVersion; terrainRequestId: TerrainRequestId; gameplayEpoch: SafeUint; code: "terrain/generation_failed" | "terrain/payload_invalid"; transient: boolean; diagnosticId: DiagnosticId }>
  | Exact<{ type: "flush"; protocolVersion: ProtocolVersion; requestId: RequestId; wallClockMs: SafeUint }>
  | Exact<{ type: "shutdown"; protocolVersion: ProtocolVersion; requestId: RequestId }>;

type GameplayWorkerToMain =
  | Exact<{ type: "worker-ready"; protocolVersion: ProtocolVersion }>
  | Exact<{ type: "request-result"; protocolVersion: ProtocolVersion; requestId: RequestId; operation: "initialize" | "flush" | "shutdown"; status: "accepted" | "rejected"; readModelRevision: SafeUint; saveRevision: SafeUint; error: LifecycleError | null }>
  | Exact<{ type: "protocol-error"; protocolVersion: ProtocolVersion; requestId: RequestId | null; error: ProtocolError; readModelRevision: SafeUint; saveRevision: SafeUint }>
  | Exact<{ type: "terrain-request"; protocolVersion: ProtocolVersion; terrainRequestId: TerrainRequestId; gameplayEpoch: SafeUint; readModelRevision: SafeUint; seed: SeedDecimal; chunkKey: ChunkKey; chunkX: ChunkDecimal; chunkY: ChunkDecimal }>
  | Exact<{ type: "read-model"; protocolVersion: ProtocolVersion; readModel: GameplayReadModelV1 }>
  | Exact<{ type: "command-result"; protocolVersion: ProtocolVersion; requestId: RequestId; commandId: CommandId; status: "accepted" | "rejected"; readModelRevision: SafeUint; saveRevision: SafeUint; error: CommandError | null }>
  | Exact<{ type: "offline-progress"; protocolVersion: ProtocolVersion; claimId: ClaimId; processedDurationMs: UnsignedDecimal; creditedDurationMs: UnsignedDecimal; sliceMaxMs: number }>
  | Exact<{ type: "export-ready"; protocolVersion: ProtocolVersion; requestId: RequestId; commandId: CommandId; saveRevision: SafeUint; filename: string; backupUtf8: ArrayBuffer }>
  | Exact<{ type: "fatal"; protocolVersion: ProtocolVersion; error: FatalError; readModelRevision: SafeUint; saveRevision: SafeUint }>;
```

`number` 类型的 `sliceMaxMs` 必须 finite、`>= 0`，只用于性能诊断，不进入 gameplay state。其他 number 均服从上表范围。`world_time_ms`、motion/event time、route cost 和 ETA 在 engine 中必须使用 `bigint`；跨 Worker、IndexedDB 和 backup 使用 canonical decimal string。UI 若把 duration 转为 number，只能在显示函数中 clamp 到已验证范围；该派生值不得用于 command、snapshot、autosave、renderer-to-engine 回传或离线推进。

`request-result.error` 与 `command-result.error` 始终存在：accepted 时必须为 `null`，rejected 时必须非 null。`ActivityReason` 只解释 read model 中的 activity/save/offline 状态，不得代替 command 或 lifecycle error。`protocol-error.requestId` 只在输入包含通过 grammar 与 bounds 验证的 request ID 时回显，否则为 `null`；它在非 null 时是该 request 的 terminal response。所有其他 nullable 字段按 union 明确；没有隐式 optional 字段。continuous task 明确携带 `destination: null`，destination task 明确携带 `WorldPoint`。

离线 `rawElapsedMs = currentWallClockMs - committedWallClockMs`，两项输入先分别验证为 safe uint，再用不会溢出的 signed-safe subtraction 计算。结果小于 `0` 时，report 必须设置 `clockSkew: "backward"`、`creditedDurationMs: "0"`、`discardedDurationMs: "0"`、`toWorldTimeMs = fromWorldTimeMs`，且 XP、level、fog 和任务执行状态不变；UI 必须显示系统时间倒退警告。结果大于等于 `0` 时设置 `clockSkew: "none"`，credited 仍受 `604800000ms` 上限约束。权威 world time 永不回滚。

### Transfer 与 correlation

- `terrain-result.baseTerrain` 必须是 byteOffset `0`、byteLength `4096` 的独占 `ArrayBuffer`。main thread 转移后不得再读取。只传 `BaseTerrain`；`Decoration` 不进入 gameplay worker。
- `ImportSave.backupUtf8` 和 `export-ready.backupUtf8` 必须是 byteOffset `0` 的独占 `ArrayBuffer`，上限 `33,554,432 bytes`，转移后发送方不得再读取。
- fog 只在 read model 中使用 canonical padded base64；每项解码必须恰为 `512` bytes。它不是 transferable，也不是 terrain payload。
- 每个 `initialize`、`command`、`flush`、`shutdown` 的 terminal response 必须回显原 `requestId`。`command-result` 和 `export-ready` 还必须回显 `commandId`。同一 request 只能有一个 terminal response。
- `terrain-request.seed` 来自 gameplay worker 当前权威 core。main-thread broker 只把该 seed 与 coordinates 转发给 generator worker；它不得从 UI 临时状态、默认值或 IndexedDB 另行推断 seed。gameplay epoch 绑定一次 seed/world 生命周期。
- terrain broker 必须逐项匹配 `terrainRequestId`、gameplay epoch、seed、chunk key、coordinates 和 generator version。stale、duplicate、未知或 payload shape 不符的响应不得进入 gameplay worker terrain cache。
- main thread 只接受 `protocolVersion = 1`。read model revision 小于当前 revision 时丢弃；相等 revision 的逐字节不同 read model 视为 `protocol/invalid_message`。

本阶段不包含 `CombatSummary`、inventory、equipment、journal 或其他 skill 字段。固定 full HP 只通过 `combatScope` 说明阶段边界。generator worker 仍是唯一 WASM `generate_chunk` 调用者。

## Command idempotency

每个 authority scope 内，`commandId` 唯一标识一个 canonical command payload。payload 先按 backup 一致的 canonical JSON 规则编码；`ArrayBuffer` 先转为 padded base64；再计算 lowercase SHA-256。worker 在执行前查 command receipt：

1. 未见过的 ID：验证 payload，执行命令；需要立即保存的命令只在事务成功后返回 `accepted`。
2. 相同 ID、相同 canonical payload：返回第一次的 terminal result；不得重复 mutation、XP、fog、import/reset、read-model revision 或 save revision。
3. 相同 ID、不同 canonical payload：返回 `command/id_conflict`；不得执行第二个 payload。
4. 处理中收到重复 ID：关联到同一个在途结果，不启动第二次工作。

`core.command_receipts` 只保存 mutation command 的 terminal receipt：

```ts
type CommandReceiptRecord = Exact<{
  command_id: CommandId;
  command_type: "CreateWorld" | "SetTask" | "CancelTask";
  payload_sha256: string; // 64 lowercase hex
  terminal_status: "accepted";
  save_revision: SafeUint;
  reason_code: null;
}>;

type TransientCommandTombstone = Exact<{
  command_id: CommandId;
  command_type: "ExportSave" | "ImportSave" | "ResetSave";
  payload_sha256: string; // 64 lowercase hex
  terminal_status: "accepted" | "rejected";
  save_revision: SafeUint;
  error: CommandError | null;
  export_backup_utf8: Uint8Array | null; // private retained copy; non-null only for accepted ExportSave
}>;
```

`CreateWorld` 的 receipt 进入首次创建事务。`SetTask` 和 `CancelTask` 的 receipt 进入各自成功事务。rejection 不写入 `core`；同一 Worker 生命周期以 exact `CommandError` 缓存 terminal rejection，重启后的相同非法输入由确定性验证重新得到相同 rejection。

`ImportSave`、`ResetSave` 和 `ExportSave` 的 receipt/tombstone 只存在于当前 Worker 生命周期内存，不进入 imported core 或 backup。成功 import 必须逐字段保留 backup 中的权威 core、chunks、revision 和可再次导出的 canonical bytes；不得为本次 import 增加 revision 或 receipt。worker 重启后重复导入同一 backup 是相同 snapshot 的原子替换，仍不增加 revision；不同 backup 不共享幂等身份。reset 成功后，当前生命周期的重复 ID 返回缓存 terminal no-op；worker 重启后，无存档上的 reset 返回相同 terminal no-op，不创建 revision。重复 export 在当前生命周期返回缓存 bytes；worker 重启后从当前 committed snapshot 重新 canonicalize，且不改变 state 或 revision。

失败发生在事务提交前时不写 terminal accepted receipt。可重试存储错误继续使用同一 command ID；validation rejection 可以稳定重放相同 rejection。

## IndexedDB schema

- database name：`baiyue-rpg-gameplay`
- `DB_SCHEMA_VERSION = 1`
- owner：持有 `baiyue-rpg:active-save` exclusive Web Lock 的 gameplay worker
- dependency：精确 pin `idb@8.0.3`；该版本自带 TypeScript declarations 和 `DBSchema` typing。官方文档要求 transaction 内不得等待非 IndexedDB promise，并以 `tx.done` 确认提交。

### Exact records 与 `DBSchema`

下列字段全部必填；nullable 字段显式写为 `| null`。IndexedDB 内的 fog 使用 `Uint8Array`，其他 BigInt 语义字段使用 canonical decimal string；禁止直接保存 JavaScript `bigint`，以保持 Worker、backup 和 fixture 同一编码。

```ts
type SaveId = "save:local";

type PersistedTask = Exact<{
  task_id: TaskId;
  kind: "Explore";
  mode: "continuous" | "destination";
  destination: WorldPoint | null;
  created_world_time_ms: WorldTimeDecimal;
}>;

type PersistedMotionLeg = Exact<{
  start: WorldPoint;
  end: WorldPoint;
  start_world_time_ms: WorldTimeDecimal;
  end_world_time_ms: WorldTimeDecimal;
  accumulated_weighted_cost: CostDecimal;
  total_weighted_cost: CostDecimal;
  path_index: SafeUint;
}>;

type PersistedExecution = Exact<{
  state: "idle" | "planning" | "moving" | "waiting" | "paused";
  route: readonly WorldPoint[]; // 0..65536
  route_index: SafeUint;
  motion: PersistedMotionLeg | null;
  waiting_reason: ActivityReason | null;
}>;

type MetaRecord = Exact<{
  save_id: SaveId;
  current_revision: SafeUint; // >= 1
  created_wall_clock_ms: SafeUint;
  committed_wall_clock_ms: SafeUint;
  committed_world_time_ms: WorldTimeDecimal;
  db_schema_version: 1;
  save_schema_version: 1;
  game_rules_version: 1;
  content_version: 1;
  generator_version: U32;
  integrity_algorithm: "sha256-record-v1";
  core_checksum_sha256: string; // 64 lowercase hex
  world_chunk_count: SafeUint;
}>;

type CoreRecord = Exact<{
  save_id: SaveId;
  revision: SafeUint; // equals meta.current_revision
  seed: SeedDecimal;
  world_time_ms: WorldTimeDecimal;
  position: WorldPoint;
  hp: Exact<{ current: 100; max: 100 }>;
  exploration: Exact<{ level: SafeUint; total_xp: SafeUint }>;
  task: PersistedTask | null;
  execution: PersistedExecution;
  command_receipts: readonly CommandReceiptRecord[]; // unique command_id, ASCII sorted
  next_event_ordinal: UnsignedDecimal;
  last_offline_report: OfflineReport | null;
}>;

type WorldChunkRecord = Exact<{
  chunk_key: ChunkKey;
  chunk_x: ChunkDecimal;
  chunk_y: ChunkDecimal;
  revealed_bits: Uint8Array; // exactly 512 bytes; unused high bits do not exist for 64×64
  revision: SafeUint;        // revision that last changed this record
  record_checksum_sha256: string; // 64 lowercase hex
}>;

type ResumeClaimRecord = Exact<{
  save_id: SaveId;
  claim_id: ClaimId;
  base_revision: SafeUint;
  base_world_time_ms: WorldTimeDecimal;
  from_wall_clock_ms: SafeUint;
  target_wall_clock_ms: SafeUint;
  credited_duration_ms: UnsignedDecimal; // 0..604800000
  processing_status: "pending";
  diagnostic_id: DiagnosticId;
}>;

interface BaiyueGameplayDB extends DBSchema {
  meta: { key: SaveId; value: MetaRecord };
  core: { key: SaveId; value: CoreRecord };
  world_chunks: { key: ChunkKey; value: WorldChunkRecord };
  resume_claim: { key: SaveId; value: ResumeClaimRecord };
}
```

object stores 必须精确创建为：

```ts
db.createObjectStore("meta", { keyPath: "save_id" });
db.createObjectStore("core", { keyPath: "save_id" });
db.createObjectStore("world_chunks", { keyPath: "chunk_key" });
db.createObjectStore("resume_claim", { keyPath: "save_id" });
```

不创建 index、autoIncrement 或其他 store。terrain bytes、pathfinding scratch、GPU、camera、drawer、pending request 和其他 RPG 空字段不持久化。

创建和普通 commit 都在一个 `readwrite` transaction 中写 `core`、dirty `world_chunks` 和 `meta`。offline completion 还在同一 transaction 删除 `resume_claim`。import/reset 对四个 store 使用一个 transaction。事务开始前完成全部 JSON、hash、quantity、安全整数、coordinate 和版本验证；事务期间只发 IndexedDB request。必须等待每个 request 和 `tx.done`。

`meta.current_revision` 是唯一 committed revision。创建固定使用 revision `1`；普通 gameplay commit 使用 `previous + 1`，并把同一 revision 写入 core 和本次 dirty chunk records。未改变的 chunk 保留其 last-change revision。import 是例外：它原子替换四个 store，并保留 backup metadata/core/chunk 中已有 revision，不生成 `previous + 1`。reset 删除四个 store，不生成 revision。事务失败时 committed revision 不变；内存状态保留但 simulation 进入 `storage_blocked`。

dirty generation 只存在 gameplay worker 内存，不进入 IndexedDB：

```ts
type DirtyTracker = Exact<{
  core_generation: SafeUint;
  committed_core_generation: SafeUint;
  chunk_generations: Map<ChunkKey, SafeUint>;
}>;
```

commit 捕获 generation snapshot。只有 `tx.done` 成功且对应 generation 未再次变化时才清除该 dirty 项；否则保留给下一事务。

### 内部存档完整性

内部完整性不复用 backup envelope checksum。算法标识为 `sha256-record-v1`：

- `meta.core_checksum_sha256` 的输入是删除任何 checksum 字段后的 `CoreRecord`，按 backup 的 canonical JSON 规则编码为 UTF-8；
- 每个 `WorldChunkRecord.record_checksum_sha256` 的输入是 `{ chunk_key, chunk_x, chunk_y, revealed_base64, revision }`；`Uint8Array` 先转为 canonical padded base64；
- `meta.world_chunk_count` 必须等于 transaction 一致视图中的实际 record 数；
- meta 自身不计算 checksum，避免自引用。IndexedDB 的单事务、core/meta revision equality、chunk count 和 record checksums 共同构成内部 integrity metadata。

checksum 与 IndexedDB transaction 严格分成两阶段，禁止用 Web Crypto promise 保持 transaction：

1. 写入时，gameplay worker 先暂停 simulation，并从一个不可变 generation snapshot 生成全部目标 records；在打开 `readwrite` transaction 前完成 canonicalization 与 Web Crypto SHA-256。transaction 内只发 IndexedDB request 并等待 `tx.done`。
2. 读取时，持有 exclusive Web Lock 且 simulation 尚未启动或已经暂停。worker 在一个 `readonly` transaction 内一次性 materialize meta、core、全部 world chunks 和 resume claim，并等待 `tx.done`。transaction 关闭后才执行 canonicalization、Web Crypto SHA-256 和完整性验证。唯一 writer 与暂停状态保证 hash 期间没有权威写入。

加载、offline claim 创建、export 和 import replace 后启动 simulation 前，worker 必须按上述读取阶段验证：core/meta key、core/meta revision、四项固定版本、generator version、chunk count、core checksum、所有 chunk checksum、chunk key/coordinate equality 和 fog byte length。任何失败返回 `storage/integrity_failed`，保持原 records，只允许 export/reset。import 必须先在 transaction 外验证 backup checksum，并从导入 snapshot 生成全部内部 record checksums；任一 hash 失败时不得打开 import transaction。import transaction 提交后按读取阶段重新 materialize 并验证，成功后才能恢复 simulation。

首次创建以 revision `1` 提交。创建事务成功前 UI 保持 `new_world`，不得进入临时可玩状态。dirty mutation 最迟 `5000ms` 提交；创建、SetTask、CancelTask、import/reset 和 offline completion 立即提交。

任一必需版本不匹配返回 `save/incompatible_version`，保留原始 records，只允许 export 和已确认 reset。Web Lock 不可用返回 `platform/web_locks_unavailable`；锁被占用返回 `active_in_other_tab`。不使用 lease 或 localStorage fallback。

## Backup canonicalization 与错误码

### Envelope

```ts
type BackupChunkV1 = Exact<{
  chunkKey: ChunkKey;
  chunkX: ChunkDecimal;
  chunkY: ChunkDecimal;
  revealedBase64: string; // canonical padded base64, exactly 512 decoded bytes
  revision: SafeUint;
}>;

type BackupEnvelopeV1 = Exact<{
  product: "baiyue-rpg";
  exportFormatVersion: 1;
  versions: Exact<{ dbSchema: U32; saveSchema: U32; gameRules: U32; content: U32; generator: U32 }>;
  metadata: Exact<{
    saveId: "save:local";
    revision: SafeUint;
    createdWallClockMs: SafeUint;
    committedWallClockMs: SafeUint;
    committedWorldTimeMs: WorldTimeDecimal;
    seed: SeedDecimal;
  }>;
  core: CoreRecord;
  chunks: readonly BackupChunkV1[]; // unique; sorted by numeric (chunkY, chunkX)
  checksum: string; // 64 lowercase hex SHA-256
}>;
```

`EXPORT_FORMAT_VERSION = 1`，输入上限 `33,554,432 bytes`。canonical JSON 规则：UTF-8；无 BOM、空白或末尾换行；object keys 按 Unicode code point 升序；array 保持协议顺序；所有整数 JSON number 必须是 safe integer；seed、WorldPoint、tile/chunk、world/motion/event time、event ordinal、route cost 和 ETA 等精确量使用 canonical decimal string；禁止 `NaN`、Infinity、`undefined`、sparse array 和 lone surrogate。每层拒绝未知字段。

正常存档导出的五项 `versions` 必须等于当前运行时版本。被版本门禁阻塞但仍可物化 required records 的原始导出必须保留存档 `meta` 中的 save/rules/content/generator 版本；`dbSchema` 使用实际打开的 IndexedDB version。导出不得把不兼容版本重标为当前常量。import 仍在 checksum 前拒绝任一版本不匹配，不迁移或改写。schema 已损坏到无法 materialize required records 时，export 返回可诊断失败；不得构造看似兼容的 backup。

checksum 输入是完全删除顶层 `checksum` 字段后的 canonical UTF-8 bytes。算法是 Web Crypto `SHA-256`；结果为 64 位 lowercase hex。最终文件是加入 checksum 后再次 canonicalize 的 UTF-8 bytes。同一 committed state 必须产生逐字节相同的 backup。

import 顺序：byte limit → UTF-8/JSON → exact fields/types → product/export version → 五项版本 → ID/decimal/range/safe integer → chunk uniqueness/order-independent normalization → checksum → confirmation → single transaction replace。validation 失败不得打开写事务，也不得改变现有存档。

### 稳定错误码

```text
protocol/unknown_message
protocol/invalid_message
protocol/version_mismatch
command/id_conflict
command/invalid_seed
command/invalid_destination
command/confirmation_required
save/not_found
save/incompatible_version
storage/unavailable
storage/write_failed
storage/quota_exceeded
storage/integrity_failed
platform/web_locks_unavailable
active_in_other_tab
terrain/stale_response
terrain/payload_invalid
terrain/generation_failed
navigation/no_reachable_frontier
navigation/destination_unreachable
backup/file_too_large
backup/invalid_utf8
backup/invalid_json
backup/invalid_product
backup/incompatible_export_version
backup/incompatible_version
backup/invalid_shape
backup/invalid_id
backup/non_canonical_decimal
backup/coordinate_out_of_range
backup/unsafe_integer
backup/duplicate_chunk
backup/checksum_mismatch
integrity/quantity_overflow
undefined_failure
```

`undefined_failure` 必须带 `diagnosticId`。write failure 后允许 read model、export、已确认 reset 和 retry；禁止 simulation、SetTask 和 CancelTask 继续产生新状态。

## Navigation benchmark

fixture ID：`phase1-168h-continuous-v1`。

本门禁分两段：

- Gate A：runner、seed、版本、时长、输入状态、采样口径和结果 identity 已固定，并由静态 schema fixture 验证。
- Gate B：`fixture:anchor` 使用正式 `findCampAnchor` 和实际 WASM `generate_chunk` 物化起点，并校验 generator version、tile、WorldPoint 和 checksum。Gate B 完成只表示 benchmark 输入固定，不表示 `168h` 性能门槛已经通过。

| 字段 | 固定值 |
|---|---|
| world seed | `20260809` |
| generator/game/content/save versions | `3/1/1/1` |
| start | tile `{"x":"0","y":"0"}`；`WorldPoint {"x":"512","y":"512"}` |
| anchor fixture checksum | `e05d5016e56b946b0cd541110e7dd5e23d9b7adb559f13842edfd8c175647939` |
| initial state | level `1`、XP `0`、初始半径 `4` observation、无初始 XP、continuous Explore |
| credited duration | `604800000ms`，即 `168h` |
| run count | 同一 production build 新 Worker 连续 `3` 次 |
| result identity | core canonical bytes、ordered fog chunk checksums、XP、position、world time、task/activity |

基准 runner 固定为 GitHub Actions `ubuntu-24.04`、Node `22.18.0`、Playwright `1.60.0`、其官方 `browsers.json` 固定的 Chromium revision `1223` / browser `148.0.7778.96`、单 test worker。CI job 明确限制为 `2 vCPU` 和 `1024 MiB` container memory；本地结果单独记录硬件，不与 CI median 混算。执行前使用 production `vite build`，通过浏览器 worker、main-thread terrain broker 和实际 WASM generator 跑完整 fixture。

anchor 搜索直接复用 `web/src/gameplay/anchor.ts`。候选 chunk 按 `(Chebyshev ring, y, x)` 搜索 `0..16`，chunk 内按绝对 `(tile y, tile x)`；候选中心必须是 `Land`，`3×3` tile 全部可通行。实现预载候选 chunk 周围 `3×3 chunks`，从候选 tile 以固定邻接顺序 `(N,W,E,S)` 做四邻域 flood fill，并要求连通分量进入候选 chunk 的至少一个正交相邻 chunk。候选中心是 tile center；`256 nav-unit` 角色圆在 `1024 nav-unit` tile center 内有 `256 nav-unit` 余量。`fixture:anchor` 使用 WASM generator v3 得到 tile `(0,0)`；checksum 输入的精确 UTF-8 文本是 `{"anchor":{"x":"512","y":"512"},"generatorVersion":3,"seed":"20260809"}`。

Gate B 的 native/WASM 证据使用同一 [`phase1-anchor-terrain.tsv`](../../web/tests/fixtures/phase1-anchor-terrain.tsv)。WASM 物化脚本记录搜索实际访问的全部 `9` 个完整 `8192-byte` chunk，并逐项核对 FNV-1a 64 checksum；Rust integration test `native_generator_matches_every_chunk_accessed_by_gate_b` 对同一 seed、coordinates 和 TSV 运行 native `generate_chunk`。`cargo test --locked` 与 `npm run fixture:anchor` 均通过后，才可记录 Gate B complete。`web/src/world-contract.ts` 是 TypeScript 的唯一 chunk size、payload size、`BaseTerrain` ID 和 `Decoration` ID 所有者；generator worker、ChunkManager、renderer 和 anchor 共同引用并在边界校验。ChunkManager 还必须拒绝超出 `None/Grass/Grove = 0/1/2` 的 Decoration，并拒绝任何非 `Land` tile 上的非零 Decoration。

采样从 offline claim 开始处理前到 commit `tx.done` 后，使用 `performance.now()`。每个 processing slice 在 Worker 内记录 start/end，输出最大 slice；进度按 `processed world-time / credited duration` 单调报告。heap 使用 Chromium `performance.measureUserAgentSpecificMemory()`；不可用时该次结果标记无 heap 证据，不能写为通过。保留三次 raw duration、median、peak heap、max slice、yield count 和 CPU profile。

门槛：median `<= 15000ms`；peak heap `<= 256 MiB`；active slice `<= 16ms`；yield count `> 0`。性能失败不得改变 fixture、credited duration、事件顺序、揭雾、路线、terrain 请求或结果 identity；只能优化实现并重跑。

## 版本初值

```text
DB_SCHEMA_VERSION = 1
SAVE_SCHEMA_VERSION = 1
GAME_RULES_VERSION = 1
CONTENT_VERSION = 1
EXPORT_FORMAT_VERSION = 1
GAMEPLAY_PROTOCOL_VERSION = 1
```

`GENERATOR_VERSION` 只从现有 generator worker `ready` message 读取。阶段 1 不修改 terrain bytes，因此预期仍为 `3`，但 gameplay 源码不得复制该数值为生成真源。

Rust dependency 决定：`wasm-bindgen = "=0.2.127"`、`fastnoise-lite = "=1.1.1"`，并提交 `rust/Cargo.lock`。`wasm:build` 向 cargo 传递 `--locked`。精确 pin 前捕获的 Gate B 九项 checksum 与 pin 后 native/WASM 结果完全相等，因此本次依赖封闭没有改变 terrain bytes，`GENERATOR_VERSION` 保持 `3`。

## 文档到 TypeScript 一一映射

[静态契约 fixture](../../web/tests/fixtures/phase-1-contract.json)固定版本、bounds、ID regex、消息字段、transferable、DB name/store/keyPath/record fields、封闭错误码和 benchmark Gate A/B 状态。`npm run test:contract` 执行 `tests/contract-schema.test.mjs`，验证 fixture canonical hash、边界推导、ID 正反例与 component bounds、lifecycle correlation、错误联合、负时钟、receipt 所有权、transferable 和 keyPath。该测试通过后才允许把 Gate A 标为 complete。

运行时 contract types 由 `contract-runtime.test.mjs` 和 `contract-schema.test.mjs` 直接导入 fixture 与源码，并验证：

1. runtime constants 与 fixture 完全相等；
2. 每个 union branch 的 exact validator 接受正例并拒绝缺失、未知、错误类型、错误范围和错误 transferable；
3. fixture 中的 `DBSchema` store/keyPath 与 exact record shape 已固定；工作包 4 还须用实际 upgrade 测试核对创建结果；
4. 文档中 `contract-fixture-sha256` 与 fixture canonical bytes 的 SHA-256 相等。

Gate B 由 `npm run fixture:anchor` 单独验证：该脚本通过实际 WASM 重新搜索，并要求 `start`、anchor tile、generator version 和 checksum 与 fixture 完全相等。`npm run test:performance` 仍须另行证明 `168h` 门槛；不得用 Gate B 代替性能结果。

`contract-fixture-sha256 = 596dcd09c4eaf78623e11b67ef809a51e32214f198f98641ad9655cf898c0bba`。输入是静态 fixture 递归按 object key code-point 排序、无空白和末尾换行的 UTF-8 bytes。任何契约变更都须同步更新 fixture、hash、runtime types 和测试。

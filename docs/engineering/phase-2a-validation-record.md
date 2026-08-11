# 阶段 2A 本地验证记录

- 日期：2026-08-11
- 范围：[阶段 2A：基础采集垂直切片](phase-2a-gathering-vertical-slice.md)
- 平台：macOS arm64
- Node.js：`24.14.1`
- Rust：stable `1.97.1`
- wasm-pack：`0.15.0`

## 结果

| 检查 | 结果 | 证据 |
|---|---|---|
| TypeScript strict | 通过 | `npm run typecheck` |
| 固定工具链 production build | 通过 | `npm run build`；release WASM、TypeScript 和 Vite build 完成 |
| runtime contract | 通过 | `npm run test:contract`，`11/11` |
| placement、settlement 与阶段 1 unit | 通过 | `npm run test:unit`，`35/35` |
| generator v3 anchor | 通过 | `npm run fixture:anchor`；seed `20260809`，anchor `(512,512)`，checksum `e05d5016e56b946b0cd541110e7dd5e23d9b7adb559f13842edfd8c175647939` |
| Worker、四-store 持久化、offline cap | 通过 | 专用 production harness，`13/13` |
| 产品 E2E 与渲染 smoke | 通过 | production preview，`12/12` |

真实采集 E2E 执行：创建 seed `20260809` 世界，确认初始已知野生纤维，提交 finite Gather，观察移动、采集中和完成状态，确认节点不再可采集、`fiber +1`、采集 XP `+6`、任务计数完成和待机，再 reload 验证未重复结算。产品 UI 另提供默认采集 `×10` 和持续采集入口。

固定 placement 单测锁定三个营地保证节点、负 content-cell floor division 和 `CONTENT_VERSION` 输入。settlement 单测锁定 `6000ms` 边界，并比较分段在线推进与 action 中途 reload 后一次性推进的节点、库存、XP 和任务结果。

## 按缩减门槛未扩展

- 未增加字段级 backup classifier、完整 quota/崩溃/retry 故障注入矩阵；保留既有基础 tamper、rollback 和 round-trip。
- 未增加多节点 continuous、`60000ms` 重生和长时间自动探索的浏览器时长矩阵；这些 transition 仍走同一 engine，当前浏览器 E2E只固定一次完整 finite action。
- 未运行 Rust benchmark 或重新生成 terrain golden。阶段 2A 未修改 Rust、terrain bytes 或 `GENERATOR_VERSION`；production WASM build 和既有 generator-v3 anchor 均通过。

## 已知非阻断项

- 离线 claim 中途重启后，权威状态和剩余 credited duration 可恢复；最终离线报告只统计重启后的增量，可能少报 checkpoint 前的收益。

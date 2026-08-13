# 阶段 3A 本地验证记录

- 日期：2026-08-13
- 范围：[阶段 3A：T1 狩猎与连续战斗](phase-3a-t1-hunting-combat.md)
- 平台：macOS arm64
- Node.js：`24.14.1`

## 结果

| 检查 | 结果 | 证据 |
|---|---|---|
| TypeScript strict | 通过 | `tsc --noEmit` |
| Vite production build | 通过 | 复用既有 generator-v3 产物执行 `vite build` |
| runtime contract | 通过 | contract/schema Node test，`11/11` |
| gameplay unit/broker | 通过 | Node test，`46/46` |
| Worker 与四-store 持久化聚焦回归 | 通过 | production Worker harness，`12/12` |
| 阶段 3A 产品主路径 | 通过 | production preview，`1/1` |
| 阶段 2C rope engine/reload 回归 | 通过 | 固定 engine fixture；永久结算、XP 与 reload 无重复 |
| 阶段 2C rope 产品 E2E | 未通过 | 紧邻前一 settlement 时按钮仍处于 command busy；单独重跑曾通过，最终聚焦重跑按收尾要求中止，不作为阶段 3A 阻断项 |
| release WASM 重建 | 未运行完成 | Homebrew Rust 缺少 `wasm32-unknown-unknown` target；`npm run build:test-worker` 在 WASM 步骤停止 |

## 固定证据

- 数值 fixture 固定 `x^1.4` 整数近似、实际属性概率、purpose-separated random、无偏闭区间伤害和 micro-HP 恢复。
- placement fixture 固定三个保证巢点、营地安全圈、负 cell 和资源优先冲突顺序。
- encounter fixture 覆盖 known-only Hunt、潜行出圈发奖、同 spawn cycle 去重和 Hunt 绕过。
- combat fixture 固定完整 attack trace、击杀原子结算、Melee XP `30`、`raw_hide ×1`、任务计数和 reload 不重复。
- movement fixture 覆盖自然战斗中途 reload，并验证战斗时间不推进 movement；击杀后从相同交战位置、相同 route 和 route index 继续。
- death fixture 覆盖任务保留、致死敌人重置、`60000ms` RespawnState、原地满生命复活和 `5000ms` RevivalGrace。
- 产品 E2E 使用 seed `20260809`，探索发现灰鬃野猪，执行 `Hunt ×1`，确认战斗、掉落、Melee XP、任务完成和 reload 不重复。

## 环境限制与未扩展范围

阶段 3A 未修改 Rust、terrain bytes、generator-v3 产物或 `GENERATOR_VERSION`。浏览器检查临时复用阶段 2C 工作树的依赖与既有 generator-v3 JS/WASM；这些忽略文件不进入提交。

按缩减门槛未新增 T2、工作站、Smithing、战斗装备、消耗品、远程、魔法、叙事、旧存档兼容、全 seed 胜率、长时间持续狩猎或全死亡时点矩阵。

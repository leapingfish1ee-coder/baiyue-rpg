# 阶段 2C 本地验证记录

- 日期：2026-08-13
- 范围：[阶段 2C：手工工艺与工具升级垂直切片](phase-2c-crafting-tool-upgrades.md)
- 平台：macOS arm64
- Node.js：`24.14.1`

## 结果

| 检查 | 结果 | 证据 |
|---|---|---|
| TypeScript strict | 通过 | `tsc --noEmit` |
| Vite production build | 通过 | `vite build`，26 modules transformed |
| runtime contract | 通过 | contract/schema Node test，`11/11` |
| recipe、生产、强化工具与既有 gameplay unit/broker | 通过 | Node test，`40/40` |
| Worker、四-store 持久化、备份与 offline cap | 通过 | production Worker harness，`13/13`，7.2 秒 |
| 产品与渲染主路径 | 通过 | production preview，`13/13`，2.1 分钟 |

产品与渲染回归包含阶段 1 探索、阶段 2B 伐木/采矿、阶段 2C rope、Debug、global lighting、Canvas2D/WebGL2 fallback、context loss 和 Lighting Lab。阶段 2A 采集行为由 rope E2E 的真实两次纤维采集覆盖。

## 产品主路径

真实产品 E2E 使用 seed `20260809`。新世界先提交 `Produce rope ×1`，确认进入 `MaterialsMissing` 并显示 `fiber 0/2`。测试随后探索到 generator-v3 实际世界中的第二个保证纤维节点，提交 `Gather wild_fiber ×2`，再提交 `Produce rope ×1`。结算后确认 `rope ×1`、Crafting XP `12` 和任务进度 `1/1`；reload 后再次确认数值不变。

固定 engine fixture 保留 Produce task 时注入库存变化并重载，证明 `MaterialsMissing` 在加载事件后重新评估。fixture 在生产周期中途 reload，按原 action deadline 完成，并验证原子扣除、产出、Crafting XP、任务计数、immediate commit 和再次 reload 不重复。continuous fixture 在材料用完后稳定返回 `MaterialsMissing`。

强化工具 fixture 从合法预置状态制作两件工具，验证永久等级门禁和原子 swap。Woodcutting 2 与强化斧的来源分别为 `50 bps` 和 `1000 bps`，软木树行动时间为 `9050ms`；Mining 2 与强化镐得到相同来源，地表石行动时间为 `10860ms`。

## 环境限制

仓库完整 `npm run build` 要求 `wasm-pack 0.15.0`。本机 PATH 为 `wasm-pack 0.14.0`。使用 rustup stable 与已安装的 `wasm32-unknown-unknown` target 编译 Rust 成功，但 `wasm-pack` 在安装匹配的 `wasm-bindgen` 阶段因本机工具链不兼容和受限安装失败。因此本次不把重新生成 release WASM 记为通过。

阶段 2C 未修改 Rust、terrain bytes 或 `GENERATOR_VERSION`。浏览器验证使用同一仓库阶段 2B worktree 的既有 generator-v3 WASM 产物；其 JS glue SHA-256 为 `d0773845303d73bb8c110f5d9a360c143f0aed41dcd28239b573689b9a415a06`，WASM SHA-256 为 `10c0559fff1260cac56a231d9491bf85dc242d2fe7ccc439738eda91f0a6c155`。这些忽略文件仅用于本地构建和浏览器验证，不进入提交。

## 按缩减门槛未扩展

- 未新增工作站、Smithing、铜刃、战斗装备、敌人、战斗、叙事或配方解锁测试。
- 未新增全配方产品浏览器矩阵；强化工具制作、门禁、swap 和实际速度来源由固定 engine fixture 覆盖。
- 未新增 quota、全崩溃时点、retry、长时间 continuous production 或旧存档兼容矩阵。

# 阶段 2B 本地验证记录

- 日期：2026-08-13
- 范围：[阶段 2B：伐木与采矿垂直切片](phase-2b-woodcutting-mining-vertical-slice.md)
- 平台：macOS arm64
- Node.js：`24.14.0`

## 结果

| 检查 | 结果 | 证据 |
|---|---|---|
| TypeScript strict | 通过 | `tsc --noEmit` |
| Vite production build | 通过 | `vite build`，26 modules transformed |
| runtime contract | 通过 | `npm run test:contract`，`11/11` |
| placement、settlement 与既有 gameplay unit | 通过 | `npm run test:unit`，`37/37` |
| Worker、四-store 持久化与 offline cap | 通过 | production Worker harness，`13/13` |
| 阶段 2B 真实产品 E2E | 通过 | production preview，`1/1`，44.9 秒（最终复跑） |
| 既有渲染主路径 | 通过 | debug、global lighting 与 Canvas2D/WebGL2 fallback，`10/10` |

真实产品 E2E 使用 seed `20260809`：先探索到第二棵保证软木树并确认两个已知树节点；提交 `Woodcut ×2`；首个 settlement 后，在第二周期中途卸下斧；确认未完成周期取消、进度保持 `1/2` 且进入 `MissingTool`；重新装备破旧斧并完成 `2/2`；提交 `Mine ×1` 并结算地表石；reload 后确认 `softwood ×2`、`stone ×1`、伐木 XP `20` 和采矿 XP `12` 均未重复结算。

固定 placement fixture 覆盖八个 guarantee slot、初始木/石、`6..20 tiles` 环内冗余、起始 chunk 外且 `64..96 tiles` 的边界铜矿、负 content cell 和固定 prototype 冲突顺序。settlement fixture 覆盖木、石、铜的 duration、材料、XP、任务计数、节点耗尽，以及工具变化取消未完成周期。mining 5 fixture 证明边界浅层铜矿可索取并结算 `copper_ore ×1` 与 XP `23`。

## 环境限制

仓库的完整 `npm run build` 要求 `wasm-pack 0.15.0`。本机 PATH 当前只有 `wasm-pack 0.14.0`，因此本次未把重新生成 release WASM 记为通过。阶段 2B 未修改 Rust、terrain bytes 或 `GENERATOR_VERSION`；TypeScript strict、现有 generator-v3 WASM 的 Vite production build 和真实浏览器路径均已通过。

## 按缩减门槛未扩展

- 未新增完整 quota、崩溃时点、retry 或字段分类矩阵。
- 未新增 `120000ms`、`240000ms` 长时间重生浏览器矩阵。
- 未新增全 prototype 浏览器矩阵；真实产品 E2E 只固定阶段 2B 要求的木、工具等待和地表石主链路。

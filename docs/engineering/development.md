# 开发说明

## 当前实施包

[阶段 1：探索垂直切片实施包](phase-1-exploration-vertical-slice.md)是当前第一个端到端工程阶段，状态为 **Ready for implementation**，前提是 [Decision-0003](../decisions/0003-first-playable-slice-baseline.md) 已 Accepted。它要求交付可运行的新世界创建、探索任务、自由向量移动、永久揭雾、Exploration XP、IndexedDB 存档、离线推进、map-first UI 和 Debug 分离，不接受空模块或测试桩作为完成。

开始编码前，专项必须先补齐并交叉链接 stable ID grammar、Worker/UI unions 与 command idempotency、IndexedDB keyPath、canonical backup/error code 和 benchmark fixture。新增 unit、integration、E2E 与 performance scripts 后，必须把准确命令补充到本页和[验证标准](validation.md)。当前仓库仍未实现该切片。

## 环境

- Node.js 22 或更高版本。
- Rust stable。
- Rust target `wasm32-unknown-unknown`。
- `wasm-pack 0.15.0`，与 Pages workflow 一致。

当前仓库没有 `Cargo.lock` 或前端 lockfile。`Cargo.toml` 和 `package.json` 虽写明直接依赖版本，完整依赖图仍未锁定；不要把当前安装描述为跨构建可复现。

## 首次准备

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked --version 0.15.0
cd web
npm install
```

`npm install` 会按 `web/package.json` 解析依赖。新增 lockfile 应作为独立工程变更评审，不属于文档任务。

## 本地运行

```bash
cd web
npm run dev
```

`dev` 先通过 `wasm-pack` 把 `rust/` 编译到 `web/public/wasm/`，再启动 Vite。不要手工编辑 `web/public/wasm/` 下的生成文件。

常用命令：

| 命令 | 实际动作 |
|---|---|
| `cd rust && cargo test` | 运行 native Rust tests |
| `cd rust && cargo run --release --example benchmark` | 生成 1000 个 chunk 并报告耗时/checksum |
| `cd web && npm run wasm:build` | release 模式构建 Rust → WebAssembly |
| `cd web && npm run typecheck` | `tsc --noEmit` |
| `cd web && npm run build` | `wasm:build`、TypeScript 检查、Vite production build |
| `cd web && npm run test:smoke` | Playwright 启动 production preview 并运行 Chromium tests |

## 入口

- 主地图：Vite 根路径。
- Lighting Lab：`/lighting-lab/`。
- `?shader=off`：强制完整 Canvas2D。
- `?shaderTime=<seconds>`：冻结 shader 动画时间。
- `?lighting=neutral`：保持 enhanced renderer，使用中性光照参数。
- `?lighting=off`：保持 enhanced renderer，关闭全局光照 stage。

## 变更边界

- 当前阶段拆分、顺序和完成证据见[探索垂直切片实施包](phase-1-exploration-vertical-slice.md)。
- 世界生成事实和规则见[世界生成架构](../architecture/world-generation.md)。
- Worker 和渲染所有权见[Streaming 与渲染](../architecture/streaming-rendering.md)。
- Terrain Sheet 见[规范](../specifications/terrain-sheet-v3.md)。
- 产品行为必须先在[需求目录](../requirements/index.md)确认，不能从研究材料或路线图直接推断。

不新增 production dependency，除非变更说明明确证明浏览器平台、Rust 标准库或仓库现有代码不足。保持 TypeScript `strict` 和 `noUncheckedIndexedAccess`；不得通过弱化类型设置绕过边界问题。

## Pages

`.github/workflows/pages.yml` 在 push 到 `main` 或手动触发时：

1. 安装 Rust stable、WASM target 和 `wasm-pack 0.15.0`。
2. 运行 Rust tests。
3. 安装 Node.js 22 和前端依赖。
4. 以仓库 base path 构建站点。
5. 安装 Chromium 并运行 smoke tests。
6. 只有 build job 成功后才部署 `web/dist`。

CI 是远端门禁。它不能替代需要在本地验证但未执行的检查。

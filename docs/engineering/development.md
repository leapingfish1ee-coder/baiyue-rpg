# 开发说明

## 当前实施包

[阶段 1：探索垂直切片实施包](phase-1-exploration-vertical-slice.md)是当前第一个端到端工程阶段，[Decision-0003](../decisions/0003-first-playable-slice-baseline.md) 已 Accepted。当前工作区已实现新世界创建、探索任务、自由向量移动、永久揭雾、Exploration XP、IndexedDB 存档、离线推进、map-first UI 和 Debug 分离；准确范围见[当前状态](../product/current-state.md)。

编码前契约已补齐并交叉链接 stable ID grammar、Worker/UI unions 与 command idempotency、IndexedDB keyPath、canonical backup/error code 和 benchmark fixture。

上述门禁的 Gate A 已由[阶段 1 运行时契约](../specifications/phase-1-runtime-contracts.md)和 `npm run test:contract` 封闭。Gate B 已由 `npm run fixture:anchor` 使用正式 anchor search 和实际 WASM generator v3 封闭。两项门禁完成不表示 `168h` performance fixture 已通过。实现必须直接复用其中的版本、字段、keyPath、错误码和静态 fixture，不得建立第二套隐式协议。

## 环境

- Node.js 22 或更高版本。
- Rust stable。
- Rust target `wasm32-unknown-unknown`。
- `wasm-pack 0.15.0`，与 Pages workflow 一致。

Rust 以 `rust/Cargo.lock` 锁定依赖图，并把 generator 直接依赖精确固定为 `wasm-bindgen 0.2.127` 与 `fastnoise-lite 1.1.1`。前端以 `web/package-lock.json` 锁定依赖图；`idb` 精确固定为 `8.0.3`。`wasm:build` 使用 lockfile。必须使用 Node.js 22 或更高版本执行 npm scripts；更旧的 Node 不是受支持环境。

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
| `cd web && npm run fixture:anchor` | 使用已构建的实际 WASM generator 重新搜索并核对固定 Gate B anchor |
| `cd web && npm run test:contract` | Node test runner 验证 Gate A 静态 schema fixture；不启动浏览器或 server |
| `cd web && npm run test:unit` | Node test runner 运行纯 gameplay/fixed-point、broker 与 ChunkManager fixture；不启动浏览器 |
| `cd web && npm run test:worker` | 重建 WASM 和专用 `dist-worker-test`，再由 Playwright 单 worker 运行 direct-engine/真实 module Worker/broker/generator 等价与协议失败 fixture |
| `cd web && npm run test:persistence` | Playwright 单 worker 运行真实 IndexedDB、Web Lock、backup 和故障 fixture |
| `cd web && npm run test:e2e` | Playwright 单 worker通过 production preview 运行阶段 1 用户流程 |
| `cd web && npm run test:performance` | 重建专用 Worker 产物，由 Playwright 验证 `168h` cap、claim 提交和 15 秒 wall-clock 门槛；完整 continuous 三次 benchmark 仍列为技术债 |
| `cd web && npm run test:smoke` | Playwright 启动 production preview 并运行 Chromium tests |

`test:worker`、`test:persistence` 和 `test:performance` 设置专用 build 标志后才把 `worker-harness.html` 加入 `dist-worker-test`；正式 `npm run build` 不生成或发布该入口。`test:e2e` 和 `test:smoke` 使用 production preview。浏览器测试需要先安装 Chromium。

## 入口

- 产品探索地图：Vite 根路径。
- 渲染诊断：`/world-debug.html`。产品构建不在产品 UI 中显示入口。
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

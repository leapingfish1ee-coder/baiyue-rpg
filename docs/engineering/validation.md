# 验证标准

验证按变更影响路由。执行结果必须区分“通过”“失败”“未运行及原因”。不得把 CI 预期结果写成本地通过。

## Rust 或世界语义变更

最低检查：

```bash
cd rust
cargo test
```

生成成本或 streaming 量可能变化时，再运行：

```bash
cd rust
cargo run --release --example benchmark
```

可能改变生成字节的变更在合并前还必须：

1. 显式决定并修改 `GENERATOR_VERSION`。
2. 更新固定 golden checksum fixtures，覆盖代表性 seed、正坐标、负坐标、零点两侧、chunk 边界和远距离坐标。
3. 构建 WASM，并用同一组向量比较 native 与 WASM 的完整 bytes/checksums。
4. 确认 payload 恰为 `8192` 字节，ID 范围有效，`Decoration` 只在 `Land`。
5. 确认相邻连续场、对称 `EdgeContract` 和访问顺序独立性。
6. 更新世界生成、协议和版本文档。

仓库已提供固定 anchor/golden fixture 与 native/WASM 对照 runner。涉及生成字节的下一项变更仍须按现有版本规则更新并复验，不能只用普通 unit tests 替代。

MVP 不迁移或保留旧生成器、旧世界和旧存档。`GENERATOR_VERSION` 与 golden 更新只证明变化有意。

## TypeScript、UI、Worker 或渲染变更

```bash
cd web
npm run typecheck
npm run build
npm run test:contract
npm run fixture:anchor
npm run test:unit
npm run test:worker
npm run test:persistence
npm run test:e2e
npm run test:performance
npm run test:smoke
```

`npm run build` 已包含 WASM release build 和 TypeScript 检查；仍单独运行 `typecheck`，便于更快定位类型错误。`test:contract` 与 `test:unit` 只使用 Node test runner。`fixture:anchor` 需要 `wasm:build` 已生成实际 WASM，并核对 Gate B 固定起点。`test:worker` 使用专用 `dist-worker-test` 和 `preview:test-worker`；正式 build 不包含 harness。其余新增测试和 smoke 由 Playwright config 启动 `npm run preview:test`，目标是 production preview，不需要另开 server。准确 fixture 和职责见[开发说明](development.md)与[阶段 1 运行时契约](../specifications/phase-1-runtime-contracts.md)。

Worker 或 protocol 变化还必须验证：

- 成功、错误、取消和 epoch 失效后 `pending` 都被清理；
- stale epoch 的结果与错误都被忽略；
- payload 长度、坐标整数范围、版本和消息 identity 在边界被校验；
- outstanding work 有上限，可见中心优先于 preload；
- retry 只覆盖有界瞬时错误，永久失败不阻断其他世界区域。

渲染所有权或 failure path 变化还必须覆盖：

1. 正常 WebGL2 enhanced mode；
2. `?shader=off` 的完整 Canvas2D；
3. 强制 WebGL2 不可用；
4. `WEBGL_lose_context`；
5. runtime WebGL error；
6. base texture 与 decoration layer 顺序一致；
7. 无 reload、regeneration 或 network 时，下一帧能从内存数据恢复完整静态世界。

接受的视觉算法变化必须用 `?shaderTime=<seconds>` 固定时间并提供 before/after screenshot evidence。shader-source assertion 不是视觉证明。

坐标变更必须测试 JavaScript number、`BigInt`/WASM integer、Rust `i64`、noise、Canvas2D 和 WebGL2 的共同支持范围，并覆盖零点两侧和声明的远端边界。

## 仅文档变更

不运行无关的 Rust、WASM 或完整浏览器渲染测试。必须：

1. 对照源码核对命令、常量、版本、尺寸、schema 和现状陈述。
2. 检查所有相对 Markdown 链接、目录导航和移动后的旧路径引用。
3. 搜索过时术语、重复规范和未经证实的兼容/无限精度/持久化表述。
4. 检查 `git diff --check`、`git diff` 和 `git status --short`。

外部研究材料应注明检索日期、来源类型和直接链接。研究结论不得写成本项目需求。

## 完成标准

- 实现位于正确语义层，并与已确认需求一致。
- 相关成功路径、失败路径和边界情况均有证据。
- 生成或持久化契约完成明确版本决定。
- 所有运行检查通过，或逐项列出未运行原因。
- 文档不夸大 RPG 完成度、持久化或坐标范围。
- `git status --short` 只包含预期改动。

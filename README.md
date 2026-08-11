# Baiyue RPG

Baiyue RPG 的长期目标是单人放置冒险、碎片叙事 RPG。当前仓库仍是确定性流式地形引擎 MVP，不是可玩 RPG。

## 当前能力

- Rust/WASM 按 `seed` 和 chunk 坐标生成确定性 `64×64` 地形。
- Web Worker 在 UI 线程外生成并流式加载 chunk。
- Canvas2D 提供完整静态渲染，WebGL2 提供动态纹理、曝光和世界空间云影。
- Terrain Sheet v3 支持浏览器上传、预览和本地保存。

当前没有角色、任务、技能成长、战斗、探索、导航、碰撞、游戏状态持久化或网络/市场系统。浏览器只会保存纹理和调试参数，不会保存世界进度。

## 演示

[GitHub Pages](https://leapingfish1ee-coder.github.io/baiyue-rpg/)

## 最小快速开始

需要 Node.js 22+、Rust stable、`wasm32-unknown-unknown` 和 `wasm-pack 0.15.0`。

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked --version 0.15.0
cd web
npm install
npm run dev
```

## 文档

[文档总览](docs/index.md) 是产品需求、架构契约、工程验证和决策记录的入口。贡献前请先阅读 [开发说明](docs/engineering/development.md) 和 [验证标准](docs/engineering/validation.md)。

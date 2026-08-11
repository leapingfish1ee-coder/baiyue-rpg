# 阶段 1 探索垂直切片验证记录

- 日期：2026-08-11
- 工作区起点：`7383ad4014fb2530a1ca0056e55f54e83289ff10`
- Node.js：`v24.14.0`
- Rust：`rustc 1.97.1 (8bab26f4f 2026-07-14)`
- wasm-pack：`0.15.0`
- wasm-bindgen CLI：`0.2.127`
- Playwright：`1.60.0`
- 浏览器：Playwright Chromium v1223

## 通过结果

| 检查 | 结果 |
|---|---|
| `cargo test --locked` | 15 个 Rust unit tests、1 个 native anchor fixture 通过；doc tests 0 项 |
| `npm run fixture:anchor` | generator v3、seed `20260809`、`WorldPoint(512,512)`、9 个 chunk 与 checksum `e05d5016e56b946b0cd541110e7dd5e23d9b7adb559f13842edfd8c175647939` 一致 |
| `npm run typecheck` | 通过 |
| `npm run test:contract` | 11/11 通过 |
| `npm run test:unit` | gameplay unit、broker 和 ChunkManager 33/33 通过 |
| `npm run build` | fixed Rust/WASM 工具链 release build、TypeScript 和 Vite production build 通过 |
| Worker/持久化/performance/E2E 合并回归 | 最新 `dist-worker-test` 上 14/14 通过：Worker 7、persistence 5、performance 1、核心 E2E 1 |
| production Debug/WebGL2 smoke | Debug 与 lighting 4/4 通过 |
| production 渲染降级 smoke | Canvas2D unavailable-WebGL、context loss、纹理参数和 Lighting Lab 6/6 通过 |

专用 bundle 晚于全部相关源码和测试文件。关键产物 SHA-256：

- `gameplay-worker-USQZAPcz.js`：`d1a4a5ea4c744a273d986b5b35f47ab4980606909c1dc18e6fd37fa22d0ec362`
- `workerHarness-VZ97gUrn.js`：`856afc2f31016828903a937002c6161e0a44dbdce5620c7ae47fc9f594111e26`

## 168 小时离线 smoke

固定空闲存档从 wall clock `1000` 推进到 `604813345`：

- raw elapsed：`604812345ms`
- credited：`604800000ms`
- discarded：`12345ms`
- 提交后 `world_time_ms`：`604800000`
- save revision：`2`
- 剩余 resume claim：`0`
- 单次实测 wall-clock：`19.4ms`

该结果只证明 cap、claim、同 engine 空闲快进和原子完成主路径。它不替代实施包要求的 continuous-exploration 三次 median、peak heap、16ms slice 和 profile 记录；该缺口列入[当前状态](../product/current-state.md)技术债。

## 未纳入完成门槛

- 未扩展字段级 backup classifier 和全量 quota/crash/retry 故障矩阵。非法存档仍拒绝启动，现有主路径 smoke 保留。
- 未保留绕过 Web Lock、由主线程并发直接篡改 IndexedDB 的人工 create-conflict fixture。该行为不属于受支持写入路径。
- 未提交、推送、创建 PR 或部署。

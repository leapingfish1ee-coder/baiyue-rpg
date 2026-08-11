# 世界生成架构

## 权威输入与输出

世界生成必须是以下输入的纯函数：

```text
(world seed, GENERATOR_VERSION, absolute integer world coordinates)
                           ↓
               deterministic semantic terrain
```

当前 `GENERATOR_VERSION = 3`。`generate_chunk(seed, chunk_x, chunk_y)` 的 WASM 参数映射为 Rust `u64, i64, i64`，JavaScript Worker 通过十进制字符串和 `BigInt` 传递整数。

一个 macro cell 等于一个 runtime chunk，包含 `64×64 = 4096` 个 playable tiles。

## Payload

一次调用返回一个连续 `8192` 字节 payload：

| 字节范围 | 长度 | 语义 |
|---|---:|---|
| `0..4095` | `4096` | `BaseTerrain` plane |
| `4096..8191` | `4096` | `Decoration` plane |

`BaseTerrain` ID：

| ID | 值 |
|---:|---|
| 0 | `DeepWater` |
| 1 | `Water` |
| 2 | `Sand` |
| 3 | `Land` |
| 4 | `Rock` |
| 5 | `Snow` |

`Decoration` ID：

| ID | 值 |
|---:|---|
| 0 | `None` |
| 1 | `Grass` |
| 2 | `Grove` |

每个 tile 恰有一个 `BaseTerrain`。`Decoration` 是独立 overlay，只能出现在 `Land`。碰撞、导航、资源和可见目标必须使用各自语义层，不能从地形纹理推断。

## 连续性

宏观 elevation 和 moisture descriptor 在 macro cell 中心采样。每个 chunk 构造周围 `3×3` macro neighborhood；tile 用绝对世界坐标换算到 macro space，再对相邻中心做 smooth interpolation。相邻 chunk 因此采样同一连续场，而不是各自启动随机生成器。

局部 elevation/moisture 也使用绝对 world tile 坐标。`Grass` 使用坐标 hash；`Grove` 使用 `8×8` coarse cell 中的稀疏 cluster seed 和 singleton stream。所有随机流都由 world seed、稳定 tag 和绝对坐标派生，不能依赖访问顺序。

负坐标使用连续 Euclidean addressing。任何坐标运算变更都必须测试零点两侧、chunk 边界和负方向。

## EdgeContract

`rust/src/macro_world.rs` 的 `EdgeContract` 对一对相邻 macro cell 进行对称 hash，因此从边界两侧查询会得到相同签名。

当前连续地形场已经处理 terrain seam。`EdgeContract` 尚未驱动实际结构；它只为未来河流、道路、墙/门或入口等离散跨区结构提供共享边界决策基础。新增结构必须定义自己的版本化派生规则，不能只凭一侧 chunk 决策。

## 版本政策

MVP 不维护旧世界、旧生成器、旧协议或旧存档兼容。可能改变生成字节的改动仍必须在同一变更中完成：

1. 显式决定并修改 `GENERATOR_VERSION`。
2. 更新代表性 seed 和正、负、边界、远距离坐标的固定 golden checksum fixtures。
3. 用同一组向量比较 native 与 WASM 输出。
4. 更新本文件、payload 协议和受影响需求。

版本号和 golden fixtures 用于证明变化有意且可复现，不用于保留旧生成器。当前仓库尚缺固定 golden fixtures 和 lockfiles，这是阻断下一次生成语义变更的技术债。

## 坐标限制

Rust 在 `chunk_x * 64` 或 `chunk_y * 64` 超出 `i64` 时会 panic。噪声库把绝对 `i64` 坐标转换为 `f64`。浏览器 streaming 又先把 camera 推导的 chunk 坐标限制为 JavaScript safe integer。渲染还有 Canvas2D 和 float32 GPU 精度限制。

因此当前不能宣称完整 `i64`、无限精度或“有效无限”范围。建立支持范围前必须端到端测试 JavaScript number、`BigInt`、WASM integer、Rust `i64`、noise、Canvas2D 和 WebGL2。

## 验证

世界语义变更的完整门禁见[验证标准](../engineering/validation.md#rust-或世界语义变更)。当前 Rust tests 已覆盖若干不变量，但不能替代固定跨构建 golden vectors。

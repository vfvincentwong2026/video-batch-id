# 05 · 生成层 Provider 三路对比与决策建议

> PM 报告 · 2026-10-26 · 决策状态：**待拍板**
> 输入：README 部署模式与许可证矩阵、docs/00 PM 研究结论（本机无 GPU，生成层必须外置）、v0.3 已落地的语义解析链路
> 价格行情核对日期：2026-10（来源见文末，下单前以官方页为准）

---

## 结论先行

**推荐：B 路线（第三方视频 API）冷启动，A 路线（云 GPU 自托管 Wan 2.2）设规模触发线，C 路线（OpenRouter 视频模型）降级为应急回退。**

```
现在（v0.4）          规模线触发后（>600 条/月）      终态
fal.ai 聚合 ──►  Kling 3.0 I2V 主力        评估启动 A 路线           A 路线为主
  │              首帧锚定 + 双守卫把关        （边际成本交叉）          B 路线为峰值冗余
  └─► OpenRouter 视频模型 = 应急回退（C）
```

核心理由一句话：**二创工作流的价值在"批量 + 守卫 + 谱系"，不在单次生成质量——用按量付费的 API 先把商业闭环跑通，把自托管的重资产留到量级证明之后。**

---

## 一、需求画像（先对齐再比）

| 维度 | 本项目实际 |
|---|---|
| 内容形态 | 印尼短视频电商二创，9:16，单条 5–15s，Master 驱动 I2V |
| 批量节奏 | 当前：30 条/批 × 每周数批；验证后：300–1000 条/月 |
| 质量约束 | 产品外观/关键动作/品牌色锁定（变量矩阵 locked 项）→ **首帧锚定 + 保真守卫是硬需求** |
| 合规约束 | 商用无门槛优先（README 许可证矩阵：Wan 2.2 Apache 2.0 为主锚点；HunyuanVideo 排除 EU/UK/韩国） |
| 运维现实 | 单人项目，无专职运维；本机无 GPU（00 号报告定论） |

---

## 二、三路对比

### A · 云 GPU 自托管 Wan 2.2（ComfyUI）

| 维度 | 评估 |
|---|---|
| 单条成本 | RTX 4090 租用约 $0.3–0.8/h（RunPod/Vast.ai），TI2V-5B 5s 480p 约 1–2 分钟/条 → **边际 $0.01–0.03/条**，量级越大越便宜 |
| 月度成本 | 轻度（挂机待命）≈ $100–200；满负荷 ≈ $300–500 |
| 质量 | 可控性最强：ControlNet / IP-Adapter 与变量矩阵、guards 包天然契合；5B 档质量中等，14B 档需 A100 |
| 合规 | **最干净**：Apache 2.0 无收入门槛、无地区排除，输出权利清晰 |
| 接入工作量 | **最大**：ComfyUI workflow 编排、50GB 权重管理、队列/并发/故障恢复、GPU 供应商选型，估 1–2 周工程 |
| 运维负担 | 高：驱动/CUDA/模型版本、空闲计费浪费、半夜挂掉没人管 |

### B · 第三方视频 API（fal.ai 聚合 / Kling 官方 / 其他）

| 维度 | 评估 |
|---|---|
| 单条成本 | Kling 3.0：$0.07–0.14/s（5s 720p ≈ **$0.35–0.7/条**）；fal.ai 同模型 $0.084/s；Veo 3.1 Fast $0.10/s（高端溢价）；Hailuo $0.01–0.03/s（见风险） |
| 月度成本 | 300 条 ≈ $105–210；1000 条 ≈ $350–700（纯按量，零闲置） |
| 质量 | Kling 物理/人物动作当前第一梯队，**I2V 首帧控制成熟**，恰好匹配"锁产品外观"需求；Kling API **失败任务不计费**，适合批量试错的二创场景 |
| 合规 | Kling/fal.ai 商用条款成熟；⚠️ **Hailuo（MiniMax）2025-09 被好莱坞片厂版权诉讼，商用不建议押注**；Veo 走 Google 生态绑定 |
| 接入工作量 | **最小**：async task API + webhook，在 pipeline 包新增 provider 即可（接口形态与现有 mock provider 完全一致），估 2–3 天 |
| 运维负担 | 几乎为零；注意各家并发上限（Kling API 5–20 并发） |

### C · OpenRouter 视频模型（单 key 统一管理）

| 维度 | 评估 |
|---|---|
| 价格 | Kling v3.0 Pro $0.168/s —— **比 fal.ai 贵 2 倍**（转售加价）；模型覆盖远少于 fal.ai |
| 质量 | 同上游模型 |
| 合规 | 转售层叠加一层 ToS |
| 接入工作量 | 最小（复用现有 OpenAI 兼容客户端），但省下的工程量不值 2 倍差价 |
| 定位 | **不作主力**；作为 B 的降级链入口（fal.ai 故障时兜底），与现有 vlm-api 回退链设计一致 |

---

## 三、成本交叉点（B → A 的规模触发线）

| 月生成量 | B 路线成本（$0.5/条均） | A 路线成本（GPU $200 + 边际） |
|---|---|---|
| 300 条 | $150 | ≈ $210（A 更贵，且没算人力） |
| 600 条 | $300 | ≈ $225（**交叉点**） |
| 1000 条 | $500 | ≈ $240 |

> 触发线设为 **600 条/月**：低于它 B 全面占优；超过它 A 的边际成本优势显现，此时启动 A 的工程评估（1–2 周）刚好不亏。注意 A 的真实门槛还有"愿意接手运维"这一条，到点再议。

---

## 四、推荐方案细节（B 路线落地形态）

```
pipeline 包新增 GenerationProvider 接口实现：
┌─────────────────────────────────────────────┐
│ provider: fal-ai（聚合层，VBID_GEN_BASE_URL）│
│ 主力模型: kling-v3-i2v（首帧=Master关键帧）   │
│ 降级链:   kling → veo-3-fast → OpenRouter   │
│ 参数注入: 变量矩阵 assignments → prompt 映射   │
│           锁定项（产品外观等）→ negative/约束  │
│ 计费口径: 沿用 rate_per_variant_usd 预估      │
└─────────────────────────────────────────────┘
```

- **首帧锚定**：用 Master 的 Hook 镜头关键帧做 I2V 首帧，产品外观天然锁定，双守卫压力骤减
- **守卫前置**：Demo 预览（第④步）已让运营先淘汰差组合，API 调用只花在好组合上——直接砍 30–50% 生成费
- **成本预估**：UI 已展示 $/批，接入后换成真实单价，预期 $0.35–0.7/条 × 30 条 ≈ $10–21/批
- **合规备注**：输出商用前逐家核对 ToS 版权条款（与 README 许可证矩阵同流程）

---

## 五、风险与对策

| 风险 | 对策 |
|---|---|
| API 单价下调/A 路线开源模型迭代（Wan 2.6 已出） | 触发线每季度复盘；provider 接口抽象保证可换 |
| fal.ai/Kling 账号与额度 | OpenRouter 降级链已就位；Kling 官方包可作第二供应商 |
| 批量生成被风控 | 队列页已有并发控制位；Kling API 并发 5–20 任务，需排队器 |
| 印尼语口播（v0.3 的 verbal Hook） | 生成层不管音频：TTS（Edge-TTS/Sahabat AI）属 v0.5 文案变量层，与本决策正交 |

---

## 六、拍板清单

1. [ ] 批准 B 路线冷启动（fal.ai + Kling 主力）
2. [ ] fal.ai 注册充值（$10 起步可跑 2–3 批演示）
3. [ ] A 路线触发线确认为 600 条/月（可调）
4. [ ] 我来实现 `gen-fal-ai` provider（2–3 天工程量：接口 + 队列适配 + 真实计费回写 + 测试）

---

## 附：价格来源（2026-10 核对）

- Kling 3.0 秒费与 API 套餐：[CloudZero Kling pricing](https://www.cloudzero.com/blog/kling-ai-pricing/)、[Shhots Kling 定价核查](https://shhots.ai/blog/kling-ai-pricing/)（2026-08 验证，fal.ai $0.084/s vs Replicate $0.168/s）
- 多模型秒费对比：[FluxNote AI Video Pricing 2026](https://fluxnote.io/guides/ai-video-model-pricing-comparison-2026)（2026-10-22 更新）
- Hailuo 低价与诉讼风险：[aimagicx 三方对比](https://www.aimagicx.com/blog/kling-vs-runway-vs-hailuo-video-comparison-2026)、[felloai 法律风险](https://felloai.com/2025/10/the-best-ai-video-generators-of-2025-a-comparison-of-sora-2-veo-3-pixverse-hailuo-and-grok/)
- OpenRouter 转售加价：[Shhots OpenRouter 行](https://shhots.ai/blog/kling-ai-pricing/)

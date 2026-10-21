# video-batch-id
印尼短视频批量素材生成工作站 · L1 验证型 MVP · 开源拼装：pixhub + ComfyUI + reel-kit + voice-compute · 自研仅批量输入/模板映射/成本观测
# Video Batch ID

面向印尼中小卖家与代运营的**批量短视频素材生成工作站**（L1 验证型 MVP）。

不做“又一个 AI 视频工具”，只验证三件事：批量需求是否真实、付费意愿是否成立、单位经济是否可控。

> 仓库代号：`vbid`

---

## 目标

| 假设 | 验证指标 |
|---|---|
| 批量需求真实 | ≥30% 试用用户单次生成 10 条以上；≥20% 在 7 天内产生第二批 |
| 付费意愿成立 | 试用转付费率 ≥5%–8%；≥5 个种子用户愿意付费或已预付 |
| 单位经济可控 | 单条综合成本 ≤ 定价的 60%；至少一个成本档位毛利率 ≥40% |

三个假设中任意两个不成立，不进入 L2 平台化。详见 [docs/prd.md](docs/prd.md)。

---

## 架构：开源拼装，只写胶水
对外 API 层 free-multimodal-proxy / ComfyUI-OpenAI-API-Refactored
│
路由层 pixhub（Provider 适配器 + 降级链 + 成本档位路由）
│
批量生成层 kt-ai-Studio 骨架 + ComfyUI（Wan 2.x 等工作流）
│
合成层 reel-kit（素材 + 印尼语脚本 + TTS → 竖版成品）
│
语音层 voice-compute（Edge-TTS 印尼语 + Whisper 字幕时间戳）

text

**自研范围仅三块**：
1. 批量输入解析（卖点表/链接 → 脚本 + 素材清单）
2. 印尼本地化模板映射（品类 + Hook → workflow 参数 + HTML 模板）
3. 成本观测胶水（每任务记录 Provider / 耗时 / 重试 / 成本）

详见 [docs/architecture.md](docs/architecture.md)。

---

## 快速开始

```bash
cp .env.example .env
docker compose up -d
# Web:  http://localhost:3000
# API:  http://localhost:8000
首次启动会拉取 ComfyUI 镜像并下载模型权重，请预留磁盘空间与时间。

目录结构
text
video-batch-id/
├── apps/
│   ├── web/                 # 批量工作流 UI
│   └── api/                 # 胶水层：输入解析 + 任务分发
├── packages/
│   ├── template-engine/     # 品类+Hook → workflow/HTML 映射
│   └── cost-tracker/        # 成本记录与聚合
├── vendor/                  # 依赖服务的配置与版本锁定（不放源码）
├── docs/
│   ├── prd.md
│   ├── architecture.md
│   ├── cost-model.md
│   └── licenses.md
└── docker-compose.yml
项目状态
当前阶段：W1–W2 预研与成本实测

里程碑：见 GitHub Projects「vbid MVP 8 周」

决策点：第 8 周 Go/No-Go 评审

周次	里程碑
W1–2	用户访谈 + 成本实测 + 模板初稿
W3–4	批量工作流骨架（输入/队列/适配器/成本记录）
W5–6	本地化模板 + 生成闭环
W7	种子用户测试（10–15 人）
W8	Go/No-Go 评审
红线
不对外承诺“无限免费生成”。

不把外部免费 API 作为长期成本假设，仅作冷启动与溢出层。

不做通用单条精修编辑器。

核心依赖优先 MIT / Apache 2.0；AGPL 与“商用需授权”项目仅作参考，不进入核心依赖链。

许可证
本项目为私有项目，暂未开源。第三方依赖许可证清单见 docs/licenses.md。

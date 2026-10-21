<div align="center">

# Video Batch ID

**面向电商与 MCN 的批量短视频素材工作站**

<sub>生成 · 入库 · 复用 · 越用越准</sub>

[![CI](https://github.com/your-org/video-batch-id/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/video-batch-id/actions)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white)](#快速开始)
[![Python](https://img.shields.io/badge/python-3.11+-3776AB?logo=python&logoColor=white)](#技术栈)
[![Node](https://img.shields.io/badge/node-20+-339933?logo=node.js&logoColor=white)](#技术栈)
[![Cloudflare](https://img.shields.io/badge/cloudflare-tunnel%20%2B%20d1-F38020?logo=cloudflare&logoColor=white)](#部署模式)
[![License: Private](https://img.shields.io/badge/license-Private-lightgrey)](#许可证)

[为什么](#为什么) · [目标用户](#目标用户) · [核心工作流](#核心工作流) · [食品案例](#案例dapur-ibu-的一周食品素材生产) · [功能](#功能) · [架构](#架构) · [界面概览](#界面概览) · [快速开始](#快速开始) · [路线图](#路线图) · [English](#english)

</div>

---

## 为什么

生成一条好视频是创意问题；**每周产出一百条可用素材**是流程问题。

Video Batch ID 为后者而建。上传一批商品或脚本，选一个已验证的模板，拿到上百条变体，标记好的，让素材库越用越准。每一条被复用的素材，都会让下一批更聪明。

**设计原则**

- **素材优先，任务其次** — 每条产出都进入可检索的素材库，带结构化元数据。任务是瞬时的，素材是复利的。
- **模板优先，提示词其次** — 运营从已验证的配方中选，不从空白输入框开始。
- **批量是默认值** — 一次上传，多条产出，无需逐条照料。
- **成本可见** — 提交前看到预估价格，运行后看到真实花费。
- **组装，而非重造** — 路由、生成、合成、语音均复用成熟开源项目。

---

## 目标用户

| 用户 | 当前痛点 | 得到什么 |
|---|---|---|
| **电商卖家 / UMKM** | 有商品图，视频制作慢且贵 | 上传 SKU 表 → 批量商品展示视频、虚拟试穿、多角度变体 |
| **MCN / 代运营** | 需要量、风格一致性和单条控制 | 多账号批量生成、单镜头重绘、角色/风格一致性 |
| **内容运营** | 每条视频花数小时，不知道什么有效 | 一个工作台：生成、审核、评分、复用。每一步成本可见。 |

---

## 核心工作流

### 电商：商品图批量转视频

```
① 上传商品 → ② 选模板 → ③ 设批量参数 → ④ 提交生成
                                                ↓
⑦ 复用/二次生成 ← ⑥ 自动入库 ← ⑤ 审核标记（好/坏）
```

| 步骤 | 你看到 | 你做什么 | 系统做什么 |
|---|---|---|---|
| ① 上传 | 拖拽区 + CSV 模板 | 拖商品图、上传 SKU 表 | 解析 SKU、提取卖点、识别品类 |
| ② 选模板 | 卡片画廊，每个带 3 秒预览 | 点选“美妆·痛点解决·TikTok” | 加载 Skill 配方 + Provider 偏好 |
| ③ 设参数 | 滑块：每个 SKU 几条变体、成本档位、时长 | 拖动滑块，实时看到预估成本 | 计算预估成本，锁定预算上限 |
| ④ 提交 | 任务队列看板，每条带进度 | 等待或离开 | 路由到 GPU、异步生成、失败自动降级 |
| ⑤ 审核 | 网格视图，可播放，可标记 👍/👎 | 快速过一遍、标记、写备注 | 记录 outcome，回写知识层 |
| ⑥ 入库 | “已入库 87 条”提示 | 一键入库 | Argus 风格视觉元数据 + 标签 + 嵌入 |
| ⑦ 复用 | 素材库搜索框 | 搜“美妆 + 油皮 + 上周” | 全文检索 + 语义检索 |

### MCN：矩阵批量

流程相同，差异在两点：第 ② 步多“角色/风格一致性”选项，第 ⑤ 步多“单镜头重绘”——单个镜头不满意时，不必重跑整批。

> 想直接看一个完整案例？跳到 [Dapur Ibu 的一周食品素材生产](#案例dapur-ibu-的一周食品素材生产)。

---

## 案例：Dapur Ibu 的一周食品素材生产

> **背景**：Dapur Ibu 是印尼万隆的家常菜调料品牌，8 个 SKU（Rendang 调料包、Sambal 辣椒酱、Nasi Goreng 炒饭料等），主攻 TikTok Shop 和 Shopee。此前只有包装图，请人拍视频每条约 **Rp 150k（≈$10）**，一周 40 条就是 **$400**，无法持续。

### 输入：一张 SKU 表

| SKU | 产品名 | 核心卖点 | 辣度 | 价格档 | 主图 |
|---|---|---|---|---|---|
| DI-001 | Rendang 调料包 | 15 分钟出餐，正宗巴东味 | 中辣 | Rp 18k | `rendang.jpg` |
| DI-002 | Sambal Matah | 新鲜香茅，冷拌即食 | 特辣 | Rp 22k | `sambal-matah.jpg` |
| DI-003 | Nasi Goreng 炒饭料 | 一包一餐，零失败 | 微辣 | Rp 12k | `nasgor.jpg` |
| ... | ... | ... | ... | ... | ... |

运营只需把这张表存成 CSV，连同 8 张商品图一起拖进工作台。

### ① 上传 → ② 选模板

系统识别出「食品 · 调料 · 印尼语」后，模板画廊自动过滤出食品类模板：

| 模板 | Hook 结构 | 时长 | 适用平台 |
|---|---|---|---|
| **烹饪过程** | 食材铺开 → 下锅 → 出锅特写 → 试吃反应 | 8–12s | TikTok |
| **ASMR 质感** | 酱汁倾倒 → 慢动作拉丝 → 热气升腾 | 5–8s | Reels |
| **痛点解决** | “做饭太麻烦？” → 一包搞定 → 成品展示 | 6–10s | TikTok Shop |
| **开箱测评** | 包装特写 → 撕开 → 倒出 → 成品对比 | 8–12s | Shopee |

运营勾选「烹饪过程」和「痛点解决」两个模板，每个 SKU 生成 5 条变体。

### ③ 设参数 → ④ 提交

```
每个 SKU 生成：  ○ 3  ● 5  ○ 10 条变体
成本档位：      ● 经济(480P)  ○ 标准(720P)  ○ 高质(1080P)
预估总成本：    $6.00  （8 SKU × 5 条 × $0.15）
```

对比传统拍摄的 **$400/周**，同一批 40 条素材的算力成本是 **$6**。

### ⑤ 审核 → ⑥ 入库

40 条生成完毕，运营在网格视图里快速过一遍：

- 👍 标记 **23 条**：Sambal Matah 的酱汁倾倒镜头食欲感强；Rendang 的“15 分钟出餐”Hook 前 3 秒抓人。
- 👎 标记 **12 条**：炒饭料的成品镜头偏暗，食材辨识度不够。
- ⏳ **5 条**自动重试中（首次超时，路由已降级到备用 Provider）。

标记好评的 23 条一键入库，系统自动打上标签：

```
品类: 调料  |  平台: TikTok  |  Hook: 烹饪过程  |  语言: 印尼语
辣度: 中辣  |  场景: 家常晚餐  |  质量: 好评  |  成本: $0.15
```

### ⑦ 复用：下一批更聪明

第二周，Dapur Ibu 上新品 **Sambal Bawang**（葱香辣椒酱）。运营在素材库搜“Sambal + 好评 + TikTok”，找到上周的 3 条高复用素材，直接点击 **复用**：

- 系统自动把「酱汁倾倒 + 拉丝特写」的 Hook 结构套用到新 SKU。
- 路由层根据历史数据，优先选择上周产出好评率最高的 Provider 组合。
- 新一批 5 条变体，预估成本仍然是 **$0.75**，但**首轮好评率从 57% 提升到 78%**。

### 这个案例说明了什么

| 维度 | 传统方式 | Video Batch ID |
|---|---|---|
| 单周 40 条成本 | $400（拍摄） | **$6（算力）** |
| 从上传到出片 | 3–5 天 | **约 30 分钟** |
| 好素材沉淀 | 散落在聊天记录和网盘 | **带标签、可检索、可复用** |
| 下一批质量 | 靠运气和经验 | **靠历史数据驱动** |

食品品类的特殊性在于：**食欲感靠镜头语言，不靠提示词**。所以模板库里食品类模板全部预置了“热气、拉丝、酱汁流淌、咬一口特写”这类已验证的视觉配方，运营不需要懂摄影，选模板就行。

---

## 功能

| 能力 | 对你意味着什么 |
|---|---|
| **批量上传与 SKU 解析** | 拖一个 CSV，得到一条队列。无需逐项设置。 |
| **带预览的模板画廊** | 提交前先看 3 秒预览。不用写提示词。 |
| **品类专属模板** | 食品有“热气/拉丝/倾倒”配方，美妆有“上手试色/前后对比”，服饰有“场景穿搭切换”。选品类即得视觉语言。 |
| **实时成本预估** | 点击生成前知道价格。队列里看到真实花费。 |
| **审核与评分** | 每条都能 👍/👎。好的自动入库，差的回喂路由策略。 |
| **可检索的素材库** | 每条产出带视觉元数据、标签、嵌入索引。“上周那条美妆片”几秒找到。 |
| **复用与重生成** | 把历史素材拉进新批次，或只重绘单个变体。 |
| **Skill 路由记忆** | 已验证配方 + 历史成败 → 成本/质量感知的 Provider 选择。 |
| **OpenAI 兼容 API** | `POST /v1/videos/generations` — 自动化程序可直接调用。 |
| **多语言 TTS** | 开箱支持印尼语（`id-ID-ArdiNeural`、`id-ID-GadisNeural`）。 |
| **公网试用入口** | Cloudflare Tunnel + Access — 可分享域名，SSO/OTP 门禁。 |

---

## 架构

```mermaid
flowchart LR
    A[客户端 / 运营界面] --> B[Cloudflare Tunnel<br/>+ Access]
    B --> C[网关<br/>apps/web · apps/api]
    C --> D[Cloudflare D1<br/>任务状态 · 成本]
    C --> E[本地队列<br/>SQLite / Redis]
    E --> F[GPU Worker<br/>pixhub + ComfyUI]
    F --> G[合成层<br/>reel-kit]
    G --> H[TTS + 字幕<br/>voice-compute]
    H --> I[素材库<br/>Argus 风格索引<br/>+ SQLite FTS5]
    I --> C
    I --> J[知识层<br/>Skill 成败 · 复用信号]
    J --> C
```

**关键决策**

- **素材库是一等公民**，不是一个文件夹。每条产出都被索引、打标签、可检索。
- **知识层是旁路，不是阻塞点。** 知识层故障时，生成按默认策略继续路由。
- **MVP 不引入对象存储。** 资产落在本地磁盘，通过同一 Tunnel 回传。零 Egress 成本。
- **D1 是任务状态的唯一真相源。** 本地 API 通过 REST 直写 D1，无需 Workers。
- **队列暂时本地化。** GPU 消费端与队列同机。待算力上云后再引入 Cloudflare Queues。

### 部署模式

| 模式 | 用途 | 栈 | 公网 |
|---|---|---|---|
| `local` | 开发、测试 | 仅本地服务 | ❌ |
| **`tunnel`** | **MVP 演示、种子用户试用** | 本地服务 + Cloudflare Tunnel + Access + D1 | ✅ |
| `cloud` | L2 平台化（未来） | 云服务器 + Cloudflare Queues + R2 | ✅ |

---

## 界面概览

| 界面 | 用途 |
|---|---|
| **工作台首页** | 今日产出、成功率、花费、进行中任务、最近好评素材 |
| **批量生成** | 4 步向导：上传 → 选模板 → 设参数 → 提交。实时成本预估。 |
| **模板画廊** | 卡片网格，带 3 秒预览、评分、复用次数 |
| **任务队列** | 逐任务进度、实时花费、自动重试指示 |
| **审核页** | 网格视图、播放、评分、批量下载、单条重绘 |
| **素材库** | 搜索框 + 筛选（品类、平台、标签、日期）、复用按钮 |
| **知识层（内部）** | Skill 成功率、单次结果成本、复用分析 |

> 各界面 ASCII 线框见 [`docs/ui.md`](docs/ui.md)。

---

## 技术栈

| 层 | 组件 | 作用 |
|---|---|---|
| 入口 | [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) | 公网 HTTPS 入口，不开端口 |
| 门禁 | [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) | 试用用户 SSO / OTP 门禁 |
| 状态 | [Cloudflare D1](https://developers.cloudflare.com/d1/) | 任务状态、成本记录 |
| 素材索引 | Argus 风格扫描器 + SQLite FTS5 | 视觉元数据、标签、全文检索 |
| 网关 | [`free-multimodal-proxy`](https://github.com/) / [`ComfyUI-OpenAI-API-Refactored`](https://github.com/) | OpenAI 兼容入口，异步生命周期 |
| 路由 | [`pixhub`](https://github.com/) | Provider 适配器、降级链、档位路由 |
| 生成 | [`ComfyUI`](https://github.com/comfyanonymous/ComfyUI) + [`kt-ai-Studio`](https://github.com/) | 工作流执行、批量队列 |
| 合成 | [`reel-kit`](https://github.com/) | HTML 模板 → MP4 装配 |
| 语音 | [`voice-compute`](https://github.com/) | Edge-TTS、Whisper 字幕 |
| 自研胶水 | `apps/api`、`apps/web`、`packages/template-engine`、`packages/cost-tracker`、`packages/asset-index` | 批量入口、界面、模板映射、成本追踪、素材索引 |

**视频模型锚点**

| 模型 | 许可证 | 商用说明 |
|---|---|---|
| **Wan 2.2（T2V-A14B / TI2V-5B）** | **Apache 2.0** | 无收入门槛、无地区排除。**主锚点。** |
| LTX-Video / LTX-2.3 | LTX Open Weights | 年收入 $10M 以下免费商用；以上需付费许可。 |
| HunyuanVideo | Tencent Community | 排除 EU / UK / 韩国；100M MAU 上限。 |
| CogVideoX-5b | CogVideoX Community | 月活 100 万以下免费商用。 |

完整矩阵见 [`docs/licenses.md`](docs/licenses.md)。

---

## 快速开始

**环境要求** — Docker 24+、Docker Compose v2、NVIDIA 驱动 + Container Toolkit（GPU 模式）、Cloudflare 账户（Tunnel 模式）。

```bash
git clone git@github.com:your-org/video-batch-id.git
cd video-batch-id
cp .env.example .env
```

### 本地模式（开发）

```bash
docker compose --profile local up -d
```

| 服务 | 地址 |
|---|---|
| Web 工作台 | http://localhost:3000 |
| API 网关 | http://localhost:8000 |
| 健康检查 | http://localhost:8000/healthz |

### Tunnel 模式（试用 / 演示）

1. 在 Cloudflare Zero Trust → *Networks → Tunnels* 创建 Tunnel。
2. 将 Token 填入 `.env` 的 `CLOUDFLARE_TUNNEL_TOKEN`。
3. 创建 D1 数据库，配置 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_D1_DATABASE_ID`、`CLOUDFLARE_API_TOKEN`。
4. 应用 schema：`make d1-migrate`。
5. 启动：

```bash
docker compose --profile tunnel --profile gpu up -d
```

工作台可通过 `https://vbid.your-domain.com` 访问，由 Cloudflare Access 门禁保护。

> 首次 GPU 启动会下载模型权重，请预留 ≥ 30 GB 磁盘。

**首次使用引导**

1. 打开工作台首页 → 点击 **上传商品**
2. 拖入商品图或上传 CSV → 确认解析出的 SKU
3. 在模板画廊选一个模板 → 内联播放预览
4. 设置每个 SKU 的变体数（默认 5）与成本档位（默认标准）
5. 查看预估成本 → 点击 **生成**
6. 观察任务队列 → 完成后打开 **审核**
7. 标记 👍/👎 → 点击 **入库**
8. 打开 **素材库** → 检索或复用

---

## 配置

| 变量 | 说明 | 默认值 |
|---|---|---|
| `VBID_PROFILE` | `local` / `tunnel` / `cloud` | `local` |
| `VBID_GATEWAY_PORT` | API 网关端口 | `8000` |
| `VBID_WEB_PORT` | Web 工作台端口 | `3000` |
| `VBID_STATE_BACKEND` | `d1` 或 `sqlite` | Tunnel 模式下为 `d1` |
| `VBID_ASSET_DIR` | 素材存储目录 | `./assets` |
| `VBID_INDEX_BACKEND` | `sqlite-fts` / `pgvector` | `sqlite-fts` |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 | — |
| `CLOUDFLARE_D1_DATABASE_ID` | D1 数据库 ID | — |
| `CLOUDFLARE_API_TOKEN` | 具备 D1 读写权限的 API Token | — |
| `CLOUDFLARE_TUNNEL_TOKEN` | Tunnel Token | — |
| `VBID_ROUTER_CONFIG` | 路由策略 YAML | `config/routes.yaml` |

完整参考见 [`docs/configuration.md`](docs/configuration.md)。

---

## 目录结构

```
video-batch-id/
├── apps/
│   ├── api/                 # 网关胶水：批量入口、分发、D1 状态
│   └── web/                 # 运营工作台（首页、向导、审核、素材库）
├── packages/
│   ├── template-engine/     # (品类, Hook) → 工作流参数 + HTML 模板
│   ├── cost-tracker/        # 逐任务成本与延迟遥测
│   ├── asset-index/         # Argus 风格视觉元数据 + FTS5 索引
│   └── knowledge-store/     # Skill 成败、复用信号、路由记忆
├── skills/                  # YAML Skill 配方（版本化管理）
├── vendor/                  # 服务配置、镜像锁定（不存源码）
├── config/
│   └── routes.yaml          # Provider 降级链 + 档位策略
├── migrations/
│   └── d1/                  # D1 schema 迁移
├── assets/                  # 生成资产（git 忽略）
├── docs/                    # PRD、架构、配置、UI、许可证
├── docker-compose.yml
└── .env.example
```

---

## 路线图

| 版本 | 里程碑 | 部署 |
|---|---|---|
| `v0.1.0` | 批量向导 · 模板画廊 · 实时成本预估 · 本地 SQLite 状态 | `local` |
| `v0.2.0` | Tunnel 模式 · D1 状态 · Access 门禁试用 · 任务队列 UI | `tunnel` |
| `v0.3.0` | 审核评分 · Argus 风格素材索引 · SQLite FTS5 检索 | `tunnel` |
| `v0.4.0` | 商品转视频工作流 · SKU 批量入口 · 虚拟试穿 | `tunnel` |
| `v0.5.0` | Skill 配方引擎 · 结果回写 · 成本/质量感知路由 | `tunnel` |
| `v0.6.0` | MCN 矩阵模式 · 风格一致性 · 单镜头重绘 | `tunnel` |
| `v0.7.0` | pgvector 语义检索 · 复用分析 · 云服务器部署 | `cloud` |

详细范围见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。

---

## 模型许可证

商用需逐模型核对。当前锚点：

| 模型 | 许可证 | 商用说明 |
|---|---|---|
| **Wan 2.2（T2V-A14B / TI2V-5B）** | **Apache 2.0** | 无收入门槛、无地区排除。**主锚点。** |
| LTX-Video / LTX-2.3 | LTX Open Weights | 年收入 $10M 以下免费商用；以上需付费许可。 |
| HunyuanVideo | Tencent Community | 排除 EU / UK / 韩国；100M MAU 上限。 |
| CogVideoX-5b | CogVideoX Community | 月活 100 万以下免费商用。 |

完整矩阵见 [`docs/licenses.md`](docs/licenses.md)。

---

## 贡献

见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。所有贡献者需遵守 [行为准则](CODE_OF_CONDUCT.md)。

---

## 许可证

本项目为**私有项目**，未开源。第三方依赖许可证详见 [`docs/licenses.md`](docs/licenses.md)，分发前必须核对。

---

## 致谢

构建于 [ComfyUI](https://github.com/comfyanonymous/ComfyUI)、[pixhub](https://github.com/)、[free-multimodal-proxy](https://github.com/)、[reel-kit](https://github.com/)、[voice-compute](https://github.com/) 之上。

---

<details>
<summary><h3 id="english">📖 English</h3></summary>

# Video Batch ID

**Batch video asset workstation for e-commerce and MCN teams.**

Generating one good video is a creative problem. Generating **a hundred usable assets per week** is a workflow problem.

Video Batch ID is built for the second one. Upload a batch of products or scripts, pick a validated template, get a hundred variants, mark the good ones, and let the library compound. Every asset that gets reused makes the next batch smarter.

**Design principles**

- **Asset-first, not job-first** — every clip enters a searchable library with structured metadata. Jobs are transient; assets compound.
- **Template over prompt** — operators pick from validated recipes, not blank text boxes.
- **Batch is the default** — one upload, many outputs. No per-clip babysitting.
- **Observable cost** — every job shows its price before you commit and its real cost after it runs.
- **Assemble, don't rebuild** — routing, generation, composition, and speech are handled by battle-tested OSS.

**Who it's for**

| User | Pain today | What they get |
|---|---|---|
| **E-commerce seller / UMKM** | Product photos exist, but video production is slow and expensive | Upload SKU sheet → batch product showcase videos, virtual try-on, multi-angle variants |
| **MCN / agency operator** | Needs volume, style consistency, and per-clip control | Multi-account batch generation, per-clip re-render, character/style consistency |
| **Content operator** | Spends hours per clip, can't track what works | One dashboard: generate, review, rate, reuse. Cost visible at every step. |

**Core workflow (e-commerce)**

```
① Upload products → ② Pick template → ③ Set batch params → ④ Generate
                                                              ↓
⑦ Reuse / re-generate ← ⑥ Auto-index to library ← ⑤ Review & rate
```

| Step | You see | You do | System does |
|---|---|---|---|
| ① Upload | Drag zone + CSV template | Drop product images, upload SKU sheet | Parses SKUs, extracts selling points, detects category |
| ② Template | Card gallery with 3-second previews | Pick "Beauty · Problem-Solution · TikTok" | Loads Skill recipe + provider preferences |
| ③ Params | Sliders: variants per SKU, cost tier, duration | Drag slider, see live cost estimate | Computes estimated cost, locks budget ceiling |
| ④ Generate | Live queue with per-task progress | Wait or walk away | Routes to GPU, async generation, auto-fallback on failure |
| ⑤ Review | Grid view, playable, rate 👍/👎 | Quick-scan, rate, add notes | Records outcome, writes back to knowledge layer |
| ⑥ Index | "87 assets indexed" toast | One-click index | Argus-style visual metadata + tags + embeddings |
| ⑦ Reuse | Library search bar | Search "beauty + oily + last week" | Full-text + semantic retrieval |

**MCN matrix mode** follows the same flow, with two additions: step ② adds **character/style consistency** options, and step ⑤ adds **per-clip re-render**.

**Case study: Dapur Ibu's weekly food asset production**

Dapur Ibu is a home-style seasoning brand in Bandung, Indonesia — 8 SKUs, selling on TikTok Shop and Shopee. Previously product photos only; hiring a videographer cost ~Rp 150k ($10) per clip, or ~$400 for 40 clips a week. Unsustainable.

Upload SKU CSV + 8 product images → system detects "Food · Seasoning · Indonesian" → filters to food templates (Cooking Process, ASMR Texture, Problem-Solution, Unboxing) → operator picks 2 templates, 5 variants per SKU → cost estimate $6.00 for 40 clips → 30 minutes later, 23 rated good, 12 rated poor, 5 auto-retrying → good ones indexed with tags (category, platform, hook, language, spice level, scene) → next week, new SKU reuses last week's best-performing hook structure, first-round approval rate rises from 57% to 78%.

**Features**

- Batch upload & SKU parsing — drop a CSV, get a queue.
- Template gallery with preview — see 3-second previews before you commit.
- Category-specific templates — Food gets "steam, pull, pour" recipes; Beauty gets "swatch, before/after"; Fashion gets "scene transitions".
- Live cost estimate — know the price before you click generate.
- Review & rate — 👍/👎 every clip; good ones auto-index.
- Searchable asset library — visual metadata, tags, embeddings, full-text search.
- Reuse & re-generate — pull past assets into new batches, or re-render one variant.
- Skill-based routing memory — validated recipes + historical outcomes.
- OpenAI-compatible API — `POST /v1/videos/generations`.
- Multi-language TTS — Indonesian out of the box.
- Public trial access — Cloudflare Tunnel + Access.

**Architecture**

```mermaid
flowchart LR
    A[Client / Operator UI] --> B[Cloudflare Tunnel<br/>+ Access]
    B --> C[Gateway<br/>apps/web · apps/api]
    C --> D[Cloudflare D1<br/>job state · cost]
    C --> E[Local Queue<br/>SQLite / Redis]
    E --> F[GPU Worker<br/>pixhub + ComfyUI]
    F --> G[Compositor<br/>reel-kit]
    G --> H[TTS + Captions<br/>voice-compute]
    H --> I[Asset Library<br/>Argus-style index<br/>+ SQLite FTS5]
    I --> C
    I --> J[Knowledge Store<br/>skill outcomes · reuse signals]
    J --> C
```

**Deployment modes**

| Mode | Use case | Stack | Public? |
|---|---|---|---|
| `local` | Development | Local services only | ❌ |
| **`tunnel`** | **MVP demos, seed-user trials** | Local + Cloudflare Tunnel + Access + D1 | ✅ |
| `cloud` | L2 platformization (future) | Cloud VM + Cloudflare Queues + R2 | ✅ |

**Quick start**

```bash
git clone git@github.com:your-org/video-batch-id.git
cd video-batch-id
cp .env.example .env
docker compose --profile local up -d                  # local
docker compose --profile tunnel --profile gpu up -d   # tunnel
```

**Model licenses**

| Model | License | Commercial note |
|---|---|---|
| **Wan 2.2 (T2V-A14B / TI2V-5B)** | **Apache 2.0** | No revenue cap, no region exclusion. Primary anchor. |
| LTX-Video / LTX-2.3 | LTX Open Weights | Free under $10M annual revenue; paid above. |
| HunyuanVideo | Tencent Community | Excludes EU/UK/South Korea; 100M MAU cap. |
| CogVideoX-5b | CogVideoX Community | Free under 1M MAU. |

Full matrix in [`docs/licenses.md`](docs/licenses.md).

**License** — This project is **private** and not open-sourced. Third-party dependency licenses are enumerated in [`docs/licenses.md`](docs/licenses.md).

</details>

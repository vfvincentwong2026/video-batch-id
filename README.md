<div align="center">

# Video Batch ID

**让一条好素材，安全地变成一百条好素材。**

<sub>参考素材二创 · 变量矩阵控制 · 保真去重双守卫 · 素材谱系复利</sub>

[![CI](https://github.com/your-org/video-batch-id/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/video-batch-id/actions)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white)](#快速开始)
[![Python](https://img.shields.io/badge/python-3.11+-3776AB?logo=python&logoColor=white)](#技术栈)
[![Node](https://img.shields.io/badge/node-20+-339933?logo=node.js&logoColor=white)](#技术栈)
[![Cloudflare](https://img.shields.io/badge/cloudflare-tunnel%20%2B%20d1-F38020?logo=cloudflare&logoColor=white)](#部署模式)
[![License: Private](https://img.shields.io/badge/license-Private-lightgrey)](#许可证)

[痛点](#痛点) · [为什么](#为什么) · [核心概念](#核心概念) · [两条工作流](#两条工作流) · [食品案例](#案例dapur-ibu-的一条爆款如何变成三十条) · [功能](#功能) · [架构](#架构) · [快速开始](#快速开始) · [路线图](#路线图) · [English](#english)

</div>

---

## 痛点

**核心素材的复用率几乎为零。**

一条爆款视频在 TikTok Indonesia / Shopee Video 跑出来后，卖家面临的选择只有两个：

- **直接重发** → 平台判定重复，限流，播放断崖。
- **人工二创** → 剪辑师每条改 30 分钟，一周改不出 20 条，成本比重新拍还高。

用 AI 重新生成？产品外观变了、卖点丢了、印尼本地风格断了，不能用。套通用模板？套不出原来那条的「味道」。

**中间那块能力是空的**：保留核心、可控变化、批量产出、通过平台去重。

Video Batch ID 就是为这块空白而建，专为印尼短视频电商场景设计。

---

## 为什么

生成一条好视频是创意问题；**让一条好视频安全地复制出一百条变体**是工程问题。

Video Batch ID 把一条参考素材拆解成**可独立控制的变量矩阵**，让运营勾选「变什么、不变什么」，批量产出既保留核心、又足够不同的变体，并通过**保真守卫**和**去重守卫**确保每条都能用、都能过审。

**设计原则**

- **参考优先，提示词其次** — 从一条已验证的好素材出发，而不是从空白输入框开始。
- **变量可控，核心锁定** — 每条变体都明确知道「变了什么、没变什么」。
- **双守卫兜底** — 保真守卫确保产品/卖点不变，去重守卫确保平台不判重。
- **素材谱系复利** — 一个 Master 衍生 N 个变体，哪个 Master 最值钱一目了然。
- **组装，而非重造** — 解析、变体、守卫、合成均复用成熟开源组件。
- **印尼本地优先** — 原生支持 Bahasa Indonesia TTS、本地食品材质表现、TikTok ID / Shopee 去重特征。

---

## 核心概念

### 变量矩阵（Variable Matrix）

一条参考视频被 VLM 解析后，拆成六个可独立控制的维度：

| 维度 | 可变 | 必须保持不变 |
|------|------|----------------|
| **视觉** | 场景、光线、色调、构图、背景道具 | 产品外观、关键动作、品牌色 |
| **人物** | 模特身份、服装、表情、手部特征 | 镜头角度、动作节奏 |
| **文案** | 开头 Hook、卖点顺序、CTA、语言风格 | 核心信息、品牌调性 |
| **节奏** | 时长、剪辑密度、转场 | 关键镜头顺序 |
| **音频** | BGM、音效强度、语速、材质音效 | 口播内容（可选锁） |
| **技术** | 分辨率、画幅、字幕样式 | — |

**食品高材质内容特别强化**（糖类、酱料、拉丝、半透明产品）：
- 通透度、表面光泽、拉丝长度、粘性表现、内部液体流动感可作为视觉子变量独立控制。
- 保真守卫会额外校验颜色一致性与半透明区域语义。

运营的操作模型极简：**上传参考 → 勾选变量 → 设变体数量 → 生成**。

### 双守卫（Dual Guard）

- **保真守卫**：CLIP embedding + GroundingDINO 产品区域检测 + 颜色/通透度校验，确保变体里产品外观、品牌元素、核心卖点与 Master 一致。
- **去重守卫**：pHash + 关键帧 CLIP 距离 + 音频指纹三重检测，确保变体之间、变体与 Master 之间的相似度低于 TikTok Indonesia / Shopee 判重阈值。

任一变体未通过守卫，自动重试或标记为「待人工复核」，**不会混入合格队列**。

### 变体谱系（Lineage）

素材库不是文件夹，是**谱系树**：Master: Sambal Matah 爆款 (播放 50万 · 带货 2000单)
├── V01 · 场景=厨房 · 模特=A · Hook=倾倒 → 播放 8万
├── V02 · 场景=餐厅 · 模特=B · Hook=拉丝 → 播放 12万
├── V03 · 场景=野餐 · 模特=A · Hook=试吃 → 播放 6万
└── ... 共 30 个变体text**哪个 Master 衍生了最多好评变体，它就是最值钱的资产。** 这个信号自动回写知识层，驱动下一轮生产决策。

---

## 两条工作流

### 工作流 A：参考素材二创（核心场景）① 上传参考视频 → ② 系统解析 → ③ 勾选变量 → ④ 设变体数
↓
⑧ 谱系入库 ← ⑦ 双守卫校验 ← ⑥ 审核标记 ← ⑤ 批量生成text| 步骤 | 你看到 | 你做什么 | 系统做什么 |
|------|--------|----------|------------|
| ① 上传 | 拖入一条已跑通的视频 | 拖入 Master Asset | 提取关键帧、音频、时长 |
| ② 解析 | 系统拆出的镜头表 + Hook 结构 + 文案 + BGM | 确认解析结果，可修正 | VLM 切分镜头、识别 Hook、转录文案、分析节奏 |
| ③ 勾选变量 | 六维变量矩阵，每项可开关 | 勾「换场景、换模特、换 Hook」，锁「产品、卖点」 | 生成变量组合空间，显示预估变体数 |
| ④ 设变体数 | 滑块：生成 10 / 30 / 100 条 | 选择数量与成本档位 | 计算预估成本，锁定预算 |
| ⑤ 生成 | 变体队列，逐条进度 | 等待或离开 | 分层变量生成：视觉/人物/文案/节奏/音频 |
| ⑥ 审核 | 网格视图，可播放可标记 | 快速过一遍，标记 👍/👎 | 记录 outcome |
| ⑦ 守卫 | 每条变体显示「保真 ✅ · 去重 ✅」 | 复核未通过的少数变体 | 保真守卫 + 去重守卫双重校验 |
| ⑧ 入库 | 「已入库 27 条变体」 | 一键入库 | 建立谱系关系，打标签，写知识层 |

### 工作流 B：从零生成（补充场景）

适用于新品上架、没有参考素材时。上传 SKU 表 + 商品图 → 选模板 → 批量生成。流程与工作流 A 类似，但起点是商品图和模板，不是参考视频。

> 想直接看一个完整案例？跳到 [Dapur Ibu 的一条爆款如何变成三十条](#案例dapur-ibu-的一条爆款如何变成三十条)。

---

## 案例：Dapur Ibu 的一条爆款如何变成三十条

> **背景**：Dapur Ibu 的 **Sambal Matah** 辣椒酱在 TikTok Indonesia 上跑出一条爆款——酱汁倾倒 + 慢动作拉丝 + 试吃反应，播放 **50 万**，带货 **2000 单**。想复用，但直接重发会被限流，人工改又太慢。请剪辑师改一条 30 分钟，一周改不出 20 条。

### ① 上传 Master Asset

运营把这条爆款拖进工作台。系统自动解析出：镜头结构（4 个镜头，共 11 秒）
├── 镜头 1 [0:00-0:03] 酱汁倾倒特写（Hook）
├── 镜头 2 [0:03-0:06] 慢动作拉丝
├── 镜头 3 [0:06-0:09] 产品包装特写
└── 镜头 4 [0:09-0:11] 试吃反应 + CTA
文案（Bahasa Indonesia）
"Sambal Matah segar, pedasnya nampol! Coba sekarang."
BGM 轻快印尼民谣，120 BPM
节奏 快切，平均 2.7 秒/镜头text### ② 勾选变量 → 设变体数

运营勾选：✅ 换场景   厨房台面 → 餐厅 / 户外野餐 / 办公室（3 种）
✅ 换模特   印尼女性 A → B / C（2 种）
✅ 换 Hook  倾倒 → 拉丝 / 试吃 / 开盖（4 种）
✅ 换 BGM   轻快民谣 → 流行 / 电子（3 种）
🔒 锁定产品 瓶身外观、标签、品牌色
🔒 锁定卖点 "segar"（新鲜）、"pedasnya nampol"（辣得过瘾）text系统计算变量组合空间 = 3 × 2 × 4 × 3 = **72 种**。运营选择生成 **30 条**，系统按「最大差异度优先」策略采样。

预估成本：**$4.50**（30 条 × $0.15）。

### ③ 批量生成 → 双守卫校验

30 条变体生成完毕，双守卫自动校验：

- **保真守卫**：30 条全部通过——产品外观、标签、品牌色与 Master 一致度 > 0.92。
- **去重守卫**：27 条通过（视觉相似度 < 0.65 阈值）；**3 条被拦截**（场景变化不够大，与 V07 相似度 0.78），自动进入重试队列。

### ④ 审核 → 谱系入库

运营在网格视图快速过一遍：

- 👍 标记 **18 条**：V02（餐厅场景 + 模特 B + 拉丝 Hook）最有食欲感；V11（野餐场景 + 试吃 Hook）氛围最贴合。
- 👎 标记 **9 条**：办公室场景光线偏冷，酱汁颜色失真。

18 条好评入库，建立谱系：Master: Sambal Matah 爆款 (播放 50万 · 带货 2000单)
├── V02 · 餐厅·B·拉丝 → 播放 12万 · 带货 680单 ⭐
├── V11 · 野餐·A·试吃 → 播放 9万 · 带货 420单
└── ... 共 18 条通过审核text### ⑤ 复利：下一个 Master 更聪明

三周后，Sambal Matah 的谱系里，**V02（餐厅场景 + 拉丝 Hook）** 成为新的高复用变体。运营想推新品 **Sambal Bawang** 时，系统推荐：

> 「V02 的 Hook 结构（拉丝）+ 餐厅场景，在 Sambal 品类下历史好评率 78%，建议复用为 Master 模板。」

运营一键把 V02 设为新 Master 的参考，新的 30 条变体直接继承最优配置。

### 这个案例说明了什么

| 维度 | 传统二创 | Video Batch ID |
|------|----------|----------------|
| 30 条变体耗时 | 15 小时（剪辑师） | **约 25 分钟** |
| 30 条变体成本 | ≈ $150（人工） | **$4.50（算力）** |
| 通过平台审核 | 靠经验，常被判重 | **双守卫确保 90% 通过** |
| 核心素材价值 | 用一次就浪费 | **一个 Master 衍生 30 条，持续复利** |
| 下一个 Master | 重新摸索 | **从谱系里继承最优配置** |

---

## 功能

| 能力 | 对你意味着什么 |
|------|----------------|
| **参考视频解析** | 上传一条爆款，系统自动拆出镜头、Hook、文案、节奏、BGM。 |
| **变量矩阵控制** | 六维可独立开关：变什么、锁什么，一目了然。食品材质（通透、拉丝、光泽）支持细粒度控制。 |
| **分层变体生成** | 视觉/人物/文案/节奏/音频分层处理，保持核心不变。 |
| **保真守卫** | 产品外观、品牌元素、核心卖点、颜色与通透度与 Master 一致度自动校验。 |
| **去重守卫** | 视觉 + 音频三重检测，针对 TikTok Indonesia / Shopee 判重特征优化。 |
| **变体谱系** | 每个 Master 衍生了哪些变体、哪条效果最好，一图看清。 |
| **批量上传与 SKU 解析** | 工作流 B 用：拖一个 CSV，得到一条队列。 |
| **品类专属模板** | 食品有「热气/拉丝/倾倒/开箱」配方，美妆有「上手试色/前后对比」。 |
| **实时成本预估** | 生成前知道价格，队列里看到真实花费。 |
| **可检索的素材库** | 按品类、平台、Hook、语言、效果评分检索。 |
| **OpenAI 兼容 API** | `POST /v1/videos/generations` 与 `/v1/videos/variations`。 |
| **多语言 TTS** | 开箱支持印尼语（`id-ID-ArdiNeural`、`id-ID-GadisNeural`）。 |
| **公网试用入口** | Cloudflare Tunnel + Access — 可分享域名，SSO/OTP 门禁。 |

---

## 架构

```mermaid
flowchart TB
    A[客户端 / 运营界面] --> B[Cloudflare Tunnel<br/>+ Access]
    B --> C[网关<br/>apps/web · apps/api]
    C --> D[Cloudflare D1<br/>任务状态 · 成本]
    C --> E[本地队列<br/>SQLite / Redis]

    E --> F[参考解析层<br/>Qwen2.5-VL · Whisper]
    F --> G[变量控制层<br/>Variable Matrix]
    G --> H[变体生成层<br/>Wan 2.2 I2V/V2V · ControlNet · IP-Adapter]
    H --> I[合成层<br/>reel-kit · Edge-TTS]
    I --> J[双守卫<br/>Fidelity + Dedup]
    J --> K[素材谱系库<br/>Argus 索引 + FTS5]
    K --> C
    K --> L[知识层<br/>Master 价值 · 变体效果]
    L --> C关键决策
参考解析是入口，不是可选步骤。没有解析就没有变量矩阵，没有变量矩阵就退化成「重新生成」。
双守卫是硬门槛。未通过守卫的变体不进入合格队列，宁可少产出，不可让废片混入。
谱系是素材库的核心视图，不是附加功能。用户看素材库的第一眼应该是「哪些 Master 最值钱」。
工作流 A（二创）优先于工作流 B（从零生成）。MVP 先跑通二创，因为痛点更尖锐。
MVP 不引入对象存储。资产落在本地磁盘，通过同一 Tunnel 回传。零 Egress 成本。
D1 是任务状态的唯一真相源。本地 API 通过 REST 直写 D1，无需 Workers。
部署模式




























模式用途栈公网local开发、测试仅本地服务❌tunnelMVP 演示、种子用户试用本地服务 + Cloudflare Tunnel + Access + D1✅cloudL2 平台化（未来）云服务器 + Cloudflare Queues + R2✅界面概览








































界面用途工作台首页今日产出、Master 数量、变体通过率、花费、最近好评变体参考解析页上传参考视频，展示镜头表、Hook 结构、文案、BGM，可修正变量矩阵页六维开关，实时显示变量组合空间与预估成本任务队列逐变体进度、守卫校验状态、实时花费审核页网格视图、播放、评分、守卫结果、单条重绘素材谱系Master → 变体的树形视图，按效果评分排序素材库搜索框 + 筛选（品类、平台、Hook、评分），复用按钮知识层（内部）Master 价值榜、变体成功率、变量组合效果分析各界面 ASCII 线框见 docs/ui.md。技术栈

























































































层组件作用入口Cloudflare Tunnel公网 HTTPS 入口，不开端口门禁Cloudflare Access试用用户 SSO / OTP 门禁状态Cloudflare D1任务状态、成本记录参考解析Qwen2.5-VL / InternVL2.5 + Whisper镜头切分、Hook 识别、文案转录、节奏分析变量控制自研 packages/variable-matrix六维变量组合与采样变体生成Wan 2.2 I2V/V2V + ComfyUI ControlNet / IP-Adapter视觉、人物、场景变量人物变体LivePortrait / IP-Adapter FaceID换模特、换表情，保持动作文案变体Sahabat AI（印尼语）+ Edge-TTSHook 改写、重新口播节奏变体ffmpeg + 时间重映射时长、剪辑密度调整保真守卫CLIP + GroundingDINO + 颜色/通透度校验产品区域检测 + 语义与材质一致性去重守卫pHash + CLIP 距离 + Chromaprint视觉 / 音频三重去重素材索引Argus 风格扫描器 + SQLite FTS5视觉元数据、标签、全文检索合成reel-kitHTML 模板 → MP4 装配网关free-multimodal-proxyOpenAI 兼容入口路由pixhubProvider 适配器、降级链、档位路由自研胶水apps/api、apps/web、packages/variable-matrix、packages/guards、packages/lineage、packages/cost-tracker变量矩阵、双守卫、谱系追踪视频模型锚点





























模型许可证商用说明Wan 2.2（T2V-A14B / TI2V-5B）Apache 2.0无收入门槛、无地区排除。主锚点。LTX-Video / LTX-2.3LTX Open Weights年收入 $10M 以下免费商用；以上需付费许可。HunyuanVideoTencent Community排除 EU / UK / 韩国；100M MAU 上限。CogVideoX-5bCogVideoX Community月活 100 万以下免费商用。完整矩阵见 docs/licenses.md。快速开始环境要求 — Docker 24+、Docker Compose v2、NVIDIA 驱动 + Container Toolkit（GPU 模式）、Cloudflare 账户（Tunnel 模式）。Bashgit clone git@github.com:your-org/video-batch-id.git
cd video-batch-id
cp .env.example .env本地模式（开发）Bashdocker compose --profile local up -d




















服务地址Web 工作台http://localhost:3000API 网关http://localhost:8000健康检查http://localhost:8000/healthzTunnel 模式（试用 / 演示）
在 Cloudflare Zero Trust → Networks → Tunnels 创建 Tunnel。
将 Token 填入 .env 的 CLOUDFLARE_TUNNEL_TOKEN。
创建 D1 数据库，配置 CLOUDFLARE_ACCOUNT_ID、CLOUDFLARE_D1_DATABASE_ID、CLOUDFLARE_API_TOKEN。
应用 schema：make d1-migrate。
启动：
Bashdocker compose --profile tunnel --profile gpu up -d工作台可通过 https://vbid.your-domain.com 访问，由 Cloudflare Access 门禁保护。首次 GPU 启动会下载模型权重，请预留 ≥ 50 GB 磁盘（含 VLM 与视频模型）。首次使用引导（工作流 A：二创）
打开工作台 → 点击 上传参考视频
等待解析 → 查看镜头表、Hook 结构、文案、BGM → 确认或修正
在变量矩阵页勾选「变什么、锁什么」→ 查看变量组合空间
设变体数量与成本档位 → 查看预估成本 → 点击 生成
观察变体队列 → 每条显示守卫校验状态
在审核页标记 👍/👎 → 一键入库
打开 素材谱系 → 查看 Master 衍生关系
配置





































































变量说明默认值VBID_PROFILElocal / tunnel / cloudlocalVBID_STATE_BACKENDd1 或 sqliteTunnel 模式下为 d1VBID_ASSET_DIR素材存储目录./assetsVBID_VLM_MODEL参考解析用的 VLM（vlm-api provider；OpenAI 兼容协议）gpt-4o-miniVBID_VLM_API_KEY启用 vlm-api 语义解析的 key（不设置则回退 ffmpeg-shotcut）—VBID_VLM_BASE_URLOpenAI 兼容入口（官方默认 / 中转 relay）https://api.openai.com/v1VBID_GEN_MODEL变体生成主模型wan2.2-ti2v-5bVBID_FIDELITY_THRESHOLD保真守卫阈值0.92VBID_DEDUP_THRESHOLD去重守卫相似度阈值0.65VBID_INDEX_BACKENDsqlite-fts / pgvectorsqlite-ftsCLOUDFLARE_ACCOUNT_IDCloudflare 账户—CLOUDFLARE_D1_DATABASE_IDD1 数据库 ID—CLOUDFLARE_API_TOKEN具备 D1 读写权限的 API Token—CLOUDFLARE_TUNNEL_TOKENTunnel Token—完整参考见 docs/configuration.md。目录结构textvideo-batch-id/
├── apps/
│   ├── api/                 # 网关胶水：批量入口、分发、D1 状态
│   └── web/                 # 运营工作台（解析、矩阵、审核、谱系）
├── packages/
│   ├── reference-parser/    # VLM 参考视频解析：镜头、Hook、文案、节奏
│   ├── variable-matrix/     # 六维变量组合与采样
│   ├── guards/              # 保真守卫 + 去重守卫
│   ├── lineage/             # Master → 变体谱系追踪
│   ├── template-engine/     # 品类 + Hook → 工作流参数 + HTML 模板
│   ├── cost-tracker/        # 逐任务成本与延迟遥测
│   └── asset-index/         # Argus 风格视觉元数据 + FTS5 索引
├── skills/                  # YAML Skill 配方（版本化管理）
├── vendor/                  # 服务配置、镜像锁定（不存源码）
├── config/
│   └── routes.yaml          # Provider 降级链 + 档位策略
├── migrations/
│   └── d1/                  # D1 schema 迁移
├── assets/                  # 生成资产与 Master 库（git 忽略）
├── docs/                    # PRD、架构、配置、UI、许可证
├── docker-compose.yml
└── .env.example路线图












































版本里程碑部署v0.1.0参考视频解析 · 变量矩阵 v1 · 基础变体生成（视觉层）localv0.2.0保真守卫 · 去重守卫 · 变体谱系 v1 · Tunnel 模式tunnelv0.3.0人物变量 · 文案变量（Sahabat AI + TTS）· 审核页tunnelv0.4.0节奏变量 · 音频变量 · 分层合成tunnelv0.5.0从零生成工作流 · 品类模板库 · SKU 批量入口tunnelv0.6.0知识层 · Master 价值榜 · 变量组合效果分析tunnelv0.7.0pgvector 语义检索 · MCN 矩阵模式 · 云服务器部署cloud详细范围见 docs/ROADMAP.md。模型许可证商用需逐模型核对。当前锚点：





























模型许可证商用说明Wan 2.2（T2V-A14B / TI2V-5B）Apache 2.0无收入门槛、无地区排除。主锚点。LTX-Video / LTX-2.3LTX Open Weights年收入 $10M 以下免费商用；以上需付费许可。HunyuanVideoTencent Community排除 EU / UK / 韩国；100M MAU 上限。CogVideoX-5bCogVideoX Community月活 100 万以下免费商用。完整矩阵见 docs/licenses.md。贡献见 CONTRIBUTING.md。所有贡献者需遵守行为准则。许可证本项目为私有项目，未开源。第三方依赖许可证详见 docs/licenses.md，分发前必须核对。致谢构建于 ComfyUI、Qwen2.5-VL、pixhub、free-multimodal-proxy、reel-kit、voice-compute 之上。
📖 English
Video Batch ID
Turn one proven video into a hundred usable variants — safely, controllably, at scale.
Focused on the Indonesian short-video e-commerce market (TikTok Indonesia, Shopee Video, local food & FMCG brands).
The core pain: a winning asset can almost never be reused. Repost it and the platform throttles you. Hand it to an editor and each variation takes 30 minutes. Regenerate it from scratch and the product looks different, the selling point is lost, the local style breaks.
Video Batch ID fills the gap: parse a reference video into a Variable Matrix, let the operator choose what to vary and what to lock, batch-generate variants, and validate every variant with a Fidelity Guard (product/brand/selling point + color/translucency intact) and a Dedup Guard (dissimilar enough to pass TikTok Indonesia / Shopee review).
Core Concepts

Variable Matrix — six controllable dimensions: visual (including material properties like translucency, gloss, stretch), person, copy, rhythm, audio (including ASMR/material sounds), technical. Lock the core, vary the rest.
Dual Guard — Fidelity Guard (CLIP + GroundingDINO + color/translucency checks) and Dedup Guard (pHash + CLIP distance + audio fingerprint).
Lineage — every variant traces back to its Master Asset. The Master that spawns the most high-performing variants becomes the most valuable asset in the library.

Two Workflows

A. Reference-based variation (core): upload reference → parse → select variables → set count → batch generate → dual-guard check → review → index to lineage.
B. From-scratch generation (supplementary): upload SKU sheet + product images → pick template → batch generate.

Case Study: How one Dapur Ibu hit became thirty variants
Dapur Ibu's Sambal Matah TikTok Indonesia hit reached 500k views and sold 2,000 units. Reposting throttled; manual editing too slow. They uploaded the clip as a Master Asset. The system parsed 4 shots / 11 seconds / Indonesian copy / 120 BPM BGM. Operator varied: 3 scenes, 2 models, 4 hooks, 3 BGM tracks = 72 combinations, sampled 30. Generation cost: $4.50. Dual Guard: 30/30 passed fidelity, 27/30 passed dedup (3 re-queued). 18 rated good, indexed into lineage. Three weeks later, V02 (restaurant + model B + pull hook) became the new high-reuse template for the next SKU.
Key Features

Reference parsing (shot table, hook structure, transcript, BGM, rhythm)
Variable matrix with fine-grained food material controls
Layered generation (visual / person / copy / rhythm / audio)
Fidelity Guard + Dedup Guard tuned for Indonesian platforms
Lineage tree & Master value ranking
Native Bahasa Indonesia TTS (id-ID-ArdiNeural, id-ID-GadisNeural)
OpenAI-compatible API
Cloudflare Tunnel + Access for public trial

Quick Start
Bashgit clone git@github.com:your-org/video-batch-id.git
cd video-batch-id
cp .env.example .env
docker compose --profile local up -d                  # local
docker compose --profile tunnel --profile gpu up -d   # tunnel
Model Licenses






























ModelLicenseCommercial noteWan 2.2 (T2V-A14B / TI2V-5B)Apache 2.0No revenue cap, no region exclusion. Primary anchor.LTX-Video / LTX-2.3LTX Open WeightsFree under $10M annual revenue; paid above.HunyuanVideoTencent CommunityExcludes EU/UK/South Korea; 100M MAU cap.CogVideoX-5bCogVideoX CommunityFree under 1M MAU.
Full matrix in docs/licenses.md.
License — This project is private and not open-sourced. Third-party dependency licenses are enumerated in docs/licenses.md.

```

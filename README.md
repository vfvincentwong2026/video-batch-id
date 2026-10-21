<div align="center">

# Video Batch ID

**Industrial-grade batch video generation workstation.**

<sub>批量短视频素材生成工作站 · 可复现的批量化视频生产管线</sub>

[![CI](https://github.com/your-org/video-batch-id/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/video-batch-id/actions)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white)](#quick-start)
[![Python](https://img.shields.io/badge/python-3.11+-3776AB?logo=python&logoColor=white)](#tech-stack)
[![Node](https://img.shields.io/badge/node-20+-339933?logo=node.js&logoColor=white)](#tech-stack)
[![Cloudflare](https://img.shields.io/badge/cloudflare-tunnel%20%2B%20d1-F38020?logo=cloudflare&logoColor=white)](#deployment-modes)
[![License: Private](https://img.shields.io/badge/license-Private-lightgrey)](#license)

[Overview](#overview) · [Features](#features) · [Architecture](#architecture) · [Deployment Modes](#deployment-modes) · [Quick Start](#quick-start) · [Roadmap](#roadmap) · [简体中文](#简体中文)

</div>

---

## Overview

Video Batch ID is an **orchestration layer for batch short-form video generation**. It composes proven open-source components into a single reproducible pipeline, exposing an OpenAI-compatible API for programmatic access and a minimal operator workspace for web use.

Submit a batch, receive assets. No per-clip babysitting.

**Design principles**

- **Assemble, don't rebuild** — routing, generation, composition, and speech are handled by battle-tested OSS.
- **Provider-agnostic** — swap generation backends without touching the API contract.
- **Observable by default** — every job emits cost, latency, and provenance metadata.
- **Reproducible** — `docker compose up` yields a working workstation.
- **Edge-reachable, locally-executed** — public access via Cloudflare Tunnel; inference stays on GPU hardware you control.

---

## Features

| Capability | Detail |
|---|---|
| **Batch-first API** | Submit *N* prompts, receive *N* assets. Async job lifecycle with SSE / webhook callbacks. |
| **OpenAI-compatible** | `POST /v1/videos/generations` — drop-in with existing SDKs. |
| **Multi-provider routing** | Declarative fallback chains across ComfyUI, external APIs, and local backends. |
| **Cost-aware scheduling** | Tier-based routing (`standard` / `fast` / `economy`) with per-job cost attribution. |
| **Composable output** | Video fragments + TTS + captions assembled via templated HTML → MP4. |
| **Multi-language TTS** | Edge-TTS and beyond — Indonesian (`id-ID-ArdiNeural`, `id-ID-GadisNeural`) supported out of the box. |
| **Durable job state** | Cloudflare D1 for cross-instance state; local SQLite fallback for air-gapped runs. |
| **Public trial access** | Cloudflare Tunnel + Access — shareable domain, SSO/OTP gated, no public IP required. |
| **Pluggable templates** | Versioned template registry; no hardcoded workflows. |

---

## Architecture

```mermaid
flowchart LR
    A[Client / OpenAI SDK] --> B[Cloudflare Tunnel<br/>+ Access]
    B --> C[Edge Gateway<br/>apps/web · apps/api]
    C --> D[Cloudflare D1<br/>job state · cost]
    C --> E[Local Queue<br/>SQLite / Redis]
    E --> F[GPU Worker<br/>pixhub + ComfyUI]
    F --> G[Compositor<br/>reel-kit]
    G --> H[TTS + Captions<br/>voice-compute]
    H --> I[Local Output Store<br/>outputs/*.mp4]
    I --> B
Key decisions

No object storage in MVP. Generated assets land on local disk (outputs/) and are served back through the same Tunnel. Zero egress cost, zero extra accounts.

D1 is the source of truth for job state. The local API writes to D1 via the Cloudflare REST API — no Workers required.

Queues are local for now. The GPU consumer runs on the same host as the queue, so a Cloudflare Queue would add latency without benefit. Cloudflare Queues will be introduced when compute moves to cloud (see Roadmap).

Every stage is a replaceable service. The router decides where; the pipeline decides how; the gateway guarantees a stable contract.

Deployment Modes
The workstation ships with three deployment profiles. Pick one via docker compose --profile <name>.

Mode	Use case	Stack	Public?
local	Development, testing	Local services only	❌
tunnel	MVP demos, seed-user trials	Local services + Cloudflare Tunnel + Access + D1	✅
cloud	L2 platformization (future)	Cloud VM + Cloudflare Queues + R2	✅
tunnel mode is the current target. It gives you a shareable HTTPS domain, identity-gated access, and durable job state — without a public IP, without object storage, and without GPU infrastructure exposed to the internet.

Tech Stack
Layer	Component	Role
Ingress	Cloudflare Tunnel	Public HTTPS endpoint, no open ports
Access control	Cloudflare Access	SSO / OTP gate for trial users
State	Cloudflare D1	Job state, cost records, template metadata
Gateway	free-multimodal-proxy / ComfyUI-OpenAI-API-Refactored	OpenAI-compatible ingress, async lifecycle
Router	pixhub	Provider adapters, fallback chains, tier routing
Generation	ComfyUI + kt-ai-Studio	Workflow execution, batch queue
Composition	reel-kit	HTML template → MP4 assembly
Speech	voice-compute	Edge-TTS, Whisper captions
Glue (in-repo)	apps/api, packages/template-engine, packages/cost-tracker	Batch input, template mapping, cost telemetry
Quick Start
Requirements — Docker 24+, Docker Compose v2, NVIDIA driver + Container Toolkit (GPU mode). Cloudflare account (tunnel mode).

bash
git clone git@github.com:your-org/video-batch-id.git
cd video-batch-id
cp .env.example .env
Local mode (development)
bash
docker compose --profile local up -d
Service	Endpoint
Web workspace	http://localhost:3000
API gateway	http://localhost:8000
Health check	http://localhost:8000/healthz
Tunnel mode (trial / demo)
Create a tunnel in Cloudflare Zero Trust → Networks → Tunnels.

Copy the tunnel token into .env as CLOUDFLARE_TUNNEL_TOKEN.

Create a D1 database and set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN.

Apply the schema: make d1-migrate.

Start the stack:

bash
docker compose --profile tunnel --profile gpu up -d
Your workspace is now reachable at https://vbid.your-domain.com, gated by Cloudflare Access.

First GPU start downloads model weights. Reserve ≥ 30 GB disk and allow several minutes.

Smoke test

bash
curl -X POST https://vbid.your-domain.com/v1/videos/generations \
  -H "Content-Type: application/json" \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -d '{
    "model": "vbid-standard",
    "prompt": "Product close-up, rotating, soft studio light",
    "duration": 5,
    "resolution": "480p"
  }'
Configuration
Configuration is environment-driven. Copy .env.example and adjust.

Variable	Description	Default
VBID_PROFILE	Active profile (local / tunnel / cloud)	local
VBID_GATEWAY_PORT	API gateway port	8000
VBID_WEB_PORT	Web workspace port	3000
VBID_STATE_BACKEND	d1 or sqlite	d1 in tunnel mode
VBID_DB_URL	Local SQLite URL (fallback)	sqlite:///data/vbid.db
CLOUDFLARE_ACCOUNT_ID	Cloudflare account	—
CLOUDFLARE_D1_DATABASE_ID	D1 database ID	—
CLOUDFLARE_API_TOKEN	API token with D1 read/write	—
CLOUDFLARE_TUNNEL_TOKEN	Tunnel token	—
VBID_OUTPUT_DIR	Local asset directory	./outputs
VBID_ROUTER_CONFIG	Routing policy YAML	config/routes.yaml
See docs/configuration.md for the full reference.

Project Structure
text
video-batch-id/
├── apps/
│   ├── api/                 # Gateway glue: batch ingest, dispatch, D1 state
│   └── web/                 # Operator workspace (batch UI)
├── packages/
│   ├── template-engine/     # (category, hook) → workflow params + HTML template
│   └── cost-tracker/        # Per-job cost and latency telemetry
├── vendor/                  # Service configs, pinned image refs (no source)
├── config/
│   └── routes.yaml          # Provider fallback + tier policy
├── migrations/
│   └── d1/                  # D1 schema migrations
├── outputs/                 # Generated assets (git-ignored)
├── docs/                    # PRD, architecture, configuration, licenses
├── docker-compose.yml
└── .env.example
No source is vendored. Services are pulled as pinned images or referenced via submodule. This keeps upstream upgrades clean and license boundaries explicit.

Development
bash
# API
cd apps/api && python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]" && pytest

# Web
cd apps/web && pnpm install && pnpm dev
Conventions — Conventional Commits, ruff + mypy (Python), eslint + prettier (TS). CI runs on every PR.

Roadmap
Version	Milestone	Deployment
v0.1.0	Minimal batch pipeline · OpenAI-compatible gateway · local SQLite state	local
v0.2.0	Tunnel mode · D1 state · Access-gated trial	tunnel
v0.3.0	Multi-provider routing · cost tracker · tier scheduling	tunnel
v0.4.0	Template engine v1 · reel-kit integration · TTS pipeline	tunnel
v0.5.0	Cloud VM deployment · Cloudflare Queues · R2 migration	cloud
v0.6.0	Horizontal scaling · Prometheus / OpenTelemetry export	cloud
Detailed scope in docs/ROADMAP.md.

Contributing
See CONTRIBUTING.md. All contributors follow the Code of Conduct.

License
This project is private and not open-sourced. Third-party dependency licenses — including MIT, Apache-2.0, AGPL, and commercial-restricted components — are enumerated in docs/licenses.md. Review before distribution.

Acknowledgments
Built on the shoulders of ComfyUI, pixhub, free-multimodal-proxy, reel-kit, and voice-compute.

<details> <summary><h3 id="简体中文">📖 简体中文</h3></summary>
Video Batch ID
工业级批量视频生成工作站。

Video Batch ID 是一个批量短视频生成的编排层。它将经过验证的开源组件组合为一条可复现的管线，对外提供 OpenAI 兼容 API，对内提供最小化运营工作台。

提交一批，回收一批。无需逐条照料。

设计原则

组装，而非重造 — 路由、生成、合成、语音均复用成熟开源项目。

后端无关 — 更换生成后端不影响 API 契约。

默认可观测 — 每个任务输出成本、延迟与溯源元数据。

可复现 — docker compose up 即可得到完整工作站。

边缘可达，本地执行 — 通过 Cloudflare Tunnel 暴露公网入口，推理留在可控的 GPU 硬件上。

核心能力

批量优先的 OpenAI 兼容 API（/v1/videos/generations），支持 SSE 与 webhook 回调

多后端路由与降级链（ComfyUI / 外部 API / 本地模型）

成本分层调度（standard / fast / economy），逐任务成本归因

片段 + 印尼语 TTS + 字幕 → 竖版 MP4 的可组合产出

Cloudflare D1 存储跨实例任务状态；本地 SQLite 作为离线降级

Cloudflare Tunnel + Access 提供可分享域名与身份门禁，无需公网 IP

版本化模板注册表，无硬编码工作流

部署模式

模式	用途	栈	公网
local	开发、测试	仅本地服务	❌
tunnel	MVP 演示、种子用户试用	本地服务 + Cloudflare Tunnel + Access + D1	✅
cloud	L2 平台化（未来）	云服务器 + Cloudflare Queues + R2	✅
当前目标为 tunnel 模式：无需公网 IP、无需对象存储、不暴露 GPU 基础设施，即可获得可分享的 HTTPS 域名、身份门禁与持久任务状态。

架构：客户端 → Cloudflare Tunnel + Access → 边缘网关（apps/web · apps/api）→ D1（状态与成本）/ 本地队列 → GPU Worker（pixhub + ComfyUI）→ 合成（reel-kit）→ 语音（voice-compute）→ 本地 outputs/ 视频，经同一 Tunnel 回传下载。

关键决策

MVP 不引入对象存储。 生成资产落在本地磁盘 outputs/，通过同一 Tunnel 回传。零 Egress 成本、零额外账户。

D1 是任务状态的唯一真相源。 本地 API 通过 Cloudflare REST API 直写 D1，无需 Workers。

队列暂时本地化。 GPU 消费端与队列同机，引入 Cloudflare Queue 只会增加延迟；待算力上云后再迁移（见路线图）。

每一层都是可替换服务。 路由决定“去哪”，管线决定“怎么做”，网关保证稳定契约。

技术栈：见上方表格。自研范围仅 apps/api、packages/template-engine、packages/cost-tracker 三块胶水。

快速开始

bash
git clone git@github.com:your-org/video-batch-id.git
cd video-batch-id
cp .env.example .env

# 本地开发
docker compose --profile local up -d

# Tunnel 试用模式（需配置 Tunnel token 与 D1 凭证）
docker compose --profile tunnel --profile gpu up -d
本地：Web http://localhost:3000 · API http://localhost:8000
Tunnel：https://vbid.your-domain.com（由 Cloudflare Access 门禁）

目录结构：apps/（网关胶水与 Web 工作台）、packages/（模板引擎与成本追踪）、vendor/（服务配置与镜像锁定，不存源码）、config/（路由策略）、migrations/d1/（D1 schema）、outputs/（生成资产，git 忽略）、docs/（PRD、架构、配置、许可证）。

开发约定：Conventional Commits；Python 用 ruff + mypy，TS 用 eslint + prettier；CI 覆盖所有 PR。

路线图：v0.1 最小批量管线 → v0.2 Tunnel 模式 + D1 → v0.3 多后端路由 + 成本追踪 → v0.4 模板引擎 + 合成 + TTS → v0.5 云服务器部署 + Queues + R2 → v0.6 水平扩展与可观测性导出。

许可证：本项目为私有项目。第三方依赖许可证（MIT / Apache-2.0 / AGPL / 商用受限）详见 docs/licenses.md，分发前必须核对。

</details> ```

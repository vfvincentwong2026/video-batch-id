<div align="center">

# Video Batch ID

**Industrial-grade batch video generation workstation.**

<sub>批量短视频素材生成工作站 · 可复现的批量化视频生产管线</sub>

[![CI](https://github.com/your-org/video-batch-id/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/video-batch-id/actions)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white)](#quick-start)
[![Python](https://img.shields.io/badge/python-3.11+-3776AB?logo=python&logoColor=white)](#tech-stack)
[![Node](https://img.shields.io/badge/node-20+-339933?logo=node.js&logoColor=white)](#tech-stack)
[![License: Private](https://img.shields.io/badge/license-Private-lightgrey)](#license)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[Overview](#overview) · [Features](#features) · [Architecture](#architecture) · [Quick Start](#quick-start) · [Configuration](#configuration) · [Roadmap](#roadmap) · [简体中文](#简体中文)

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
| **Job persistence** | SQLite (WAL) or Postgres. Resumes polling after restart. |
| **Pluggable templates** | Versioned template registry; no hardcoded workflows. |

---

## Architecture

```mermaid
flowchart LR
    A[Client<br/>OpenAI SDK] --> B[API Gateway<br/>free-multimodal-proxy]
    B --> C[Router<br/>pixhub]
    C -->|primary| D[ComfyUI Cluster<br/>Wan 2.x / local models]
    C -->|fallback| E[External APIs<br/>cost-tier overflow]
    D --> F[Compositor<br/>reel-kit]
    E --> F
    F --> G[TTS + Captions<br/>voice-compute]
    G --> H[Output<br/>MP4 · metadata]
Every stage is a replaceable service. The router decides where; the pipeline decides how; the gateway guarantees a stable contract.

Tech Stack
Layer	Component	Role
Gateway	free-multimodal-proxy / ComfyUI-OpenAI-API-Refactored	OpenAI-compatible ingress, async lifecycle
Router	pixhub	Provider adapters, fallback chains, tier routing
Generation	ComfyUI + kt-ai-Studio	Workflow execution, batch queue
Composition	reel-kit	HTML template → MP4 assembly
Speech	voice-compute	Edge-TTS, Whisper captions
Glue (in-repo)	apps/api, packages/template-engine, packages/cost-tracker	Batch input, template mapping, cost telemetry
Quick Start
Requirements — Docker 24+, Docker Compose v2, NVIDIA driver + Container Toolkit (for GPU mode).

bash
git clone git@github.com:your-org/video-batch-id.git
cd video-batch-id
cp .env.example .env

# CPU / external-API mode (default)
docker compose up -d

# GPU mode (local ComfyUI)
docker compose --profile gpu up -d
Service	Endpoint
Web workspace	http://localhost:3000
API gateway	http://localhost:8000
Health check	http://localhost:8000/healthz
First GPU start downloads model weights. Reserve ≥ 30 GB disk and allow several minutes.

Smoke test

bash
curl -X POST http://localhost:8000/v1/videos/generations \
  -H "Content-Type: application/json" \
  -d '{
    "model": "vbid-standard",
    "prompt": "Product close-up, rotating, soft studio light",
    "duration": 5,
    "resolution": "480p"
  }'
Configuration
Configuration is environment-driven. Copy .env.example and adjust.

Variable	Description	Default
VBID_GATEWAY_PORT	API gateway port	8000
VBID_WEB_PORT	Web workspace port	3000
VBID_DB_URL	Job store (sqlite / postgres)	sqlite:///data/vbid.db
VBID_ROUTER_CONFIG	Path to routing policy (YAML)	config/routes.yaml
VBID_PROVIDER_*	Per-provider credentials	—
VBID_COST_BACKEND	Cost telemetry sink (sqlite / prometheus)	sqlite
See docs/configuration.md for the full reference.

Project Structure
text
video-batch-id/
├── apps/
│   ├── api/                 # Gateway glue: batch ingest, dispatch, cost hooks
│   └── web/                 # Operator workspace (batch UI)
├── packages/
│   ├── template-engine/     # (category, hook) → workflow params + HTML template
│   └── cost-tracker/        # Per-job cost and latency telemetry
├── vendor/                  # Service configs, pinned image refs (no source)
├── config/
│   └── routes.yaml          # Provider fallback + tier policy
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
Version	Milestone
v0.1.0	Minimal batch pipeline · OpenAI-compatible gateway · SQLite job store
v0.2.0	Multi-provider routing · cost tracker · tier scheduling
v0.3.0	Template engine v1 · reel-kit integration · TTS pipeline
v0.4.0	Operator workspace · seed-user validation
v0.5.0	Horizontal scaling · Prometheus / OpenTelemetry export
Detailed scope in docs/ROADMAP.md.

Contributing
See CONTRIBUTING.md. All contributors follow the Code of Conduct.

Issue / PR templates are pre-configured. For design changes, open an RFC under docs/rfcs/.

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

核心能力

批量优先的 OpenAI 兼容 API（/v1/videos/generations），支持 SSE 与 webhook 回调

多后端路由与降级链（ComfyUI / 外部 API / 本地模型）

成本分层调度（standard / fast / economy），逐任务成本归因

片段 + 印尼语 TTS + 字幕 → 竖版 MP4 的可组合产出

任务持久化（SQLite WAL / Postgres），重启自动恢复

版本化模板注册表，无硬编码工作流

架构：客户端 → 网关（free-multimodal-proxy）→ 路由（pixhub）→ 生成（ComfyUI / 外部 API）→ 合成（reel-kit）→ 语音（voice-compute）→ 输出。每一层都是可替换服务。

技术栈：见上方表格。自研范围仅 apps/api、packages/template-engine、packages/cost-tracker 三块胶水。

快速开始

bash
git clone git@github.com:your-org/video-batch-id.git
cd video-batch-id
cp .env.example .env
docker compose up -d            # CPU / 外部 API 模式
docker compose --profile gpu up -d   # GPU / 本地 ComfyUI 模式
Web：http://localhost:3000 · API：http://localhost:8000

目录结构：apps/（网关胶水与 Web 工作台）、packages/（模板引擎与成本追踪）、vendor/（服务配置与镜像锁定，不存源码）、config/（路由策略）、docs/（PRD、架构、配置、许可证）。

开发约定：Conventional Commits；Python 用 ruff + mypy，TS 用 eslint + prettier；CI 覆盖所有 PR。

路线图：v0.1 最小批量管线 → v0.2 多后端路由 + 成本追踪 → v0.3 模板引擎 + 合成 + TTS → v0.4 运营工作台 → v0.5 水平扩展与可观测性导出。

许可证：本项目为私有项目。第三方依赖许可证（MIT / Apache-2.0 / AGPL / 商用受限）详见 docs/licenses.md，分发前必须核对。

</details> ```

<div align="center">

# Video Batch ID

**Batch video asset workstation for e-commerce and MCN teams.**

<sub>面向电商与 MCN 的批量短视频素材工作站 · 生成 · 入库 · 复用 · 越用越准</sub>

[![CI](https://github.com/your-org/video-batch-id/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/video-batch-id/actions)
[![Docker](https://img.shields.io/badge/docker-compose-2496ED?logo=docker&logoColor=white)](#quick-start)
[![Python](https://img.shields.io/badge/python-3.11+-3776AB?logo=python&logoColor=white)](#tech-stack)
[![Node](https://img.shields.io/badge/node-20+-339933?logo=node.js&logoColor=white)](#tech-stack)
[![Cloudflare](https://img.shields.io/badge/cloudflare-tunnel%20%2B%20d1-F38020?logo=cloudflare&logoColor=white)](#deployment-modes)
[![License: Private](https://img.shields.io/badge/license-Private-lightgrey)](#license)

[Why](#why) · [Who it's for](#who-its-for) · [Core Workflow](#core-workflow) · [Features](#features) · [Architecture](#architecture) · [Quick Start](#quick-start) · [Roadmap](#roadmap) · [简体中文](#简体中文)

</div>

---

## Why

Generating one good video is a creative problem. Generating **a hundred usable assets per week** is a workflow problem.

Video Batch ID is built for the second one. Upload a batch of products or scripts, pick a validated template, get a hundred variants, mark the good ones, and let the library compound. Every asset that gets reused makes the next batch smarter.

**Design principles**

- **Asset-first, not job-first** — every clip enters a searchable library with structured metadata. Jobs are transient; assets compound.
- **Template over prompt** — operators pick from validated recipes, not blank text boxes.
- **Batch is the default** — one upload, many outputs. No per-clip babysitting.
- **Observable cost** — every job shows its price before you commit and its real cost after it runs.
- **Assemble, don't rebuild** — routing, generation, composition, and speech are handled by battle-tested OSS.

---

## Who it's for

| User | Pain today | What they get |
|---|---|---|
| **E-commerce seller / UMKM** | Product photos exist, but video production is slow and expensive | Upload SKU sheet → batch product showcase videos, virtual try-on, multi-angle variants |
| **MCN / agency operator** | Needs volume, style consistency, and per-clip control | Multi-account batch generation, per-clip re-render, character/style consistency |
| **Content operator** | Spends hours per clip, can't track what works | One dashboard: generate, review, rate, reuse. Cost visible at every step. |

---

## Core Workflow

### E-commerce: product-to-video batch
① Upload products → ② Pick template → ③ Set batch params → ④ Generate
↓
⑦ Reuse / re-generate ← ⑥ Auto-index to library ← ⑤ Review & rate

text

| Step | You see | You do | System does |
|---|---|---|---|
| ① Upload | Drag zone + CSV template | Drop product images, upload SKU sheet | Parses SKUs, extracts selling points, detects category |
| ② Template | Card gallery with 3-second previews | Pick "Beauty · Problem-Solution · TikTok" | Loads Skill recipe + provider preferences |
| ③ Params | Sliders: variants per SKU, cost tier, duration | Drag slider, see live cost estimate | Computes estimated cost, locks budget ceiling |
| ④ Generate | Live queue with per-task progress | Wait or walk away | Routes to GPU, async generation, auto-fallback on failure |
| ⑤ Review | Grid view, playable, rate 👍/👎 | Quick-scan, rate, add notes | Records outcome, writes back to knowledge layer |
| ⑥ Index | "87 assets indexed" toast | One-click index | Argus-style visual metadata + tags + embeddings |
| ⑦ Reuse | Library search bar | Search "beauty + oily + last week" | Full-text + semantic retrieval |

### MCN: matrix batch

Same flow, with two differences: step ② adds **character/style consistency** options, and step ⑤ adds **per-clip re-render** so a single bad shot doesn't require regenerating the whole batch.

---

## Features

| Capability | What it means for you |
|---|---|
| **Batch upload & SKU parsing** | Drop a CSV, get a queue. No per-item setup. |
| **Template gallery with preview** | See 3-second previews before you commit. No prompt writing. |
| **Live cost estimate** | Know the price before you click generate. See real spend in the queue. |
| **Review & rate** | 👍/👎 every clip. Good ones auto-index; bad ones feed back into routing. |
| **Searchable asset library** | Every output indexed with visual metadata, tags, and embeddings. Find "that beauty clip from last week" in seconds. |
| **Reuse & re-generate** | Pull a past asset back into a new batch, or re-render one variant without touching the rest. |
| **Skill-based routing memory** | Validated recipes + historical outcomes → cost/quality-aware provider selection. |
| **OpenAI-compatible API** | `POST /v1/videos/generations` — programmatic access for automation. |
| **Multi-language TTS** | Indonesian (`id-ID-ArdiNeural`, `id-ID-GadisNeural`) out of the box. |
| **Public trial access** | Cloudflare Tunnel + Access — shareable domain, SSO/OTP gated. |

---

## Architecture

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
Key decisions

Asset library is a first-class layer, not a folder. Every output is indexed, tagged, and searchable.

Knowledge is a sidecar, not a blocker. If the knowledge store fails, generation still routes with default policy.

No object storage in MVP. Assets live on local disk, served through the same Tunnel. Zero egress cost.

D1 is the source of truth for job state. Local API writes to D1 via REST — no Workers required.

Queues are local for now. GPU consumer runs on the same host. Cloudflare Queues arrive when compute moves to cloud.

UI Overview
Screen	Purpose
Dashboard	Today's output, success rate, spend, running jobs, recently-rated assets
Batch Generate	4-step wizard: upload → template → params → submit. Live cost estimate.
Template Gallery	Card grid with 3-second previews, ratings, reuse counts
Task Queue	Per-task progress, real-time spend, auto-retry indicator
Review	Grid view, play, rate, batch-download, per-clip re-render
Asset Library	Search bar + filters (category, platform, tag, date), reuse button
Knowledge (internal)	Skill success rates, cost per outcome, reuse analytics
Tech Stack
Layer	Component	Role
Ingress	Cloudflare Tunnel	Public HTTPS endpoint, no open ports
Access	Cloudflare Access	SSO / OTP gate for trial users
State	Cloudflare D1	Job state, cost records
Asset Index	Argus-style scanner + SQLite FTS5	Visual metadata, tags, full-text search
Gateway	free-multimodal-proxy / ComfyUI-OpenAI-API-Refactored	OpenAI-compatible ingress, async lifecycle
Router	pixhub	Provider adapters, fallback chains, tier routing
Generation	ComfyUI + kt-ai-Studio	Workflow execution, batch queue
Composition	reel-kit	HTML template → MP4 assembly
Speech	voice-compute	Edge-TTS, Whisper captions
Glue (in-repo)	apps/api, apps/web, packages/template-engine, packages/cost-tracker, packages/asset-index	Batch ingest, UI, template mapping, cost telemetry, asset indexing
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

Copy the token into .env as CLOUDFLARE_TUNNEL_TOKEN.

Create a D1 database, set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN.

Apply schema: make d1-migrate.

Start:

bash
docker compose --profile tunnel --profile gpu up -d
Workspace reachable at https://vbid.your-domain.com, gated by Cloudflare Access.

First GPU start downloads model weights. Reserve ≥ 30 GB disk.

First-run walkthrough

Open the dashboard → click Upload products

Drop product images or upload a CSV → confirm parsed SKUs

Pick a template from the gallery → preview plays inline

Set variants per SKU (default: 5) and cost tier (default: standard)

Review estimated cost → click Generate

Watch the queue → when done, open Review

Rate 👍/👎 → click Index to library

Open Asset Library → search or reuse

Configuration
Variable	Description	Default
VBID_PROFILE	local / tunnel / cloud	local
VBID_GATEWAY_PORT	API gateway port	8000
VBID_WEB_PORT	Web workspace port	3000
VBID_STATE_BACKEND	d1 or sqlite	d1 in tunnel mode
VBID_ASSET_DIR	Asset storage directory	./assets
VBID_INDEX_BACKEND	sqlite-fts / pgvector	sqlite-fts
CLOUDFLARE_ACCOUNT_ID	Cloudflare account	—
CLOUDFLARE_D1_DATABASE_ID	D1 database ID	—
CLOUDFLARE_API_TOKEN	API token with D1 read/write	—
CLOUDFLARE_TUNNEL_TOKEN	Tunnel token	—
VBID_ROUTER_CONFIG	Routing policy YAML	config/routes.yaml
See docs/configuration.md for the full reference.

Project Structure
text
video-batch-id/
├── apps/
│   ├── api/                 # Gateway glue: batch ingest, dispatch, D1 state
│   └── web/                 # Operator workspace (dashboard, wizard, review, library)
├── packages/
│   ├── template-engine/     # (category, hook) → workflow params + HTML template
│   ├── cost-tracker/        # Per-job cost and latency telemetry
│   ├── asset-index/         # Argus-style visual metadata + FTS5 indexing
│   └── knowledge-store/     # Skill outcomes, reuse signals, routing memory
├── skills/                  # YAML skill recipes (versioned)
├── vendor/                  # Service configs, pinned image refs (no source)
├── config/
│   └── routes.yaml          # Provider fallback + tier policy
├── migrations/
│   └── d1/                  # D1 schema migrations
├── assets/                  # Generated assets (git-ignored)
├── docs/                    # PRD, architecture, configuration, licenses
├── docker-compose.yml
└── .env.example
Roadmap
Version	Milestone	Deployment
v0.1.0	Batch wizard · template gallery · live cost estimate · local SQLite state	local
v0.2.0	Tunnel mode · D1 state · Access-gated trial · task queue UI	tunnel
v0.3.0	Review & rate · Argus-style asset indexing · SQLite FTS5 search	tunnel
v0.4.0	Product-to-video workflow · SKU batch input · virtual try-on	tunnel
v0.5.0	Skill recipe engine · outcome writeback · cost/quality-aware routing	tunnel
v0.6.0	MCN matrix mode · style consistency · per-clip re-render	tunnel
v0.7.0	pgvector semantic search · reuse analytics · cloud VM deployment	cloud
Model Licenses
Commercial use requires per-model verification. Current anchors:

Model	License	Commercial note
Wan 2.2 (T2V-A14B / TI2V-5B)	Apache 2.0	No revenue cap, no region exclusion. Primary anchor.
LTX-Video / LTX-2.3	LTX Open Weights	Free under $10M annual revenue; paid license above.
HunyuanVideo	Tencent Community	Excludes EU/UK/South Korea; 100M MAU cap.
CogVideoX-5b	CogVideoX Community	Free under 1M MAU.
Full matrix in docs/licenses.md.

Contributing
See CONTRIBUTING.md. All contributors follow the Code of Conduct.

License
This project is private and not open-sourced. Third-party dependency licenses are enumerated in docs/licenses.md. Review before distribution.

<details> <summary><h3 id="简体中文">📖 简体中文</h3></summary>

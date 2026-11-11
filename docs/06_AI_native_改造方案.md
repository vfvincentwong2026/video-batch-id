# 06 · Video Batch ID 全面 AI-Native 改造方案 v2（托管融合版）

> 学习来源：`vfvincentwong2026/ai-native-dam`（Phase 0，治理契约完整）
> 日期：2026-11-12 v2（v1 同日，按 owner 裁决重构）· 作者：PM
> **Owner 裁决**：VBID 必须成为**原生态 AI-native 项目**，未来将**融合托管进 ai-native-dam**。
> 因此改造的第一性原理：**从现在起，每一行代码、每一张表、每一个端点都按"即将被 DAM 托管"的标准写**——不是把 VBID 改得"像" DAM，而是把 VBID 写成 DAM 的一个尚未合并的包。

---

## 一、终态定位（Target Architecture）

```
┌────────────────────── ai-native-dam（治理平面，唯一事实源）──────────────────────┐
│  Assets · Rights · Approval · Audit · Knowledge · Skills · Specs · Distillation │
│                                                                                 │
│  ┌──────────────── 托管接入：Video Batch ID = 视频二创执行能力包 ──────────────┐ │
│  │  packages/video-distiller/                                                  │ │
│  │    ├── MCP tools: parse_master / suggest_matrix / submit_generation / ...   │ │
│  │    ├── runtime: pipeline（解析→矩阵→生成→守卫） provider 抽象               │ │
│  │    └── distillation: 二创配方 → Skill 注册（带版本/权限/溯源）              │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
         ▲ 唯一的操作面 = MCP（Streamable HTTP）· Web UI 只是 MCP 的一个客户端
   人 / Kimi / Claude / Grok / 客户 Agent（A2A）
```

**三条铁律：**
1. **MCP-first**：所有能力先定义为 MCP 工具契约（`docs/mcp-tools.md` 格式），REST/SPA 只是契约的投影，永不留私有端点
2. **治理不自建**：Rights/Approval/Audit 语义直接采用 DAM 的 `policies/` 与 shared-schema；VBID 落地为 SQLite 实现，schema 与 DAM `infra/migrations` 对齐，未来平移 Postgres 零改动
3. **知识与 Skill 从第一天沉淀**：每次解析、每次生成、每次审核都在写知识库；每个跑通的配方自动可注册为 Skill——不是 P3 的功能，是 P1 的表

---

## 二、ai-native-dam 十条可迁移原则 → VBID 落地映射

| # | DAM 原则 | VBID 落地 |
|---|---|---|
| 1 | 治理平面是唯一事实源 | assets/variants 带 Provenance+Rights；check_use 前置 |
| 2 | 一个契约走天下 | `/mcp` 端点为一等公民；现有 REST 逐步收编为 MCP 工具的 HTTP 投影 |
| 3 | 风险分级 + 写门审批 | `policies/risk-levels.yml` + `approval-gates.yml`（照抄 DAM 格式）；真实生成=high，永不自动批 |
| 4 | 审批双通道 | two-call token（SPA 弹确认）；elicitation 待 Kimi 客户端支持后启用 |
| 5 | 溯源原生 | prompt 全文、model、jobId、成本、谱系全部落 ProvenanceRecord |
| 6 | 三平面边界 | pipeline 包保持零业务状态；执行平面不自建审批逻辑，调治理工具 |
| 7 | check_use 前置 | 二创发布前：渠道/地区/期限/授权状态数据化，record_usage 被拒于权利不符 |
| 8 | 知识分层 write-gated | `knowledge_entries(layer: raw|topic|rule|qa)`；解析→画像→规律→问答逐层沉淀 |
| 9 | Skill 即资产 | `skills` + `skill_versions` 表；"糖果类二创配方"注册为 versioned skill，apply_skill 复用 |
| 10 | 模型路由 C0–C3 | C0 规则/ffmpeg · C1 gpt-4o-mini+veo-lite · C2 wan-2.7 · C3 预留；路由入任务配置 |

---

## 三、差距现状（v1 诊断不变，一句话版）

执行平面干净 ✅；缺治理平面全件套：审批门 ❌、MCP 契约 ❌、Rights ❌、Audit ❌、知识分层 ⚠️、Skill 注册 ⚠️、模型分档 ⚠️。

---

## 四、改造路线（对齐即迁移：每期结束都应可整体搬进 DAM）

### P1 · AI-native 地基（1–2 周）——按 DAM 包规范重打地基

**目录对齐**（现在就长成 DAM 的样子）：
```
video-batch-id/
├── policies/                  # 照 DAM 格式：risk-levels.yml / approval-gates.yml / permission-scopes.yml
├── packages/
│   ├── shared-schema/         # Zod 契约：assets/provenance/rights/approval/knowledge/skills/mcp-tools
│   ├── governance/            # check_use / 审批门 token / audit 记录（纯函数，可测）
│   ├── pipeline/              # 现有，不动
│   ├── reference-parser/      # 现有，不动
│   ├── gen-provider/          # 现有，不动
│   └── variable-matrix/       # 现有，不动
├── apps/
│   ├── api/                   # node:http：/mcp 端点 + REST 投影（收编中）
│   └── web/                   # SPA 改调 MCP 工具
└── docs/mcp-tools.md          # 工具契约文档（DAM 格式）
```

**数据层对齐**（SQLite 新增 5 表，命名对齐 DAM `infra/migrations`）：
`rights`（license/territory/channels/embargo/expires）· `approvals`（tool/resource_key/token/status）· `audit_log`（actor/action/payload/cost）· `knowledge_entries`（layer/write-gated）· `skills` + `skill_versions`（version/provenance/rights_scope）

**行为变化**：
- 真实生成（high risk）：two-call token 审批，SPA 弹"金额/条数/key 余量"确认；mock 链路 low risk 自动放行
- prompt 全文落 ProvenanceRecord（去掉 160 字符截断）
- **知识自动沉淀开关打开**：每次解析写 `raw`；每次任务完成写 `topic`（素材画像）；每次审核写回画像
- 模型分档配置：C1=veo-3.1-lite（$0.12/条走量）/ C2=wan-2.7（$0.50/条精修）

### P2 · MCP 工具面（2 周）——成为 DAM 的合格能力包

- `POST /mcp`（Streamable HTTP，JSON-RPC + SSE），首发 10 工具：

| 工具 | Risk | Gated | 说明 |
|---|---|---|---|
| `search_assets` / `get_lineage` | low | — | 检索/谱系 |
| `parse_master` / `suggest_matrix` | low | — | VLM 解析 + 智能变量推荐 |
| `check_use` | low | — | 渠道/地区/授权检查（rights 表驱动） |
| `create_task` | medium | ✅ token | 建任务 |
| `submit_generation` | **high** | ✅ 必批 | 真实生成，金额确认 |
| `record_usage` | medium | ✅ token | 发布用途登记 |
| `review_variant` | low | — | 👍/👎（写回知识层 rule） |
| `search_knowledge` | low | — | 分层检索 |
| `register_skill` / `apply_skill` | medium/high | ✅ | 配方注册为 Skill / 复用 Skill 一键二创 |

- SPA 全面切到 MCP 客户端；REST 端点标注 deprecated，P3 删除
- **验收标准**：换一个全新 MCP 客户端（如 Claude Desktop），不看我们 SPA 也能完成"选素材→二创→审核"全链路

### P3 · 学习闭环 + 迁移（2–3 周）——托管进 DAM

- **Skill 蒸馏闭环**：任务跑通 N 次且 👍 率 ≥ 阈值 → `register_skill` 生成配方（矩阵模板+prompt 模板+路由档位+首帧锚定参数），带版本与 provenance
- **规则引擎 v2**：`rule` 层知识反哺 suggest_matrix（"拉丝 Hook+户外场景 👍率 78%"成为推荐理由的真实数据源）
- **迁移**：repo 以 `packages/video-distiller/` 形式并入 ai-native-dam；SQLite schema 平移 Postgres（命名已对齐）；governance 包替换为 DAM 官方实现，VBID 本地版退役

### P4 · A2A 与网络效应（后置）

- Agent Card（`/.well-known/agent.json`）：客户 Agent 委派"帮我二创这条素材"
- 与 DAM 的 RedFox/OneAPI 连接器联动：发布 → record_usage → 表现回流 rule 层，闭环

---

## 五、知识库与 Skill 沉淀规范（每天发生，不是里程碑）

**知识分层写入策略：**

| 层 | 谁写 | 写什么 | 例子 |
|---|---|---|---|
| raw | parse_master 自动 | VLM 解析原始结果 | 镜头/Hook/转录/BGM |
| topic | 任务完成自动 | 素材画像 | "糖果类·开袋 Hook·平均 4 镜头·9:16" |
| rule | review_variant 自动 | 审核/表现规律 | "户外场景+拉丝 Hook：👍 6/8" |
| manual | 人写（write-gated） | 运营经验 | "斋月前两周上食品素材" |
| qa | 人写（write-gated） | 常见问题 | "key 403 限额怎么办" |

**Skill 注册门槛**：同配方 ≥3 次任务、≥8 条变体、👍 率 ≥60% → 可注册 v1；后续每次复用累计数据升版本。

---

## 六、拍板清单

1. **P1 目录重构**：接受按 DAM 包规范重排 repo（packages/shared-schema + governance + policies/）？
2. **审批门**：真实生成必须 two-call token 确认（多一次点击，防误触烧钱）？
3. **知识/Skill 表随 P1 落地**（不是后置功能）？
4. **模型双档**：C1=veo-3.1-lite 走量 + C2=wan-2.7 精修，作为 submit_generation 的默认路由？
5. **迁移承诺**：P3 整体并入 ai-native-dam，期间不做任何 DAM 之外的私有契约？

## 七、不做的事

- 不引入 Postgres/Docker（SQLite 够用，命名对齐即可平移）
- 不重写 pipeline/variable-matrix/provider 抽象（执行平面已干净，治理套壳即可）
- 不做私有 REST 扩展（所有新能力只进 MCP 契约）

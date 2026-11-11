# 06 · Video Batch ID 全面 AI-Native 改造方案

> 学习来源：`vfvincentwong2026/ai-native-dam`（Phase 0，治理契约完整）
> 日期：2026-11-12 · 作者：PM（产品经理视角）
> 定位：Video Batch ID 从「REST + SPA 工具」进化为「Agent 优先的 AI 原生二创生产线」

---

## 一、ai-native-dam 核心理念学习摘要

DAM 库代码量小（约 700 行 TS + SQL），但它的**治理语义设计**是完整且成熟的，十条可迁移原则：

| # | 原则 | DAM 的做法 | 一句话本质 |
|---|---|---|---|
| 1 | **治理平面是唯一事实源** | 五类资产（媒体/Skill/系统/知识/蒸馏物）统一 Rights·Provenance·Approval·Audit | "Query rights, not remember them" — 权限是数据，不是脑中的部落知识 |
| 2 | **一个契约走天下（MCP-first）** | Web UI 只是 MCP 的一个客户端，**无私有端点** | 人、Bot、CLI、别的 Agent 看到的能力面完全一致 |
| 3 | **风险分级 + 写门审批** | low/medium/high 三级；gated 工具全走 mcp-approval；high 永不自动批准 | 花钱的、不可逆的操作必须有人确认 |
| 4 | **审批双通道** | 支持 elicitation（客户端弹真人确认）就用；不支持则 two-call token（首调返回随机串，二调引用回） | 模型不能替人回答"批准" |
| 5 | **溯源原生** | 每个生成资产带 model/prompt/license/source | 没有溯源的生成物不是资产，是负债 |
| 6 | **三平面边界** | Governance / Execution / Consumers 分离，执行平面**不得自建审批逻辑** | 治理不可选（Governance is not optional） |
| 7 | **check_use 前置** | 用之前先问"渠道 X 地区 Y 现在能不能用"，不行给 replacement_id | 权利检查是用法的一部分，不是事后补登 |
| 8 | **知识分层 write-gated** | raw / topic / manual / rule / qa 五层，写入需审批 | 知识有层级、有闸门，检索按层收敛 |
| 9 | **Skill 即资产** | 跑通的 SOP 蒸馏为带版本、带权限的可复用能力 | 能力复利：越用越聪明 |
| 10 | **模型路由分档** | OpenSquilla C0–C3：常规活走便宜模型，难题才上贵模型 | 成本是路由出来的，不是砍出来的 |

---

## 二、对照检查：Video Batch ID 现状打分

| 维度 | 现状 | 差距 |
|---|---|---|
| Provenance 溯源 | ✅ 已有：`gen{generator, jobId, usageCostUsd}` + 谱系树 + spec 指纹 | 缺 license/rights 字段；prompt 未完整留存（descriptor 截断 160 字符） |
| 审批门 | ⚠️ 半吊子：👍/👎 是**生成后**审核；**真实扣费生成一键即跑**（high risk 无门！） | 花钱操作没有前置确认 —— 这是与 DAM 理念最大的冲突 |
| 风险分级 | ❌ 无 | run/demo/parse/review 全部一个待遇 |
| MCP 契约 | ❌ 只有 REST + 自家 SPA | Agent（Kimi/Claude/Grok）无法直接操作生产线 |
| Rights 权利层 | ❌ 无 | 二创素材的"可二创授权"是口头约定，渠道/地区/期限无数据 |
| Audit 审计 | ❌ 无 | 谁在何时跑了什么、扣了多少钱，只有变体 meta 散落记录 |
| 知识分层 | ⚠️ 雏形：解析结果 + 价值榜 | 没有从"解析→投放表现"沉淀为可复用规则 |
| Skill 蒸馏 | ⚠️ 雏形：矩阵推荐规则引擎 v1 | 跑通的素材配方不能注册/复用/版本化 |
| 模型路由 | ⚠️ 单模型 + 回退链 | 无 C0–C3 档位意识（便宜活也在用同一档） |
| 三平面边界 | ✅ 意外地好：pipeline 包零业务状态，REST 只做读写 | 保持，补治理即可 |

**一句话诊断**：Video Batch ID 的执行平面（pipeline + provider 抽象）已经干净，缺的是**整个治理平面**——而 DAM 库恰好把治理语义设计好了，且两者是同一个 owner's 项目，天然可以组合而非重写。

---

## 三、改造蓝图（四期）

### P1 · 治理内核（1–2 周）——把"花钱的门"装上

- **风险分级表**（照 DAM policies 格式进 `policies/risk-levels.yml`）：
  - `low`：search/lineage/analysis 读取类
  - `medium`：建任务、改矩阵、登记资产（可逆，token 审批）
  - `high`：**真实生成（cost-incurring）**、批量删除 —— 永不自动批准
- **审批门**：`POST /api/tasks/:id/run` 带 `generator=openrouter` 时 → two-call token（首调返回 `approval_token + 预估金额`，二调带 token 才真正执行）；SPA 队列页变成"点生成 → 弹确认（金额/条数/key 余量）→ 执行"
- **Provenance 补全**：prompt 全文落库（去掉 160 字符截断），加 `license` 字段（Master 登记时声明二创授权来源）
- **Audit 表**：`audit_log(id, actor, action, payload_json, cost_usd, created_at)`——每次 run/parse/review 记一条
- **预算预检已备**：key 余量检查（P0 已做）接入审批弹窗展示

### P2 · MCP 化（2 周）——让 Agent 直接开生产线

- 现有 node:http 服务**加一个 `/mcp` Streamable HTTP 端点**，把能力工具化（契约抄 DAM 的 `docs/mcp-tools.md` 格式）：

| 工具 | Risk | Gated | 对应现有能力 |
|---|---|---|---|
| `search_assets` / `get_lineage` | low | — | 素材库/谱系 |
| `parse_master` / `suggest_matrix` | low | — | VLM 解析 + 智能推荐 |
| `check_use` | low | — | **新增**：这条素材能否在渠道 X 地区 Y 二创发布 |
| `create_task` | medium | ✅ token | 建任务 |
| `submit_generation` | **high** | ✅ elicitation/token | 真实生成（带金额确认） |
| `record_usage` | medium | ✅ token | 发布时记录用途 |
| `review_variant` | low | — | 👍/👎 |

- **边界规则照抄 DAM**：SPA 逐步改为 MCP 客户端调用，不留私有端点；执行平面不自建审批
- 收益：你在这个 Kimi 对话框里就能说"把糖果 1 号素材二创 8 条"，Agent 走 MCP 直接干完

### P3 · 学习闭环（2–3 周）——越用越便宜，越用越准

- **模型路由 C0–C3**：C0=规则/本地 ffmpeg，C1=gpt-4o-mini（解析）/veo-lite（走量生成），C2=wan-2.7（精修），C3 预留；路由策略入矩阵任务配置
- **知识分层**（照 DAM 五层）：
  - `raw`：VLM 解析结果（已有）
  - `topic`：素材画像（品类/钩子类型/节奏）
  - `rule`：审核与投放规律（"拉丝 Hook + 户外场景 👍率最高"）
  - `qa`：常见问答
- **Skill 注册**：跑通的配方（某类素材的矩阵 + prompt 模板 + 路由档位）注册为 versioned skill，`apply_skill` 一键复用——这就是"糖果类二创 SOP"的沉淀方式
- **价值榜升级**：接入 👍/👎 + record_usage 数据，自动反哺矩阵推荐规则引擎 v2

### P4 · 对外协作（后置）——A2A 与 DAM 对接

- **A2A Agent Card**（`/.well-known/agent.json`）：别的 agent 可委派"帮我二创这条素材"任务
- **与 ai-native-dam 组合**（compose, don't rewrite）：VBID 变体作为 governed asset 注册进 DAM；VBID 执行前调 DAM 的 `check_use` 问权利。DAM 是治理平面，VBID 是视频执行平面——不是竞争，是上下游

---

## 四、和 ai-native-dam 的关系定调

```
ai-native-dam（治理平面）          Video Batch ID（执行平面）
  Rights · Approval · Audit  ◄──►  解析 → 矩阵 → 生成 → 守卫 → 审核
  五类资产登记                    视频二创专精管线
```

- **不重复造**：DAM 已有权利/审批/审计语义，VBID P1 自建轻量版（SQLite 规模够用），P4 再对接
- **组合点**：VBID 的每个 Master/Variant 都是 DAM 意义上的"media asset with provenance"；VBID 的"配方"是 DAM 意义上的"skill"

---

## 五、拍板清单

1. **P1 审批门**：同意"真实生成 = high risk，必须金额确认后才能跑"？（会多一次点击，但再也不怕误触烧 $4）
2. **P2 MCP 化**：同意把 `/mcp` 作为一等公民，SPA 退化为 MCP 客户端？
3. **P3 路由档位**：同意默认走量生成切 veo-3.1-lite（$0.12/条）+ 精修走 wan-2.7（$0.50/条）的双档策略？
4. **P4 对接 DAM**：确认 VBID 定位 = DAM 的视频执行平面，P4 做 asset/skill 双向注册？

## 六、风险与不做的事

- **不做**：不重写 pipeline/variable-matrix（执行平面已干净）；不引入 Postgres（SQLite 规模足够，D1 后置）
- **风险**：MCP 化后 Agent 可操作面扩大 → 审批门必须在 P2 之前落地（P1 先行是硬依赖）

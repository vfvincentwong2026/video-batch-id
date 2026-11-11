/**
 * @vbid/shared-schema —— 共享治理契约
 *
 * 对齐 ai-native-dam/packages/shared-schema 的语义（Rights · Provenance · Approval ·
 * Knowledge · Skill · MCP 工具契约），零依赖纯 TS 实现 + 手写校验器。
 * 托管进 DAM 后本包由 @ai-native-dam/shared-schema 的 Zod 版替换，调用方零改动。
 */

// ---------- Provenance 溯源 ----------

export interface ProvenanceRecord {
  /** 生成器：mock | openrouter */
  generator: string;
  /** 模型 slug（如 alibaba/wan-2.7） */
  model?: string | null;
  /** 供应商作业 ID（对账/审计） */
  jobId?: string | null;
  /** 完整生成提示词（不再截断，P1 起全量落库） */
  prompt?: string | null;
  /** 首帧锚定来源：镜头 index + 时间戳 */
  anchor?: { shotIndex: number; midMs: number } | null;
  /** 实扣金额 USD */
  usageCostUsd?: number | null;
  /** 父级溯源：Master asset id + 解析器 */
  masterAssetId: string;
  parseParser?: string | null;
  /** 生成时间 ISO */
  createdAt: string;
}

export function isProvenanceRecord(v: unknown): v is ProvenanceRecord {
  const o = v as ProvenanceRecord;
  return !!o && typeof o.generator === 'string' && typeof o.masterAssetId === 'string';
}

// ---------- Rights 权利 ----------

export type RightsStatus = 'Cleared' | 'Restricted' | 'Expired';

export interface RightsRecord {
  assetId: string;
  /** 授权来源说明（如"客户书面授权二创"） */
  license: string;
  status: RightsStatus;
  /** 可发布渠道（x/youtube/instagram/xiaohongshu/wechat_channels/tiktok…） */
  channels: string[];
  /** 可发布地区（ISO 3166 或 "Global"） */
  territories: string[];
  /** 禁发期（在此之前不可用） */
  embargoUntil: string | null;
  /** 授权到期时间 */
  expiresAt: string | null;
}

export interface CheckUseInput {
  channel: string;
  territory?: string;
  at?: string;
}

export interface CheckUseOutput {
  allowed: boolean;
  reason: string;
  replacementId: string | null;
}

export function isRightsRecord(v: unknown): v is RightsRecord {
  const o = v as RightsRecord;
  return !!o
    && typeof o.assetId === 'string'
    && typeof o.license === 'string'
    && ['Cleared', 'Restricted', 'Expired'].includes(o.status)
    && Array.isArray(o.channels)
    && Array.isArray(o.territories);
}

// ---------- Approval 审批 ----------

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ApprovalGate {
  tool: string;
  risk: RiskLevel;
  /** elicitation（客户端弹真人确认）优先；不支持时 two-call token 兜底 */
  method: 'elicitation_or_token' | 'elicitation_only';
  resourceKey: string;
  neverAutoApprove?: boolean;
}

export interface ApprovalRequest {
  tool: string;
  resourceKey: string;
  /** 审批请求时锁定的调用参数（防止令牌挪用） */
  argsJson: string;
  token: string;
  /** 过期时间 ISO */
  expiresAt: string;
}

export interface ApprovalDecision {
  ok: boolean;
  reason?: string;
}

// ---------- Knowledge 知识分层 ----------

export type KnowledgeLayer = 'raw' | 'topic' | 'rule' | 'manual' | 'qa';

export interface KnowledgeEntry {
  id: string;
  layer: KnowledgeLayer;
  /** 归属主体：素材 id / 配方 domain / 全局 'global' */
  subjectKey: string;
  content: unknown;
  /** 来源：auto-parse | auto-task | auto-review | manual */
  source: string;
  createdAt: string;
}

export const KNOWLEDGE_LAYERS: KnowledgeLayer[] = ['raw', 'topic', 'rule', 'manual', 'qa'];

// ---------- Skill 技能资产 ----------

export interface SkillRecipe {
  /** 矩阵模板（dimensions 快照） */
  dimensions: unknown;
  /** 生成提示词模板 */
  promptTemplate: string;
  /** 路由档位 economy(C1) / standard(C2) / premium(C3) */
  tier: 'economy' | 'standard' | 'premium';
  /** 首帧锚定参数 */
  anchorShotType: string;
}

export interface SkillVersion {
  skillId: string;
  version: string;
  recipe: SkillRecipe;
  provenance: { registeredFromTaskId: string; sampleCount: number; goodRate: number };
  status: 'draft' | 'active' | 'retired';
  createdAt: string;
}

// ---------- MCP 工具契约 ----------

export interface McpToolContract {
  name: string;
  risk: RiskLevel;
  gated: boolean;
  scopes: Array<'Suggest' | 'Read' | 'Edit' | 'Operate'>;
  description: string;
}

/** v0.5 工具面（P2 暴露为 /mcp 端点；此处先立契约） */
export const MCP_TOOLS: McpToolContract[] = [
  { name: 'search_assets', risk: 'low', gated: false, scopes: ['Suggest', 'Read', 'Edit', 'Operate'], description: '检索素材/变体（关键词、类型、状态）' },
  { name: 'get_lineage', risk: 'low', gated: false, scopes: ['Suggest', 'Read', 'Edit', 'Operate'], description: '谱系树：Master + 全部变体 + 审核状态' },
  { name: 'parse_master', risk: 'low', gated: false, scopes: ['Read', 'Edit', 'Operate'], description: 'VLM/结构解析 + 关键帧抽取' },
  { name: 'suggest_matrix', risk: 'low', gated: false, scopes: ['Suggest', 'Read', 'Edit', 'Operate'], description: '智能变量推荐（规则引擎 v1）' },
  { name: 'check_use', risk: 'low', gated: false, scopes: ['Suggest', 'Read', 'Edit', 'Operate'], description: '渠道/地区/授权检查' },
  { name: 'get_analysis', risk: 'low', gated: false, scopes: ['Read', 'Edit', 'Operate'], description: '关键内容分析' },
  { name: 'create_task', risk: 'medium', gated: true, scopes: ['Edit', 'Operate'], description: '创建生成任务' },
  { name: 'review_variant', risk: 'low', gated: false, scopes: ['Edit', 'Operate'], description: '审核 👍/👎（沉淀 rule 层知识）' },
  { name: 'record_usage', risk: 'medium', gated: true, scopes: ['Edit', 'Operate'], description: '发布用途登记' },
  { name: 'write_knowledge', risk: 'medium', gated: true, scopes: ['Edit', 'Operate'], description: 'manual/qa 层知识写入' },
  { name: 'submit_generation', risk: 'high', gated: true, scopes: ['Operate'], description: '真实生成（cost-incurring，必批，展示金额/条数/余量/档位）' },
  { name: 'register_skill', risk: 'high', gated: true, scopes: ['Operate'], description: '把跑通的配方注册为 versioned skill' },
];

export function getToolContract(name: string): McpToolContract | null {
  return MCP_TOOLS.find((t) => t.name === name) ?? null;
}

// ---------- Audit 审计 ----------

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  payloadJson: string;
  costUsd: number | null;
  createdAt: string;
}

// ---------- 模型路由档位（C0–C3，对齐 DAM OpenSquilla 分档语义） ----------

export interface TierConfig {
  tier: 'economy' | 'standard' | 'premium';
  model: string;
  durationSec: number;
  resolution: string;
  generateAudio: boolean;
  usdPerSecond: number;
}

export const TIER_PRESETS: Record<'economy' | 'standard', TierConfig> = {
  economy: { tier: 'economy', model: 'google/veo-3.1-lite', durationSec: 4, resolution: '720p', generateAudio: false, usdPerSecond: 0.03 },
  standard: { tier: 'standard', model: 'alibaba/wan-2.7', durationSec: 5, resolution: '720p', generateAudio: true, usdPerSecond: 0.10 },
};

export function estimateTierCost(tier: 'economy' | 'standard', variantCount: number): number {
  const p = TIER_PRESETS[tier];
  return Number((p.usdPerSecond * p.durationSec * variantCount).toFixed(2));
}

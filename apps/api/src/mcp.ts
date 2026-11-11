/**
 * apps/api/src/mcp.ts —— /mcp 端点：把 12 个 MCP 工具契约（@vbid/shared-schema MCP_TOOLS）暴露为
 * JSON-RPC 2.0 over HTTP（Streamable HTTP 子集：initialize / tools/list / tools/call）。
 *
 * 语义对齐 ai-native-dam：
 *  - 每个 gated:true 工具经过 two-call 审批令牌（elicitation 待客户端支持后优先）；
 *  - 首次调用返回 JSON-RPC error -32042（implementation-defined 区间）+ data.approval_token，
 *    第二次调用带同参数 + approval_token 才执行；令牌与参数指纹绑定，一次性消费；
 *  - 审批记录与 REST 审批门共用 approvals 表，消费语义一致。
 *
 * P2 目标：外部 Agent 直连生产线——检索/解析/推荐/审批/生成/登记全走这一个端点。
 */

import { checkUse, createApprovalRequest, verifyApproval } from '@vbid/governance';
import { MCP_TOOLS, estimateTierCost, type McpToolContract } from '@vbid/shared-schema';
import { createMatrix, estimateCost } from '@vbid/variable-matrix';
import type { DatabaseSync } from 'node:sqlite';

export const MCP_PROTOCOL_VERSION = '2024-11-05';

/** tools/list 输出的 JSON Schema（与 MCP_TOOLS 契约一一对应） */
const TOOL_SCHEMAS: Record<string, { inputSchema: Record<string, unknown> }> = {
  search_assets: {
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词（文件名/meta 模糊匹配）；缺省全量' },
        kind: { type: 'string', enum: ['master', 'variant'] },
        status: { type: 'string', description: 'uploaded/registered/parsed/accepted/rejected' },
        limit: { type: 'integer', default: 50 },
      },
    },
  },
  get_lineage: {
    inputSchema: {
      type: 'object',
      properties: { masterId: { type: 'string' } },
      required: ['masterId'],
    },
  },
  parse_master: {
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string' },
        parser: { type: 'string', description: 'mock | ffmpeg-shotcut | vlm-api；缺省按环境自动' },
      },
      required: ['assetId'],
    },
  },
  suggest_matrix: {
    inputSchema: {
      type: 'object',
      properties: { assetId: { type: 'string' } },
      required: ['assetId'],
    },
  },
  check_use: {
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string' },
        channel: { type: 'string', description: 'x/youtube/instagram/xiaohongshu/wechat_channels/tiktok…' },
        territory: { type: 'string', default: 'Global' },
      },
      required: ['assetId', 'channel'],
    },
  },
  get_analysis: {
    inputSchema: {
      type: 'object',
      properties: { assetId: { type: 'string' } },
      required: ['assetId'],
    },
  },
  create_task: {
    inputSchema: {
      type: 'object',
      properties: {
        masterAssetId: { type: 'string' },
        variantCount: { type: 'integer', minimum: 1, maximum: 500 },
        dimensions: { type: 'array', description: '自定义矩阵 dimensions；缺省包内默认矩阵' },
      },
      required: ['masterAssetId', 'variantCount'],
    },
  },
  review_variant: {
    inputSchema: {
      type: 'object',
      properties: {
        variantId: { type: 'string' },
        outcome: { type: 'string', enum: ['good', 'bad'] },
      },
      required: ['variantId', 'outcome'],
    },
  },
  record_usage: {
    inputSchema: {
      type: 'object',
      properties: {
        assetId: { type: 'string' },
        channel: { type: 'string' },
        territory: { type: 'string', default: 'Global' },
        note: { type: 'string' },
      },
      required: ['assetId', 'channel'],
    },
  },
  write_knowledge: {
    inputSchema: {
      type: 'object',
      properties: {
        subjectKey: { type: 'string', description: '素材 id / 配方 domain / global' },
        layer: { type: 'string', enum: ['manual', 'qa'] },
        content: { type: 'object' },
      },
      required: ['subjectKey', 'layer', 'content'],
    },
  },
  submit_generation: {
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        tier: { type: 'string', enum: ['economy', 'standard'], description: 'economy=C1 veo-3.1-lite 4s 无声 / standard=C2 wan-2.7 5s 有声' },
        seed: { type: 'integer' },
      },
      required: ['taskId'],
    },
  },
  register_skill: {
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        domain: { type: 'string', default: 'general' },
        taskId: { type: 'string', description: '跑通的任务 id（配方来源：矩阵快照 + 产出统计）' },
        promptTemplate: { type: 'string', default: '' },
        tier: { type: 'string', enum: ['economy', 'standard', 'premium'], default: 'standard' },
      },
      required: ['name', 'taskId'],
    },
  },
};

export interface McpDeps {
  db: DatabaseSync;
  newId: (prefix: string) => string;
  getAsset: (id: string) => Record<string, unknown> | null;
  getTask: (id: string) => Record<string, unknown> | null;
  parseMasterById: (assetId: string, opts?: { parser?: string }) => Promise<unknown>;
  analysisFor: (asset: Record<string, unknown>) => { keyContent: unknown; suggestions: unknown } | { error: string };
  executeTaskById: (taskId: string, seed: number, generatorName: string, tier?: 'economy' | 'standard') => Promise<Record<string, unknown>>;
  writeKnowledge: (layer: 'raw' | 'topic' | 'rule' | 'manual' | 'qa', subjectKey: string, content: unknown, source: string) => void;
  checkGenBudget: () => Promise<{ remainingUsd: number | null }>;
  hasGenKey: () => boolean;
}

const rpcOk = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: unknown, code: number, message: string, data?: unknown) => ({
  jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) },
});

const text = (v: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(v, null, 0) }] });

/** 审批拒绝：-32042 落在 JSON-RPC implementation-defined 区间（-32000..-32099） */
const APPROVAL_REQUIRED = -32042;

export function createMcpHandler(deps: McpDeps) {
  const { db } = deps;

  /** gated 工具统一闸门：无 token → 建审批请求返回 -32042；有 token → 校验+消费后执行 */
  function withApproval(
    tool: string,
    resourceKey: string,
    args: Record<string, unknown>,
    approvalData: () => Record<string, unknown>,
    run: () => unknown,
  ) {
    const token = typeof args.approval_token === 'string' ? args.approval_token : null;
    const gateArgs = { ...args };
    delete gateArgs.approval_token;
    if (!token) {
      const req = createApprovalRequest(tool, resourceKey, gateArgs);
      db.prepare(
        `INSERT INTO approvals (id, tool, resource_key, args_json, token, status, expires_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      ).run(deps.newId('apr'), req.tool, req.resourceKey, req.argsJson, req.token, req.expiresAt);
      return rpcError(null, APPROVAL_REQUIRED, `审批-required: ${tool}（high/medium risk 永不自动批）`, {
        approval_token: req.token,
        tool,
        resource_key: resourceKey,
        expires_at: req.expiresAt,
        ...approvalData(),
        hint: '以相同参数加 approval_token 再次调用本工具即可执行；令牌 10 分钟有效、一次性消费。',
      });
    }
    const row = db.prepare(`SELECT * FROM approvals WHERE token = ? AND status = 'pending'`).get(token) as
      | Record<string, unknown> | undefined;
    if (!row) return rpcError(null, -32043, 'approval_token 无效或已被消费');
    const decision = verifyApproval(
      {
        tool: row.tool as string, resourceKey: row.resource_key as string,
        argsJson: row.args_json as string, token: row.token as string, expiresAt: row.expires_at as string,
      },
      token,
      gateArgs,
    );
    if (!decision.ok) return rpcError(null, -32043, `审批校验失败: ${decision.reason ?? 'unknown'}`);
    db.prepare(`UPDATE approvals SET status = 'consumed' WHERE id = ?`).run(row.id as string);
    return run();
  }

  async function handleToolCall(params: { name?: string; arguments?: Record<string, unknown> }) {
    const name = params?.name ?? '';
    const args = params?.arguments ?? {};
    const contract: McpToolContract | undefined = MCP_TOOLS.find((t) => t.name === name);
    if (!contract) return rpcError(null, -32601, `Unknown tool: ${name}`);
    const asset = (id: unknown) => (typeof id === 'string' ? deps.getAsset(id) : null);

    switch (name) {
      case 'search_assets': {
        let sql = 'SELECT * FROM assets WHERE 1=1';
        const paramsSql: string[] = [];
        if (typeof args.query === 'string' && args.query.trim()) {
          sql += ' AND (filename LIKE ? OR meta_json LIKE ?)';
          paramsSql.push(`%${args.query.trim()}%`, `%${args.query.trim()}%`);
        }
        if (args.kind === 'master' || args.kind === 'variant') { sql += ' AND kind = ?'; paramsSql.push(args.kind); }
        if (typeof args.status === 'string') { sql += ' AND status = ?'; paramsSql.push(args.status); }
        sql += ' ORDER BY created_at DESC LIMIT ?';
        paramsSql.push(String(Math.min(Number(args.limit) || 50, 200)));
        const assets = db.prepare(sql).all(...paramsSql);
        return text({ assets, total: assets.length });
      }

      case 'get_lineage': {
        const master = asset(args.masterId);
        if (!master || master.kind !== 'master') return rpcError(null, -32602, 'master not found');
        const variants = deps.db.prepare(
          'SELECT id, filename, task_id, status, review, meta_json, created_at FROM assets WHERE parent_id = ? ORDER BY created_at',
        ).all(master.id as string);
        return text({
          master: { id: master.id, filename: master.filename, status: master.status },
          variants,
        });
      }

      case 'parse_master': {
        const target = asset(args.assetId);
        if (!target || target.kind !== 'master') return rpcError(null, -32602, 'master not found');
        if (target.status === 'parsed' && !args.parser) return text({ alreadyParsed: true, assetId: target.id });
        const r = await deps.parseMasterById(target.id as string, { parser: typeof args.parser === 'string' ? args.parser : undefined });
        return text({ parsed: r });
      }

      case 'suggest_matrix': {
        const target = asset(args.assetId);
        if (!target) return rpcError(null, -32602, 'master not found');
        const a = deps.analysisFor(target);
        if ('error' in a) return rpcError(null, -32602, a.error);
        return text(a.suggestions);
      }

      case 'check_use': {
        const target = asset(args.assetId);
        if (!target) return rpcError(null, -32602, 'asset_not_found');
        const row = deps.db.prepare('SELECT * FROM rights WHERE asset_id = ?').get(target.id as string) as
          | Record<string, unknown> | undefined;
        const record = row ? {
          assetId: target.id as string,
          license: row.license as string,
          status: row.status as 'Cleared' | 'Restricted' | 'Expired',
          channels: JSON.parse(row.channels as string),
          territories: JSON.parse(row.territories as string),
          embargoUntil: (row.embargo_until as string | null) ?? null,
          expiresAt: (row.expires_at as string | null) ?? null,
        } : null;
        const out = checkUse(record, {
          channel: String(args.channel ?? ''),
          territory: typeof args.territory === 'string' ? args.territory : undefined,
        });
        return text(out);
      }

      case 'get_analysis': {
        const target = asset(args.assetId);
        if (!target) return rpcError(null, -32602, 'master not found');
        const a = deps.analysisFor(target);
        if ('error' in a) return rpcError(null, -32602, a.error);
        return text(a.keyContent);
      }

      case 'create_task': {
        const master = asset(args.masterAssetId);
        if (!master || master.kind !== 'master') return rpcError(null, -32602, 'valid masterAssetId is required');
        const variantCount = Number(args.variantCount);
        if (!Number.isInteger(variantCount) || variantCount <= 0 || variantCount > 500) {
          return rpcError(null, -32602, 'variantCount must be an integer in 1..500');
        }
        return withApproval(
          'create_task', `master:${master.id}:task`, args,
          () => ({ masterAssetId: master.id, variantCount }),
          () => {
            // 矩阵：自定义 dimensions 需过包内校验；缺省用默认矩阵
            const matrix = Array.isArray(args.dimensions) ? createMatrix(args.dimensions) : createMatrix();
            const cost = estimateCost(variantCount, 0.15);
            const taskId = deps.newId('tsk');
            db.prepare(
              `INSERT INTO tasks (id, master_asset_id, matrix_json, variant_count, rate_per_variant_usd, estimated_cost_usd, status)
               VALUES (?, ?, ?, ?, ?, ?, 'queued')`,
            ).run(taskId, master.id as string, JSON.stringify(matrix), variantCount, cost.ratePerVariantUsd, cost.estimatedCostUsd);
            return text({ taskId, masterAssetId: master.id, variantCount, estimatedCostUsd: cost.estimatedCostUsd, status: 'queued' });
          },
        );
      }

      case 'review_variant': {
        const v = asset(args.variantId);
        if (!v || v.kind !== 'variant') return rpcError(null, -32602, 'variant not found');
        if (args.outcome !== 'good' && args.outcome !== 'bad') return rpcError(null, -32602, "outcome must be 'good' or 'bad'");
        db.prepare('UPDATE assets SET review = ? WHERE id = ?').run(args.outcome === 'good' ? 1 : 0, v.id);
        // 与 REST 审核同语义：沉淀 rule 层知识（喂给 Skill 注册的门槛统计）
        let meta: Record<string, unknown> = {};
        try { meta = JSON.parse(v.meta_json as string) as Record<string, unknown>; } catch { /* 容忍坏 json */ }
        deps.writeKnowledge('rule', (v.parent_id as string) ?? 'global', {
          type: 'variant_reviewed', variantId: v.id, outcome: args.outcome,
          spec: meta.spec ?? null, descriptor: meta.descriptor ?? null,
        }, 'auto-review');
        return text({ variantId: v.id, outcome: args.outcome, reviewed: true });
      }

      case 'record_usage': {
        const target = asset(args.assetId);
        if (!target) return rpcError(null, -32602, 'asset not found');
        return withApproval(
          'record_usage', `asset:${target.id}:usage`, args,
          () => ({ assetId: target.id, channel: args.channel }),
          () => {
            const id = deps.newId('aud');
            db.prepare(`INSERT INTO audit_log (id, actor, action, payload_json) VALUES (?, 'mcp', 'record_usage', ?)`)
              .run(id, JSON.stringify({ assetId: target.id, channel: args.channel, territory: args.territory ?? 'Global', note: args.note ?? null }));
            return text({ recorded: true, auditId: id });
          },
        );
      }

      case 'write_knowledge': {
        return withApproval(
          'write_knowledge', `knowledge:${args.subjectKey}:${args.layer}`, args,
          () => ({ subjectKey: args.subjectKey, layer: args.layer }),
          () => {
            const id = deps.newId('knl');
            db.prepare(`INSERT INTO knowledge_entries (id, layer, subject_key, content_json, source) VALUES (?, ?, ?, ?, 'mcp')`)
              .run(id, String(args.layer), String(args.subjectKey), JSON.stringify(args.content ?? {}));
            return text({ written: true, id, layer: args.layer, subjectKey: args.subjectKey });
          },
        );
      }

      case 'submit_generation': {
        if (!deps.hasGenKey()) {
          return rpcError(null, -32603, 'openrouter generator 需要 API key：设置 VBID_GEN_API_KEY');
        }
        const task = typeof args.taskId === 'string' ? deps.getTask(args.taskId) : null;
        if (!task) return rpcError(null, -32602, 'task not found');
        if (task.status === 'done') return rpcError(null, -32602, 'task already run');
        const tier: 'economy' | 'standard' = args.tier === 'economy' ? 'economy' : 'standard';
        const seed = Number.isFinite(Number(args.seed)) ? Number(args.seed) : 42;
        const budget = await deps.checkGenBudget();
        if (budget.remainingUsd !== null && budget.remainingUsd <= 0) {
          return rpcError(null, -32603, 'OpenRouter key 月度限额已用完');
        }
        return withApproval(
          'submit_generation', `task:${task.id}:submit`, { ...args, tier, seed },
          () => ({
            taskId: task.id, tier, tierCostUsd: estimateTierCost(tier, Number(task.variant_count)),
            estimated_cost_usd: estimateTierCost(tier, Number(task.variant_count)),
            key_remaining_usd: budget.remainingUsd, variant_count: Number(task.variant_count),
          }),
          async () => {
            const { summary } = await deps.executeTaskById(task.id as string, seed, 'openrouter', tier);
            return text({ executed: true, taskId: task.id, summary });
          },
        );
      }

      case 'register_skill': {
        const task = typeof args.taskId === 'string' ? deps.getTask(args.taskId) : null;
        if (!task) return rpcError(null, -32602, 'task not found（配方来源必须是已跑通的任务）');
        return withApproval(
          'register_skill', `skill:${args.name}`, args,
          () => ({ name: args.name, taskId: task.id }),
          () => {
            const stats = db.prepare(
              `SELECT COUNT(*) AS total, SUM(CASE WHEN review = 1 THEN 1 ELSE 0 END) AS good FROM assets WHERE task_id = ?`,
            ).get(task.id as string) as { total: number; good: number | null };
            const skillId = deps.newId('skl');
            db.prepare(`INSERT INTO skills (id, name, domain, description) VALUES (?, ?, ?, ?)`)
              .run(skillId, String(args.name), String(args.domain ?? 'general'), `registered from task ${task.id}`);
            db.prepare(
              `INSERT INTO skill_versions (skill_id, version, recipe_json, provenance_json, status)
               VALUES (?, 'v1', ?, ?, 'active')`,
            ).run(
              skillId,
              JSON.stringify({
                dimensions: JSON.parse(task.matrix_json as string).dimensions,
                promptTemplate: args.promptTemplate ?? '',
                tier: args.tier ?? 'standard',
                anchorShotType: 'hook',
              }),
              JSON.stringify({ registeredFromTaskId: task.id, sampleCount: stats.total, goodRate: stats.total ? Number(((stats.good ?? 0) / stats.total).toFixed(2)) : 0 }),
            );
            return text({ registered: true, skillId, version: 'v1', sampleCount: stats.total });
          },
        );
      }

      default:
        return rpcError(null, -32601, `tool not implemented: ${name}`);
    }
  }

  /** 处理一条 JSON-RPC 报文，返回响应对象（POST /mcp 共用） */
  return async function handleMcp(payload: unknown): Promise<{ status: number; body: unknown; headers?: Record<string, string> }> {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return { status: 400, body: rpcError(null, -32700, 'Parse error') };
    }
    const { id, method, params } = payload as { id?: unknown; method?: string; params?: never };
    try {
      if (method === 'initialize') {
        const p = (params ?? {}) as { protocolVersion?: string };
        return {
          status: 200,
          headers: { 'mcp-session-id': deps.newId('mcp') },
          body: rpcOk(id, {
            protocolVersion: p.protocolVersion ?? MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'vbid-mcp', version: '0.5.0' },
          }),
        };
      }
      if (method === 'ping') return { status: 200, body: rpcOk(id, {}) };
      if (method === 'tools/list') {
        return {
          status: 200,
          body: rpcOk(id, {
            tools: MCP_TOOLS.map((t) => ({
              name: t.name,
              description: `${t.description}（risk=${t.risk}${t.gated ? '，gated：two-call 审批令牌' : ''}）`,
              ...(TOOL_SCHEMAS[t.name] ?? {}),
            })),
          }),
        };
      }
      if (method === 'tools/call') {
        const result = await handleToolCall((params ?? {}) as { name?: string; arguments?: Record<string, unknown> });
        // tools/call 的业务错误（如审批拒绝）仍是合法 JSON-RPC 响应：error 对象 + 原 id
        if ((result as { error?: unknown }).error !== undefined) {
          return { status: 200, body: { ...(result as Record<string, unknown>), id } };
        }
        return { status: 200, body: rpcOk(id, result) };
      }
      return { status: 200, body: rpcError(id, -32601, `Unknown method: ${method}`) };
    } catch (e) {
      return { status: 200, body: rpcError(id, -32603, (e as Error).message || 'Internal error') };
    }
  };
}

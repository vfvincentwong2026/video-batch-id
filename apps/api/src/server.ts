/**
 * apps/api —— 零依赖 HTTP 网关（node:http）。
 *
 * v0.1 路由：
 *   GET  /healthz                 健康检查
 *   POST /api/assets              登记资产（Master 上传 / 变体入库）
 *   GET  /api/assets              资产列表（?kind=master|variant&parent_id=）
 *   GET  /api/assets/:id          资产详情
 *   POST /api/assets/:id/parse    运行参考解析（provider 可指定，默认 mock）
 *   POST /api/tasks               创建生成任务（masterAssetId + 矩阵 + 变体数 → 预估成本）
 *   GET  /api/tasks               任务列表
 *   GET  /api/tasks/:id           任务详情（含变体进度）
 *   POST /api/tasks/:id/run       执行工作流 A（mock 直通；openrouter 走 two-call 审批门：首调 428 拿 token，确认后二调执行）
 *   POST /api/demo/run            Tunnel 演示入口：一键跑通端到端（选 Master→解析→建任务→执行）
 *   GET  /api/assets/:id/analysis 关键内容分析 + 智能变量推荐（规则引擎 v1）
 *   POST /api/preview             Demo 效果预览：矩阵每个选项的预期效果 + 关键帧 + 样例组合
 *   POST /api/variants/:id/review 审核标记 { outcome: 'good' | 'bad' }
 *   GET  /api/lineage/:masterId   谱系树（Master + 全部变体 + 审核状态）
 *   POST /mcp                     MCP 端点（12 个工具契约 JSON-RPC；gated 工具 two-call 审批令牌）
 *   GET  /, /app.js, /style.css   静态工作台（apps/web，零构建）
 *
 * 设计约束：状态推进由 pipeline 包驱动，本服务做 REST + 状态读写，保持可替换为 D1。
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, newId, type DatabaseSync } from './db.ts';
import { createMatrix, estimateCost, enabledDimensions, suggestDimensions, buildPreview } from '@vbid/variable-matrix';
import { getParser } from '@vbid/reference-parser';
import { runWorkflowA, getGenerator, type VariantGeneratorProvider } from '@vbid/pipeline';
import { OpenRouterVideoProvider, checkOpenRouterKeyBudget } from '@vbid/gen-provider';
import { createApprovalRequest, verifyApproval } from '@vbid/governance';
import { TIER_PRESETS, estimateTierCost } from '@vbid/shared-schema';
import { createMcpHandler } from './mcp.ts';

/** 派生资产（关键帧等）根目录：仓库 assets/derived（git 忽略） */
const DERIVED_ROOT = fileURLToPath(new URL('../../../assets/derived/', import.meta.url));

/** 生成层默认 provider：配置 VBID_GEN_API_KEY（或复用 VBID_VLM_API_KEY 的 OpenRouter）→ openrouter；否则 mock */
function defaultGeneratorName(): 'openrouter' | 'mock' {
  return (process.env.VBID_GEN_API_KEY ?? process.env.VBID_VLM_API_KEY) ? 'openrouter' : 'mock';
}

/**
 * 解析生成 provider 实例：openrouter 每次按 Master 构造（产出落位 DERIVED_ROOT/<masterId>/variants）。
 * tier（P1 双档路由）：economy=C1 google/veo-3.1-lite 4s 无声；standard=C2 alibaba/wan-2.7 5s 有声。
 */
function resolveGenerator(name: string, masterId: string, tier?: 'economy' | 'standard'): VariantGeneratorProvider {
  if (name === 'openrouter') {
    const preset = tier ? TIER_PRESETS[tier] : null;
    return new OpenRouterVideoProvider({
      outDir: join(DERIVED_ROOT, masterId, 'variants'),
      fileRefPrefix: `/derived/${masterId}/variants`,
      ...(preset
        ? { model: preset.model, durationSec: preset.durationSec, generateAudio: preset.generateAudio }
        : {}),
    });
  }
  return getGenerator(name);
}

interface Ctx {
  db: DatabaseSync;
  body: unknown;
  params: Record<string, string>;
}

type Handler = (ctx: Ctx, req: IncomingMessage, res: ServerResponse) => unknown;

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

export function createApp(dbPath = process.env.VBID_DB_PATH ?? './vbid.sqlite') {
  const db = openDb(dbPath);

  const routes: Array<{ method: string; pattern: RegExp; keys: string[]; handler: Handler }> = [];
  const route = (method: string, path: string, handler: Handler): void => {
    const keys: string[] = [];
    const pattern = new RegExp(
      '^' + path.replace(/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$',
    );
    routes.push({ method, pattern, keys, handler });
  };

  // ---- 健康检查 ----
  route('GET', '/healthz', () => ({
    ok: true,
    profile: process.env.VBID_PROFILE ?? 'local',
    gen: defaultGeneratorName(),
    genModel: defaultGeneratorName() === 'openrouter'
      ? (process.env.VBID_GEN_MODEL ?? 'alibaba/wan-2.7') : null,
  }));

  // ---- 资产 ----
  route('POST', '/api/assets', (ctx) => {
    const b = ctx.body as Record<string, unknown>;
    const kind = b.kind === 'variant' ? 'variant' : 'master';
    if (typeof b.filename !== 'string' || !b.filename) {
      return { __status: 400, error: 'filename is required' };
    }
    if (kind === 'variant' && typeof b.parent_id !== 'string') {
      return { __status: 400, error: 'variant requires parent_id (master asset id)' };
    }
    const id = newId(kind === 'master' ? 'mas' : 'var');
    db.prepare(
      `INSERT INTO assets (id, kind, filename, duration_ms, parent_id, task_id, status, meta_json, file_path)
       VALUES (?, ?, ?, ?, ?, ?, 'uploaded', ?, ?)`,
    ).run(
      id, kind, b.filename,
      typeof b.duration_ms === 'number' ? b.duration_ms : null,
      typeof b.parent_id === 'string' ? b.parent_id : null,
      typeof b.task_id === 'string' ? b.task_id : null,
      JSON.stringify(b.meta ?? {}),
      typeof b.file_path === 'string' ? b.file_path : null,
    );
    return { __status: 201, asset: getAsset(id) };
  });

  // ---- 批量登记素材目录（v0.2：真实素材入库）----
  route('POST', '/api/assets/scan-dir', async (ctx) => {
    const b = ctx.body as Record<string, unknown>;
    if (typeof b.dir !== 'string' || !b.dir) return { __status: 400, error: 'dir is required' };
    const media = await import('@vbid/media-probe');
    if (!media.hasFfmpegTools()) return { __status: 500, error: 'ffmpeg/ffprobe not found' };
    let entries: string[];
    try {
      entries = (await readdir(b.dir)).filter((f) => /\.(mp4|mov|webm)$/i.test(f));
    } catch {
      return { __status: 400, error: `cannot read dir: ${b.dir}` };
    }
    const registered: unknown[] = [];
    const skipped: string[] = [];
    for (const filename of entries) {
      const exists = db.prepare(`SELECT id FROM assets WHERE kind = 'master' AND filename = ?`).get(filename);
      if (exists) { skipped.push(filename); continue; }
      try {
        const filePath = join(b.dir, filename);
        const probe = await media.probe(filePath);
        const id = newId('mas');
        db.prepare(
          `INSERT INTO assets (id, kind, filename, duration_ms, status, meta_json, file_path)
           VALUES (?, 'master', ?, ?, 'registered', ?, ?)`,
        ).run(id, filename, probe.durationMs, JSON.stringify({ probe }), filePath);
        registered.push(getAsset(id));
      } catch (e) {
        skipped.push(`${filename} (${(e as Error).message})`);
      }
    }
    return { __status: 201, registered, skipped, count: registered.length };
  });

  route('GET', '/api/assets', (ctx, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const kind = url.searchParams.get('kind');
    const parentId = url.searchParams.get('parent_id');
    let sql = 'SELECT * FROM assets WHERE 1=1';
    const args: string[] = [];
    if (kind === 'master' || kind === 'variant') { sql += ' AND kind = ?'; args.push(kind); }
    if (parentId) { sql += ' AND parent_id = ?'; args.push(parentId); }
    sql += ' ORDER BY created_at DESC';
    return { assets: db.prepare(sql).all(...args) };
  });

  route('GET', '/api/assets/:id', (ctx) => {
    const asset = getAsset(ctx.params.id);
    return asset ? { asset } : { __status: 404, error: 'asset not found' };
  });

  // ---- 任务 ----
  route('POST', '/api/tasks', (ctx) => {
    const b = ctx.body as Record<string, unknown>;
    const master = typeof b.master_asset_id === 'string' ? getAsset(b.master_asset_id) : null;
    if (!master || master.kind !== 'master') {
      return { __status: 400, error: 'valid master_asset_id is required' };
    }
    const variantCount = Number(b.variant_count);
    if (!Number.isInteger(variantCount) || variantCount <= 0 || variantCount > 500) {
      return { __status: 400, error: 'variant_count must be an integer in 1..500' };
    }
    // 矩阵：客户端可传自定义 dimensions；缺省用包内默认矩阵
    let matrix;
    try {
      matrix = Array.isArray(b.matrix?.dimensions)
        ? createMatrix(b.matrix.dimensions)
        : createMatrix();
    } catch (e) {
      return { __status: 400, error: `invalid matrix: ${(e as Error).message}` };
    }
    if (enabledDimensions(matrix).length === 0) {
      return { __status: 400, error: 'matrix has no enabled dimensions' };
    }
    const cost = estimateCost(variantCount, Number(b.rate_per_variant_usd ?? 0.15));
    const id = newId('tsk');
    db.prepare(
      `INSERT INTO tasks (id, master_asset_id, matrix_json, variant_count, rate_per_variant_usd, estimated_cost_usd)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, master.id, JSON.stringify(matrix), variantCount, cost.ratePerVariantUsd, cost.estimatedCostUsd);
    return { __status: 201, task: getTask(id) };
  });

  route('GET', '/api/tasks', () => {
    return { tasks: db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() };
  });

  route('GET', '/api/tasks/:id', (ctx) => {
    const task = getTask(ctx.params.id);
    if (!task) return { __status: 404, error: 'task not found' };
    const variants = db.prepare('SELECT * FROM assets WHERE task_id = ? ORDER BY created_at').all(task.id);
    return { task, variants };
  });

  // ---- 参考解析（工作流 A 第②步）----
  route('POST', '/api/assets/:id/parse', async (ctx) => {
    const asset = getAsset(ctx.params.id);
    if (!asset || asset.kind !== 'master') return { __status: 404, error: 'master asset not found' };
    const b = ctx.body as Record<string, unknown>;
    const durationMs = Number(asset.duration_ms ?? b.duration_ms ?? 0);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return { __status: 400, error: 'asset has no duration_ms; pass it in body' };
    }
    const filePath = (asset.file_path as string | null) ?? (typeof b.file_path === 'string' ? b.file_path : undefined);
    const { parsed, thumbs } = await parseMaster(asset, {
      parser: typeof b.parser === 'string' ? b.parser : undefined,
      filePath,
      durationMs,
    });
    return { parsed, thumbs };
  });

  // ---- 任务执行（工作流 A 第⑤–⑦步；生成层 mock / openrouter 可配，默认按环境）----
  route('POST', '/api/tasks/:id/run', async (ctx) => {
    const task = getTask(ctx.params.id);
    if (!task) return { __status: 404, error: 'task not found' };
    if (task.status === 'done') return { __status: 409, error: 'task already run' };
    const b = ctx.body as Record<string, unknown>;
    const seed = Number.isFinite(Number(b.seed)) ? Number(b.seed) : 42;
    const generatorName = b.generator === undefined ? defaultGeneratorName() : String(b.generator);
    if (generatorName !== 'mock' && generatorName !== 'openrouter') {
      return { __status: 400, error: "generator must be 'mock' or 'openrouter'" };
    }
    // ---- 真实生成 two-call 审批门（P1，对齐 DAM approval-gates：high risk 永不自动批）----
    // 第一调（无 approval_token）：预检 key + 预算 → 创建审批请求 → 428 返回 token + 预估金额 + 余量 + 档位
    // 第二调（带 approval_token + 同参数）：verifyApproval → consumed → 执行。mock 链路（low risk）不拦截。
    if (generatorName === 'openrouter') {
      const hasKey = Boolean(process.env.VBID_GEN_API_KEY ?? process.env.VBID_VLM_API_KEY);
      if (!hasKey) {
        return {
          __status: 500,
          error: 'openrouter generator 需要 API key：请在启动环境设置 VBID_GEN_API_KEY（OpenRouter），或改用 generator:"mock" 演示链路。',
        };
      }
      const budget = await checkOpenRouterKeyBudget();
      if (budget && budget.remainingUsd <= 0) {
        const reset = budget.resetsAt ? budget.resetsAt.slice(0, 10) : '次月';
        return {
          __status: 402,
          error: `OpenRouter key 月度限额已用完（已用 $${budget.spendUsd.toFixed(2)} / 上限 $${budget.limitUsd.toFixed(2)}，${reset} 重置）。`
            + `请到 OpenRouter 控制台（Keys 页）调高该 key 的 Monthly Limit，或改用 mock 演示链路。`,
        };
      }
      const tier: 'economy' | 'standard' = b.tier === 'economy' ? 'economy' : 'standard';
      const gateArgs = { taskId: task.id, seed, generator: generatorName, tier };
      const token = typeof b.approval_token === 'string' ? b.approval_token : null;
      if (!token) {
        const req = createApprovalRequest('submit_generation', `task:${task.id}:run`, gateArgs);
        db.prepare(
          `INSERT INTO approvals (id, tool, resource_key, args_json, token, status, expires_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        ).run(newId('apr'), req.tool, req.resourceKey, req.argsJson, req.token, req.expiresAt);
        return {
          __status: 428,
          approval_required: true,
          approval_token: req.token,
          tool: 'submit_generation',
          expires_at: req.expiresAt,
          tier,
          tier_preset: TIER_PRESETS[tier],
          estimated_cost_usd: estimateTierCost(tier, Number(task.variant_count)),
          key_remaining_usd: budget?.remainingUsd ?? null,
          variant_count: Number(task.variant_count),
        };
      }
      const row = db.prepare(
        `SELECT * FROM approvals WHERE token = ? AND status = 'pending'`,
      ).get(token) as Record<string, unknown> | undefined;
      if (!row) return { __status: 403, error: 'approval_token 无效或已被消费' };
      const decision = verifyApproval(
        {
          tool: row.tool as string,
          resourceKey: row.resource_key as string,
          argsJson: row.args_json as string,
          token: row.token as string,
          expiresAt: row.expires_at as string,
        },
        token,
        gateArgs,
      );
      if (!decision.ok) {
        return { __status: 403, error: `审批校验失败: ${decision.reason ?? 'unknown'}` };
      }
      db.prepare(`UPDATE approvals SET status = 'consumed' WHERE id = ?`).run(row.id as string);
    }
    const tierForRun = generatorName === 'openrouter'
      ? ((ctx.body as Record<string, unknown>).tier === 'economy' ? 'economy' : 'standard')
      : undefined;
    const { summary, task: doneTask } = await executeTask(task.id as string, seed, generatorName, tierForRun);
    return { summary, task: doneTask };
  });

  // ---- 关键内容分析 + 智能变量推荐（工作流 A 第②步增强）----
  route('GET', '/api/assets/:id/analysis', (ctx) => {
    const asset = getAsset(ctx.params.id);
    if (!asset || asset.kind !== 'master') return { __status: 404, error: 'master asset not found' };
    const a = analysisFor(asset);
    if ('error' in a) return { __status: 409, error: a.error };
    return {
      parsedWith: (JSON.parse(asset.meta_json as string) as { parse?: { parser?: string } }).parse?.parser,
      keyContent: a.keyContent,
      suggestions: a.suggestions,
    };
  });

  // ---- Demo 效果预览（工作流 A 第④步：矩阵确定后、建任务前）----
  route('POST', '/api/preview', (ctx) => {
    const b = ctx.body as Record<string, unknown>;
    const master = typeof b.master_asset_id === 'string' ? getAsset(b.master_asset_id) : null;
    if (!master || master.kind !== 'master') {
      return { __status: 400, error: 'valid master_asset_id is required' };
    }
    const meta = JSON.parse(master.meta_json as string) as { parse?: Record<string, unknown> };
    if (!meta.parse) return { __status: 409, error: 'master not parsed yet' };
    let matrix;
    try {
      matrix = Array.isArray(b.dimensions)
        ? createMatrix(b.dimensions as Parameters<typeof createMatrix>[0])
        : createMatrix();
    } catch (e) {
      return { __status: 400, error: `invalid dimensions: ${(e as Error).message}` };
    }
    const parsed = meta.parse as Parameters<typeof buildPreview>[1] & { shots: Array<{ description?: string }> };
    const preview = buildPreview(matrix, parsed, { thumbs: extractThumbs(parsed.shots) });
    return { preview, master: { id: master.id, filename: master.filename } };
  });

  // ---- Tunnel 演示入口：一键跑通端到端（①②③⑤→谱系，演示/试用场景）----
  route('POST', '/api/demo/run', async (ctx) => {
    const b = ctx.body as Record<string, unknown>;
    // 1) 选演示 Master：可指定；缺省选「有真实文件、尚无已完成任务」的第一条，保证每次演示都有新鲜谱系
    let master: Record<string, unknown> | null = null;
    if (typeof b.master_id === 'string') {
      master = getAsset(b.master_id);
      if (!master || master.kind !== 'master') return { __status: 404, error: 'master not found' };
    } else {
      const candidates = db.prepare(
        `SELECT * FROM assets WHERE kind = 'master' AND file_path IS NOT NULL ORDER BY created_at`,
      ).all() as Array<Record<string, unknown>>;
      master = candidates.find((m) => !db.prepare(
        `SELECT id FROM tasks WHERE master_asset_id = ? AND status = 'done'`,
      ).get(m.id as string)) ?? candidates[0] ?? null;
    }
    if (!master) {
      return { __status: 400, error: 'no master asset with real file; 请先到 ① 上传解析 扫描素材目录' };
    }

    // 2) 确保已解析（真实文件 → ffmpeg-shotcut + 关键帧；无文件 → mock）
    let freshlyParsed = false;
    if (master.status !== 'parsed') {
      await parseMaster(master, {
        parser: master.file_path ? (process.env.VBID_VLM_API_KEY ? 'vlm-api' : 'ffmpeg-shotcut') : 'mock',
        durationMs: Number(master.duration_ms ?? 0),
      });
      freshlyParsed = true;
      master = getAsset(master.id as string);
    }

    // 3) 建任务：默认矩阵 · 16 条（演示节奏，mock 链路秒级完成）
    const variantCount = Number.isInteger(Number(b.variant_count)) ? Number(b.variant_count) : 16;
    const matrix = createMatrix();
    const cost = estimateCost(variantCount, 0.15);
    const taskId = newId('tsk');
    db.prepare(
      `INSERT INTO tasks (id, master_asset_id, matrix_json, variant_count, rate_per_variant_usd, estimated_cost_usd)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(taskId, master.id as string, JSON.stringify(matrix), variantCount, cost.ratePerVariantUsd, cost.estimatedCostUsd);

    // 4) 执行并汇总（演示默认 mock 链路：秒级、零费用；传 generator:'openrouter' 可切真实生成）
    const demoGenerator = b.generator === 'openrouter' ? 'openrouter' : 'mock';
    const { summary } = await executeTask(taskId, 42, demoGenerator);
    return {
      __status: 201,
      demo: true,
      freshlyParsed,
      master: { id: master.id, filename: master.filename },
      task: getTask(taskId),
      summary,
    };
  });

  // ---- 谱系（工作流 A 第⑧步视图数据）----
  route('GET', '/api/lineage/:masterId', (ctx) => {
    const master = getAsset(ctx.params.masterId);
    if (!master || master.kind !== 'master') return { __status: 404, error: 'master not found' };
    const variants = db.prepare(
      'SELECT id, filename, task_id, status, review, meta_json, created_at FROM assets WHERE parent_id = ? ORDER BY created_at',
    ).all(master.id as string);
    return {
      master,
      variants: variants.map((v) => {
        const row = v as Record<string, unknown>;
        let meta: Record<string, unknown> = {};
        try { meta = JSON.parse(row.meta_json as string) as Record<string, unknown>; } catch { /* 容忍坏 json */ }
        return { ...row, meta };
      }),
    };
  });

  // ---- 素材库检索（v0.1 用 LIKE；FTS5 索引后置，接口不变）----
  route('GET', '/api/library', (ctx, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const q = url.searchParams.get('q')?.trim();
    const kind = url.searchParams.get('kind');
    const status = url.searchParams.get('status');
    let sql = 'SELECT * FROM assets WHERE 1=1';
    const args: string[] = [];
    if (kind === 'master' || kind === 'variant') { sql += ' AND kind = ?'; args.push(kind); }
    if (status) { sql += ' AND status = ?'; args.push(status); }
    if (q) { sql += ' AND (filename LIKE ? OR meta_json LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
    sql += ' ORDER BY created_at DESC LIMIT 200';
    return { assets: db.prepare(sql).all(...args) };
  });

  // ---- Master 价值榜（知识层 v0.1-lite：哪个 Master 最值钱）----
  route('GET', '/api/masters/value', () => {
    const masters = db.prepare(`SELECT * FROM assets WHERE kind = 'master' ORDER BY created_at DESC`).all();
    const ranked = (masters as Array<Record<string, unknown>>).map((m) => {
      const stats = db.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
                SUM(CASE WHEN review = 1 THEN 1 ELSE 0 END) AS good,
                SUM(CASE WHEN review = 0 THEN 1 ELSE 0 END) AS bad
         FROM assets WHERE parent_id = ?`,
      ).get(m.id as string) as Record<string, number>;
      const total = stats.total ?? 0;
      const good = stats.good ?? 0;
      const accepted = stats.accepted ?? 0;
      // v0.1 价值分：产出×0.3 + 好评×0.5 + 通过率×0.2（0..1 归一前的原始加权，排序用）
      const valueScore = Number((total * 0.3 + good * 0.5 + (total ? (accepted / total) * 10 : 0) * 0.2).toFixed(2));
      return {
        master: m,
        variantCount: total,
        acceptedCount: accepted,
        goodCount: good,
        badCount: stats.bad ?? 0,
        passRate: total ? Number((accepted / total).toFixed(2)) : null,
        valueScore,
      };
    });
    ranked.sort((a, b) => b.valueScore - a.valueScore);
    return { masters: ranked };
  });

  // ---- 审核 ----
  route('POST', '/api/variants/:id/review', (ctx) => {
    const b = ctx.body as Record<string, unknown>;
    if (b.outcome !== 'good' && b.outcome !== 'bad') {
      return { __status: 400, error: "outcome must be 'good' or 'bad'" };
    }
    const row = getAsset(ctx.params.id);
    if (!row || row.kind !== 'variant') return { __status: 404, error: 'variant not found' };
    db.prepare(`UPDATE assets SET review = ? WHERE id = ?`).run(b.outcome === 'good' ? 1 : 0, row.id);
    // P1 知识自动沉淀：审核 → rule 层（👍/👎 的结论与变体上下文，喂给后续 Skill 注册的门槛统计）
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(row.meta_json as string) as Record<string, unknown>; } catch { /* 容忍坏 json */ }
    writeKnowledge('rule', row.parent_id as string ?? 'global', {
      type: 'variant_reviewed',
      variantId: row.id,
      outcome: b.outcome,
      spec: meta.spec ?? null,
      descriptor: meta.descriptor ?? null,
    }, 'auto-review');
    writeAudit('review_variant', { variantId: row.id, outcome: b.outcome });
    return { variant: getAsset(row.id) };
  });

  // ---- helpers ----
  function getAsset(id: string): Record<string, unknown> | null {
    const row = db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ?? null;
  }
  function getTask(id: string): Record<string, unknown> | null {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ?? null;
  }

  /** 从镜头描述里抽取 [thumb=...] 关键帧引用 */
  function extractThumbs(shots: Array<{ index: number; startMs?: number; endMs?: number; type?: string; description?: string }>) {
    return shots.map((s) => {
      const m = String(s.description ?? '').match(/\[thumb=([^\]]+)\]/);
      return m ? { index: s.index, startMs: s.startMs ?? 0, endMs: s.endMs ?? 0, type: s.type, thumb: m[1] } : null;
    }).filter((t): t is NonNullable<typeof t> => t !== null);
  }

  /** 关键内容分析：结构（镜头+Hook 位）、节奏、音频、最长/最短镜头热点 */
  function buildKeyContent(
    parsed: {
      shots: Array<{ index: number; startMs: number; endMs: number; type: string; description?: string }>;
      hooks: Array<{ phrase: string; kind: string }>;
      bgm: { style: string; bpm: number | null };
      rhythm: { shotCount: number; avgShotSec: number };
      transcript: string;
    },
    thumbs: ReturnType<typeof extractThumbs>,
  ) {
    const thumbOf = new Map(thumbs.map((t) => [t.index, t.thumb]));
    const sorted = [...parsed.shots].sort((a, b) => (b.endMs - b.startMs) - (a.endMs - a.startMs));
    return {
      structure: parsed.shots.map((s) => ({
        index: s.index, type: s.type, startMs: s.startMs, endMs: s.endMs,
        thumb: thumbOf.get(s.index),
      })),
      hooks: parsed.hooks,
      rhythm: parsed.rhythm,
      bgm: parsed.bgm,
      transcript: parsed.transcript || null,
      hotspots: {
        longest: sorted[0] ? { shot: sorted[0].index, sec: Number(((sorted[0].endMs - sorted[0].startMs) / 1000).toFixed(1)) } : null,
        shortest: sorted.length > 1 ? { shot: sorted[sorted.length - 1].index, sec: Number(((sorted[sorted.length - 1].endMs - sorted[sorted.length - 1].startMs) / 1000).toFixed(1)) } : null,
      },
    };
  }

  /** 解析 Master：真实文件走 ffmpeg-shotcut 并抽关键帧（每镜头 1 帧，上限 8）；否则按指定/mock provider */
  async function parseMaster(
    asset: Record<string, unknown>,
    opts: { parser?: string; filePath?: string; durationMs: number },
  ): Promise<{ parsed: Awaited<ReturnType<ReturnType<typeof getParser>['parse']>>; thumbs: number }> {
    const filePath = opts.filePath ?? (asset.file_path as string | null) ?? undefined;
    // 有真实文件：配置了 VBID_VLM_API_KEY → vlm-api 语义解析；否则 ffmpeg-shotcut 结构解析；无文件 → mock
    const parserName = opts.parser
      ?? (filePath ? (process.env.VBID_VLM_API_KEY ? 'vlm-api' : 'ffmpeg-shotcut') : 'mock');
    const parser = getParser(parserName);
    const parsed = await parser.parse({
      assetId: asset.id as string,
      filename: asset.filename as string,
      durationMs: opts.durationMs,
      filePath,
    });

    let thumbs = 0;
    if (filePath && (parserName === 'ffmpeg-shotcut' || parserName === 'vlm-api')) {
      const media = await import('@vbid/media-probe');
      const outDir = join(DERIVED_ROOT, asset.id as string);
      mkdirSync(outDir, { recursive: true });
      const shots = parsed.shots.slice(0, 12);
      for (let i = 0; i < shots.length; i++) {
        const midMs = Math.round((shots[i].startMs + shots[i].endMs) / 2);
        const name = `shot-${shots[i].index}.jpg`;
        try {
          await media.extractKeyframe(filePath, midMs, join(outDir, name));
          shots[i].description += ` [thumb=/derived/${asset.id}/${name}]`;
          thumbs++;
        } catch { /* 单帧失败不阻断解析 */ }
      }
    }

    db.prepare(`UPDATE assets SET status = 'parsed', meta_json = ? WHERE id = ?`).run(
      JSON.stringify({ ...(JSON.parse(asset.meta_json as string) as object), parse: parsed }),
      asset.id as string,
    );
    // P1 知识自动沉淀：解析完成 → raw 层（素材的结构化事实：镜头/Hook/节奏/音频）
    writeKnowledge('raw', asset.id as string, {
      type: 'master_parsed',
      filename: asset.filename,
      parser: parserName,
      shotCount: parsed.shots?.length ?? null,
      hooks: parsed.hooks ?? [],
      rhythm: parsed.rhythm ?? null,
      bgm: parsed.bgm ?? null,
      hasTranscript: Boolean(parsed.transcript),
      keyframesExtracted: thumbs,
    }, 'auto-parse');
    return { parsed, thumbs };
  }

  /** 执行任务（工作流 A 第⑤–⑦步）：状态推进 generating→done，逐变体入库（含守卫结果 + 全量 prompt 溯源） */
  async function executeTask(
    taskId: string,
    seed: number,
    generatorName = defaultGeneratorName(),
    tier?: 'economy' | 'standard',
  ): Promise<{ summary: Record<string, unknown>; task: Record<string, unknown> }> {
    const task = getTask(taskId);
    if (!task) throw new Error('task not found');
    const master = getAsset(task.master_asset_id as string);
    if (!master) throw new Error('master asset missing');
    const matrix = createMatrix(JSON.parse(task.matrix_json as string).dimensions);

    db.prepare(`UPDATE tasks SET status = 'generating' WHERE id = ?`).run(taskId);
    let actualCostUsd = 0;
    const masterMeta = JSON.parse((master.meta_json as string | null) ?? '{}') as { parse?: import('@vbid/reference-parser').ParsedReference };
    const result = await runWorkflowA({
      masterAssetId: master.id as string,
      masterFilename: master.filename as string,
      masterFilePath: (master.file_path as string | null) ?? undefined,
      parsed: masterMeta.parse,
      durationMs: Number(master.duration_ms ?? 11000),
      variantCount: Number(task.variant_count),
      seed,
      dimensions: matrix.dimensions,
    }, {
      generator: resolveGenerator(generatorName, master.id as string, tier),
      onVariant: (v) => {
        const vid = newId('var');
        if (typeof v.generated.usageCostUsd === 'number') actualCostUsd += v.generated.usageCostUsd;
        db.prepare(
          `INSERT INTO assets (id, kind, filename, parent_id, task_id, status, meta_json, review)
           VALUES (?, 'variant', ?, ?, ?, ?, ?, NULL)`,
        ).run(
          vid, `${v.spec.id}.mp4`, master.id as string, task.id as string,
          v.accepted ? 'accepted' : 'rejected',
          JSON.stringify({
            spec: v.spec,
            fileRef: v.generated.fileRef,
            descriptor: v.generated.descriptor,
            prompt: v.generated.prompt ?? null,
            fingerprint: v.generated.fingerprint,
            guards: { fidelity: v.fidelity, dedup: v.dedup },
            gen: {
              generator: v.generated.generator,
              jobId: v.generated.jobId ?? null,
              usageCostUsd: v.generated.usageCostUsd ?? null,
            },
          }),
        );
      },
    });
    db.prepare(`UPDATE tasks SET status = 'done' WHERE id = ?`).run(taskId);
    // P1 知识自动沉淀：任务完成 → topic 层（哪个 Master × 矩阵 × 产出与通过率）
    writeKnowledge('topic', master.id as string, {
      type: 'task_completed',
      taskId,
      masterFilename: master.filename,
      generator: generatorName,
      tier: tier ?? null,
      variantCount: result.variants.length,
      acceptedCount: result.acceptedCount,
      rejectedCount: result.rejectedCount,
      actualCostUsd: Number(actualCostUsd.toFixed(4)),
    }, 'auto-task');
    writeAudit('task_run', {
      taskId, masterAssetId: master.id, generator: generatorName, tier: tier ?? null,
      acceptedCount: result.acceptedCount, variantCount: result.variants.length,
    }, Number(actualCostUsd.toFixed(4)));
    return {
      summary: {
        requestedCount: Number(task.variant_count),
        variantCount: result.variants.length,
        // 组合空间耗尽时按空间上限产出（README 语义：变体数 ≤ 组合空间）
        spaceCapped: result.variants.length < Number(task.variant_count),
        acceptedCount: result.acceptedCount,
        rejectedCount: result.rejectedCount,
        estimatedCostUsd: result.cost.estimatedCostUsd,
        generator: generatorName,
        tier: tier ?? null,
        actualCostUsd: Number(actualCostUsd.toFixed(4)),
      },
      task: getTask(taskId)!,
    };
  }

  /** P1 知识四层之写入（raw/topic/rule 自动沉淀；manual/qa 由 MCP write_knowledge 与后续界面写入） */
  function writeKnowledge(layer: 'raw' | 'topic' | 'rule' | 'manual' | 'qa', subjectKey: string, content: unknown, source: string): void {
    db.prepare(
      `INSERT INTO knowledge_entries (id, layer, subject_key, content_json, source)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(newId('knl'), layer, subjectKey, JSON.stringify(content), source);
  }

  /** P1 审计：一切 cost-incurring / 状态推进写操作留痕 */
  function writeAudit(action: string, payload: unknown, costUsd: number | null = null): void {
    db.prepare(
      `INSERT INTO audit_log (id, actor, action, payload_json, cost_usd)
       VALUES (?, 'local', ?, ?, ?)`,
    ).run(newId('aud'), action, JSON.stringify(payload), costUsd);
  }

  /** 关键内容分析 + 智能推荐（/analysis 路由与 MCP get_analysis/suggest_matrix 共用） */
  function analysisFor(asset: Record<string, unknown>): { keyContent: unknown; suggestions: unknown } | { error: string } {
    const meta = JSON.parse(asset.meta_json as string) as { parse?: Record<string, unknown>; probe?: { hasAudio?: boolean } };
    if (!meta.parse) return { error: 'asset not parsed yet; POST /api/assets/:id/parse first' };
    const parsed = meta.parse as Parameters<typeof suggestDimensions>[0] & { shots: Array<{ description?: string }> };
    const thumbs = extractThumbs(parsed.shots);
    return {
      keyContent: buildKeyContent(parsed, thumbs),
      suggestions: knowledgeOverlay(asset.id as string, suggestDimensions(parsed, { hasAudio: meta.probe?.hasAudio })),
    };
  }

  // ---- P2：MCP 端点（12 个工具契约，JSON-RPC over POST /mcp；审批门与 REST 共用 approvals 表）----
  const mcpHandler = createMcpHandler({
    db,
    newId,
    getAsset,
    getTask,
    parseMasterById: async (assetId, opts) => {
      const asset = getAsset(assetId);
      if (!asset) throw new Error('master not found');
      return parseMaster(asset, { parser: opts?.parser, durationMs: Number(asset.duration_ms ?? 0) });
    },
    analysisFor,
    executeTaskById: async (taskId, seed, generatorName, tier) => {
      const { summary } = await executeTask(taskId, seed, generatorName, tier);
      return summary;
    },
    writeKnowledge,
    registerSkill: (name, taskId, opts) => registerSkillFromTask(name, taskId, opts),
    checkGenBudget: async () => {
      const b = await checkOpenRouterKeyBudget();
      return { remainingUsd: b?.remainingUsd ?? null };
    },
    hasGenKey: () => Boolean(process.env.VBID_GEN_API_KEY ?? process.env.VBID_VLM_API_KEY),
  });

  // ---- 权利登记（rights 平面：check_use 的数据源；REST 管理入口，Agent 经 check_use 查询）----
  route('POST', '/api/assets/:id/rights', (ctx) => {
    const asset = getAsset(ctx.params.id);
    if (!asset) return { __status: 404, error: 'asset not found' };
    const b = ctx.body as Record<string, unknown>;
    const status = ['Cleared', 'Restricted', 'Expired'].includes(String(b.status)) ? String(b.status) : 'Cleared';
    db.prepare(
      `INSERT INTO rights (asset_id, license, status, channels, territories, embargo_until, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(asset_id) DO UPDATE SET
         license = excluded.license, status = excluded.status, channels = excluded.channels,
         territories = excluded.territories, embargo_until = excluded.embargo_until, expires_at = excluded.expires_at`,
    ).run(
      asset.id as string, String(b.license ?? ''),
      status,
      JSON.stringify(Array.isArray(b.channels) ? b.channels : []),
      JSON.stringify(Array.isArray(b.territories) ? b.territories : ['Global']),
      typeof b.embargo_until === 'string' ? b.embargo_until : null,
      typeof b.expires_at === 'string' ? b.expires_at : null,
    );
    writeAudit('set_rights', { assetId: asset.id, status });
    return { rights: db.prepare('SELECT * FROM rights WHERE asset_id = ?').get(asset.id as string) };
  });

  // ---- P3 学习闭环：Skill 注册门槛 + 知识回放 + 知识/技能查询端点 ----

  /** Skill 注册门槛（PM 裁决，写进 docs/06）：同一 Master 下 ≥3 个已完成任务 · ≥8 条变体 · 👍率 ≥60%（按已审变体计） */
  const SKILL_GATE = { minTasks: 3, minVariants: 8, minGoodRate: 0.6 };

  function skillEligibility(masterAssetId: string): {
    eligible: boolean; taskCount: number; variantCount: number; reviewedCount: number; goodRate: number | null;
    reasons: string[];
  } {
    const taskCount = (db.prepare(
      `SELECT COUNT(*) AS n FROM tasks WHERE master_asset_id = ? AND status = 'done'`,
    ).get(masterAssetId) as { n: number }).n;
    const stats = db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN review IS NOT NULL THEN 1 ELSE 0 END) AS reviewed,
              SUM(CASE WHEN review = 1 THEN 1 ELSE 0 END) AS good
       FROM assets WHERE parent_id = ? AND kind = 'variant'`,
    ).get(masterAssetId) as { total: number; reviewed: number | null; good: number | null };
    const variantCount = stats.total ?? 0;
    const reviewed = stats.reviewed ?? 0;
    const good = stats.good ?? 0;
    const goodRate = reviewed ? Number((good / reviewed).toFixed(2)) : null;
    const reasons: string[] = [];
    if (taskCount < SKILL_GATE.minTasks) reasons.push(`已完成任务 ${taskCount}/${SKILL_GATE.minTasks}`);
    if (variantCount < SKILL_GATE.minVariants) reasons.push(`变体 ${variantCount}/${SKILL_GATE.minVariants}`);
    if (goodRate === null) reasons.push('尚无审核数据（👍/👎）');
    else if (goodRate < SKILL_GATE.minGoodRate) reasons.push(`👍率 ${Math.round(goodRate * 100)}% < ${SKILL_GATE.minGoodRate * 100}%`);
    return { eligible: reasons.length === 0, taskCount, variantCount, reviewedCount: reviewed, goodRate, reasons };
  }

  /** 从已跑通任务注册 versioned skill（REST 与 MCP register_skill 共用；门槛不达 → 抛错） */
  function registerSkillFromTask(
    name: string, taskId: string,
    opts: { domain?: string; promptTemplate?: string; tier?: string } = {},
  ): Record<string, unknown> {
    const task = getTask(taskId);
    if (!task) throw new Error('task not found');
    if (task.status !== 'done') throw new Error('task not done yet（配方来源必须是已跑通的任务）');
    const masterId = task.master_asset_id as string;
    const gate = skillEligibility(masterId);
    if (!gate.eligible) {
      throw new Error(`Skill 注册门槛未达（${gate.reasons.join(' · ')}）`);
    }
    // 同名 Skill 复用行，版本递增；新名字则建行
    const existing = db.prepare('SELECT * FROM skills WHERE name = ?').get(name) as Record<string, unknown> | undefined;
    const skillId = (existing?.id as string) ?? newId('skl');
    if (!existing) {
      db.prepare(`INSERT INTO skills (id, name, domain, description) VALUES (?, ?, ?, ?)`)
        .run(skillId, name, String(opts.domain ?? 'general'), `registered from task ${taskId}`);
    }
    const version = `v${(db.prepare('SELECT COUNT(*) AS n FROM skill_versions WHERE skill_id = ?').get(skillId) as { n: number }).n + 1}`;
    db.prepare(
      `INSERT INTO skill_versions (skill_id, version, recipe_json, provenance_json, status)
       VALUES (?, ?, ?, ?, 'active')`,
    ).run(
      skillId, version,
      JSON.stringify({
        dimensions: JSON.parse(task.matrix_json as string).dimensions,
        promptTemplate: opts.promptTemplate ?? '',
        tier: opts.tier ?? 'standard',
        anchorShotType: 'hook',
      }),
      JSON.stringify({ registeredFromTaskId: taskId, sampleCount: gate.variantCount, goodRate: gate.goodRate }),
    );
    writeAudit('register_skill', { skillId, name, taskId, version });
    return { skillId, name, version, gate };
  }

  route('POST', '/api/skills/register', (ctx) => {
    const b = ctx.body as Record<string, unknown>;
    if (typeof b.name !== 'string' || !b.name || typeof b.task_id !== 'string') {
      return { __status: 400, error: 'name and task_id are required' };
    }
    try {
      return { __status: 201, skill: registerSkillFromTask(b.name, b.task_id, { domain: b.domain as string | undefined, promptTemplate: b.prompt_template as string | undefined, tier: b.tier as string | undefined }) };
    } catch (e) {
      const task = getTask(b.task_id as string);
      return { __status: 422, error: (e as Error).message, eligibility: task ? skillEligibility(task.master_asset_id as string) : null };
    }
  });

  route('GET', '/api/skills', () => {
    const skills = db.prepare('SELECT * FROM skills ORDER BY created_at DESC').all() as Array<Record<string, unknown>>;
    return {
      skills: skills.map((s) => ({
        ...s,
        versions: db.prepare('SELECT * FROM skill_versions WHERE skill_id = ? ORDER BY created_at DESC').all(s.id as string),
      })),
      gate: SKILL_GATE,
    };
  });

  route('GET', '/api/knowledge', (ctx, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const layer = url.searchParams.get('layer');
    const subjectKey = url.searchParams.get('subject_key');
    let sql = 'SELECT * FROM knowledge_entries WHERE 1=1';
    const args: string[] = [];
    if (layer) { sql += ' AND layer = ?'; args.push(layer); }
    if (subjectKey) { sql += ' AND subject_key = ?'; args.push(subjectKey); }
    sql += ' ORDER BY created_at DESC LIMIT 500';
    return { entries: db.prepare(sql).all(...args) };
  });

  /**
   * P3 知识回放：把审核结论（rule 层事实）回放进变量推荐。
   * 统计该 Master 已审变体的变量取值：👍≥2 且多于 👎 → 'proven'（提升置信）；👎 不占优 → 'avoid'（压低置信）。
   * 叠加在 suggestions.overlay 上，不改 rule-v1 引擎本体（可解释、可回退）。
   */
  function knowledgeOverlay(masterAssetId: string, suggestions: unknown): unknown {
    const rows = db.prepare(
      `SELECT review, meta_json FROM assets WHERE parent_id = ? AND kind = 'variant' AND review IS NOT NULL`,
    ).all(masterAssetId) as Array<{ review: number; meta_json: string }>;
    if (rows.length === 0) return suggestions;
    const tally = new Map<string, { good: number; bad: number }>();
    for (const r of rows) {
      let assignments: Record<string, string> = {};
      try { assignments = ((JSON.parse(r.meta_json) as { spec?: { assignments?: Record<string, string> } }).spec ?? {}).assignments ?? {}; } catch { continue; }
      for (const [dim, opt] of Object.entries(assignments)) {
        const key = `${dim}=${opt}`;
        const cur = tally.get(key) ?? { good: 0, bad: 0 };
        if (r.review === 1) cur.good++; else cur.bad++;
        tally.set(key, cur);
      }
    }
    const hints: Array<Record<string, unknown>> = [];
    for (const [key, v] of tally) {
      const verdict = v.good >= 2 && v.good > v.bad ? 'proven' : v.bad > 0 && v.bad >= v.good ? 'avoid' : null;
      if (verdict) {
        const [dimension, option] = key.split('=');
        hints.push({ dimension, option, verdict, good: v.good, bad: v.bad });
      }
    }
    if (hints.length === 0) return suggestions;
    // 建议型叠加：不改 rule-v1 的置信度标签（high/medium/low），由前端/Agent 按 verdict 加权
    return { ...(suggestions as Record<string, unknown>), overlay: { engine: 'review-feedback', hints } };
  }

  const server = createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

    // ---- P2：MCP 端点（Agent 直连生产线；跨源 Agent 需 CORS）----
    if (pathname === '/mcp') {
      const cors = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'content-type, authorization',
        'access-control-allow-methods': 'POST, GET, OPTIONS',
      };
      if (method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
      if (method === 'GET') {
        // Streamable HTTP 的 SSE 流本端点不需要（工具调用全是请求-响应）；明确 405 引导客户端走 POST
        res.writeHead(405, { ...cors, allow: 'POST' });
        res.end(JSON.stringify({ error: 'Method not allowed: MCP tool calls use POST /mcp (JSON-RPC)' }));
        return;
      }
      if (method === 'POST') {
        let payload: unknown;
        try { payload = JSON.parse(Buffer.concat(await new Promise<Buffer[]>((resolve, reject) => {
          const chunks: Buffer[] = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', () => resolve(chunks));
          req.on('error', reject);
        })).toString('utf-8')); }
        catch { payload = null; }
        const { status, body, headers } = await mcpHandler(payload);
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...cors, ...(headers ?? {}) });
        res.end(JSON.stringify(body));
        return;
      }
      res.writeHead(405, { ...cors, allow: 'POST, GET, OPTIONS' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    for (const r of routes) {
      if (r.method !== method) continue;
      const m = r.pattern.exec(pathname);
      if (!m) continue;
      try {
        const body = method === 'GET' || method === 'HEAD' ? {} : await readBody(req);
        const params: Record<string, string> = {};
        r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        const result = (await r.handler({ db, body, params }, req, res)) as Record<string, unknown>;
        const status = typeof result.__status === 'number' ? result.__status : 200;
        json(res, status, result);
      } catch (e) {
        json(res, 500, { error: (e as Error).message });
      }
      return;
    }
    // 静态工作台（apps/web）：非 /api、非 /healthz 的 GET 请求尝试按文件服务
    if (method === 'GET' && pathname.startsWith('/derived/')) {
      const rel = normalize(pathname.replace('/derived/', '')).replace(/^([/\\])+/, '');
      const filePath = normalize(join(DERIVED_ROOT, rel));
      if (!filePath.startsWith(normalize(DERIVED_ROOT))) { json(res, 403, { error: 'forbidden' }); return; }
      try {
        const content = await readFile(filePath);
        const mediaTypes: Record<string, string> = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.mp4': 'video/mp4',
          '.webm': 'video/webm',
        };
        res.writeHead(200, { 'content-type': mediaTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
        res.end(content);
        return;
      } catch {
        json(res, 404, { error: 'not found' });
        return;
      }
    }
    if (method === 'GET' && !pathname.startsWith('/api') && pathname !== '/healthz') {
      const webRoot = fileURLToPath(new URL('../../web/', import.meta.url));
      const rel = pathname === '/' ? 'index.html' : normalize(pathname).replace(/^([/\\])+/, '');
      const filePath = normalize(join(webRoot, rel));
      if (!filePath.startsWith(normalize(webRoot))) { json(res, 403, { error: 'forbidden' }); return; }
      try {
        const content = await readFile(filePath);
        const types: Record<string, string> = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
        };
        res.writeHead(200, { 'content-type': types[extname(filePath)] ?? 'application/octet-stream' });
        res.end(content);
        return;
      } catch {
        json(res, 404, { error: 'not found' });
        return;
      }
    }
    json(res, 404, { error: 'not found' });
  });

  return { server, db, close: () => { db.close(); } };
}

// 直接运行（node src/server.ts）时监听；被测试 import 时跳过
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8000);
  const { server } = createApp();
  server.listen(port, () => {
    console.log(`[vbid-api] listening on http://localhost:${port} (profile=${process.env.VBID_PROFILE ?? 'local'})`);
    console.log(`[vbid-api] parser: ${process.env.VBID_VLM_API_KEY
      ? `vlm-api (${process.env.VBID_VLM_MODEL ?? 'gpt-4o-mini'}, ${process.env.VBID_VLM_BASE_URL ?? 'https://api.openai.com/v1'})`
      : 'ffmpeg-shotcut（设置 VBID_VLM_API_KEY 升级为 vlm-api 语义解析）'}`);
    const gen = (process.env.VBID_GEN_API_KEY ?? process.env.VBID_VLM_API_KEY) ? 'openrouter' : 'mock';
    console.log(`[vbid-api] generator: ${gen === 'openrouter'
      ? `openrouter-video (${process.env.VBID_GEN_MODEL ?? 'alibaba/wan-2.7'}，I2V 首帧锚定，真实扣费)`
      : 'mock（设置 VBID_GEN_API_KEY 接入 OpenRouter 真实生成）'}`);
  });
}

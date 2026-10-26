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
 *   POST /api/tasks/:id/run       执行工作流 A（mock 链路：解析→采样→生成→双守卫→变体入库）
 *   POST /api/demo/run            Tunnel 演示入口：一键跑通端到端（选 Master→解析→建任务→执行）
 *   GET  /api/assets/:id/analysis 关键内容分析 + 智能变量推荐（规则引擎 v1）
 *   POST /api/preview             Demo 效果预览：矩阵每个选项的预期效果 + 关键帧 + 样例组合
 *   POST /api/variants/:id/review 审核标记 { outcome: 'good' | 'bad' }
 *   GET  /api/lineage/:masterId   谱系树（Master + 全部变体 + 审核状态）
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
import { runWorkflowA } from '@vbid/pipeline';

/** 派生资产（关键帧等）根目录：仓库 assets/derived（git 忽略） */
const DERIVED_ROOT = fileURLToPath(new URL('../../../assets/derived/', import.meta.url));

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
  route('GET', '/healthz', () => ({ ok: true, profile: process.env.VBID_PROFILE ?? 'local' }));

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

  // ---- 任务执行（工作流 A 第⑤–⑦步，mock 链路同步执行）----
  route('POST', '/api/tasks/:id/run', async (ctx) => {
    const task = getTask(ctx.params.id);
    if (!task) return { __status: 404, error: 'task not found' };
    if (task.status === 'done') return { __status: 409, error: 'task already run' };
    const b = ctx.body as Record<string, unknown>;
    const seed = Number.isFinite(Number(b.seed)) ? Number(b.seed) : 42;
    const { summary, task: doneTask } = await executeTask(task.id as string, seed);
    return { summary, task: doneTask };
  });

  // ---- 关键内容分析 + 智能变量推荐（工作流 A 第②步增强）----
  route('GET', '/api/assets/:id/analysis', (ctx) => {
    const asset = getAsset(ctx.params.id);
    if (!asset || asset.kind !== 'master') return { __status: 404, error: 'master asset not found' };
    const meta = JSON.parse(asset.meta_json as string) as { parse?: Record<string, unknown>; probe?: { hasAudio?: boolean } };
    if (!meta.parse) return { __status: 409, error: 'asset not parsed yet; POST /api/assets/:id/parse first' };
    const parsed = meta.parse as Parameters<typeof suggestDimensions>[0] & { shots: Array<{ description?: string }> };
    const thumbs = extractThumbs(parsed.shots);
    return {
      parsedWith: parsed.parser,
      keyContent: buildKeyContent(parsed, thumbs),
      suggestions: suggestDimensions(parsed, { hasAudio: meta.probe?.hasAudio }),
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

    // 4) 执行并汇总
    const { summary } = await executeTask(taskId, 42);
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
    return { parsed, thumbs };
  }

  /** 执行任务（工作流 A 第⑤–⑦步）：状态推进 generating→done，逐变体入库（含守卫结果） */
  async function executeTask(
    taskId: string,
    seed: number,
  ): Promise<{ summary: Record<string, unknown>; task: Record<string, unknown> }> {
    const task = getTask(taskId);
    if (!task) throw new Error('task not found');
    const master = getAsset(task.master_asset_id as string);
    if (!master) throw new Error('master asset missing');
    const matrix = createMatrix(JSON.parse(task.matrix_json as string).dimensions);

    db.prepare(`UPDATE tasks SET status = 'generating' WHERE id = ?`).run(taskId);
    const result = await runWorkflowA({
      masterAssetId: master.id as string,
      masterFilename: master.filename as string,
      durationMs: Number(master.duration_ms ?? 11000),
      variantCount: Number(task.variant_count),
      seed,
      dimensions: matrix.dimensions,
    }, {
      onVariant: (v) => {
        const vid = newId('var');
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
            fingerprint: v.generated.fingerprint,
            guards: { fidelity: v.fidelity, dedup: v.dedup },
          }),
        );
      },
    });
    db.prepare(`UPDATE tasks SET status = 'done' WHERE id = ?`).run(taskId);
    return {
      summary: {
        requestedCount: Number(task.variant_count),
        variantCount: result.variants.length,
        // 组合空间耗尽时按空间上限产出（README 语义：变体数 ≤ 组合空间）
        spaceCapped: result.variants.length < Number(task.variant_count),
        acceptedCount: result.acceptedCount,
        rejectedCount: result.rejectedCount,
        estimatedCostUsd: result.cost.estimatedCostUsd,
      },
      task: getTask(taskId)!,
    };
  }

  const server = createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
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
        res.writeHead(200, { 'content-type': 'image/jpeg' });
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
  });
}

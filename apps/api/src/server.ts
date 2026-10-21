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
 *   POST /api/variants/:id/review 审核标记 { outcome: 'good' | 'bad' }
 *   GET  /api/lineage/:masterId   谱系树（Master + 全部变体 + 审核状态）
 *   GET  /, /app.js, /style.css   静态工作台（apps/web，零构建）
 *
 * 设计约束：状态推进由 pipeline 包驱动，本服务做 REST + 状态读写，保持可替换为 D1。
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, newId, type DatabaseSync } from './db.ts';
import { createMatrix, estimateCost, enabledDimensions } from '@vbid/variable-matrix';
import { getParser } from '@vbid/reference-parser';
import { runWorkflowA } from '@vbid/pipeline';

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
      `INSERT INTO assets (id, kind, filename, duration_ms, parent_id, task_id, status, meta_json)
       VALUES (?, ?, ?, ?, ?, ?, 'uploaded', ?)`,
    ).run(
      id, kind, b.filename,
      typeof b.duration_ms === 'number' ? b.duration_ms : null,
      typeof b.parent_id === 'string' ? b.parent_id : null,
      typeof b.task_id === 'string' ? b.task_id : null,
      JSON.stringify(b.meta ?? {}),
    );
    return { __status: 201, asset: getAsset(id) };
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
    const parser = getParser(typeof b.parser === 'string' ? b.parser : 'mock');
    const durationMs = Number(asset.duration_ms ?? b.duration_ms ?? 0);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return { __status: 400, error: 'asset has no duration_ms; pass it in body' };
    }
    const parsed = await parser.parse({
      assetId: asset.id as string,
      filename: asset.filename as string,
      durationMs,
    });
    db.prepare(`UPDATE assets SET status = 'parsed', meta_json = ? WHERE id = ?`).run(
      JSON.stringify({ ...(JSON.parse(asset.meta_json as string) as object), parse: parsed }),
      asset.id as string,
    );
    return { parsed };
  });

  // ---- 任务执行（工作流 A 第⑤–⑦步，mock 链路同步执行）----
  route('POST', '/api/tasks/:id/run', async (ctx) => {
    const task = getTask(ctx.params.id);
    if (!task) return { __status: 404, error: 'task not found' };
    if (task.status === 'done') return { __status: 409, error: 'task already run' };
    const master = getAsset(task.master_asset_id as string);
    if (!master) return { __status: 404, error: 'master asset missing' };
    const matrix = createMatrix(JSON.parse(task.matrix_json as string).dimensions);
    const b = ctx.body as Record<string, unknown>;
    const seed = Number.isFinite(Number(b.seed)) ? Number(b.seed) : 42;

    db.prepare(`UPDATE tasks SET status = 'generating' WHERE id = ?`).run(task.id as string);
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
    db.prepare(`UPDATE tasks SET status = 'done' WHERE id = ?`).run(task.id as string);
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
      task: getTask(task.id as string),
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
  });
}

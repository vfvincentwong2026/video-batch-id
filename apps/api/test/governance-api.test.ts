import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.ts';

let app: ReturnType<typeof createApp>;
let base: string;

before(async () => {
  app = createApp(':memory:');
  await new Promise<void>((resolve) => {
    app.server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

after(() => {
  app.server.close();
  app.close();
});

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

function clearKeys() {
  delete process.env.VBID_GEN_API_KEY;
  delete process.env.VBID_VLM_API_KEY;
}

async function makeTask(variantCount = 2) {
  const m = await api('POST', '/api/assets', { kind: 'master', filename: `gov-${Date.now()}.mp4`, duration_ms: 11000 });
  const masterId = m.data.asset.id as string;
  await api('POST', `/api/assets/${masterId}/parse`, {});
  const t = await api('POST', '/api/tasks', { master_asset_id: masterId, variant_count: variantCount });
  return { masterId, taskId: t.data.task.id as string, variantCount };
}

test('审批门：无 key → 500 KEY 提示（不消耗任何状态）', async () => {
  clearKeys();
  const { taskId } = await makeTask();
  const r = await api('POST', `/api/tasks/${taskId}/run`, { generator: 'openrouter' });
  assert.equal(r.status, 500);
  assert.match(r.data.error, /VBID_GEN_API_KEY/);
});

test('审批门 two-call：428 发 token → 错 token 403 → 参数挪用 403 → 执行失败后 token 已消费', async () => {
  process.env.VBID_GEN_API_KEY = 'sk-test'; // 假 key：/auth/key 预检软失败返回 null，不阻断审批流
  const { taskId, variantCount } = await makeTask();

  // 第一调：无 token → 428 + 审批请求（预估 = standard 档 $0.10/s × 5s × 条数）
  const r1 = await api('POST', `/api/tasks/${taskId}/run`, { generator: 'openrouter' });
  assert.equal(r1.status, 428);
  assert.equal(r1.data.approval_required, true);
  assert.equal(r1.data.tool, 'submit_generation');
  assert.equal(r1.data.tier, 'standard');
  assert.equal(r1.data.tier_preset.model, 'alibaba/wan-2.7');
  assert.equal(r1.data.estimated_cost_usd, Number((0.10 * 5 * variantCount).toFixed(2)));
  const token = r1.data.approval_token as string;
  assert.ok(token.length >= 32);
  // 令牌已入库且 pending
  const pending = app.db.prepare(`SELECT * FROM approvals WHERE token = ? AND status = 'pending'`).get(token);
  assert.ok(pending);

  // 错 token → 403
  const r2 = await api('POST', `/api/tasks/${taskId}/run`, { generator: 'openrouter', approval_token: 'deadbeef' });
  assert.equal(r2.status, 403);

  // 令牌挪用（改档位）→ 403 args_mismatch
  const r3 = await api('POST', `/api/tasks/${taskId}/run`, { generator: 'openrouter', approval_token: token, tier: 'economy' });
  assert.equal(r3.status, 403);
  assert.match(r3.data.error, /args_mismatch/);

  // 正确二调：Master 无真实文件 → openrouter provider 抛 masterFilePath，token 已消费
  const r4 = await api('POST', `/api/tasks/${taskId}/run`, { generator: 'openrouter', approval_token: token });
  assert.equal(r4.status, 500);
  assert.match(r4.data.error, /masterFilePath/);
  const consumed = app.db.prepare(`SELECT * FROM approvals WHERE token = ?`).get(token) as { status: string };
  assert.equal(consumed.status, 'consumed');

  // 已消费令牌复用 → 403
  const r5 = await api('POST', `/api/tasks/${taskId}/run`, { generator: 'openrouter', approval_token: token });
  assert.equal(r5.status, 403);
  clearKeys();
});

test('知识自动沉淀：mock 链路 parse→raw、run→topic+audit、review→rule+audit', async () => {
  clearKeys();
  const m = await api('POST', '/api/assets', { kind: 'master', filename: `kn-${Date.now()}.mp4`, duration_ms: 11000 });
  const masterId = m.data.asset.id as string;

  // 解析 → raw 层
  await api('POST', `/api/assets/${masterId}/parse`, {});
  const raw = app.db.prepare(
    `SELECT * FROM knowledge_entries WHERE layer = 'raw' AND subject_key = ?`,
  ).all(masterId) as Array<{ source: string; content_json: string }>;
  assert.equal(raw.length, 1);
  assert.equal(raw[0].source, 'auto-parse');
  assert.match(raw[0].content_json, /master_parsed/);

  // 执行 mock 任务 → topic 层 + audit_log
  const t = await api('POST', '/api/tasks', { master_asset_id: masterId, variant_count: 2 });
  const taskId = t.data.task.id as string;
  await api('POST', `/api/tasks/${taskId}/run`, { generator: 'mock' });
  const topic = app.db.prepare(
    `SELECT * FROM knowledge_entries WHERE layer = 'topic' AND subject_key = ?`,
  ).all(masterId) as Array<{ source: string; content_json: string }>;
  assert.equal(topic.length, 1);
  assert.equal(topic[0].source, 'auto-task');
  assert.match(topic[0].content_json, /task_completed/);
  const audit = app.db.prepare(
    `SELECT * FROM audit_log WHERE action = 'task_run'`,
  ).all() as Array<{ payload_json: string; cost_usd: number | null }>;
  assert.ok(audit.length >= 1);
  assert.match(audit[0].payload_json, new RegExp(taskId));

  // 审核 → rule 层 + audit_log
  const detail = await api('GET', `/api/tasks/${taskId}`);
  const variantId = detail.data.variants[0].id as string;
  await api('POST', `/api/variants/${variantId}/review`, { outcome: 'good' });
  const rule = app.db.prepare(
    `SELECT * FROM knowledge_entries WHERE layer = 'rule' AND subject_key = ?`,
  ).all(masterId) as Array<{ source: string; content_json: string }>;
  assert.equal(rule.length, 1);
  assert.equal(rule[0].source, 'auto-review');
  assert.match(rule[0].content_json, /variant_reviewed/);
  const reviewAudit = app.db.prepare(
    `SELECT * FROM audit_log WHERE action = 'review_variant'`,
  ).all();
  assert.ok(reviewAudit.length >= 1);
});

test('mock 链路不拦截：无 token 直通执行', async () => {
  clearKeys();
  const { taskId } = await makeTask();
  const r = await api('POST', `/api/tasks/${taskId}/run`, { generator: 'mock' });
  assert.equal(r.status, 200);
  assert.equal(r.data.summary.generator, 'mock');
});

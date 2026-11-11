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
  delete process.env.VBID_GEN_API_KEY;
  delete process.env.VBID_VLM_API_KEY;
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

let masterId = '';

test('Skill 门槛：1 任务 2 变体 → 422 + 明确差距；补齐 3 任务 12 变体全 👍 → 注册 v1，再注册 v2', async () => {
  const m = await api('POST', '/api/assets', { kind: 'master', filename: 'learn-target.mp4', duration_ms: 11000 });
  masterId = m.data.asset.id;
  await api('POST', `/api/assets/${masterId}/parse`, {});

  // 任务 1：4 条变体（3 任务 × 4 = 12 ≥ 8）
  const t1 = await api('POST', '/api/tasks', { master_asset_id: masterId, variant_count: 4 });
  await api('POST', `/api/tasks/${t1.data.task.id}/run`, { generator: 'mock' });
  // 门槛未达：1/3 任务 · 4/8 变体 · 无审核
  const fail = await api('POST', '/api/skills/register', { name: 'candy-recipe', task_id: t1.data.task.id });
  assert.equal(fail.status, 422);
  assert.match(fail.data.error, /门槛未达/);
  assert.equal(fail.data.eligibility.eligible, false);
  assert.equal(fail.data.eligibility.taskCount, 1);
  assert.ok(fail.data.eligibility.reasons.length >= 2);

  // 任务 2、3
  const t2 = await api('POST', '/api/tasks', { master_asset_id: masterId, variant_count: 4 });
  await api('POST', `/api/tasks/${t2.data.task.id}/run`, { generator: 'mock' });
  const t3 = await api('POST', '/api/tasks', { master_asset_id: masterId, variant_count: 4 });
  await api('POST', `/api/tasks/${t3.data.task.id}/run`, { generator: 'mock' });

  // 仍无审核数据 → 门槛卡在 👍率
  const noReview = await api('POST', '/api/skills/register', { name: 'candy-recipe', task_id: t3.data.task.id });
  assert.equal(noReview.status, 422);
  assert.match(noReview.data.error, /尚无审核数据/);

  // 审核全部 👍（12 条已审，好评率 100%）
  const all = await api('GET', `/api/assets?kind=variant&parent_id=${masterId}`);
  for (const v of all.data.assets) {
    await api('POST', `/api/variants/${v.id}/review`, { outcome: 'good' });
  }

  // 达标 → 注册 v1
  const ok1 = await api('POST', '/api/skills/register', { name: 'candy-recipe', task_id: t3.data.task.id, tier: 'standard' });
  assert.equal(ok1.status, 201);
  assert.equal(ok1.data.skill.version, 'v1');
  assert.equal(ok1.data.skill.gate.eligible, true);
  assert.equal(ok1.data.skill.gate.variantCount, 12);

  // 同名再注册 → v2（版本递增）
  const ok2 = await api('POST', '/api/skills/register', { name: 'candy-recipe', task_id: t3.data.task.id });
  assert.equal(ok2.data.skill.version, 'v2');
});

test('GET /api/skills：列表含版本与 provenance；GET /api/knowledge 按 layer 过滤', async () => {
  const skills = await api('GET', '/api/skills');
  assert.equal(skills.data.skills.length, 1);
  assert.equal(skills.data.skills[0].versions.length, 2);
  const prov = JSON.parse(skills.data.skills[0].versions[0].provenance_json);
  assert.equal(prov.sampleCount, 12);
  assert.equal(prov.goodRate, 1);
  assert.equal(skills.data.gate.minTasks, 3);

  const rules = await api('GET', `/api/knowledge?layer=rule&subject_key=${masterId}`);
  assert.equal(rules.data.entries.length, 12);
  assert.ok(rules.data.entries.every((e: { source: string }) => e.source === 'auto-review'));
  const topics = await api('GET', `/api/knowledge?layer=topic&subject_key=${masterId}`);
  assert.equal(topics.data.entries.length, 3);
});

test('知识回放 overlay：同取值 👍≥2 → proven；👎 占优 → avoid（不改写 rule-v1 置信度）', async () => {
  const m = await api('POST', '/api/assets', { kind: 'master', filename: 'overlay-target.mp4', duration_ms: 11000 });
  const mid = m.data.asset.id;
  await api('POST', `/api/assets/${mid}/parse`, {});
  // 8 条变体（空间 16），按变量取值分组审核
  const t = await api('POST', '/api/tasks', { master_asset_id: mid, variant_count: 8 });
  await api('POST', `/api/tasks/${t.data.task.id}/run`, { generator: 'mock' });
  const { data: { variants } } = await api('GET', `/api/tasks/${t.data.task.id}`);
  const groups = new Map<string, Array<{ id: string }>>();
  for (const v of variants) {
    const meta = JSON.parse(v.meta_json);
    const key = `visual=${meta.spec?.assignments?.visual ?? '?'}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(v);
  }
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  assert.ok(sorted[0][1].length >= 2, '8 条采样在 4 选项上必有重复取值');
  // 最频取值全 👍（→ proven）；次频取值全 👎（→ avoid）
  for (const v of sorted[0][1]) await api('POST', `/api/variants/${v.id}/review`, { outcome: 'good' });
  for (const v of sorted[1][1]) await api('POST', `/api/variants/${v.id}/review`, { outcome: 'bad' });

  const a = await api('GET', `/api/assets/${mid}/analysis`);
  const overlay = a.data.suggestions.overlay;
  assert.ok(overlay, '有审核数据后应出现 overlay');
  assert.equal(overlay.engine, 'review-feedback');
  const proven = overlay.hints.filter((h: { verdict: string }) => h.verdict === 'proven');
  const avoid = overlay.hints.filter((h: { verdict: string }) => h.verdict === 'avoid');
  assert.ok(proven.length >= 1, '全 👍 的重复取值应标 proven');
  assert.ok(avoid.length >= 1, '👎 占优的取值应标 avoid');
  assert.equal(proven[0].dimension, 'visual');
  assert.ok(proven.every((h: { good: number; bad: number }) => h.good >= 2 && h.good > h.bad));
  assert.ok(avoid.every((h: { good: number; bad: number }) => h.bad >= h.good));
  // rule-v1 本体不被改写（置信度标签仍在 reasons 上且取值合法）
  assert.equal(a.data.suggestions.engine, 'rule-v1');
  assert.ok(a.data.suggestions.reasons.every((r: { confidence: string }) => ['high', 'medium', 'low'].includes(r.confidence)));
});

test('MCP register_skill 同样被门槛拦截（-32042 审批后仍 -32602 门槛信息）', async () => {
  const m = await api('POST', '/api/assets', { kind: 'master', filename: 'mcp-gate-check.mp4', duration_ms: 11000 });
  const mid = m.data.asset.id;
  await api('POST', `/api/assets/${mid}/parse`, {});
  const t = await api('POST', '/api/tasks', { master_asset_id: mid, variant_count: 2 });
  await api('POST', `/api/tasks/${t.data.task.id}/run`, { generator: 'mock' });

  const r1 = await fetch(base + '/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'register_skill', arguments: { name: 'x-recipe', taskId: t.data.task.id } } }),
  });
  const d1 = await r1.json();
  assert.equal(d1.error.code, -32042);
  const r2 = await fetch(base + '/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'register_skill', arguments: { name: 'x-recipe', taskId: t.data.task.id, approval_token: d1.error.data.approval_token } } }),
  });
  const d2 = await r2.json();
  assert.equal(d2.error.code, -32602);
  assert.match(d2.error.message, /门槛未达/);
});

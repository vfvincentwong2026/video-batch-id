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

test('healthz 返回 ok', async () => {
  const r = await api('GET', '/healthz');
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
});

test('登记 Master 资产 → 列表 → 详情', async () => {
  const created = await api('POST', '/api/assets', { kind: 'master', filename: 'sambal-matah-hit.mp4', duration_ms: 11000 });
  assert.equal(created.status, 201);
  const id = created.data.asset.id as string;
  assert.match(id, /^mas_/);

  const list = await api('GET', '/api/assets?kind=master');
  assert.equal(list.data.assets.length, 1);

  const detail = await api('GET', `/api/assets/${id}`);
  assert.equal(detail.data.asset.filename, 'sambal-matah-hit.mp4');
});

test('变体资产必须挂 parent_id', async () => {
  const r = await api('POST', '/api/assets', { kind: 'variant', filename: 'v01.mp4' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /parent_id/);
});

test('创建任务：合法矩阵 → 201 + 成本预估（README 案例口径 30×0.15=4.5）', async () => {
  const master = await api('POST', '/api/assets', { kind: 'master', filename: 'm.mp4' });
  const r = await api('POST', '/api/tasks', {
    master_asset_id: master.data.asset.id,
    variant_count: 30,
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.task.estimated_cost_usd, 4.5);
  assert.equal(r.data.task.status, 'queued');
});

test('创建任务：校验失败场景（无 master / 数量越界 / 矩阵无启用维度）', async () => {
  const noMaster = await api('POST', '/api/tasks', { master_asset_id: 'mas_nope', variant_count: 10 });
  assert.equal(noMaster.status, 400);

  const master = await api('POST', '/api/assets', { kind: 'master', filename: 'm2.mp4' });
  const tooMany = await api('POST', '/api/tasks', { master_asset_id: master.data.asset.id, variant_count: 501 });
  assert.equal(tooMany.status, 400);

  const allLocked = await api('POST', '/api/tasks', {
    master_asset_id: master.data.asset.id,
    variant_count: 5,
    matrix: { dimensions: [
      { key: 'visual', label: '视觉', enabled: false, options: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }], locked: [] },
    ] },
  });
  assert.equal(allLocked.status, 400);
  assert.match(allLocked.data.error, /no enabled dimensions/);
});

test('任务详情含变体列表；审核标记 good/bad 落库', async () => {
  const master = await api('POST', '/api/assets', { kind: 'master', filename: 'm3.mp4' });
  const task = await api('POST', '/api/tasks', { master_asset_id: master.data.asset.id, variant_count: 3 });
  const taskId = task.data.task.id;

  // 模拟 worker 产出 2 条变体（T3/T4 接入前的直接写入）
  const v1 = await api('POST', '/api/assets', { kind: 'variant', filename: 'V01.mp4', parent_id: master.data.asset.id, task_id: taskId });
  const v2 = await api('POST', '/api/assets', { kind: 'variant', filename: 'V02.mp4', parent_id: master.data.asset.id, task_id: taskId });
  assert.equal(v1.status, 201);

  const detail = await api('GET', `/api/tasks/${taskId}`);
  assert.equal(detail.data.variants.length, 2);

  const review = await api('POST', `/api/variants/${v1.data.asset.id}/review`, { outcome: 'good' });
  assert.equal(review.data.variant.review, 1);
  const reviewBad = await api('POST', `/api/variants/${v2.data.asset.id}/review`, { outcome: 'bad' });
  assert.equal(reviewBad.data.variant.review, 0);

  const invalid = await api('POST', `/api/variants/${v1.data.asset.id}/review`, { outcome: 'meh' });
  assert.equal(invalid.status, 400);
});

test('谱系查询：按 parent_id 列出某 Master 的全部变体', async () => {
  const master = await api('POST', '/api/assets', { kind: 'master', filename: 'm4.mp4' });
  await api('POST', '/api/assets', { kind: 'variant', filename: 'c1.mp4', parent_id: master.data.asset.id });
  await api('POST', '/api/assets', { kind: 'variant', filename: 'c2.mp4', parent_id: master.data.asset.id });
  const lineage = await api('GET', `/api/assets?kind=variant&parent_id=${master.data.asset.id}`);
  assert.equal(lineage.data.assets.length, 2);
});

test('未知路由 404；坏 JSON 400', async () => {
  const r = await api('GET', '/nope');
  assert.equal(r.status, 404);
  const res = await fetch(base + '/api/assets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  assert.equal(res.status, 500); // 解析失败走 500 兜底，见 readBody
});

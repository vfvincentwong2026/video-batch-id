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
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

test('静态工作台：/ 返回 index.html，/app.js、/style.css 可访问', async () => {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type') ?? '', /text\/html/);
  const html = await home.text();
  assert.match(html, /Video Batch ID/);

  for (const f of ['/app.js', '/style.css']) {
    const r = await fetch(base + f);
    assert.equal(r.status, 200, f);
    assert.ok((await r.text()).length > 500, f);
  }
});

test('静态服务防目录穿越', async () => {
  const r = await fetch(base + '/../package.json');
  assert.ok([403, 404].includes(r.status));
});

test('端到端工作流 A：上传 → 解析 → 建任务 → 执行 → 谱系 → 审核', async () => {
  // ① 上传
  const up = await api('POST', '/api/assets', {
    kind: 'master', filename: 'sambal-matah-hit.mp4', duration_ms: 11000,
  });
  assert.equal(up.status, 201);
  const masterId = up.data.asset.id;

  // ② 解析
  const parsed = await api('POST', `/api/assets/${masterId}/parse`, {});
  assert.equal(parsed.status, 200);
  assert.equal(parsed.data.parsed.shots.length, 4);
  assert.equal(parsed.data.parsed.parser, 'mock');

  // 重复解析也允许（修正场景）
  const again = await api('POST', `/api/assets/${masterId}/parse`, {});
  assert.equal(again.status, 200);

  // 对变体调用解析 → 404
  const v = await api('POST', '/api/assets', { kind: 'variant', filename: 'x.mp4', parent_id: masterId });
  const wrong = await api('POST', `/api/assets/${v.data.asset.id}/parse`, {});
  assert.equal(wrong.status, 404);

  // ③ 建任务（8 条）
  const task = await api('POST', '/api/tasks', { master_asset_id: masterId, variant_count: 8 });
  assert.equal(task.status, 201);

  // ④ 执行
  const run = await api('POST', `/api/tasks/${task.data.task.id}/run`, {});
  assert.equal(run.status, 200);
  assert.equal(run.data.summary.variantCount, 8);
  assert.equal(run.data.summary.acceptedCount + run.data.summary.rejectedCount, 8);
  assert.equal(run.data.task.status, 'done');

  // 重复执行 → 409
  const rerun = await api('POST', `/api/tasks/${task.data.task.id}/run`, {});
  assert.equal(rerun.status, 409);

  // ⑤ 谱系：本任务的 8 条变体挂在 master 下（另有一条手工登记的 x.mp4，共 9 条），守卫分齐全
  const lin = await api('GET', `/api/lineage/${masterId}`);
  assert.equal(lin.status, 200);
  const taskVariants = lin.data.variants.filter((x) => x.task_id === task.data.task.id);
  assert.equal(taskVariants.length, 8);
  assert.equal(lin.data.variants.length, 9);
  for (const variant of taskVariants) {
    assert.ok(variant.meta.guards.fidelity.score >= 0);
    assert.ok(variant.meta.guards.dedup.score >= 0);
    assert.ok(['accepted', 'rejected'].includes(variant.status));
  }

  // 未通过守卫的不混入合格队列
  const rejected = taskVariants.filter((x) => x.status === 'rejected');
  for (const r of rejected) {
    assert.ok(!r.meta.guards.fidelity.passed || !r.meta.guards.dedup.passed);
  }

  // ⑥ 审核
  const target = taskVariants[0];
  const review = await api('POST', `/api/variants/${target.id}/review`, { outcome: 'good' });
  assert.equal(review.data.variant.review, 1);

  // 任务详情含变体
  const detail = await api('GET', `/api/tasks/${task.data.task.id}`);
  assert.equal(detail.data.variants.length, 8);
});

test('run 未知任务 → 404；谱系未知 master → 404', async () => {
  const r1 = await api('POST', '/api/tasks/tsk_nope/run', {});
  assert.equal(r1.status, 404);
  const r2 = await api('GET', '/api/lineage/mas_nope');
  assert.equal(r2.status, 404);
});

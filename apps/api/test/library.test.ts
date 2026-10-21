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

test('素材库检索：关键词/类型/状态过滤', async () => {
  const up = await api('POST', '/api/assets', { kind: 'master', filename: 'sambal-hit.mp4', duration_ms: 11000 });
  await api('POST', '/api/assets/' + up.data.asset.id + '/parse', {});
  const task = await api('POST', '/api/tasks', { master_asset_id: up.data.asset.id, variant_count: 4 });
  await api('POST', '/api/tasks/' + task.data.task.id + '/run', {});

  // 全量
  const all = await api('GET', '/api/library');
  assert.ok(all.data.assets.length >= 5);

  // 关键词命中变量取值（meta_json LIKE）
  const q1 = await api('GET', '/api/library?q=' + encodeURIComponent('拉丝'));
  assert.ok(q1.data.assets.length >= 1, '应命中 Hook=拉丝 的变体');

  // 关键词未命中
  const q2 = await api('GET', '/api/library?q=zzz-no-match');
  assert.equal(q2.data.assets.length, 0);

  // 类型过滤
  const masters = await api('GET', '/api/library?kind=master');
  assert.ok(masters.data.assets.every((a: { kind: string }) => a.kind === 'master'));

  // 状态过滤
  const accepted = await api('GET', '/api/library?kind=variant&status=accepted');
  assert.ok(accepted.data.assets.every((a: { status: string }) => a.status === 'accepted'));
  assert.ok(accepted.data.assets.length >= 4);
});

test('Master 价值榜：产出/好评/通过率计分并排序', async () => {
  // 两个 Master：A 产出 4 条全通过、2 好评；B 产出 2 条
  const a = await api('POST', '/api/assets', { kind: 'master', filename: 'master-a.mp4', duration_ms: 10000 });
  const b = await api('POST', '/api/assets', { kind: 'master', filename: 'master-b.mp4', duration_ms: 10000 });
  for (const [m, n] of [[a, 4], [b, 2]] as const) {
    const t = await api('POST', '/api/tasks', { master_asset_id: m.data.asset.id, variant_count: n });
    await api('POST', '/api/tasks/' + t.data.task.id + '/run', {});
  }
  const linA = await api('GET', '/api/lineage/' + a.data.asset.id);
  await api('POST', `/api/variants/${linA.data.variants[0].id}/review`, { outcome: 'good' });
  await api('POST', `/api/variants/${linA.data.variants[1].id}/review`, { outcome: 'good' });

  const r = await api('GET', '/api/masters/value');
  assert.equal(r.status, 200);
  const rowA = r.data.masters.find((m: { master: { id: string } }) => m.master.id === a.data.asset.id);
  const rowB = r.data.masters.find((m: { master: { id: string } }) => m.master.id === b.data.asset.id);
  assert.equal(rowA.variantCount, 4);
  assert.equal(rowA.goodCount, 2);
  assert.equal(rowA.passRate, 1);
  // A 产出多+好评多 → 价值分高于 B
  assert.ok(rowA.valueScore > rowB.valueScore, `${rowA.valueScore} > ${rowB.valueScore}`);
  // 降序
  const scores = r.data.masters.map((m: { valueScore: number }) => m.valueScore);
  assert.deepEqual(scores, [...scores].sort((x, y) => y - x));
});

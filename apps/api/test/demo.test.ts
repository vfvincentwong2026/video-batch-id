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

test('demo：无素材时 → 400 引导先扫描入库', async () => {
  const r = await api('POST', '/api/demo/run', {});
  assert.equal(r.status, 400);
  assert.match(r.data.error, /no master asset/);
});

test('demo：一键跑通端到端（解析→建任务→执行→谱系）', async () => {
  // 登记一条带真实文件的 Master（指向仓库内 fixture 不存在的路径也无妨——file_path 非空即走真实解析分支；测试环境用 mock 分支兜底）
  const m1 = await api('POST', '/api/assets/scan-dir', { dir: 'nonexistent-dir-for-demo' });
  assert.equal(m1.status, 400);

  // 直接登记两条 master：一条无 file_path（mock 解析兜底），一条指定 master_id 演示
  const a = await api('POST', '/api/assets', { kind: 'master', filename: 'demo-master-a.mp4', duration_ms: 12000 });
  const b = await api('POST', '/api/assets', { kind: 'master', filename: 'demo-master-b.mp4', duration_ms: 9000 });

  // 指定 master_id 跑演示
  const r = await api('POST', '/api/demo/run', { master_id: a.data.asset.id });
  assert.equal(r.status, 201);
  assert.equal(r.data.demo, true);
  assert.equal(r.data.freshlyParsed, true);
  assert.equal(r.data.task.status, 'done');
  assert.equal(r.data.summary.requestedCount, 16);
  assert.ok(r.data.summary.variantCount > 0);
  assert.equal(
    r.data.summary.acceptedCount + r.data.summary.rejectedCount,
    r.data.summary.variantCount,
  );

  // 谱系可查到刚生成的变体
  const lin = await api('GET', `/api/lineage/${a.data.asset.id}`);
  assert.equal(lin.data.variants.length, r.data.summary.variantCount);

  // 不指定 master_id：只有一条「有真实文件」的候选时才轮得到它；无 file_path 的库 → 400
  const r2 = await api('POST', '/api/demo/run', {});
  assert.equal(r2.status, 400);

  // 再指定 b 跑一次，验证任务幂等可重复演示
  const r3 = await api('POST', '/api/demo/run', { master_id: b.data.asset.id });
  assert.equal(r3.status, 201);
  assert.notEqual(r3.data.task.id, r.data.task.id);
});

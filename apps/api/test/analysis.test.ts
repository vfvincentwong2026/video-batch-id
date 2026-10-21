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

/** 登记 + mock 解析一条 master，返回 id */
async function registerParsedMaster(filename = 'analysis-target.mp4') {
  const m = await api('POST', '/api/assets', { kind: 'master', filename, duration_ms: 12000 });
  const id = m.data.asset.id as string;
  await api('POST', `/api/assets/${id}/parse`, {});
  return id;
}

test('analysis：未解析 → 409；解析后 → 关键内容 + 智能推荐', async () => {
  const raw = await api('POST', '/api/assets', { kind: 'master', filename: 'unparsed.mp4', duration_ms: 8000 });
  const r0 = await api('GET', `/api/assets/${raw.data.asset.id}/analysis`);
  assert.equal(r0.status, 409);

  const id = await registerParsedMaster();
  const r = await api('GET', `/api/assets/${id}/analysis`);
  assert.equal(r.status, 200);
  // 关键内容结构
  assert.equal(r.data.keyContent.structure.length, 4); // mock 4 镜头
  assert.equal(r.data.keyContent.structure[0].type, 'hook');
  assert.ok(r.data.keyContent.hotspots.longest.shot >= 1);
  assert.equal(r.data.keyContent.hooks.length, 2);
  // 智能推荐
  assert.equal(r.data.suggestions.engine, 'rule-v1');
  assert.equal(r.data.suggestions.dimensions.length, 6);
  assert.equal(r.data.suggestions.reasons.length, 6);
  const enabled = r.data.suggestions.dimensions.filter((d: { enabled: boolean }) => d.enabled).map((d: { key: string }) => d.key);
  assert.deepEqual(enabled.sort(), ['audio', 'copy', 'visual']); // mock：节奏疏、无真实分辨率 → 不启用
});

test('analysis：未知资产 → 404', async () => {
  const r = await api('GET', '/api/assets/mas_nope/analysis');
  assert.equal(r.status, 404);
});

test('preview：矩阵确定后生成 Demo 效果预览（效果文案 + 镜头映射 + 样例组合）', async () => {
  const id = await registerParsedMaster('preview-target.mp4');

  const bad = await api('POST', '/api/preview', {});
  assert.equal(bad.status, 400);

  const analysis = await api('GET', `/api/assets/${id}/analysis`);
  const dims = analysis.data.suggestions.dimensions;
  const r = await api('POST', '/api/preview', { master_asset_id: id, dimensions: dims });
  assert.equal(r.status, 200);
  const p = r.data.preview;
  const enabledOpts = dims.filter((d: { enabled: boolean }) => d.enabled)
    .reduce((n: number, d: { options: unknown[] }) => n + d.options.length, 0);
  assert.equal(p.entries.length, enabledOpts);
  for (const e of p.entries) {
    assert.ok(e.effect.length > 10);
    assert.ok(e.affectedShots.length > 0);
  }
  assert.equal(p.samples.length, 3);
  assert.ok(p.space >= 2);
  assert.equal(p.engine, 'rule-v1');
});

test('preview：自定义维度因子（custom-*）可参与预览', async () => {
  const id = await registerParsedMaster('custom-dim.mp4');
  const dims = [
    {
      key: 'visual', label: '视觉', enabled: true,
      options: [{ id: 's1', label: '厨房' }, { id: 's2', label: '餐厅' }],
      locked: ['产品'],
    },
    {
      key: 'custom-light', label: '光线', enabled: true,
      options: [{ id: 'l1', label: '暖光' }, { id: 'l2', label: '冷光' }],
      locked: [],
    },
  ];
  const r = await api('POST', '/api/preview', { master_asset_id: id, dimensions: dims });
  assert.equal(r.status, 200);
  const custom = r.data.preview.entries.filter((e: { dimensionKey: string }) => e.dimensionKey === 'custom-light');
  assert.equal(custom.length, 2);
  assert.match(custom[0].effect, /自定义变量/);
  assert.equal(r.data.preview.space, 4);
});

test('preview：未解析 master → 409；坏维度 → 400', async () => {
  const raw = await api('POST', '/api/assets', { kind: 'master', filename: 'p-unparsed.mp4', duration_ms: 8000 });
  const r409 = await api('POST', '/api/preview', { master_asset_id: raw.data.asset.id });
  assert.equal(r409.status, 409);

  const id = await registerParsedMaster('p-baddim.mp4');
  const r400 = await api('POST', '/api/preview', {
    master_asset_id: id,
    dimensions: [{ key: 'visual', label: '视觉', enabled: true, options: [{ id: 'x', label: '唯一选项' }], locked: [] }],
  });
  assert.equal(r400.status, 400);
  assert.match(r400.data.error, /at least 2 options/);
});

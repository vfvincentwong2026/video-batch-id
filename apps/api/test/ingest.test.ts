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

const DIR = 'D:/桌面工作/AI project/Video Batch ID/Master Asset';

test('scan-dir：批量登记 12 条真实素材（元数据真实、幂等去重）', async () => {
  const r = await api('POST', '/api/assets/scan-dir', { dir: DIR });
  assert.equal(r.status, 201);
  assert.equal(r.data.count, 12);
  assert.equal(r.data.skipped.length, 0);
  for (const a of r.data.registered) {
    const probe = JSON.parse(a.meta_json).probe;
    assert.ok(probe.durationMs > 10000, `${a.filename} 时长应 >10s`);
    assert.equal(probe.width >= 720, true);
    assert.equal(probe.hasAudio, true);
    assert.ok(a.file_path.endsWith(a.filename));
    assert.equal(a.duration_ms, probe.durationMs);
  }
  // 幂等：重扫全部跳过
  const again = await api('POST', '/api/assets/scan-dir', { dir: DIR });
  assert.equal(again.data.count, 0);
  assert.equal(again.data.skipped.length, 12);
});

test('scan-dir：非法目录 400；缺 ffmpeg 时 500（无法稳定模拟，仅测 400）', async () => {
  const bad = await api('POST', '/api/assets/scan-dir', { dir: 'D:/no-such-dir-xyz' });
  assert.equal(bad.status, 400);
  const noDir = await api('POST', '/api/assets/scan-dir', {});
  assert.equal(noDir.status, 400);
});

test('真实解析：shotcut 镜头表 + 关键帧产出 + /derived 可访问', async () => {
  const list = await api('GET', '/api/assets?kind=master');
  const target = list.data.assets.find((a: { filename: string }) => a.filename.includes('edit 11'));
  assert.ok(target, '需要 scan-dir 已登记');

  const parsed = await api('POST', `/api/assets/${target.id}/parse`, {});
  assert.equal(parsed.status, 200);
  assert.equal(parsed.data.parsed.parser, 'ffmpeg-shotcut');
  assert.ok(parsed.data.parsed.shots.length >= 1);
  assert.ok(parsed.data.thumbs >= 1, '应产出关键帧');
  assert.deepEqual(parsed.data.parsed.enrichment.real, ['shotcut', 'rhythm', 'probe']);

  // 缩略图 URL 可访问
  const m = parsed.data.parsed.shots[0].description.match(/\[thumb=(\/derived\/[^\]]+)\]/);
  assert.ok(m, '首镜头应有 thumb 标记');
  const img = await fetch(base + m[1]);
  assert.equal(img.status, 200);
  assert.match(img.headers.get('content-type') ?? '', /image\/jpeg/);
  const buf = await img.arrayBuffer();
  assert.ok(buf.byteLength > 10_000);

  // 目录穿越防护
  const evil = await fetch(base + '/derived/..%2f..%2fpackage.json');
  assert.ok([403, 404].includes(evil.status));
});

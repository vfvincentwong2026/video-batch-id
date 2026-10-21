import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VlmApiParserProvider, getParser } from '../src/index.ts';

/** 假 media 实现：2 个镜头 + 写假 jpg */
const fakeMedia = {
  probe: async () => ({ durationMs: 10000, hasAudio: true }),
  detectShots: async () => [{ startMs: 0, endMs: 4000 }, { startMs: 4000, endMs: 10000 }],
  extractKeyframe: async (_p: string, _t: number, out: string) => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(out, Buffer.from('fake-jpeg-bytes'));
    return out;
  },
};

const FAKE_VLM_JSON = {
  shots: [
    { index: 1, description: '红色包装糖果倒入玻璃碗，酱汁飞溅特写', scene: '厨房' },
    { index: 2, description: '手持产品展示，背景为便利店货架', scene: '便利店' },
  ],
  hooks: [{ phrase: 'Permen paling laris!', kind: 'verbal' }, { phrase: '开盖爆汁特写', kind: 'visual' }],
  transcript: 'Permen paling laris, cobain sekarang!',
  bgm: { style: '流行电子', bpm: 128 },
};

function fakeFetch(payload: unknown, status = 200) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fn, calls };
}

test('vlm-api：已注册到 provider 注册表', () => {
  assert.equal(getParser('vlm-api').name, 'vlm-api');
});

test('vlm-api：未配置 key → 明确报错', async () => {
  const p = new VlmApiParserProvider({ apiKey: '', mediaImpl: fakeMedia });
  await assert.rejects(
    () => p.parse({ assetId: 'm1', filename: 'm.mp4', durationMs: 10000, filePath: '/tmp/m.mp4' }),
    /VBID_VLM_API_KEY not set/,
  );
});

test('vlm-api：VLM 语义合并进解析产物（镜头描述/Hook/转录/BGM），enrichment 点亮', async () => {
  const { fn, calls } = fakeFetch({ choices: [{ message: { content: JSON.stringify(FAKE_VLM_JSON) } }] });
  const p = new VlmApiParserProvider({ apiKey: 'sk-test', fetchFn: fn, mediaImpl: fakeMedia });
  const r = await p.parse({ assetId: 'm1', filename: 'm.mp4', durationMs: 10000, filePath: '/tmp/m.mp4' });

  // 请求形状：OpenAI 兼容 chat/completions + 图片帧
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal((calls[0].body as { model: string }).model, 'gpt-4o-mini');
  const content = (calls[0].body as { messages: Array<{ content?: unknown }> }).messages[1].content as Array<{ type: string }>;
  assert.equal(content.filter((c) => c.type === 'image_url').length, 2);

  // 语义合并
  assert.match(r.shots[0].description, /糖果倒入玻璃碗/);
  assert.match(r.shots[1].description, /便利店货架/);
  assert.equal(r.shots[0].type, 'hook');
  assert.equal(r.shots[1].type, 'cta');
  assert.equal(r.hooks.length, 2);
  assert.equal(r.hooks[0].kind, 'verbal');
  assert.match(r.transcript, /Permen paling laris/);
  assert.equal(r.bgm.style, '视觉推断：流行电子');
  assert.equal(r.bgm.bpm, 128);
  // enrichment：VLM 点亮的维度进 real，不再 pending
  for (const k of ['shotcut', 'rhythm', 'probe', 'vlm-scene', 'vlm-copy', 'vlm-transcript', 'vlm-bgm']) {
    assert.ok(r.enrichment.real.includes(k), `real should include ${k}`);
  }
  assert.deepEqual(r.enrichment.pending, []);
  assert.equal(r.parser, 'vlm-api');
  // 节奏统计仍来自真实镜头边界
  assert.equal(r.rhythm.shotCount, 2);
  assert.equal(r.rhythm.avgShotSec, 5);
});

test('vlm-api：VLM 返回空/坏 JSON → 回退结构描述且诚实标注 pending', async () => {
  const { fn } = fakeFetch({ choices: [{ message: { content: '```json\n{not valid\n```' } }] });
  const p = new VlmApiParserProvider({ apiKey: 'sk-test', fetchFn: fn, mediaImpl: fakeMedia });
  const r = await p.parse({ assetId: 'm1', filename: 'm.mp4', durationMs: 10000, filePath: '/tmp/m.mp4' });
  assert.match(r.shots[0].description, /场景切换切出/);
  assert.ok(r.enrichment.pending.includes('transcript'));
  assert.ok(r.enrichment.pending.includes('bgm'));
  assert.ok(!r.enrichment.real.includes('vlm-transcript'));
});

test('vlm-api：API 错误 → 抛出带状态码的错误', async () => {
  const { fn } = fakeFetch({ error: 'invalid key' }, 401);
  const p = new VlmApiParserProvider({ apiKey: 'sk-bad', fetchFn: fn, mediaImpl: fakeMedia });
  await assert.rejects(
    () => p.parse({ assetId: 'm1', filename: 'm.mp4', durationMs: 10000, filePath: '/tmp/m.mp4' }),
    /vlm-api 401/,
  );
});

test('vlm-api：自定义 baseUrl / model 生效', async () => {
  const { fn, calls } = fakeFetch({ choices: [{ message: { content: '{}' } }] });
  const p = new VlmApiParserProvider({
    apiKey: 'sk-test', baseUrl: 'https://relay.example.com/v1/', model: 'gpt-4o',
    fetchFn: fn, mediaImpl: fakeMedia,
  });
  await p.parse({ assetId: 'm1', filename: 'm.mp4', durationMs: 10000, filePath: '/tmp/m.mp4' });
  assert.equal(calls[0].url, 'https://relay.example.com/v1/chat/completions'); // 尾部斜杠归一
  assert.equal((calls[0].body as { model: string }).model, 'gpt-4o');
});

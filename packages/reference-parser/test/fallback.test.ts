import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VlmApiParserProvider } from '../src/index.ts';

const fakeMedia = {
  probe: async () => ({ durationMs: 8000, hasAudio: true }),
  detectShots: async () => [{ startMs: 0, endMs: 4000 }, { startMs: 4000, endMs: 8000 }],
  extractKeyframe: async (_p: string, _t: number, out: string) => {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(out, Buffer.from('fake'));
    return out;
  },
};

const OK = { choices: [{ message: { content: '{"shots":[{"index":1,"description":"d"}],"hooks":[],"transcript":"","bgm":{"style":"x","bpm":null}}' } }] };

test('回退链：第一个模型 429 → 自动换第二个并成功', async () => {
  const used: string[] = [];
  const fn = (async (_url: string | URL, init?: RequestInit) => {
    const model = (JSON.parse(String(init?.body)) as { model: string }).model;
    used.push(model);
    if (model === 'model-a') return new Response('{"error":"rate limited"}', { status: 429 });
    return new Response(JSON.stringify(OK), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const p = new VlmApiParserProvider({ apiKey: 'k', model: 'model-a, model-b', fetchFn: fn, mediaImpl: fakeMedia });
  const r = await p.parse({ assetId: 'a', filename: 'm.mp4', durationMs: 8000, filePath: '/tmp/m.mp4' });
  assert.deepEqual(used, ['model-a', 'model-b']); //  trim 生效
  assert.match(r.shots[0].description, /^d$/);
});

test('回退链：全部失败 → 抛最后一个错误', async () => {
  const fn = (async () => new Response('{"error":"no credits"}', { status: 402 })) as typeof fetch;
  const p = new VlmApiParserProvider({ apiKey: 'k', model: 'm1,m2', fetchFn: fn, mediaImpl: fakeMedia });
  await assert.rejects(
    () => p.parse({ assetId: 'a', filename: 'm.mp4', durationMs: 8000, filePath: '/tmp/m.mp4' }),
    /vlm-api 402/,
  );
});

test('回退链：单模型字符串照常工作（无逗号）', async () => {
  const fn = (async (_u: string | URL, init?: RequestInit) => {
    assert.equal((JSON.parse(String(init?.body)) as { model: string }).model, 'only');
    return new Response(JSON.stringify(OK), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const p = new VlmApiParserProvider({ apiKey: 'k', model: 'only', fetchFn: fn, mediaImpl: fakeMedia });
  const r = await p.parse({ assetId: 'a', filename: 'm.mp4', durationMs: 8000, filePath: '/tmp/m.mp4' });
  assert.ok(r.shots.length > 0);
});

test('回退链：前一个模型 200 但返回空 JSON → 换下一个', async () => {
  const used: string[] = [];
  const fn = (async (_url: string | URL, init?: RequestInit) => {
    const model = (JSON.parse(String(init?.body)) as { model: string }).model;
    used.push(model);
    if (model === 'empty-guy') {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'sorry, cannot' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(OK), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const p = new VlmApiParserProvider({ apiKey: 'k', model: 'empty-guy,good-guy', fetchFn: fn, mediaImpl: fakeMedia });
  const r = await p.parse({ assetId: 'a', filename: 'm.mp4', durationMs: 8000, filePath: '/tmp/m.mp4' });
  assert.deepEqual(used, ['empty-guy', 'good-guy']);
  assert.match(r.shots[0].description, /^d$/);
});

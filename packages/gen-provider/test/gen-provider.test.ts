import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenRouterVideoProvider, buildGenPrompt, checkOpenRouterKeyBudget } from '../src/index.ts';
import type { GenerateInput } from '@vbid/pipeline';

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 32]), Buffer.from('ftypisom'), Buffer.alloc(128)]);

function makeInput(overrides: Partial<GenerateInput> = {}): GenerateInput {
  return {
    taskId: 'wf_mas_test',
    variant: { id: 'V01', assignments: { visual: 'scene-kitchen', copy: 'hook-1' } } as GenerateInput['variant'],
    master: { assetId: 'mas_test', filename: 'sambal-hit.mp4' },
    masterFilePath: 'D:\\fake\\sambal-hit.mp4',
    parsed: {
      assetId: 'mas_test',
      durationMs: 11000,
      shots: [
        { index: 1, startMs: 0, endMs: 3000, type: 'hook', description: '酱汁倾倒特写' },
        { index: 2, startMs: 3000, endMs: 11000, type: 'cta', description: '试吃+CTA' },
      ],
      hooks: [{ phrase: '倾倒特写开屏', kind: 'visual' }],
      transcript: 'Sambal Matah segar, pedasnya nampol!',
      bgm: { style: '轻快印尼民谣', bpm: 120 },
      rhythm: { shotCount: 2, avgShotSec: 5.5 },
      parser: 'mock',
      enrichment: { real: [], pending: [] },
    },
    matrix: {
      dimensions: [
        { key: 'visual', label: '视觉', enabled: true, options: [{ id: 'scene-kitchen', label: '厨房台面' }], locked: [] },
        { key: 'copy', label: '文案', enabled: true, options: [{ id: 'hook-1', label: 'Hook=倾倒' }], locked: [] },
      ],
    } as unknown as GenerateInput['matrix'],
    ...overrides,
  };
}

const fakeMedia = {
  probe: async () => ({ durationMs: 11000, width: 1080, height: 1920 }),
  extractKeyframe: async (_p: string, _t: number, outPath: string) => {
    await writeFile(outPath, Buffer.from('fake-jpeg-bytes'));
    return outPath;
  },
};

/** 造一个按 URL 路由的假 fetch：submit→202，poll→两次后 completed，content→MP4 */
function fakeFetch(opts: { portrait?: boolean; failJob?: boolean; calls: Array<{ url: string; body?: unknown }> }) {
  let polls = 0;
  return async (url: string, init?: RequestInit): Promise<Response> => {
    opts.calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/videos') && init?.method === 'POST') {
      return new Response(JSON.stringify({ id: 'job1', polling_url: 'https://openrouter.ai/api/v1/videos/job1', status: 'pending' }), { status: 202 });
    }
    if (url.includes('/videos/job1') && !url.includes('content')) {
      polls++;
      if (opts.failJob) {
        return new Response(JSON.stringify({ id: 'job1', status: 'failed', error: 'Content policy violation' }), { status: 200 });
      }
      if (polls < 2) return new Response(JSON.stringify({ id: 'job1', status: 'in_progress' }), { status: 200 });
      return new Response(JSON.stringify({
        id: 'job1', status: 'completed',
        unsigned_urls: ['https://openrouter.ai/api/v1/videos/job1/content?index=0'],
        usage: { cost: 0.5 },
      }), { status: 200 });
    }
    if (url.includes('content')) {
      return new Response(MP4 as unknown as BodyInit, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  };
}

test('端到端：提交 I2V 作业 → 轮询 → 下载落盘，产出 fileRef/用量/指纹', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'vbid-gen-test-'));
  const calls: Array<{ url: string; body?: unknown }> = [];
  try {
    const p = new OpenRouterVideoProvider({
      apiKey: 'sk-test', baseUrl: 'https://openrouter.ai/api/v1',
      pollIntervalMs: 1, outDir, fileRefPrefix: '/derived/mas_test/variants',
      fetchFn: fakeFetch({ calls }) as unknown as typeof fetch,
      mediaImpl: fakeMedia,
    });
    const out = await p.generate(makeInput());

    // 提交体：I2V 首帧锚定 + 竖屏 + 时长/分辨率
    const submit = calls.find((c) => c.url.endsWith('/videos'))!.body as Record<string, unknown>;
    assert.equal(submit.model, 'alibaba/wan-2.7');
    assert.equal(submit.duration, 5);
    assert.equal(submit.resolution, '720p');
    assert.equal(submit.aspect_ratio, '9:16');
    const frames = submit.frame_images as Array<{ frame_type: string; image_url: { url: string } }>;
    assert.equal(frames[0].frame_type, 'first_frame');
    assert.ok(frames[0].image_url.url.startsWith('data:image/jpeg;base64,'));
    assert.match(String(submit.prompt), /厨房台面/);
    assert.match(String(submit.prompt), /Sambal Matah segar/);

    // 产出：落盘 mp4 + fileRef + 用量 + 作业 ID
    assert.equal(out.generator, 'openrouter');
    assert.equal(out.fileRef, '/derived/mas_test/variants/V01.mp4');
    assert.equal(out.usageCostUsd, 0.5);
    assert.equal(out.jobId, 'job1');
    const saved = await readFile(join(outDir, 'V01.mp4'));
    assert.equal(saved.toString('latin1', 4, 8), 'ftyp');
    // 指纹保持 JSON 键值对数组（启发式去重守卫兼容）
    const fp = JSON.parse(out.fingerprint) as Array<[string, unknown]>;
    assert.deepEqual(Object.fromEntries(fp).visual, 'scene-kitchen');
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('横屏 Master 自动推断 16:9', async () => {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const p = new OpenRouterVideoProvider({
    apiKey: 'sk-test', pollIntervalMs: 1,
    fetchFn: fakeFetch({ calls }) as unknown as typeof fetch,
    mediaImpl: { ...fakeMedia, probe: async () => ({ durationMs: 11000, width: 1920, height: 1080 }) },
  });
  await p.generate(makeInput());
  const submit = calls.find((c) => c.url.endsWith('/videos'))!.body as Record<string, unknown>;
  assert.equal(submit.aspect_ratio, '16:9');
});

test('作业 failed → 抛出含供应商 error 的异常', async () => {
  const p = new OpenRouterVideoProvider({
    apiKey: 'sk-test', pollIntervalMs: 1,
    fetchFn: fakeFetch({ failJob: true, calls: [] }) as unknown as typeof fetch,
    mediaImpl: fakeMedia,
  });
  await assert.rejects(() => p.generate(makeInput()), /failed.*Content policy violation/);
});

test('未配置 key / Master 无真实文件 → 明确报错', async () => {
  const p = new OpenRouterVideoProvider({ apiKey: '', mediaImpl: fakeMedia });
  await assert.rejects(() => p.generate(makeInput()), /VBID_GEN_API_KEY/);
  const p2 = new OpenRouterVideoProvider({ apiKey: 'sk-test', mediaImpl: fakeMedia });
  await assert.rejects(() => p2.generate(makeInput({ masterFilePath: undefined })), /masterFilePath/);});

test('buildGenPrompt：变量取值 + Hook + 转录 + 首帧锚定说明齐全', () => {
  const prompt = buildGenPrompt(makeInput());
  assert.match(prompt, /厨房台面/);
  assert.match(prompt, /Hook=倾倒/);
  assert.match(prompt, /倾倒特写开屏/);
  assert.match(prompt, /Sambal Matah segar/);
  assert.match(prompt, /first frame is provided/);
});

test('checkOpenRouterKeyBudget：解析 budgets 余量与重置时间', async () => {
  const fake = async () => new Response(JSON.stringify({
    data: { limit: 1, usage: 1.11, budgets: [{ limit_usd: 1, spend_usd: 1.11, remaining_usd: -0.11, resets_at: '2026-11-01T00:00:00.000Z' }] },
  }), { status: 200 });
  const b = await checkOpenRouterKeyBudget({ apiKey: 'sk-test', baseUrl: 'https://openrouter.ai/api/v1' }, fake as unknown as typeof fetch);
  assert.equal(b!.limitUsd, 1);
  assert.equal(b!.remainingUsd, -0.11);
  assert.equal(b!.resetsAt, '2026-11-01T00:00:00.000Z');
});

test('checkOpenRouterKeyBudget：未配置 key / 查询失败 → null（软失败）', async () => {
  assert.equal(await checkOpenRouterKeyBudget({ apiKey: '' }), null);
  const failing = async () => new Response('oops', { status: 500 });
  assert.equal(await checkOpenRouterKeyBudget({ apiKey: 'sk-test' }, failing as unknown as typeof fetch), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getParser,
  registerParser,
  MockParserProvider,
  deriveMatrixHints,
  type ParserProvider,
  type ParsedReference,
} from '../src/index.ts';
import { createMatrix, combinationSpace, validateMatrix } from '@vbid/variable-matrix';

test('mock 解析：确定性输出，4 镜头覆盖完整时长', async () => {
  const p = getParser('mock');
  const a = await p.parse({ assetId: 'mas_x', filename: 'm.mp4', durationMs: 11000 });
  const b = await p.parse({ assetId: 'mas_x', filename: 'm.mp4', durationMs: 11000 });
  assert.deepEqual(a, b);

  assert.equal(a.shots.length, 4);
  assert.equal(a.shots[0].startMs, 0);
  assert.equal(a.shots[3].endMs, 11000);
  // 镜头不重叠、连续
  for (let i = 1; i < a.shots.length; i++) {
    assert.equal(a.shots[i].startMs, a.shots[i - 1].endMs);
  }
  assert.equal(a.shots[0].type, 'hook');
  assert.equal(a.bgm.bpm, 120);
  assert.match(a.transcript, /Sambal Matah/);
  assert.equal(a.parser, 'mock');
});

test('mock 解析：时长等比缩放（22000ms → avgShotSec 翻倍）', async () => {
  const p = getParser('mock');
  const short = await p.parse({ assetId: 'a', filename: 's.mp4', durationMs: 11000 });
  const long = await p.parse({ assetId: 'a', filename: 's.mp4', durationMs: 22000 });
  // 2.75s→2.8s 有四舍五入，用容差比较
  assert.ok(Math.abs(long.rhythm.avgShotSec - short.rhythm.avgShotSec * 2) <= 0.2);
});

test('非法时长 → 抛错', async () => {
  const p = getParser('mock');
  await assert.rejects(() => p.parse({ assetId: 'a', filename: 'x.mp4', durationMs: 0 }), /positive/);
});

test('provider 注册表：未知名抛错；自定义 provider 可注册', async () => {
  assert.throws(() => getParser('nope'), /unknown parser/);
  const custom: ParserProvider = {
    name: 'fake-qwen',
    async parse(input): Promise<ParsedReference> {
      return {
        assetId: input.assetId, durationMs: input.durationMs,
        shots: [], hooks: [], transcript: '', bgm: { style: '', bpm: null },
        rhythm: { shotCount: 0, avgShotSec: 0 }, parser: 'fake-qwen',
      };
    },
  };
  registerParser(custom);
  assert.equal(getParser('fake-qwen').name, 'fake-qwen');
});

test('deriveMatrixHints：产出能通过矩阵校验的选项（≥2 个 Hook）', async () => {
  const parsed = await new MockParserProvider().parse({ assetId: 'a', filename: 'm.mp4', durationMs: 11000 });
  const hints = deriveMatrixHints(parsed);
  assert.ok(hints.visualOptions.length >= 2);
  assert.ok(hints.copyOptions.length >= 2);

  const { defaultDimensions } = await import('@vbid/variable-matrix');
  const dims = defaultDimensions();
  dims[0].options = hints.visualOptions;
  dims[1].options = hints.copyOptions;
  const m = createMatrix(dims);
  assert.doesNotThrow(() => validateMatrix(m));
  assert.ok(combinationSpace(m) >= 4);
});

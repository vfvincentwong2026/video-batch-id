import { test } from 'node:test';
import assert from 'node:assert/strict';

import { suggestDimensions, buildPreview, createMatrix } from '../src/index.ts';

/** 模拟真实 shotcut 解析产物：8 镜头 · 高密度 · 有音轨 */
const REAL_PARSE = {
  shots: Array.from({ length: 8 }, (_, i) => ({
    index: i + 1, startMs: i * 2000, endMs: (i + 1) * 2000, type: i === 0 ? 'hook' : 'action',
  })),
  hooks: [{ phrase: '首帧开屏（镜头1 · 2s）', kind: 'visual' }],
  bgm: { style: '有音轨（BPM 分析待接入）', bpm: null },
  rhythm: { shotCount: 8, avgShotSec: 2.0 },
  transcript: '',
  parser: 'ffmpeg-shotcut',
};

/** 模拟 mock 解析：4 镜头 · 疏节奏 */
const MOCK_PARSE = {
  shots: Array.from({ length: 4 }, (_, i) => ({
    index: i + 1, startMs: i * 3000, endMs: (i + 1) * 3000, type: i === 0 ? 'hook' : 'action',
  })),
  hooks: [{ phrase: '倾倒特写开屏', kind: 'visual' }],
  bgm: { style: '轻快印尼民谣', bpm: 120 },
  rhythm: { shotCount: 4, avgShotSec: 3.0 },
  transcript: 'x',
  parser: 'mock',
};

test('suggestDimensions：真实高密度素材 → 节奏/音频/技术自动启用，人物保持锁定', () => {
  const s = suggestDimensions(REAL_PARSE);
  assert.equal(s.engine, 'rule-v1');
  const byKey = Object.fromEntries(s.dimensions.map((d) => [d.key, d]));
  assert.equal(byKey.visual.enabled, true);
  assert.equal(byKey.visual.options.length, 6); // 8 镜头 → 场景选项拉满 6
  assert.equal(byKey.copy.enabled, true);
  assert.match(byKey.copy.options[0].label, /Hook=首帧开屏/); // 真实 Hook 优先
  assert.equal(byKey.rhythm.enabled, true); // avgShotSec 2.0 ≤ 2.5
  assert.equal(byKey.audio.enabled, true); // 有音轨
  assert.equal(byKey.technical.enabled, true); // 真实 shotcut 解析
  assert.equal(byKey.person.enabled, false); // 无人物信号，诚实锁定
  // 每个维度都有推荐理由
  assert.equal(s.reasons.length, 6);
  for (const r of s.reasons) assert.ok(r.reason.length > 5 && r.confidence);
});

test('suggestDimensions：mock 疏节奏素材 → 节奏/技术保持锁定', () => {
  const s = suggestDimensions(MOCK_PARSE);
  const byKey = Object.fromEntries(s.dimensions.map((d) => [d.key, d]));
  assert.equal(byKey.rhythm.enabled, false); // 3.0s/镜 > 2.5
  assert.equal(byKey.technical.enabled, false); // mock 无真实分辨率
  assert.equal(byKey.audio.enabled, true);
  assert.equal(byKey.visual.options.length, 4);
});

test('suggestDimensions：无声素材 → 音频锁定且理由明确', () => {
  const s = suggestDimensions({ ...REAL_PARSE, bgm: { style: '无声', bpm: null } });
  const audio = s.dimensions.find((d) => d.key === 'audio')!;
  assert.equal(audio.enabled, false);
  assert.match(s.reasons.find((r) => r.key === 'audio')!.reason, /无声/);
});

test('buildPreview：每个启用选项一条 entry，含效果文案与镜头映射', () => {
  const s = suggestDimensions(REAL_PARSE);
  const p = buildPreview(createMatrix(s.dimensions), REAL_PARSE);
  const enabledOpts = s.dimensions.filter((d) => d.enabled).reduce((n, d) => n + d.options.length, 0);
  assert.equal(p.entries.length, enabledOpts);
  for (const e of p.entries) {
    assert.ok(e.effect.length > 10);
    assert.ok(e.affectedShots.length > 0);
    assert.ok(['high', 'medium', 'low'].includes(e.confidence));
  }
  // 视觉 6 个选项 → 映射到镜头 1..6 round-robin
  const visual = p.entries.filter((e) => e.dimensionKey === 'visual');
  assert.deepEqual(visual.map((e) => e.affectedShots[0]), [1, 2, 3, 4, 5, 6]);
});

test('buildPreview：关键帧 thumb 按镜头号关联', () => {
  const s = suggestDimensions(REAL_PARSE);
  const thumbs = [{ index: 2, startMs: 2000, endMs: 4000, thumb: '/derived/x/shot-2.jpg' }];
  const p = buildPreview(createMatrix(s.dimensions), REAL_PARSE, { thumbs });
  const hit = p.entries.find((e) => e.dimensionKey === 'visual' && e.affectedShots[0] === 2);
  assert.equal(hit?.thumb, '/derived/x/shot-2.jpg');
});

test('buildPreview：附 3 条样例变体组合，组合数等于组合空间上限', () => {
  const s = suggestDimensions(REAL_PARSE);
  const p = buildPreview(createMatrix(s.dimensions), REAL_PARSE, { sampleCount: 3 });
  assert.equal(p.samples.length, 3);
  for (const sm of p.samples) {
    assert.ok(sm.combo.length > 0);
    for (const c of sm.combo) { assert.ok(c.dimension && c.value); }
  }
  assert.equal(p.space, 6 * 2 * 3 * 3 * 2); // visual6 × copy2 × rhythm3 × audio3 × technical2
});

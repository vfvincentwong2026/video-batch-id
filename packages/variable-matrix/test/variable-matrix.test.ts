import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createMatrix,
  defaultDimensions,
  validateMatrix,
  enabledDimensions,
  combinationSpace,
  enumerateAll,
  sampleVariants,
  diversityDistance,
  estimateCost,
} from '../src/index.ts';

test('默认矩阵：视觉+文案启用，其余四维预置但锁定', () => {
  const m = createMatrix();
  const enabled = enabledDimensions(m).map((d) => d.key);
  assert.deepEqual(enabled.sort(), ['copy', 'visual']);
  // 每维都有「必须保持不变」的核心项
  for (const d of m.dimensions) {
    assert.ok(d.locked.length > 0 || d.key === 'technical');
  }
});

test('组合空间 = 启用维度选项数乘积（README 案例结构：4×4=16）', () => {
  const m = createMatrix();
  assert.equal(combinationSpace(m), 16);
});

test('启用维度选项不足 2 个 → 校验报错', () => {
  const dims = defaultDimensions();
  dims[0].options = dims[0].options.slice(0, 1); // visual 只留 1 个选项
  assert.throws(() => validateMatrix({ dimensions: dims }), /at least 2 options/);
});

test('重复选项 id → 校验报错', () => {
  const dims = defaultDimensions();
  dims[1].options.push({ id: 'hook-pour', label: '重复' });
  assert.throws(() => validateMatrix({ dimensions: dims }), /duplicate option id/);
});

test('enumerateAll：全量枚举且 id 连续（视觉+文案 16 条）', () => {
  const m = createMatrix();
  const all = enumerateAll(m);
  assert.equal(all.length, 16);
  assert.equal(all[0].id, 'V01');
  assert.equal(all[15].id, 'V16');
  // 每条都是合法组合：取值来自对应维度选项
  const visual = m.dimensions.find((d) => d.key === 'visual')!;
  const copy = m.dimensions.find((d) => d.key === 'copy')!;
  for (const v of all) {
    assert.ok(visual.options.some((o) => o.id === v.assignments.visual));
    assert.ok(copy.options.some((o) => o.id === v.assignments.copy));
  }
});

test('启用全部六维时空间 = 4×4×3×2×3×2 = 576', () => {
  const m = createMatrix(defaultDimensions().map((d) => ({ ...d, enabled: true })));
  assert.equal(combinationSpace(m), 576);
});

test('sampleVariants：数量不足空间时贪心采样，无重复', () => {
  const m = createMatrix();
  const vs = sampleVariants(m, 10, 7);
  assert.equal(vs.length, 10);
  const keys = ['visual', 'copy'];
  const seen = new Set(vs.map((v) => keys.map((k) => v.assignments[k]).join('|')));
  assert.equal(seen.size, 10, '采样结果不应有重复组合');
});

test('sampleVariants：同 seed 可复现，不同 seed 结果可不同', () => {
  const m = createMatrix();
  const a1 = sampleVariants(m, 8, 42);
  const a2 = sampleVariants(m, 8, 42);
  const b = sampleVariants(m, 8, 43);
  assert.deepEqual(a1, a2);
  assert.notDeepEqual(a1.map((v) => v.assignments), b.map((v) => v.assignments));
});

test('sampleVariants：count >= 空间时返回全量', () => {
  const m = createMatrix();
  assert.equal(sampleVariants(m, 16, 1).length, 16);
  assert.equal(sampleVariants(m, 999, 1).length, 16);
});

test('sampleVariants：count<=0 或无启用维度时返回空', () => {
  const m = createMatrix();
  assert.deepEqual(sampleVariants(m, 0), []);
  const locked = createMatrix(defaultDimensions().map((d) => ({ ...d, enabled: false })));
  assert.deepEqual(sampleVariants(locked, 5), []);
});

test('最大差异度：贪心采样的最小两两差异应高于均匀取基准（防「变体撞车」）', () => {
  // farthest-point 的目标是最小两两距离最大化（任何两条变体都足够不同），
  // 而非全集平均距离最大化 —— 后者均匀取基准反而占优，不是本策略目标。
  const m = createMatrix(defaultDimensions().map((d) => ({ ...d, enabled: true })));
  const keys = enabledDimensions(m).map((d) => d.key);
  const greedy = sampleVariants(m, 30, 42);

  function minPairDist(set: typeof greedy): number {
    let min = Infinity;
    for (let i = 0; i < set.length; i++) {
      for (let j = i + 1; j < set.length; j++) {
        min = Math.min(min, diversityDistance(set[i], set[j], keys));
      }
    }
    return min;
  }
  // 均匀取基准：每 19 条取 1 条
  const uniform = enumerateAll(m).filter((_, i) => i % 19 === 0).slice(0, 30);
  assert.ok(
    minPairDist(greedy) >= minPairDist(uniform),
    `greedy min pair distance (${minPairDist(greedy)}) should >= uniform (${minPairDist(uniform)})`,
  );
  // 且任意变体的最近邻距离有下界保证（farthest-point 性质）
  const gMin = minPairDist(greedy);
  assert.ok(gMin >= 2, `expected min pair distance >= 2, got ${gMin}`);
});

test('estimateCost：30 条 × $0.15 = $4.50（README 案例口径）', () => {
  const est = estimateCost(30, 0.15);
  assert.equal(est.estimatedCostUsd, 4.5);
  assert.equal(est.currency, 'USD');
  assert.throws(() => estimateCost(-1), />= 0/);
});

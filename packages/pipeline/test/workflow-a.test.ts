import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runWorkflowA,
  getGenerator,
  registerGenerator,
  MockGeneratorProvider,
  HeuristicFidelityGuard,
  HeuristicDedupGuard,
  FIDELITY_THRESHOLD,
} from '../src/index.ts';
import type { WorkflowAVariant } from '../src/index.ts';

const MASTER = { masterAssetId: 'mas_demo', masterFilename: 'sambal-hit.mp4', durationMs: 11000 };

test('工作流 A 端到端（mock）：解析 → 采样 → 生成 → 双守卫 → 成本', async () => {
  const result = await runWorkflowA({ ...MASTER, variantCount: 8, seed: 42 });
  assert.equal(result.variants.length, 8);
  assert.equal(result.acceptedCount + result.rejectedCount, 8);
  // 成本口径与 README 一致
  assert.equal(result.cost.estimatedCostUsd, 1.2);
  // 解析、矩阵、采样可追溯
  assert.equal(result.parsed.parser, 'mock');
  assert.equal(result.parsed.shots.length, 4);
  assert.ok(result.matrix.dimensions.filter((d) => d.enabled).length >= 2);
  // 每条变体：id 连续、描述包含场景/Hook、守卫有分
  result.variants.forEach((v, i) => {
    assert.equal(v.spec.id, `V${String(i + 1).padStart(2, '0')}`);
    assert.match(v.generated.descriptor, /二创变体/);
    assert.match(v.generated.fileRef, /^mock:\/\//);
    assert.ok(v.fidelity.score >= FIDELITY_THRESHOLD, `variant ${v.spec.id} fidelity ${v.fidelity.score}`);
  });
});

test('确定性：同 seed 两次运行结果一致（成本/谱系可复现）', async () => {
  const a = await runWorkflowA({ ...MASTER, variantCount: 8, seed: 7 });
  const b = await runWorkflowA({ ...MASTER, variantCount: 8, seed: 7 });
  assert.deepEqual(
    a.variants.map((v) => [v.spec.assignments, v.generated.fileRef, v.accepted]),
    b.variants.map((v) => [v.spec.assignments, v.generated.fileRef, v.accepted]),
  );
});

test('onVariant 挂钩逐条回调（谱系入库通道）', async () => {
  const seen: WorkflowAVariant[] = [];
  await runWorkflowA({ ...MASTER, variantCount: 5, seed: 1 }, {
    onVariant: (v, i) => { assert.equal(i, seen.length); seen.push(v); },
  });
  assert.equal(seen.length, 5);
});

test('自定义维度覆盖生效（运营勾选结果直通）', async () => {
  const { defaultDimensions } = await import('@vbid/variable-matrix');
  const dims = defaultDimensions().map((d) => ({ ...d, enabled: true }));
  const result = await runWorkflowA({ ...MASTER, variantCount: 6, seed: 3, dimensions: dims });
  assert.equal(result.matrix.dimensions.filter((d) => d.enabled).length, 6);
  // 六维全开时，描述应覆盖全部 6 个启用维度前缀（注意选项标签本身含 "="，不能裸数）
  for (const v of result.variants) {
    const dimsCovered = new Set(
      [...v.generated.descriptor.matchAll(/(视觉|人物|文案|节奏|音频|技术)=/g)].map((m) => m[1]),
    );
    assert.equal(dimsCovered.size, 6);
  }
});

test('generator 注册表：未知名抛错，可注册自定义', () => {
  assert.throws(() => getGenerator('comfyui-wan22'), /unknown generator/);
  registerGenerator(new MockGeneratorProvider());
  assert.equal(getGenerator('mock').name, 'mock');
});

test('启发式去重守卫：无前驱时必通过；分數越界拦截', async () => {
  const guard = new HeuristicDedupGuard();
  const base = {
    taskId: 't', variant: { id: 'V01', assignments: { visual: 'a' } },
    master: { assetId: 'm', filename: 'm.mp4' },
    parsed: { assetId: 'm', durationMs: 1000, shots: [], hooks: [], transcript: '', bgm: { style: '', bpm: null }, rhythm: { shotCount: 0, avgShotSec: 0 }, parser: 'mock' },
    matrix: { dimensions: [{ key: 'visual', label: '视觉', enabled: true, options: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }], locked: [] }] },
  };
  const noPred = await guard.check(base, { fileRef: 'mock://x', descriptor: '', generator: 'mock' }, []);
  assert.equal(noPred.passed, true);

  // 相同 fileRef 的前驱 → 相似度 1.0 → 拦截
  const cloned = await guard.check(base, { fileRef: 'mock://x', descriptor: '', generator: 'mock' }, [
    { fileRef: 'mock://x', descriptor: '', generator: 'mock' },
  ]);
  assert.equal(cloned.passed, false);
  assert.equal(cloned.score, 1);
});

test('启发式保真守卫：锁定核心越多分越高，阈值 0.92', async () => {
  const guard = new HeuristicFidelityGuard();
  const mk = (locked: string[]) => ({
    taskId: 't', variant: { id: 'V01', assignments: {} },
    master: { assetId: 'm', filename: 'm.mp4' },
    parsed: { assetId: 'm', durationMs: 1000, shots: [], hooks: [], transcript: '', bgm: { style: '', bpm: null }, rhythm: { shotCount: 0, avgShotSec: 0 }, parser: 'mock' },
    matrix: { dimensions: [{ key: 'visual', label: '视觉', enabled: true, options: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }], locked }] },
  });
  const loose = await guard.check(mk([]), { fileRef: '', descriptor: '', generator: 'mock' });
  const tight = await guard.check(mk(['产品外观', '关键动作', '品牌色', '核心信息']), { fileRef: '', descriptor: '', generator: 'mock' });
  assert.ok(tight.score >= loose.score);
  assert.ok(tight.passed);
});

/**
 * @vbid/variable-matrix —— 六维变量矩阵（Variable Matrix）
 *
 * 产品定义（README）：一条参考视频被解析后拆成六个可独立控制的维度，
 * 运营勾选「变什么、不变什么」，系统在组合空间中按「最大差异度优先」采样出 N 条变体。
 *
 * v0.1 范围（PM 裁决）：
 *  - 完整实现六维数据模型与组合空间 / 采样 / 成本预估；
 *  - 默认仅启用「视觉 + 文案」两维，其余维度预置选项但默认关闭（v0.2+ 逐维打开）；
 *  - 纯函数、零依赖、可单测。
 */

// ---------- 类型 ----------

/** 六个可控维度（README 核心概念表） */
export type DimensionKey =
  | 'visual'   // 视觉：场景、光线、色调、构图
  | 'person'   // 人物：模特、服装、表情
  | 'copy'     // 文案：Hook、卖点顺序、CTA
  | 'rhythm'   // 节奏：时长、剪辑密度、转场
  | 'audio'    // 音频：BGM、音效、语速
  | 'technical'; // 技术：分辨率、画幅、字幕样式

export interface DimensionOption {
  id: string;
  label: string;
}

export interface Dimension {
  key: DimensionKey;
  /** 界面显示名（Bahasa Indonesia 运营友好，保留中文注释） */
  label: string;
  /** 是否参与变化：false = 整维锁定 */
  enabled: boolean;
  /** 该维度的可选值；enabled 为 true 时至少 2 个 */
  options: DimensionOption[];
  /** 必须保持不变的核心项描述（如产品外观、核心卖点） */
  locked: string[];
}

export interface VariableMatrix {
  dimensions: Dimension[];
}

/** 一条变体的具体取值方案 */
export interface VariantSpec {
  /** 变体序号，如 V01 */
  id: string;
  /** 每个启用维度的取值；未启用维度不出现 */
  assignments: Partial<Record<DimensionKey, string>>;
}

export interface CostEstimate {
  variantCount: number;
  /** 预估成本（美元），单价由调用方注入，PM 裁决：v0.1 用 API 路线 ~$0.15/条 作为展示默认 */
  estimatedCostUsd: number;
  ratePerVariantUsd: number;
  currency: 'USD';
}

// ---------- 默认维度 ----------

/** 预置的六维默认值。视觉/文案默认启用；其余预置常见选项但默认锁定。 */
export function defaultDimensions(): Dimension[] {
  return [
    {
      key: 'visual',
      label: '视觉',
      enabled: true,
      options: [
        { id: 'scene-kitchen', label: '厨房台面' },
        { id: 'scene-restaurant', label: '餐厅' },
        { id: 'scene-outdoor', label: '户外野餐' },
        { id: 'scene-office', label: '办公室' },
      ],
      locked: ['产品外观', '关键动作', '品牌色'],
    },
    {
      key: 'copy',
      label: '文案',
      enabled: true,
      options: [
        { id: 'hook-pour', label: 'Hook=倾倒' },
        { id: 'hook-stretch', label: 'Hook=拉丝' },
        { id: 'hook-taste', label: 'Hook=试吃' },
        { id: 'hook-open', label: 'Hook=开盖' },
      ],
      locked: ['核心信息', '品牌调性'],
    },
    {
      key: 'person',
      label: '人物',
      enabled: false,
      options: [
        { id: 'model-a', label: '模特 A' },
        { id: 'model-b', label: '模特 B' },
        { id: 'model-c', label: '模特 C' },
      ],
      locked: ['镜头角度', '动作节奏'],
    },
    {
      key: 'rhythm',
      label: '节奏',
      enabled: false,
      options: [
        { id: 'rhythm-fast', label: '快切' },
        { id: 'rhythm-slow', label: '慢节奏' },
      ],
      locked: ['关键镜头顺序'],
    },
    {
      key: 'audio',
      label: '音频',
      enabled: false,
      options: [
        { id: 'bgm-folk', label: '印尼民谣' },
        { id: 'bgm-pop', label: '流行' },
        { id: 'bgm-edm', label: '电子' },
      ],
      locked: ['口播内容'],
    },
    {
      key: 'technical',
      label: '技术',
      enabled: false,
      options: [
        { id: 'tech-9x16-720', label: '9:16 · 720p' },
        { id: 'tech-9x16-1080', label: '9:16 · 1080p' },
      ],
      locked: [],
    },
  ];
}

export function createMatrix(dimensions?: Dimension[]): VariableMatrix {
  const matrix = { dimensions: dimensions ?? defaultDimensions() };
  validateMatrix(matrix);
  return matrix;
}

// ---------- 校验 ----------

export function validateMatrix(matrix: VariableMatrix): void {
  const seen = new Set<string>();
  for (const dim of matrix.dimensions) {
    if (seen.has(dim.key)) throw new Error(`duplicate dimension: ${dim.key}`);
    seen.add(dim.key);
    const ids = new Set<string>();
    for (const opt of dim.options) {
      if (ids.has(opt.id)) {
        throw new Error(`duplicate option id "${opt.id}" in dimension "${dim.key}"`);
      }
      ids.add(opt.id);
    }
    if (dim.enabled && dim.options.length < 2) {
      throw new Error(`enabled dimension "${dim.key}" needs at least 2 options`);
    }
  }
}

// ---------- 组合空间 ----------

/** 参与变化的维度 */
export function enabledDimensions(matrix: VariableMatrix): Dimension[] {
  return matrix.dimensions.filter((d) => d.enabled);
}

/** 变量组合空间大小 = 各启用维度选项数的乘积（README 案例：3×2×4×3=72） */
export function combinationSpace(matrix: VariableMatrix): number {
  return enabledDimensions(matrix).reduce((acc, d) => acc * d.options.length, 1);
}

/** 完整枚举组合空间（空间过大时抛错，调用方应改用采样） */
export function enumerateAll(matrix: VariableMatrix, maxSpace = 100000): VariantSpec[] {
  const dims = enabledDimensions(matrix);
  if (dims.length === 0) return [];
  const space = combinationSpace(matrix);
  if (space > maxSpace) {
    throw new Error(`combination space ${space} exceeds max ${maxSpace}; use sampleVariants instead`);
  }
  const out: VariantSpec[] = [];
  const walk = (i: number, acc: Partial<Record<DimensionKey, string>>): void => {
    if (i === dims.length) {
      out.push({ id: '', assignments: { ...acc } });
      return;
    }
    for (const opt of dims[i].options) {
      acc[dims[i].key] = opt.id;
      walk(i + 1, acc);
    }
  };
  walk(0, {});
  return out.map((v, idx) => ({ ...v, id: `V${String(idx + 1).padStart(2, '0')}` }));
}

// ---------- 采样（最大差异度优先） ----------

/** mulberry32：确定性伪随机，保证同种子采样结果可复现 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 两个变体在启用维度上的差异数（Hamming 距离） */
export function diversityDistance(a: VariantSpec, b: VariantSpec, keys: DimensionKey[]): number {
  return keys.reduce((acc, k) => acc + (a.assignments[k] === b.assignments[k] ? 0 : 1), 0);
}

/**
 * 最大差异度优先采样（README 策略）：
 *  1. 若 count >= 组合空间大小，直接全量枚举；
 *  2. 否则贪心 farthest-point：首条随机（由 seed 决定），之后每次选「与已选集合最小距离最大」的组合。
 * 同 seed 结果确定，便于成本预估与复现。
 */
export function sampleVariants(matrix: VariableMatrix, count: number, seed = 42): VariantSpec[] {
  validateMatrix(matrix);
  const dims = enabledDimensions(matrix);
  if (dims.length === 0) return [];
  if (count <= 0) return [];

  const space = combinationSpace(matrix);
  if (count >= space) return enumerateAll(matrix);

  const keys = dims.map((d) => d.key);
  const all = enumerateAll(matrix);

  const rand = mulberry32(seed);
  const picked: VariantSpec[] = [all[Math.floor(rand() * all.length)]];

  while (picked.length < count) {
    let best: VariantSpec | null = null;
    let bestMinDist = -1;
    for (const candidate of all) {
      // 已选过的跳过
      if (picked.some((p) => keys.every((k) => p.assignments[k] === candidate.assignments[k]))) {
        continue;
      }
      const minDist = Math.min(...picked.map((p) => diversityDistance(candidate, p, keys)));
      // 距离相同则取伪随机决胜，避免永远偏向枚举序前排
      if (minDist > bestMinDist || (minDist === bestMinDist && best !== null && rand() < 0.5)) {
        best = candidate;
        bestMinDist = minDist;
      }
    }
    if (!best) break;
    picked.push(best);
  }

  return picked.map((v, idx) => ({ assignments: v.assignments, id: `V${String(idx + 1).padStart(2, '0')}` }));
}

// ---------- 成本预估 ----------

/** 生成前成本预估（README 工作流 A 第④步）。单价由路由层注入，不写死。 */
export function estimateCost(
  variantCount: number,
  ratePerVariantUsd = 0.15,
): CostEstimate {
  if (variantCount < 0) throw new Error('variantCount must be >= 0');
  if (ratePerVariantUsd < 0) throw new Error('ratePerVariantUsd must be >= 0');
  return {
    variantCount,
    estimatedCostUsd: Number((variantCount * ratePerVariantUsd).toFixed(2)),
    ratePerVariantUsd,
    currency: 'USD',
  };
}

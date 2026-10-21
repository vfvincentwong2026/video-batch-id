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
 *
 * v0.3 新增（智能匹配）：
 *  - suggestDimensions：从解析产物启发式推荐维度启用与选项（规则引擎 v1；VLM 接入后升级语义匹配）；
 *  - buildPreview：矩阵确定后生成「Demo 效果预览」（每个选项的预期效果 + 关联关键帧 + 样例变体）。
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
  key: DimensionKey | `custom-${string}`;
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

// ==========================================================================
// v0.3 智能匹配：suggestDimensions（规则引擎 v1）
// ==========================================================================

/** 解析产物的最小输入结构（与 @vbid/reference-parser 的 ParsedReference 兼容，避免循环依赖） */
export interface SuggestionParseInput {
  shots: Array<{ index: number; startMs: number; endMs: number; type: string }>;
  hooks: Array<{ phrase: string; kind: string }>;
  bgm: { style: string; bpm: number | null };
  rhythm: { shotCount: number; avgShotSec: number };
  transcript: string;
  parser: string;
}

export interface DimensionSuggestionReason {
  key: string;
  /** 为什么推荐这样配（给用户看的自然语言理由） */
  reason: string;
  /** 推荐强度：high=信号明确，medium=有信号，low=默认保守 */
  confidence: 'high' | 'medium' | 'low';
}

export interface DimensionSuggestions {
  dimensions: Dimension[];
  reasons: DimensionSuggestionReason[];
  /** 诚实声明：当前为规则引擎启发式；VLM 接入后升级为语义匹配 */
  engine: 'rule-v1';
}

const SCENE_POOL = [
  { id: 'scene-kitchen', label: '厨房台面' },
  { id: 'scene-restaurant', label: '餐厅' },
  { id: 'scene-outdoor', label: '户外野餐' },
  { id: 'scene-office', label: '办公室' },
  { id: 'scene-studio', label: '影棚' },
  { id: 'scene-street', label: '街景' },
];

const COPY_FALLBACK = ['Hook=倾倒', 'Hook=拉丝', 'Hook=试吃', 'Hook=开盖'];

/**
 * 启发式维度推荐：
 *  - 视觉：选项数与镜头数联动（镜头越多可用场景越多）；
 *  - 文案：优先取解析出的视觉 Hook；不足补默认；
 *  - 节奏：镜头密度高（avgShotSec ≤ 2.5 或 ≥6 镜头）→ 推荐启用；
 *  - 音频：检测到音轨 → 推荐启用；
 *  - 技术：解析器为真实 shotcut → 推荐启用（分辨率重映射是常见低成本变量）；
 *  - 人物：无本地人脸/人物检测信号 → 保守不推荐（诚实标注，VLM 接入后点亮）。
 */
export function suggestDimensions(
  parsed: SuggestionParseInput,
  opts: { hasAudio?: boolean } = {},
): DimensionSuggestions {
  const dims = defaultDimensions();
  const reasons: DimensionSuggestionReason[] = [];
  const shotCount = parsed.shots.length;
  const avgShotSec = parsed.rhythm?.avgShotSec ?? 0;

  // 视觉：镜头数 → 场景选项数（2..6）
  const visual = dims.find((d) => d.key === 'visual')!;
  visual.options = SCENE_POOL.slice(0, Math.max(2, Math.min(6, shotCount || 2)));
  reasons.push({
    key: 'visual',
    reason: `素材切出 ${shotCount} 个镜头 → 推荐 ${visual.options.length} 个场景变量（镜头越多，可安全替换的背景越多）`,
    confidence: 'high',
  });

  // 文案：视觉/口播 Hook 都可用（VLM 常给出口播 Hook），不足补默认
  const copy = dims.find((d) => d.key === 'copy')!;
  const usableHooks = parsed.hooks.filter((h) => h.kind === 'visual' || h.kind === 'verbal');
  const hookOpts = usableHooks
    .map((h, i) => ({ id: `hook-${i + 1}`, label: `${h.kind === 'verbal' ? '口播Hook' : 'Hook'}=${h.phrase}` }));
  while (hookOpts.length < 2) {
    hookOpts.push({ id: `hook-fallback-${hookOpts.length + 1}`, label: COPY_FALLBACK[hookOpts.length] });
  }
  copy.options = hookOpts.slice(0, 4);
  const realHooks = usableHooks.length;
  reasons.push(realHooks > 0
    ? { key: 'copy', reason: `解析出 ${realHooks} 个 Hook（视觉/口播）→ 文案变量围绕真实 Hook 生成`, confidence: 'high' }
    : { key: 'copy', reason: '未解析出 Hook → 使用默认 Hook 库（检查 VLM key 配置）', confidence: 'low' });

  // 节奏：密度信号
  const rhythm = dims.find((d) => d.key === 'rhythm')!;
  if (avgShotSec > 0 && (avgShotSec <= 2.5 || shotCount >= 6)) {
    rhythm.enabled = true;
    rhythm.options = [
      { id: 'rhythm-keep', label: `保持原节奏（${avgShotSec}s/镜）` },
      { id: 'rhythm-fast', label: '快切（密度 ×1.5）' },
      { id: 'rhythm-slow', label: '慢节奏（密度 ×0.7）' },
    ];
    reasons.push({
      key: 'rhythm',
      reason: `镜头密度高（${shotCount} 镜 · 平均 ${avgShotSec}s/镜）→ 节奏是这条素材的高价值变量`,
      confidence: 'medium',
    });
  } else {
    rhythm.options = [
      { id: 'rhythm-fast', label: '快切' },
      { id: 'rhythm-slow', label: '慢节奏' },
    ];
    reasons.push({
      key: 'rhythm',
      reason: `镜头较疏（${shotCount} 镜 · 平均 ${avgShotSec}s/镜）→ 节奏变量收益不确定，默认锁定`,
      confidence: 'low',
    });
  }

  // 音频：音轨信号
  const audio = dims.find((d) => d.key === 'audio')!;
  const hasAudio = opts.hasAudio ?? parsed.bgm?.style !== '无声';
  if (hasAudio) {
    audio.enabled = true;
    audio.options = [
      { id: 'bgm-keep', label: `保持原声（${parsed.bgm?.style ?? '有音轨'}）` },
      { id: 'bgm-folk', label: '印尼民谣' },
      { id: 'bgm-pop', label: '流行' },
    ];
    reasons.push({
      key: 'audio',
      reason: `探测到音轨（${parsed.bgm?.style ?? '未知风格'}）→ 音频是低成本高感知变量`,
      confidence: 'medium',
    });
  } else {
    reasons.push({ key: 'audio', reason: '无声素材 → 音频变量默认锁定', confidence: 'high' });
  }

  // 技术：真实解析器产出 → 推荐
  const technical = dims.find((d) => d.key === 'technical')!;
  if (parsed.parser === 'ffmpeg-shotcut') {
    technical.enabled = true;
    reasons.push({
      key: 'technical',
      reason: '真实分辨率已探测 → 可安全做 720p/1080p 重映射（零生成成本预览档）',
      confidence: 'medium',
    });
  } else {
    reasons.push({ key: 'technical', reason: 'mock 解析无真实分辨率 → 默认锁定', confidence: 'low' });
  }

  // 人物：诚实占位
  const person = dims.find((d) => d.key === 'person')!;
  person.enabled = false;
  reasons.push({
    key: 'person',
    reason: '本机无人物/人脸检测信号 → 保守锁定（VLM 接入后按出镜人物自动推荐）',
    confidence: 'low',
  });

  return { dimensions: dims, reasons, engine: 'rule-v1' };
}

// ==========================================================================
// v0.3 Demo 效果预览：buildPreview
// ==========================================================================

export interface PreviewShotRef {
  index: number;
  startMs: number;
  endMs: number;
  /** 关键帧 URL（可选） */
  thumb?: string;
  type?: string;
}

export interface PreviewEntry {
  dimensionKey: string;
  dimensionLabel: string;
  optionId: string;
  optionLabel: string;
  /** 预期效果自然语言描述 */
  effect: string;
  /** 该选项主要影响哪些镜头 */
  affectedShots: number[];
  /** 关联关键帧（取影响镜头的首帧） */
  thumb?: string;
  /** 预览可信度：real 解析 > mock */
  confidence: 'high' | 'medium' | 'low';
}

export interface PreviewSample {
  id: string;
  /** 人类可读的取值组合 */
  combo: Array<{ dimension: string; value: string }>;
}

export interface PreviewResult {
  entries: PreviewEntry[];
  samples: PreviewSample[];
  space: number;
  engine: 'rule-v1';
}

/** 维度 key → 效果文案模板（按解析数据填充） */
function effectText(
  dim: Dimension,
  optionLabel: string,
  parsed: SuggestionParseInput,
): { effect: string; confidence: PreviewEntry['confidence'] } {
  const avg = parsed.rhythm?.avgShotSec ?? 0;
  const shotCount = parsed.shots.length;
  const real = parsed.parser === 'ffmpeg-shotcut';
  switch (dim.key) {
    case 'visual':
      return {
        effect: `背景场景替换为「${optionLabel}」：产品主体、关键动作与 Hook 镜头保持不变，仅环境/光线/构图随场景重生成`,
        confidence: real ? 'high' : 'medium',
      };
    case 'copy':
      return {
        effect: `开屏 Hook 替换为「${optionLabel}」：镜头结构不变，前 ${Math.round((parsed.shots[0]?.endMs ?? 3000) / 1000)}s 的注意力抓手换文案重剪`,
        confidence: real ? 'medium' : 'low',
      };
    case 'rhythm':
      return {
        effect: `剪辑节奏调整为「${optionLabel}」：当前 ${shotCount} 镜 · ${avg}s/镜，重映射后镜头密度改变、关键镜头顺序锁定`,
        confidence: 'medium',
      };
    case 'audio':
      return {
        effect: `声音轨替换为「${optionLabel}」：画面不动，仅 BGM/音效层重混（零生成成本）`,
        confidence: 'medium',
      };
    case 'person':
      return {
        effect: `出镜人物替换为「${optionLabel}」：动作与口型节奏迁移（LivePortrait/IP-Adapter，v0.3 后可用）`,
        confidence: 'low',
      };
    case 'technical':
      return {
        effect: `导出规格切换为「${optionLabel}」：纯重编码，秒出预览档`,
        confidence: 'high',
      };
    default:
      return {
        effect: `自定义变量「${dim.label}」取值为「${optionLabel}」：按生成 provider 的自由变量处理`,
        confidence: 'low',
      };
  }
}

/**
 * 生成 Demo 效果预览：
 *  - 每个启用维度的每个选项一条 entry（预期效果 + 影响镜头 + 关键帧）；
 *  - 选项按序映射到镜头（round-robin），让"变量 ↔ 画面"有具体对应；
 *  - 附 3 条样例变体组合（最大差异度采样），让运营先看"会变出什么样的片子"。
 */
export function buildPreview(
  matrix: VariableMatrix,
  parsed: SuggestionParseInput,
  opts: { thumbs?: Array<PreviewShotRef>; sampleCount?: number; seed?: number } = {},
): PreviewResult {
  validateMatrix(matrix);
  const thumbs = opts.thumbs ?? [];
  const thumbOf = (shotIndex: number): string | undefined => {
    const hit = thumbs.find((t) => t.index === shotIndex);
    return hit?.thumb;
  };
  const entries: PreviewEntry[] = [];
  for (const dim of enabledDimensions(matrix)) {
    dim.options.forEach((opt, i) => {
      // 选项 → 镜头 round-robin 映射（1-based 镜头号）
      const shotIdx = parsed.shots.length ? (i % parsed.shots.length) + 1 : undefined;
      const { effect, confidence } = effectText(dim, opt.label, parsed);
      entries.push({
        dimensionKey: String(dim.key),
        dimensionLabel: dim.label,
        optionId: opt.id,
        optionLabel: opt.label,
        effect,
        affectedShots: shotIdx ? [shotIdx] : [],
        thumb: shotIdx ? thumbOf(shotIdx) : undefined,
        confidence,
      });
    });
  }

  const samples = sampleVariants(matrix, Math.min(opts.sampleCount ?? 3, combinationSpace(matrix) || 1), opts.seed ?? 42)
    .map((v) => ({
      id: v.id,
      combo: matrix.dimensions
        .filter((d) => v.assignments[d.key] !== undefined)
        .map((d) => ({
          dimension: d.label,
          value: d.options.find((o) => o.id === v.assignments[d.key])?.label ?? String(v.assignments[d.key]),
        })),
    }));

  return { entries, samples, space: combinationSpace(matrix), engine: 'rule-v1' };
}

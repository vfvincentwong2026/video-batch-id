/**
 * @vbid/reference-parser —— 参考视频解析层
 *
 * README 定位：「参考解析是入口，不是可选步骤。没有解析就没有变量矩阵」。
 * 解析产物 ParsedReference 是变量矩阵的输入：场景选项来自镜头，Hook 选项来自 Hook 结构。
 *
 * v0.1：只有 MockParserProvider（确定性伪解析，用于打通工作流 A 全链路）。
 * 后续 provider（同一接口）：
 *  - qwen2.5vl-api  —— 云端 VLM 拆镜头 + Hook 识别（免本地 50GB 权重，PM 裁决路线）
 *  - whisper-local  —— 本地转录文案/BPM 分析
 */

// ---------- 类型 ----------

export type ShotType = 'hook' | 'product' | 'action' | 'reaction' | 'cta';

export interface Shot {
  index: number;
  startMs: number;
  endMs: number;
  type: ShotType;
  /** 画面描述（VLM 输出；mock 为模板描述） */
  description: string;
}

export interface Hook {
  /** 文案开头的 Hook 短语（Bahasa Indonesia） */
  phrase: string;
  kind: 'visual' | 'verbal';
}

export interface ParsedReference {
  assetId: string;
  durationMs: number;
  shots: Shot[];
  hooks: Hook[];
  /** 口播/字幕文案 */
  transcript: string;
  bgm: { style: string; bpm: number | null };
  rhythm: { shotCount: number; avgShotSec: number };
  /** 解析器署名，便于审计与 A/B 对比 */
  parser: string;
}

export interface ParseInput {
  assetId: string;
  filename: string;
  durationMs: number;
  /** 可选：本地文件路径（本地 provider 用；API provider 忽略） */
  filePath?: string;
}

export interface ParserProvider {
  name: string;
  parse(input: ParseInput): Promise<ParsedReference>;
}

// ---------- Mock 实现（v0.1 默认） ----------

/**
 * 确定性 mock：按 README Dapur Ibu 案例的结构（4 镜头 + Hook + 印尼语文案 + 120BPM）
 * 按输入时长等比缩放。同输入必同输出，便于测试与演示。
 */
export class MockParserProvider implements ParserProvider {
  name = 'mock';

  async parse(input: ParseInput): Promise<ParsedReference> {
    const { assetId, durationMs } = input;
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new Error('durationMs must be a positive number');
    }
    // 4 镜头等比切分（README 案例结构：倾倒 Hook → 拉丝 → 产品特写 → 试吃+CTA）
    const boundaries = [0, 0.27, 0.55, 0.8, 1];
    const types: ShotType[] = ['hook', 'action', 'product', 'cta'];
    const descriptions = [
      '酱汁倾倒特写（Hook）',
      '慢动作拉丝',
      '产品包装特写',
      '试吃反应 + CTA',
    ];
    const shots: Shot[] = types.map((type, i) => ({
      index: i + 1,
      startMs: Math.round(durationMs * boundaries[i]),
      endMs: Math.round(durationMs * boundaries[i + 1]),
      type,
      description: descriptions[i],
    }));

    return {
      assetId,
      durationMs,
      shots,
      hooks: [
        { phrase: '倾倒特写开屏', kind: 'visual' },
        { phrase: 'Sambal Matah segar', kind: 'verbal' },
      ],
      transcript: 'Sambal Matah segar, pedasnya nampol! Coba sekarang.',
      bgm: { style: '轻快印尼民谣', bpm: 120 },
      rhythm: {
        shotCount: shots.length,
        avgShotSec: Number((durationMs / 1000 / shots.length).toFixed(1)),
      },
      parser: this.name,
    };
  }
}

// ---------- Provider 注册表 ----------

const registry = new Map<string, ParserProvider>();

export function registerParser(p: ParserProvider): void {
  registry.set(p.name, p);
}

registerParser(new MockParserProvider());

export function getParser(name = 'mock'): ParserProvider {
  const p = registry.get(name);
  if (!p) throw new Error(`unknown parser: ${name} (registered: ${[...registry.keys()].join(', ')})`);
  return p;
}

// ---------- 解析产物 → 变量矩阵线索 ----------

/**
 * 从解析结果推导变量矩阵的维度选项（v0.1：视觉场景 ← 镜头类型组合，文案 Hook ← Hook 列表）。
 * 让「解析 → 勾选」这一步有真实数据可依，而非写死选项。
 */
export function deriveMatrixHints(parsed: ParsedReference): {
  visualOptions: Array<{ id: string; label: string }>;
  copyOptions: Array<{ id: string; label: string }>;
} {
  const scenePool = [
    { id: 'scene-kitchen', label: '厨房台面' },
    { id: 'scene-restaurant', label: '餐厅' },
    { id: 'scene-outdoor', label: '户外野餐' },
    { id: 'scene-office', label: '办公室' },
  ];
  // 场景选项数与镜头数联动：镜头越多，可用场景越多（至少 2 个）
  const visualOptions = scenePool.slice(0, Math.max(2, Math.min(4, parsed.shots.length)));
  const copyOptions = parsed.hooks
    .filter((h) => h.kind === 'visual')
    .map((h, i) => ({ id: `hook-${i + 1}`, label: `Hook=${h.phrase}` }));
  // Hook 不足 2 个时补默认，保证矩阵可启用
  while (copyOptions.length < 2) {
    copyOptions.push({ id: `hook-default-${copyOptions.length + 1}`, label: `Hook=默认${copyOptions.length + 1}` });
  }
  return { visualOptions, copyOptions };
}

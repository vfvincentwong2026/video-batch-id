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
  /** 口播/字幕文案（未转录时为空串） */
  transcript: string;
  bgm: { style: string; bpm: number | null };
  rhythm: { shotCount: number; avgShotSec: number };
  /** 解析器署名，便于审计与 A/B 对比 */
  parser: string;
  /** 诚实清单：哪些维度是真实解析、哪些仍待增强（VLM/Whisper 接入后逐项移除） */
  enrichment: { real: string[]; pending: string[] };
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
      enrichment: { real: [], pending: ['shotcut', 'vlm-copy', 'bgm', 'transcript'] },
    };
  }
}

// ---------- Shotcut 实现（v0.2：真实镜头边界） ----------

/**
 * 基于 ffmpeg 场景切换检测的真实结构解析。
 * 真实：镜头边界、节奏统计、分辨率/音轨探测。
 * 待增强（诚实占位）：文案转录（Whisper）、BGM 分析、VLM 画面语义 —— 接入后逐维点亮。
 */
export class ShotcutParserProvider implements ParserProvider {
  name = 'ffmpeg-shotcut';

  async parse(input: ParseInput): Promise<ParsedReference> {
    if (!input.filePath) throw new Error('ffmpeg-shotcut requires filePath');
    const media = await import('@vbid/media-probe');
    const probe = await media.probe(input.filePath);
    const spans = await media.detectShots(input.filePath);
    const durationMs = probe.durationMs || input.durationMs;

    const shots: Shot[] = spans.map((s, i) => ({
      index: i + 1,
      startMs: s.startMs,
      endMs: s.endMs,
      // 结构推断：首镜头=Hook 位，末镜头=CTA 位，中间=action
      type: (i === 0 ? 'hook' : i === spans.length - 1 && spans.length > 1 ? 'cta' : 'action') as ShotType,
      description: `镜头 ${i + 1}（${(s.startMs / 1000).toFixed(1)}s–${(s.endMs / 1000).toFixed(1)}s，场景切换切出）`,
    }));

    return {
      assetId: input.assetId,
      durationMs,
      shots,
      hooks: [{ phrase: `首帧开屏（镜头1 · ${(shots[0]?.endMs ?? 0) / 1000 | 0}s）`, kind: 'visual' }],
      transcript: '',
      bgm: { style: probe.hasAudio ? '有音轨（BPM 分析待接入）' : '无声', bpm: null },
      rhythm: {
        shotCount: shots.length,
        avgShotSec: Number((durationMs / 1000 / Math.max(1, shots.length)).toFixed(1)),
      },
      parser: this.name,
      enrichment: {
        real: ['shotcut', 'rhythm', 'probe'],
        pending: probe.hasAudio ? ['vlm-copy', 'bgm', 'transcript'] : ['vlm-copy', 'bgm'],
      },
    };
  }
}

// ---------- OpenAI 兼容 VLM provider（v0.3：真实语义解析） ----------

export interface VlmParserOptions {
  /** 默认 process.env.VBID_VLM_API_KEY；未设置时 parse() 抛错 */
  apiKey?: string;
  /** OpenAI 兼容入口，默认 https://api.openai.com/v1；也可用中转（VBID_VLM_BASE_URL） */
  baseUrl?: string;
  /** 默认 gpt-4o-mini（VBID_VLM_MODEL）： vision 能力 + 低成本 */
  model?: string;
  /** 送 VLM 的最大代表帧数（受上下文与费用约束） */
  maxShots?: number;
  timeoutMs?: number;
  /** 测试注入：替代真实网络请求 */
  fetchFn?: typeof fetch;
  /** 测试注入：替代 @vbid/media-probe 实现 */
  mediaImpl?: {
    probe(p: string): Promise<{ durationMs: number; hasAudio: boolean }>;
    detectShots(p: string): Promise<Array<{ startMs: number; endMs: number }>>;
    extractKeyframe(p: string, timeMs: number, outPath: string): Promise<string>;
  };
}

interface VlmAnalysisJson {
  shots?: Array<{ index?: number; description?: string; scene?: string }>;
  hooks?: Array<{ phrase?: string; kind?: string }>;
  transcript?: string;
  bgm?: { style?: string; bpm?: number | null };
  product?: string;
}

/**
 * 云端 VLM 语义解析：
 *  镜头边界/节奏/音轨仍由 ffmpeg-shotcut 真实探测（结构化信号本地做，稳定且免费）；
 *  画面语义、Hook、口播转录、BGM 风格由 VLM 看关键帧产出 —— 这是「解析→推荐」质量的分水岭。
 * 未配置 key 时不会选中本 provider（服务端回退 ffmpeg-shotcut）。
 */
export class VlmApiParserProvider implements ParserProvider {
  name = 'vlm-api';
  private opts: VlmParserOptions;

  constructor(opts: VlmParserOptions = {}) {
    this.opts = opts;
  }

  private cfg() {
    return {
      apiKey: this.opts.apiKey ?? process.env.VBID_VLM_API_KEY ?? '',
      baseUrl: (this.opts.baseUrl ?? process.env.VBID_VLM_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: this.opts.model ?? process.env.VBID_VLM_MODEL ?? 'gpt-4o-mini',
      maxShots: this.opts.maxShots ?? 8,
      timeoutMs: this.opts.timeoutMs ?? 90000,
    };
  }

  async parse(input: ParseInput): Promise<ParsedReference> {
    if (!input.filePath) throw new Error('vlm-api requires filePath');
    const { apiKey, baseUrl, model, maxShots, timeoutMs } = this.cfg();
    if (!apiKey) throw new Error('VBID_VLM_API_KEY not set');

    const media = this.opts.mediaImpl ?? (await import('@vbid/media-probe'));
    const probe = await media.probe(input.filePath);
    const spans = await media.detectShots(input.filePath);
    const durationMs = probe.durationMs || input.durationMs;
    if (!spans.length) spans.push({ startMs: 0, endMs: durationMs });

    // 每个镜头抽 1 帧代表图（上限 maxShots），写临时目录后读成 data URL
    const os = await import('node:os');
    const pathMod = await import('node:path');
    const fsp = await import('node:fs/promises');
    const tmp = await fsp.mkdtemp(pathMod.join(os.tmpdir(), 'vbid-vlm-'));
    let analysis: VlmAnalysisJson = {};
    try {
      const shots = spans.slice(0, maxShots);
      const frames: string[] = [];
      for (let i = 0; i < shots.length; i++) {
        const midMs = Math.round((shots[i].startMs + shots[i].endMs) / 2);
        const out = pathMod.join(tmp, `shot-${i + 1}.jpg`);
        try {
          await media.extractKeyframe(input.filePath, midMs, out);
          const b64 = await fsp.readFile(out, { encoding: 'base64' });
          frames.push(`data:image/jpeg;base64,${b64}`);
        } catch { /* 单帧失败不阻断 */ }
      }
      analysis = await this.callVlm({ baseUrl, apiKey, model, timeoutMs, spans: shots, frames });
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
    }

    // 结构化类型推断 + VLM 语义描述合并
    const shots: Shot[] = spans.map((s, i) => ({
      index: i + 1,
      startMs: s.startMs,
      endMs: s.endMs,
      type: (i === 0 ? 'hook' : i === spans.length - 1 && spans.length > 1 ? 'cta' : 'action') as ShotType,
      description: analysis.shots?.[i]?.description?.trim()
        || `镜头 ${i + 1}（${(s.startMs / 1000).toFixed(1)}s–${(s.endMs / 1000).toFixed(1)}s，场景切换切出）`,
    }));

    const hooks: Hook[] = (analysis.hooks ?? [])
      .filter((h) => typeof h.phrase === 'string' && h.phrase.trim())
      .slice(0, 4)
      .map((h) => ({ phrase: h.phrase!.trim(), kind: h.kind === 'verbal' ? 'verbal' : 'visual' }));
    if (hooks.length === 0) {
      hooks.push({ phrase: `首帧开屏（镜头1 · ${Math.round((shots[0]?.endMs ?? 0) / 1000)}s）`, kind: 'visual' });
    }

    const transcript = typeof analysis.transcript === 'string' ? analysis.transcript.trim() : '';
    const bgmStyle = analysis.bgm?.style?.trim() || (probe.hasAudio ? '有音轨（VLM 未识别风格）' : '无声');
    const bpm = typeof analysis.bgm?.bpm === 'number' && analysis.bgm.bpm > 0 ? analysis.bgm.bpm : null;

    const real = ['shotcut', 'rhythm', 'probe', 'vlm-scene', 'vlm-copy'];
    const pending: string[] = [];
    if (transcript) real.push('vlm-transcript'); else pending.push('transcript');
    if (analysis.bgm?.style?.trim()) real.push('vlm-bgm'); else pending.push('bgm');

    return {
      assetId: input.assetId,
      durationMs,
      shots,
      hooks,
      transcript,
      bgm: { style: bgmStyle, bpm },
      rhythm: {
        shotCount: shots.length,
        avgShotSec: Number((durationMs / 1000 / Math.max(1, shots.length)).toFixed(1)),
      },
      parser: this.name,
      enrichment: { real, pending },
    };
  }

  private async callVlm(args: {
    baseUrl: string; apiKey: string; model: string; timeoutMs: number;
    spans: Array<{ startMs: number; endMs: number }>; frames: string[];
  }): Promise<VlmAnalysisJson> {
    if (args.frames.length === 0) return {};
    const boundaryText = args.spans
      .map((s, i) => `镜头${i + 1}: ${(s.startMs / 1000).toFixed(1)}s–${(s.endMs / 1000).toFixed(1)}s`)
      .join('，');
    const schema = `{"shots":[{"index":1,"description":"该镜头画面内容，一句话","scene":"场景标签如厨房/餐厅/户外"}],"hooks":[{"phrase":"开屏吸引点短语","kind":"visual|verbal"}],"transcript":"听到的口播/旁白原文，没有则为空字符串","bgm":{"style":"音乐风格","bpm":数字或null}}`;
    const res = await (this.opts.fetchFn ?? fetch)(`${args.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${args.apiKey}` },
      body: JSON.stringify({
        model: args.model,
        temperature: 0.2,
        messages: [
          { role: 'system', content: '你是印尼短视频电商素材分析器。根据用户给出的代表帧（按时间顺序）与镜头边界，输出严格 JSON，不要输出 JSON 以外的任何内容。' },
          {
            role: 'user',
            content: [
              { type: 'text', text: `这是同一条短视频按时间顺序抽出的 ${args.frames.length} 个代表帧。镜头边界：${boundaryText}。请输出严格 JSON（shots 数组与镜头边界一一对应）：${schema}` },
              ...args.frames.map((f) => ({ type: 'image_url', image_url: { url: f } })),
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(args.timeoutMs),
    });
    if (!res.ok) throw new Error(`vlm-api ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content ?? '';
    // 容错：模型偶发包 markdown 代码块
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return {};
    try {
      return JSON.parse(m[0]) as VlmAnalysisJson;
    } catch {
      return {};
    }
  }
}

// ---------- Provider 注册表 ----------

const registry = new Map<string, ParserProvider>();

export function registerParser(p: ParserProvider): void {
  registry.set(p.name, p);
}

registerParser(new MockParserProvider());
registerParser(new ShotcutParserProvider());
registerParser(new VlmApiParserProvider());

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

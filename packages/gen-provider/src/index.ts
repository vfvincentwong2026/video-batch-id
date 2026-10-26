/**
 * @vbid/gen-provider —— 生成层 Provider 适配器
 *
 * PM 裁决（docs/05 三路对比 + 2026-10-26 拍板）：
 *  - 生成层统一走 pipeline 包的 VariantGeneratorProvider 接口，编排层零改动；
 *  - v0.4 先行实现 OpenRouter 视频生成（账号已充值，随充随用）；
 *  - fal.ai 直连（Kling 3.0 I2V）量上来后按同接口加适配器切换主力，本包即插槽。
 *
 * OpenRouter 视频生成（官方文档 2026-10 核对）：
 *  - POST  {base}/videos            → 202 { id, polling_url }（异步作业）
 *  - GET   polling_url              → pending / in_progress / completed / failed / cancelled / expired
 *  - completed 后 unsigned_urls[0] 带 Authorization 下载 MP4
 *  - I2V：frame_images[] + frame_type:"first_frame"；duration/resolution/aspect_ratio 按模型支持值
 *  - 目录：GET {base}/videos/models（支持的时长/分辨率/比例/价格 SKU）
 *
 * 默认模型 alibaba/wan-2.7（官方 I2V 示例同款，Apache 系许可干净，$0.10/秒·720p）：
 * 避免 hailuo 系（2025-09 好莱坞版权诉讼，商用不押注）。模型/时长/分辨率全部可配。
 */

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  GenerateInput,
  GeneratedVariant,
  VariantGeneratorProvider,
} from '@vbid/pipeline';

/** 统一生成层接口别名（对外语义：一切生成 provider 都长这样） */
export type GenProvider = VariantGeneratorProvider;

export interface OpenRouterVideoOptions {
  /** 默认 process.env.VBID_GEN_API_KEY；缺省回退 VBID_VLM_API_KEY（同一家 OpenRouter） */
  apiKey?: string;
  /** 默认 https://openrouter.ai/api/v1（或 VBID_GEN_BASE_URL / VBID_VLM_BASE_URL） */
  baseUrl?: string;
  /** 视频生成模型 slug（VBID_GEN_MODEL），默认 alibaba/wan-2.7 */
  model?: string;
  /** 生成时长秒（VBID_GEN_DURATION_SEC），默认 5；须在被选模型 supported_durations 内 */
  durationSec?: number;
  /** 分辨率（VBID_GEN_RESOLUTION），默认 720p */
  resolution?: string;
  /** 强制画幅（如 "9:16"）；缺省按 Master 探测宽高自动推断 */
  aspectRatio?: string;
  /** 轮询间隔毫秒，默认 8000（官方建议约 30s；演示场景取快） */
  pollIntervalMs?: number;
  /** 作业超时毫秒，默认 10 分钟 */
  timeoutMs?: number;
  /** 产出视频保存目录（服务端传 DERIVED_ROOT/<masterId>/variants） */
  outDir?: string;
  /** fileRef 前缀（服务端传 /derived/<masterId>/variants） */
  fileRefPrefix?: string;
  /** 测试注入：替代真实网络请求 */
  fetchFn?: typeof fetch;
  /** 测试注入：替代 @vbid/media-probe 实现 */
  mediaImpl?: {
    probe(p: string): Promise<{ durationMs: number; width: number; height: number }>;
    extractKeyframe(p: string, timeMs: number, outPath: string): Promise<string>;
  };
}

interface VideoJob {
  id?: string;
  polling_url?: string;
  status?: string;
  unsigned_urls?: string[];
  usage?: { cost?: number };
  error?: string | null;
}

export class OpenRouterVideoProvider implements GenProvider {
  name = 'openrouter';

  private opts: OpenRouterVideoOptions;

  constructor(opts: OpenRouterVideoOptions = {}) {
    this.opts = opts;
  }

  private cfg() {
    return {
      apiKey: this.opts.apiKey ?? process.env.VBID_GEN_API_KEY ?? process.env.VBID_VLM_API_KEY ?? '',
      baseUrl: (this.opts.baseUrl
        ?? process.env.VBID_GEN_BASE_URL
        ?? process.env.VBID_VLM_BASE_URL
        ?? 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
      model: this.opts.model ?? process.env.VBID_GEN_MODEL ?? 'alibaba/wan-2.7',
      durationSec: Number(this.opts.durationSec ?? process.env.VBID_GEN_DURATION_SEC ?? 5),
      resolution: this.opts.resolution ?? process.env.VBID_GEN_RESOLUTION ?? '720p',
      aspectRatio: this.opts.aspectRatio ?? process.env.VBID_GEN_ASPECT ?? '',
      pollIntervalMs: this.opts.pollIntervalMs ?? 8000,
      timeoutMs: this.opts.timeoutMs ?? 600_000,
      outDir: this.opts.outDir ?? '',
      fileRefPrefix: this.opts.fileRefPrefix ?? '',
    };
  }

  async generate(input: GenerateInput): Promise<GeneratedVariant> {
    const cfg = this.cfg();
    if (!cfg.apiKey) throw new Error('openrouter provider requires VBID_GEN_API_KEY (or VBID_VLM_API_KEY)');
    if (!input.masterFilePath) throw new Error('openrouter provider requires masterFilePath（Master 无真实文件，无法首帧锚定）');

    const prompt = buildGenPrompt(input);
    const media = this.opts.mediaImpl ?? (await import('@vbid/media-probe'));
    const frame = await this.firstFrame(input, media);
    let aspectRatio = cfg.aspectRatio;
    if (!aspectRatio) {
      try {
        const p = await media.probe(input.masterFilePath);
        aspectRatio = p.height >= p.width ? '9:16' : '16:9';
      } catch {
        aspectRatio = '9:16';
      }
    }

    const fetchFn = this.opts.fetchFn ?? fetch;
    const job = await this.submit(fetchFn, cfg, { prompt, frame, aspectRatio });
    const done = await this.poll(fetchFn, cfg, job);
    const video = await this.download(fetchFn, cfg, done);

    const fileName = `${input.variant.id}.mp4`;
    const fileRef = `${cfg.fileRefPrefix}/${fileName}`;
    if (cfg.outDir) {
      await mkdir(cfg.outDir, { recursive: true });
      await writeFile(join(cfg.outDir, fileName), video);
    }

    return {
      fileRef,
      descriptor: prompt.slice(0, 160),
      // 保持与启发式去重守卫兼容：JSON 键值对数组（排序后的变量取值 + 内容哈希）
      fingerprint: JSON.stringify([
        ...Object.entries(input.variant.assignments).sort(([a], [b]) => a.localeCompare(b)),
        ['__content', contentHash(video, prompt)],
      ]),
      generator: this.name,
      usageCostUsd: typeof done.usage?.cost === 'number' ? done.usage.cost : null,
      jobId: done.id ?? job.id,
    };
  }

  /** Master Hook 镜头中点抽首帧（无 Hook 位则首镜头），转 data URL 做 I2V 锚定 */
  private async firstFrame(
    input: GenerateInput,
    media: { extractKeyframe(p: string, timeMs: number, outPath: string): Promise<string> },
  ): Promise<string> {
    const shots = input.parsed.shots;
    const hook = shots.find((s) => s.type === 'hook') ?? shots[0];
    if (!hook) throw new Error('openrouter provider: parsed has no shots to anchor');
    const midMs = Math.round((hook.startMs + hook.endMs) / 2);
    const tmp = await mkdtemp(join(tmpdir(), 'vbid-gen-'));
    try {
      const out = await media.extractKeyframe(input.masterFilePath!, midMs, join(tmp, 'first-frame.jpg'));
      const b64 = await readFile(out, { encoding: 'base64' });
      return `data:image/jpeg;base64,${b64}`;
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async submit(
    fetchFn: typeof fetch,
    cfg: ReturnType<OpenRouterVideoProvider['cfg']>,
    args: { prompt: string; frame: string; aspectRatio: string },
  ): Promise<VideoJob> {
    const res = await fetchFn(`${cfg.baseUrl}/videos`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        prompt: args.prompt,
        duration: cfg.durationSec,
        resolution: cfg.resolution,
        aspect_ratio: args.aspectRatio,
        frame_images: [
          { type: 'image_url', image_url: { url: args.frame }, frame_type: 'first_frame' },
        ],
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (!res.ok) throw new Error(`openrouter submit ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as VideoJob;
  }

  private async poll(fetchFn: typeof fetch, cfg: ReturnType<OpenRouterVideoProvider['cfg']>, job: VideoJob): Promise<VideoJob> {
    const url = job.polling_url ?? `${cfg.baseUrl}/videos/${job.id}`;
    const deadline = Date.now() + cfg.timeoutMs;
    for (;;) {
      await sleep(cfg.pollIntervalMs);
      const res = await fetchFn(url, {
        headers: { authorization: `Bearer ${cfg.apiKey}` },
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
      if (!res.ok) throw new Error(`openrouter poll ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const cur = (await res.json()) as VideoJob;
      if (cur.status === 'completed') return cur;
      if (cur.status === 'failed' || cur.status === 'cancelled' || cur.status === 'expired') {
        throw new Error(`openrouter job ${cur.status}: ${cur.error ?? 'no error detail'}`);
      }
      if (Date.now() > deadline) throw new Error(`openrouter job timeout after ${cfg.timeoutMs}ms (status=${cur.status ?? 'unknown'})`);
    }
  }

  private async download(fetchFn: typeof fetch, cfg: ReturnType<OpenRouterVideoProvider['cfg']>, job: VideoJob): Promise<Buffer> {
    const url = job.unsigned_urls?.[0];
    if (!url) throw new Error('openrouter job completed but unsigned_urls is empty');
    const res = await fetchFn(url, {
      headers: { authorization: `Bearer ${cfg.apiKey}` },
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (!res.ok) throw new Error(`openrouter download ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // MP4 魔数校验：offset 4..8 应为 "ftyp"，防止把错误页存成 .mp4
    if (buf.length < 12 || buf.toString('latin1', 4, 8) !== 'ftyp') {
      throw new Error(`openrouter download is not an mp4 (${buf.length} bytes)`);
    }
    return buf;
  }
}

/** 构造生成提示词：变量取值（场景/Hook）+ 转录文案 + 首帧锚定说明，英语为主、保留原文案 */
export function buildGenPrompt(input: GenerateInput): string {
  const parts = input.matrix.dimensions
    .filter((d) => d.enabled && input.variant.assignments[d.key])
    .map((d) => {
      const opt = d.options.find((o) => o.id === input.variant.assignments[d.key]);
      return `${d.label}: ${opt?.label ?? input.variant.assignments[d.key]}`;
    });
  const hook = input.parsed.hooks[0]?.phrase;
  const lines = [
    `Vertical short-form e-commerce video ad (TikTok/Instagram Reels style), 9:16.`,
    `Variation settings — ${parts.join(' | ')}.`,
    `The first frame is provided as the exact opening shot: continue the motion naturally from it.`,
  ];
  if (hook) lines.push(`Opening hook: "${hook}".`);
  if (input.parsed.transcript) lines.push(`Voiceover copy (keep or lightly adapt): "${input.parsed.transcript}".`);
  lines.push(`Product must stay visually consistent with the opening frame. Fast-paced cuts, appetizing lighting, no watermark.`);
  return lines.join('\n');
}

/** 内容指纹：视频前 64KB + 提示词的 sha256 摘要（去重守卫的结构基础） */
function contentHash(video: Buffer, prompt: string): string {
  const h = createHash('sha256');
  h.update(video.subarray(0, 64 * 1024));
  h.update(prompt);
  return h.digest('hex').slice(0, 16);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

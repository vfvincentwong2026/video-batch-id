/**
 * @vbid/media-probe —— ffprobe/ffmpeg 薄封装
 *
 * 职责（v0.2）：让解析层拿到真实结构数据，替代 mock 的臆造镜头表。
 *  - probe：时长/分辨率/帧率/音轨（ffprobe）
 *  - detectShots：场景切换点检测（ffmpeg select=scene），得到真实镜头边界
 *  - extractKeyframe：按时间戳抽帧（供 UI 缩略图与后续 VLM 分析）
 *
 * 二进制解析顺序：环境变量 VBID_FFPROBE/VBID_FFMPEG → PATH → winget 常见安装位。
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ---------- 二进制定位 ----------

function wellKnownDirs(): string[] {
  const dirs: string[] = [];
  const base = join(homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  // winget 安装（Gyan.FFmpeg）：目录名带版本号，做一层通配扫描
  if (existsSync(base)) {
    for (const pkg of readdirSync(base)) {
      if (/ffmpeg/i.test(pkg)) {
        const bin = join(base, pkg);
        try {
          for (const ver of readdirSync(bin)) {
            dirs.push(join(bin, ver, 'bin'));
          }
        } catch { /* ignore */ }
      }
    }
  }
  return dirs;
}

export function resolveBinary(name: 'ffprobe' | 'ffmpeg'): string | null {
  const envKey = name === 'ffprobe' ? 'VBID_FFPROBE' : 'VBID_FFMPEG';
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  if (process.env[envKey] && existsSync(process.env[envKey]!)) return process.env[envKey]!;
  // PATH 直查（Windows 下覆盖常见扩展名）
  const pathExt = (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':');
  for (const dir of pathExt) {
    for (const candidate of process.platform === 'win32' ? [exe, `${name}.bat`, `${name}.cmd`] : [exe]) {
      const full = join(dir, candidate);
      if (existsSync(full)) return full;
    }
  }
  for (const dir of wellKnownDirs()) {
    const full = join(dir, exe);
    if (existsSync(full)) return full;
  }
  return null;
}

export function hasFfmpegTools(): boolean {
  return resolveBinary('ffprobe') !== null && resolveBinary('ffmpeg') !== null;
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    p.stdout.on('data', (c) => out.push(c));
    p.stderr.on('data', (c) => err.push(c));
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf-8'));
      else reject(new Error(`${cmd} exited ${code}: ${Buffer.concat(err).toString('utf-8').slice(0, 300)}`));
    });
  });
}

// ---------- 元数据探测 ----------

export interface VideoProbe {
  durationMs: number;
  width: number;
  height: number;
  fps: number | null;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  sizeBytes: number;
}

export async function probe(filePath: string): Promise<VideoProbe> {
  const ffprobe = resolveBinary('ffprobe');
  if (!ffprobe) throw new Error('ffprobe not found; set VBID_FFPROBE or install FFmpeg');
  const raw = await run(ffprobe, [
    '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath,
  ]);
  const data = JSON.parse(raw) as {
    format?: { duration?: string; size?: string };
    streams?: Array<{ codec_type: string; codec_name: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string }>;
  };
  const v = data.streams?.find((s) => s.codec_type === 'video');
  const a = data.streams?.find((s) => s.codec_type === 'audio');
  if (!v || !data.format?.duration) throw new Error(`no video stream or duration: ${filePath}`);
  const rate = v.avg_frame_rate || v.r_frame_rate || '';
  const [num, den] = rate.split('/').map(Number);
  return {
    durationMs: Math.round(Number(data.format.duration) * 1000),
    width: v.width ?? 0,
    height: v.height ?? 0,
    fps: num && den ? Number((num / den).toFixed(2)) : null,
    hasAudio: Boolean(a),
    videoCodec: v.codec_name ?? null,
    audioCodec: a?.codec_name ?? null,
    sizeBytes: Number(data.format.size ?? 0),
  };
}

// ---------- 场景切分（真实镜头边界） ----------

export interface ShotSpan {
  startMs: number;
  endMs: number;
}

/**
 * 场景切换检测：ffmpeg select='gt(scene,T)' 输出切换点 pts。
 * 无切换点时返回单镜头全片。首尾必有边界，片段连续不重叠。
 */
export async function detectShots(filePath: string, threshold = 0.35): Promise<ShotSpan[]> {
  const ffmpeg = resolveBinary('ffmpeg');
  if (!ffmpeg) throw new Error('ffmpeg not found; set VBID_FFMPEG or install FFmpeg');
  const stderr = await new Promise<string>((resolve, reject) => {
    const p = spawn(ffmpeg, [
      '-i', filePath,
      '-vf', `select='gt(scene,${threshold})',showinfo`,
      '-f', 'null', '-',
    ], { windowsHide: true });
    const err: Buffer[] = [];
    p.stderr.on('data', (c) => err.push(c));
    p.on('error', reject);
    p.on('close', () => resolve(Buffer.concat(err).toString('utf-8')));
  });
  const cuts: number[] = [];
  for (const m of stderr.matchAll(/pts_time:([\d.]+)/g)) {
    cuts.push(Math.round(Number(m[1]) * 1000));
  }
  const durationMs = (await probe(filePath)).durationMs;
  const bounds = [0, ...cuts.filter((c) => c > 0 && c < durationMs - 200), durationMs];
  const spans: ShotSpan[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    spans.push({ startMs: bounds[i], endMs: bounds[i + 1] });
  }
  return spans.filter((s) => s.endMs - s.startMs >= 200);
}

// ---------- 关键帧提取 ----------

/** 抽取 timeMs 处单帧为 JPEG。返回输出路径。 */
export async function extractKeyframe(filePath: string, timeMs: number, outPath: string): Promise<string> {
  const ffmpeg = resolveBinary('ffmpeg');
  if (!ffmpeg) throw new Error('ffmpeg not found; set VBID_FFMPEG or install FFmpeg');
  await run(ffmpeg, [
    '-y', '-ss', (timeMs / 1000).toFixed(3), '-i', filePath,
    '-frames:v', '1', '-q:v', '3', outPath,
  ]);
  return outPath;
}

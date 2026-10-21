import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hasFfmpegTools, resolveBinary, probe, detectShots, extractKeyframe } from '../src/index.ts';

const SAMPLE = 'D:/桌面工作/AI project/Video Batch ID/Master Asset/Konten permen edit 11.mp4';

test('ffmpeg 工具可用（本机 winget 安装或 PATH）', () => {
  console.log('ffprobe =', resolveBinary('ffprobe'));
  assert.ok(hasFfmpegTools(), '需要 FFmpeg；winget install Gyan.FFmpeg');
});

test('probe：真实素材元数据（1080x1920 竖屏 + 音轨）', async (t) => {
  if (!hasFfmpegTools()) return t.skip('ffmpeg unavailable');
  const p = await probe(SAMPLE);
  assert.ok(p.durationMs > 10000 && p.durationMs < 20000, `duration=${p.durationMs}`);
  assert.equal(p.width, 1080);
  assert.equal(p.height, 1920);
  assert.equal(p.hasAudio, true);
  assert.ok(p.sizeBytes > 10_000_000);
});

test('detectShots：镜头片段连续、覆盖全片、至少 1 个', async (t) => {
  if (!hasFfmpegTools()) return t.skip('ffmpeg unavailable');
  const p = await probe(SAMPLE);
  const spans = await detectShots(SAMPLE);
  assert.ok(spans.length >= 1);
  assert.equal(spans[0].startMs, 0);
  // 覆盖到片尾（±300ms 容差）
  assert.ok(Math.abs(spans[spans.length - 1].endMs - p.durationMs) < 300);
  // 连续不重叠
  for (let i = 1; i < spans.length; i++) {
    assert.ok(spans[i].startMs >= spans[i - 1].endMs - 1);
  }
});

test('extractKeyframe：抽帧产出非空 JPEG', async (t) => {
  if (!hasFfmpegTools()) return t.skip('ffmpeg unavailable');
  const dir = join(tmpdir(), 'vbid-media-test');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'kf.jpg');
  await extractKeyframe(SAMPLE, 1000, out);
  assert.ok(existsSync(out));
  assert.ok(statSync(out).size > 10_000, 'JPEG 应大于 10KB');
});

/**
 * @vbid/governance —— 治理平面本地实现（纯函数）
 *
 * 语义照抄 ai-native-dam/packages/governance：执行平面不得自建审批业务逻辑，
 * 一切写操作经过本包的闸门原语。托管进 DAM 后本包退役，由 DAM 治理平面裁决。
 */

import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import type {
  ApprovalDecision,
  ApprovalRequest,
  CheckUseInput,
  CheckUseOutput,
  RightsRecord,
} from '@vbid/shared-schema';

// ---------- check_use：权利前置检查 ----------

/**
 * 这条资产能否在 渠道X · 地区Y · 时刻T 使用？
 * 移植自 ai-native-dam governance/rights.ts 的判定语义（keep in sync）。
 */
export function checkUse(
  record: RightsRecord | null,
  input: CheckUseInput,
  now: Date = new Date(),
): CheckUseOutput {
  if (!record) {
    return { allowed: false, reason: 'no_rights_record', replacementId: null };
  }
  if (record.status === 'Expired') {
    return { allowed: false, reason: 'rights_expired', replacementId: null };
  }
  if (record.status !== 'Cleared') {
    return { allowed: false, reason: `rights_${record.status.toLowerCase()}`, replacementId: null };
  }
  if (!record.channels.includes(input.channel)) {
    return { allowed: false, reason: 'channel_not_licensed', replacementId: null };
  }
  const territory = input.territory ?? 'Global';
  if (!record.territories.includes(territory) && !record.territories.includes('Global')) {
    return { allowed: false, reason: 'territory_not_licensed', replacementId: null };
  }
  if (record.embargoUntil && new Date(record.embargoUntil) > now) {
    return { allowed: false, reason: 'embargo_active', replacementId: null };
  }
  if (record.expiresAt && new Date(record.expiresAt) <= now) {
    return { allowed: false, reason: 'rights_expired', replacementId: null };
  }
  return { allowed: true, reason: 'ok', replacementId: null };
}

// ---------- two-call 审批令牌（mcp-approval 语义） ----------

/** 生成审批请求：随机令牌 + 参数指纹 + 过期时间（默认 10 分钟） */
export function createApprovalRequest(
  tool: string,
  resourceKey: string,
  args: unknown,
  ttlMs = 10 * 60 * 1000,
  now: Date = new Date(),
): ApprovalRequest {
  return {
    tool,
    resourceKey,
    argsJson: JSON.stringify(args ?? {}),
    token: randomBytes(24).toString('hex'),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
}

/** 调用方回传令牌时校验：令牌一致 + 未过期 + 参数指纹未变 */
export function verifyApproval(
  request: ApprovalRequest,
  token: string,
  args: unknown,
  now: Date = new Date(),
): ApprovalDecision {
  const expected = createHash('sha256').update(request.token).digest();
  const actual = createHash('sha256').update(token).digest();
  if (!timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'invalid_token' };
  }
  if (new Date(request.expiresAt) <= now) {
    return { ok: false, reason: 'token_expired' };
  }
  const argsJson = JSON.stringify(args ?? {});
  if (argsJson !== request.argsJson) {
    return { ok: false, reason: 'args_mismatch' };
  }
  return { ok: true };
}

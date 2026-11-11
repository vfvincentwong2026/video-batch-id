import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUse, createApprovalRequest, verifyApproval } from '../src/index.ts';
import type { RightsRecord } from '@vbid/shared-schema';

const base: RightsRecord = {
  assetId: 'mas_1',
  license: '客户书面授权二创',
  status: 'Cleared',
  channels: ['tiktok', 'instagram'],
  territories: ['Global'],
  embargoUntil: null,
  expiresAt: null,
};

const NOW = new Date('2026-11-12T00:00:00Z');

test('checkUse：无权利记录 → no_rights_record', () => {
  const r = checkUse(null, { channel: 'tiktok' }, NOW);
  assert.deepEqual(r, { allowed: false, reason: 'no_rights_record', replacementId: null });
});

test('checkUse：状态非 Cleared → 拒绝', () => {
  assert.equal(checkUse({ ...base, status: 'Restricted' }, { channel: 'tiktok' }, NOW).reason, 'rights_restricted');
  assert.equal(checkUse({ ...base, status: 'Expired' }, { channel: 'tiktok' }, NOW).reason, 'rights_expired');
});

test('checkUse：渠道/地区不在授权范围 → 拒绝', () => {
  assert.equal(checkUse(base, { channel: 'youtube' }, NOW).reason, 'channel_not_licensed');
  const cnOnly = { ...base, territories: ['ID'] };
  assert.equal(checkUse(cnOnly, { channel: 'tiktok', territory: 'CN' }, NOW).reason, 'territory_not_licensed');
  assert.equal(checkUse(cnOnly, { channel: 'tiktok', territory: 'ID' }, NOW).allowed, true);
});

test('checkUse：禁发期与到期时间判定', () => {
  const embargoed = { ...base, embargoUntil: '2026-12-01T00:00:00Z' };
  assert.equal(checkUse(embargoed, { channel: 'tiktok' }, NOW).reason, 'embargo_active');
  assert.equal(checkUse(embargoed, { channel: 'tiktok' }, new Date('2026-12-02T00:00:00Z')).allowed, true);
  const expiring = { ...base, expiresAt: '2026-11-12T00:00:00Z' };
  assert.equal(checkUse(expiring, { channel: 'tiktok' }, NOW).reason, 'rights_expired');
});

test('checkUse：Global 地区兜底通过', () => {
  assert.deepEqual(checkUse(base, { channel: 'instagram', territory: 'ID' }, NOW), { allowed: true, reason: 'ok', replacementId: null });
});

test('审批令牌：完整往返（颁发 → 回传校验通过 → 参数篡改拒绝 → 过期拒绝）', () => {
  const args = { taskId: 'tsk_1', tier: 'standard' };
  const req = createApprovalRequest('submit_generation', 'task:generate:tsk_1', args, 60000, NOW);
  assert.equal(req.tool, 'submit_generation');

  assert.deepEqual(verifyApproval(req, req.token, args, NOW), { ok: true });
  assert.equal(verifyApproval(req, 'wrong-token', args, NOW).reason, 'invalid_token');
  assert.equal(verifyApproval(req, req.token, { ...args, tier: 'economy' }, NOW).reason, 'args_mismatch');
  assert.equal(verifyApproval(req, req.token, args, new Date(NOW.getTime() + 120_000)).reason, 'token_expired');
});

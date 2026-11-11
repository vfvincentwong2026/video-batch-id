import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.ts';

let app: ReturnType<typeof createApp>;
let base: string;

before(async () => {
  app = createApp(':memory:');
  await new Promise<void>((resolve) => {
    app.server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
  delete process.env.VBID_GEN_API_KEY;
  delete process.env.VBID_VLM_API_KEY;
});

after(() => {
  app.server.close();
  app.close();
});

async function rpc(method: string, params?: unknown, id: number | string = 1) {
  const res = await fetch(base + '/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return { status: res.status, data: await res.json(), headers: res.headers };
}

async function callTool(name: string, args: Record<string, unknown>, id = 1) {
  return rpc('tools/call', { name, arguments: args }, id);
}

function toolText(r: { data: { result?: { content?: Array<{ text: string }> } } }) {
  return JSON.parse(r.data.result!.content![0].text);
}

let masterId = '';
let variantId = '';
let taskId = '';

test('initialize / ping / tools/list：12 个契约全量暴露（含审批语义描述）', async () => {
  const init = await rpc('initialize', { protocolVersion: '2024-11-05' });
  assert.equal(init.status, 200);
  assert.equal(init.data.result.serverInfo.name, 'vbid-mcp');
  assert.ok(init.headers.get('mcp-session-id'));

  const ping = await rpc('ping');
  assert.deepEqual(ping.data.result, {});

  const list = await rpc('tools/list');
  assert.equal(list.data.result.tools.length, 12);
  const names = list.data.result.tools.map((t: { name: string }) => t.name);
  for (const n of ['search_assets', 'get_lineage', 'parse_master', 'suggest_matrix', 'check_use',
    'get_analysis', 'create_task', 'review_variant', 'record_usage', 'write_knowledge',
    'submit_generation', 'register_skill']) {
    assert.ok(names.includes(n), `missing tool ${n}`);
  }
  const submit = list.data.result.tools.find((t: { name: string }) => t.name === 'submit_generation');
  assert.match(submit.description, /gated/);
  assert.equal(submit.inputSchema.required[0], 'taskId');
});

test('low risk 只读工具直通：parse_master → get_analysis → suggest_matrix → search_assets → get_lineage', async () => {
  const reg = await fetch(base + '/api/assets', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'master', filename: 'mcp-target.mp4', duration_ms: 11000 }),
  });
  masterId = (await reg.json()).asset.id;

  const parsed = await callTool('parse_master', { assetId: masterId });
  assert.equal(parsed.data.result.content[0].type, 'text');

  const analysis = toolText(await callTool('get_analysis', { assetId: masterId }));
  assert.equal(analysis.structure.length, 4);
  assert.equal(analysis.hooks.length, 2);

  const sugg = toolText(await callTool('suggest_matrix', { assetId: masterId }));
  assert.equal(sugg.engine, 'rule-v1');

  const search = toolText(await callTool('search_assets', { query: 'mcp-target' }));
  assert.equal(search.total, 1);
  assert.equal(search.assets[0].id, masterId);

  // check_use：无 rights 记录 → no_rights_record（治理语义，不默认放行）
  const use = toolText(await callTool('check_use', { assetId: masterId, channel: 'tiktok' }));
  assert.equal(use.allowed, false);
  assert.equal(use.reason, 'no_rights_record');

  const lineage = toolText(await callTool('get_lineage', { masterId }));
  assert.equal(lineage.master.id, masterId);
  assert.deepEqual(lineage.variants, []);
});

test('rights 登记后 check_use 按渠道/地区裁决（REST 写 → MCP 读）', async () => {
  const r = await fetch(base + `/api/assets/${masterId}/rights`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ license: '客户书面授权二创', status: 'Cleared', channels: ['tiktok', 'x'], territories: ['Global'] }),
  });
  assert.equal(r.status, 200);

  const ok = toolText(await callTool('check_use', { assetId: masterId, channel: 'tiktok' }));
  assert.equal(ok.allowed, true);
  const badChannel = toolText(await callTool('check_use', { assetId: masterId, channel: 'youtube' }));
  assert.equal(badChannel.allowed, false);
  assert.equal(badChannel.reason, 'channel_not_licensed');
});

test('gated 工具 create_task：首调 -32042 发令牌 → 挪用 403 → 同参数+token 执行', async () => {
  const r1 = await callTool('create_task', { masterAssetId: masterId, variantCount: 2 });
  assert.equal(r1.data.error.code, -32042);
  const token = r1.data.error.data.approval_token;
  assert.ok(token.length >= 32);
  assert.equal(r1.data.error.data.masterAssetId, masterId);

  // 挪用（改条数）→ -32043 args_mismatch
  const r2 = await callTool('create_task', { masterAssetId: masterId, variantCount: 3, approval_token: token });
  assert.equal(r2.data.error.code, -32043);
  assert.match(r2.data.error.message, /args_mismatch/);

  // 同参数 + token → 执行成功，task 可跑 mock
  const r3 = await callTool('create_task', { masterAssetId: masterId, variantCount: 2, approval_token: token });
  assert.ok(r3.data.result);
  taskId = toolText(r3).taskId;
  assert.ok(taskId.startsWith('tsk_'));

  // 令牌已消费，复用 → -32043
  const r4 = await callTool('create_task', { masterAssetId: masterId, variantCount: 2, approval_token: token });
  assert.equal(r4.data.error.code, -32043);
});

test('review_variant（low risk）直通并沉淀 rule 知识；write_knowledge（gated）双段审批', async () => {
  // mock 跑任务产出变体
  const run = await fetch(base + `/api/tasks/${taskId}/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ generator: 'mock' }),
  });
  assert.equal(run.status, 200);
  const detail = await (await fetch(base + `/api/tasks/${taskId}`)).json();
  variantId = detail.variants[0].id;

  const rev = await callTool('review_variant', { variantId, outcome: 'good' });
  assert.equal(toolText(rev).outcome, 'good');
  const rule = app.db.prepare(`SELECT * FROM knowledge_entries WHERE layer = 'rule' AND subject_key = ?`).all(masterId);
  assert.equal(rule.length, 1);

  // write_knowledge gated：首调拒绝 → 二调写入 manual 层
  const w1 = await callTool('write_knowledge', { subjectKey: 'global', layer: 'manual', content: { note: 'CTA 尾帧必须出现价格' } });
  assert.equal(w1.data.error.code, -32042);
  const w2 = await callTool('write_knowledge', {
    subjectKey: 'global', layer: 'manual', content: { note: 'CTA 尾帧必须出现价格' },
    approval_token: w1.data.error.data.approval_token,
  });
  assert.equal(toolText(w2).written, true);
});

test('submit_generation：无 key 明确报错；register_skill：审批门通过后被 P3 门槛拦截（信息一致）', async () => {
  // 无 key → 工具级错误（不走审批）
  const s0 = await callTool('submit_generation', { taskId });
  assert.equal(s0.data.error.code, -32603);
  assert.match(s0.data.error.message, /VBID_GEN_API_KEY/);

  // register_skill：two-call 审批门照常工作，但审批通过后 P3 门槛（≥3 任务/≥8 变体/👍率≥60%）拒绝注册
  const g1 = await callTool('register_skill', { name: 'candy-hook-recipe', taskId, tier: 'standard' });
  assert.equal(g1.data.error.code, -32042);
  const g2 = await callTool('register_skill', {
    name: 'candy-hook-recipe', taskId, tier: 'standard',
    approval_token: g1.data.error.data.approval_token,
  });
  assert.equal(g2.data.error.code, -32602);
  assert.match(g2.data.error.message, /门槛未达/);
});

test('协议防护：坏 JSON -32700；未知方法 -32601；未知工具 -32601；GET 405 引导 POST', async () => {
  const bad = await fetch(base + '/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops',
  });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, -32700);

  const unknown = await rpc('tools/frobnicate');
  assert.equal(unknown.data.error.code, -32601);

  const unknownTool = await callTool('no_such_tool', {});
  assert.equal(unknownTool.data.error.code, -32601);

  const get = await fetch(base + '/mcp');
  assert.equal(get.status, 405);

  const cors = await fetch(base + '/mcp', { method: 'OPTIONS' });
  assert.equal(cors.status, 204);
  assert.equal(cors.headers.get('access-control-allow-origin'), '*');
});

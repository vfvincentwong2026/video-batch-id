/**
 * scripts/a2a-verify.mjs —— P4 A2A 对接验证：以「DAM 侧 Agent」视角走通 Video Batch ID 生产线。
 *
 * 做法：进程内拉起 createApp(':memory:')（零费用、不碰真实 key/素材），纯 MCP 协议驱动：
 *   initialize → tools/list → search_assets → parse_master → get_analysis → suggest_matrix
 *   → check_use（rights 经 REST 平面登记，与 DAM 三平面分工一致）
 *   → create_task（two-call 审批）→ submit_generation（审批门验证到令牌层即停，不真实扣费）
 *   → review_variant ×2 → suggest_matrix 复查（知识回放 overlay 生效）
 *   → GET /.well-known/agent.json（Agent Card）
 *
 * 运行：node scripts/a2a-verify.mjs   （退出码 0 = 全链 PASS）
 */
import { createApp } from '../apps/api/src/server.ts';

const app = createApp(':memory:');
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const port = app.server.address().port;
const base = `http://127.0.0.1:${port}`;
// 假 key： submit_generation 的审批门需要"key 存在"才发令牌；预算查询软失败返回 null，不触网扣费语义
process.env.VBID_GEN_API_KEY = 'sk-a2a-verify';

let step = 0;
const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✅' : '❌'} ${String(++step).padStart(2)} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) { console.error('FAIL at:', name); app.server.close(); app.close(); process.exit(1); }
}
async function rpc(method, params, id = step + 1) {
  const res = await fetch(base + '/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return res.json();
}
const txt = (r) => JSON.parse(r.result.content[0].text);
/** gated 工具两段式：-32042 → 自动带令牌重发同一参数 */
async function callGated(name, args) {
  const first = await rpc('tools/call', { name, arguments: args });
  if (first.error?.code === -32042) {
    return rpc('tools/call', { name, arguments: { ...args, approval_token: first.error.data.approval_token } });
  }
  return first;
}

// ---- 0) Agent Card：DAM Agent 发现执行体 ----
const card = await (await fetch(base + '/.well-known/agent.json')).json();
report('Agent Card 发现', card.name === 'video-batch-id' && card.mcp.endpoint.endsWith('/mcp'), `${card.name} @ ${card.mcp.endpoint}`);

// ---- 1) MCP 握手 ----
const init = await rpc('initialize', { protocolVersion: '2024-11-05' });
report('initialize', init.result?.serverInfo?.name === 'vbid-mcp');
const list = await rpc('tools/list');
report('tools/list = 12 契约', list.result.tools.length === 12);

// ---- 2) 素材入库（ingest 是人/REST 平面，Agent 不越权）----
const reg = await (await fetch(base + '/api/assets', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ kind: 'master', filename: 'a2a-demo-candy.mp4', duration_ms: 11000 }),
})).json();
const masterId = reg.asset.id;
const rights = await (await fetch(base + `/api/assets/${masterId}/rights`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ license: '客户书面授权二创', status: 'Cleared', channels: ['tiktok'], territories: ['Global'] }),
})).json();
report('素材入库 + rights 登记（REST 平面）', Boolean(masterId && rights.rights));

// ---- 3) Agent 生产线（全部走 /mcp）----
report('search_assets 命中', txt(await rpc('tools/call', { name: 'search_assets', arguments: { query: 'a2a-demo' } })).total === 1);
report('parse_master', Boolean(txt(await rpc('tools/call', { name: 'parse_master', arguments: { assetId: masterId } })).parsed));
report('get_analysis 关键内容', txt(await rpc('tools/call', { name: 'get_analysis', arguments: { assetId: masterId } })).structure.length === 4);
report('suggest_matrix 智能推荐', txt(await rpc('tools/call', { name: 'suggest_matrix', arguments: { assetId: masterId } })).engine === 'rule-v1');
const use = txt(await rpc('tools/call', { name: 'check_use', arguments: { assetId: masterId, channel: 'tiktok' } }));
report('check_use 渠道裁决', use.allowed === true, `rights=Cleared → ${use.reason}`);

const ct = await callGated('create_task', { masterAssetId: masterId, variantCount: 8 });
const taskId = txt(ct).taskId;
report('create_task（two-call 审批通过）', Boolean(taskId), taskId);

// submit_generation：验证审批门到令牌层即停——确认后二调才会真实扣费（本验证零费用）
const sg = await rpc('tools/call', { name: 'submit_generation', arguments: { taskId, tier: 'economy' } });
const gate = sg.error?.data;
report('submit_generation 审批门（-32042 含金额/余量/档位，未执行不扣费）',
  sg.error?.code === -32042 && gate?.estimated_cost_usd === 0.96 && gate?.tier === 'economy',
  `预估 $${gate?.estimated_cost_usd} · 余量 ${gate?.key_remaining_usd ?? '查询失败(null)'}`);

// mock 执行（REST 平面，Agent 侧等价于 submit_generation 审批后执行）
const run = await (await fetch(base + `/api/tasks/${taskId}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ generator: 'mock' }) })).json();
report('任务执行（mock）', run.summary?.acceptedCount >= 1, `通过 ${run.summary?.acceptedCount}/${run.summary?.variantCount}`);

// ---- 4) 学习闭环：审核（同取值 👍×2 → proven）→ 知识回放 overlay ----
const detail = await (await fetch(base + `/api/tasks/${taskId}`)).json();
const groups = new Map();
for (const v of detail.variants) {
  const meta = JSON.parse(v.meta_json || '{}');
  const key = meta.spec?.assignments?.visual ?? '?';
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(v.id);
}
const top = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0];
for (const vid of top[1].slice(0, 2)) {
  await rpc('tools/call', { name: 'review_variant', arguments: { variantId: vid, outcome: 'good' } });
}
const sugg2 = txt(await rpc('tools/call', { name: 'suggest_matrix', arguments: { assetId: masterId } }));
const proven = sugg2.overlay?.hints?.filter((h) => h.verdict === 'proven') ?? [];
report('review_variant → 知识回放 overlay 生效（同取值 👍×2 = proven）',
  sugg2.overlay?.engine === 'review-feedback' && proven.length >= 1,
  `visual=${proven[0]?.option} 👍${proven[0]?.good}`);

console.log(`\nA2A 验证完成：${results.length}/${results.length} PASS — Agent 全链走通，审批门零误放行`);
app.server.close();
app.close();
process.exit(0);

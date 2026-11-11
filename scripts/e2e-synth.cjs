// 端到端合成素材验证：摄入 → 矩阵 → 建任务(审批) → 真实生成(审批) → 产物验证
// 用法：node scripts/e2e-synth.mjs
const http = require('http');
const MASTER_DIR = 'D:\\桌面工作\\AI project\\Video Batch ID\\Master Asset\\SYNTHETIC-TEST';
const FILENAME = 'SYNTH_TEST_001.mp4';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      { host: 'localhost', port: 8000, path, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } }); },
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function mcpCall(name, args) {
  const r = await req('POST', '/mcp', { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } });
  const msg = r.body;
  if (msg.error) {
    const err = new Error(`MCP_ERROR`);
    err.code = msg.error.code;
    err.data = msg.error.data;
    err.messageText = msg.error.message;
    throw err;
  }
  const text = msg.result?.content?.find((c) => c.type === 'text')?.text;
  return text ? JSON.parse(text) : msg.result;
}

// gated 两段式：首次拿令牌，二次执行
async function mcpGated(name, args) {
  try {
    await mcpCall(name, args);
    throw new Error(name + ' 应触发审批但直接执行了');
  } catch (e) {
    if (e.code !== -32042) throw e;
    const token = e.data && e.data.approval_token;
    if (!token) throw new Error('审批响应缺 approval_token: ' + JSON.stringify(e.data));
    return { approval: e.data, result: await mcpCall(name, { ...args, approval_token: token }) };
  }
}

const step = async (label, fn) => {
  const out = await fn();
  console.log('PASS  ' + label);
  return out;
};

async function main() {
// 1) 摄入
const scan = await step('scan-dir 摄入', () => req('POST', '/api/assets/scan-dir', { dir: MASTER_DIR }));
console.log('   scan:', JSON.stringify(scan.body).slice(0, 300));
const all = [...(scan.body.registered || []), ...(scan.body.skipped || [])];
const master = all.find((a) => a.filename === FILENAME);
if (!master) { console.log('FAIL  未找到 ' + FILENAME); process.exit(1); }
console.log('PASS  素材在库: ' + master.id);

// 2) 矩阵建议（验证 ffprobe 探测 + 解析管线对真实文件生效）
try {
  const sug = await step('MCP suggest_matrix', () => mcpCall('suggest_matrix', { assetId: master.id }));
  console.log('   ', JSON.stringify(sug).slice(0, 250));
} catch (e) {
  console.log('WARN  suggest_matrix: ' + (e.messageText || e.message));
}

// 3) 建任务（gated）
const { result: taskInfo } = await step('MCP create_task（两段式审批）', () =>
  mcpGated('create_task', { masterAssetId: master.id, variantCount: 1 }));
console.log('   task:', JSON.stringify(taskInfo).slice(0, 250));
const taskId = taskInfo.taskId;

// 4) 真实生成（gated，economy 档）
console.log('>>> 提交真实生成（OpenRouter economy，约 $0.12，HTTP 长连接等待完成）...');
const { approval, result: genResult } = await step('MCP submit_generation（两段式审批）', () =>
  mcpGated('submit_generation', { taskId, tier: 'economy' }));
console.log('   审批信息: tier=' + approval.tier_preset + ' cost=' + approval.estimated_cost_usd + 'USD key余量=' + approval.key_remaining_usd);
console.log('   执行结果:', JSON.stringify(genResult).slice(0, 300));

// 5) 任务终态与产物
const t = await req('GET', '/api/tasks/' + taskId);
const task = t.body.task || t.body;
console.log('PASS  任务终态: status=' + task.status + ' cost=' + (task.actual_cost_usd ?? task.actualCostUsd));
if (task.status !== 'done') { console.log('FAIL  任务未 done'); process.exit(1); }

const vars = await req('GET', '/api/assets?kind=variant&taskId=' + taskId);
const list = vars.body.assets || vars.body || [];
console.log('PASS  产物变体数: ' + list.length);
console.log('\n全部通过 ✅');
process.exit(0);

}
main().catch((e) => { console.error("FAIL  未捕获异常:", e.messageText || e.message); process.exit(1); });

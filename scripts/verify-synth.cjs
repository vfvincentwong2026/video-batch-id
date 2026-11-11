// 验证合成素材任务的产物与成本落库
const http = require('http');
const TASK_ID = 'tsk_mwcgxxhqzcjtp9';
const MASTER_ID = 'mas_mwcgxxgnfi9gkj';
function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port: 8000, path }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } }); }).on('error', reject);
  });
}
function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const r = http.request({ host: 'localhost', port: 8000, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } }); });
    r.on('error', reject); r.write(data); r.end();
  });
}
(async () => {
  // 1) 补跑 parse（验证真实文件解析管线）
  const p = await post('/api/assets/' + MASTER_ID + '/parse', {});
  console.log('parse:', JSON.stringify(p).slice(0, 400));
  // 2) 任务详情
  const t = await get('/api/tasks/' + TASK_ID);
  const task = t.task || t;
  console.log('\ntask status:', task.status, '| actual_cost:', task.actual_cost_usd, '| est:', task.estimated_cost_usd);
  // 3) 该任务的变体
  const assets = await get('/api/assets');
  const list = (assets.assets || assets).filter((a) => a.task_id === TASK_ID);
  console.log('variants for task:', list.length);
  for (const v of list.slice(0, 5)) {
    const meta = JSON.parse(v.meta_json || '{}');
    console.log(' -', v.id, v.status, '| fileRef:', JSON.stringify(meta.fileRef), '| cost:', meta.gen && meta.gen.usageCostUsd, '| generator:', meta.gen && meta.gen.generator);
  }
})().catch((e) => { console.error(e); process.exit(1); });

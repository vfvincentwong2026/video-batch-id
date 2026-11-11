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

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function sendA2a(text: string) {
  return api('POST', '/a2a/message/send', { message: { parts: [{ type: 'text', text }] } });
}

let masterId = '';
let taskId = '';

test('MCP 新增工具：list_tasks / search_knowledge / list_skills（SPA 切 MCP 的依赖）', async () => {
  const m = await api('POST', '/api/assets', { kind: 'master', filename: 'a2a-tools.mp4', duration_ms: 11000 });
  masterId = m.data.asset.id;
  await api('POST', `/api/assets/${masterId}/parse`, {});
  const t = await api('POST', '/api/tasks', { master_asset_id: masterId, variant_count: 2 });
  taskId = t.data.task.id;
  await api('POST', `/api/tasks/${taskId}/run`, { generator: 'mock' });

  const rpc = async (name: string, args: unknown) => {
    const res = await fetch(base + '/mcp', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const d = await res.json();
    return d.error ?? JSON.parse(d.result.content[0].text);
  };

  const tasks = await rpc('list_tasks', {});
  assert.equal(tasks.tasks.length, 1);
  assert.equal(tasks.tasks[0].id, taskId);
  const doneOnly = await rpc('list_tasks', { status: 'done' });
  assert.equal(doneOnly.tasks.length, 1);

  const knl = await rpc('search_knowledge', { layer: 'raw', subjectKey: masterId });
  assert.equal(knl.entries.length, 1);
  assert.equal(knl.total, 1);

  const skills = await rpc('list_skills', {});
  assert.deepEqual(skills.skills, []);
});

test('A2A 委派：帮助 / 分析意图（只读编排）/ 状态查询 / 状态历史', async () => {
  const help = await sendA2a('你能做什么');
  assert.equal(help.status, 200);
  assert.equal(help.data.status, 'completed');
  assert.match(help.data.artifacts[0].text, /可委派的事/);
  assert.ok(help.data.stateTransitionHistory.length >= 2);

  const analysis = await sendA2a(`帮我分析这条素材 ${masterId}`);
  assert.equal(analysis.status, 200);
  assert.match(analysis.data.artifacts[0].text, /镜头/);
  assert.equal(analysis.data.artifacts.length, 1); // 纯分析不产生 draft

  const status = await sendA2a(`状态 ${taskId}`);
  assert.match(status.data.artifacts[0].text, /status=done/);

  // 状态历史可查（A2A stateTransitionHistory 能力）
  const hist = await api('GET', `/a2a/tasks/${status.data.contextId}`);
  assert.equal(hist.status, 200);
  assert.equal(hist.data.id, status.data.contextId);
  assert.ok(hist.data.stateTransitionHistory.length >= 2);
  const missing = await api('GET', '/a2a/tasks/a2a_nope');
  assert.equal(missing.status, 404);
});

test('A2A 委派：二创意图 → 产出 draft 提案但绝不自动执行 gated 动作（治理红线）', async () => {
  const before = app.db.prepare(`SELECT COUNT(*) AS n FROM tasks`).get() as { n: number };

  const r = await sendA2a(`帮我二创这条素材，生成一批变体 ${masterId}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'completed');
  assert.equal(r.data.artifacts.length, 2);
  assert.match(r.data.artifacts[1].text, /【draft 提案】/);
  assert.match(r.data.artifacts[1].text, /-32042/);
  assert.match(r.data.artifacts[1].text, /不自动执行/);

  // 零副作用：没有创建任何任务、审批、知识
  const after = app.db.prepare(`SELECT COUNT(*) AS n FROM tasks`).get() as { n: number };
  assert.equal(after.n, before.n);
  const approvals = app.db.prepare(`SELECT COUNT(*) AS n FROM approvals`).get() as { n: number };
  assert.equal(approvals.n, 0);
});

test('A2A 委派：坏 masterId → failed 状态 + 错误 artifact（不抛出 500）', async () => {
  const r = await sendA2a('帮我分析 mas_deadbeef000');
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'failed');
  assert.match(r.data.artifacts[0].text, /master not found/);
});

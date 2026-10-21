/* Video Batch ID 工作台 · v0.1 零构建 SPA
 * 视图：工作台 / 上传解析 / 变量矩阵 / 任务队列 / 审核 / 素材谱系
 * 对应 README 工作流 A 的 ①→⑧ 步。
 */

const view = document.getElementById('view');

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status}`);
  return data;
}

function toast(msg, isErr = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function badge(status) {
  return `<span class="badge ${esc(status)}">${esc(status)}</span>`;
}

// ---------- 视图 ----------

async function renderDashboard() {
  const [assets, tasks] = await Promise.all([
    api('GET', '/api/assets'), api('GET', '/api/tasks'),
  ]);
  const masters = assets.assets.filter((a) => a.kind === 'master');
  const variants = assets.assets.filter((a) => a.kind === 'variant');
  const accepted = variants.filter((v) => v.status === 'accepted');
  const reviewed = variants.filter((v) => v.review !== null && v.review !== undefined);
  const good = variants.filter((v) => v.review === 1);
  const cost = tasks.tasks.reduce((s, t) => s + (t.estimated_cost_usd || 0), 0);
  view.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="num">${masters.length}</div><div class="label">Master 素材</div></div>
      <div class="stat"><div class="num">${variants.length}</div><div class="label">变体总数</div></div>
      <div class="stat"><div class="num">${variants.length ? Math.round(accepted.length / variants.length * 100) : 0}%</div><div class="label">守卫通过率</div></div>
      <div class="stat"><div class="num">${reviewed.length ? Math.round(good.length / reviewed.length * 100) : 0}%</div><div class="label">审核好评率</div></div>
      <div class="stat"><div class="num">$${cost.toFixed(2)}</div><div class="label">累计预估成本</div></div>
    </div>
    <div class="panel">
      <h2>快速开始（工作流 A）</h2>
      <p class="muted">① <a href="#/upload">上传参考素材</a> → ② 解析确认 → ③ <a href="#/matrix">勾选变量</a> → ⑤ <a href="#/queue">批量生成</a> → ⑥ <a href="#/review">审核入库</a> → ⑧ <a href="#/lineage">查看谱系</a></p>
    </div>
    <div class="panel">
      <h2>最近任务</h2>
      ${tasks.tasks.length ? `<table><tr><th>任务</th><th>Master</th><th>变体数</th><th>预估成本</th><th>状态</th></tr>
        ${tasks.tasks.slice(0, 8).map((t) => `<tr><td>${esc(t.id)}</td><td>${esc(t.master_asset_id)}</td><td>${t.variant_count}</td><td>$${t.estimated_cost_usd}</td><td>${badge(t.status)}</td></tr>`).join('')}</table>`
        : '<p class="muted">还没有任务，从 ① 上传素材开始。</p>'}
    </div>`;
}

async function renderUpload() {
  view.innerHTML = `
    <div class="panel">
      <h2>① 上传参考视频（Master Asset）</h2>
      <p class="muted">v0.1 骨架模式登记元信息；文件本体存放接入后置。拖入一条已跑通的爆款。</p>
      <div class="form-row">
        <div><label>文件名（如 sambal-matah-hit.mp4）</label><input id="f-name" placeholder="master.mp4"></div>
        <div><label>时长（毫秒）</label><input id="f-dur" type="number" value="11000"></div>
        <div><label>备注（可选）</label><input id="f-note" placeholder="播放 50万 · 带货 2000单"></div>
        <button id="btn-upload">上传并解析 →</button>
      </div>
    </div>
    <div id="parse-result"></div>`;
  document.getElementById('btn-upload').onclick = async () => {
    const filename = document.getElementById('f-name').value.trim();
    const durationMs = Number(document.getElementById('f-dur').value);
    const note = document.getElementById('f-note').value.trim();
    if (!filename) return toast('请填写文件名', true);
    try {
      const { asset } = await api('POST', '/api/assets', {
        kind: 'master', filename, duration_ms: durationMs, meta: { note },
      });
      const { parsed } = await api('POST', `/api/assets/${asset.id}/parse`, {});
      toast(`解析完成：${parsed.shots.length} 镜头 · ${parsed.bgm.bpm ?? '?'} BPM`);
      document.getElementById('parse-result').innerHTML = `
        <div class="panel">
          <h2>② 解析结果（可修正，v0.1 为 mock 解析）</h2>
          <table><tr><th>#</th><th>时间轴</th><th>类型</th><th>画面描述</th></tr>
          ${parsed.shots.map((s) => `<tr><td>${s.index}</td><td>${(s.startMs / 1000).toFixed(1)}s – ${(s.endMs / 1000).toFixed(1)}s</td><td>${esc(s.type)}</td><td>${esc(s.description)}</td></tr>`).join('')}
          </table>
          <p class="muted">文案：「${esc(parsed.transcript)}」 · BGM：${esc(parsed.bgm.style)} · 平均 ${parsed.rhythm.avgShotSec}s/镜头</p>
          <button onclick="location.hash='#/matrix'">下一步：③ 勾选变量 →</button>
        </div>`;
    } catch (e) { toast(e.message, true); }
  };
}

async function renderMatrix() {
  const { assets } = await api('GET', '/api/assets?kind=master');
  if (!assets.length) {
    view.innerHTML = '<div class="panel"><h2>③ 变量矩阵</h2><p class="muted">请先 <a href="#/upload">上传 Master 素材</a>。</p></div>';
    return;
  }
  const masters = assets;
  const selected = masters[0];
  const meta = JSON.parse(selected.meta_json || '{}');
  const parsed = meta.parse;
  view.innerHTML = `
    <div class="panel">
      <h2>③ 变量矩阵：勾选「变什么、锁什么」</h2>
      <div class="form-row" style="grid-template-columns: 1fr 2fr;">
        <div><label>Master 素材</label>
          <select id="m-master">${masters.map((m) => `<option value="${m.id}" ${m.id === selected.id ? 'selected' : ''}>${esc(m.filename)}</option>`).join('')}</select>
        </div>
        <div><label>解析摘要</label>
          <p class="muted" style="margin:8px 0 0">${parsed ? `${parsed.shots.length} 镜头 · ${esc(parsed.bgm.style)} ${parsed.bgm.bpm ?? '?'}BPM · Hook: ${parsed.hooks.map((h) => esc(h.phrase)).join(' / ')}` : '未解析，请到 ① 页先解析'}</p>
        </div>
      </div>
      <div id="dim-grid" class="dim-grid" style="margin-top:16px"></div>
      <div class="form-row" style="grid-template-columns: 1fr 2fr auto; margin-top:16px">
        <div><label>变体数量</label><input id="m-count" type="number" value="30"></div>
        <div><label>组合空间（启用维度选项数乘积）</label><div id="m-space" class="num" style="font-size:22px;font-weight:700"></div></div>
        <button id="m-create">创建生成任务 →</button>
      </div>
    </div>`;

  // 六维卡片（默认矩阵）
  const dims = [
    { key: 'visual', label: '视觉', enabled: true, options: ['厨房台面', '餐厅', '户外野餐', '办公室'], locked: ['产品外观', '关键动作', '品牌色'] },
    { key: 'copy', label: '文案', enabled: true, options: ['Hook=倾倒', 'Hook=拉丝', 'Hook=试吃', 'Hook=开盖'], locked: ['核心信息', '品牌调性'] },
    { key: 'person', label: '人物', enabled: false, options: ['模特 A', '模特 B', '模特 C'], locked: ['镜头角度', '动作节奏'] },
    { key: 'rhythm', label: '节奏', enabled: false, options: ['快切', '慢节奏'], locked: ['关键镜头顺序'] },
    { key: 'audio', label: '音频', enabled: false, options: ['印尼民谣', '流行', '电子'], locked: ['口播内容'] },
    { key: 'technical', label: '技术', enabled: false, options: ['9:16 · 720p', '9:16 · 1080p'], locked: [] },
  ];
  const grid = document.getElementById('dim-grid');
  grid.innerHTML = dims.map((d, i) => `
    <div class="dim-card ${d.enabled ? '' : 'locked'}" data-i="${i}">
      <h3>${d.label} <label style="display:inline;margin:0"><input type="checkbox" class="dim-toggle" data-i="${i}" ${d.enabled ? 'checked' : ''} style="width:auto"> 参与变化</label></h3>
      <div>${d.options.map((o) => `<span class="opt">${esc(o)}</span>`).join('')}</div>
      <div class="locked-list">🔒 锁定：${d.locked.length ? d.locked.join('、') : '—'}</div>
    </div>`).join('');

  function currentSpace() {
    let space = 1;
    document.querySelectorAll('.dim-toggle').forEach((t) => {
      if (t.checked) space *= dims[Number(t.dataset.i)].options.length;
    });
    return space;
  }
  const spaceEl = document.getElementById('m-space');
  const updateSpace = () => {
    const s = currentSpace();
    spaceEl.textContent = `${s} 种`;
  };
  grid.addEventListener('change', (e) => {
    if (!e.target.classList.contains('dim-toggle')) return;
    const card = e.target.closest('.dim-card');
    card.classList.toggle('locked', !e.target.checked);
    updateSpace();
  });
  updateSpace();

  document.getElementById('m-create').onclick = async () => {
    const masterId = document.getElementById('m-master').value;
    const variantCount = Number(document.getElementById('m-count').value);
    try {
      const { task } = await api('POST', '/api/tasks', { master_asset_id: masterId, variant_count: variantCount });
      toast(`任务已创建：${task.variant_count} 条 · 预估 $${task.estimated_cost_usd}`);
      location.hash = '#/queue';
    } catch (e) { toast(e.message, true); }
  };
}

async function renderQueue() {
  const { tasks } = await api('GET', '/api/tasks');
  view.innerHTML = `
    <div class="panel">
      <h2>⑤ 任务队列</h2>
      ${tasks.length ? `<table><tr><th>任务</th><th>Master</th><th>变体数</th><th>预估成本</th><th>状态</th><th></th></tr>
      ${tasks.map((t) => `<tr>
        <td>${esc(t.id)}</td><td>${esc(t.master_asset_id)}</td><td>${t.variant_count}</td><td>$${t.estimated_cost_usd}</td>
        <td>${badge(t.status)}</td>
        <td>${t.status === 'queued' ? `<button class="small" data-run="${t.id}">▶ 生成</button>` : ''}</td>
      </tr>`).join('')}</table>` : '<p class="muted">队列为空，到 <a href="#/matrix">③ 变量矩阵</a> 创建任务。</p>'}
    </div>
    <div id="run-result"></div>`;
  document.querySelectorAll('[data-run]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const r = await api('POST', `/api/tasks/${btn.dataset.run}/run`, {});
        const cap = r.summary.spaceCapped ? `（组合空间 ${r.summary.variantCount} 种 < 请求 ${r.summary.requestedCount}，已按上限产出）` : '';
        toast(`完成${cap}：通过 ${r.summary.acceptedCount} · 拦截 ${r.summary.rejectedCount}`);
        renderQueue();
      } catch (e) { toast(e.message, true); btn.disabled = false; }
    };
  });
}

async function renderReview() {
  const { assets } = await api('GET', '/api/assets?kind=variant');
  view.innerHTML = `
    <div class="panel">
      <h2>⑥ 审核（网格视图）</h2>
      <p class="muted">👍 好评入库 · 👎 废片。守卫未通过的变体不会进入合格队列（绿色/红色边框 = 已审核 👍/👎）。</p>
      ${assets.length ? `<div class="review-grid">
        ${assets.map((v) => {
          const meta = JSON.parse(v.meta_json || '{}');
          const reviewClass = v.review === 1 ? 'review-good' : v.review === 0 ? 'review-bad' : '';
          return `<div class="variant-card ${reviewClass}" data-id="${v.id}">
            <h4>${esc(v.filename)}</h4>
            <div class="desc">${esc(meta.descriptor || '')}</div>
            <div class="guards">保真 ${meta.guards?.fidelity?.score ?? '?'} ${meta.guards?.fidelity?.passed ? '✅' : '❌'} · 去重 ${meta.guards?.dedup?.score ?? '?'} ${meta.guards?.dedup?.passed ? '✅' : '❌'}</div>
            <div>${badge(v.status)}</div>
            <div class="actions">
              <button class="small ghost" data-good="${v.id}">👍</button>
              <button class="small ghost" data-bad="${v.id}">👎</button>
            </div>
          </div>`;
        }).join('')}</div>` : '<p class="muted">还没有变体，先到 <a href="#/queue">⑤ 任务队列</a> 跑一个任务。</p>'}
    </div>`;
  document.querySelectorAll('[data-good],[data-bad]').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.good || btn.dataset.bad;
      const outcome = btn.dataset.good ? 'good' : 'bad';
      try {
        await api('POST', `/api/variants/${id}/review`, { outcome });
        renderReview();
      } catch (e) { toast(e.message, true); }
    };
  });
}

async function renderLineage() {
  const { assets } = await api('GET', '/api/assets?kind=master');
  if (!assets.length) {
    view.innerHTML = '<div class="panel"><h2>⑧ 素材谱系</h2><p class="muted">暂无 Master，<a href="#/upload">上传第一条</a>。</p></div>';
    return;
  }
  const parts = [];
  for (const m of assets) {
    const { master, variants } = await api('GET', `/api/lineage/${m.id}`);
    const good = variants.filter((v) => v.review === 1).length;
    parts.push(`
      <div class="lineage-node master"><strong>Master: ${esc(master.filename)}</strong>
        <span class="muted"> · ${variants.length} 变体 · 👍 ${good}</span>
        ${master.status === 'parsed' ? ' <span class="badge done">已解析</span>' : ''}
      </div>
      <div class="lineage">
        ${variants.map((v) => `<div class="lineage-node">
          ${esc(v.filename)} ${badge(v.status)}
          ${v.review === 1 ? '<span class="badge accepted">👍</span>' : v.review === 0 ? '<span class="badge rejected">👎</span>' : '<span class="badge pending">待审</span>'}
          <div class="muted" style="font-size:12px">${esc(v.meta?.descriptor || '')}</div>
        </div>`).join('') || '<p class="muted">还没有变体</p>'}
      </div>`);
  }
  view.innerHTML = `<div class="panel"><h2>⑧ 素材谱系（哪个 Master 最值钱，一图看清）</h2>${parts.join('')}</div>`;
}

// ---------- 路由 ----------

const routes = {
  dashboard: renderDashboard,
  upload: renderUpload,
  matrix: renderMatrix,
  queue: renderQueue,
  review: renderReview,
  lineage: renderLineage,
};

async function route() {
  const name = (location.hash.replace('#/', '') || 'dashboard');
  const fn = routes[name] || renderDashboard;
  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === name);
  });
  view.innerHTML = '<p class="muted">加载中…</p>';
  try {
    await fn();
  } catch (e) {
    view.innerHTML = `<div class="panel"><h2>出错了</h2><p>${esc(e.message)}</p>
      <p class="muted">API 服务是否在运行？<code>cd apps/api && node src/server.ts</code></p></div>`;
  }
}

window.addEventListener('hashchange', route);
route();

/* Video Batch ID 工作台 · v0.3 零构建 SPA
 * 视图：工作台 / 上传解析 / 变量矩阵 / 任务队列 / 审核 / 素材谱系
 * 对应 README 工作流 A 的 ①→⑧ 步。
 * v0.3：线框图标 + 中英双语标题 + 关键内容分析 + 智能变量推荐（规则引擎 v1）+ Demo 效果预览。
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

function skeleton(rows = 3) {
  return `<div class="stats" aria-hidden="true">
    <div class="skeleton stat-card"></div><div class="skeleton stat-card"></div>
    <div class="skeleton stat-card"></div><div class="skeleton stat-card"></div>
    <div class="skeleton stat-card"></div>
  </div>` + Array.from({ length: rows }, () => '<div class="skeleton row"></div>').join('');
}

function emptyState(iconEmoji, text, actionHtml) {
  return `<div class="empty"><div class="empty-icon" aria-hidden="true">${iconEmoji}</div><p>${text}</p>${actionHtml ?? ''}</div>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function badge(status) {
  return `<span class="badge ${esc(status)}">${esc(status)}</span>`;
}

// ---------- 线框图标库（极简 1.5px stroke，currentColor） ----------

const ICON_PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  upload: '<path d="M12 16V4"/><path d="m6 10 6-6 6 6"/><path d="M4 20h16"/>',
  matrix: '<line x1="4" y1="7" x2="20" y2="7"/><circle cx="9" cy="7" r="2"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="15" cy="17" r="2"/>',
  queue: '<path d="m5 4 14 8-14 8V4Z"/>',
  review: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 12 3 3 5-6"/>',
  lineage: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H15a3 3 0 0 1 3 3v6.5"/><path d="M6 8.5V15a3 3 0 0 0 3 3h6.5"/>',
  library: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><line x1="10" y1="13" x2="14" y2="13"/>',
  rocket: '<path d="M12 3c3.5 1.5 5.5 5 5.5 8.5L14 15h-4l-3.5-3.5C6.5 8 8.5 4.5 12 3Z"/><circle cx="12" cy="9" r="1.5"/><path d="m9 15-1.5 5L10 18.5M15 15l1.5 5L14 18.5"/>',
  zap: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="4" x2="7" y2="20"/><line x1="17" y1="4" x2="17" y2="20"/><line x1="3" y1="9" x2="7" y2="9"/><line x1="3" y1="15" x2="7" y2="15"/><line x1="17" y1="9" x2="21" y2="9"/><line x1="17" y1="15" x2="21" y2="15"/>',
  music: '<path d="M9 18V6l10-2v11"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="15" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  sparkles: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3Z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  keyframe: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m5 18 5-5 3 3 3-3 3 3"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/>',
};

function icon(name, size = 18) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] ?? ''}</svg>`;
}

/** 中英双语标题 */
function bi(zh, en) {
  return `${zh} <span class="en">${en}</span>`;
}

/** 面板标题：图标 + 中文 + 英文 */
function h(icn, zh, en) {
  return `${icon(icn)}${bi(zh, en)}`;
}

/** 推荐强度徽章 */
function confBadge(c) {
  const label = { high: '强信号', medium: '有信号', low: '保守' }[c] ?? c;
  return `<span class="conf conf-${esc(c)}">${label}</span>`;
}

const SHOT_TYPE_LABEL = { hook: 'Hook 位', product: '产品位', action: '动作', reaction: '反应', cta: 'CTA' };

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
      <div class="stat"><div class="num">${masters.length}</div><div class="label">${icon('film', 14)} Master 素材<span class="en">Masters</span></div></div>
      <div class="stat"><div class="num">${variants.length}</div><div class="label">${icon('queue', 14)} 变体总数<span class="en">Variants</span></div></div>
      <div class="stat"><div class="num">${variants.length ? Math.round(accepted.length / variants.length * 100) : 0}%</div><div class="label">${icon('shield', 14)} 守卫通过率<span class="en">Guard pass</span></div></div>
      <div class="stat"><div class="num">${reviewed.length ? Math.round(good.length / reviewed.length * 100) : 0}%</div><div class="label">${icon('review', 14)} 审核好评率<span class="en">Approval</span></div></div>
      <div class="stat"><div class="num">$${cost.toFixed(2)}</div><div class="label">预估成本<span class="en">Est. cost</span></div></div>
    </div>
    <div class="panel">
      <h2>${h('zap', '快速开始（工作流 A）', 'Quick Start')}</h2>
      <p class="muted">① <a href="#/upload">上传参考素材</a> → ② 解析确认 + 智能变量推荐 → ③ <a href="#/matrix">勾选变量 + Demo 预览</a> → ⑤ <a href="#/queue">批量生成</a> → ⑥ <a href="#/review">审核入库</a> → ⑧ <a href="#/lineage">查看谱系</a></p>
    </div>
    <div class="panel">
      <h2>${h('clock', '最近任务', 'Recent Tasks')}</h2>
      ${tasks.tasks.length ? `<table><tr><th>任务</th><th>Master</th><th>变体数</th><th>预估成本</th><th>状态</th></tr>
        ${tasks.tasks.slice(0, 8).map((t) => `<tr><td>${esc(t.id)}</td><td>${esc(t.master_asset_id)}</td><td>${t.variant_count}</td><td>$${t.estimated_cost_usd}</td><td>${badge(t.status)}</td></tr>`).join('')}</table>`
        : emptyState('📋', '还没有任务', '<a class="btn-link" href="#/upload">① 上传素材开始 →</a>')}
    </div>`;
}

// ---------- ① 上传解析 ----------

async function renderUpload() {
  view.innerHTML = `
    <div class="panel">
      <h2>${h('upload', '批量登记素材目录', 'Batch Ingest')}</h2>
      <p class="muted">扫描目录下全部 mp4/mov/webm：ffprobe 探测时长/分辨率/音轨并入库，重复文件自动跳过。</p>
      <div class="form-row" style="grid-template-columns: 3fr auto">
        <div><label class="field">素材目录 Directory</label><input id="scan-dir" value="D:\\桌面工作\\AI project\\Video Batch ID\\Master Asset"></div>
        <button id="btn-scan">扫描入库 →</button>
      </div>
      <div id="scan-result" style="margin-top:12px"></div>
    </div>
    <div class="panel">
      <h2>${h('film', '① 上传参考视频（Master Asset）', 'Upload')}</h2>
      <p class="muted">拖入一条已跑通的爆款。解析后自动产出关键内容分析 + 智能变量推荐。</p>
      <div class="form-row">
        <div><label class="field">文件名 Filename</label><input id="f-name" placeholder="sambal-matah-hit.mp4"></div>
        <div><label class="field">时长（毫秒）Duration</label><input id="f-dur" type="number" value="11000"></div>
        <div><label class="field">备注 Note</label><input id="f-note" placeholder="播放 50万 · 带货 2000单"></div>
        <button id="btn-upload">上传并解析 →</button>
      </div>
    </div>
    <div id="parse-result"></div>`;
  document.getElementById('btn-scan').onclick = async () => {
    const btn = document.getElementById('btn-scan');
    btn.disabled = true;
    try {
      const r = await api('POST', '/api/assets/scan-dir', { dir: document.getElementById('scan-dir').value });
      document.getElementById('scan-result').innerHTML =
        `<p>✅ 新入库 <strong>${r.count}</strong> 条${r.skipped.length ? ` · 跳过 ${r.skipped.length} 条（已存在或失败）` : ''}</p>`;
      toast(`入库完成：${r.count} 条`);
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
  };
  document.getElementById('btn-upload').onclick = async () => {
    const filename = document.getElementById('f-name').value.trim();
    const durationMs = Number(document.getElementById('f-dur').value);
    const note = document.getElementById('f-note').value.trim();
    if (!filename) return toast('请填写文件名', true);
    try {
      const { asset } = await api('POST', '/api/assets', {
        kind: 'master', filename, duration_ms: durationMs, meta: { note },
      });
      const { parsed, thumbs } = await api('POST', `/api/assets/${asset.id}/parse`, {});
      toast(`解析完成：${parsed.shots.length} 镜头${thumbs ? ` · ${thumbs} 关键帧` : ''}`);
      document.getElementById('parse-result').innerHTML = renderParseResult(parsed, thumbs);
      await renderAnalysis(asset.id);
    } catch (e) { toast(e.message, true); }
  };
}

function renderParseResult(parsed, thumbs) {
  const pending = parsed.enrichment?.pending ?? [];
  return `
    <div class="panel">
      <h2>${h('keyframe', '② 解析结果', 'Parse Result')}</h2>
      ${pending.length ? `<p class="muted">🔧 待增强维度：${pending.map((p) => esc(p)).join('、')}（VLM/Whisper 接入后点亮）</p>` : ''}
      <table><tr><th>#</th><th>缩略图</th><th>时间轴</th><th>类型</th><th>画面描述</th></tr>
      ${parsed.shots.map((s) => {
        const m = String(s.description).match(/\[thumb=([^\]]+)\]/);
        const text = String(s.description).replace(/\[thumb=[^\]]+\]/, '').trim();
        return `<tr><td>${s.index}</td>
          <td>${m ? `<img src="${esc(m[1])}" style="width:64px;border-radius:4px">` : '—'}</td>
          <td>${(s.startMs / 1000).toFixed(1)}s – ${(s.endMs / 1000).toFixed(1)}s</td>
          <td>${esc(s.type)}</td><td>${esc(text)}</td></tr>`;
      }).join('')}
      </table>
      <p class="muted">BGM：${esc(parsed.bgm.style)}${parsed.bgm.bpm ? ` ${parsed.bgm.bpm} BPM` : ''} · 平均 ${parsed.rhythm.avgShotSec}s/镜头 · ${parsed.rhythm.shotCount} 镜头</p>
    </div>`;
}

/** 关键内容分析 + 智能变量推荐（② → ③ 的桥） */
async function renderAnalysis(masterId) {
  const box = document.createElement('div');
  box.id = 'analysis-panel';
  view.appendChild(box);
  try {
    const a = await api('GET', `/api/assets/${masterId}/analysis`);
    const kc = a.keyContent;
    const reasonOf = (key) => a.suggestions.reasons.find((r) => r.key === key);
    box.innerHTML = `
    <div class="panel">
      <h2>${h('eye', '关键内容分析', 'Key Content')}</h2>
      <div class="kc-strip">
        ${kc.structure.map((s) => `
          <div class="kc-shot">
            ${s.thumb ? `<img src="${esc(s.thumb)}" alt="镜头 ${s.index} 关键帧">` : `<div class="kc-noimg">${icon('film', 22)}</div>`}
            <div class="kc-meta"><span class="kc-type">${esc(SHOT_TYPE_LABEL[s.type] ?? s.type)}</span>
            <span class="kc-time">${(s.startMs / 1000).toFixed(1)}s</span></div>
          </div>`).join('')}
      </div>
      <div class="kc-facts">
        <span>${icon('zap', 14)} Hook：${kc.hooks.map((x) => esc(x.phrase)).join(' / ') || '—'}</span>
        <span>${icon('clock', 14)} ${kc.rhythm.shotCount} 镜头 · 平均 ${kc.rhythm.avgShotSec}s/镜</span>
        <span>${icon('music', 14)} ${esc(kc.bgm.style)}</span>
        ${kc.hotspots.longest ? `<span>${icon('eye', 14)} 最长镜头 #${kc.hotspots.longest.shot}（${kc.hotspots.longest.sec}s）· 最短 #${kc.hotspots.shortest.shot}（${kc.hotspots.shortest.sec}s）</span>` : ''}
        ${kc.transcript ? `<span>${icon('review', 14)} 转录：${esc(kc.transcript)}</span>` : ''}
      </div>
    </div>
    <div class="panel">
      <h2>${h('sparkles', '智能变量推荐', 'Smart Variables')}</h2>
      <p class="muted">规则引擎 v1：按镜头密度 / 音轨 / 解析真实性启发式匹配；VLM 接入后升级为语义匹配。可手动增删，到矩阵页继续微调。</p>
      <div class="dim-grid">
        ${a.suggestions.dimensions.map((d) => {
          const r = reasonOf(d.key);
          return `<div class="dim-card ${d.enabled ? '' : 'locked'}">
            <h3>${esc(d.label)} ${confBadge(r?.confidence)}</h3>
            <div>${d.options.map((o) => `<span class="opt">${esc(o.label)}</span>`).join('')}</div>
            <div class="locked-list">🔒 锁定：${d.locked.length ? d.locked.map(esc).join('、') : '—'}</div>
            <p class="dim-reason">${esc(r?.reason ?? '')}</p>
          </div>`;
        }).join('')}
      </div>
      <div class="demo-actions" style="margin-top:16px">
        <button id="btn-apply-suggest">应用推荐，去配置矩阵 →</button>
        <span class="muted">也可以到 <a href="#/matrix">③ 变量矩阵</a> 手动调整或添加自定义变量因子</span>
      </div>
    </div>`;
    document.getElementById('btn-apply-suggest').onclick = () => {
      pendingMatrix = { masterId, dims: a.suggestions.dimensions };
      location.hash = '#/matrix';
    };
  } catch (e) {
    box.innerHTML = `<div class="panel"><p class="muted">分析加载失败：${esc(e.message)}</p></div>`;
  }
}

// ---------- ③ 变量矩阵（智能推荐驱动 + 自定义变量 + ④ Demo 预览） ----------

let pendingMatrix = null; // 上传页「应用推荐」带入：{ masterId, dims }

const FALLBACK_DIMS = [
  { key: 'visual', label: '视觉', enabled: true, options: [{ id: 'scene-kitchen', label: '厨房台面' }, { id: 'scene-restaurant', label: '餐厅' }], locked: ['产品外观'] },
  { key: 'copy', label: '文案', enabled: true, options: [{ id: 'hook-1', label: 'Hook=倾倒' }, { id: 'hook-2', label: 'Hook=拉丝' }], locked: ['核心信息'] },
];

async function renderMatrix() {
  const { assets } = await api('GET', '/api/assets?kind=master');
  if (!assets.length) {
    view.innerHTML = `<div class="panel"><h2>${h('matrix', '③ 变量矩阵', 'Variable Matrix')}</h2><p class="muted">请先 <a href="#/upload">上传 Master 素材</a>。</p></div>`;
    return;
  }
  const masterId = pendingMatrix && assets.some((m) => m.id === pendingMatrix.masterId)
    ? pendingMatrix.masterId : assets[0].id;

  view.innerHTML = `
    <div class="panel">
      <h2>${h('matrix', '③ 变量矩阵：勾选「变什么、锁什么」', 'Variable Matrix')}</h2>
      <div class="form-row" style="grid-template-columns: 1fr 2fr auto;">
        <div><label class="field">Master 素材</label>
          <select id="m-master">${assets.map((m) => `<option value="${m.id}" ${m.id === masterId ? 'selected' : ''}>${esc(m.filename)}${m.duration_ms ? `（${Math.round(m.duration_ms / 1000)}s）` : ''}</option>`).join('')}</select>
        </div>
        <div><label class="field">智能推荐来源</label><p class="muted" id="m-source" style="margin:8px 0 0">加载中…</p></div>
        <div><label class="field">&nbsp;</label><button class="ghost" id="m-reload">重新分析</button></div>
      </div>
      <div id="dim-grid" class="dim-grid" style="margin-top:16px"></div>
      <div class="panel inset">
        <h3>${icon('plus')} 添加自定义变量因子 <span class="en">Custom Factor</span></h3>
        <div class="form-row" style="grid-template-columns: 1fr 2fr auto">
          <div><label class="field">变量名 Label</label><input id="cd-name" placeholder="如：光线 / 包装颜色 / 字幕样式"></div>
          <div><label class="field">选项（逗号分隔，≥2 个）Options</label><input id="cd-opts" placeholder="暖光, 冷光, 自然光"></div>
          <button class="ghost" id="cd-add">添加</button>
        </div>
      </div>
      <div class="form-row" style="grid-template-columns: 1fr 2fr auto; margin-top:16px">
        <div><label class="field">变体数量 Count</label><input id="m-count" type="number" value="30"></div>
        <div><label class="field">组合空间 Space</label><div id="m-space" class="num" style="font-size:22px;font-weight:700"></div></div>
        <button id="m-preview">${icon('eye')} ④ Demo 效果预览 →</button>
      </div>
    </div>
    <div id="preview-panel"></div>`;

  const state = { dims: [], reasons: {} };

  function renderCards() {
    const grid = document.getElementById('dim-grid');
    grid.innerHTML = state.dims.map((d, i) => `
      <div class="dim-card ${d.enabled ? '' : 'locked'}" data-i="${i}">
        <h3>${esc(d.label)} <label style="display:inline;margin:0"><input type="checkbox" class="dim-toggle" data-i="${i}" ${d.enabled ? 'checked' : ''} style="width:auto"> 参与变化</label></h3>
        <div>${d.options.map((o) => `<span class="opt">${esc(o.label)}</span>`).join('')}</div>
        <div class="locked-list">🔒 锁定：${d.locked.length ? d.locked.map(esc).join('、') : '—'}</div>
        ${state.reasons[d.key] ? `<p class="dim-reason">${confBadge(state.reasons[d.key].confidence)} ${esc(state.reasons[d.key].reason)}</p>` : ''}
      </div>`).join('');
    updateSpace();
  }

  function updateSpace() {
    let space = 1;
    state.dims.forEach((d, i) => {
      if (document.querySelector(`.dim-toggle[data-i="${i}"]`)?.checked) space *= d.options.length;
    });
    document.getElementById('m-space').textContent = `${space} 种`;
  }

  async function loadSuggestions(id) {
    document.getElementById('m-source').textContent = '加载中…';
    try {
      const a = await api('GET', `/api/assets/${id}/analysis`);
      state.dims = a.suggestions.dimensions;
      state.reasons = Object.fromEntries(a.suggestions.reasons.map((r) => [r.key, r]));
      document.getElementById('m-source').textContent =
        `${a.parsedWith} 解析 · ${a.keyContent.rhythm.shotCount} 镜头 · 规则引擎 v1 推荐（可手动调整）`;
    } catch {
      state.dims = pendingMatrix?.masterId === id ? pendingMatrix.dims : FALLBACK_DIMS.map((d) => ({ ...d, options: [...d.options] }));
      state.reasons = {};
      document.getElementById('m-source').textContent = '该素材未解析，使用默认矩阵（到 ① 页先解析可获智能推荐）';
    }
    renderCards();
  }

  document.getElementById('dim-grid').addEventListener('change', (e) => {
    if (!e.target.classList.contains('dim-toggle')) return;
    const i = Number(e.target.dataset.i);
    state.dims[i].enabled = e.target.checked;
    e.target.closest('.dim-card').classList.toggle('locked', !e.target.checked);
    updateSpace();
  });

  document.getElementById('cd-add').onclick = () => {
    const label = document.getElementById('cd-name').value.trim();
    const options = document.getElementById('cd-opts').value.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
    if (!label || options.length < 2) return toast('自定义变量需要名称 + 至少 2 个选项', true);
    state.dims.push({
      key: `custom-${Date.now().toString(36)}`, label, enabled: true,
      options: options.map((o, i) => ({ id: `c${i + 1}`, label: o })), locked: [],
    });
    document.getElementById('cd-name').value = '';
    document.getElementById('cd-opts').value = '';
    renderCards();
    toast(`已添加自定义变量「${label}」（${options.length} 个选项）`);
  };

  document.getElementById('m-reload').onclick = () => loadSuggestions(document.getElementById('m-master').value);
  document.getElementById('m-master').onchange = () => { pendingMatrix = null; loadSuggestions(document.getElementById('m-master').value); };

  document.getElementById('m-preview').onclick = async () => {
    const id = document.getElementById('m-master').value;
    // 同步卡片开关状态到 state
    state.dims.forEach((d, i) => { d.enabled = Boolean(document.querySelector(`.dim-toggle[data-i="${i}"]`)?.checked); });
    if (!state.dims.some((d) => d.enabled)) return toast('至少启用一个变量维度', true);
    const btn = document.getElementById('m-preview');
    btn.disabled = true;
    try {
      const r = await api('POST', '/api/preview', { master_asset_id: id, dimensions: state.dims });
      renderPreviewPanel(r, id);
    } catch (e) { toast(e.message, true); }
    btn.disabled = false;
  };

  function renderPreviewPanel(r, masterId) {
    const p = r.preview;
    const byDim = {};
    for (const e of p.entries) (byDim[e.dimensionKey] ??= { label: e.dimensionLabel, items: [] }).items.push(e);
    document.getElementById('preview-panel').innerHTML = `
      <div class="panel preview-panel">
        <h2>${h('eye', '④ Demo 效果预览', 'Effect Preview')}</h2>
        <p class="muted">Master：<strong>${esc(r.master.filename)}</strong> · 组合空间 <strong>${p.space}</strong> 种 · 每个选项的预期效果与关联关键帧（规则引擎 v1）</p>
        ${Object.values(byDim).map((g) => `
          <h3 class="pv-dim">${icon('sparkles', 15)} ${esc(g.label)}</h3>
          <div class="pv-grid">
            ${g.items.map((e) => `
              <div class="pv-card">
                ${e.thumb ? `<img class="pv-thumb" src="${esc(e.thumb)}" alt="镜头 ${e.affectedShots[0]} 关键帧">` : `<div class="pv-thumb kc-noimg">${icon('keyframe', 22)}</div>`}
                <div class="pv-body">
                  <div class="pv-opt">${esc(e.optionLabel)} ${confBadge(e.confidence)}</div>
                  <div class="pv-effect">${esc(e.effect)}</div>
                  <div class="pv-shots">影响镜头 #${e.affectedShots.join(' #')}</div>
                </div>
              </div>`).join('')}
          </div>`).join('')}
        <h3 class="pv-dim">${icon('queue', 15)} 样例变体组合 <span class="en">Samples</span></h3>
        <div class="pv-grid">
          ${p.samples.map((s) => `
            <div class="pv-card sample">
              <div class="pv-opt">${esc(s.id)}</div>
              <div class="pv-combo">${s.combo.map((c) => `<span class="opt">${esc(c.dimension)}=${esc(c.value)}</span>`).join('')}</div>
            </div>`).join('')}
        </div>
        <div class="demo-actions" style="margin-top:16px">
          <button id="m-create">确认矩阵，创建生成任务 →</button>
          <span class="muted">确认后进入 ⑤ 任务队列执行</span>
        </div>
      </div>`;
    document.getElementById('m-create').onclick = async () => {
      const variantCount = Number(document.getElementById('m-count').value);
      try {
        const { task } = await api('POST', '/api/tasks', {
          master_asset_id: masterId, variant_count: variantCount,
          matrix: { dimensions: state.dims },
        });
        toast(`任务已创建：${task.variant_count} 条 · 预估 $${task.estimated_cost_usd}`);
        location.hash = '#/queue';
      } catch (e) { toast(e.message, true); }
    };
    document.getElementById('preview-panel').scrollIntoView({ behavior: 'smooth' });
  }

  // 初始加载：上传页带推荐进来优先用
  if (pendingMatrix && pendingMatrix.masterId === masterId) {
    state.dims = pendingMatrix.dims;
    try {
      const a = await api('GET', `/api/assets/${masterId}/analysis`);
      state.reasons = Object.fromEntries(a.suggestions.reasons.map((r) => [r.key, r]));
      document.getElementById('m-source').textContent =
        `${a.parsedWith} 解析 · ${a.keyContent.rhythm.shotCount} 镜头 · 已应用智能推荐（可手动调整）`;
    } catch { /* 理由加载失败不阻断 */ }
    pendingMatrix = null;
    renderCards();
  } else {
    await loadSuggestions(masterId);
  }

  // 截图/演示辅助：#/matrix?autopreview 自动点开 Demo 预览
  if (new URLSearchParams((location.hash.split('?')[1] ?? '')).has('autopreview')) {
    setTimeout(() => document.getElementById('m-preview')?.click(), 300);
  }
}

// ---------- ⑤ 任务队列 ----------

async function renderQueue() {
  const [{ tasks }, health] = await Promise.all([
    api('GET', '/api/tasks'),
    api('GET', '/healthz').catch(() => ({ gen: 'mock', genModel: null })),
  ]);
  const genReal = health.gen === 'openrouter';
  const estPerVariant = 0.10 * 5; // wan-2.7 I2V 720p 默认 $0.10/s × 5s（VBID_GEN_MODEL 可换，以官方目录为准）
  view.innerHTML = `
    <div class="panel demo-panel">
      <h2>${h('rocket', '一键演示 · 跑通端到端', 'One-click Demo')}</h2>
      <p class="muted">自动选一条未跑过的真实 Master：<strong>ffmpeg-shotcut 镜头切分 + 关键帧</strong> → 变量矩阵采样 → 生成 → 双守卫 → 谱系入库。秒级看完全链路，无需任何配置。</p>
      <div class="demo-actions">
        <button id="btn-demo">${icon('rocket')} 一键跑通端到端</button>
        <span id="demo-status" class="muted" role="status" aria-live="polite"></span>
      </div>
    </div>
    <div class="panel">
      <h2>${h('queue', '⑤ 任务队列', 'Task Queue')}</h2>
      <p class="muted">${icon('zap', 14)} 生成层 Generator：<strong>${genReal ? `OpenRouter · ${esc(health.genModel)}（I2V 首帧锚定，真实扣费 ≈ $${estPerVariant.toFixed(2)}/条）` : 'mock（免费演示链路；配置 VBID_GEN_API_KEY 切换真实生成）'}</strong></p>
      ${tasks.length ? `<table><tr><th>任务</th><th>Master</th><th>变体数</th><th>预估成本</th><th>状态</th><th></th></tr>
      ${tasks.map((t) => `<tr>
        <td>${esc(t.id)}</td><td>${esc(t.master_asset_id)}</td><td>${t.variant_count}</td><td>$${t.estimated_cost_usd}</td>
        <td>${badge(t.status)}</td>
        <td>${t.status === 'queued' ? `<button class="small" data-run="${t.id}">▶ 生成</button>` : ''}</td>
      </tr>`).join('')}</table>` : '<p class="muted">队列为空，到 <a href="#/matrix">③ 变量矩阵</a> 创建任务，或点上方「一键演示」。</p>'}
    </div>
    <div id="run-result"></div>`;
  document.getElementById('btn-demo').onclick = async () => {
    const btn = document.getElementById('btn-demo');
    const status = document.getElementById('demo-status');
    btn.disabled = true;
    btn.textContent = '运行中…';
    status.textContent = '解析 → 采样 → 生成 → 守卫 → 入库，请稍候';
    try {
      const r = await api('POST', '/api/demo/run', {});
      const cap = r.summary.spaceCapped ? `（组合空间 ${r.summary.variantCount} 种 < 请求 ${r.summary.requestedCount}，按上限产出）` : '';
      toast(`演示完成：通过 ${r.summary.acceptedCount} · 拦截 ${r.summary.rejectedCount}`);
      status.textContent = '';
      await renderQueue(); // 先刷新队列，再写结果面板（避免被重渲染冲掉）
      document.getElementById('run-result').innerHTML = `
        <div class="panel demo-result">
          <h2>${icon('rocket')} 演示完成</h2>
          <p>Master：<strong>${esc(r.master.filename)}</strong>${r.freshlyParsed ? ' · 已完成真实解析（镜头 + 关键帧）' : ' · 复用已有解析'}</p>
          <p>任务 ${esc(r.task.id)}：产出 <strong>${r.summary.variantCount}</strong> 条变体${cap} · 守卫通过 <strong>${r.summary.acceptedCount}</strong> · 拦截 <strong>${r.summary.rejectedCount}</strong> · 预估 $${r.summary.estimatedCostUsd}</p>
          <p><a class="btn-link" href="#/review">⑥ 去审核 👍/👎 →</a> <a class="btn-link" href="#/lineage">⑧ 看谱系 →</a></p>
        </div>`;
    } catch (e) {
      toast(e.message, true);
      status.textContent = '';
    }
    btn.disabled = false;
    btn.innerHTML = `${icon('rocket')} 一键跑通端到端`;
  };
  document.querySelectorAll('[data-run]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        const r = await api('POST', `/api/tasks/${btn.dataset.run}/run`, {});
        const cap = r.summary.spaceCapped ? `（组合空间 ${r.summary.variantCount} 种 < 请求 ${r.summary.requestedCount} 种，已按上限产出）` : '';
        const genNote = r.summary.generator === 'openrouter'
          ? ` · OpenRouter 实扣 $${(r.summary.actualCostUsd ?? 0).toFixed(2)}` : '';
        toast(`完成${cap}：通过 ${r.summary.acceptedCount} · 拦截 ${r.summary.rejectedCount}${genNote}`);
        renderQueue();
      } catch (e) { toast(e.message, true); btn.disabled = false; }
    };
  });
}

// ---------- ⑥ 审核 ----------

async function renderReview() {
  const { assets } = await api('GET', '/api/assets?kind=variant');
  view.innerHTML = `
    <div class="panel">
      <h2>${h('review', '⑥ 审核（网格视图）', 'Review')}</h2>
      <p class="muted">👍 好评入库 · 👎 废片。守卫未通过的变体不会进入合格队列（绿色/红色边框 = 已审核 👍/👎）。</p>
      ${assets.length ? `<div class="review-grid">
        ${assets.map((v) => {
          const meta = JSON.parse(v.meta_json || '{}');
          const reviewClass = v.review === 1 ? 'review-good' : v.review === 0 ? 'review-bad' : '';
          return `<div class="variant-card ${reviewClass}" data-id="${v.id}">
            <h4>${esc(v.filename)}</h4>
            ${meta.fileRef && meta.fileRef.startsWith('/derived/') && meta.fileRef.endsWith('.mp4')
              ? `<video class="variant-video" src="${esc(meta.fileRef)}" controls preload="metadata" muted playsinline></video>` : ''}
            <div class="desc">${esc(meta.descriptor || '')}</div>
            ${meta.gen?.generator === 'openrouter' ? `<div class="muted" style="font-size:11px">${icon('zap', 12)} ${esc(meta.gen.generator)} · job ${esc(meta.gen.jobId ?? '')} · $${(meta.gen.usageCostUsd ?? 0).toFixed(2)}</div>` : ''}
            <div class="guards">保真 ${meta.guards?.fidelity?.score ?? '?'} ${meta.guards?.fidelity?.passed ? '✅' : '❌'} · 去重 ${meta.guards?.dedup?.score ?? '?'} ${meta.guards?.dedup?.passed ? '✅' : '❌'}</div>
            <div>${badge(v.status)}</div>
            <div class="actions">
              <button class="small ghost" data-good="${v.id}">👍</button>
              <button class="small ghost" data-bad="${v.id}">👎</button>
            </div>
          </div>`;
        }).join('')}</div>` : emptyState('🎬', '还没有变体', '<a class="btn-link" href="#/queue">⑤ 任务队列跑一个任务 →</a>')}
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

// ---------- ⑧ 素材谱系 ----------

async function renderLineage() {
  const { assets } = await api('GET', '/api/assets?kind=master');
  if (!assets.length) {
    view.innerHTML = `<div class="panel"><h2>${h('lineage', '⑧ 素材谱系', 'Lineage')}</h2><p class="muted">暂无 Master，<a href="#/upload">上传第一条</a>。</p></div>`;
    return;
  }
  const parts = [];
  for (const m of assets) {
    const { master, variants } = await api('GET', `/api/lineage/${m.id}`);
    const good = variants.filter((v) => v.review === 1).length;
    parts.push(`
      <div class="lineage-node master"><strong>Master: ${esc(master.filename)}</strong>
        <span class="muted"> · ${master.duration_ms ? Math.round(master.duration_ms / 1000) + 's · ' : ''}${variants.length} 变体 · 👍 ${good}</span>
        ${master.status === 'parsed' ? ' <span class="badge done">已解析</span>' : ''}
      </div>
      <div class="lineage">
        ${variants.map((v) => `<div class="lineage-node">
          ${esc(v.filename)} ${badge(v.status)}
          ${v.review === 1 ? '<span class="badge accepted">👍</span>' : v.review === 0 ? '<span class="badge rejected">👎</span>' : '<span class="badge pending">待审</span>'}
          ${v.meta?.fileRef && String(v.meta.fileRef).startsWith('/derived/') && String(v.meta.fileRef).endsWith('.mp4')
            ? `<div><video class="variant-video" src="${esc(v.meta.fileRef)}" controls preload="metadata" muted playsinline style="max-width:180px"></video></div>` : ''}
          <div class="muted" style="font-size:12px">${esc(v.meta?.descriptor || '')}</div>
        </div>`).join('') || emptyState('🌱', '还没有变体，先运行生成任务')}
      </div>`);
  }
  view.innerHTML = `<div class="panel"><h2>${h('lineage', '⑧ 素材谱系（哪个 Master 最值钱，一图看清）', 'Lineage')}</h2>${parts.join('')}</div>`;
}

// ---------- 素材库 · 价值榜 ----------

async function renderLibrary() {
  const [value, all] = await Promise.all([
    api('GET', '/api/masters/value'),
    api('GET', '/api/library'),
  ]);
  view.innerHTML = `
    <div class="panel">
      <h2>${h('library', 'Master 价值榜（哪个 Master 最值钱）', 'Value Board')}</h2>
      ${value.masters.length ? `<table><tr><th>#</th><th>Master</th><th>变体</th><th>守卫通过</th><th>👍/👎</th><th>好评率</th><th>价值分</th></tr>
      ${value.masters.map((m, i) => `<tr>
        <td>${i + 1}</td><td>${esc(m.master.filename)}</td><td>${m.variantCount}</td>
        <td>${m.acceptedCount}</td><td>${m.goodCount} / ${m.badCount}</td>
        <td>${m.passRate === null ? '—' : Math.round(m.passRate * 100) + '%'}</td>
        <td><strong>${m.valueScore}</strong></td>
      </tr>`).join('')}</table>` : emptyState('🍬', '暂无 Master 素材')}
    </div>
    <div class="panel">
      <h2>${h('library', '素材库检索', 'Search')}</h2>
      <div class="form-row" style="grid-template-columns: 2fr 1fr 1fr auto">
        <div><label class="field">关键词（文件名/描述/变量取值）Keyword</label><input id="lib-q" placeholder="如：餐厅、Hook=拉丝、V02"></div>
        <div><label class="field">类型 Kind</label><select id="lib-kind"><option value="">全部</option><option value="master">Master</option><option value="variant">变体</option></select></div>
        <div><label class="field">状态 Status</label><select id="lib-status"><option value="">全部</option><option value="accepted">通过守卫</option><option value="rejected">被拦截</option><option value="parsed">已解析</option></select></div>
        <button id="lib-search">搜索</button>
      </div>
      <div id="lib-result" style="margin-top:14px"></div>
    </div>`;

  async function doSearch() {
    const q = encodeURIComponent(document.getElementById('lib-q').value.trim());
    const kind = document.getElementById('lib-kind').value;
    const status = document.getElementById('lib-status').value;
    const r = await api('GET', `/api/library?q=${q}&kind=${kind}&status=${status}`);
    document.getElementById('lib-result').innerHTML = r.assets.length
      ? `<table><tr><th>资产</th><th>类型</th><th>状态</th><th>审核</th><th>说明</th></tr>
        ${r.assets.map((a) => {
          const meta = JSON.parse(a.meta_json || '{}');
          return `<tr><td>${esc(a.filename)}</td><td>${a.kind}</td><td>${badge(a.status)}</td>
            <td>${a.review === 1 ? '👍' : a.review === 0 ? '👎' : '—'}</td>
            <td class="muted">${esc(meta.descriptor || meta.note || '')}</td></tr>`;
        }).join('')}</table>`
      : '<p class="muted">没有匹配结果。</p>';
  }
  document.getElementById('lib-search').onclick = () => doSearch().catch((e) => toast(e.message, true));
  doSearch().catch(() => {});
}

// ---------- 路由 ----------

const routes = {
  dashboard: renderDashboard,
  upload: renderUpload,
  matrix: renderMatrix,
  queue: renderQueue,
  review: renderReview,
  lineage: renderLineage,
  library: renderLibrary,
};

async function route() {
  const name = (location.hash.replace('#/', '').split('?')[0] || 'dashboard');
  const fn = routes[name] || renderDashboard;
  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === name);
  });
  view.innerHTML = skeleton();
  try {
    await fn();
  } catch (e) {
    view.innerHTML = `<div class="panel"><h2>出错了</h2><p>${esc(e.message)}</p>
      <p class="muted">API 服务是否在运行？<code>cd apps/api && node src/server.ts</code></p></div>`;
  }
}

window.addEventListener('hashchange', route);
route();

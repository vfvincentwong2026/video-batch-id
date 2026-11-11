/**
 * apps/api/src/a2a.ts —— A2A message/send 最小任务委派（P4）。
 *
 * 设计约束（治理红线）：
 *  - 委派只编排 **low risk 只读链**（检索/解析/分析/推荐）；
 *  - 一切 gated 动作（create_task/submit_generation/register_skill）只产出 **draft 提案**，
 *    附审批指引——A2A 委派永不自动批（对齐 approval-gates.yml：high risk 永不自动批）；
 *  - 任务状态内存暂存（单进程执行体；托管进 DAM 后由 DAM Task 持久化取代）。
 *
 * 入口：POST /a2a/message/send  { message: { parts: [{ type:'text', text }] } }
 * 查询：GET  /a2a/tasks/:contextId
 */

export interface A2aDeps {
  newId: (prefix: string) => string;
  getAsset: (id: string) => Record<string, unknown> | null;
  getTask: (id: string) => Record<string, unknown> | null;
  parseMasterById: (assetId: string) => Promise<unknown>;
  analysisFor: (asset: Record<string, unknown>) => { keyContent: unknown; suggestions: unknown } | { error: string };
}

interface A2aContext {
  id: string;
  status: 'submitted' | 'working' | 'completed' | 'failed';
  history: Array<{ state: string; text: string; at: string }>;
  artifacts: Array<{ type: string; text: string }>;
}

const HELP_TEXT = [
  'Video Batch ID 执行体 · 可委派的事：',
  '1) 「分析 <masterId>」→ 解析 + 关键内容 + 智能变量推荐（只读，即时返回）',
  '2) 「二创 <masterId>」→ 同上 + 生成任务 draft 提案（gated，需人工/MCP 审批执行）',
  '3) 「状态 <taskId>」→ 任务执行状态查询',
  '直接 MCP 接入：POST /mcp（12+3 工具契约，gated 走 -32042 two-call 审批）',
].join('\n');

export function createA2aHandler(deps: A2aDeps) {
  const contexts = new Map<string, A2aContext>();

  function record(ctx: A2aContext, state: string, text: string): void {
    ctx.history.push({ state, text, at: new Date().toISOString() });
    ctx.status = state === 'completed' || state === 'failed' ? state : 'working';
  }
  const artifact = (text: string) => ({ type: 'text', text });

  /** 只读分析链：解析（未解析时）→ 关键内容 + 推荐 */
  async function analyzeMaster(masterId: string) {
    const master = deps.getAsset(masterId);
    if (!master || master.kind !== 'master') throw new Error(`master not found: ${masterId}`);
    if (master.status !== 'parsed') await deps.parseMasterById(masterId);
    const fresh = deps.getAsset(masterId)!;
    const a = deps.analysisFor(fresh);
    if ('error' in a) throw new Error(a.error);
    return { master: fresh, a };
  }

  return {
    contexts,
    /** POST /a2a/message/send */
    async send(body: unknown): Promise<{ status: number; payload: unknown }> {
      const message = (body as { message?: { parts?: Array<{ type?: string; text?: string }> } })?.message;
      const text = (message?.parts ?? []).filter((p) => p.type === 'text' || p.text).map((p) => String(p.text ?? '')).join(' ').trim();
      const ctx: A2aContext = { id: deps.newId('a2a'), status: 'submitted', history: [], artifacts: [] };
      contexts.set(ctx.id, ctx);
      record(ctx, 'submitted', text.slice(0, 200));

      if (!text) {
        ctx.artifacts.push(artifact(HELP_TEXT));
        record(ctx, 'completed', 'empty message → help');
        return { status: 200, payload: taskView(ctx) };
      }

      // 意图 1：状态查询
      const statusMatch = text.match(/(?:状态|status)\s+(tsk_[a-z0-9]+)/i);
      if (statusMatch) {
        const task = deps.getTask(statusMatch[1]);
        ctx.artifacts.push(artifact(task
          ? `任务 ${task.id}：status=${task.status} · 变体 ${task.variant_count} 条 · 预估 $${task.estimated_cost_usd}`
          : `任务不存在：${statusMatch[1]}`));
        record(ctx, 'completed', 'status query');
        return { status: 200, payload: taskView(ctx) };
      }

      // 意图 2：分析 / 二创（含 masterId）
      const masterMatch = text.match(/(mas_[a-z0-9]+)/i);
      const wantsDistill = /二创|distill|generate|batch|生成/i.test(text);
      if (masterMatch && (wantsDistill || /分析|analy|解析/i.test(text))) {
        try {
          const { master, a } = await analyzeMaster(masterMatch[1]);
          const kc = a.keyContent as { rhythm: { shotCount: number }; hooks: Array<{ phrase: string }> };
          const sugg = a.suggestions as { engine: string; dimensions: Array<{ key: string; enabled: boolean }> };
          record(ctx, 'working', `parsed+analyzed ${masterMatch[1]}`);
          ctx.artifacts.push(artifact(
            `素材 ${master.filename}：${kc.rhythm.shotCount} 镜头 · Hook=${kc.hooks[0]?.phrase ?? '—'} · 推荐引擎 ${sugg.engine}`
            + ` · 启用维度 ${sugg.dimensions.filter((d) => d.enabled).map((d) => d.key).join('/')}`));
          if (wantsDistill) {
            // 治理红线：gated 只出 draft，不执行
            ctx.artifacts.push(artifact(
              `【draft 提案】create_task(masterAssetId=${master.id}, variantCount=建议 8-16) + submit_generation(tier=economy|standard)`
              + `\n执行入口：MCP create_task/submit_generation（首调 -32042 审批令牌，人工确认后二调）。A2A 委派不自动执行 gated 动作。`));
          }
          record(ctx, 'completed', wantsDistill ? 'distill draft' : 'analysis');
        } catch (e) {
          ctx.artifacts.push(artifact(`处理失败：${(e as Error).message}`));
          record(ctx, 'failed', (e as Error).message);
        }
        return { status: 200, payload: taskView(ctx) };
      }

      ctx.artifacts.push(artifact(HELP_TEXT));
      record(ctx, 'completed', 'fallback help');
      return { status: 200, payload: taskView(ctx) };
    },
    /** GET /a2a/tasks/:contextId */
    get(contextId: string): { status: number; payload: unknown } {
      const ctx = contexts.get(contextId);
      if (!ctx) return { status: 404, payload: { error: 'context not found', contextId } };
      return { status: 200, payload: taskView(ctx) };
    },
  };

  function taskView(ctx: A2aContext) {
    return {
      id: ctx.id,
      status: ctx.status,
      contextId: ctx.id,
      artifacts: ctx.artifacts,
      stateTransitionHistory: ctx.history,
    };
  }
}

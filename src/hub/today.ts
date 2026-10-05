/** The `/today` aggregation: one ranked answer to "现在该做什么".
 *
 * Four plugins each hold a piece of the day — quota (预算与下步预估), cost-ledger
 * (这个月已经烧掉多少), task-forge (哪些交接卡在谁那里), tool-trace (工具面能不能干活).
 * None of them is ordered against the others, which is exactly the "没有内在顺序"
 * complaint. This module is the rule table that imposes one: pure functions over a
 * `TodaySignals` snapshot, so the ordering is testable without any disk or host.
 *
 * Every reader is a *mirror* of another plugin's on-disk contract (they are separate
 * packages and cannot import each other). Tolerance is the contract: a missing or
 * malformed file yields null for that block and the rules simply have less to say.
 */

export interface BudgetSignal {
  updatedAt: string;
  budgetTokens: number;
  maxSessionTokens: number;
  maxSessionRatio: number | null;
  nextTurnEstTokens: number | null;
  currency: string;
}

export interface SpendSignal {
  /** current month, micro-units of `currency` */
  monthMicros: number;
  currency: string;
  records: number;
  /** sessions that produced cost, for context only */
  sessions: number;
}

export interface TaskSignal {
  id: string;
  title: string;
  version: number;
  status: string;
  /** ISO of the last ledger event for this task */
  at: string;
  /** gaps the last ack asked for, from the event note ("缺口 2 条") */
  gaps: number;
  /** how many windows hold it */
  holders: number;
}

export interface ToolSignal {
  calls: number;
  errors: number;
  errorRate: number;
  /** tool → longest consecutive-error run, only runs >= streakAlert */
  streaks: Array<{ tool: string; run: number }>;
  /** tools over the error-rate alert line */
  hot: Array<{ tool: string; rate: number }>;
}

/** Cross-session volume from session-insights' monthly sidecars — context for
 * "how much ran at all", not a blocker on its own. */
export interface SessionsSignal {
  /** distinct sessions inside the window */
  sessions: number;
  /** usage events folded inside the window */
  records: number;
  /** uncached input + output, the same "used" figure the gauges show */
  tokens: number;
  costMicros: number;
}

/** spend-forecast's published forecast.json — the burn-out date /today acts on. */
export interface ForecastSignal {
  updatedAt: string;
  currency: string;
  dailyRateMicros: number;
  trend: string;
  month: string;
  spentThisMonthMicros: number;
  projectedMonthEndMajor: number;
  budgetMajor: number | null;
  daysUntilBudget: number | null;
  budgetExhaustionDate: string | null;
}

export interface TodaySignals {
  now: Date;
  budget: BudgetSignal | null;
  spend: SpendSignal | null;
  tasks: TaskSignal[];
  tools: ToolSignal | null;
  /** optional so older signal snapshots stay valid; null/absent = blind spot */
  sessions?: SessionsSignal | null;
  forecast?: ForecastSignal | null;
}

export interface TodayAction {
  /** what to do, in the user's words */
  do: string;
  /** which signal made this the answer */
  why: string;
  /** the command that acts on it */
  command: string;
}

export interface TodayPlan {
  headline: string;
  actions: TodayAction[];
  /** blocks that were missing, so the answer never claims full sight */
  blind: string[];
}

/** Tuning knobs, stated as numbers the tests can pin. */
export const TODAY_RULES = {
  /** ratio at which the budget becomes the headline */
  budgetAlert: 0.8,
  /** a relay nobody has read back after this many hours blocks the day */
  ackStaleHours: 24,
  /** tool-trace streak length that counts as systemic (matches error-radar) */
  streakAlert: 3,
  /** error-rate line, fraction (error-radar's default 20%) */
  errorRateAlert: 0.2,
  /** daysUntilBudget at or below which the burn-out becomes an action */
  burnSoonDays: 7,
};

const HOUR = 3_600_000;

function compactTokens(value: number): string {
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

export function money(micros: number, currency: string): string {
  const value = micros / 1_000_000;
  return `${currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : `${currency} `}${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

export function hoursSince(iso: string, now: Date): number | null {
  const then = Date.parse(iso);
  return Number.isFinite(then) ? (now.getTime() - then) / HOUR : null;
}

/** Fold task-forge's ledger lines into the per-task view /today needs. */
export function foldTasks(events: Array<{ ts: string; task: string; event: string; version?: number; status?: string; title?: string; target?: string; note?: string }>): TaskSignal[] {
  const byId = new Map<string, TaskSignal>();
  const holders = new Map<string, Set<string>>();
  for (const event of events) {
    if (typeof event?.task !== 'string' || !event.task) continue;
    const current = byId.get(event.task) ?? { id: event.task, title: '', version: 0, status: 'draft', at: event.ts, gaps: 0, holders: 0 };
    if (event.title) current.title = event.title;
    if (typeof event.version === 'number') current.version = event.version;
    if (typeof event.status === 'string' && event.status) current.status = event.status;
    if (typeof event.ts === 'string' && event.ts) current.at = event.ts;
    if (event.event === 'acked') {
      const note = String(event.note ?? '');
      const gaps = /缺口\s*(\d+)\s*条/.exec(note);
      current.gaps = gaps ? Number.parseInt(gaps[1]!, 10) : 0;
    }
    if (event.target && (event.event === 'relayed' || event.target === '握手通过')) {
      const set = holders.get(event.task) ?? new Set<string>();
      if (typeof event.target === 'string' && event.target !== '握手通过') set.add(event.target);
      holders.set(event.task, set);
      current.holders = set.size;
    }
    byId.set(event.task, current);
  }
  return [...byId.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Fold tool-trace lines into error-rate + streaks, same thresholds as radar. */
export function foldTools(records: Array<{ at: string; tool: string; isError?: boolean }>): ToolSignal {
  const byTool = new Map<string, Array<{ at: string; isError: boolean }>>();
  for (const record of records) {
    if (typeof record?.tool !== 'string' || !record.tool) continue;
    // streaks are ordered by time, so a record without a usable stamp is worse
    // than no record: it would silently break or join a run.
    if (typeof record.at !== 'string' || !Number.isFinite(Date.parse(record.at))) continue;
    const group = byTool.get(record.tool) ?? [];
    group.push({ at: record.at, isError: record.isError === true });
    byTool.set(record.tool, group);
  }
  let calls = 0;
  let errors = 0;
  const streaks: Array<{ tool: string; run: number }> = [];
  const hot: Array<{ tool: string; rate: number }> = [];
  for (const [tool, group] of byTool) {
    calls += group.length;
    const bad = group.filter((entry) => entry.isError).length;
    errors += bad;
    let run = 0;
    let worst = 0;
    for (const entry of [...group].sort((a, b) => (a.at < b.at ? -1 : 1))) {
      if (entry.isError) {
        run++;
        worst = Math.max(worst, run);
      } else run = 0;
    }
    const rate = group.length ? bad / group.length : 0;
    if (worst >= TODAY_RULES.streakAlert) streaks.push({ tool, run: worst });
    else if (group.length >= 3 && rate > TODAY_RULES.errorRateAlert) hot.push({ tool, rate });
  }
  streaks.sort((a, b) => b.run - a.run);
  hot.sort((a, b) => b.rate - a.rate);
  return { calls, errors, errorRate: calls ? errors / calls : 0, streaks, hot };
}

/** Fold session-insights records (v1 sidecar rows) into window volume. */
export function foldSessions(records: Array<{ sessionId?: unknown; buckets?: Record<string, unknown>; costMicros?: unknown }>): SessionsSignal {
  const sessions = new Set<string>();
  let recordsSeen = 0;
  let tokens = 0;
  let costMicros = 0;
  for (const record of records) {
    if (typeof record?.sessionId !== 'string' || !record.sessionId) continue;
    sessions.add(record.sessionId);
    recordsSeen += 1;
    const buckets = record.buckets ?? {};
    const uncached = typeof buckets.uncachedInput === 'number' && Number.isFinite(buckets.uncachedInput) ? buckets.uncachedInput : 0;
    const output = typeof buckets.output === 'number' && Number.isFinite(buckets.output) ? buckets.output : 0;
    tokens += uncached + output;
    if (typeof record.costMicros === 'number' && Number.isFinite(record.costMicros)) costMicros += record.costMicros;
  }
  return { sessions: sessions.size, records: recordsSeen, tokens, costMicros };
}

/** The rule table itself: first match wins as the headline, the rest are actions. */
export function prioritiseToday(signals: TodaySignals): TodayPlan {
  const rules = TODAY_RULES;
  const blind: string[] = [];
  const actions: TodayAction[] = [];

  if (!signals.budget) blind.push('quota 的 summary.json（预算与下步预估）');
  if (!signals.spend) blind.push('cost-ledger 台账（本月花费）');
  if (!signals.tools) blind.push('tool-trace 追踪（工具面健康）');
  if (!signals.sessions) blind.push('session-insights 侧车（跨会话统计）');
  if (!signals.forecast) blind.push('spend-forecast 的 forecast.json（烧穿日期）');
  // an empty task ledger is a fact, not a blind spot — the 依据 line says 0 个任务

  if (signals.tools?.streaks.length) {
    const worst = signals.tools.streaks[0]!;
    actions.push({
      do: `先修工具链：${worst.tool} 连续失败 ${worst.run} 次`,
      why: `连败 ≥ ${rules.streakAlert} 次是系统性故障，不是抖动（本次共 ${signals.tools.calls} 次调用、错误率 ${Math.round(signals.tools.errorRate * 100)}%）`,
      command: '/health',
    });
  }

  const budget = signals.budget;
  if (budget && budget.maxSessionRatio !== null && budget.budgetTokens > 0) {
    const willBlow = budget.nextTurnEstTokens !== null && budget.maxSessionTokens + budget.nextTurnEstTokens > budget.budgetTokens;
    if (budget.maxSessionRatio >= rules.budgetAlert || willBlow) {
      const next = budget.nextTurnEstTokens === null ? '' : `，下步还要 ~${compactTokens(budget.nextTurnEstTokens)}`;
      actions.push({
        do: willBlow ? '这一步会把单会话预算烧穿：先收尾或换会话' : `预算已用到 ${Math.round(budget.maxSessionRatio * 100)}%，先看清余量再派新活`,
        why: `最热的会话 ${compactTokens(budget.maxSessionTokens)}/${compactTokens(budget.budgetTokens)} tok${next}`,
        command: '/qm',
      });
    }
  }

  const needingAnswer = signals.tasks.filter((task) => task.status !== 'done' && task.gaps > 0);
  if (needingAnswer.length) {
    const first = needingAnswer[0]!;
    actions.push({
      do: `回答 ${first.id} 的 ${first.gaps} 条缺口：/answer ${first.id} Q1 <答案>`,
      why: needingAnswer.length > 1 ? `${needingAnswer.length} 个任务在等人：${needingAnswer.map((task) => task.id).join(' ')}` : `${first.title || first.id} 的回读列了 ${first.gaps} 条待补`,
      command: '/forge-list',
    });
  }

  const awaiting = signals.tasks.filter((task) => task.status === 'relayed');
  const staleAck = awaiting
    .map((task) => ({ task, age: hoursSince(task.at, signals.now) }))
    .filter((entry) => entry.age !== null && entry.age >= rules.ackStaleHours);
  if (staleAck.length) {
    const first = staleAck[0]!;
    actions.push({
      do: `催回读：${first.task.id} 已经 ${Math.round(first.age!)} 小时没人 ack`,
      why: `${awaiting.length} 个任务处于「待回读」，最久的是 ${first.task.title || first.task.id}（${first.task.holders} 个窗口持有）`,
      command: `/ack ${first.task.id} <回读全文>`,
    });
  } else if (awaiting.length) {
    actions.push({
      do: `等 ${awaiting.map((task) => task.id).join(' ')} 的回读；拿到就 /ack`,
      why: `刚 relay 出去 ${awaiting.length} 个，还没人确认版本`,
      command: '/forge-list',
    });
  }

  if (!actions.length) {
    const ready = signals.tasks.find((task) => task.status === 'ready' || task.status === 'in-progress');
    if (ready) {
      actions.push({
        do: `让 ${ready.id} 开工（回读已通过 v${ready.version}）`,
        why: `${ready.title || ready.id} 停在 ${ready.status}`,
        command: `/forge-list`,
      });
    } else {
      actions.push({
        do: '没有阻塞：可以开新需求',
        why: signals.tasks.length ? `${signals.tasks.length} 个任务都不卡在等人` : '台账里还没有任务',
        command: '/forge <大白话需求>',
      });
    }
  }

  const forecast = signals.forecast;
  const burnSoon = forecast?.daysUntilBudget;
  if (burnSoon !== null && burnSoon !== undefined && burnSoon <= rules.burnSoonDays) {
    const trendText = forecast!.trend === 'accelerating' ? '且在加速' : forecast!.trend === 'easing' ? '，好在在降温' : '';
    actions.push({
      do: burnSoon <= 0 ? `本月预算已按当前速率烧穿（推算于 ${forecast!.budgetExhaustionDate ?? forecast!.updatedAt.slice(0, 10)}）：只留必要开支` : `本月预算 ${burnSoon} 天后烧穿（${forecast!.budgetExhaustionDate}）：省着花${trendText}`,
      why: `spend-forecast 按短窗日均 ${money(forecast!.dailyRateMicros, forecast!.currency)} 推算，本月已花 ${money(forecast!.spentThisMonthMicros, forecast!.currency)}`,
      command: '/forecast',
    });
  }

  if (signals.spend && signals.spend.records) {
    actions.push({
      do: `本月已花 ${money(signals.spend.monthMicros, signals.spend.currency)}，想看趋势与烧完日期`,
      why: `${signals.spend.records} 条计价记录 / ${signals.spend.sessions} 个会话`,
      command: '/forecast',
    });
  }

  const headline = actions[0]!;
  return { headline: `${headline.do}（${headline.command}）`, actions, blind };
}

export function renderToday(plan: TodayPlan, signals: TodaySignals): string {
  const first = plan.actions[0]!;
  const lines = [`今天第一件事：${plan.headline}`, `   └ ${first.why}`];
  plan.actions.slice(1).forEach((action, index) => {
    lines.push(`  ${index + 2}. ${action.do} — ${action.why}  [${action.command}]`);
  });
  const seen = signals.budget ? `预算 ${signals.budget.maxSessionRatio === null ? '未设' : `${Math.round(signals.budget.maxSessionRatio * 100)}%`}` : '预算未知';
  const toolText = signals.tools ? `${signals.tools.calls} 次调用·错误率 ${Math.round(signals.tools.errorRate * 100)}%` : '工具面未知';
  const sessionsText = signals.sessions ? ` · session-insights ${signals.sessions.sessions} 会话/${signals.sessions.records} 事件` : '';
  lines.push(`\n依据：task-forge ${signals.tasks.length} 个任务 · quota ${seen} · tool-trace ${toolText}${sessionsText}${signals.spend ? ` · cost-ledger ${signals.spend.records} 条` : ''}`);
  if (plan.blind.length) lines.push(`看不到的部分：${plan.blind.join('、')}——没装或还没写出数据，规则表据现有信号给结论。`);
  return lines.join('\n');
}

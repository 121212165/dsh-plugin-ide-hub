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
    streaks: Array<{
        tool: string;
        run: number;
    }>;
    /** tools over the error-rate alert line */
    hot: Array<{
        tool: string;
        rate: number;
    }>;
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
export declare const TODAY_RULES: {
    /** ratio at which the budget becomes the headline */
    budgetAlert: number;
    /** a relay nobody has read back after this many hours blocks the day */
    ackStaleHours: number;
    /** tool-trace streak length that counts as systemic (matches error-radar) */
    streakAlert: number;
    /** error-rate line, fraction (error-radar's default 20%) */
    errorRateAlert: number;
    /** daysUntilBudget at or below which the burn-out becomes an action */
    burnSoonDays: number;
};
export declare function money(micros: number, currency: string): string;
export declare function hoursSince(iso: string, now: Date): number | null;
/** Fold task-forge's ledger lines into the per-task view /today needs. */
export declare function foldTasks(events: Array<{
    ts: string;
    task: string;
    event: string;
    version?: number;
    status?: string;
    title?: string;
    target?: string;
    note?: string;
}>): TaskSignal[];
/** Fold tool-trace lines into error-rate + streaks, same thresholds as radar. */
export declare function foldTools(records: Array<{
    at: string;
    tool: string;
    isError?: boolean;
}>): ToolSignal;
/** Fold session-insights records (v1 sidecar rows) into window volume. */
export declare function foldSessions(records: Array<{
    sessionId?: unknown;
    buckets?: Record<string, unknown>;
    costMicros?: unknown;
}>): SessionsSignal;
/** The rule table itself: first match wins as the headline, the rest are actions. */
export declare function prioritiseToday(signals: TodaySignals): TodayPlan;
export declare function renderToday(plan: TodayPlan, signals: TodaySignals): string;
//# sourceMappingURL=today.d.ts.map
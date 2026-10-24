import type { UsageRecord, SessionRef } from './usage-reader.ts';
export type { UsageRecord, SessionRef };
export declare function scanClaudeCode(claudeRoot?: string): UsageRecord[];
export declare function scanCodex(codexRoot?: string): UsageRecord[];
export interface UsageAggregate {
    tool: string;
    days: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    byDay: {
        day: string;
        totalTokens: number;
        events: number;
    }[];
    byModel: {
        model: string;
        totalTokens: number;
    }[];
    projects: number;
}
export declare function aggregate(records: UsageRecord[]): UsageAggregate[];
export declare function renderUsage(aggregate: UsageAggregate[]): string;
/** Recent resumable sessions across tools (Orca's session-history pattern). */
export declare function recentSessions(records: UsageRecord[], limit?: number): SessionRef[];
/** Minimal week-activity source: everything /hub-week counts. UsageRecord fits
 * as-is; session-only sources (trae) fill in what they have and leave tokens off. */
export interface WeekSource {
    tool: string;
    sessionId: string;
    at: string;
    day: string;
    totalTokens?: number | undefined;
}
export interface WeekRow {
    tool: string;
    /** distinct sessions inside the window */
    sessions: number;
    /** usage events (≈轮次) inside the window */
    events: number;
    activeDays: number;
    totalTokens: number;
    firstDay: string;
    lastDay: string;
}
/** Per-tool activity inside the trailing window, biggest spender first. Pure. */
export declare function weekActivity(records: WeekSource[], now: Date, days?: number): WeekRow[];
export declare function renderWeek(rows: WeekRow[], days?: number): string;
//# sourceMappingURL=usage.d.ts.map
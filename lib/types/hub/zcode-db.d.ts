import type { UsageRecord, SessionRef } from './usage-reader.ts';
/** ZCode local telemetry reader (v0.3). The structured logs redact token
 * counts, but the harness persists full per-turn/per-model usage in
 * ~/.zcode/cli/db/db.sqlite (tables: session, turn_usage, model_usage).
 * Opened read-only so a live harness is never disturbed. */
export interface ZcodeUsageRecord extends UsageRecord {
    durationMs: number;
    toolCalls: number;
    toolErrors: number;
    status: string;
}
export interface ZcodeSessionRef extends SessionRef {
    title?: string | undefined;
    turns: number;
    lastActive: string;
}
export declare function zcodeDbPath(root?: string): string;
export declare function readZcodeUsage(dbPath?: string): ZcodeUsageRecord[];
export declare function readZcodeSessions(dbPath?: string, limit?: number): ZcodeSessionRef[];
export interface ZcodeTurnStat {
    turns: number;
    totalTokens: number;
    cacheHitRate: number;
    avgDurationMs: number;
    avgTtftMs: number;
    cancelled: number;
    toolErrors: number;
}
export declare function zcodeStats(records: ZcodeUsageRecord[]): ZcodeTurnStat;
export interface ZcodeModelUsage {
    provider: string;
    model: string;
    calls: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
}
/** Per provider/model aggregation from model_usage — which model burns the budget. */
export declare function readZcodeModels(dbPath?: string): ZcodeModelUsage[];
//# sourceMappingURL=zcode-db.d.ts.map
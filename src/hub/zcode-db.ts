import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
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
  title?: string;
  turns: number;
  lastActive: string;
}

export function zcodeDbPath(root?: string): string {
  return root ?? join(homedir(), '.zcode', 'cli', 'db', 'db.sqlite');
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0);

function iso(ms: unknown): string {
  return typeof ms === 'number' && ms > 0 ? new Date(ms).toISOString() : new Date(0).toISOString();
}

export function readZcodeUsage(dbPath: string = zcodeDbPath()): ZcodeUsageRecord[] {
  if (!existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare(`
      SELECT session_id, turn_id, started_at, completed_at, status,
             input_tokens, output_tokens, reasoning_tokens,
             cache_creation_input_tokens, cache_read_input_tokens,
             duration_ms, tool_call_count, tool_error_count
      FROM turn_usage
    `).all() as Record<string, unknown>[];
    return rows.map((row) => {
      const at = iso(row.started_at);
      return {
        tool: 'zcode',
        sessionId: String(row.session_id ?? 'unknown'),
        at,
        day: at.slice(0, 10),
        inputTokens: num(row.input_tokens),
        outputTokens: num(row.output_tokens) + num(row.reasoning_tokens),
        cacheReadTokens: num(row.cache_read_input_tokens),
        cacheWriteTokens: num(row.cache_creation_input_tokens),
        durationMs: num(row.duration_ms),
        toolCalls: num(row.tool_call_count),
        toolErrors: num(row.tool_error_count),
        status: String(row.status ?? 'unknown'),
      };
    });
  } finally {
    db.close();
  }
}

export function readZcodeSessions(dbPath: string = zcodeDbPath(), limit = 20): ZcodeSessionRef[] {
  if (!existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare(`
      SELECT s.id, s.title, s.directory, s.time_updated,
             (SELECT COUNT(*) FROM turn_usage t WHERE t.session_id = s.id) AS turns,
             (SELECT MAX(t.completed_at) FROM turn_usage t WHERE t.session_id = s.id) AS last_completed
      FROM session s
      ORDER BY s.time_updated DESC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      tool: 'zcode',
      sessionId: String(row.id ?? 'unknown'),
      cwd: typeof row.directory === 'string' ? row.directory : undefined,
      title: typeof row.title === 'string' ? row.title : undefined,
      at: iso(row.time_updated),
      lastActive: iso(row.last_completed),
      turns: num(row.turns),
      resumeCommand: `zcode --resume ${String(row.id ?? '')}`,
    }));
  } finally {
    db.close();
  }
}

export interface ZcodeTurnStat {
  turns: number;
  totalTokens: number;
  cacheHitRate: number;
  avgDurationMs: number;
  avgTtftMs: number;
  cancelled: number;
  toolErrors: number;
}

export function zcodeStats(records: ZcodeUsageRecord[]): ZcodeTurnStat {
  if (!records.length) return { turns: 0, totalTokens: 0, cacheHitRate: 0, avgDurationMs: 0, avgTtftMs: 0, cancelled: 0, toolErrors: 0 };
  const total = records.reduce((sum, r) => sum + r.inputTokens + r.outputTokens + r.cacheReadTokens + r.cacheWriteTokens, 0);
  const cacheRead = records.reduce((sum, r) => sum + r.cacheReadTokens, 0);
  const uncached = records.reduce((sum, r) => sum + r.inputTokens, 0);
  return {
    turns: records.length,
    totalTokens: total,
    cacheHitRate: cacheRead + uncached > 0 ? cacheRead / (cacheRead + uncached) : 0,
    avgDurationMs: Math.round(records.reduce((sum, r) => sum + r.durationMs, 0) / records.length),
    avgTtftMs: 0, // turn_usage TTFT lives in the unselected column set; model_usage has its own
    cancelled: records.filter((r) => r.status !== 'completed').length,
    toolErrors: records.reduce((sum, r) => sum + r.toolErrors, 0),
  };
}

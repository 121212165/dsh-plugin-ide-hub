/** Disk readers for `/today`. Each one mirrors another plugin's published
 * files (they are separate packages and cannot import each other), and every
 * failure mode — missing, half-written, unreadable — degrades to `null`, which
 * the rule table then reports as a blind spot instead of guessing.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { foldTasks, foldTools, foldSessions, type BudgetSignal, type ForecastSignal, type SessionsSignal, type SpendSignal, type TaskSignal, type ToolSignal } from './today.ts';

function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function readJsonFile(file: string): unknown | null {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

/** quota's published budget contract (`~/.dsh/quota/summary.json`). */
export function readBudget(file: string): BudgetSignal | null {
  const value = readJsonFile(file);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) return null;
  const budgetTokens = whole(row.budgetTokens);
  const maxSessionTokens = whole(row.maxSessionTokens);
  if (budgetTokens === null || maxSessionTokens === null) return null;
  return {
    updatedAt: row.updatedAt,
    budgetTokens,
    maxSessionTokens,
    maxSessionRatio: row.maxSessionRatio === null ? null : whole(row.maxSessionRatio),
    nextTurnEstTokens: row.nextTurnEstTokens === null ? null : whole(row.nextTurnEstTokens),
    currency: typeof row.currency === 'string' ? row.currency : '',
  };
}

function monthStamp(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function jsonl(dir: string, pattern: RegExp): { rows: Array<Record<string, unknown>>; broken: number } {
  const rows: Array<Record<string, unknown>> = [];
  let broken = 0;
  if (!existsSync(dir)) return { rows, broken };
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => pattern.test(name));
  } catch {
    return { rows, broken };
  }
  for (const name of names.sort()) {
    let content = '';
    try {
      content = readFileSync(join(dir, name), 'utf8');
    } catch {
      continue;
    }
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const value = JSON.parse(line) as unknown;
        if (value && typeof value === 'object' && !Array.isArray(value)) rows.push(value as Record<string, unknown>);
        else broken++;
      } catch {
        broken++;
      }
    }
  }
  return { rows, broken };
}

/** cost-ledger's current-month sidecars. Rows are filtered by their own month as
 * well: a stray line in a month file must not inflate 本月已花. */
export function readSpend(dir: string, now: Date): SpendSignal | null {
  const month = monthStamp(now);
  const { rows } = jsonl(dir, new RegExp(`^ledger-${month}\\.jsonl$`));
  if (!rows.length) return null;
  let monthMicros = 0;
  const sessions = new Set<string>();
  const currencies = new Map<string, number>();
  let records = 0;
  for (const row of rows) {
    const micros = whole(row.costMicros);
    if (micros === null) continue;
    if (typeof row.at !== 'string' || row.at.slice(0, 7) !== month) continue;
    records++;
    monthMicros += micros;
    if (typeof row.sessionId === 'string') sessions.add(row.sessionId);
    if (typeof row.currency === 'string') currencies.set(row.currency, (currencies.get(row.currency) ?? 0) + micros);
  }
  const currency = [...currencies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'CNY';
  return { monthMicros, currency, records, sessions: sessions.size };
}

type LedgerEventLike = { ts: string; task: string; event: string; version?: number; status?: string; title?: string; target?: string; note?: string };

/** task-forge's ledger.jsonl, folded into per-task state. */
export function readTasks(ledgerFile: string): TaskSignal[] {
  if (!existsSync(ledgerFile)) return [];
  let content = '';
  try {
    content = readFileSync(ledgerFile, 'utf8');
  } catch {
    return [];
  }
  const events: LedgerEventLike[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as LedgerEventLike;
      if (value && typeof value.task === 'string' && value.task) events.push(value);
    } catch {
      // a half-written ledger line is not a reason to lose the rest of the file
    }
  }
  return foldTasks(events);
}

/** tool-trace sidecars within the window, folded into health signals. */
export function readTools(dir: string, now: Date, days: number): ToolSignal | null {
  const since = now.getTime() - days * 86_400_000;
  const { rows } = jsonl(dir, /^tool-trace-\d{4}-(0[1-9]|1[0-2])\.jsonl$/);
  const fresh = rows.filter((row) => typeof row.at === 'string' && Number.isFinite(Date.parse(row.at)) && Date.parse(row.at as string) >= since);
  if (!fresh.length) return null;
  return foldTools(fresh as unknown as Array<{ at: string; tool: string; isError?: boolean }>);
}

/** session-insights' monthly sidecars within the window, folded into volume. */
export function readSessions(dir: string, now: Date, days: number): SessionsSignal | null {
  const since = now.getTime() - days * 86_400_000;
  const { rows } = jsonl(dir, /^insights-\d{4}-(0[1-9]|1[0-2])\.jsonl$/);
  const fresh = rows.filter((row) => typeof row.at === 'string' && Number.isFinite(Date.parse(row.at)) && Date.parse(row.at as string) >= since);
  if (!fresh.length) return null;
  return foldSessions(fresh);
}

/** spend-forecast's published forecast.json — the burn-out signal. */
export function readForecast(file: string): ForecastSignal | null {
  const value = readJsonFile(file);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.v !== 1) return null;
  if (typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))) return null;
  if (typeof row.currency !== 'string' || !row.currency) return null;
  const dailyRateMicros = whole(row.dailyRateMicros);
  if (dailyRateMicros === null) return null;
  const num = (key: string): number | null => (typeof row[key] === 'number' && Number.isFinite(row[key]) ? (row[key] as number) : null);
  return {
    updatedAt: row.updatedAt,
    currency: row.currency,
    dailyRateMicros,
    trend: typeof row.trend === 'string' ? row.trend : 'unknown',
    month: typeof row.month === 'string' ? row.month : '',
    spentThisMonthMicros: num('spentThisMonthMicros') ?? 0,
    projectedMonthEndMajor: num('projectedMonthEndMajor') ?? 0,
    budgetMajor: num('budgetMajor'),
    daysUntilBudget: num('daysUntilBudget'),
    budgetExhaustionDate: typeof row.budgetExhaustionDate === 'string' ? row.budgetExhaustionDate : null,
  };
}

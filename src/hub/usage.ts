import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { claudeRecord, codexRecord, resumeCommand } from './usage-reader.ts';
import type { UsageRecord, SessionRef } from './usage-reader.ts';
export type { UsageRecord, SessionRef };

/** Scanners: walk the on-disk roots for each supported tool and emit uniform
 * records. Scanning is read-only and bounded (recent files only when the root
 * is huge is a future knob). */

function readLines(path: string): string[] {
  try {
    return readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => line.trim());
  } catch {
    return [];
  }
}

export function scanClaudeCode(claudeRoot?: string): UsageRecord[] {
  const root = claudeRoot ?? join(homedir(), '.claude', 'projects');
  const records: UsageRecord[] = [];
  if (!existsSync(root)) return records;
  for (const projectDir of readdirSync(root)) {
    const projectPath = join(root, projectDir);
    let files: string[] = [];
    try {
      if (!statSync(projectPath).isDirectory()) continue;
      files = readdirSync(projectPath).filter((name) => name.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of files) {
      for (const line of readLines(join(projectPath, file))) {
        try {
          const record = claudeRecord(JSON.parse(line));
          if (record) records.push(record);
        } catch {
          // malformed line: skip
        }
      }
    }
  }
  return records;
}

export function scanCodex(codexRoot?: string): UsageRecord[] {
  const root = codexRoot ?? join(homedir(), '.codex', 'sessions');
  const records: UsageRecord[] = [];
  if (!existsSync(root)) return records;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(current, name);
      try {
        if (statSync(full).isDirectory()) {
          stack.push(full);
          continue;
        }
      } catch {
        continue;
      }
      if (!name.endsWith('.jsonl')) continue;
      let cwd: string | undefined;
      let sessionId: string | undefined;
      // token_count totals are cumulative within a session: keep only the LAST
      // event, otherwise summing every event multiplies the real spend
      let last: UsageRecord | null = null;
      for (const line of readLines(full)) {
        try {
          const parsed = JSON.parse(line) as import('./usage-reader.ts').CodexLine;
          if (parsed.type === 'session_meta' && parsed.payload) {
            cwd = parsed.payload.cwd;
            sessionId = parsed.payload.session_id;
          }
          const record = codexRecord(parsed);
          if (record) {
            last = { ...record, cwd, sessionId: record.sessionId === 'unknown' ? (sessionId ?? 'unknown') : record.sessionId };
          }
        } catch {
          // malformed line: skip
        }
      }
      if (last) records.push(last);
    }
  }
  return records;
}

export interface UsageAggregate {
  tool: string;
  days: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  byDay: { day: string; totalTokens: number; events: number }[];
  byModel: { model: string; totalTokens: number }[];
  projects: number;
}

export function aggregate(records: UsageRecord[]): UsageAggregate[] {
  const byTool = new Map<string, UsageRecord[]>();
  for (const record of records) {
    const group = byTool.get(record.tool) ?? [];
    group.push(record);
    byTool.set(record.tool, group);
  }
  const out: UsageAggregate[] = [];
  for (const [tool, group] of byTool) {
    const byDay = new Map<string, { day: string; totalTokens: number; events: number }>();
    const byModel = new Map<string, number>();
    const projects = new Set<string>();
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    for (const record of group) {
      const tokens = record.inputTokens + record.outputTokens + record.cacheReadTokens + record.cacheWriteTokens;
      input += record.inputTokens;
      output += record.outputTokens;
      cacheRead += record.cacheReadTokens;
      cacheWrite += record.cacheWriteTokens;
      const day = byDay.get(record.day) ?? { day: record.day, totalTokens: 0, events: 0 };
      day.totalTokens += tokens;
      day.events++;
      byDay.set(record.day, day);
      if (record.model) byModel.set(record.model, (byModel.get(record.model) ?? 0) + tokens);
      if (record.cwd) projects.add(record.cwd);
    }
    out.push({
      tool,
      days: byDay.size,
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      totalTokens: input + output + cacheRead + cacheWrite,
      byDay: [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
      byModel: [...byModel.entries()].map(([model, totalTokens]) => ({ model, totalTokens })).sort((a, b) => b.totalTokens - a.totalTokens),
      projects: projects.size,
    });
  }
  return out.sort((a, b) => b.totalTokens - a.totalTokens);
}

export function renderUsage(aggregate: UsageAggregate[]): string {
  if (!aggregate.length) return '没有读到任何用量数据（Claude Code / Codex 的本地 jsonl 都为空或不存在）。';
  const blocks = aggregate.map((tool) => {
    const head = `${tool.tool}: ${tool.totalTokens.toLocaleString()} tok（输入 ${tool.inputTokens.toLocaleString()} · 输出 ${tool.outputTokens.toLocaleString()} · 缓存读 ${tool.cacheReadTokens.toLocaleString()}）· ${tool.days} 个活跃日 · ${tool.projects} 个项目`;
    const days = tool.byDay.slice(-7).map((day) => `    ${day.day}  ${day.totalTokens.toLocaleString().padStart(10)} tok  (${day.events} 次)`);
    const models = tool.byModel.slice(0, 3).map((model) => `    ${model.model}  ${model.totalTokens.toLocaleString()}`);
    return [head, '  近 7 日:', ...days, ...(models.length ? ['  模型:', ...models] : [])].join('\n');
  });
  return blocks.join('\n\n');
}

/** Recent resumable sessions across tools (Orca's session-history pattern). */
export function recentSessions(records: UsageRecord[], limit = 10): SessionRef[] {
  const byKey = new Map<string, UsageRecord>();
  for (const record of records) {
    const key = `${record.tool}\u0000${record.sessionId}`;
    const seen = byKey.get(key);
    if (!seen || record.at > seen.at) byKey.set(key, record);
  }
  return [...byKey.values()]
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit)
    .map((record) => ({
      tool: record.tool,
      sessionId: record.sessionId,
      cwd: record.cwd,
      at: record.at,
      resumeCommand: resumeCommand(record.tool, record.sessionId),
    }));
}

/** Minimal week-activity source: everything /hub-week counts. UsageRecord fits
 * as-is; session-only sources (trae) fill in what they have and leave tokens off. */
export interface WeekSource {
  tool: string;
  sessionId: string;
  at: string;
  day: string;
  totalTokens?: number;
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
export function weekActivity(records: WeekSource[], now: Date, days = 7): WeekRow[] {
  const cutoff = now.getTime() - days * 86_400_000;
  const byTool = new Map<string, WeekSource[]>();
  for (const record of records) {
    const at = Date.parse(record.at);
    if (!Number.isFinite(at) || at < cutoff) continue;
    const group = byTool.get(record.tool) ?? [];
    group.push(record);
    byTool.set(record.tool, group);
  }
  return [...byTool.entries()]
    .map(([tool, group]) => {
      const sessions = new Set(group.map((record) => record.sessionId));
      const activeDays = new Set(group.map((record) => record.day));
      let totalTokens = 0;
      let firstDay = '';
      let lastDay = '';
      for (const record of group) {
        totalTokens += record.totalTokens ?? 0;
        if (!firstDay || record.day < firstDay) firstDay = record.day;
        if (!lastDay || record.day > lastDay) lastDay = record.day;
      }
      return { tool, sessions: sessions.size, events: group.length, activeDays: activeDays.size, totalTokens, firstDay, lastDay };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens || b.events - a.events || (a.tool < b.tool ? -1 : 1));
}

export function renderWeek(rows: WeekRow[], days = 7): string {
  if (!rows.length) return `近 ${days} 天没有任何 IDE 活动记录。`;
  const lines = [`各 IDE 近 ${days} 天活跃（按 token 排序）:`];
  for (const row of rows) {
    const tokens = row.totalTokens > 0 ? `${row.totalTokens.toLocaleString()} tok · ` : '';
    lines.push(`  ${row.tool.padEnd(12)} ${row.sessions} 会话 · ${row.events} 轮 · ${tokens}${row.activeDays} 活跃日（${row.firstDay} → ${row.lastDay}）`);
  }
  return lines.join('\n');
}

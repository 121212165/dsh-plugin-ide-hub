import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claudeRecord, codexRecord, resumeCommand } from '../src/hub/usage-reader.ts';
import { aggregate, recentSessions, renderUsage, weekActivity, renderWeek } from '../src/hub/usage.ts';
import type { UsageRecord } from '../src/hub/usage-reader.ts';

test('claude assistant line with usage parses into a record', () => {
  const record = claudeRecord({
    type: 'assistant',
    sessionId: 'abc-123',
    timestamp: '2026-09-30T08:00:00.000Z',
    cwd: 'C:/proj',
    message: { model: 'claude-5', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 9000, cache_creation_input_tokens: 200 } },
  });
  assert.ok(record);
  assert.equal(record!.tool, 'claude-code');
  assert.equal(record!.day, '2026-09-30');
  assert.equal(record!.inputTokens, 100);
  assert.equal(record!.cacheReadTokens, 9000);
});

test('claude user lines and zero-usage synthetic lines are skipped', () => {
  assert.equal(claudeRecord({ type: 'user', sessionId: 's', timestamp: 'x' }), null);
  assert.equal(claudeRecord({ type: 'assistant', sessionId: 's', timestamp: 'x', message: { usage: { input_tokens: 0, output_tokens: 0 } } }), null);
});

test('codex token_count event parses with reasoning folded into output', () => {
  const record = codexRecord({
    timestamp: '2026-09-30T08:00:00.000Z',
    type: 'event_msg',
    payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 800, output_tokens: 40, reasoning_output_tokens: 60 } }, session_id: '01a' },
  });
  assert.ok(record);
  assert.equal(record!.outputTokens, 100); // 40 + 60 reasoning
  assert.equal(record!.cacheReadTokens, 800);
});

test('codex non-token events are skipped', () => {
  assert.equal(codexRecord({ type: 'event_msg', payload: { type: 'agent_reasoning' } }), null);
  assert.equal(codexRecord({ type: 'response_item' }), null);
});

test('aggregate groups per tool with days and models', () => {
  const record = (over: Partial<UsageRecord>): UsageRecord =>
    ({ tool: 'claude-code', sessionId: 's', at: '2026-09-30T08:00:00.000Z', day: '2026-09-30', inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, model: 'claude-5', cwd: 'C:/proj', ...over }) as UsageRecord;
  const result = aggregate([
    record({}),
    record({ sessionId: 's2', model: 'claude-5' }),
    record({ day: '2026-09-29', at: '2026-09-29T08:00:00.000Z', tool: 'codex', model: undefined, cwd: 'C:/other' }),
  ]);
  assert.equal(result.length, 2);
  const claude = result.find((tool) => tool.tool === 'claude-code')!;
  assert.equal(claude.totalTokens, 300);
  assert.equal(claude.days, 1);
  assert.equal(claude.projects, 1);
  const codex = result.find((tool) => tool.tool === 'codex')!;
  assert.equal(codex.days, 1);
});

test('recentSessions dedupes per session and maps resume commands', () => {
  const record = (over: Partial<UsageRecord>): UsageRecord =>
    ({ tool: 'claude-code', sessionId: 'abc', at: '2026-09-30T08:00:00.000Z', day: '2026-09-30', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, ...over }) as UsageRecord;
  const sessions = recentSessions([record({}), record({ at: '2026-09-30T09:00:00.000Z' }), record({ tool: 'codex', sessionId: '01a', at: '2026-09-30T10:00:00.000Z' })], 10);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0]!.resumeCommand, 'codex resume 01a');
  assert.equal(sessions[1]!.resumeCommand, 'claude --resume abc');
  assert.equal(resumeCommand('catpaw', 'x'), null);
});

test('rendering is stable without data', () => {
  assert.ok(renderUsage([]).includes('没有读到'));
});

test('weekActivity groups per tool inside the window; renderWeek prints one row each', () => {
  const now = new Date('2026-10-05T12:00:00.000Z');
  const source = (tool: string, sessionId: string, at: string, totalTokens?: number) => ({
    tool,
    sessionId,
    at,
    day: at.slice(0, 10),
    totalTokens,
  });
  const records = [
    source('claude-code', 's1', '2026-10-05T08:00:00.000Z', 1_200),
    source('claude-code', 's1', '2026-10-04T08:00:00.000Z', 800), // same session, two turns
    source('claude-code', 's2', '2026-09-01T08:00:00.000Z', 999_999), // outside the window
    source('codex', 's3', '2026-10-03T08:00:00.000Z', 2_000),
    source('trae', 's4', '2026-10-05T09:00:00.000Z'), // session-only source: no tokens
    { tool: 'codex', sessionId: 's5', at: 'not-a-date', day: 'x', totalTokens: 5 }, // unusable stamp
  ];

  const rows = weekActivity(records, now);
  assert.deepEqual(rows.map((row) => row.tool), ['claude-code', 'codex', 'trae']); // tokens desc, trae last
  const claude = rows[0]!;
  assert.equal(claude.sessions, 1, 's2 is outside the window; only s1 counts');
  assert.equal(claude.events, 2, 'the out-of-window event is not counted');
  assert.equal(claude.totalTokens, 2_000);
  assert.equal(claude.activeDays, 2);
  assert.equal(claude.firstDay, '2026-10-04');
  assert.equal(rows[2]!.totalTokens, 0, 'trae has no token data and that is fine');

  const text = renderWeek(rows);
  assert.ok(text.includes('近 7 天'), text);
  assert.ok(text.includes('claude-code'), text);
  assert.ok(text.includes('1 会话 · 2 轮 · 2,000 tok'), text);
  assert.ok(text.includes('2026-09-29 → ') === false, 'span only covers in-window days');
  assert.match(renderWeek([]), /没有任何 IDE 活动记录/);
});

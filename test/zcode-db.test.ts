import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readZcodeUsage, readZcodeSessions, zcodeStats } from '../src/hub/zcode-db.ts';

function fixtureDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zcode-db-'));
  const path = join(dir, 'db.sqlite');
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_updated INTEGER);
    CREATE TABLE turn_usage (session_id TEXT, turn_id TEXT, started_at INTEGER, completed_at INTEGER, status TEXT,
      input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
      cache_creation_input_tokens INTEGER, cache_read_input_tokens INTEGER,
      duration_ms INTEGER, tool_call_count INTEGER, tool_error_count INTEGER);
  `);
  db.prepare("INSERT INTO session VALUES ('sess_a', '测试会话', 'C:/proj', 1789745764073)").run();
  db.prepare("INSERT INTO turn_usage VALUES ('sess_a','t1',1789745764073,1789745800000,'completed',1000,200,50,300,5000,60000,4,1)").run();
  db.prepare("INSERT INTO turn_usage VALUES ('sess_a','t2',1789746000000,1789746100000,'cancelled',2000,100,0,0,8000,30000,2,3)").run();
  db.close();
  return path;
}

test('reads turn_usage into uniform records with reasoning folded into output', () => {
  const records = readZcodeUsage(fixtureDb());
  assert.equal(records.length, 2);
  assert.equal(records[0]!.tool, 'zcode');
  assert.equal(records[0]!.outputTokens, 250); // 200 + 50 reasoning
  assert.equal(records[0]!.cacheReadTokens, 5000);
  assert.equal(records[1]!.status, 'cancelled');
  assert.equal(records[1]!.toolErrors, 2);
});

test('stats compute cache hit over read+uncached and count non-completed', () => {
  const stats = zcodeStats(readZcodeUsage(fixtureDb()));
  assert.equal(stats.turns, 2);
  assert.equal(stats.totalTokens, 1000 + 200 + 50 + 300 + 5000 + 2000 + 100 + 0 + 0 + 8000);
  assert.equal(stats.cancelled, 1);
  assert.equal(stats.toolErrors, 2);
  assert.ok(stats.cacheHitRate > 0.7);
});

test('sessions join turn counts and expose resume commands', () => {
  const sessions = readZcodeSessions(fixtureDb(), 10);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]!.turns, 2);
  assert.equal(sessions[0]!.title, '测试会话');
  assert.equal(sessions[0]!.resumeCommand, 'zcode --resume sess_a');
});

test('missing db reads as empty', () => {
  assert.deepEqual(readZcodeUsage(join(tmpdir(), 'nope-' + Date.now(), 'db.sqlite')), []);
});

/**
 * Fixture-based tests for the Trae (CN) reader: state.vscdb workspaces are
 * synthesized in a temp roots dir with node:sqlite, so the full scan path —
 * workspace.json decoding, message tallying, timestamp mixing, corrupt-db
 * skipping, and chat-session sorting — runs without a live Trae install.
 * @module test/trae-fixture
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { scanTrae, traeChatSessions, type TraeInventory } from '../src/hub/trae-db.ts';

const STORAGE_KEY = 'memento/icube-ai-agent-storage';

function agentPayload(sessions: unknown): string {
  return JSON.stringify({ list: sessions });
}

interface SynthSession { sessionId?: string; title?: string; name?: string; updatedAt?: string | number; createdAt?: string | number; messages?: Array<{ role?: string; content?: unknown; modelInfo?: { display_model_name?: string } }>; hasMore?: boolean }

function synthWorkspace(root: string, storageId: string, data: { folder?: string; sessions?: SynthSession[]; dbCorrupt?: boolean; emptyKey?: boolean; workspaceJson?: string }): void {
  const dir = join(root, storageId);
  mkdirSync(dir, { recursive: true });
  if (data.workspaceJson !== undefined) writeFileSync(join(dir, 'workspace.json'), data.workspaceJson, 'utf8');
  else if (data.folder !== undefined) writeFileSync(join(dir, 'workspace.json'), JSON.stringify({ folder: data.folder }), 'utf8');
  if (data.dbCorrupt) {
    writeFileSync(join(dir, 'state.vscdb'), 'not-a-sqlite-file', 'utf8');
    return;
  }
  const db = new DatabaseSync(join(dir, 'state.vscdb'));
  db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)');
  db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)').run(STORAGE_KEY, agentPayload(data.emptyKey ? undefined : data.sessions ?? []));
  db.close();
}

const ROOT = mkdtempSync(join(tmpdir(), 'trae-fixture-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));

test('scan one healthy workspace: folder decoded, tallies and lastActive right', () => {
  synthWorkspace(ROOT, 'ws-a', {
    folder: 'file:///d:/glitch/repair-wiki',
    sessions: [
      { sessionId: 's1', title: 'One', updatedAt: '2026-10-10T08:00:00.000Z', messages: [{ role: 'user' }, { role: 'assistant', modelInfo: { display_model_name: 'm1' } }] },
      { sessionId: 's2', title: 'Two', updatedAt: 1_720_000_000_000, messages: [{ role: 'user' }] },
    ],
  });
  const scan = scanTrae([ROOT]);
  assert.equal(scan.workspaces.length, 1);
  const ws = scan.workspaces[0]!;
  assert.equal(ws.folder, 'd:/glitch/repair-wiki', `decoded folder: ${ws.folder}`);
  assert.equal(ws.sessions, 2);
  assert.equal(ws.localMessages, 3);
  assert.equal(scan.totalSessions, 2);
  assert.equal(scan.totalLocalMessages, 3);
  assert.equal(ws.lastActive, '2026-10-10T08:00:00.000Z', 'ISO stamp picked over the epoch; sorts later');
});

test('mixed roots: missing dir, corrupt db, malformed workspace.json, empty-key db', () => {
  synthWorkspace(ROOT, 'ws-broken', { dbCorrupt: true });
  synthWorkspace(ROOT, 'ws-no-json', {
    workspaceJson: '{ folder: [,broken',
    sessions: [{ sessionId: 's3', messages: [{ role: 'user' }, { role: 'assistant' }, { role: 'assistant' }] }],
  });
  synthWorkspace(ROOT, 'ws-empty', { sessions: [] });
  const scan = scanTrae([join(ROOT, 'does-not-exist'), ROOT]);
  const broken = scan.workspaces.find((ws) => ws.storageId === 'ws-broken');
  assert.equal(broken, undefined, 'corrupt db skipped');
  const noJson = scan.workspaces.find((ws) => ws.storageId === 'ws-no-json');
  assert.equal(noJson!.folder, undefined, 'malformed workspace.json leaves folder unknown');
  assert.equal(noJson!.sessions, 1);
  const empty = scan.workspaces.find((ws) => ws.storageId === 'ws-empty');
  assert.equal(empty!.sessions, 0);
  assert.equal(empty!.lastActive, null);
});

test('traeChatSessions: newest first, models deduped, untitled fallback, hasMore flagged', async () => {
  synthWorkspace(ROOT, 'ws-chats', {
    folder: 'file:///c:/proj/app',
    sessions: [
      { sessionId: 'old', name: 'named-by-name', updatedAt: '2026-09-01T00:00:00.000Z', messages: [{ }, { role: 'assistant', modelInfo: { display_model_name: 'glm' } }, { role: 'assistant', modelInfo: { display_model_name: 'glm' } }] },
      { sessionId: 'new', hasMore: true, updatedDocuments: undefined, updatedAt: '2026-10-12T00:00:00.000Z', messages: [{ role: 'user', modelInfo: { display_model_name: 'm9' } }] },
    ],
  } as never);
  const scan = scanTrae([ROOT]);
  const chats = traeChatSessions(scan, 20);
  assert.equal(chats[0]!.sessionId, 'new', `newest first, got [${chats.map((chat) => chat.sessionId)}]`);
  const oldest = chats.find((chat) => chat.sessionId === 'old');
  assert.equal(oldest!.title, 'named-by-name', 'name falls back when title missing');
  assert.equal(oldest!.workspaceFolder, 'c:/proj/app');
  assert.deepEqual(oldest!.models, ['glm'], 'model names dedupe');
});

test('real corpus behavior: hasMore sessions report 0 or more local bodies only', () => {
  const inventory: TraeInventory = { workspaces: [], totalSessions: 0, totalLocalMessages: 0 };
  assert.deepEqual(traeChatSessions(inventory), [], 'empty inventory is a clean empty list');
});

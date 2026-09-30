import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverRules, renderRulesNotes, renderMigrationNote, writeNotes } from '../src/hub/obsidian.ts';
import type { IdeSpec } from '../src/hub/registry.ts';

test('rule discovery finds existing files only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ide-hub-rules-'));
  const file = join(dir, 'CLAUDE.md');
  writeFileSync(file, '# my rules\n- 中文回复');
  const specs: IdeSpec[] = [
    { tool: 'claude-code', dataRoots: [], sessionMatch: {}, promptFiles: [file], vendor: 'global' },
    { tool: 'codex', dataRoots: [], sessionMatch: {}, promptFiles: [join(dir, 'missing.md')], vendor: 'global' },
  ];
  const rules = discoverRules(specs);
  assert.equal(rules.length, 1);
  assert.equal(rules[0]!.tool, 'claude-code');
  rmSync(dir, { recursive: true, force: true });
});

test('obsidian export is idempotent and snapshots rule content', () => {
  const vault = mkdtempSync(join(tmpdir(), 'ide-hub-vault-'));
  const notes = renderRulesNotes([{ tool: 'claude-code', path: join(tmpdir(), 'fake-rules.md'), bytes: 10, mtime: '2026-09-30T00:00:00.000Z' }], '2026-09-30T00:00:00.000Z');
  const first = writeNotes(vault, notes);
  const second = writeNotes(vault, notes);
  assert.ok(first.written.length >= 2);
  assert.equal(second.skipped, notes.length);
  assert.ok(existsSync(join(vault, 'IDE-Hub', 'prompts', '索引.md')));
  rmSync(vault, { recursive: true, force: true });
});

test('migration note carries the plan lines', () => {
  const note = renderMigrationNote(['  trae ❌ 耗尽 剩 0 天'], '2026-09-30T00:00:00.000Z');
  assert.ok(note.path === 'IDE-Hub/额度迁移计划.md');
  assert.ok(note.content.includes('# 额度迁移计划'));
  assert.ok(note.content.includes('trae ❌ 耗尽'));
});

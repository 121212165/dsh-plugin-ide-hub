import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventory, expandPath } from '../src/hub/inventory.ts';
import type { IdeSpec } from '../src/hub/registry.ts';

const spec = (root: string): IdeSpec => ({
  tool: 'fake',
  dataRoots: [root],
  sessionMatch: { suffixes: ['.jsonl'], dirNames: ['sessions'] },
  vendor: 'global',
});

test('inventory counts session files, dirs, sizes and last-active', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ide-hub-'));
  mkdirSync(join(dir, 'sessions'));
  writeFileSync(join(dir, 'a.jsonl'), 'x'.repeat(100));
  writeFileSync(join(dir, 'sessions', 'inner.jsonl'), 'y'.repeat(50));
  const result = inventory(spec(dir));
  assert.equal(result.present, true);
  assert.equal(result.sessions, 2);
  assert.equal(result.bytes, 150);
  assert.ok(result.lastActive !== null);
  rmSync(dir, { recursive: true, force: true });
});

test('absent roots report present=false instead of throwing', () => {
  const result = inventory(spec(join(tmpdir(), 'ide-hub-missing-' + Date.now())));
  assert.equal(result.present, false);
  assert.equal(result.sessions, 0);
  assert.equal(result.lastActive, null);
});

test('deep nesting beyond depth 4 is not walked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ide-hub-'));
  let deep = dir;
  for (let index = 0; index < 8; index++) deep = join(deep, `level${index}`);
  mkdirSync(deep, { recursive: true });
  writeFileSync(join(deep, 'deep.jsonl'), 'z'.repeat(10));
  const result = inventory(spec(dir));
  assert.equal(result.sessions, 0); // past the walk budget
  rmSync(dir, { recursive: true, force: true });
});

test('expandPath resolves ~ and {APPDATA}', () => {
  assert.ok(!expandPath('~/.x').startsWith('~'));
  assert.ok(!expandPath('{APPDATA}/x').includes('{APPDATA}'));
});

/** Pure tests for the pointer generator: idempotent attach, never-clobber merges,
 * zero-residue uninstall, and the honest split between "we know this path" and
 * "the user must do this one".
 * @module test/pointers */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  HUB_BODY,
  POINTER_BEGIN,
  POINTER_END,
  POINTER_SPECS,
  hasPointer,
  mergePointer,
  pointerBlock,
  pointerTargets,
  renderHubAgents,
  renderProjectNotes,
  renderStructureJson,
  stripPointer,
  unmergePointer,
} from '../src/hub/pointers.ts';

const USER_TEXT = '# 这个项目\n\n只有我能写的规矩。\n';

test('the pointer block names the body it points at and how to remove itself', () => {
  const block = pointerBlock();
  assert.ok(block.startsWith(POINTER_BEGIN));
  assert.ok(block.endsWith(POINTER_END));
  assert.ok(block.includes(HUB_BODY), block);
  assert.ok(block.includes('/hub-init --remove'), 'the file must explain its own uninstall');
  assert.ok(hasPointer(block));
  // an @mention would be a syntax claim not every tool supports; a plain
  // instruction to read the body works in all five.
  assert.ok(!/@\.hub/.test(block), block);
  assert.equal(block.split('\n').length, 5);
});

test('merging is idempotent and never reorders the user own text', () => {
  const created = mergePointer(null);
  assert.equal(created.action, 'create');
  assert.equal(created.content, `${pointerBlock()}\n`);

  const appended = mergePointer(USER_TEXT);
  assert.equal(appended.action, 'append');
  assert.ok(appended.content.startsWith(USER_TEXT.trimEnd()), 'the user content stays first and intact');
  assert.ok(appended.content.includes(POINTER_BEGIN));

  const again = mergePointer(appended.content);
  assert.equal(again.action, 'noop', 'a rerun must not append a second block');
  assert.equal(again.content, appended.content);

  // a hand-edited file that still carries the markers gets the block refreshed, once
  const edited = appended.content.replace('开始任何工作前先读', '开工前先读');
  const refreshed = mergePointer(edited);
  assert.equal(refreshed.action, 'rewrite');
  assert.equal((refreshed.content.match(/<!-- hub-pointer:start/g) ?? []).length, 1);
  assert.ok(refreshed.content.startsWith(USER_TEXT.trimEnd()));
  assert.ok(refreshed.content.includes('开工前先读') === false, 'the stale block is replaced by the current one');

  assert.equal(mergePointer('   ').action, 'rewrite', 'a whitespace-only file is not user content');
  assert.equal(mergePointer('# 只有正文，没标记\n').action, 'append');
});

test('uninstall lifts the block out and reports files that can be deleted', () => {
  const withBlock = mergePointer(USER_TEXT).content;
  const stripped = unmergePointer(withBlock);
  assert.equal(stripped.deleteFile, false);
  assert.equal(stripped.content, USER_TEXT, 'back to exactly the bytes the user had');

  const onlyBlock = mergePointer(null).content;
  assert.deepEqual(unmergePointer(onlyBlock), { content: '', deleteFile: true });

  assert.equal(stripPointer('# 没有我们的东西\n'), '# 没有我们的东西\n', 'a file without markers passes through');
  // a block sandwiched in the middle keeps both sides
  const middle = `前段\n\n${onlyBlock.trimEnd()}\n\n后段\n`;
  assert.equal(stripPointer(middle), '前段\n\n后段\n');
});

test('the adapter table groups five tools onto one file and keeps the unverified ones manual', () => {
  assert.deepEqual(POINTER_SPECS.map((spec) => `${spec.tool}:${spec.mode}`).sort(), [
    'catpaw:manual',
    'claude-code:block',
    'codex:block',
    'dsh:block',
    'opencode:block',
    'qoder:manual',
    'trae:manual',
    'zcode:block',
  ]);

  const { block, manual } = pointerTargets();
  assert.deepEqual(block.map((target) => target.path), ['AGENTS.md', 'CLAUDE.md'], 'one write per file, not per tool');
  const agents = block.find((target) => target.path === 'AGENTS.md')!;
  assert.deepEqual(agents.tools, ['codex', 'opencode', 'zcode', 'dsh']);
  assert.equal(agents.notes.length, 4, 'each tool keeps its own reason');
  assert.deepEqual(manual.map((spec) => spec.tool), ['trae', 'qoder', 'catpaw']);
  assert.ok(manual.every((spec) => spec.note.includes('未在本机核实')), 'manual means we say so, not that we guess');

  const subset = pointerTargets(['claude-code', 'trae']);
  assert.deepEqual(subset.block.map((target) => target.path), ['CLAUDE.md']);
  assert.deepEqual(subset.manual.map((spec) => spec.tool), ['trae']);
  assert.deepEqual(pointerTargets([]), { block: [], manual: [] });
  assert.deepEqual(pointerTargets(['nonexistent-ide']), { block: [], manual: [] });
});

test('the generated body and notes tell a reader where the pointers live', () => {
  const agents = renderHubAgents('my-app');
  assert.ok(agents.startsWith('# my-app — 项目规则本体'), agents.slice(0, 60));
  assert.ok(agents.includes('.hub/AGENTS.md'));
  assert.ok(agents.includes('AGENTS.md'));
  assert.ok(agents.includes('CLAUDE.md'));
  assert.ok(agents.includes('/hub-init --remove'));
  assert.ok(agents.includes('<待补充'), 'a template admits what it has not been told yet');
  assert.ok(!agents.includes('绝对不要修改'), 'it does not invent project rules');

  const notes = renderProjectNotes('my-app');
  assert.ok(notes.includes('- [ ]'));
  assert.ok(notes.includes('task-forge'));
});

test('STRUCTURE.json is valid JSON carrying a staleness stamp and honest counts', () => {
  const json = renderStructureJson(
    'my-app',
    [
      { path: 'src/', kind: 'dir' },
      { path: 'src/a.ts', kind: 'file', size: 100 },
      { path: 'README.md', kind: 'file', size: 50 },
    ],
    new Date('2026-10-02T09:00:00Z'),
  );
  const parsed = JSON.parse(json) as { v: number; project: string; generatedAt: string; generator: string; counts: Record<string, number>; entries: unknown[] };
  assert.equal(parsed.v, 1);
  assert.equal(parsed.project, 'my-app');
  assert.equal(parsed.generatedAt, '2026-10-02T09:00:00.000Z');
  assert.match(parsed.generator, /ide-hub/);
  assert.deepEqual(parsed.counts, { dirs: 1, files: 2, bytes: 150 });
  assert.equal(parsed.entries.length, 3);
  assert.ok(json.endsWith('\n'));
  assert.deepEqual(JSON.parse(renderStructureJson('empty', [], new Date('2026-10-02T09:00:00Z'))).counts, { dirs: 0, files: 0, bytes: 0 });
});

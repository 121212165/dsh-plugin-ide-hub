/** Wire tests for the pointer generator: runHubInit against real temp projects,
 * and the /hub-init command surface (flag parsing, refusals, reports).
 * @module test/hub-init */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply, runHubInit, scanTree } from '../src/plugin.ts';
import { POINTER_BEGIN, renderHubAgents } from '../src/hub/pointers.ts';

const NOW = new Date('2026-10-02T09:00:00Z');

/** A throwaway project with a little real content in it. */
function project(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'ide-hub-init-'));
  after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'node_modules', 'left-pad'), { recursive: true });
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
  writeFileSync(join(root, 'node_modules', 'left-pad', 'index.js'), 'junk', 'utf8');
  writeFileSync(join(root, '.git', 'config'), 'junk', 'utf8');
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path).replace(/[^\\/]*$/, ''), { recursive: true });
    writeFileSync(join(root, path), content, 'utf8');
  }
  return root;
}

interface CapturedCommand {
  name: string;
  description: string;
  input?: { hint?: string };
  handler: (args: { rawInput?: string }) => { kind: string; text: string };
}

function mount(): (name: string, rawInput?: string) => { kind: string; text: string } {
  const commands: CapturedCommand[] = [];
  apply(
    { logger: () => ({ info() {}, warn() {}, debug() {} }), commands: { register: (definition: CapturedCommand) => void commands.push(definition) } } as never,
    { enabled: true, quotas: [] } as never,
  );
  const registered = new Map(commands.map((command) => [command.name, command]));
  assert.ok(registered.has('hub-init'), '/hub-init must be registered alongside the existing commands');
  return (name, rawInput) => registered.get(name)!.handler({ rawInput });
}

test('scanTree walks two levels, skips the noise, and says when it ran out', () => {
  const root = project({ 'b.md': 'second entry\n' });
  const { entries, truncated } = scanTree(root);
  const paths = entries.map((entry) => entry.path);
  assert.ok(paths.includes('src/'), paths.join(','));
  assert.ok(paths.includes('src/a.ts'));
  assert.ok(!paths.some((path) => path.includes('node_modules')), 'dependency trees are not structure');
  assert.ok(!paths.some((path) => path.startsWith('.')), 'dot directories stay out of the snapshot');
  assert.equal(truncated, false);
  assert.deepEqual(scanTree(join(root, 'never-existed')), { entries: [], truncated: false });

  const capped = scanTree(root, 1);
  assert.equal(capped.truncated, true);
  assert.equal(capped.entries.length, 1);
});

test('/hub-init installs the body, the snapshot, and one pointer per rule file', () => {
  const root = project();
  const result = runHubInit(root, { now: NOW });
  assert.equal(result.project, root.split(/[\\/]/).pop());
  assert.deepEqual(
    result.changes.map((change) => [change.file, change.outcome]),
    [
      ['.hub/AGENTS.md', 'created'],
      ['.hub/PROJECT_NOTES.md', 'created'],
      ['.hub/STRUCTURE.json', 'created'],
      ['AGENTS.md', 'created'],
      ['CLAUDE.md', 'created'],
    ],
  );
  assert.deepEqual(result.manual.map((item) => item.tool), ['trae', 'qoder', 'catpaw']);

  const body = readFileSync(join(root, '.hub', 'AGENTS.md'), 'utf8');
  assert.equal(body, renderHubAgents(result.project));
  const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes(POINTER_BEGIN));
  assert.ok(agents.includes('.hub/AGENTS.md'));
  const snapshot = JSON.parse(readFileSync(join(root, '.hub', 'STRUCTURE.json'), 'utf8')) as { generatedAt: string; entries: unknown[] };
  assert.equal(snapshot.generatedAt, NOW.toISOString());
  assert.ok(snapshot.entries.length >= 2);
});

test('a rerun changes nothing, and the user own rule text survives both ways', () => {
  const root = project({ 'AGENTS.md': '# 我的项目规矩\n\n别碰 make。\n' });
  const first = runHubInit(root, { now: NOW });
  assert.deepEqual(
    first.changes.find((change) => change.file === 'AGENTS.md')!.outcome,
    'updated',
  );
  const written = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  assert.ok(written.startsWith('# 我的项目规矩\n\n别碰 make。\n'), written);

  const second = runHubInit(root, { now: NOW });
  assert.deepEqual(
    second.changes.map((change) => [change.file, change.outcome]),
    [
      ['.hub/AGENTS.md', 'kept'],
      ['.hub/PROJECT_NOTES.md', 'kept'],
      // the snapshot re-derives from the tree, and the first run just added two root files to it
      ['.hub/STRUCTURE.json', 'updated'],
      ['AGENTS.md', 'unchanged'],
      ['CLAUDE.md', 'unchanged'],
    ],
  );
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), written, 'pointer files are idempotent down to the byte');
  assert.equal((written.match(/<!-- hub-pointer:start/g) ?? []).length, 1);
  const refreshed = JSON.parse(readFileSync(join(root, '.hub', 'STRUCTURE.json'), 'utf8')) as { entries: Array<{ path: string }> };
  assert.ok(refreshed.entries.some((entry) => entry.path === 'AGENTS.md'), 'the snapshot sees what /hub-init just created');

  const third = runHubInit(root, { now: NOW });
  assert.deepEqual(third.changes.map((change) => change.outcome), ['kept', 'kept', 'unchanged', 'unchanged', 'unchanged'], 'with a stable tree a rerun writes nothing');
});

test('--remove leaves zero residue, and refuses to delete anything it did not write', () => {
  const root = project({ 'AGENTS.md': '# 我的项目规矩\n\n别碰 make。\n' });
  runHubInit(root, { now: NOW });
  writeFileSync(join(root, '.hub', 'AGENTS.md'), '# 我改过规则本体了\n', 'utf8');

  const removed = runHubInit(root, { remove: true, now: NOW });
  assert.deepEqual(
    removed.changes.map((change) => [change.file, change.outcome]),
    [
      ['AGENTS.md', 'updated'],
      ['CLAUDE.md', 'removed'],
      ['.hub/STRUCTURE.json', 'removed'],
      ['.hub/AGENTS.md', 'kept'],
      ['.hub/PROJECT_NOTES.md', 'removed'],
    ],
  );
  assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), '# 我的项目规矩\n\n别碰 make。\n');
  assert.equal(existsSync(join(root, 'CLAUDE.md')), false, 'a file that held nothing but our block goes away');
  assert.equal(readFileSync(join(root, '.hub', 'AGENTS.md'), 'utf8'), '# 我改过规则本体了\n', 'user content is never deleted by an uninstall');
  assert.equal(existsSync(join(root, '.hub', 'PROJECT_NOTES.md')), false);
});

test('dry-run reports the same plan without writing a single file', () => {
  const root = project();
  const preview = runHubInit(root, { dryRun: true, now: NOW });
  assert.equal(preview.changes.length, 5);
  assert.ok(preview.changes.every((change) => change.detail.includes('dry-run')), preview.changes.map((c) => c.detail).join(' | '));
  assert.equal(existsSync(join(root, '.hub')), false);
  assert.equal(existsSync(join(root, 'AGENTS.md')), false);

  const removing = runHubInit(root, { remove: true, dryRun: true, now: NOW });
  assert.equal(removing.changes.length, 0, 'nothing was ever installed, so there is nothing to report');
});

test('--only narrows the pointer set, and the command handles bad input by name', () => {
  const root = project();
  const scoped = runHubInit(root, { only: ['claude-code', 'trae'], now: NOW });
  assert.deepEqual(scoped.changes.filter((change) => change.file === 'AGENTS.md').length, 0);
  assert.ok(existsSync(join(root, 'CLAUDE.md')));
  assert.equal(existsSync(join(root, 'AGENTS.md')), false);

  const command = mount();
  const target = project();
  const unknown = command('hub-init', `--only nosuchtool ${target}`);
  assert.equal(unknown.kind, 'error');
  assert.ok(unknown.text.includes('nosuchtool'), unknown.text);
  assert.ok(unknown.text.includes('codex'), 'the refusal lists what is available');

  const missing = command('hub-init', join(target, 'no-such-directory'));
  assert.equal(missing.kind, 'error');
  assert.ok(missing.text.includes('目录不存在'), missing.text);

  const ok = command('hub-init', `${target} --only claude-code,trae`);
  assert.equal(ok.kind, 'success', ok.text);
  assert.ok(ok.text.includes('＋ 新建 CLAUDE.md'), ok.text);
  assert.equal(existsSync(join(target, 'AGENTS.md')), false, 'a narrowed run does not create the shared AGENTS.md pointer');
  assert.ok(ok.text.includes('trae'), 'the manual handoffs are still reported');
  assert.ok(ok.text.includes('/forge'), 'the next step names the plugin that carries a task book across windows');

  const dry = command('hub-init', `${target} --dry-run --remove`);
  assert.ok(dry.text.startsWith('[dry-run] 卸载'), dry.text);
  assert.ok(existsSync(join(target, 'CLAUDE.md')), 'dry-run uninstall wrote nothing');
});

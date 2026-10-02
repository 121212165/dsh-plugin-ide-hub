/** M5: the pointer generator — one project-level source of truth (.hub/AGENTS.md)
 * plus a marker-delimited block dropped into each tool's project rule file.
 *
 * Everything here is pure: it takes the existing file contents in and hands the
 * bytes to write back out, so idempotency, "never clobber the user", and the
 * zero-residue uninstall are testable without touching a disk. Where a tool's
 * project-level rule path has not been verified on this machine, it is reported
 * as a manual step instead of guessing at a file to create.
 */

export const POINTER_BEGIN = '<!-- hub-pointer:start dsh-plugin-ide-hub v1 -->';
export const POINTER_END = '<!-- hub-pointer:end dsh-plugin-ide-hub v1 -->';

export type PointerMode = 'block' | 'manual';

export interface PointerSpec {
  tool: string;
  /** path inside the project, relative to its root; empty for a manual handoff */
  path: string;
  mode: PointerMode;
  /** why this is the right attach point, said out loud in the command output */
  note: string;
}

/** AGENTS.md at the project root is the shared convention the CLI agents in this
 * family all read, so one file covers five tools. The IDE-specific rule paths of
 * Trae / Qoder / CatPaw were never verified here, so they stay manual. */
export const POINTER_SPECS: readonly PointerSpec[] = [
  { tool: 'codex', path: 'AGENTS.md', mode: 'block', note: 'codex 读项目根 AGENTS.md' },
  { tool: 'opencode', path: 'AGENTS.md', mode: 'block', note: 'opencode 读项目根 AGENTS.md' },
  { tool: 'zcode', path: 'AGENTS.md', mode: 'block', note: 'zcode 读项目根 AGENTS.md（其全局规则在 ~/.zcode/cli/AGENTS.md，本处只挂项目级）' },
  { tool: 'dsh', path: 'AGENTS.md', mode: 'block', note: 'dsh 读项目根 AGENTS.md' },
  { tool: 'claude-code', path: 'CLAUDE.md', mode: 'block', note: 'Claude Code 读项目根 CLAUDE.md' },
  { tool: 'trae', path: '', mode: 'manual', note: 'Trae 的项目级规则文件路径未在本机核实——请手工把 .hub/AGENTS.md 指进去' },
  { tool: 'qoder', path: '', mode: 'manual', note: 'Qoder 的项目级规则文件路径未在本机核实——请手工把 .hub/AGENTS.md 指进去' },
  { tool: 'catpaw', path: '', mode: 'manual', note: 'CatPaw 的项目级规则文件路径未在本机核实——请手工把 .hub/AGENTS.md 指进去' },
];

/** The rule body every pointer refers to. Relative paths keep it portable. */
export const HUB_BODY = '.hub/AGENTS.md';
export const HUB_FILES = [HUB_BODY, '.hub/STRUCTURE.json', '.hub/PROJECT_NOTES.md'] as const;

export function pointerBlock(hubFile = HUB_BODY): string {
  return [
    POINTER_BEGIN,
    `本段由 ide-hub 的 \`/hub-init\` 生成，指向本项目的规则本体 \`${hubFile}\`。`,
    `开始任何工作前先读 \`${hubFile}\`（以及同目录的 PROJECT_NOTES.md / STRUCTURE.json），按其中的约定写、按约定的禁忌不写。`,
    `卸载：运行 \`/hub-init --remove\`，或手工删掉本段（从 hub-pointer:start 到 end 的这一整块）与 \`.hub/\` 目录——除这一段外没有别的东西属于 ide-hub。`,
    POINTER_END,
  ].join('\n');
}

export function hasPointer(content: string): boolean {
  return content.includes(POINTER_BEGIN) && content.includes(POINTER_END);
}

/** Everything outside the managed block, with the blank line the block was
 * separated by taken back too — so an uninstall leaves no trailing scar. */
export function stripPointer(content: string): string {
  const begin = content.indexOf(POINTER_BEGIN);
  const end = content.indexOf(POINTER_END);
  if (begin === -1 || end === -1 || end < begin) return content;
  const head = content.slice(0, begin).replace(/\s+$/, '');
  const tail = content.slice(end + POINTER_END.length).replace(/^\s*\n+/, '');
  if (!head && !tail.trim()) return '';
  if (!head) return tail.trimStart();
  return tail ? `${head}\n\n${tail.replace(/\s+$/, '')}\n` : `${head}\n`;
}

export type MergeAction = 'noop' | 'rewrite' | 'append' | 'create';

export interface MergeResult {
  action: MergeAction;
  content: string;
}

/** Idempotent attach: never duplicate the block, never drop the user's own text.
 * `existing === null` means the file does not exist yet. */
export function mergePointer(existing: string | null, block = pointerBlock()): MergeResult {
  if (existing === null) return { action: 'create', content: `${block}\n` };
  if (hasPointer(existing)) {
    const stripped = stripPointer(existing);
    const body = stripped.trim() === '' ? '' : `${stripped.replace(/\s+$/, '')}\n\n`;
    const content = `${body}${block}\n`;
    return { action: content === existing ? 'noop' : 'rewrite', content };
  }
  if (existing.trim() === '') return { action: 'rewrite', content: `${block}\n` };
  return { action: 'append', content: `${existing.replace(/\s+$/, '')}\n\n${block}\n` };
}

/** Remove our block; a file that had nothing else in it should be deleted. */
export function unmergePointer(existing: string): { content: string; deleteFile: boolean } {
  const left = stripPointer(existing);
  return { content: left, deleteFile: left.trim() === '' };
}

export interface PointerTarget {
  path: string;
  tools: string[];
  notes: string[];
}

/** Group specs by file so five tools sharing AGENTS.md produce one write. */
export function pointerTargets(tools: string[] = POINTER_SPECS.map((spec) => spec.tool)): { block: PointerTarget[]; manual: PointerSpec[] } {
  const wanted = new Set(tools);
  const byPath = new Map<string, PointerTarget>();
  const manual: PointerSpec[] = [];
  for (const spec of POINTER_SPECS) {
    if (!wanted.has(spec.tool)) continue;
    if (spec.mode === 'manual') {
      manual.push(spec);
      continue;
    }
    const target = byPath.get(spec.path) ?? { path: spec.path, tools: [], notes: [] };
    if (!target.tools.includes(spec.tool)) target.tools.push(spec.tool);
    if (!target.notes.includes(spec.note)) target.notes.push(spec.note);
    byPath.set(spec.path, target);
  }
  return { block: [...byPath.values()], manual };
}

export interface TreeEntry {
  path: string;
  kind: 'dir' | 'file';
  size?: number;
}

/** The generated STRUCTURE.json — a snapshot a reader can trust about staleness. */
export function renderStructureJson(project: string, entries: TreeEntry[], now = new Date()): string {
  const payload = {
    v: 1,
    project,
    generatedAt: now.toISOString(),
    generator: 'dsh-plugin-ide-hub /hub-init',
    counts: {
      dirs: entries.filter((entry) => entry.kind === 'dir').length,
      files: entries.filter((entry) => entry.kind === 'file').length,
      bytes: entries.reduce((total, entry) => total + (entry.size ?? 0), 0),
    },
    entries,
  };
  return JSON.stringify(payload, null, 2) + '\n';
}

/** The rule body. Created once and then never overwritten: it is the user's file. */
export function renderHubAgents(project: string): string {
  return [
    `# ${project} — 项目规则本体（.hub/AGENTS.md）`,
    '',
    '本文件是各 AI 工具共用的唯一规则本体。工具自己的规则文件（AGENTS.md / CLAUDE.md …）',
    '只放一段指向这里的指针，**不要**在那些文件里写正文——那样多工具之间必然漂移。',
    '',
    '## 一句话目标',
    '',
    '<待补充：这个项目要变成什么样>',
    '',
    '## 常用命令',
    '',
    '```sh',
    '<待补充：构建 / 测试 / 启动>',
    '```',
    '',
    '## 约定',
    '',
    '- <待补充：命名、目录、提交规范>',
    '',
    '## 禁忌（明确不要做的事）',
    '',
    '- <待补充>',
    '',
    '## 指针清单',
    '',
    '下面这些文件里各有本插件写入的一段指针（有 `hub-pointer` 标记）：',
    '',
    '- `AGENTS.md`（codex / opencode / zcode / dsh 共用）',
    '- `CLAUDE.md`（Claude Code）',
    '',
    '卸载：`/hub-init --remove` 会精确删掉这些段与 `.hub/` 目录，用户在同一个文件里自己写的内容原样保留。',
    '',
  ].join('\n');
}

/** The working-notes file: a checklist, not a document nobody fills in. */
export function renderProjectNotes(project: string): string {
  return [
    `# ${project} — 项目备忘（PROJECT_NOTES.md）`,
    '',
    '规则本体见 AGENTS.md 段落的指针目标 `.hub/AGENTS.md`；结构快照见 `STRUCTURE.json`（由 `/hub-init` 重新生成，手改会被覆盖）。',
    '',
    '- [ ] 填一句话目标',
    '- [ ] 填常用命令（构建 / 测试 / 启动）',
    '- [ ] 写清禁忌，尤其是"看着合理但会出事"的那种',
    '- [ ] 需要跨窗口无损交接时：装 dsh-plugin-task-forge，`/forge <需求> --to ide:<工具名>`',
    '',
  ].join('\n');
}

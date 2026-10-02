/**
 * dsh wiring for ide-hub: one command surface over the four modules.
 * /ide-hub inventories every IDE; /hub-migrate plans quota migration from
 * user-declared numbers; /hub-export pushes the whole picture into Obsidian.
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type {} from '@deepseek-ai/dsh-commands';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { defaultRegistry, type IdeSpec } from './hub/registry.ts';
import { inventory, expandPath, type IdeInventory } from './hub/inventory.ts';
import {
  HUB_BODY,
  POINTER_SPECS,
  mergePointer,
  pointerBlock,
  pointerTargets,
  renderHubAgents,
  renderProjectNotes,
  renderStructureJson,
  unmergePointer,
  type TreeEntry,
} from './hub/pointers.ts';
import { planMigration, renderPlan, type QuotaState } from './hub/migrate.ts';
import { prioritiseToday, renderToday, type TodaySignals } from './hub/today.ts';
import { readBudget, readSpend, readTasks, readTools } from './hub/today-readers.ts';
import { discoverRules, renderInventoryNote, renderMigrationNote, renderRulesNotes, writeNotes, type RuleFileInfo } from './hub/obsidian.ts';
import { scanClaudeCode, scanCodex, aggregate, renderUsage, recentSessions, type UsageRecord } from './hub/usage.ts';
import { readZcodeUsage, readZcodeSessions, readZcodeModels, zcodeStats, type ZcodeUsageRecord } from './hub/zcode-db.ts';
import { scanTrae, traeChatSessions } from './hub/trae-db.ts';

export const name = 'ide-hub';
export const inject = ['commands'];

export interface QuotaConfig {
  tool: string;
  remainingMajor: number;
  dailyMajor: number;
  priority: 'work' | 'batch' | 'learning';
}

/** Where each /today signal lives when the host does not override it. */
export const TODAY_DEFAULTS = {
  quotaSummaryPath: '~/.dsh/quota/summary.json',
  costLedgerDir: '~/.dsh/cost-ledger',
  taskForgeLedger: '~/.dsh/task-forge/ledger.jsonl',
  toolTraceDir: '~/.dsh/tool-trace',
  todayWindowDays: 3,
} as const;

export interface Config {
  enabled: boolean;
  vaultDir?: string;
  quotas: QuotaConfig[];
  quotaSummaryPath?: string;
  costLedgerDir?: string;
  taskForgeLedger?: string;
  toolTraceDir?: string;
  todayWindowDays?: number;
}

export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  vaultDir: Schema.string(),
  quotas: Schema.array(
    Schema.object({
      tool: Schema.string().required(),
      remainingMajor: Schema.number().required(),
      dailyMajor: Schema.number().default(0),
      priority: Schema.union([Schema.const('work'), Schema.const('batch'), Schema.const('learning')]).default('work'),
    }),
  ).default([]),
  quotaSummaryPath: Schema.string().default(TODAY_DEFAULTS.quotaSummaryPath),
  costLedgerDir: Schema.string().default(TODAY_DEFAULTS.costLedgerDir),
  taskForgeLedger: Schema.string().default(TODAY_DEFAULTS.taskForgeLedger),
  toolTraceDir: Schema.string().default(TODAY_DEFAULTS.toolTraceDir),
  todayWindowDays: Schema.natural().default(TODAY_DEFAULTS.todayWindowDays),
});

function humanBytes(bytes: number): string {
  if (bytes > 1 << 30) return `${(bytes / (1 << 30)).toFixed(1)} GB`;
  if (bytes > 1 << 20) return `${(bytes / (1 << 20)).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function renderInventory(inventories: IdeInventory[]): string {
  const lines = inventories.map((item) => {
    if (!item.present) return `  ${item.tool.padEnd(14)} （未安装）`;
    return `  ${item.tool.padEnd(14)} ${String(item.sessions).padStart(4)} 会话证据 · ${humanBytes(item.bytes).padStart(8)} · 最近活跃 ${item.lastActive ? item.lastActive.slice(0, 16).replace('T', ' ') : '—'}`;
  });
  const domestic = inventories.filter((item) => item.vendor === 'domestic' && item.present).length;
  return [`IDE 数据盘点（${inventories.filter((item) => item.present).length}/${inventories.length} 在装，其中国产 ${domestic}）:`, ...lines].join('\n');
}

/** Directories a structure snapshot should never walk into. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'target', '__pycache__', '.venv', 'venv']);

export interface TreeScan {
  entries: TreeEntry[];
  truncated: boolean;
}

/** Shallow, bounded, hidden-free: enough for an agent to know where things live,
 * cheap enough to regenerate every time, and it never follows a symlink tree. */
export function scanTree(root: string, limit = 300, depth = 2): TreeScan {
  const entries: TreeEntry[] = [];
  let truncated = false;
  const walk = (dir: string, level: number): void => {
    if (truncated || level > depth) return;
    let names: string[];
    try {
      names = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith('.') && !SKIP_DIRS.has(entry.name))
        .map((entry) => entry.name)
        .sort();
    } catch {
      return;
    }
    for (const name of names) {
      if (entries.length >= limit) {
        truncated = true;
        return;
      }
      const full = join(dir, name);
      const rel = relative(root, full).replace(/\\/g, '/');
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        entries.push({ path: `${rel}/`, kind: 'dir' });
        walk(full, level + 1);
      } else if (stat.isFile()) {
        entries.push({ path: rel, kind: 'file', size: stat.size });
      }
    }
  };
  walk(root, 1);
  return { entries, truncated };
}

function readIf(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

export type FileOutcome = 'created' | 'updated' | 'unchanged' | 'removed' | 'kept';

function mkdirOf(file: string): void {
  mkdirSync(file.replace(/[^\\/]*$/, ''), { recursive: true });
}

/** Uninstall must not leave a skeleton: an empty directory on the way to a pointer
 * file goes too — but only while it is empty, and never at or above the project root. */
function pruneEmptyDirs(file: string, stopAt: string): void {
  let dir = dirname(file);
  while (dir.length > stopAt.length && !relative(stopAt, dir).startsWith('..')) {
    let entries: string[];
    try {
      if (!existsSync(dir)) return;
      entries = readdirSync(dir);
    } catch {
      return;
    }
    if (entries.length) return;
    try {
      rmdirSync(dir);
    } catch {
      return;
    }
    dir = dirname(dir);
  }
}

/** Content-compare write: a rerun that changes nothing must not touch the file. */
function writeIfChanged(file: string, content: string): FileOutcome {
  const existing = readIf(file);
  if (existing === null) {
    mkdirOf(file);
    writeFileSync(file, content, 'utf8');
    return 'created';
  }
  if (existing === content) return 'unchanged';
  writeFileSync(file, content, 'utf8');
  return 'updated';
}

export interface HubInitOptions {
  remove?: boolean;
  dryRun?: boolean;
  /** restrict to a subset of the adapter table */
  only?: string[];
  now?: Date;
}

export interface InitChange {
  file: string;
  outcome: FileOutcome;
  detail: string;
}

export interface HubInitResult {
  project: string;
  root: string;
  changes: InitChange[];
  manual: { tool: string; note: string }[];
  truncated: boolean;
}

/** Install (or remove) the .hub/ source of truth and the pointer blocks in each
 * tool's project rule file. Nothing here reaches outside `root`.
 *
 * Uninstall deletes only what it can prove is still ours: a pointer block is
 * lifted out of a rule file leaving the user's own text intact, and `.hub` files
 * are removed only while they still match the generated template byte for byte. */
export function runHubInit(root: string, options: HubInitOptions = {}): HubInitResult {
  const now = options.now ?? new Date();
  const project = basename(root);
  const tools = options.only?.length ? options.only : POINTER_SPECS.map((spec) => spec.tool);
  const { block: targets, manual } = pointerTargets(tools);
  const changes: InitChange[] = [];
  const rel = (file: string): string => relative(root, file).replace(/\\/g, '/');

  if (options.remove) {
    for (const target of targets) {
      const file = join(root, target.path);
      const existing = readIf(file);
      if (existing === null) continue;
      const { content, deleteFile } = unmergePointer(existing);
      if (content === existing) {
        changes.push({ file: target.path, outcome: 'unchanged', detail: '没有本插件的指针段' });
        continue;
      }
      if (options.dryRun) {
        changes.push({ file: target.path, outcome: deleteFile ? 'removed' : 'updated', detail: deleteFile ? '将删除（除指针段外没有内容）' : '将只摘掉指针段' });
        continue;
      }
      if (deleteFile) {
        rmSync(file, { force: true });
        pruneEmptyDirs(file, root);
        changes.push({ file: target.path, outcome: 'removed', detail: '除指针段外没有内容，已删除' });
      } else {
        writeFileSync(file, content, 'utf8');
        changes.push({ file: target.path, outcome: 'updated', detail: '已摘掉指针段，其余内容原样保留' });
      }
    }
    const structure = join(root, '.hub', 'STRUCTURE.json');
    if (readIf(structure) !== null) {
      if (!options.dryRun) rmSync(structure, { force: true });
      changes.push({ file: '.hub/STRUCTURE.json', outcome: 'removed', detail: '生成物，直接删' });
    }
    for (const [file, template] of [
      [join(root, HUB_BODY), renderHubAgents(project)],
      [join(root, '.hub', 'PROJECT_NOTES.md'), renderProjectNotes(project)],
    ] as const) {
      const existing = readIf(file);
      const path = rel(file);
      if (existing === null) continue;
      if (existing === template) {
        if (!options.dryRun) rmSync(file, { force: true });
        changes.push({ file: path, outcome: 'removed', detail: '仍是未改动的模板，已删除' });
      } else {
        changes.push({ file: path, outcome: 'kept', detail: '里面有你自己写的内容，没删——确认后手工删除' });
      }
    }
    const hubDir = join(root, '.hub');
    if (!options.dryRun && existsSync(hubDir) && readdirSync(hubDir).length === 0) rmSync(hubDir, { recursive: true, force: true });
    return { project, root, changes, manual: [], truncated: false };
  }

  const write = (absolute: string, display: string, content: string, detail: string): InitChange => {
    if (options.dryRun) {
      return { file: display, outcome: readIf(absolute) === null ? 'created' : 'updated', detail: `${detail}（dry-run，未写盘）` };
    }
    return { file: display, outcome: writeIfChanged(absolute, content), detail };
  };

  const bodyPath = join(root, HUB_BODY);
  if (readIf(bodyPath) !== null) {
    changes.push({ file: rel(bodyPath), outcome: 'kept', detail: '规则本体已存在，里面是项目自己的内容，未覆盖' });
  } else {
    changes.push(write(bodyPath, rel(bodyPath), renderHubAgents(project), '按模板新建，去填目标/命令/禁忌'));
  }

  const notesPath = join(root, '.hub', 'PROJECT_NOTES.md');
  if (readIf(notesPath) !== null) {
    changes.push({ file: rel(notesPath), outcome: 'kept', detail: '备忘已存在，未覆盖' });
  } else {
    changes.push(write(notesPath, rel(notesPath), renderProjectNotes(project), '按模板新建'));
  }

  const scan = scanTree(root);
  const structurePath = join(root, '.hub', 'STRUCTURE.json');
  changes.push(write(structurePath, rel(structurePath), renderStructureJson(project, scan.entries, now), `结构快照 ${scan.entries.length} 个条目（深度 2，跳过 .git 与 node_modules 等）`));

  const block = pointerBlock();
  for (const target of targets) {
    const file = join(root, target.path);
    const merged = mergePointer(readIf(file), block);
    if (merged.action === 'noop') {
      changes.push({ file: target.path, outcome: 'unchanged', detail: `指针段已在（${target.tools.join('/')}）` });
      continue;
    }
    const how = merged.action === 'create' ? '新建' : merged.action === 'append' ? '在已有内容后追加' : '重写';
    changes.push(write(file, target.path, merged.content, `${how}指针段 → ${target.tools.join('/')}（${target.notes[0] ?? '路径未核实'}）`));
  }
  return { project, root, changes, manual: manual.map((spec) => ({ tool: spec.tool, note: spec.note })), truncated: scan.truncated };
}


const OUTCOME_MARK: Record<FileOutcome, string> = {
  created: '＋ 新建',
  updated: '～ 改写',
  unchanged: '· 未变',
  removed: '－ 删除',
  kept: '= 保留',
};

export function apply(ctx: Context, config: Config): void {
  const log = ctx.logger('ide-hub');
  if (!config.enabled) return void log.info('disabled by config');
  const registry: IdeSpec[] = defaultRegistry();
  const windowDays = config.todayWindowDays && config.todayWindowDays > 0 ? config.todayWindowDays : TODAY_DEFAULTS.todayWindowDays;
  const paths = {
    quota: config.quotaSummaryPath || TODAY_DEFAULTS.quotaSummaryPath,
    ledger: config.costLedgerDir || TODAY_DEFAULTS.costLedgerDir,
    tasks: config.taskForgeLedger || TODAY_DEFAULTS.taskForgeLedger,
    trace: config.toolTraceDir || TODAY_DEFAULTS.toolTraceDir,
  };

  ctx.commands.register({
    name: 'ide-hub',
    description: '跨 IDE 数据盘点：Trae/Qoder/ZCode/CatPaw/Codex/Claude Code/OpenCode/dsh 的会话与规则文件',
    handler: () => {
      const inventories = registry.map(inventory);
      const rules: RuleFileInfo[] = discoverRules(registry);
      const lines = [renderInventory(inventories), '', `提示词规则文件 ${rules.length} 份:`, ...rules.map((rule) => `  [${rule.tool}] ${rule.path}`)];
      return { kind: 'success', text: lines.join('\n') };
    },
  });

  ctx.commands.register({
    name: 'hub-init',
    description: '给项目装 .hub/ 规则本体并给各 IDE 的项目级规则文件挂指针：/hub-init [目录] [--dry-run] [--only codex,claude-code] [--remove]',
    input: { hint: '[目录] [--dry-run] [--only 工具,…] [--remove]' },
    handler: ({ rawInput }) => {
      const raw = String(rawInput ?? '').trim();
      const remove = /(^|\s)--remove(\s|$)/.test(raw);
      const dryRun = /(^|\s)--dry-run(\s|$)/.test(raw);
      const onlyMatch = /(?:^|\s)--only[\s=]+(\S+)/.exec(raw);
      const known = POINTER_SPECS.map((spec) => spec.tool);
      const only = onlyMatch?.[1] ? onlyMatch[1].split(',').map((tool) => tool.trim().toLowerCase()).filter(Boolean) : undefined;
      if (only) {
        const unknown = only.filter((tool) => !known.includes(tool));
        if (unknown.length) return { kind: 'error', text: `不认识的工具：${unknown.join(', ')}。可选：${known.join(' / ')}。` };
      }
      const withoutFlags = raw.replace(/--remove|--dry-run/g, '').replace(/--only[\s=]+\S+/g, '').trim();
      const dirArg = withoutFlags.split(/\s+/)[0] ?? '';
      const root = resolve(expandPath(dirArg || process.cwd()));
      if (!existsSync(root) || !statSync(root).isDirectory()) {
        return { kind: 'error', text: `目录不存在或不是目录：${root}。用法：/hub-init [项目目录]，不给目录就用当前工作目录。` };
      }
      const result = runHubInit(root, { remove, dryRun, only });
      const lines = [`${dryRun ? '[dry-run] ' : ''}${remove ? '卸载' : '安装'} ${result.project} · ${root}`];
      for (const change of result.changes) lines.push(`  ${OUTCOME_MARK[change.outcome]} ${change.file} — ${change.detail}`);
      if (!result.changes.length) lines.push('  （没有任何本插件写过的东西）');
      if (!remove && result.manual.length) {
        lines.push('', '这几家的项目级规则路径本机未核实，指针没有替你写（写错文件比不写更糟）：', ...result.manual.map((item) => `  · ${item.tool}：${item.note}`));
      }
      if (result.truncated) lines.push('', '⚠ 结构快照到达条目上限被截断。');
      if (!remove) lines.push('', `下一步：填 ${HUB_BODY}（目标/命令/约定/禁忌），跨窗口无损交接用 task-forge 的 /forge --to ide:<工具名>。`);
      return { kind: 'success', text: lines.join('\n') };
    },
  });

  ctx.commands.register({
    name: 'hub-migrate',
    description: '额度迁移计划：按 ide-hub.quotas 里登记的剩余额度/日耗算耗尽倒计时并给迁移建议',
    handler: () => {
      const states: QuotaState[] = config.quotas.map((quota) => ({ ...quota }));
      return { kind: 'success', text: renderPlan(planMigration(states)) };
    },
  });

  ctx.commands.register({
    name: 'hub-export',
    description: '把盘点/迁移计划/规则快照导出到 Obsidian 的 IDE-Hub/ 子树',
    handler: () => {
      if (!config.vaultDir) return { kind: 'error', text: '未配置 ide-hub.vaultDir。' };
      const vaultDir = expandPath(config.vaultDir);
      const updated = new Date().toISOString();
      const inventories = registry.map(inventory);
      const rules: RuleFileInfo[] = discoverRules(registry);
      const notes = [
        renderInventoryNote(renderInventory(inventories).split('\n'), updated),
        renderMigrationNote(renderPlan(planMigration(config.quotas as QuotaState[])).split('\n'), updated),
        ...renderRulesNotes(rules, updated),
      ];
      const result = writeNotes(vaultDir, notes);
      return { kind: 'success', text: `导出完成：${result.written.length} 写入 / ${result.skipped} 未变。\n${result.written.map((file) => `  ${file}`).join('\n')}` };
    },
  });

  ctx.commands.register({
    name: 'hub-usage',
    description: '各 IDE 真实用量（读本地转录，ccusage/splitrail 的跨工具版，含国产 IDE 适配位）',
    handler: () => {
      const records: (UsageRecord | ZcodeUsageRecord)[] = [...scanClaudeCode(), ...scanCodex(), ...readZcodeUsage()];
      const claudeCodex = records.filter((r) => r.tool !== 'zcode') as UsageRecord[];
      const blocks = [renderUsage(aggregate(claudeCodex))];
      const zc = readZcodeUsage();
      if (zc.length) {
        const st = zcodeStats(zc);
        blocks.push(`zcode: ${st.totalTokens.toLocaleString()} tok（${st.turns} 轮 / 122+ 会话库）· 缓存命中 ${(st.cacheHitRate * 100).toFixed(1)}% · 非完成态 ${st.cancelled} 轮 · 工具错误 ${st.toolErrors}`);
        for (const model of readZcodeModels()) {
          blocks.push(`  └ ${model.provider}/${model.model}: ${model.calls} 次请求 · ${model.totalTokens.toLocaleString()} tok（输入 ${model.inputTokens.toLocaleString()} · 输出 ${model.outputTokens.toLocaleString()} · 缓存读 ${model.cacheReadTokens.toLocaleString()}）`);
        }
      }
      return { kind: 'success', text: blocks.join('\n\n') };
    },
  });

  ctx.commands.register({
    name: 'hub-sessions',
    description: '跨 IDE 最近会话 + 一键恢复命令（claude --resume / codex resume / dsh --resume …）',
    handler: () => {
      const records = [...scanClaudeCode(), ...scanCodex()];
      const sessions = [...recentSessions(records, 10), ...readZcodeSessions(undefined, 5)];
      const trae = traeChatSessions(scanTrae(), 5);
      const traeLines = trae.map((session) => `  [trae] ${(session.updatedAt || '').slice(0, 16).replace('T', ' ')} · ${session.title.slice(0, 30)}（${session.localMessages} 条本地消息${session.hasMore ? '，云上有更多' : ''}）— 无 CLI 恢复命令，需在 Trae 内打开项目 ${session.workspaceFolder ?? ''}`);
      if (!sessions.length) return { kind: 'error', text: '没有找到可恢复的会话。' };
      const lines = sessions.map((session) => {
        const cwd = session.cwd ? ` · ${session.cwd}` : '';
        const resume = session.resumeCommand ?? '（该工具无私有恢复命令）';
        return `  [${session.tool}] ${session.at.slice(0, 16).replace('T', ' ')}${cwd}\n    ↳ ${resume}`;
      });
      return { kind: 'success', text: `最近 ${sessions.length} 个会话:\n${lines.join('\n')}` };
    },
  });

  ctx.commands.register({
    name: 'today',
    description: '今天第一件事：把 quota 预算 / cost-ledger 花费 / task-forge 交接 / 工具健康 汇成一个排序结论（规则表见 src/hub/today.ts）',
    handler: () => {
      const now = new Date();
      const signals: TodaySignals = {
        now,
        budget: readBudget(expandPath(paths.quota)),
        spend: readSpend(expandPath(paths.ledger), now),
        tasks: readTasks(expandPath(paths.tasks)),
        tools: readTools(expandPath(paths.trace), now, windowDays),
      };
      return { kind: 'success', text: renderToday(prioritiseToday(signals), signals) };
    },
  });

  log.info(`mounted · ${registry.length} ide adapters · today sources wired`);
}

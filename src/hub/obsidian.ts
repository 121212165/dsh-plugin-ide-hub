import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { expandPath } from './inventory.ts';
import type { IdeSpec } from './registry.ts';

/** M3/M4: prompt-rules discovery and the Obsidian IDE-Hub/ export subtree.
 * Frontmatter + idempotent content-hash writes follow the obsidian-push family
 * pattern. Reads rule files only; never writes back into IDE dirs. */

export interface RuleFileInfo {
  tool: string;
  path: string;
  bytes: number;
  mtime: string;
}

export function discoverRules(specs: IdeSpec[]): RuleFileInfo[] {
  const found: RuleFileInfo[] = [];
  for (const spec of specs) {
    for (const raw of spec.promptFiles ?? []) {
      const path = expandPath(raw);
      if (!existsSync(path)) continue;
      try {
        const st = statSync(path);
        found.push({ tool: spec.tool, path, bytes: st.size, mtime: new Date(st.mtimeMs).toISOString() });
      } catch {
        // unreadable rule file: skip silently
      }
    }
  }
  return found;
}

export interface ObsidianNote {
  path: string;
  content: string;
}

function frontmatter(title: string, tags: string[], updated: string): string {
  return ['---', `title: "${title.replace(/"/g, '\\"')}"`, `updated: ${updated}`, 'tags:', ...tags.map((tag) => `  - ${tag}`), '---'].join('\n');
}

export function renderInventoryNote(lines: string[], updated: string): ObsidianNote {
  const content = `${frontmatter('IDE 会话清单', ['ide-hub', 'inventory'], updated)}\n\n# IDE 会话清单\n\n${lines.join('\n')}\n`;
  return { path: 'IDE-Hub/会话清单.md', content };
}

export function renderMigrationNote(lines: string[], updated: string): ObsidianNote {
  const content = `${frontmatter('额度迁移计划', ['ide-hub', 'quota'], updated)}\n\n# 额度迁移计划\n\n${lines.join('\n')}\n`;
  return { path: 'IDE-Hub/额度迁移计划.md', content };
}

export function renderRulesNotes(rules: RuleFileInfo[], updated: string): ObsidianNote[] {
  const index = `${frontmatter('提示词规则索引', ['ide-hub', 'prompts'], updated)}\n\n# 提示词规则索引\n\n${rules
    .map((rule) => `- [${rule.tool}] ${rule.path}（${rule.bytes} 字节，改于 ${rule.mtime.slice(0, 10)}）`)
    .join('\n')}\n`;
  const notes: ObsidianNote[] = [{ path: 'IDE-Hub/prompts/索引.md', content: index }];
  // A tool can register several rule files (e.g. claude-code's CLAUDE.md +
  // AGENTS.md); suffix the filename so they don't overwrite each other.
  const perTool = new Map<string, number>();
  for (const rule of rules) perTool.set(rule.tool, (perTool.get(rule.tool) ?? 0) + 1);
  for (const rule of rules) {
    let body = '';
    try {
      body = readFileSync(rule.path, 'utf8');
    } catch {
      body = '（读取失败）';
    }
    const stem = basename(rule.path).replace(/\.[^.]+$/, '');
    const name = (perTool.get(rule.tool) ?? 0) > 1 ? `${rule.tool}-${stem}` : rule.tool;
    notes.push({
      path: `IDE-Hub/prompts/${name}.md`,
      content: `${frontmatter(`${name} 规则快照`, ['ide-hub', 'prompts', rule.tool], updated)}\n\n# ${name} 规则快照\n\n来源: ${rule.path}\n\n${body}\n`,
    });
  }
  return notes;
}

/** Idempotent write: identical content skips, changed content overwrites. */
export function writeNotes(vaultDir: string, notes: ObsidianNote[]): { written: string[]; skipped: number } {
  const written: string[] = [];
  let skipped = 0;
  for (const note of notes) {
    const file = join(vaultDir, note.path);
    mkdirSync(join(vaultDir, note.path.split('/').slice(0, -1).join('/')), { recursive: true });
    if (existsSync(file) && readFileSync(file, 'utf8') === note.content) {
      skipped++;
      continue;
    }
    writeFileSync(file, note.content, 'utf8');
    written.push(note.path);
  }
  return { written, skipped };
}

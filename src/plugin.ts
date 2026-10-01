/**
 * dsh wiring for ide-hub: one command surface over the four modules.
 * /ide-hub inventories every IDE; /hub-migrate plans quota migration from
 * user-declared numbers; /hub-export pushes the whole picture into Obsidian.
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type {} from '@deepseek-ai/dsh-commands';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { defaultRegistry, type IdeSpec } from './hub/registry.ts';
import { inventory, expandPath, type IdeInventory } from './hub/inventory.ts';
import { planMigration, renderPlan, type QuotaState } from './hub/migrate.ts';
import { discoverRules, renderInventoryNote, renderMigrationNote, renderRulesNotes, writeNotes, type RuleFileInfo } from './hub/obsidian.ts';
import { scanClaudeCode, scanCodex, aggregate, renderUsage, recentSessions, type UsageRecord } from './hub/usage.ts';
import { readZcodeUsage, readZcodeSessions, zcodeStats, type ZcodeUsageRecord } from './hub/zcode-db.ts';

export const name = 'ide-hub';
export const inject = ['commands'];

export interface QuotaConfig {
  tool: string;
  remainingMajor: number;
  dailyMajor: number;
  priority: 'work' | 'batch' | 'learning';
}

export interface Config {
  enabled: boolean;
  vaultDir?: string;
  quotas: QuotaConfig[];
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

export function apply(ctx: Context, config: Config): void {
  const log = ctx.logger('ide-hub');
  if (!config.enabled) return void log.info('disabled by config');
  const registry: IdeSpec[] = defaultRegistry();

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
      if (!sessions.length) return { kind: 'error', text: '没有找到可恢复的会话。' };
      const lines = sessions.map((session) => {
        const cwd = session.cwd ? ` · ${session.cwd}` : '';
        const resume = session.resumeCommand ?? '（该工具无私有恢复命令）';
        return `  [${session.tool}] ${session.at.slice(0, 16).replace('T', ' ')}${cwd}\n    ↳ ${resume}`;
      });
      return { kind: 'success', text: `最近 ${sessions.length} 个会话:\n${lines.join('\n')}` };
    },
  });

  log.info(`mounted · ${registry.length} ide adapters`);
}

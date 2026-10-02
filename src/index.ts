export { name, Config, apply, inject, renderInventory, runHubInit, scanTree, type HubInitResult, type InitChange, type FileOutcome } from './plugin.ts';
export type { Config as IdeHubConfig, QuotaConfig } from './plugin.ts';
export { defaultRegistry, type IdeSpec } from './hub/registry.ts';
export { inventory, expandPath, type IdeInventory } from './hub/inventory.ts';
export { planMigration, renderPlan, type QuotaState, type MigrationPlan, type MigrationAdvice } from './hub/migrate.ts';
export { scanClaudeCode, scanCodex, aggregate, renderUsage, recentSessions } from './hub/usage.ts';
export { readZcodeUsage, readZcodeSessions, readZcodeModels, zcodeStats, zcodeDbPath, type ZcodeUsageRecord, type ZcodeSessionRef, type ZcodeModelUsage } from './hub/zcode-db.ts';
export { discoverRules, renderInventoryNote, renderMigrationNote, renderRulesNotes, writeNotes, type RuleFileInfo, type ObsidianNote } from './hub/obsidian.ts';
export {
  TODAY_RULES,
  foldTasks,
  foldTools,
  money,
  hoursSince,
  prioritiseToday,
  renderToday,
  type BudgetSignal,
  type SpendSignal,
  type TaskSignal,
  type TodayAction,
  type TodayPlan,
  type TodaySignals,
  type ToolSignal,
} from './hub/today.ts';
export { readBudget, readSpend, readTasks, readTools } from './hub/today-readers.ts';
export { TODAY_DEFAULTS } from './plugin.ts';
export { HUB_BODY, HUB_FILES, POINTER_SPECS, POINTER_BEGIN, POINTER_END, pointerBlock, pointerTargets, mergePointer, unmergePointer, hasPointer, stripPointer, renderHubAgents, renderProjectNotes, renderStructureJson, type PointerSpec, type PointerTarget, type MergeResult, type TreeEntry } from './hub/pointers.ts';

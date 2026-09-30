export { name, Config, apply, inject, renderInventory } from './plugin.ts';
export type { Config as IdeHubConfig, QuotaConfig } from './plugin.ts';
export { defaultRegistry, type IdeSpec } from './hub/registry.ts';
export { inventory, expandPath, type IdeInventory } from './hub/inventory.ts';
export { planMigration, renderPlan, type QuotaState, type MigrationPlan, type MigrationAdvice } from './hub/migrate.ts';
export { discoverRules, renderInventoryNote, renderMigrationNote, renderRulesNotes, writeNotes, type RuleFileInfo, type ObsidianNote } from './hub/obsidian.ts';

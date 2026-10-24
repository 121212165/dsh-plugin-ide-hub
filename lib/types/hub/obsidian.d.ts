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
export declare function discoverRules(specs: IdeSpec[]): RuleFileInfo[];
export interface ObsidianNote {
    path: string;
    content: string;
}
export declare function renderInventoryNote(lines: string[], updated: string): ObsidianNote;
export declare function renderMigrationNote(lines: string[], updated: string): ObsidianNote;
export declare function renderRulesNotes(rules: RuleFileInfo[], updated: string): ObsidianNote[];
/** Idempotent write: identical content skips, changed content overwrites. */
export declare function writeNotes(vaultDir: string, notes: ObsidianNote[]): {
    written: string[];
    skipped: number;
};
//# sourceMappingURL=obsidian.d.ts.map
/**
 * dsh wiring for ide-hub: one command surface over the four modules.
 * /ide-hub inventories every IDE; /hub-migrate plans quota migration from
 * user-declared numbers; /hub-export pushes the whole picture into Obsidian.
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { type IdeInventory } from './hub/inventory.ts';
import { type TreeEntry } from './hub/pointers.ts';
export declare const name = "ide-hub";
export declare const inject: string[];
export interface QuotaConfig {
    tool: string;
    remainingMajor: number;
    dailyMajor: number;
    priority: 'work' | 'batch' | 'learning';
}
/** Where each /today signal lives when the host does not override it. */
export declare const TODAY_DEFAULTS: {
    readonly quotaSummaryPath: '~/.dsh/quota/summary.json';
    readonly costLedgerDir: '~/.dsh/cost-ledger';
    readonly taskForgeLedger: '~/.dsh/task-forge/ledger.jsonl';
    readonly toolTraceDir: '~/.dsh/tool-trace';
    readonly sessionInsightsDir: '~/.dsh/session-insights';
    readonly forecastPath: '~/.dsh/spend-forecast/forecast.json';
    readonly todayWindowDays: 3;
};
export interface Config {
    enabled: boolean;
    vaultDir?: string;
    quotas: QuotaConfig[];
    quotaSummaryPath?: string;
    costLedgerDir?: string;
    taskForgeLedger?: string;
    toolTraceDir?: string;
    sessionInsightsDir?: string;
    forecastPath?: string;
    todayWindowDays?: number;
}
export declare const Config: Schema<Schemastery.ObjectS<{
    enabled: Schema<boolean, boolean>;
    vaultDir: Schema<string, string>;
    quotas: Schema<({
        tool?: string | null;
        remainingMajor?: number | null;
        dailyMajor?: number | null;
        priority?: "batch" | "learning" | "work" | null;
    } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<{
        tool: Schema<string, string>;
        remainingMajor: Schema<number, number>;
        dailyMajor: Schema<number, number>;
        priority: Schema<"batch" | "learning" | "work", "batch" | "learning" | "work">;
    }>[]>;
    quotaSummaryPath: Schema<string, string>;
    costLedgerDir: Schema<string, string>;
    taskForgeLedger: Schema<string, string>;
    toolTraceDir: Schema<string, string>;
    sessionInsightsDir: Schema<string, string>;
    forecastPath: Schema<string, string>;
    todayWindowDays: Schema<number, number>;
}>, Schemastery.ObjectT<{
    enabled: Schema<boolean, boolean>;
    vaultDir: Schema<string, string>;
    quotas: Schema<({
        tool?: string | null;
        remainingMajor?: number | null;
        dailyMajor?: number | null;
        priority?: "batch" | "learning" | "work" | null;
    } & import("@deepseek-ai/cosmokit").Dict)[], Schemastery.ObjectT<{
        tool: Schema<string, string>;
        remainingMajor: Schema<number, number>;
        dailyMajor: Schema<number, number>;
        priority: Schema<"batch" | "learning" | "work", "batch" | "learning" | "work">;
    }>[]>;
    quotaSummaryPath: Schema<string, string>;
    costLedgerDir: Schema<string, string>;
    taskForgeLedger: Schema<string, string>;
    toolTraceDir: Schema<string, string>;
    sessionInsightsDir: Schema<string, string>;
    forecastPath: Schema<string, string>;
    todayWindowDays: Schema<number, number>;
}>>;
export declare function renderInventory(inventories: IdeInventory[]): string;
export interface TreeScan {
    entries: TreeEntry[];
    truncated: boolean;
}
/** Shallow, bounded, hidden-free: enough for an agent to know where things live,
 * cheap enough to regenerate every time, and it never follows a symlink tree. */
export declare function scanTree(root: string, limit?: number, depth?: number): TreeScan;
export type FileOutcome = 'created' | 'updated' | 'unchanged' | 'removed' | 'kept';
export interface HubInitOptions {
    remove?: boolean;
    dryRun?: boolean;
    /** restrict to a subset of the adapter table */
    only?: string[] | undefined;
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
    manual: {
        tool: string;
        note: string;
    }[];
    truncated: boolean;
}
/** Install (or remove) the .hub/ source of truth and the pointer blocks in each
 * tool's project rule file. Nothing here reaches outside `root`.
 *
 * Uninstall deletes only what it can prove is still ours: a pointer block is
 * lifted out of a rule file leaving the user's own text intact, and `.hub` files
 * are removed only while they still match the generated template byte for byte. */
export declare function runHubInit(root: string, options?: HubInitOptions): HubInitResult;
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=plugin.d.ts.map
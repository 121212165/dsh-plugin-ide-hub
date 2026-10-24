/** M2: quota migration planner. Inputs are user-declared (quotas are not
 * machine-readable across IDEs); the planner's job is the arithmetic and the
 * ordering, never guessing numbers. */
export interface QuotaState {
    tool: string;
    remainingMajor: number;
    /** typical daily burn in the same units; 0 = idle */
    dailyMajor: number;
    priority: 'work' | 'batch' | 'learning';
}
export interface MigrationAdvice {
    tool: string;
    daysLeft: number | null;
    verdict: 'healthy' | 'tight' | 'exhausted' | 'idle';
    /** donate workload to these tools (thickest remaining, matching priority) */
    migrateTo: {
        tool: string;
        daysLeft: number | null;
    }[];
}
export interface MigrationPlan {
    advisories: MigrationAdvice[];
    /** suggested run-queue: what to run where tomorrow */
    queue: {
        tool: string;
        priority: QuotaState['priority'];
    }[];
}
export declare function planMigration(states: QuotaState[]): MigrationPlan;
export declare function renderPlan(plan: MigrationPlan): string;
//# sourceMappingURL=migrate.d.ts.map
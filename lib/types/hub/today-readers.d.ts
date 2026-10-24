/** Disk readers for `/today`. Each one mirrors another plugin's published
 * files (they are separate packages and cannot import each other), and every
 * failure mode — missing, half-written, unreadable — degrades to `null`, which
 * the rule table then reports as a blind spot instead of guessing.
 */
import { type BudgetSignal, type ForecastSignal, type SessionsSignal, type SpendSignal, type TaskSignal, type ToolSignal } from './today.ts';
/** quota's published budget contract (`~/.dsh/quota/summary.json`). */
export declare function readBudget(file: string): BudgetSignal | null;
/** cost-ledger's current-month sidecars. Rows are filtered by their own month as
 * well: a stray line in a month file must not inflate 本月已花. */
export declare function readSpend(dir: string, now: Date): SpendSignal | null;
/** task-forge's ledger.jsonl, folded into per-task state. */
export declare function readTasks(ledgerFile: string): TaskSignal[];
/** tool-trace sidecars within the window, folded into health signals. */
export declare function readTools(dir: string, now: Date, days: number): ToolSignal | null;
/** session-insights' monthly sidecars within the window, folded into volume. */
export declare function readSessions(dir: string, now: Date, days: number): SessionsSignal | null;
/** spend-forecast's published forecast.json — the burn-out signal. */
export declare function readForecast(file: string): ForecastSignal | null;
//# sourceMappingURL=today-readers.d.ts.map
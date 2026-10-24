/** M2: quota migration planner. Inputs are user-declared (quotas are not
 * machine-readable across IDEs); the planner's job is the arithmetic and the
 * ordering, never guessing numbers. */
export function planMigration(states) {
    const daysLeft = (state) => state.dailyMajor > 0 ? Math.floor(state.remainingMajor / state.dailyMajor) : state.remainingMajor > 0 ? null : 0;
    const verdictOf = (state) => {
        if (state.remainingMajor <= 0)
            return 'exhausted';
        const left = daysLeft(state);
        if (left === null)
            return 'idle';
        if (left <= 2)
            return 'exhausted';
        if (left <= 7)
            return 'tight';
        return 'healthy';
    };
    const advisories = states.map((state) => {
        const verdict = verdictOf(state);
        const migrateTo = verdict === 'exhausted' || verdict === 'tight'
            ? states
                .filter((other) => other.tool !== state.tool && other.remainingMajor > state.remainingMajor)
                .sort((a, b) => b.remainingMajor - a.remainingMajor)
                .slice(0, 2)
                .map((other) => ({ tool: other.tool, daysLeft: daysLeft(other) }))
            : [];
        return { tool: state.tool, daysLeft: daysLeft(state), verdict, migrateTo };
    });
    // tomorrow's run-queue: put work on healthy tools of matching priority, batch on idle/cheap
    const healthy = states
        .filter((state) => verdictOf(state) === 'healthy' || verdictOf(state) === 'idle')
        .sort((a, b) => b.remainingMajor - a.remainingMajor);
    const queue = [];
    for (const priority of ['work', 'batch', 'learning']) {
        const match = healthy.find((state) => state.priority === priority) ?? healthy[0];
        if (match)
            queue.push({ tool: match.tool, priority });
    }
    return { advisories, queue };
}
export function renderPlan(plan) {
    if (!plan.advisories.length)
        return '还没有登记任何额度状态。在 ide-hub.quotas 里录入（数字手填，插件不猜）。';
    const VERDICT = { healthy: '✅ 充裕', tight: '⚠ 紧张', exhausted: '❌ 耗尽', idle: '💤 闲置' };
    const lines = plan.advisories.map((advisory) => {
        const left = advisory.daysLeft === null ? '—' : `${advisory.daysLeft} 天`;
        const migrate = advisory.migrateTo.length ? ` → 迁移到 ${advisory.migrateTo.map((target) => `${target.tool}(${target.daysLeft === null ? '充裕' : target.daysLeft + '天'})`).join(', ')}` : '';
        return `  ${advisory.tool.padEnd(14)} ${VERDICT[advisory.verdict]} 剩 ${left}${migrate}`;
    });
    const queue = plan.queue.length ? `\n明日跑位建议:\n${plan.queue.map((entry) => `  ${entry.priority} → ${entry.tool}`).join('\n')}` : '';
    return lines.join('\n') + queue;
}
//# sourceMappingURL=migrate.js.map
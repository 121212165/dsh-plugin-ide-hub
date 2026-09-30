import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planMigration, renderPlan, type MigrationPlan, type QuotaState } from '../src/hub/migrate.ts';

const state = (over: Partial<QuotaState>): QuotaState => ({ tool: 'x', remainingMajor: 10, dailyMajor: 1, priority: 'work', ...over });

test('days-left is floored from remaining/daily', () => {
  const plan = planMigration([state({ remainingMajor: 10, dailyMajor: 3 })]);
  assert.equal(plan.advisories[0]!.daysLeft, 3);
});

test('exhausted tools get migration targets with the thickest remaining', () => {
  const plan = planMigration([
    state({ tool: 'trae', remainingMajor: 0, dailyMajor: 1 }),
    state({ tool: 'zcode', remainingMajor: 50, dailyMajor: 2, priority: 'work' }),
    state({ tool: 'codex', remainingMajor: 30, dailyMajor: 0, priority: 'batch' }),
  ]);
  const trae = plan.advisories.find((advisory) => advisory.tool === 'trae')!;
  assert.equal(trae.verdict, 'exhausted');
  assert.equal(trae.migrateTo[0]!.tool, 'zcode');
  assert.equal(trae.migrateTo[1]!.tool, 'codex');
});

test('idle tools (no burn) are idle, healthy tools are not asked to migrate', () => {
  const plan = planMigration([state({ tool: 'zcode', remainingMajor: 100, dailyMajor: 0 })]);
  assert.equal(plan.advisories[0]!.verdict, 'idle');
  assert.equal(plan.advisories[0]!.migrateTo.length, 0);
});

test('run-queue assigns each priority a healthy tool', () => {
  const plan = planMigration([
    state({ tool: 'zcode', remainingMajor: 100, dailyMajor: 2, priority: 'work' }),
    state({ tool: 'codex', remainingMajor: 80, dailyMajor: 1, priority: 'batch' }),
  ]);
  assert.equal(plan.queue.length, 3);
  assert.equal(plan.queue.find((entry) => entry.priority === 'work')!.tool, 'zcode');
});

test('rendering shows verdicts and the queue', () => {
  const text = renderPlan(planMigration([state({ tool: 'trae', remainingMajor: 0, dailyMajor: 1 }), state({ tool: 'zcode', remainingMajor: 50, dailyMajor: 2 })]));
  assert.ok(text.includes('❌ 耗尽'));
  assert.ok(text.includes('迁移到 zcode'));
  assert.ok(text.includes('明日跑位建议'));
  assert.ok(renderPlan({ advisories: [], queue: [] } as MigrationPlan).includes('还没有登记'));
});

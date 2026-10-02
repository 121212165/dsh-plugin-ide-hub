/** The /today rule table: what the four signals fold into, which action wins,
 * and what the command says when a source is missing.
 * @module test/today */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { foldTasks, foldTools, money, prioritiseToday, renderToday, TODAY_RULES, type TodaySignals } from '../src/hub/today.ts';
import { readBudget, readSpend, readTasks, readTools } from '../src/hub/today-readers.ts';
import { apply } from '../src/plugin.ts';

const NOW = new Date('2026-10-02T12:00:00.000Z');

function signals(over: Partial<TodaySignals> = {}): TodaySignals {
  return {
    now: NOW,
    budget: null,
    spend: null,
    tasks: [],
    tools: null,
    ...over,
  };
}

const traceLine = (tool: string, isError: boolean, hours: number): { at: string; tool: string; isError: boolean } => ({
  at: new Date(NOW.getTime() - hours * 3_600_000).toISOString(),
  tool,
  isError,
});

test('foldTasks keeps the newest state per task, including gaps and holders', () => {
  const tasks = foldTasks([
    { ts: '2026-10-01T09:00:00.000Z', task: '20261001-aaaa', event: 'created', version: 1, status: 'draft', title: '报价引擎' },
    { ts: '2026-10-01T10:00:00.000Z', task: '20261001-aaaa', event: 'relayed', version: 1, status: 'relayed', title: '报价引擎', target: '窗口A' },
    { ts: '2026-10-01T11:00:00.000Z', task: '20261001-aaaa', event: 'relayed', version: 1, status: 'relayed', target: '窗口B' },
    { ts: '2026-10-01T12:00:00.000Z', task: '20261001-aaaa', event: 'acked', version: 1, status: 'relayed', note: 'need-input · 缺口 2 条' },
    { ts: '2026-10-02T08:00:00.000Z', task: '20261002-bbbb', event: 'acked', version: 3, status: 'ready', title: '另一个', target: '握手通过' },
  ]);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0]!.id, '20261002-bbbb', 'newest activity first');
  assert.deepEqual(
    tasks.map((task) => [task.id, task.status, task.gaps, task.holders]),
    [
      ['20261002-bbbb', 'ready', 0, 0],
      ['20261001-aaaa', 'relayed', 2, 2],
    ],
  );
  assert.deepEqual(foldTasks([{ ts: 'x', task: 'y', event: 'created' }]).length, 1);
  assert.deepEqual(foldTasks([]), []);
});

test('foldTools separates a systemic streak from a merely hot tool', () => {
  const streak = foldTools([traceLine('bash', true, 3), traceLine('bash', true, 2), traceLine('bash', true, 1)]);
  assert.equal(streak.calls, 3);
  assert.equal(streak.errors, 3);
  assert.deepEqual(streak.streaks, [{ tool: 'bash', run: 3 }]);
  assert.deepEqual(streak.hot, [], 'a streak is reported once, as the worse thing');

  const hot = foldTools([traceLine('web_fetch', true, 3), traceLine('web_fetch', false, 2), traceLine('web_fetch', true, 1), traceLine('web_fetch', true, 0.5)]);
  assert.deepEqual(hot.streaks, [], 'the success in the middle breaks the run');
  assert.equal(hot.hot[0]!.tool, 'web_fetch');
  assert.equal(hot.hot[0]!.rate, 0.75);

  const quiet = foldTools([traceLine('read', false, 1), traceLine('read', true, 2)]);
  assert.deepEqual([quiet.streaks, quiet.hot], [[], []], 'two calls is under the 3-call floor for a rate alert');
  assert.equal(foldTools([]).calls, 0);
  assert.equal(foldTools([{ at: 'x', tool: 'y' }]).calls, 0);
  assert.equal(TODAY_RULES.streakAlert, 3);
  assert.equal(TODAY_RULES.errorRateAlert, 0.2);
});

test('a systemic tool failure outranks money and tasks', () => {
  const plan = prioritiseToday(
    signals({
      tools: foldTools([traceLine('bash', true, 1), traceLine('bash', true, 2), traceLine('bash', true, 3)]),
      budget: { updatedAt: NOW.toISOString(), budgetTokens: 100_000, maxSessionTokens: 95_000, maxSessionRatio: 0.95, nextTurnEstTokens: 50_000, currency: 'CNY' },
      tasks: [{ id: 't1', title: 'x', version: 1, status: 'relayed', at: NOW.toISOString(), gaps: 3, holders: 1 }],
    }),
  );
  assert.ok(plan.headline.includes('先修工具链：bash 连续失败 3 次'), plan.headline);
  assert.equal(plan.actions[0]!.command, '/health');
  assert.ok(plan.actions.some((action) => action.command === '/qm'), 'the budget is still listed, just not first');
});

test('the budget becomes the headline when it is hot or the next step blows through', () => {
  const hot = prioritiseToday(
    signals({ budget: { updatedAt: NOW.toISOString(), budgetTokens: 100_000, maxSessionTokens: 82_000, maxSessionRatio: 0.82, nextTurnEstTokens: 4_000, currency: 'CNY' } }),
  );
  assert.ok(hot.headline.includes('预算已用到 82%'), hot.headline);
  assert.ok(hot.headline.includes('/qm'), hot.headline);

  const blow = prioritiseToday(
    signals({ budget: { updatedAt: NOW.toISOString(), budgetTokens: 100_000, maxSessionTokens: 60_000, maxSessionRatio: 0.6, nextTurnEstTokens: 45_000, currency: 'CNY' } }),
  );
  assert.ok(blow.headline.includes('这一步会把单会话预算烧穿'), blow.headline);
  assert.ok(blow.actions[0]!.why.includes('下步还要 ~45k'), blow.actions[0]!.why);

  const cool = prioritiseToday(
    signals({ budget: { updatedAt: NOW.toISOString(), budgetTokens: 100_000, maxSessionTokens: 40_000, maxSessionRatio: 0.4, nextTurnEstTokens: 4_000, currency: 'CNY' } }),
  );
  assert.ok(!cool.actions.some((action) => action.command === '/qm'), '40% is not a reason to interrupt the day');

  // no budget configured means no ratio, which must not read as 0%
  const unset = prioritiseToday(signals({ budget: { updatedAt: NOW.toISOString(), budgetTokens: 0, maxSessionTokens: 9_000, maxSessionRatio: null, nextTurnEstTokens: null, currency: '' } }));
  assert.ok(!unset.actions.some((action) => action.command === '/qm'), unset.headline);
});

test('cross-window handoffs rank by who is waiting on whom', () => {
  const answerFirst = prioritiseToday(
    signals({
      tasks: [
        { id: 't9', title: '要答案', version: 2, status: 'relayed', at: NOW.toISOString(), gaps: 2, holders: 1 },
        { id: 't8', title: '等回读', version: 1, status: 'relayed', at: new Date(NOW.getTime() - 40 * 3_600_000).toISOString(), gaps: 0, holders: 2 },
      ],
    }),
  );
  assert.ok(answerFirst.headline.includes('回答 t9 的 2 条缺口'), answerFirst.headline);
  assert.ok(answerFirst.headline.includes('/answer t9 Q1'), answerFirst.headline);
  assert.ok(answerFirst.actions[1]!.do.includes('催回读'), JSON.stringify(answerFirst.actions));
  assert.ok(answerFirst.actions[1]!.why.includes('2 个窗口持有'), JSON.stringify(answerFirst.actions));

  const freshOnly = prioritiseToday(signals({ tasks: [{ id: 't7', title: '', version: 1, status: 'relayed', at: NOW.toISOString(), gaps: 0, holders: 1 }] }));
  assert.ok(freshOnly.headline.includes('等 t7 的回读'), freshOnly.headline);
  assert.ok(!freshOnly.headline.includes('催'), 'nothing is stale yet');

  const ready = prioritiseToday(signals({ tasks: [{ id: 't6', title: '已确认', version: 4, status: 'ready', at: NOW.toISOString(), gaps: 0, holders: 1 }] }));
  assert.ok(ready.headline.includes('让 t6 开工（回读已通过 v4）'), ready.headline);

  const nothing = prioritiseToday(signals());
  assert.ok(nothing.headline.includes('没有阻塞'), nothing.headline);
  assert.ok(nothing.headline.includes('/forge'), nothing.headline);
});

test('spend is always reported but never outranks a blocker', () => {
  const plan = prioritiseToday(
    signals({
      spend: { monthMicros: 12_340_000, currency: 'CNY', records: 400, sessions: 9 },
      tasks: [{ id: 't5', title: '', version: 1, status: 'relayed', at: NOW.toISOString(), gaps: 1, holders: 1 }],
    }),
  );
  assert.ok(plan.headline.includes('回答 t5'), plan.headline);
  const spend = plan.actions.find((action) => action.command === '/forecast');
  assert.ok(spend!.do.includes(money(12_340_000, 'CNY')), spend!.do);
  assert.equal(money(12_340_000, 'USD'), '$12.34');
  assert.equal(money(120, 'CNY'), '¥0.0001', 'sub-cent costs stay readable');
});

test('the render names its blind spots instead of implying full sight', () => {
  const blind = renderToday(prioritiseToday(signals()), signals());
  assert.ok(blind.includes('看不到的部分'), blind);
  for (const source of ['quota 的 summary.json', 'cost-ledger 台账', 'tool-trace 追踪']) {
    assert.ok(blind.includes(source), `missing source not named: ${source}`);
  }
  const seen = renderToday(
    prioritiseToday(signals({ budget: { updatedAt: NOW.toISOString(), budgetTokens: 100_000, maxSessionTokens: 90_000, maxSessionRatio: 0.9, nextTurnEstTokens: 20_000, currency: 'CNY' }, spend: { monthMicros: 1_000, currency: 'CNY', records: 2, sessions: 1 }, tools: foldTools([traceLine('read', false, 1)]), tasks: [] })),
    signals({ budget: { updatedAt: NOW.toISOString(), budgetTokens: 100_000, maxSessionTokens: 90_000, maxSessionRatio: 0.9, nextTurnEstTokens: 20_000, currency: 'CNY' }, spend: { monthMicros: 1_000, currency: 'CNY', records: 2, sessions: 1 }, tools: foldTools([traceLine('read', false, 1)]), tasks: [] }),
  );
  assert.ok(seen.startsWith('今天第一件事：'), seen);
  assert.ok(seen.includes('依据：task-forge 0 个任务 · quota 预算 90% · tool-trace 1 次调用·错误率 0% · cost-ledger 2 条'), seen);
  assert.ok(!seen.includes('看不到的部分'), seen);
  assert.ok(seen.includes('   └ 最热的会话 90k/100k tok，下步还要 ~20k'), seen);
  assert.ok(!seen.includes('  1. '), 'the headline action is not repeated as row 1');
  assert.ok(seen.includes('  2. 本月已花'), seen);
});

type Cmd = { name: string; handler: (args: { rawInput?: string }) => { kind: string; text: string } };

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ide-hub-today-'));
  after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}


test('the readers mirror the other plugins files, and tolerate junk', () => {
  const root = tempDir();
  assert.equal(readBudget(join(root, 'missing.json')), null);
  writeFileSync(join(root, 'summary.json'), '{ not json', 'utf8');
  assert.equal(readBudget(join(root, 'summary.json')), null);
  writeFileSync(join(root, 'summary.json'), JSON.stringify({ updatedAt: 'nope', budgetTokens: 1 }), 'utf8');
  assert.equal(readBudget(join(root, 'summary.json')), null, 'a summary with no parseable timestamp is unusable');
  writeFileSync(
    join(root, 'summary.json'),
    JSON.stringify({ updatedAt: NOW.toISOString(), budgetTokens: 50_000, maxSessionTokens: 44_000, maxSessionRatio: null, nextTurnEstTokens: null, currency: 'USD', todayTokens: 1, todayCostMicros: 2, sessions: 1 }),
    'utf8',
  );
  assert.deepEqual(readBudget(join(root, 'summary.json')), {
    updatedAt: NOW.toISOString(),
    budgetTokens: 50_000,
    maxSessionTokens: 44_000,
    maxSessionRatio: null,
    nextTurnEstTokens: null,
    currency: 'USD',
  });

  assert.equal(readSpend(join(root, 'no-such-dir'), NOW), null);
  const month = '2026-10';
  writeFileSync(join(root, `ledger-${month}.jsonl`), 'junk\n', 'utf8');
  assert.equal(readSpend(root, NOW), null, 'a file of only broken lines is no spend');
  writeFileSync(
    join(root, `ledger-${month}.jsonl`),
    [
      JSON.stringify({ at: '2026-10-02T09:00:00.000Z', sessionId: 'a', costMicros: 5_000_000, currency: 'CNY' }),
      JSON.stringify({ at: '2026-10-02T09:01:00.000Z', sessionId: 'b', costMicros: 2_500_000, currency: 'CNY' }),
      JSON.stringify({ at: '2026-09-02T09:01:00.000Z', sessionId: 'c', costMicros: 999, currency: 'CNY' }),
      '{ broken',
    ].join('\n'),
    'utf8',
  );
  assert.deepEqual(readSpend(root, NOW), { monthMicros: 7_500_000, currency: 'CNY', records: 2, sessions: 2 });

  const forge = join(root, 'ledger.jsonl');
  writeFileSync(forge, [JSON.stringify({ ts: NOW.toISOString(), task: 't1', event: 'acked', version: 2, status: 'relayed', note: 'need-input · 缺口 4 条' }), 'oops'].join('\n'), 'utf8');
  assert.equal(readTasks(forge)[0]!.gaps, 4, 'a damaged line does not lose the good one');
  assert.deepEqual(readTasks(join(root, 'never')), []);

  assert.equal(readTools(join(root, 'no-trace-dir'), NOW, 3), null);
  writeFileSync(
    join(root, 'tool-trace-2026-10.jsonl'),
    [traceLine('bash', true, 1), traceLine('bash', true, 2), traceLine('bash', true, 3), traceLine('bash', true, 9_000)]
      .map((row) => JSON.stringify({ v: 1, sessionId: 's', ...row }))
      .join('\n'),
    'utf8',
  );
  const tools = readTools(root, NOW, 3);
  assert.equal(tools!.calls, 3, 'the 9000-hours-old line is outside the window');
  assert.deepEqual(tools!.streaks, [{ tool: 'bash', run: 3 }]);
});

test('/today wires the four sources into one ranked answer', () => {
  const root = tempDir();
  const write = (name: string, body: string): string => {
    const file = join(root, name);
    writeFileSync(file, body, 'utf8');
    return file;
  };
  writeFileSync(join(root, 'tool-trace-2026-10.jsonl'), JSON.stringify({ v: 1, sessionId: 's', at: NOW.toISOString(), tool: 'read', durationMs: 10, argChars: 1, resultChars: 2, isError: false }), 'utf8');
  writeFileSync(join(root, 'ledger-2026-10.jsonl'), JSON.stringify({ at: NOW.toISOString(), sessionId: 's', costMicros: 1_500_000, currency: 'CNY', modelId: 'deepseek-chat' }), 'utf8');
  const commands: Cmd[] = [];
  const mount = (config: Record<string, unknown> = {}): void => {
    apply({ logger: () => ({ info() {}, warn() {}, debug() {} }), commands: { register: (definition: Cmd) => void commands.push(definition) } } as never, {
      enabled: true,
      quotas: [],
      vaultDir: '',
      quotaSummaryPath: write('summary.json', JSON.stringify({ updatedAt: NOW.toISOString(), budgetTokens: 100_000, maxSessionTokens: 92_000, maxSessionRatio: 0.92, nextTurnEstTokens: 30_000, currency: 'CNY' })),
      costLedgerDir: root,
      taskForgeLedger: write('tasks.jsonl', JSON.stringify({ ts: NOW.toISOString(), task: '20261002-aaaa', event: 'acked', version: 1, status: 'relayed', title: '交接A', note: 'need-input · 缺口 2 条' })),
      toolTraceDir: root,
      todayWindowDays: 3,
      ...config,
    } as never);
  };

  mount();
  const today = commands.find((command) => command.name === 'today');
  assert.ok(today, '/today must be registered');
  const text = today!.handler({}).text;
  // 92k used + 30k predicted over a 100k budget: the money is the first thing
  assert.ok(text.includes('今天第一件事：这一步会把单会话预算烧穿'), text);
  assert.ok(text.includes('回答 20261002-aaaa 的 2 条缺口'), text);
  assert.ok(!text.includes('看不到的部分'), 'all four sources resolved here');

  // an empty day with nothing installed still answers, and says what it could not see
  const quiet: Cmd[] = [];
  apply({ logger: () => ({ info() {}, warn() {}, debug() {} }), commands: { register: (definition: Cmd) => void quiet.push(definition) } } as never, {
    enabled: true,
    quotas: [],
    quotaSummaryPath: join(root, 'nothing-summary.json'),
    costLedgerDir: join(root, 'nothing-dir'),
    taskForgeLedger: join(root, 'nothing-ledger.jsonl'),
    toolTraceDir: join(root, 'nothing-trace'),
    todayWindowDays: 3,
  } as never);
  const blindText = quiet.find((command) => command.name === 'today')!.handler({}).text;
  assert.ok(blindText.includes('没有阻塞'), blindText);
  assert.ok(blindText.includes('quota 的 summary.json'), blindText);
});

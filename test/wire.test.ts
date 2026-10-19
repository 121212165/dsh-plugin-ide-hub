/** Wire-level assembly tests for ide-hub: the real apply() against a scripted
 * cordis context. The scan-heavy handlers (/ide-hub, /hub-usage, /hub-sessions,
 * /hub-week, /hub-export) only assert their registered surface — at mount time
 * nothing is scanned, every scan is deferred into the handler. The cheap,
 * boundary-owned behaviors are driven for real: /hub-migrate against a
 * user-declared quota table, /hub-init against a temp project, and /today
 * against fixture files in temp dirs standing in for the sibling plugins'
 * published contracts.
 * @module test/wire */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';

import { apply } from '../src/plugin.ts';
import { POINTER_BEGIN, POINTER_SPECS } from '../src/hub/pointers.ts';

interface CapturedCommand {
  name: string;
  description: string;
  input?: { hint?: string };
  handler: (args: { rawInput?: string | undefined }) => { kind: string; text: string };
}

interface CapturedTool {
  name: string;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

interface CapturedSection {
  name: string;
  text: () => string;
}

interface Harness {
  commands: CapturedCommand[];
  tools: CapturedTool[];
  sections: CapturedSection[];
  listeners: { event: string; callback: unknown }[];
  paths: { base: string; quota: string; ledgerDir: string; tasks: string; traceDir: string; insightsDir: string; forecast: string };
  apply(config?: Record<string, unknown>): void;
  command(name: string): CapturedCommand;
}

function makeHarness(): Harness {
  const commands: CapturedCommand[] = [];
  const tools: CapturedTool[] = [];
  const sections: CapturedSection[] = [];
  const listeners: { event: string; callback: unknown }[] = [];

  const ctx = {
    logger(_name: string) {
      return { info() {}, warn() {}, debug() {} };
    },
    on(event: string, callback: unknown) {
      listeners.push({ event, callback });
    },
    commands: {
      register(definition: CapturedCommand) {
        commands.push(definition);
      },
    },
    tools: {
      register(definition: CapturedTool) {
        tools.push(definition);
      },
    },
    systemPrompt: {
      section(section: CapturedSection) {
        sections.push(section);
      },
    },
  };

  const base = mkdtempSync(join(tmpdir(), 'ide-hub-wire-'));
  after(() => rmSync(base, { recursive: true, force: true }));
  const paths = {
    base,
    quota: join(base, 'quota-summary.json'),
    ledgerDir: join(base, 'ledger'),
    tasks: join(base, 'ledger.jsonl'),
    traceDir: join(base, 'trace'),
    insightsDir: join(base, 'insights'),
    forecast: join(base, 'forecast.json'),
  };

  const harness: Harness = {
    commands,
    tools,
    sections,
    listeners,
    paths,
    apply(config: Record<string, unknown> = {}) {
      // Schema defaults only apply through the host — restate them for direct
      // apply(), and aim every today-source path at the harness temp root.
      apply(
        ctx as never,
        {
          enabled: true,
          quotas: [],
          quotaSummaryPath: paths.quota,
          costLedgerDir: paths.ledgerDir,
          taskForgeLedger: paths.tasks,
          toolTraceDir: paths.traceDir,
          sessionInsightsDir: paths.insightsDir,
          forecastPath: paths.forecast,
          ...config,
        } as never,
      );
    },
    command(name: string): CapturedCommand {
      const found = commands.find((candidate) => candidate.name === name);
      if (!found) throw new Error(`command ${name} was never registered`);
      return found;
    },
  };
  return harness;
}

function monthFile(now: Date, prefix: string): string {
  return `${prefix}-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}.jsonl`;
}

test('disabled by config mounts nothing at all', () => {
  const harness = makeHarness();
  harness.apply({ enabled: false });
  assert.equal(harness.commands.length, 0);
  assert.equal(harness.tools.length, 0);
  assert.equal(harness.sections.length, 0);
  assert.equal(harness.listeners.length, 0);
});

test('apply wires the eight-command surface; nothing else is injected', () => {
  const harness = makeHarness();
  harness.apply();
  assert.deepEqual(
    harness.commands.map((command) => command.name).sort(),
    ['hub-export', 'hub-init', 'hub-migrate', 'hub-sessions', 'hub-usage', 'hub-week', 'ide-hub', 'today'],
  );
  assert.equal(harness.tools.length, 0, 'ide-hub is a command surface, not a tool surface');
  assert.equal(harness.sections.length, 0);
  assert.equal(harness.listeners.length, 0);
  for (const command of harness.commands) {
    assert.ok(command.description.length > 8, `${command.name} carries a description`);
    assert.equal(typeof command.handler, 'function');
  }
  assert.ok(harness.command('hub-init').input?.hint?.includes('--remove'), 'the one flagged command advertises its flags');
});

test('/hub-migrate turns the user-declared quota table into verdicts and a run-queue', () => {
  const harness = makeHarness();
  harness.apply({
    quotas: [
      { tool: 'claude-code', remainingMajor: 20, dailyMajor: 5, priority: 'work' },
      { tool: 'zcode', remainingMajor: 200, dailyMajor: 0, priority: 'batch' },
      { tool: 'trae', remainingMajor: 0, dailyMajor: 4, priority: 'learning' },
    ],
  } as never);
  const text = harness.command('hub-migrate').handler({}).text;
  assert.ok(text.includes('⚠ 紧张 剩 4 天'), text);
  assert.equal(text.includes('work → claude-code'), false, 'a tight tool is not healthy, it cannot take the queue');
  assert.ok(text.includes('❌ 耗尽 剩 0 天 → 迁移到 zcode(充裕), claude-code(4天)'), text);
  assert.ok(text.includes('💤 闲置 剩 —'), text, 'an idle tool is never asked to migrate');
  assert.ok(text.includes('明日跑位建议:'), text);
  assert.ok(text.includes('work → zcode'), text, 'with claude-code tight, the only healthy tool takes every priority');
  assert.ok(text.includes('batch → zcode'), text);
  assert.ok(text.includes('learning → zcode'), text);
});

test('/hub-migrate admits an empty quota table instead of inventing numbers', () => {
  const harness = makeHarness();
  harness.apply();
  const text = harness.command('hub-migrate').handler({}).text;
  assert.ok(text.includes('还没有登记任何额度状态'), text);
  assert.ok(text.includes('ide-hub.quotas'), text);
});

test('/hub-init drives a real temp project through apply: install, idempotent rerun, scope refusal', () => {
  const harness = makeHarness();
  harness.apply();
  const init = harness.command('hub-init');
  const target = mkdtempSync(join(tmpdir(), 'ide-hub-wire-proj-'));

  const refused = init.handler({ rawInput: `${target} --only nosuchwidget` });
  assert.equal(refused.kind, 'error');
  assert.ok(refused.text.includes('nosuchwidget'), refused.text);
  assert.ok(refused.text.includes('codex'), 'the refusal lists the real adapter table');

  const missing = init.handler({ rawInput: join(target, 'nope') });
  assert.equal(missing.kind, 'error');
  assert.ok(missing.text.includes('目录不存在'), missing.text);

  // The adapter table is real: a scoped run never writes the shared AGENTS.md.
  const shared = POINTER_SPECS.find((spec) => spec.tool === 'codex')!.path;
  const traed = POINTER_SPECS.find((spec) => spec.tool === 'trae')!.path;
  const ok = init.handler({ rawInput: `${target} --only codex,trae` });
  assert.equal(ok.kind, 'success', ok.text);
  assert.ok(ok.text.includes(`＋ 新建 ${shared}`), ok.text);
  assert.ok(existsSync(join(target, shared)), 'the command wrote for real');
  assert.ok(readFileSync(join(target, shared), 'utf8').includes(POINTER_BEGIN));
  assert.ok(existsSync(join(target, traed)));

  const rerun = init.handler({ rawInput: `${target} --only codex,trae` });
  assert.ok(rerun.text.includes('· 未变'), rerun.text);
  assert.equal(rerun.text.includes('＋ 新建'), false, 'a rerun changes nothing');

  const removed = init.handler({ rawInput: `${target} --only codex --remove` });
  assert.ok(removed.text.includes(`－ 删除 ${shared}`), removed.text);
  assert.equal(existsSync(join(target, shared)), false, 'the command uninstalled for real');
  assert.ok(existsSync(join(target, traed)), 'only the scoped tool goes away');
});

test('/today ranks live sibling-plugin fixtures under the real rules', () => {
  const harness = makeHarness();
  harness.apply();
  const { paths } = harness;
  const now = new Date();
  const month = monthFile(now, 'ledger');
  mkdirSync(paths.ledgerDir, { recursive: true });
  mkdirSync(paths.traceDir, { recursive: true });
  mkdirSync(paths.insightsDir, { recursive: true });
  const iso = now.toISOString();
  writeFileSync(paths.quota, JSON.stringify({
    updatedAt: iso,
    budgetTokens: 100_000,
    maxSessionTokens: 90_000,
    maxSessionRatio: 0.9,
    nextTurnEstTokens: 20_000,
    currency: 'USD',
  }), 'utf8');
  writeFileSync(join(paths.ledgerDir, month), [
    JSON.stringify({ at: iso, costMicros: 7_000_000, currency: 'CNY', sessionId: 's1' }),
    JSON.stringify({ at: iso, costMicros: 5_000_000, currency: 'CNY', sessionId: 's2' }),
    JSON.stringify({ at: '1999-01-01T00:00:00Z', costMicros: 999_000_000, currency: 'CNY', sessionId: 'outside' }),
  ].join('\n'), 'utf8');
  writeFileSync(paths.tasks, [
    JSON.stringify({ ts: iso, task: 't-report', event: 'created', title: '写周报', version: 1 }),
    JSON.stringify({ ts: iso, task: 't-review', event: 'created', title: 'review', version: 2 }),
  ].join('\n'), 'utf8');
  writeFileSync(join(paths.traceDir, monthFile(now, 'tool-trace')), [
    JSON.stringify({ at: iso, tool: 'shell', isError: false }),
    JSON.stringify({ at: iso, tool: 'editor', isError: false }),
  ].join('\n'), 'utf8');
  writeFileSync(join(paths.insightsDir, monthFile(now, 'insights')), [
    JSON.stringify({ at: iso, sessionId: 's1', buckets: { uncachedInput: 1000, output: 400 }, costMicros: 2_000 }),
    JSON.stringify({ at: iso, sessionId: 's1', buckets: { uncachedInput: 300, output: 100 }, costMicros: 500 }),
    JSON.stringify({ at: iso, sessionId: 's2', buckets: { uncachedInput: 700, output: 200 }, costMicros: 300 }),
  ].join('\n'), 'utf8');
  writeFileSync(paths.forecast, JSON.stringify({
    v: 1,
    updatedAt: iso,
    currency: 'CNY',
    dailyRateMicros: 3_000_000,
    trend: 'steady',
    month: '',
    spentThisMonthMicros: 12_000_000,
    projectedMonthEndMajor: 300,
    budgetMajor: 500,
    daysUntilBudget: 4,
    budgetExhaustionDate: iso.slice(0, 10),
  }), 'utf8');

  const text = harness.command('today').handler({}).text;
  assert.ok(text.startsWith('今天第一件事：'), text);
  assert.ok(text.includes('这一步会把单会话预算烧穿：先收尾或换会话'), text);
  assert.ok(text.includes('（/qm）'), text);
  assert.ok(text.includes('本月预算 4 天后烧穿'), text, 'forecast burn-out lands as an action');
  assert.ok(text.includes('/forecast'), text);
  assert.ok(text.includes('本月已花 ¥12.00'), text, 'the out-of-month row is filtered, CNY over two records only');
  assert.ok(text.includes('依据：task-forge 2 个任务 · quota 预算 90% · tool-trace 2 次调用·错误率 0%'), text);
  assert.ok(text.includes('session-insights 2 会话/3 事件'), text);
  assert.ok(text.includes('cost-ledger 2 条'), text);
  assert.equal(text.includes('看不到的部分'), false, 'every source published something, nothing is blind');
});

test('/today says what it cannot see, and still answers, when the sources are absent', () => {
  const harness = makeHarness();
  harness.apply();
  const text = harness.command('today').handler({}).text;
  assert.ok(text.startsWith('今天第一件事：没有阻塞：可以开新需求'), text);
  assert.ok(text.includes('看不到的部分：'), text);
  for (const blind of ['quota 的 summary.json', 'cost-ledger 台账', 'tool-trace 追踪', 'session-insights 侧车', 'spend-forecast 的 forecast.json']) {
    assert.ok(text.includes(blind), `${blind} is named as a blind spot in:\n${text}`);
  }
});

test('/today turns a stale relayed handoff and a gap-raising ack into the headline', () => {
  const harness = makeHarness();
  harness.apply();
  const { paths } = harness;
  const now = new Date();
  const stale = new Date(now.getTime() - 40 * 3_600_000).toISOString();
  writeFileSync(paths.tasks, [
    JSON.stringify({ ts: stale, task: 't-old', event: 'created', title: '交接单', version: 1 }),
    JSON.stringify({ ts: stale, task: 't-old', event: 'relayed', status: 'relayed', target: 'window-b', version: 1 }),
    JSON.stringify({ ts: now.toISOString(), task: 't-fresh', event: 'created', version: 1 }),
    JSON.stringify({ ts: now.toISOString(), task: 't-gap', event: 'created', title: '要补的卡', version: 1 }),
    JSON.stringify({ ts: now.toISOString(), task: 't-gap', event: 'acked', note: '缺口 2 条', version: 1 }),
  ].join('\n'), 'utf8');

  const text = harness.command('today').handler({}).text;
  assert.ok(text.includes('今天第一件事：回答 t-gap 的 2 条缺口：/answer t-gap Q1 <答案>'), text);
  assert.ok(text.includes('催回读：t-old 已经 40 小时没人 ack'), text);
  assert.ok(text.includes('看不到的部分'), text, 'with no sibling sources the answer still states its sight');
});

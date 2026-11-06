import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand } from '../src/lib/domain';
import type { Expense, WorkspaceData } from '../src/lib/types';

// The component has a stylesheet import; Node needs no CSS when checking form behavior.
const componentRequire = createRequire(path.resolve('tests/expense-date.test.ts'));
const previousCssLoader = componentRequire.extensions['.css'];
let budgetUi: typeof import('../src/components/task-budget');
try {
  componentRequire.extensions['.css'] = () => undefined;
  budgetUi = componentRequire('../src/components/task-budget');
} finally {
  if (previousCssLoader) componentRequire.extensions['.css'] = previousCssLoader;
  else delete componentRequire.extensions['.css'];
}

const now = new Date('2026-11-06T03:00:00Z');
const newExpense: Expense = { id: 'date-only-expense', date: '2026-11-06', projectName: '통계연보 발간', vendor: '시연 인쇄사', description: '인쇄비 지급', amount: 2000 };
const taskOf = (state: WorkspaceData) => state.tasks.find(task => task.id === 'task-data')!;
function record(state: WorkspaceData, expenses: Expense[]) {
  const candidate = structuredClone(state);
  executeCommand(candidate, 'u-support-member', { type: 'task.record', payload: { taskId: 'task-data', expenses }, expectedRevision: state.revision, requestId: randomUUID() }, now);
  Object.assign(state, candidate);
}

test('expense form accepts a new date-only record and never displays a time control', () => {
  assert.equal(budgetUi.taskExpenseIssue([newExpense]), '');
  assert.equal(budgetUi.taskExpenseIssue([newExpense], [{ ...newExpense, time: '14:30' }]), '');
  assert.notEqual(budgetUi.taskExpenseIssue([{ ...newExpense, vendor: '' }]), '');
  const html = renderToStaticMarkup(createElement(budgetUi.TaskBudgetSection, {
    value: { mode: 'manual', amount: '5000' }, onChange: () => undefined,
    expenses: [{ ...newExpense, time: '14:30' }], onExpensesChange: () => undefined,
    previousExpenses: [{ ...newExpense, time: '14:30' }], definitionEditable: true,
    expensesEditable: true, today: '2026-11-06', defaultProjectName: '통계연보 발간',
  }));
  assert.match(html, /type="date"/);
  assert.doesNotMatch(html, /type="time"|집행 시각|14:30/);
});

test('date-only expense records persist with audit history while invalid dates are rejected', () => {
  const state = createSeed(now);
  record(state, [newExpense]);
  assert.deepEqual(taskOf(state).expenses, [newExpense]);
  assert.deepEqual(taskOf(state).recordHistory?.at(-1)?.expensesAfter, [newExpense]);
  assert.equal(Object.hasOwn(taskOf(state).expenses![0], 'time'), false);
  const saved = JSON.stringify(state);
  assert.throws(() => record(state, [{ ...newExpense, date: '2026-02-30' }]), error => error instanceof DomainError && error.code === 'VALIDATION_ERROR');
  assert.equal(JSON.stringify(state), saved);
});

test('editing expenses preserves legacy records with or without time alongside new date-only entries', () => {
  const state = createSeed(now);
  const withTime: Expense = { ...newExpense, id: 'legacy-time', time: '14:30' };
  const withoutTime: Expense = { id: 'legacy-date', date: '2026-11-05', description: '기존 지출', amount: 1000 };
  taskOf(state).expenses = [withTime, withoutTime];
  const expenses = [{ ...withTime, amount: 2500 }, withoutTime, newExpense];
  assert.equal(budgetUi.taskExpenseIssue(expenses, [withTime, withoutTime]), '');
  record(state, expenses);
  assert.deepEqual(taskOf(state).expenses, expenses);
  assert.deepEqual(taskOf(state).recordHistory?.at(-1)?.expensesBefore, [withTime, withoutTime]);
  assert.equal(taskOf(state).expenses![0].time, '14:30');
  assert.ok(taskOf(state).expenses!.slice(1).every(expense => !Object.hasOwn(expense, 'time')));
});

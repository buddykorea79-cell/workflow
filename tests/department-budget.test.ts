import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/lib/seed';
import { DomainError } from '../src/lib/domain';
import { departmentBudgetForUser } from '../src/lib/department-budget';
import type { BudgetCatalogItem } from '../src/lib/budget-types';
import type { Task, WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-06T03:00:00Z');
const item: BudgetCatalogItem = { id: 'budget-a', year: 2026, account: '일반회계', field: '일반행정', sector: '행정', program: '디지털행정', unitProject: '행정서비스', projectName: '공공서비스', confirmedAmountWon: 1000 };
function initial() {
  const state = createSeed(now); const template = structuredClone(state.tasks.find(task => task.id === 'task-data')!);
  state.tasks = [];
  state.budgetCatalog = { schemaVersion: 1, year: 2026, source: { fileName: 'test.pdf' }, items: [structuredClone(item)] };
  return { state, template };
}
function append(state: WorkspaceData, template: Task, id: string, patch: Partial<Task> = {}) {
  const task = { ...structuredClone(template), id, commonId: undefined, deletedAt: undefined, budgetMode: 'catalog' as const, budget: item.confirmedAmountWon, budgetAllocation: structuredClone(item), expenses: [], ...patch };
  state.tasks.push(task); return task;
}
const expense = (id: string, amount: number, date = '2026-10-01') => ({ id, date, description: 'private expense description', vendor: 'private vendor', amount });
const reject = (code: string, fn: () => unknown) => assert.throws(fn, error => error instanceof DomainError && error.code === code);

test('department totals deduplicate linked budgets, sum expenditure by year, and expose only aggregate fields', () => {
  const { state, template } = initial();
  append(state, template, 'a', { expenses: [expense('a1', 200), expense('a2', 100, '2025-11-02')] });
  append(state, template, 'b', { expenses: [expense('b1', 300)] });
  const foreignUnit = state.units.find(unit => unit.departmentId === 'dept-plan')!;
  append(state, template, 'foreign', { departmentId: 'dept-plan', unitId: foreignUnit.id, expenses: [expense('secret', 700)] });
  const before = JSON.stringify(state);
  const result = departmentBudgetForUser(state, 'u-doyun', { year: 2026 }, now);
  assert.deepEqual(result.totals, { budget: 1000, spent: 500, balance: 500, taskCount: 2, projectCount: 1, expenseCount: 2 });
  assert.equal(result.groups.length, 1); assert.equal(result.groups[0].projects.length, 1);
  assert.equal(result.ignoredOtherYearExpenseCount, 1); assert.deepEqual(result.years, [2026, 2025]);
  assert.equal(result.groups[0].projects[0].amountSource, 'catalog');
  assert.doesNotMatch(JSON.stringify(result), /private expense|private vendor|secret|task-data/);
  assert.equal(JSON.stringify(state), before);
  const prior = departmentBudgetForUser(state, 'u-doyun', { year: 2025 }, now);
  assert.equal(prior.totals.spent, 0); assert.deepEqual(prior.otherBudgetYear, { spent: 100, expenseCount: 1, taskCount: 1 });
});

test('same names in different budget hierarchies remain separate and current catalog amounts override old snapshots once', () => {
  const { state, template } = initial();
  const second = { ...item, id: 'budget-b', account: '특별회계', confirmedAmountWon: 2000 };
  state.budgetCatalog!.items = [{ ...item, confirmedAmountWon: 1500 }, second];
  append(state, template, 'a'); append(state, template, 'b');
  append(state, template, 'c', { budgetAllocation: second, budget: 2000 });
  const result = departmentBudgetForUser(state, 'u-doyun', { year: 2026 }, now);
  assert.equal(result.groups.length, 2); assert.equal(result.totals.budget, 3500); assert.equal(result.totals.projectCount, 2);
  const current = result.groups.flatMap(group => group.projects).find(project => project.id === item.id)!;
  assert.equal(current.changedSnapshotCount, 2); assert.equal(current.budget, 1500);
  assert.equal(state.tasks[0].budget, 1000);
});

test('removed catalog entries use the latest preserved snapshot deterministically and flag changed snapshots', () => {
  const { state, template } = initial(); state.budgetCatalog!.items = [];
  append(state, template, 'older', { updatedAt: '2026-01-01T00:00:00Z' });
  append(state, template, 'newer', { budget: 1800, budgetAllocation: { ...item, confirmedAmountWon: 1800 }, updatedAt: '2026-02-01T00:00:00Z' });
  const project = departmentBudgetForUser(state, 'u-doyun', {}, now).groups[0].projects[0];
  assert.equal(project.budget, 1800); assert.equal(project.amountSource, 'snapshot'); assert.equal(project.changedSnapshotCount, 1);
});

test('manual budgets and nonbudget tasks remain separate, archived spending remains included, deleted work is excluded', () => {
  const { state, template } = initial();
  append(state, template, 'archived', { status: 'archived', expenses: [expense('archived', 1100)] });
  append(state, template, 'deleted', { deletedAt: now.toISOString(), expenses: [expense('deleted', 9000)] });
  const deletedUnit = { ...state.units.find(unit => unit.id === template.unitId)!, id: 'deleted-unit', deletedAt: now.toISOString() }; state.units.push(deletedUnit);
  append(state, template, 'deleted-unit-task', { unitId: deletedUnit.id, expenses: [expense('deleted-unit', 9000)] });
  append(state, template, 'manual', { budgetMode: 'manual', budget: 400, budgetAllocation: undefined, expenses: [expense('manual', 90), expense('old-manual', 80, '2025-12-01')] });
  append(state, template, 'none', { budgetMode: 'none', budget: 0, budgetAllocation: undefined });
  const result = departmentBudgetForUser(state, 'u-doyun', {}, now);
  assert.deepEqual(result.totals, { budget: 1000, spent: 1100, balance: -100, taskCount: 1, projectCount: 1, expenseCount: 1 });
  assert.deepEqual(result.manual, { budget: 400, spent: 90, balance: 310, taskCount: 1, expenseCount: 1 });
  assert.equal(result.nonBudgetTaskCount, 1); assert.equal(result.excludedTaskCount, 2);
});

test('unpublished and unregistered common work is excluded without losing registered common expenditure', () => {
  const { state, template } = initial(); const commonTemplate = structuredClone(state.commonTasks[0]);
  const distribution = { ...commonTemplate.distributions[0], departmentId: 'dept-support', taskId: 'registered', status: 'registered' as const };
  state.commonTasks = [{ ...commonTemplate, id: 'published', publicationStatus: 'approved', distributions: [distribution, { ...distribution, taskId: 'unregistered', status: 'person_assigned' }] }, { ...commonTemplate, id: 'pending', publicationStatus: 'pending', distributions: [{ ...distribution, taskId: 'pending-task' }] }];
  append(state, template, 'registered', { commonId: 'published', expenses: [expense('valid', 10)] });
  append(state, template, 'unregistered', { commonId: 'published', expenses: [expense('invalid', 100)] });
  append(state, template, 'pending-task', { commonId: 'pending', expenses: [expense('pending', 1000)] });
  const result = departmentBudgetForUser(state, 'u-doyun', {}, now);
  assert.equal(result.totals.spent, 10); assert.equal(result.excludedTaskCount, 2);
});

test('department budget access is role-scoped, validates active accounts, and uses the Korean calendar year', () => {
  const { state, template } = initial(); append(state, template, 'a');
  for (const user of ['u-support-member', 'u-support-lead']) reject('DEPARTMENT_BUDGET_REQUIRED', () => departmentBudgetForUser(state, user, {}, now));
  reject('DEPARTMENT_BUDGET_SCOPE', () => departmentBudgetForUser(state, 'u-doyun', { departmentId: 'dept-plan' }, now));
  reject('DEPARTMENT_BUDGET_SCOPE', () => departmentBudgetForUser(state, 'u-support-head', { departmentId: 'dept-plan' }, now));
  assert.equal(departmentBudgetForUser(state, 'u-support-head', {}, now).department.id, 'dept-support');
  assert.equal(departmentBudgetForUser(state, 'u-admin', { departmentId: 'dept-support' }, now).totals.taskCount, 1);
  reject('DEPARTMENT_NOT_FOUND', () => departmentBudgetForUser(state, 'u-admin', { departmentId: 'missing' }, now));
  reject('DEPARTMENT_BUDGET_YEAR', () => departmentBudgetForUser(state, 'u-admin', { year: 2026.5 }, now));
  state.users.find(user => user.id === 'u-doyun')!.endsAt = '2026-01-01T00:00:00Z';
  reject('ACCOUNT_INACTIVE', () => departmentBudgetForUser(state, 'u-doyun', {}, now));
  assert.equal(departmentBudgetForUser(state, 'u-admin', {}, new Date('2026-12-31T16:00:00Z')).year, 2027);
});

test('aggregation refuses unsafe monetary totals instead of returning rounded numbers', () => {
  const { state, template } = initial();
  const other = { ...item, id: 'large', confirmedAmountWon: Number.MAX_SAFE_INTEGER };
  state.budgetCatalog!.items.push(other);
  append(state, template, 'a'); append(state, template, 'large', { budgetAllocation: other });
  reject('DEPARTMENT_BUDGET_AMOUNT_RANGE', () => departmentBudgetForUser(state, 'u-doyun', {}, now));
});

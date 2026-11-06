import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed, snapshot } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { getBudgetCatalog, parseBudgetCatalog, searchBudgets } from '../src/lib/budget-catalog';
import { workDivisionSnapshot } from '../src/lib/work-division';
import { delegationTaskFingerprint } from '../src/lib/delegation-commands';
import type { BudgetCatalog, BudgetCatalogItem } from '../src/lib/budget-types';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-06T03:00:00Z');
const item: BudgetCatalogItem = { id: 'demo-budget', year: 2026, account: '일반회계', field: '일반·지방행정', sector: '일반행정', program: '디지털 행정', unitProject: '자료 관리', projectName: '시연 통계 간행물 발간', projectCode: '100-001', confirmedAmountWon: 5_000_000, sourceAmount: '5', sourceUnit: '백만원', sourcePage: 15, active: true };
const fixture = (): BudgetCatalog => ({ schemaVersion: 1, year: 2026, source: { fileName: '시연.pdf', sha256: 'a'.repeat(64) }, items: [structuredClone(item)] });
const initial = () => { const state = createSeed(now); state.budgetCatalog = fixture(); return state; };
const taskOf = (state: WorkspaceData) => state.tasks.find(task => task.id === 'task-data')!;
const dispatch = (state: WorkspaceData, user: string, type: string, payload: Record<string, unknown>, requestId = randomUUID()) => {
  const candidate = structuredClone(state);
  executeCommand(candidate, user, { type, payload, expectedRevision: state.revision, requestId }, now);
  Object.assign(state, candidate);
};
const rejects = (code: string, fn: () => unknown) => assert.throws(fn, error => error instanceof DomainError && error.code === code);

test('packaged PDF catalog has complete detail rows and integer-won total without seeding or leaking it into workspaces', () => {
  const state = createSeed(now); const before = JSON.stringify(state);
  const catalog = getBudgetCatalog(state);
  assert.equal(catalog.items.length, 308);
  assert.equal(catalog.items.reduce((sum, row) => sum + row.confirmedAmountWon, 0), 76_905_548_000_000);
  assert.equal(catalog.items.filter(row => row.confirmedAmountWon === 0).length, 23);
  assert.ok(catalog.items.every(row => row.field && row.sector && row.program && row.projectName && row.sourcePage && Number.isSafeInteger(row.confirmedAmountWon)));
  assert.ok(searchBudgets(state, { query: '디지털', year: 2026 }).total > 0);
  assert.equal(JSON.stringify(state), before);
  assert.equal('budgetCatalog' in getWorkspace(state, 'u-admin', now), false);
});

test('catalog search covers hierarchy and project names, handles spaced keywords, excludes inactive rows and paginates', () => {
  const state = initial(); state.budgetCatalog!.items.push({ ...item, id: 'inactive', active: false }, ...Array.from({ length: 24 }, (_, index) => ({ ...item, id: `other-${index}`, projectName: `다른 사업 ${index}` })));
  assert.equal(searchBudgets(state, { query: '디지털 간행물', year: 2026 }).total, 1);
  assert.equal(searchBudgets(state, { query: '시연통계', year: 2026 }).total, 1);
  assert.equal(searchBudgets(state, { query: '간행물', includeInactive: true }).total, 2);
  assert.equal(searchBudgets(state, { year: 2025 }).total, 0);
  assert.equal(searchBudgets(state, {}).items.length, 20);
  assert.equal(searchBudgets(state, { page: 2 }).items.length, 5);
});

test('catalog maintenance is admin-only, preserves source validation separately, and import merges atomically', () => {
  const state = initial(); state.budgetCatalog!.validation = { allHierarchySubtotalsMatch: true };
  const before = JSON.stringify(state);
  rejects('BUDGET_ADMIN_REQUIRED', () => dispatch(state, 'u-support-member', 'budget.upsert', { item }));
  rejects('BUDGET_ADMIN_REQUIRED', () => dispatch(state, 'u-support-head', 'budget.setActive', { id: item.id, active: false }));
  assert.equal(JSON.stringify(state), before);
  const requestId = randomUUID(); const updated = { ...item, confirmedAmountWon: 6_000_000 };
  dispatch(state, 'u-admin', 'budget.upsert', { item: updated }, requestId);
  dispatch(state, 'u-admin', 'budget.upsert', { item: updated }, requestId);
  assert.equal(state.budgetCatalog!.items.length, 1); assert.equal(state.audit.filter(event => event.action === 'budget.upsert').length, 1);
  assert.equal(state.budgetCatalog!.items[0].sourceAmount, '5');
  assert.equal(state.budgetCatalog!.items[0].updatedBy, 'u-admin');
  assert.equal((state.budgetCatalog!.sourceValidation as { appliesToCurrentItems: boolean }).appliesToCurrentItems, false);
  assert.equal((state.budgetCatalog!.validation as { totalConfirmedAmountWon: number }).totalConfirmedAmountWon, 6_000_000);
  assert.equal((state.budgetCatalog!.validation as { allHierarchySubtotalsMatch?: boolean }).allHierarchySubtotalsMatch, undefined);
  const invalidBefore = JSON.stringify(state);
  rejects('BUDGET_DUPLICATE_ID', () => dispatch(state, 'u-admin', 'budget.import', { catalog: { ...fixture(), items: [item, item] } }));
  rejects('BUDGET_INVALID_INPUT', () => dispatch(state, 'u-admin', 'budget.upsert', { item: { ...item, confirmedAmountWon: 0.5 } }));
  assert.equal(JSON.stringify(state), invalidBefore);
  dispatch(state, 'u-admin', 'budget.import', { catalog: { ...fixture(), items: [{ ...item, id: 'new', projectName: '새 사업' }] } });
  assert.equal(state.budgetCatalog!.items.length, 2); assert.equal(state.budgetCatalog!.items.find(row => row.id === item.id)!.confirmedAmountWon, 6_000_000);
  dispatch(state, 'u-admin', 'budget.setActive', { id: item.id, active: false });
  assert.equal(searchBudgets(state, { query: '간행물' }).total, 0);
  assert.equal(searchBudgets(state, { query: '간행물', includeInactive: true }).total, 1);
});

test('task budget selection resolves authoritative amount and preserves its snapshot across catalog changes and ordinary saves', () => {
  const state = initial();
  dispatch(state, 'u-support-member', 'task.configure', { taskId: 'task-data', budgetMode: 'catalog', budgetItemId: item.id, budget: 1 });
  const assigned = taskOf(state); assert.equal(assigned.budget, 5_000_000); assert.deepEqual(assigned.budgetAllocation, item);
  assert.equal('budgetItemId' in assigned, false);
  dispatch(state, 'u-admin', 'budget.upsert', { item: { ...item, confirmedAmountWon: 8_000_000, projectName: '수정한 사업' } });
  dispatch(state, 'u-support-member', 'task.configure', { taskId: assigned.id, description: '설명만 수정합니다.', budgetMode: 'catalog', budget: 5_000_000 });
  assert.equal(taskOf(state).budget, 5_000_000); assert.equal(taskOf(state).budgetAllocation!.projectName, item.projectName);
  rejects('BUDGET_SNAPSHOT_LOCKED', () => dispatch(state, 'u-support-member', 'task.configure', { taskId: assigned.id, budget: 1 }));
  dispatch(state, 'u-support-member', 'task.configure', { taskId: assigned.id, budgetMode: 'catalog', budgetItemId: item.id, budget: 5_000_000 });
  assert.equal(taskOf(state).budget, 8_000_000);
  assert.ok(taskOf(state).versions.some(version => version.budget === 5_000_000 && version.budgetAllocation?.projectName === item.projectName));
  dispatch(state, 'u-admin', 'budget.setActive', { id: item.id, active: false });
  dispatch(state, 'u-support-member', 'task.configure', { taskId: assigned.id, description: '비활성 예산도 기존 연결은 보존합니다.' });
  rejects('BUDGET_SELECTION_INVALID', () => dispatch(state, 'u-support-member', 'task.configure', { taskId: assigned.id, budgetItemId: item.id }));
});

test('non-budget tasks cannot silently discard paid expenses, and record edits retain timestamps, vendor and safe over-budget amounts', () => {
  const state = initial(); const legacy = { id: 'legacy', date: '2026-11-06', description: '이전 집행 기록', amount: 1000 };
  dispatch(state, 'u-support-member', 'task.configure', { taskId: 'task-data', budget: 500, expenses: [legacy] });
  rejects('NON_BUDGET_EXPENSE_CONFLICT', () => dispatch(state, 'u-support-member', 'task.configure', { taskId: 'task-data', budgetMode: 'none', budget: 0 }));
  assert.equal(taskOf(state).expenses?.[0].amount, 1000);
  const enriched = { id: 'current', date: '2026-11-06', time: '14:30', projectName: '시연 인쇄 사업', vendor: '시연 업체', description: '검수 후 인쇄비 지급', amount: 2000 };
  dispatch(state, 'u-support-member', 'task.record', { taskId: 'task-data', expenses: [legacy, enriched] });
  assert.deepEqual(taskOf(state).expenses?.[1], enriched);
  assert.equal(taskOf(state).budget! - taskOf(state).expenses!.reduce((sum, expense) => sum + expense.amount, 0), -2500);
  assert.deepEqual(taskOf(state).recordHistory?.at(-1)?.expensesAfter[1], enriched);
  rejects('VALIDATION_ERROR', () => dispatch(state, 'u-support-member', 'task.record', { taskId: 'task-data', expenses: [{ ...enriched, time: '25:00' }] }));
  rejects('VALIDATION_ERROR', () => dispatch(state, 'u-support-member', 'task.record', { taskId: 'task-data', expenses: [{ ...enriched, amount: 0.1 }] }));
  rejects('BUDGET_TOTAL_TOO_LARGE', () => dispatch(state, 'u-support-member', 'task.record', { taskId: 'task-data', expenses: [{ ...legacy, amount: Number.MAX_SAFE_INTEGER }, { ...enriched, amount: 1 }] }));
  dispatch(state, 'u-support-member', 'task.configure', { taskId: 'task-data', budgetMode: 'none', budget: 0, expenses: [] });
  assert.equal(taskOf(state).budgetMode, 'none'); assert.equal(taskOf(state).budget, 0); assert.equal(taskOf(state).budgetAllocation, undefined);
  rejects('NON_BUDGET_EXPENSE_CONFLICT', () => dispatch(state, 'u-support-member', 'task.record', { taskId: 'task-data', expenses: [enriched] }));
});

test('new tasks, definition snapshots, division snapshots and delegation fingerprints include budget identity', () => {
  const state = initial();
  dispatch(state, 'u-support-member', 'task.create', { title: '예산 연결 시연 업무', description: '정해진 예산에 연결합니다.', unitId: 'unit-data', primaryId: 'u-support-member', supportIds: [], dueDate: '2026-12-31', frequency: 'once', budgetMode: 'catalog', budgetItemId: item.id, budget: 0 });
  const task = state.tasks[0]; assert.equal(task.budget, 5_000_000); assert.equal(task.budgetAllocation?.id, item.id);
  const version = snapshot(task); assert.deepEqual(version.budgetAllocation, task.budgetAllocation);
  version.budgetAllocation!.projectName = '스냅샷 복사'; assert.equal(task.budgetAllocation?.projectName, item.projectName);
  const division = workDivisionSnapshot(state, task.departmentId);
  assert.equal(division.tasks.find(row => row.id === task.id)?.budgetAllocation?.id, item.id);
  assert.notEqual(delegationTaskFingerprint(task), delegationTaskFingerprint({ ...task, budgetAllocation: { ...item, id: 'other' } }));
  rejects('BUDGET_INVALID_INPUT', () => parseBudgetCatalog({ ...fixture(), items: [{ ...item, confirmedAmountWon: -1 }] }));
});

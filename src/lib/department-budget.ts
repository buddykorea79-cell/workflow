import { activeUser, DomainError } from './domain';
import { getBudgetCatalog } from './budget-catalog';
import { commonPublished } from './common-approval';
import type { BudgetCatalogItem } from './budget-types';
import type { BudgetTotals, DepartmentBudgetSummary, DepartmentBudgetUnit } from './department-budget-types';
import type { Task, WorkspaceData } from './types';

const emptyTotals = (): BudgetTotals => ({ budget: 0, spent: 0, balance: 0, taskCount: 0, projectCount: 0, expenseCount: 0 });
const yearAt = (now: Date) => Number(new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'Asia/Seoul' }).format(now));
const expenseYear = (date: string) => Number(date.slice(0, 4));
const projectKey = (item: BudgetCatalogItem) => JSON.stringify([item.year, item.id]);
const unitKey = (item: BudgetCatalogItem) => JSON.stringify([item.year, item.accountCode, item.account, item.fieldCode, item.field, item.sectorCode, item.sector, item.programCode, item.program, item.unitProjectCode, item.unitProject || '단위사업 미지정']);
function addMoney(left: number, right: number): number {
  if (!Number.isSafeInteger(right) || right < 0 || !Number.isSafeInteger(left + right)) {
    throw new DomainError(422, 'DEPARTMENT_BUDGET_AMOUNT_RANGE', '예산 또는 집행 합계가 계산 가능한 정수 금액 범위를 벗어났습니다.');
  }
  return left + right;
}
function combineTotals(target: BudgetTotals, row: Omit<BudgetTotals, 'projectCount'> & { projectCount?: number }) {
  target.budget = addMoney(target.budget, row.budget);
  target.spent = addMoney(target.spent, row.spent);
  target.balance = target.budget - target.spent;
  target.taskCount += row.taskCount;
  target.expenseCount += row.expenseCount;
  target.projectCount += row.projectCount ?? 1;
}
function isIncluded(state: WorkspaceData, task: Task, unitIds: Set<string>): boolean {
  if (task.deletedAt || !unitIds.has(task.unitId)) return false;
  if (!task.commonId) return true;
  const common = state.commonTasks.find(item => item.id === task.commonId);
  return !!common && commonPublished(common) && common.distributions.some(distribution => distribution.taskId === task.id && distribution.departmentId === task.departmentId && ['registered', 'assigned', 'submitted'].includes(distribution.status));
}

/** Aggregate at the server boundary without granting access to task bodies or individual expenses. */
export function departmentBudgetForUser(state: WorkspaceData, userId: string, input: { departmentId?: string; year?: number } = {}, now = new Date()): DepartmentBudgetSummary {
  const user = activeUser(state, userId, now);
  if (!['manager', 'head', 'admin'].includes(user.role)) throw new DomainError(403, 'DEPARTMENT_BUDGET_REQUIRED', '부서 담당자, 부서장 또는 관리자만 부서 예산을 집계할 수 있습니다.');
  const departmentId = input.departmentId ?? user.departmentId;
  if (user.role !== 'admin' && departmentId !== user.departmentId) throw new DomainError(403, 'DEPARTMENT_BUDGET_SCOPE', '소속 부서의 예산만 조회할 수 있습니다.');
  const department = state.departments.find(item => item.id === departmentId);
  if (!department) throw new DomainError(404, 'DEPARTMENT_NOT_FOUND', '조회할 부서를 찾을 수 없습니다.');
  const currentYear = yearAt(now); const year = input.year ?? currentYear;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new DomainError(422, 'DEPARTMENT_BUDGET_YEAR', '집계할 회계연도를 확인해 주세요.');
  const unitIds = new Set(state.units.filter(unit => unit.departmentId === departmentId && !unit.deletedAt).map(unit => unit.id));
  const departmentTasks = state.tasks.filter(task => task.departmentId === departmentId);
  const tasks = departmentTasks.filter(task => isIncluded(state, task, unitIds));
  const summary: DepartmentBudgetSummary = {
    department: { id: department.id, name: department.name, shortName: department.shortName }, year, years: [], generatedAt: now.toISOString(), revision: state.revision,
    groups: [], totals: emptyTotals(), manual: { budget: 0, spent: 0, balance: 0, taskCount: 0, expenseCount: 0 },
    nonBudgetTaskCount: 0, otherBudgetYear: { spent: 0, expenseCount: 0, taskCount: 0 }, ignoredOtherYearExpenseCount: 0, excludedTaskCount: departmentTasks.length - tasks.length,
  };
  const years = new Set([currentYear, year]);
  const linked = new Map<string, Task[]>();
  for (const task of tasks) {
    const expenses = task.expenses ?? [];
    for (const expense of expenses) { const value = expenseYear(expense.date); if (Number.isInteger(value) && value >= 2000 && value <= 2100) years.add(value); }
    const selected = expenses.filter(expense => expenseYear(expense.date) === year);
    summary.ignoredOtherYearExpenseCount += expenses.length - selected.length;
    if (task.budgetMode === 'none') { summary.nonBudgetTaskCount++; continue; }
    const allocation = task.budgetMode !== 'manual' ? task.budgetAllocation : undefined;
    if (allocation) {
      years.add(allocation.year);
      if (allocation.year !== year) {
        if (selected.length) { summary.otherBudgetYear.taskCount++; summary.otherBudgetYear.expenseCount += selected.length; for (const expense of selected) summary.otherBudgetYear.spent = addMoney(summary.otherBudgetYear.spent, expense.amount); }
        continue;
      }
      const key = projectKey(allocation);
      linked.set(key, [...(linked.get(key) ?? []), task]);
    } else {
      summary.manual.taskCount++; summary.manual.budget = addMoney(summary.manual.budget, task.budget ?? 0);
      summary.manual.expenseCount += selected.length;
      for (const expense of selected) summary.manual.spent = addMoney(summary.manual.spent, expense.amount);
    }
  }
  const catalog = new Map(getBudgetCatalog(state).items.map(item => [projectKey(item), item]));
  const groups = new Map<string, DepartmentBudgetUnit>();
  for (const [key, linkedTasks] of linked) {
    // If a source item was removed, use the most recently saved task snapshot deterministically.
    const latestTask = [...linkedTasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0];
    const current = catalog.get(key); const item = current ?? latestTask.budgetAllocation!;
    const groupId = unitKey(item);
    let group = groups.get(groupId);
    if (!group) {
      group = { id: groupId, account: item.account, field: item.field, sector: item.sector, program: item.program, unitProject: item.unitProject || '단위사업 미지정', projects: [], totals: emptyTotals() };
      groups.set(groupId, group);
    }
    const expenses = linkedTasks.flatMap(task => (task.expenses ?? []).filter(expense => expenseYear(expense.date) === year));
    const budget = addMoney(0, item.confirmedAmountWon); const spent = expenses.reduce((total, expense) => addMoney(total, expense.amount), 0);
    const project = {
      id: item.id, year: item.year, projectName: item.projectName, ...(item.projectCode ? { projectCode: item.projectCode } : {}), budget, spent, balance: budget - spent, taskCount: linkedTasks.length, expenseCount: expenses.length,
      amountSource: current ? 'catalog' as const : 'snapshot' as const,
      changedSnapshotCount: linkedTasks.filter(task => task.budgetAllocation!.confirmedAmountWon !== budget || unitKey(task.budgetAllocation!) !== groupId || task.budgetAllocation!.projectName !== item.projectName).length,
    };
    group.projects.push(project); combineTotals(group.totals, project);
  }
  summary.groups = [...groups.values()].sort((a, b) => [a.account, a.field, a.sector, a.program, a.unitProject].join('\0').localeCompare([b.account, b.field, b.sector, b.program, b.unitProject].join('\0'), 'ko'));
  for (const group of summary.groups) {
    group.projects.sort((a, b) => a.projectName.localeCompare(b.projectName, 'ko') || a.id.localeCompare(b.id));
    combineTotals(summary.totals, group.totals);
  }
  summary.manual.balance = summary.manual.budget - summary.manual.spent;
  summary.years = [...years].sort((a, b) => b - a);
  return summary;
}

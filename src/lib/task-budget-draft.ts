import type { BudgetCatalogItem } from './budget-types';
import type { Expense, Task } from './types';

export const maximumTaskBudgetAmount = 1_000_000_000_000_000;
export type TaskBudgetDraft = { mode: 'manual' | 'catalog' | 'none'; amount: string; allocation?: BudgetCatalogItem; selectedItemId?: string | null };
export function taskBudgetDraft(task?: Pick<Task, 'budget' | 'budgetMode' | 'budgetAllocation'>): TaskBudgetDraft {
  return { mode: task?.budgetMode ?? (task?.budgetAllocation ? 'catalog' : 'manual'), amount: String(task?.budget ?? 0), ...(task?.budgetAllocation ? { allocation: structuredClone(task.budgetAllocation) } : {}) };
}
export function taskBudgetPayload(draft: TaskBudgetDraft) {
  return { budget: draft.mode === 'none' ? 0 : Number(draft.amount), budgetMode: draft.mode, ...(draft.selectedItemId !== undefined ? { budgetItemId: draft.selectedItemId } : {}) };
}
export function taskBudgetIssue(draft: TaskBudgetDraft, expenses: Expense[] = []) {
  const amount = Number(draft.amount);
  if (!draft.amount.trim() || !Number.isSafeInteger(amount) || amount < 0 || amount > maximumTaskBudgetAmount) return '사업 예산은 0 이상 1,000조 원 이하의 정수로 입력해 주세요.';
  if (draft.mode === 'catalog' && !draft.allocation) return '검색 결과에서 연결할 확정 예산을 선택해 주세요.';
  if (draft.mode === 'none' && expenses.some(item => item.amount > 0)) return '집행 금액이 있는 업무는 비예산으로 변경할 수 없습니다. 기존 집행 기록을 확인해 주세요.';
  return '';
}
export function taskExpenseIssue(expenses: Expense[], previous: Expense[] = []) {
  const previousById = new Map(previous.map(item => [item.id, item]));
  if (new Set(expenses.map(item => item.id)).size !== expenses.length) return '집행 내역이 중복되었습니다. 내용을 확인해 주세요.';
  let sum = 0;
  for (const item of expenses) {
    if (!item.date || !item.description.trim() || !Number.isSafeInteger(item.amount) || item.amount < 0 || item.amount > maximumTaskBudgetAmount) return '집행일, 집행 내용과 0 이상 1,000조 원 이하의 정수 금액을 입력해 주세요.';
    const original = previousById.get(item.id);
    for (const field of ['projectName', 'vendor'] as const) {
      if ((!original || original[field]?.trim()) && !item[field]?.trim()) return '사업명과 사업자를 입력해 주세요. 기존 자료에 없던 항목은 보완할 수 있습니다.';
    }
    sum += item.amount;
    if (!Number.isSafeInteger(sum)) return '집행 합계가 계산 가능한 범위를 초과했습니다. 입력 금액을 확인해 주세요.';
  }
  return '';
}

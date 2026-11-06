import type { Department } from './types';

export interface BudgetTotals {
  budget: number;
  spent: number;
  balance: number;
  taskCount: number;
  projectCount: number;
  expenseCount: number;
}

export interface DepartmentBudgetProject {
  id: string;
  year: number;
  projectName: string;
  projectCode?: string;
  budget: number;
  spent: number;
  balance: number;
  taskCount: number;
  expenseCount: number;
  amountSource: 'catalog' | 'snapshot';
  changedSnapshotCount: number;
}

export interface DepartmentBudgetUnit {
  id: string;
  account: string;
  field: string;
  sector: string;
  program: string;
  unitProject: string;
  projects: DepartmentBudgetProject[];
  totals: BudgetTotals;
}

export interface DepartmentBudgetSummary {
  department: Department;
  year: number;
  years: number[];
  generatedAt: string;
  revision: number;
  groups: DepartmentBudgetUnit[];
  totals: BudgetTotals;
  /** Manual budget amounts have no fiscal year; only spent is filtered by year. */
  manual: { budget: number; spent: number; balance: number; taskCount: number; expenseCount: number };
  nonBudgetTaskCount: number;
  /** Selected-year expenditure attached to a budget from another fiscal year. */
  otherBudgetYear: { spent: number; expenseCount: number; taskCount: number };
  ignoredOtherYearExpenseCount: number;
  excludedTaskCount: number;
}

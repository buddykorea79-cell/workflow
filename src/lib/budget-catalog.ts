import { z } from 'zod';
import { parseInput } from './validation';
import initialCatalog from '../../data/budgets/2026-budget.json';
import { DomainError } from './domain';
import type { BudgetCatalog, BudgetCatalogItem, BudgetMode, BudgetSearchResult } from './budget-types';
import type { Task, User, WorkspaceData } from './types';

const name = z.string().trim().min(1).max(300);
const code = z.string().trim().max(100);
const won = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const year = z.number().int().min(2000).max(2100);
export const budgetItemSchema = z.object({
  id: z.string().trim().min(1).max(200), year,
  account: name, field: name, sector: name, program: name, projectName: name,
  unitProject: z.string().trim().max(300).optional(), accountCode: code.optional(), fieldCode: code.optional(),
  sectorCode: code.optional(), programCode: code.optional(), unitProjectCode: code.optional(), projectCode: code.optional(),
  confirmedAmountWon: won, sourceAmount: z.union([z.string().max(100), z.number().finite()]).optional(),
  sourceUnit: z.string().max(100).optional(), sourcePage: z.number().int().min(1).max(100_000).optional(),
  sourcePrintedPage: z.union([z.string().max(100), z.number().int()]).optional(), active: z.boolean().optional(),
  sourceFileName: z.string().max(300).optional(), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  updatedAt: z.string().max(100).optional(), updatedBy: z.string().max(200).optional(),
}).passthrough();
const catalogSchema = z.object({
  schemaVersion: z.literal(1), year,
  source: z.object({ fileName: name, sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional() }).passthrough(),
  items: z.array(budgetItemSchema).min(1).max(5000),
}).passthrough();

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  return parseInput(schema, value, { code: 'BUDGET_INVALID_INPUT' });
}

export function parseBudgetCatalog(value: unknown): BudgetCatalog {
  const catalog = parse(catalogSchema, value) as BudgetCatalog;
  if (new Set(catalog.items.map(item => item.id)).size !== catalog.items.length) throw new DomainError(422, 'BUDGET_DUPLICATE_ID', '예산 자료에 같은 ID가 두 번 이상 포함되어 있습니다.');
  if (!Number.isSafeInteger(catalog.items.reduce((total, item) => total + item.confirmedAmountWon, 0))) throw new DomainError(422, 'BUDGET_TOTAL_TOO_LARGE', '예산 자료의 합계가 계산 가능한 금액 범위를 초과합니다.');
  catalog.items = catalog.items.map(item => ({ ...item, sourceFileName: item.sourceFileName ?? catalog.source.fileName, ...(item.sourceSha256 || catalog.source.sha256 ? { sourceSha256: item.sourceSha256 ?? catalog.source.sha256 } : {}) }));
  return catalog;
}

let bundledCatalog: BudgetCatalog | undefined;
/** The packaged source is the initial catalog; editing persists an independent DB/local copy. */
export function getBudgetCatalog(state: Pick<WorkspaceData, 'budgetCatalog'>): BudgetCatalog {
  if (state.budgetCatalog) return state.budgetCatalog;
  bundledCatalog ??= parseBudgetCatalog(initialCatalog);
  return bundledCatalog;
}

const searchable = (value: string) => value.normalize('NFKC').toLocaleLowerCase('ko-KR').replace(/\s+/g, '');
export function searchBudgets(state: WorkspaceData, input: { query?: string; year?: number; page?: number; includeInactive?: boolean }): BudgetSearchResult {
  const catalog = getBudgetCatalog(state);
  const tokens = (input.query ?? '').trim().split(/\s+/).filter(Boolean).map(searchable);
  const available = catalog.items.filter(item => input.includeInactive || item.active !== false);
  const filtered = available.filter(item => (!input.year || item.year === input.year) && tokens.every(token => searchable([item.account, item.field, item.sector, item.program, item.unitProject, item.projectName, item.projectCode, item.programCode].filter(Boolean).join(' ')).includes(token)));
  const page = input.page ?? 1; const pageSize = 20;
  return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize, source: catalog.source, years: [...new Set(available.map(item => item.year))].sort((a, b) => b - a), revision: state.revision, catalogRev: catalog.rev ?? 0 };
}

export function executeBudgetCommand(state: WorkspaceData, user: User, type: string, payload: Record<string, unknown>, now: Date) {
  if (user.role !== 'admin') throw new DomainError(403, 'BUDGET_ADMIN_REQUIRED', '예산 기준 자료는 관리자만 변경할 수 있습니다.');
  const catalog = getBudgetCatalog(state);
  let next: BudgetCatalog; let targetId: string; let title: string; let detail: string;
  if (type === 'budget.upsert') {
    const input = parse(z.object({ item: budgetItemSchema }).strict(), payload);
    const item = { ...input.item, updatedAt: now.toISOString(), updatedBy: user.id } as BudgetCatalogItem;
    const exists = catalog.items.some(existing => existing.id === item.id);
    if (!exists && catalog.items.length >= 5000) throw new DomainError(422, 'BUDGET_CATALOG_LIMIT', '예산 기준 자료는 5,000건까지 관리할 수 있습니다.');
    next = { ...catalog, items: exists ? catalog.items.map(existing => existing.id === item.id ? item : existing) : [...catalog.items, item] };
    targetId = item.id; title = exists ? '예산 기준 자료 수정' : '예산 기준 자료 추가'; detail = `${item.year} · ${item.projectName} · ${item.confirmedAmountWon.toLocaleString('ko-KR')}원`;
  } else if (type === 'budget.setActive') {
    const input = parse(z.object({ id: name.max(200), active: z.boolean() }).strict(), payload);
    const current = catalog.items.find(item => item.id === input.id);
    if (!current) throw new DomainError(404, 'BUDGET_NOT_FOUND', '변경할 예산 항목을 찾을 수 없습니다.');
    next = { ...catalog, items: catalog.items.map(item => item.id === input.id ? { ...item, active: input.active, updatedAt: now.toISOString(), updatedBy: user.id } : item) };
    targetId = input.id; title = input.active ? '예산 기준 자료 사용 재개' : '예산 기준 자료 사용 중지'; detail = current.projectName;
  } else if (type === 'budget.import') {
    const input = parse(z.object({ catalog: z.unknown() }).strict(), payload);
    const imported = parseBudgetCatalog(input.catalog);
    const incoming = new Map(imported.items.map(item => [item.id, { ...item, updatedAt: now.toISOString(), updatedBy: user.id }]));
    const combined = catalog.items.map(item => incoming.get(item.id) ?? item);
    const existingIds = new Set(catalog.items.map(item => item.id));
    combined.push(...imported.items.filter(item => !existingIds.has(item.id)).map(item => incoming.get(item.id)!));
    if (combined.length > 5000) throw new DomainError(422, 'BUDGET_CATALOG_LIMIT', '병합 결과가 5,000건을 초과합니다.');
    next = { ...catalog, ...imported, items: combined };
    targetId = String(imported.year); title = '예산 JSON 가져오기'; detail = `${imported.items.length}건 추가·갱신 · 미포함 항목과 기존 업무 연결 유지`;
  } else throw new DomainError(422, 'BUDGET_INVALID_COMMAND', '지원하지 않는 예산 관리 요청입니다.');
  const totalConfirmedAmountWon = next.items.reduce((sum, item) => sum + item.confirmedAmountWon, 0);
  if (!Number.isSafeInteger(totalConfirmedAmountWon)) throw new DomainError(422, 'BUDGET_TOTAL_TOO_LARGE', '예산 자료의 합계가 계산 가능한 금액 범위를 초과합니다.');
  const previousValidation = next.validation as { scope?: string } | undefined;
  const sourceValidation = previousValidation && previousValidation.scope !== 'managed-catalog' ? { ...previousValidation, scope: 'original-source-extraction', appliesToCurrentItems: false } : next.sourceValidation;
  state.budgetCatalog = structuredClone({ ...next, ...(sourceValidation ? { sourceValidation } : {}), validation: { scope: 'managed-catalog', appliesToCurrentItems: true, itemCount: next.items.length, totalConfirmedAmountWon, validatedAt: now.toISOString() } });
  return { targetId, title, detail, departmentId: user.departmentId };
}

type BudgetInput = { budget?: number; budgetMode?: BudgetMode; budgetItemId?: string | null };
/** A task owns a snapshot. Catalog maintenance never silently changes an assigned budget. */
export function resolveTaskBudget(state: WorkspaceData, existing: Task | undefined, input: BudgetInput): Pick<Task, 'budget' | 'budgetMode' | 'budgetAllocation'> {
  const mode = input.budgetMode ?? existing?.budgetMode ?? (input.budgetItemId ? 'catalog' : 'manual');
  if (mode === 'none') {
    if (input.budgetItemId) throw new DomainError(422, 'NON_BUDGET_CONFLICT', '비예산 업무에는 예산 사업을 연결할 수 없습니다.');
    return { budgetMode: 'none', budget: 0, budgetAllocation: undefined };
  }
  if (mode === 'manual') {
    if (input.budgetItemId) throw new DomainError(422, 'BUDGET_MODE_CONFLICT', '예산 자료를 선택할 때는 검색 예산 모드를 사용해 주세요.');
    return { budgetMode: 'manual', budget: input.budget ?? existing?.budget ?? 0, budgetAllocation: undefined };
  }
  if (input.budgetItemId === null) throw new DomainError(422, 'BUDGET_SELECTION_REQUIRED', '예산 자료를 선택하거나 직접 입력·비예산으로 변경해 주세요.');
  if (input.budgetItemId) {
    const item = getBudgetCatalog(state).items.find(item => item.id === input.budgetItemId && item.active !== false);
    if (!item) throw new DomainError(422, 'BUDGET_SELECTION_INVALID', '현재 사용할 수 있는 예산 사업을 검색해서 선택해 주세요.');
    return { budgetMode: 'catalog', budget: item.confirmedAmountWon, budgetAllocation: structuredClone(item) };
  }
  if (existing?.budgetMode !== 'catalog' || !existing.budgetAllocation) throw new DomainError(422, 'BUDGET_SELECTION_REQUIRED', '확정 예산을 검색해서 선택해 주세요.');
  if (input.budget !== undefined && input.budget !== existing.budget) throw new DomainError(422, 'BUDGET_SNAPSHOT_LOCKED', '연결한 확정 예산은 검색 결과에서 다시 적용하거나 직접 입력 모드로 변경해 주세요.');
  return { budgetMode: 'catalog', budget: existing.budget, budgetAllocation: existing.budgetAllocation };
}

export function validateTaskMoney(task: Pick<Task, 'budget' | 'budgetMode' | 'expenses'>) {
  const amounts = [task.budget ?? 0, ...(task.expenses ?? []).map(expense => expense.amount)];
  if (amounts.some(amount => !Number.isSafeInteger(amount) || amount < 0)) throw new DomainError(422, 'BUDGET_INVALID_AMOUNT', '예산과 집행 금액은 안전한 범위의 0 이상 정수(원)로 입력해 주세요.');
  if (!Number.isSafeInteger((task.expenses ?? []).reduce((total, expense) => total + expense.amount, 0))) throw new DomainError(422, 'BUDGET_TOTAL_TOO_LARGE', '집행 합계가 계산 가능한 금액 범위를 초과합니다.');
  if (task.budgetMode === 'none' && (task.budget !== 0 || task.expenses?.some(expense => expense.amount > 0))) throw new DomainError(422, 'NON_BUDGET_EXPENSE_CONFLICT', '금액이 있는 집행 기록을 유지한 채 비예산으로 변경할 수 없습니다. 예산 구분과 집행 기록을 확인해 주세요.');
}

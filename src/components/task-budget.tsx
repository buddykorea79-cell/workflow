'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronLeft, ChevronRight, Search, Plus, Trash2, Wallet, X } from 'lucide-react';
import type { BudgetCatalogItem } from '@/lib/budget-types';
import type { Expense } from '@/lib/types';
import { maximumTaskBudgetAmount as maximumAmount, type TaskBudgetDraft } from '@/lib/task-budget-draft';
export { taskBudgetDraft, taskBudgetPayload, taskBudgetIssue, taskExpenseIssue, type TaskBudgetDraft } from '@/lib/task-budget-draft';
import { Badge, Button, Field, ReadField } from './ui';
import './task-budget.css';

const money = (value: number) => new Intl.NumberFormat('ko-KR').format(value);

function BudgetDescription({ item }: { item: BudgetCatalogItem }) {
  return <div className="tb-budget-description"><div className="tb-budget-tags"><Badge tone="info">{item.year}년 확정</Badge><span>{item.account}</span>{item.projectCode && <span>{item.projectCode}</span>}</div><h4>{item.projectName}</h4><dl className="tb-budget-path"><div><dt>분야</dt><dd>{item.field}</dd></div><div><dt>부문</dt><dd>{item.sector}</dd></div><div><dt>프로그램</dt><dd>{item.program}</dd></div>{item.unitProject && <div><dt>단위사업</dt><dd>{item.unitProject}</dd></div>}</dl>{(item.sourcePage ?? 0) > 0 && <p className="tb-source">출처 {typeof item.sourceFileName === 'string' ? item.sourceFileName : 'PDF'} · {item.sourcePage}쪽{item.sourcePrintedPage ? ` · 인쇄 ${item.sourcePrintedPage}쪽` : ''}</p>}</div>;
}

type SearchResult = { items: BudgetCatalogItem[]; total: number; page: number; pageSize: number; years: number[] };
export function TaskBudgetFields({ value, onChange, disabled = false, hasExpenses = false }: { value: TaskBudgetDraft; onChange: (value: TaskBudgetDraft) => void; disabled?: boolean; hasExpenses?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [year, setYear] = useState(value.allocation?.year ?? 2026);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [submittedSearch, setSubmittedSearch] = useState({ query: '', year: value.allocation?.year ?? 2026 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const previousBudget = useRef<TaskBudgetDraft | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (disabled || value.mode === 'none') { controller.current?.abort(); setLoading(false); setOpen(false); } }, [disabled, value.mode]);
  async function search(page = 1, searchYear = year, searchQuery = query) {
    controller.current?.abort(); const request = new AbortController(); controller.current = request;
    setLoading(true); setError(''); setResult(null);
    try {
      const response = await fetch(`/api/budgets?${new URLSearchParams({ query: searchQuery.trim(), year: String(searchYear), page: String(page) })}`, { cache: 'no-store', signal: request.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '예산 목록을 불러오지 못했습니다.');
      if (!request.signal.aborted) { setResult(body); setSubmittedSearch({ query: searchQuery.trim(), year: searchYear }); }
    } catch (reason) { if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : '예산 검색에 실패했습니다. 다시 시도해 주세요.'); }
    finally { if (!request.signal.aborted) setLoading(false); }
  }
  const choose = (item: BudgetCatalogItem) => { onChange({ mode: 'catalog', amount: String(item.confirmedAmountWon), allocation: item, selectedItemId: item.id }); setOpen(false); };
  const amount = Number(value.amount);
  return <section className="tb-budget-fields" aria-label="업무 예산 설정">
    <div className="tb-budget-heading"><div><h3>업무 예산</h3><p>확정 예산을 검색해 연결하거나 금액을 직접 입력합니다.</p></div>{disabled ? <ReadField label="예산 구분" value={value.mode === 'none' ? '비예산 사업' : value.mode === 'catalog' ? '확정 예산 연결' : '직접 입력'} /> : <label className="tb-non-budget"><input type="checkbox" checked={value.mode === 'none'} disabled={disabled || value.mode !== 'none' && hasExpenses} onChange={event => { if (event.target.checked) { previousBudget.current = value; onChange({ mode: 'none', amount: '0', selectedItemId: null }); } else { const previous = previousBudget.current; onChange(previous?.mode === 'catalog' && previous.allocation ? { ...previous, selectedItemId: previous.allocation.id } : previous ?? { mode: 'manual', amount: '0', selectedItemId: null }); } }}/><span>비예산 사업</span></label>}</div>
    {hasExpenses && !disabled && <p className="tb-note">집행 금액이 있는 업무는 비예산으로 변경할 수 없습니다.</p>}
    {value.mode === 'none' ? <div className="tb-non-budget-info"><Wallet size={22}/><div><strong>비예산 사업입니다.</strong><p>사업 예산과 집행잔액을 관리하지 않습니다.</p></div></div> : <>
      <div className="tb-budget-amount">
        {disabled || value.mode === 'catalog' ? <ReadField label={value.mode === 'catalog' ? `${value.allocation?.year ?? 2026}년도 확정 예산 (원)` : '사업 예산 (원)'} value={value.amount.trim() && Number.isSafeInteger(amount) ? money(amount) : value.amount} /> : <Field label="사업 예산 (원)"><input type="number" min="0" max={maximumAmount} step="1" required value={value.amount} onChange={event => onChange({ ...value, amount: event.target.value })}/></Field>}
        {!disabled && value.mode === 'manual' && <span>{Number.isSafeInteger(amount) && amount >= 0 ? `${money(amount)}원` : '정수 금액을 입력해 주세요.'}</span>}
        {!disabled && <Button data-task-action={!open} variant="secondary" onClick={() => { const next = !open; setOpen(next); if (next) void search(); else controller.current?.abort(); }}><Search size={17}/>{open ? '검색 닫기' : '확정 예산 검색'}</Button>}
      </div>
      {value.allocation && value.mode === 'catalog' && <div className="tb-selected-budget"><BudgetDescription item={value.allocation}/>{!disabled && <Button data-task-action="true" variant="ghost" onClick={() => onChange({ mode: 'manual', amount: value.amount, selectedItemId: null })}>직접 입력으로 변경</Button>}<p className="tb-note">선택한 세부사업의 전체 확정액입니다. 업무 저장 시 연결되며, 관리자 수정은 기존 업무에 자동 반영되지 않습니다.</p></div>}
      {open && !disabled && <div className="tb-catalog-search">
        <div className="tb-search-heading"><strong>확정 예산 검색</strong><button type="button" aria-label="예산 검색 닫기" className="pw-icon-button" onClick={() => { controller.current?.abort(); setOpen(false); setLoading(false); }}><X size={17}/></button></div>
        <div className="tb-search-form"><Field label="예산 연도"><select value={year} disabled={loading} onChange={event => { const next = Number(event.target.value); setYear(next); void search(1, next); }}>{[...new Set([2026, year, ...(result?.years ?? [])])].sort((a, b) => b - a).map(value => <option key={value} value={value}>{value}년</option>)}</select></Field><Field label="예산 키워드"><input value={query} maxLength={100} placeholder="분야, 부문, 프로그램, 세부사업명" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(); } }}/></Field><Button onClick={() => void search()} disabled={loading}><Search size={16}/>{loading ? '검색 중…' : '검색'}</Button></div>
        {error && <p className="tb-error" role="alert"><AlertCircle size={17}/>{error}</p>}
        {loading && <p className="tb-note" role="status">예산 목록을 불러오고 있습니다.</p>}
        {result && <><p className="tb-result-count" role="status">검색 결과 {money(result.total)}건</p><div className="tb-search-results">{result.items.map(item => <article className="tb-search-item" key={item.id}><BudgetDescription item={item}/><div className="tb-result-action"><strong>{money(item.confirmedAmountWon)}<small>원</small></strong><Button data-task-action="true" variant="secondary" onClick={() => choose(item)} aria-label={`${item.projectName} 예산 적용`}><Check size={16}/>예산에 적용</Button></div></article>)}</div>{!result.items.length && <p className="tb-empty">조건에 맞는 예산이 없습니다. 다른 키워드나 연도로 검색해 주세요.</p>}{result.total > result.pageSize && <div className="tb-pagination"><Button variant="secondary" disabled={loading || result.page <= 1} onClick={() => void search(result.page - 1, submittedSearch.year, submittedSearch.query)}><ChevronLeft size={16}/>이전</Button><span>{result.page} / {Math.ceil(result.total / result.pageSize)}</span><Button variant="secondary" disabled={loading || result.page * result.pageSize >= result.total} onClick={() => void search(result.page + 1, submittedSearch.year, submittedSearch.query)}>다음<ChevronRight size={16}/></Button></div>}</>}
      </div>}
    </>}
  </section>;
}

export function TaskBudgetSection({ value, onChange, expenses, onExpensesChange, previousExpenses, definitionEditable, expensesEditable, today, defaultProjectName }: { value: TaskBudgetDraft; onChange: (value: TaskBudgetDraft) => void; expenses: Expense[]; onExpensesChange: (items: Expense[]) => void; previousExpenses: Expense[]; definitionEditable: boolean; expensesEditable: boolean; today: string; defaultProjectName: string }) {
  const catalogYear = value.mode === 'catalog' ? value.allocation?.year : undefined;
  const yearExpenses = catalogYear ? expenses.filter(item => item.date.slice(0, 4) === String(catalogYear)) : expenses;
  const otherYearCount = expenses.length - yearExpenses.length;
  const total = yearExpenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const amount = Number(value.amount) || 0; const balance = amount - total;
  const nonBudget = value.mode === 'none'; const canEditExpenses = expensesEditable && !nonBudget;
  const editExpense = (id: string, patch: Partial<Expense>) => onExpensesChange(expenses.map(item => item.id === id ? { ...item, ...patch } : item));
  const requiredFor = (expense: Expense, field: 'projectName' | 'vendor') => !previousExpenses.some(item => item.id === expense.id && !item[field]);
  return <div className="form-stack tb-task-budget">
    <div className="tb-summary"><div><span>{nonBudget ? '예산 구분' : catalogYear ? `${catalogYear}년 확정 예산` : '사업 예산'}</span><strong>{nonBudget ? '비예산' : money(amount)}{!nonBudget && <small>원</small>}</strong></div><div><span>{catalogYear ? `${catalogYear}년 집행 합계` : '집행 합계'}</span><strong>{Number.isSafeInteger(total) ? money(total) : '금액 확인'}<small>원</small></strong></div><div className={!nonBudget && balance < 0 ? 'is-over-budget' : ''}><span>{catalogYear ? `${catalogYear}년 집행잔액` : '집행잔액'}</span><strong>{nonBudget ? '해당 없음' : Number.isSafeInteger(balance) ? money(balance) : '금액 확인'}{!nonBudget && <small>원</small>}</strong></div></div>
    {!nonBudget && balance < 0 && <p className="tb-error" role="status"><AlertCircle size={18}/>예산보다 {money(Math.abs(balance))}원을 초과 집행했습니다.</p>}
    <TaskBudgetFields value={value} onChange={onChange} disabled={!definitionEditable} hasExpenses={expenses.some(item => item.amount > 0)}/>
    <div className="tb-expenses-heading"><div><h3>집행 내역</h3><p>{catalogYear ? `이 세부업무의 ${catalogYear}년 집행 금액으로 잔액을 계산합니다.` : '이 세부업무에 등록한 전체 집행 금액으로 잔액을 계산합니다.'}</p></div>{canEditExpenses && <Button data-task-action="true" variant="secondary" disabled={expenses.length >= 500} onClick={() => onExpensesChange([...expenses, { id: `expense-${crypto.randomUUID().slice(0, 12)}`, date: today, projectName: defaultProjectName, vendor: '', description: '', amount: 0 }])}><Plus size={17}/>집행 추가</Button>}</div>
    {!nonBudget && <p className="tb-note">같은 예산을 연결한 다른 세부업무의 집행액은 여기에 합산되지 않습니다.</p>}
    {otherYearCount > 0 && <p className="tb-other-year-note" role="status">다른 회계연도의 집행 기록 {otherYearCount}건은 보관되며, {catalogYear}년 집행 합계와 잔액 계산에서 제외됩니다.</p>}
    <div className="tb-expense-list">{expenses.map((expense, index) => <article className="tb-expense-card" key={expense.id}><header><strong>집행 {index + 1}</strong>{catalogYear && expense.date.slice(0, 4) !== String(catalogYear) && <Badge tone="outline">다른 회계연도 · 잔액 계산 제외</Badge>}<span>{money(expense.amount)}원</span>{canEditExpenses && <Button variant="ghost" aria-label={`${index + 1}번 집행 내역 삭제`} onClick={() => onExpensesChange(expenses.filter(item => item.id !== expense.id))}><Trash2 size={16}/>삭제</Button>}</header><div className="tb-expense-fields">
      {canEditExpenses ? <Field label="집행일"><input aria-label={`${index + 1}번 집행일`} type="date" required disabled={!canEditExpenses} value={expense.date} onChange={event => editExpense(expense.id, { date: event.target.value })}/></Field> : <ReadField label="집행일" value={expense.date} date />}
      {canEditExpenses ? <Field label="사업명"><input aria-label={`${index + 1}번 사업명`} required={requiredFor(expense, 'projectName')} maxLength={200} disabled={!canEditExpenses} placeholder="집행한 사업명" value={expense.projectName ?? ''} onChange={event => editExpense(expense.id, { projectName: event.target.value || undefined })}/></Field> : <ReadField label="사업명" value={expense.projectName} />}
      {canEditExpenses ? <Field label="사업자"><input aria-label={`${index + 1}번 사업자`} required={requiredFor(expense, 'vendor')} maxLength={200} disabled={!canEditExpenses} placeholder="업체·기관명" value={expense.vendor ?? ''} onChange={event => editExpense(expense.id, { vendor: event.target.value || undefined })}/></Field> : <ReadField label="사업자" value={expense.vendor} />}
      {canEditExpenses ? <Field label="집행 금액 (원)"><input aria-label={`${index + 1}번 집행 금액`} type="number" min="0" max={maximumAmount} step="1" required disabled={!canEditExpenses} value={expense.amount} onChange={event => editExpense(expense.id, { amount: Number(event.target.value) })}/></Field> : <ReadField label="집행 금액 (원)" value={money(expense.amount)} />}
      {canEditExpenses ? <Field label="집행 내용·비고"><input aria-label={`${index + 1}번 집행 내용`} required maxLength={500} disabled={!canEditExpenses} placeholder="예: 통계연보 인쇄비 지급" value={expense.description} onChange={event => editExpense(expense.id, { description: event.target.value })}/></Field> : <ReadField label="집행 내용·비고" value={expense.description} />}
    </div>{!expense.projectName || !expense.vendor ? previousExpenses.some(item => item.id === expense.id) && <p className="tb-note">기존 기록에 없는 사업명·사업자는 필요할 때 보완할 수 있습니다.</p> : null}</article>)}</div>
    {!expenses.length && <div className="tb-empty"><Wallet size={25}/><p>{nonBudget ? '비예산 사업은 집행 내역을 등록하지 않습니다.' : '아직 등록된 집행 내역이 없습니다.'}</p></div>}
  </div>;
}

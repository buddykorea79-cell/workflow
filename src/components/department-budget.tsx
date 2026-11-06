'use client';

import { useEffect, useState } from 'react';
import { Building2, Download, FolderTree, Info, RefreshCw, Search, Wallet } from 'lucide-react';
import type { Workspace } from '@/lib/types';
import type { BudgetTotals, DepartmentBudgetSummary, DepartmentBudgetUnit } from '@/lib/department-budget-types';
import { Badge, Button, EmptyState, Field } from './ui';
import './department-budget.css';

const money = (value: number) => value.toLocaleString('ko-KR');
const nowYear = (value: string) => Number(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date(value)));
const emptyTotals = (): BudgetTotals => ({ budget: 0, spent: 0, balance: 0, taskCount: 0, projectCount: 0, expenseCount: 0 });

function projectTotals(projects: DepartmentBudgetUnit['projects']): BudgetTotals {
  return projects.reduce((total, item) => ({ budget: total.budget + item.budget, spent: total.spent + item.spent, balance: total.balance + item.balance, taskCount: total.taskCount + item.taskCount, expenseCount: total.expenseCount + item.expenseCount, projectCount: total.projectCount + 1 }), emptyTotals());
}

function csvCell(value: string | number) {
  const content = typeof value === 'number' ? String(value) : /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${content.replace(/"/g, '""')}"`;
}

function downloadSummary(data: DepartmentBudgetSummary, groups: DepartmentBudgetUnit[], filtered: boolean) {
  const rows: (string | number)[][] = [
    ['부서', data.department.name, '회계연도', data.year, '금액 단위', '원'],
    ['집계 범위', filtered ? '현재 검색 결과' : '전체 연결 예산', '기준', '세부사업별 확정 예산 1회 합산 / 해당 부서의 같은 연도 집행액'],
    ['회계', '분야', '부문', '프로그램', '단위사업', '세부사업', '사업코드', '연결 업무 수', '확정 예산', '부서 집행액', '차감잔액', '금액 출처'],
  ];
  const total = emptyTotals();
  for (const group of groups) {
    for (const project of group.projects) rows.push([group.account, group.field, group.sector, group.program, group.unitProject, project.projectName, project.projectCode || '', project.taskCount, project.budget, project.spent, project.balance, project.amountSource === 'catalog' ? '현재 예산 원장' : '업무 연결 당시 예산']);
    rows.push([group.account, group.field, group.sector, group.program, group.unitProject, '단위사업 소계', '', group.totals.taskCount, group.totals.budget, group.totals.spent, group.totals.balance, '']);
    for (const key of Object.keys(total) as (keyof BudgetTotals)[]) total[key] += group.totals[key];
  }
  rows.push(['', '', '', '', '', filtered ? '검색 결과 합계' : '전체 합계', '', total.taskCount, total.budget, total.spent, total.balance, '']);
  rows.push([], ['별도 집계 (검색 조건 미적용)', '업무 수', '예산 (연도 미지정)', `${data.year}년 집행액`, '차감잔액']);
  rows.push(['직접 입력·원장 미연결', data.manual.taskCount, data.manual.budget, data.manual.spent, data.manual.balance], ['비예산', data.nonBudgetTaskCount]);
  if (data.otherBudgetYear.expenseCount) rows.push(['다른 연도 예산에 연결된 업무의 선택연도 집행', data.otherBudgetYear.taskCount, '', data.otherBudgetYear.spent, '']);
  const href = URL.createObjectURL(new Blob(['\ufeff', rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = href; link.download = `${data.department.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}_${data.year}_예산집계.csv`;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

/** Remount on identity changes so a previous department's data is never shown to a new account. */
export function DepartmentBudget({ workspace }: { workspace: Workspace }) {
  if (!['manager', 'head', 'admin'].includes(workspace.currentUser.role)) return <EmptyState title="부서 예산 집계 권한이 필요합니다." description="부서 담당자 또는 부서장 계정으로 소속 부서의 예산을 확인할 수 있습니다." />;
  return <DepartmentBudgetView key={`${workspace.currentUser.id}:${workspace.currentUser.role}:${workspace.currentUser.departmentId}`} workspace={workspace} />;
}

function DepartmentBudgetView({ workspace }: { workspace: Workspace }) {
  const user = workspace.currentUser;
  const [year, setYear] = useState(nowYear(workspace.serverTime));
  const [selectedDepartment, setSelectedDepartment] = useState(user.departmentId);
  const [query, setQuery] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: DepartmentBudgetSummary; error?: string }>();
  const isAdmin = user.role === 'admin';
  const departmentId = isAdmin && workspace.departments.some(department => department.id === selectedDepartment) ? selectedDepartment : user.departmentId;
  const key = `${user.id}:${user.role}:${departmentId}:${year}:${workspace.revision}:${refresh}`;
  const data = result?.key === key ? result.data : undefined;
  const error = result?.key === key ? result.error : undefined;
  const loading = !data && !error;
  const years = [...new Set([year, nowYear(workspace.serverTime), ...(result?.data?.department.id === departmentId ? result.data.years : [])])].sort((a, b) => b - a);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void (async () => {
      try {
        const params = new URLSearchParams({ year: String(year), departmentId });
        const response = await fetch(`/api/budgets/department?${params}`, { signal: controller.signal, cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || '부서 예산을 불러오지 못했습니다.');
        if (active) setResult({ key, data: body as DepartmentBudgetSummary });
      } catch (caught) {
        if (active && !controller.signal.aborted) setResult({ key, error: caught instanceof Error ? caught.message : '부서 예산을 불러오지 못했습니다.' });
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [key, year, departmentId]);

  const search = query.trim().toLocaleLowerCase('ko-KR');
  const groups = (data?.groups || []).map(group => {
    const groupMatch = `${group.account} ${group.field} ${group.sector} ${group.program} ${group.unitProject}`.toLocaleLowerCase('ko-KR').includes(search);
    const projects = group.projects.filter(project => groupMatch || `${project.projectName} ${project.projectCode || ''}`.toLocaleLowerCase('ko-KR').includes(search));
    return { ...group, projects, totals: projectTotals(projects) };
  }).filter(group => group.projects.length);
  const visible = projectTotals(groups.flatMap(group => group.projects));
  const departmentName = workspace.departments.find(department => department.id === departmentId)?.name || '소속 부서';
  const reload = () => setRefresh(value => value + 1);

  return <div className="department-budget">
    <header className="page-heading db-heading"><div><p className="eyebrow">단위사업에서 세부사업까지</p><h1>부서 예산 집계</h1><p className="muted">{departmentName}의 연결 예산과 집행 현황을 한 번에 확인합니다.</p></div><div className="db-actions"><Button variant="secondary" onClick={reload} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''}/>새로고침</Button><Button disabled={!data || !groups.length && !data.manual.taskCount && !data.nonBudgetTaskCount && !data.otherBudgetYear.expenseCount} onClick={() => data && downloadSummary(data, groups, !!search)}><Download size={17}/>CSV 내려받기</Button></div></header>
    <section className="db-filters" aria-label="예산 집계 조건">{isAdmin && <Field label="집계 부서"><select value={departmentId} onChange={event => { setSelectedDepartment(event.target.value); setQuery(''); }}>{workspace.departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</select></Field>}<Field label="회계연도"><select value={year} onChange={event => setYear(Number(event.target.value))}>{years.map(value => <option value={value} key={value}>{value}년</option>)}</select></Field><label className="db-search"><Search size={18}/><input aria-label="예산 집계 검색" placeholder="단위사업·세부사업·분야 검색" value={query} onChange={event => setQuery(event.target.value)}/></label></section>
    <div className="db-scope"><Info size={19}/><div><p>연결한 세부사업의 확정 예산은 한 번만 합산하며, 집행액은 우리 부서의 해당 연도 기록을 합산합니다.</p><small>확정 예산은 현재 원장의 사업 전체 금액입니다. 부서에 별도로 배정된 한도를 뜻하지 않으며, 다른 부서의 집행은 차감하지 않습니다.</small></div></div>
    {loading && <div className="db-loading" role="status"><RefreshCw size={24} className="spin"/><p>부서 예산을 집계하고 있습니다.</p></div>}
    {error && <div className="db-error" role="alert"><p>{error}</p><Button variant="secondary" onClick={reload}>다시 불러오기</Button></div>}
    {data && <>
      <section className="db-stats" aria-label="부서 연결 예산 전체 합계">
        <article><span><Wallet size={18}/>연결 확정 예산</span><strong>{money(data.totals.budget)}<small>원</small></strong><p>중복 제외 · 세부사업 {data.totals.projectCount}개</p></article>
        <article><span><Building2 size={18}/>부서 집행액</span><strong>{money(data.totals.spent)}<small>원</small></strong><p>{data.year}년 집행 {data.totals.expenseCount}건</p></article>
        <article data-negative={data.totals.balance < 0}><span><FolderTree size={18}/>차감잔액</span><strong>{money(data.totals.balance)}<small>원</small></strong><p>{data.totals.balance < 0 ? '집행액이 연결 확정 예산을 초과했습니다.' : '연결 확정 예산 − 부서 집행액'}</p></article>
      </section>
      <section className="db-panel" aria-label="단위사업·세부사업별 예산 집계">
        <div className="db-panel-heading"><div><h2>단위사업별 예산·집행</h2><p>{search ? '검색 결과' : '전체'} · 단위사업 {groups.length}개 · 세부사업 {visible.projectCount}개 · 연결 업무 {visible.taskCount}건</p></div><span>단위: 원</span></div>
        {groups.length ? <div className="db-table-scroll" role="region" aria-label="단위사업·세부사업별 예산 표" tabIndex={0}><table className="db-table"><caption className="db-sr-only">{data.department.name} {data.year}년 단위사업별 확정 예산과 부서 집행액</caption><thead><tr><th scope="col">단위사업 / 세부사업</th><th scope="col" className="db-number">연결 업무</th><th scope="col" className="db-number">확정 예산</th><th scope="col" className="db-number">부서 집행액</th><th scope="col" className="db-number">차감잔액</th></tr></thead>{groups.map(group => <tbody key={group.id}>
          <tr className="db-unit"><th scope="rowgroup" colSpan={5}><div><FolderTree size={19}/><strong>{group.unitProject}</strong><Badge tone="outline">{group.projects.length}개 세부사업</Badge></div><p>{[group.account, group.field, group.sector, group.program].join(' › ')}</p></th></tr>
          {group.projects.map(project => <tr key={project.id}><th scope="row" className="db-project"><strong>{project.projectName}</strong>{project.projectCode && <span>{project.projectCode}</span>}{(project.amountSource === 'snapshot' || project.changedSnapshotCount > 0) && <small>{project.amountSource === 'snapshot' ? '원장 항목 없음 · 업무 연결 당시 금액' : `원장 최신 금액 적용 · 연결 당시와 다른 업무 ${project.changedSnapshotCount}건`}</small>}</th><td className="db-number">{project.taskCount}건</td><td className="db-number">{money(project.budget)}</td><td className="db-number">{money(project.spent)}</td><td className={`db-number ${project.balance < 0 ? 'db-negative' : ''}`}>{money(project.balance)}{project.balance < 0 && <small>예산 초과</small>}</td></tr>)}
          <tr className="db-subtotal"><th scope="row">{search ? '검색 결과 소계' : '단위사업 소계'}</th><td className="db-number">{group.totals.taskCount}건</td><td className="db-number">{money(group.totals.budget)}</td><td className="db-number">{money(group.totals.spent)}</td><td className={`db-number ${group.totals.balance < 0 ? 'db-negative' : ''}`}>{money(group.totals.balance)}</td></tr>
        </tbody>)}<tfoot><tr><th scope="row">{search ? '검색 결과 합계' : '전체 합계'}</th><td className="db-number">{visible.taskCount}건</td><td className="db-number">{money(visible.budget)}</td><td className="db-number">{money(visible.spent)}</td><td className={`db-number ${visible.balance < 0 ? 'db-negative' : ''}`}>{money(visible.balance)}</td></tr></tfoot></table></div> : <EmptyState title={search ? '검색 조건에 맞는 예산이 없습니다.' : `${data.year}년 확정 예산에 연결된 업무가 없습니다.`} description={search ? '사업명이나 분야를 바꾸어 검색해 주세요.' : '세부업무의 예산·집행에서 확정 예산을 검색해 연결하면 이곳에 함께 집계됩니다.'} action={search ? <Button variant="secondary" onClick={() => setQuery('')}>검색 초기화</Button> : undefined}/>}
      </section>
      <section className="db-separate" aria-label="원장 연결 외 별도 예산 집계"><div className="db-separate-heading"><h2>별도 집계</h2><p>확정 예산 합계에 포함하지 않는 업무입니다. 검색 조건과 관계없이 부서 전체를 표시합니다.</p></div><div className="db-separate-grid"><article><div><h3>직접 입력·원장 미연결</h3><Badge>{data.manual.taskCount}건</Badge></div><dl><div><dt>입력 예산 <small>연도 미지정</small></dt><dd>{money(data.manual.budget)}원</dd></div><div><dt>{data.year}년 집행액</dt><dd>{money(data.manual.spent)}원</dd></div><div><dt>차감잔액</dt><dd className={data.manual.balance < 0 ? 'db-negative' : ''}>{money(data.manual.balance)}원</dd></div></dl><p>입력 예산에서 선택한 연도의 집행액만 차감합니다. 세부업무에서 확정 예산을 연결하면 위 사업별 집계에 포함됩니다.</p></article><article><div><h3>비예산 업무</h3><Badge>{data.nonBudgetTaskCount}건</Badge></div><p>비예산으로 지정한 업무는 확정 예산과 집행액 합계에서 제외합니다.</p>{data.otherBudgetYear.expenseCount > 0 && <div className="db-other-year"><strong>다른 연도 예산의 {data.year}년 집행</strong><span>{money(data.otherBudgetYear.spent)}원 · {data.otherBudgetYear.expenseCount}건</span><p>다른 회계연도 예산에 연결된 업무의 집행입니다. 위 사업별 잔액에 포함하지 않습니다.</p></div>}</article></div></section>
      <footer className="db-notes"><p>보관된 업무의 집행은 포함하고 삭제된 업무는 제외합니다.{data.excludedTaskCount > 0 && ` 집계 대상에서 제외된 업무 ${data.excludedTaskCount}건.`}{data.ignoredOtherYearExpenseCount > 0 && ` 선택연도 외 집행 ${data.ignoredOtherYearExpenseCount}건은 제외했습니다.`}</p><p>조회 기준 {new Date(data.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</p></footer>
    </>}
  </div>;
}

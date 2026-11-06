'use client';

import { useState } from 'react';
import { Building2, Download, FileSpreadsheet, FileText, LoaderCircle, RefreshCw, Search, Users } from 'lucide-react';
import type { Workspace } from '@/lib/types';
import { filterOrganizationDivision, organizationDivisionRows } from '@/lib/organization-division';
import { Badge, Button, EmptyState } from './ui';
import './organization-division.css';

export function OrganizationDivision({ workspace, onRefresh }: { workspace: Workspace; onRefresh?: () => Promise<void> }) {
  const [departmentId, setDepartmentId] = useState('all');
  const [team, setTeam] = useState('all');
  const [name, setName] = useState('');
  const [downloading, setDownloading] = useState<'xlsx' | 'pdf' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const model = workspace.organizationDivision;
  if (!model) return <EmptyState title="전체 업무분장표를 불러오고 있습니다." description="현황을 새로 불러와 전체 부서의 업무분장을 확인해 주세요." action={onRefresh && <Button onClick={onRefresh}>새로고침</Button>}/>;
  const selectedDepartments = model.departments.filter(department => departmentId === 'all' || department.id === departmentId);
  const teams = [...new Set(selectedDepartments.flatMap(department => department.people.map(person => person.team)))].sort((a, b) => a.localeCompare(b, 'ko'));
  const filtered = filterOrganizationDivision(model, { departmentId, team, name });
  const rows = organizationDivisionRows(filtered);
  const personCount = filtered.departments.reduce((sum, department) => sum + department.people.length, 0);
  const taskCount = rows.filter(row => row.taskId).length;
  const unitCount = new Set(rows.map(row => row.unitId)).size;
  const download = async (format: 'xlsx' | 'pdf') => {
    if (downloading) return;
    setDownloading(format); setError('');
    try {
      const params = new URLSearchParams({ format, departmentId, team, name });
      const response = await fetch(`/api/organization-division/export?${params}`, { cache: 'no-store' });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || result.message || '파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `온이음_업무분장표_${model.generatedAt.slice(0, 10)}.${format}`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (caught) { setError(caught instanceof Error ? caught.message : '파일을 내려받지 못했습니다.'); }
    finally { setDownloading(null); }
  };
  return <div className="od-page">
    <header className="page-heading"><div><p className="eyebrow">전 부서의 업무와 담당자를 한눈에</p><h1>전체 업무분장표</h1><p>담당자별 단위업무·세부업무와 현재 업무대행자를 확인하세요.</p></div><div className="od-heading-actions">{onRefresh && <Button variant="secondary" disabled={refreshing} onClick={async () => { setRefreshing(true); setError(''); try { await onRefresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : '현황을 불러오지 못했습니다.'); } finally { setRefreshing(false); } }}><RefreshCw size={17} className={refreshing ? 'spin' : ''}/>새로고침</Button>}<Button variant="secondary" disabled={!!downloading || !rows.length} onClick={() => download('xlsx')}>{downloading === 'xlsx' ? <LoaderCircle size={18} className="spin"/> : <FileSpreadsheet size={18}/>}Excel 다운로드</Button><Button disabled={!!downloading || !rows.length} onClick={() => download('pdf')}>{downloading === 'pdf' ? <LoaderCircle size={18} className="spin"/> : <Download size={18}/>}PDF 다운로드</Button></div></header>
    {error && <p className="form-error od-error" role="alert">{error}</p>}
    <section className="od-query" aria-label="업무분장표 검색 조건"><div className="od-filters"><label><span>부서</span><select aria-label="전체 업무분장표 부서" value={departmentId} onChange={event => { setDepartmentId(event.target.value); setTeam('all'); }}><option value="all">전체 부서</option>{model.departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label><label><span>팀</span><select aria-label="전체 업무분장표 팀" value={team} onChange={event => setTeam(event.target.value)}><option value="all">전체 팀</option>{teams.map(value => <option key={value} value={value}>{value || '팀 미지정'}</option>)}</select></label><label className="od-name-filter"><span>담당자 이름</span><div><Search size={18}/><input aria-label="전체 업무분장표 이름 검색" value={name} maxLength={100} onChange={event => setName(event.target.value)} placeholder="이름을 입력하세요"/></div></label>{(departmentId !== 'all' || team !== 'all' || name) && <Button variant="secondary" onClick={() => { setDepartmentId('all'); setTeam('all'); setName(''); }}>초기화</Button>}</div><div className="od-query-summary"><span><Users size={17}/>담당자 <b>{personCount}</b>명</span><span>단위업무 <b>{unitCount}</b>개</span><span><FileText size={17}/>세부업무 <b>{taskCount}</b>건</span><p>다운로드에는 현재 조회 조건이 적용됩니다.</p></div></section>
    <div className="od-departments">{filtered.departments.length ? filtered.departments.map(department => <section className="od-department" key={department.id}><header><span className="od-department-symbol"><Building2 size={23}/></span><div><h2>{department.name}</h2><p>담당자 {department.people.length}명 · 세부업무 {department.people.reduce((sum, person) => sum + person.units.reduce((count, unit) => count + unit.tasks.length, 0), 0)}건</p></div><Badge tone="outline">{department.shortName}</Badge></header>{department.people.length ? <div className="od-table-scroll" role="region" aria-label={`${department.name} 업무분장표`} tabIndex={0}><table className="od-table"><caption className="od-visually-hidden">{department.name}의 담당자, 단위업무, 세부업무, 현재 승인된 업무대행자</caption><colgroup><col className="od-col-person"/><col className="od-col-unit"/><col className="od-col-task"/><col className="od-col-delegate"/></colgroup><thead><tr><th scope="col">담당자</th><th scope="col">단위업무</th><th scope="col">세부업무</th><th scope="col">업무대행자</th></tr></thead>{department.people.map(person => {
      const personRows = person.units.reduce((sum, unit) => sum + Math.max(1, unit.tasks.length), 0);
      return <tbody key={person.id}>{person.units.flatMap((unit, unitIndex) => (unit.tasks.length ? unit.tasks : [null]).map((task, taskIndex) => <tr key={`${unit.id}-${task?.id || 'empty'}`}>{unitIndex === 0 && taskIndex === 0 && <th scope="rowgroup" rowSpan={personRows} className="od-person-cell"><strong>{person.name}</strong><span>{person.team || '팀 미지정'}</span></th>}{taskIndex === 0 && <td rowSpan={Math.max(1, unit.tasks.length)} className="od-unit-cell">{unit.title}</td>}<td className="od-task-cell">{task ? task.title : <span className="od-empty-label">등록된 세부업무 없음</span>}</td><td className="od-delegate-cell">{task?.delegates.length ? task.delegates.map(delegate => <span key={delegate.id} title={`${delegate.startsAt.slice(0, 10)} ~ ${delegate.endsAt.slice(0, 10)}`} className="od-delegate">{delegate.name}</span>) : <span className="od-empty-label">—</span>}</td></tr>))}</tbody>;
    })}</table></div> : <div className="od-department-empty">조회 조건에 해당하는 등록 업무가 없습니다.</div>}</section>) : <EmptyState title="조건에 맞는 담당자가 없습니다." description="부서·팀 또는 이름 검색 조건을 바꿔 주세요."/>}</div>
    <footer className="od-footer"><span>현재 승인되어 유효한 기간 안에 있는 업무대행자만 표시합니다. 대행 업무는 원 담당자 아래에 한 번만 표시됩니다.</span><span>조회 {new Date(model.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })}</span></footer>
  </div>;
}

'use client';

import { useRevisionCommand } from './command-revision';

import { useRef, useState } from 'react';
import { useUnsavedChanges, useUnsavedNavigation } from './unsaved-changes';
import { ArrowRight, ArrowUpRight, Building2, CalendarDays, CheckCheck, ChevronRight, FileText, FolderOpen, GitBranch, LockKeyhole, RefreshCw, Search, ShieldCheck, UnlockKeyhole, Users } from 'lucide-react';
import type { CommonDistribution, Task, User, Workspace } from '@/lib/types';
import { taskExecution as getTaskExecution } from '@/lib/common-status';
import { deadlineState } from '@/lib/task-deadline';
import { canEvaluateUnitPerformance } from '@/lib/unit-evaluation';
import { commonExecutionState, commonStageState, definitionState, executionStatus } from '@/lib/status-labels';
import { Badge, Button, EmptyState, Field, Modal, Progress, type CommandFn } from './ui';
import { formatDate, formatDateFull, formatDateTimeFull as dateTime } from '@/lib/date-format';
import './department-work.css';

type Props = { workspace: Workspace; command: CommandFn; onOpenTask: (id: string) => void; onRefresh?: () => Promise<void> };
type Person = Pick<User, 'id' | 'name' | 'team' | 'title' | 'active'>;
type ViewProps = Props & { overview?: boolean; onManage?: () => void; onEvaluate?: () => void };
const nameOf = (w: Workspace, id?: string) => w.users.find(user => user.id === id)?.name || w.identities?.find(user => user.id === id)?.name || '미지정';
const todayFor = (w: Workspace) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(w.serverTime));

function taskExecution(w: Workspace, task: Task) {
  const execution = getTaskExecution(w, task);
  const { run, totalSteps: total, completedSteps: done, progress } = execution;
  const status = executionStatus(task, run, progress, execution.nextRole);
  const paused = status.key === 'paused';
  const completed = status.key === 'completed';
  const { deadline: dueDate, overdue } = deadlineState({ taskDueDate: task.dueDate, progress, runStatus: run?.status, taskStatus: task.status, deletedAt: task.deletedAt }, todayFor(w));
  return { total, done, progress, completed, paused, overdue, dueDate, ...status };
}

function departmentData(w: Workspace, departmentId: string) {
  const units = w.units.filter(unit => unit.departmentId === departmentId && !unit.deletedAt);
  const tasks = w.tasks.filter(task => {
    if (task.departmentId !== departmentId || task.deletedAt || task.status === 'archived' || !units.some(unit => unit.id === task.unitId)) return false;
    if (!task.commonId) return true;
    const distribution = w.commonTasks.find(common => common.id === task.commonId)?.distributions.find(item => item.taskId === task.id);
    return !!distribution && ['registered', 'assigned', 'submitted'].includes(distribution.status);
  });
  const people: Person[] = w.users.filter(user => user.departmentId === departmentId && ((user.active && !['head', 'admin'].includes(user.role)) || tasks.some(task => task.primaryId === user.id) || units.some(unit => unit.ownerId === user.id)));
  for (const id of new Set([...tasks.map(task => task.primaryId), ...units.map(unit => unit.ownerId)])) {
    if (people.some(person => person.id === id)) continue;
    const identity = w.identities?.find(person => person.id === id);
    people.push({ id, name: identity?.name || '기존 담당자', team: identity?.team || '소속 확인 필요', title: '연결된 업무 담당자', active: false });
  }
  const rows = people.map(person => {
    const ownedUnits = units.filter(unit => unit.ownerId === person.id);
    const ownTasks = tasks.filter(task => task.primaryId === person.id);
    const execution = ownTasks.map(task => taskExecution(w, task));
    return { person, units: ownedUnits, tasks: ownTasks, complete: execution.filter(item => item.completed).length, overdue: execution.filter(item => item.overdue).length, progress: execution.length ? Math.round(execution.reduce((sum, item) => sum + item.progress, 0) / execution.length) : 0 };
  }).sort((a, b) => a.person.team.localeCompare(b.person.team, 'ko') || a.person.name.localeCompare(b.person.name, 'ko'));
  return { units, tasks, rows, completed: tasks.filter(task => taskExecution(w, task).completed).length, overdue: tasks.filter(task => taskExecution(w, task).overdue).length };
}

export function DepartmentDashboard(props: Props & { onManage: () => void; onEvaluate: () => void }) {
  return <DepartmentWork {...props} overview />;
}

const frequencyNames = { once: '수시', monthly: '매월', quarterly: '분기', half_yearly: '반기', yearly: '매년' };

export function DepartmentDivisionTable({ workspace: w, onOpenTask, onRefresh }: Pick<Props, 'workspace' | 'onOpenTask' | 'onRefresh'>) {
  const [query, setQuery] = useState('');
  const [team, setTeam] = useState('all');
  const [personId, setPersonId] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const division = w.departmentDivision;
  const department = w.departments.find(item => item.id === w.currentUser.departmentId);
  if (!division) return <EmptyState title="업무분장표를 준비하고 있습니다." description="현황을 다시 불러와 부서의 업무분장을 확인해 주세요." action={onRefresh && <Button onClick={onRefresh}>현황 새로고침</Button>} />;
  const person = (id: string) => division.members.find(item => item.id === id);
  const teams = [...new Set(division.members.map(item => item.team))].sort((a, b) => a.localeCompare(b, 'ko'));
  const matchingPeople = division.members.filter(item => team === 'all' || item.team === team);
  const search = query.trim().toLocaleLowerCase();
  const groups = division.units.map(unit => {
    const tasks = division.tasks.filter(task => task.unitId === unit.id);
    const filteredTasks = tasks.filter(task => {
      const owner = person(task.primaryId);
      return (team === 'all' || owner?.team === team) && (personId === 'all' || task.primaryId === personId || task.supportIds.includes(personId))
        && (!search || `${unit.title} ${task.title} ${task.code} ${owner?.name || ''} ${owner?.team || ''} ${task.supportIds.map(id => person(id)?.name || '').join(' ')}`.toLocaleLowerCase().includes(search));
    });
    const unitOwner = person(unit.ownerId);
    const showEmpty = !tasks.length && (team === 'all' || unitOwner?.team === team) && (personId === 'all' || unit.ownerId === personId)
      && (!search || `${unit.title} ${unitOwner?.name || ''} ${unitOwner?.team || ''}`.toLocaleLowerCase().includes(search));
    return { unit, tasks: filteredTasks, showEmpty };
  }).filter(group => group.tasks.length || group.showEmpty);
  const visibleTasks = groups.reduce((sum, group) => sum + group.tasks.length, 0);
  return <div className="dw-view dw-simple-view">
    <header className="page-heading"><div><p className="eyebrow">우리 부서의 업무와 역할</p><h1>업무분장표</h1><p>{department?.name} · 누가 어떤 업무를 맡고 있는지 한눈에 확인하세요.</p></div>{onRefresh && <Button variant="secondary" disabled={refreshing} onClick={async () => { setRefreshing(true); setError(''); try { await onRefresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : '현황을 불러오지 못했습니다.'); } finally { setRefreshing(false); } }}><RefreshCw size={17} className={refreshing ? 'spin' : ''}/>새로고침</Button>}</header>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="dw-simple-summary" aria-label="부서 업무분장 요약"><div><Badge tone={division.status === 'confirmed' ? 'success' : 'info'}>{division.status === 'confirmed' ? '업무분장 확정' : '업무분장 작성 중'}</Badge><span>단위업무 <strong>{division.units.length}</strong>개</span><span>세부업무 <strong>{division.tasks.length}</strong>건</span></div><span>{division.confirmedAt ? `마지막 확정 ${formatDateFull(division.confirmedAt)} · ` : ''}v{division.version}</span></section>
    <section className="dw-simple-panel" aria-label="부서 업무분장 조회">
      <div className="dw-simple-toolbar"><label className="dw-search"><Search size={18}/><input aria-label="업무분장표 검색" placeholder="업무명·담당자·팀 검색" value={query} onChange={event => setQuery(event.target.value)}/></label><select aria-label="업무분장표 팀" value={team} onChange={event => { setTeam(event.target.value); setPersonId('all'); }}><option value="all">모든 팀</option>{teams.map(value => <option key={value} value={value}>{value || '팀 미지정'}</option>)}</select><select aria-label="업무분장표 담당자" value={personId} onChange={event => setPersonId(event.target.value)}><option value="all">모든 담당자</option>{matchingPeople.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div>
      <div className="dw-simple-caption"><span>단위업무 {groups.length}개 · 세부업무 {visibleTasks}건</span><span>열람할 수 있는 업무는 제목을 눌러 자세히 볼 수 있습니다.</span></div>
      {groups.length ? <div className="dw-simple-scroll" role="region" aria-label="우리 부서 업무분장 표" tabIndex={0}><table className="dw-simple-table"><caption className="dw-visually-hidden">부서의 단위업무와 세부업무, 담당자, 지원담당자, 주기, 실행 또는 기준 상태</caption><colgroup><col style={{ width: '22%' }}/><col style={{ width: '29%' }}/><col style={{ width: '15%' }}/><col style={{ width: '14%' }}/><col style={{ width: '9%' }}/><col style={{ width: '11%' }}/></colgroup><thead><tr><th scope="col">단위업무</th><th scope="col">세부업무</th><th scope="col">담당자</th><th scope="col">지원담당</th><th scope="col">주기</th><th scope="col">업무 상태</th></tr></thead>{groups.map(({ unit, tasks }) => <tbody key={unit.id}>{tasks.length ? tasks.map((task, index) => {
        const primary = person(task.primaryId);
        const readable = w.tasks.find(item => item.id === task.id && !item.deletedAt);
        const execution = readable ? taskExecution(w, readable) : undefined;
        const definition = definitionState(task.status);
        return <tr key={task.id}>{index === 0 && <th scope="rowgroup" rowSpan={tasks.length} className="dw-simple-unit"><FolderOpen size={18}/><strong>{unit.title}</strong><span>{person(unit.ownerId)?.name || '담당자 확인 필요'}</span></th>}<td><div className="dw-simple-task-meta"><span>{task.code}</span>{task.commonId && <Badge tone="info">공통</Badge>}</div>{readable ? <button className="dw-task-link" onClick={() => onOpenTask(task.id)}>{task.title}<ArrowUpRight size={15}/></button> : <strong className="dw-simple-task-title">{task.title}</strong>}</td><td><strong>{primary?.name || '담당자 확인 필요'}</strong><span className="dw-simple-secondary">{primary?.team || '팀 미지정'}</span></td><td>{task.supportIds.length ? task.supportIds.map(id => person(id)?.name || '담당자 확인 필요').join(', ') : <span className="dw-simple-secondary">—</span>}</td><td>{frequencyNames[task.frequency]}</td><td><>{execution && <Badge tone={execution.tone}>{execution.label}</Badge>}{(!execution || task.status !== 'confirmed') && <Badge tone={definition.tone}>{definition.label}</Badge>}</></td></tr>;
      }) : <tr><th scope="row" className="dw-simple-unit"><FolderOpen size={18}/><strong>{unit.title}</strong><span>{person(unit.ownerId)?.name || '담당자 확인 필요'}</span></th><td colSpan={5} className="dw-simple-secondary">등록된 세부업무가 없습니다.</td></tr>}</tbody>)}</table></div> : <EmptyState title="조건에 맞는 업무가 없습니다." description="검색어 또는 팀·담당자 필터를 바꿔 주세요."/>}
    </section>
    <p className="dw-caption dw-last-updated">마지막 조회 {dateTime(w.serverTime)} · 열람 가능한 업무는 실행 상태를 표시하며, 상세 열람 권한이 없는 업무는 기준 상태만 표시합니다.</p>
  </div>;
}

export function DepartmentWork({ workspace: w, command, onOpenTask, onRefresh, overview = false, onManage, onEvaluate }: ViewProps) {
  const [selectedDepartment, setSelectedDepartment] = useState(w.currentUser.departmentId);
  const [query, setQuery] = useState('');
  const [team, setTeam] = useState('all');
  const [onlyAttention, setOnlyAttention] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const isAdmin = w.currentUser.role === 'admin';
  const departmentId = isAdmin && w.departments.some(item => item.id === selectedDepartment) ? selectedDepartment : w.currentUser.departmentId;
  const department = w.departments.find(item => item.id === departmentId);
  const data = departmentData(w, departmentId);
  const teams = Array.from(new Set(data.rows.map(row => row.person.team)));
  const filtered = data.rows.filter(row => (team === 'all' || row.person.team === team) && (!onlyAttention || row.overdue > 0) && `${row.person.name} ${row.person.team} ${row.units.map(unit => unit.title).join(' ')} ${row.tasks.map(task => task.title).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));
  const performanceCount = new Set((w.unitScorePlans || []).filter(plan => plan.departmentId === departmentId && canEvaluateUnitPerformance(w, w.currentUser, plan.personId, plan.period, new Date(w.serverTime))).map(plan => JSON.stringify([plan.personId, plan.period]))).size;
  if (!['head', 'admin'].includes(w.currentUser.role)) return <EmptyState title="부서 업무분장 확인 화면입니다." description="부서장 또는 관리자 계정으로 부서원의 업무를 확인할 수 있습니다." />;
  return <div className="dw-view">
    <div className="page-heading"><div><p className="eyebrow">{overview ? '부서장 워크스페이스' : '부서의 업무와 역할'}</p><h1>{overview ? `${w.currentUser.name}님, 부서 업무를 살펴보세요.` : '업무분장표'}</h1><p>{department?.name} · 팀·직원별 단위업무와 세부업무를 함께 확인하고 업무분장을 확정합니다.</p></div><div className="dw-heading-actions">{onRefresh && <Button variant="secondary" disabled={refreshing} onClick={async () => { setRefreshing(true); setRefreshError(''); try { await onRefresh(); } catch (error) { setRefreshError(error instanceof Error ? error.message : '현황을 새로 불러오지 못했습니다.'); } finally { setRefreshing(false); } }}><RefreshCw size={15} className={refreshing ? 'spin' : ''} />현황 새로고침</Button>}{overview && onManage && <Button onClick={onManage}>업무분장 살펴보기 <ArrowRight size={16} /></Button>}</div></div>
    {isAdmin && <label className="dw-department-select"><Building2 size={18} /><span>관리할 부서</span><select aria-label="업무분장 부서" value={departmentId} onChange={event => { setSelectedDepartment(event.target.value); setTeam('all'); setQuery(''); setOnlyAttention(false); }}>{w.departments.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
    {refreshError && <p role="alert" className="form-error">{refreshError}</p>}
    <PlanStatus key={departmentId} workspace={w} departmentId={departmentId} command={command} unitCount={data.units.length} taskCount={data.tasks.length} />
    <section className="dw-stats" aria-label="부서 업무 요약">{[{ label: '업무 담당 직원', count: data.rows.length, unit: '명', icon: Users }, { label: '단위업무', count: data.units.length, unit: '개', icon: FolderOpen }, { label: '세부업무', count: data.tasks.length, unit: '건', icon: FileText }, { label: '실행 완료', count: data.completed, unit: '건', icon: CheckCheck }, { label: '기한 경과', count: data.overdue, unit: '건', icon: CalendarDays }].map(({ label, count, unit, icon: Icon }) => <div key={label} data-attention={label === '기한 경과' && count > 0}><span>{label}<Icon size={17} /></span><strong>{count}<small>{unit}</small></strong></div>)}</section>
    <section className="dw-hierarchy-section" aria-label="팀·직원·단위업무·세부업무 전체 현황">
      <div className="dw-hierarchy-heading"><div><p className="eyebrow">한눈에 보는 업무분장</p><h2>팀에서 세부업무까지</h2></div><div className="dw-hierarchy-path" aria-label="업무 구조"><span>팀</span><ChevronRight size={13} /><span>직원</span><ChevronRight size={13} /><span>단위업무</span><ChevronRight size={13} /><strong>세부업무</strong></div></div>
      <div className="dw-toolbar"><div className="dw-filters"><select aria-label="업무분장 팀 필터" value={team} onChange={event => setTeam(event.target.value)}><option value="all">모든 팀</option>{teams.map(value => <option key={value} value={value}>{value || '팀 미지정'}</option>)}</select><button type="button" className={'dw-attention-filter ' + (onlyAttention ? 'active' : '')} aria-pressed={onlyAttention} onClick={() => setOnlyAttention(!onlyAttention)}>기한 경과 직원만</button><span>{filtered.length}명 · {filtered.reduce((sum, row) => sum + row.tasks.length, 0)}개 세부업무</span></div><label className="dw-search"><Search size={16} /><input aria-label="부서 업무분장 검색" value={query} onChange={event => setQuery(event.target.value)} placeholder="직원·팀·업무 검색" /></label></div>
      <p className="dw-caption"><FolderOpen size={15} />직원별 단위업무와 세부업무를 모두 펼쳐 보여줍니다. 업무 제목이나 상세 보기를 누르면 업무 내용·절차·예산·근거를 확인할 수 있습니다.</p>
      {filtered.length ? <DepartmentHierarchy workspace={w} rows={filtered} units={data.units} onOpenTask={onOpenTask} /> : <EmptyState title="조건에 맞는 직원이 없습니다." description="팀·검색어·기한 경과 필터를 조정해 주세요." />}
    </section>
    {onEvaluate && <button className="dw-evaluation-link" onClick={onEvaluate}><ShieldCheck size={21} /><span><strong>개인별 반기 성과 · 단위업무 평가</strong><small>직원이 성과와 업무 비중 50점을 제출하면 단위업무별로 평가합니다.</small></span><Badge tone={performanceCount ? 'info' : 'soft'}>제출 후 평가 대기 {performanceCount}건</Badge><ArrowRight size={17} /></button>}
    <DepartmentCommon workspace={w} departmentId={departmentId} onOpenTask={onOpenTask} />
    <p className="dw-caption dw-last-updated">마지막 조회 {dateTime(w.serverTime)} · 업무분장 확정 여부와 실행 완료 여부는 별도로 관리합니다.</p>
  </div>;
}

function DepartmentHierarchy({ workspace: w, rows, units, onOpenTask }: { workspace: Workspace; rows: ReturnType<typeof departmentData>['rows']; units: Workspace['units']; onOpenTask: (id: string) => void }) {
  const teams = Array.from(new Set(rows.map(row => row.person.team))).map(team => {
    const people = rows.filter(row => row.person.team === team).map(row => {
      const unitIds = Array.from(new Set([...row.units.map(unit => unit.id), ...row.tasks.map(task => task.unitId)]));
      const groups = (unitIds.length ? unitIds : [null]).map(unitId => {
        const tasks = row.tasks.filter(task => task.unitId === unitId);
        return { unit: units.find(unit => unit.id === unitId), tasks: tasks.length ? tasks : [null] };
      });
      return { ...row, groups, rowCount: groups.reduce((sum, group) => sum + group.tasks.length, 0) };
    });
    return { name: team, people, rowCount: people.reduce((sum, person) => sum + person.rowCount, 0), taskCount: people.reduce((sum, person) => sum + person.tasks.length, 0) };
  });
  return <div className="dw-hierarchy-scroll" role="region" aria-label="팀별 업무분장 표" tabIndex={0}><table className="dw-hierarchy-table">
    <caption className="dw-visually-hidden">팀, 직원, 개인별 단위업무와 세부업무. 모든 업무를 펼쳐 표시하며 세부업무별 상세 보기로 이동할 수 있습니다.</caption>
    <colgroup><col className="dw-col-team" /><col className="dw-col-person" /><col className="dw-col-unit" /><col className="dw-col-task" /><col className="dw-col-execution" /><col className="dw-col-action" /></colgroup>
    <thead><tr><th scope="col">팀</th><th scope="col">직원</th><th scope="col">단위업무</th><th scope="col">세부업무</th><th scope="col">진행 · 기한</th><th scope="col">상세</th></tr></thead>
    {teams.map(team => <tbody key={team.name}>{team.people.flatMap((row, personIndex) => row.groups.flatMap((group, unitIndex) => group.tasks.map((task, taskIndex) => {
      const execution = task ? taskExecution(w, task) : null;
      const definition = task ? definitionState(task.status) : null;
      const firstPersonRow = unitIndex === 0 && taskIndex === 0;
      return <tr key={`${row.person.id}-${group.unit?.id || 'empty'}-${task?.id || 'empty'}`} className={firstPersonRow ? 'dw-hierarchy-person-start' : ''}>
        {personIndex === 0 && firstPersonRow && <th scope="rowgroup" rowSpan={team.rowCount} className="dw-hierarchy-team"><span className="dw-team-symbol"><Users size={17} /></span><strong>{team.name || '팀 미지정'}</strong><small>{team.people.length}명 · 세부 {team.taskCount}건</small></th>}
        {firstPersonRow && <td rowSpan={row.rowCount} className="dw-hierarchy-person"><span className="avatar">{row.person.name.slice(0, 1)}</span><strong>{row.person.name}</strong><span>{row.person.title}</span>{!row.person.active && <small>기존 담당자</small>}<small>단위 {row.units.length}개<br />세부 {row.tasks.length}건</small>{row.overdue > 0 && <small className="dw-warning">기한 경과 {row.overdue}건</small>}</td>}
        {taskIndex === 0 && <td rowSpan={group.tasks.length} className="dw-hierarchy-unit">{group.unit ? <><span className="dw-cell-label"><FolderOpen size={13} />단위업무</span><strong>{group.unit.title}</strong>{group.unit.description && <p title={group.unit.description}>{group.unit.description}</p>}{group.unit.ownerId !== row.person.id && <small>공유 단위 · {nameOf(w, group.unit.ownerId)}</small>}</> : <span className="dw-cell-empty">등록된 단위업무 없음</span>}</td>}
        <td className="dw-hierarchy-task">{task ? <><div className="dw-hierarchy-task-meta"><Badge tone={task.commonId ? 'info' : 'soft'}>{task.commonId ? '공통' : '개인'}</Badge>{task.status !== 'confirmed' && definition && <Badge tone={definition.tone}>{definition.label}</Badge>}</div><button className="dw-task-link" onClick={() => onOpenTask(task.id)}>{task.title}<ArrowUpRight size={13} /></button>{task.description && <p title={task.description}>{task.description}</p>}</> : <span className="dw-cell-empty">등록된 세부업무 없음</span>}</td>
        <td className="dw-hierarchy-execution">{execution ? <><Badge tone={execution.tone}>{execution.label}</Badge>{execution.overdue && <Badge tone="warning">기한 경과</Badge>}<div className="dw-progress"><Progress value={execution.progress} /><span>{execution.progress}%</span></div><small>업무 마감 {formatDate(execution.dueDate, { today: w.serverTime })}</small></> : <span className="dw-cell-empty">—</span>}</td>
        <td className="dw-hierarchy-action">{task && <button type="button" onClick={() => onOpenTask(task.id)} aria-label={`${row.person.name} · ${task.title} 상세 보기`}><span>상세 보기</span><ArrowUpRight size={14} /></button>}</td>
      </tr>;
    })))}</tbody>)}
  </table></div>;
}

function PlanStatus({ workspace: w, departmentId, command, unitCount, taskCount }: { workspace: Workspace; departmentId: string; command: CommandFn; unitCount: number; taskCount: number }) {
  const [action, setAction] = useState<'confirm' | 'reopen' | null>(null);
  const revision = useRevisionCommand(w, command, action ? { kind: 'departmentPlan', id: departmentId } : null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const [savedReason, setSavedReason] = useState('');
  const latestReason = useRef(reason); latestReason.current = reason;
  const draftId = useUnsavedChanges(!!action && (saving || reason !== savedReason), '업무분장 재작성 사유');
  const { requestNavigation, clearDraft } = useUnsavedNavigation();
  const plan = w.departmentWorkPlans?.find(item => item.departmentId === departmentId);
  const confirmed = plan?.status === 'confirmed';
  const departmentName = w.departments.find(item => item.id === departmentId)?.name || '선택 부서';
  const close = () => { if (!saving) requestNavigation(() => { clearDraft(draftId); setAction(null); setReason(''); setSavedReason(''); setReceipt(''); setError(''); }); };
  return <><section className={'dw-plan-state ' + (confirmed ? 'confirmed' : '')}><span className="dw-plan-icon">{confirmed ? <LockKeyhole size={22} /> : <UnlockKeyhole size={22} />}</span><div><div className="dw-plan-title"><h2>{confirmed ? '업무분장이 확정되었습니다.' : '업무분장을 작성하고 있습니다.'}</h2><Badge tone={confirmed ? 'success' : 'info'}>{confirmed ? '확정' : '작성 가능'} · v{plan?.version || 0}</Badge></div><p>{confirmed ? '직원의 단위·세부업무 내용 변경은 잠깁니다. 재작성 허용 후 수정할 수 있습니다.' : '직원이 자신의 업무를 작성·수정할 수 있습니다. 부서 전체 분장을 확인한 뒤 확정해 주세요.'}</p>{confirmed && plan?.confirmedAt && <small>{nameOf(w, plan.confirmedBy)} · {dateTime(plan.confirmedAt)} 확정</small>}{!confirmed && plan?.reopenedAt && <small>{nameOf(w, plan.reopenedBy)} · {dateTime(plan.reopenedAt)} 재작성 허용{plan.reason && <> · 사유: {plan.reason}</>}</small>}</div><Button variant={confirmed ? 'secondary' : 'primary'} onClick={() => requestNavigation(() => { clearDraft(draftId); setAction(confirmed ? 'reopen' : 'confirm'); setReason(''); setSavedReason(''); setReceipt(''); setError(''); })}>{confirmed ? <><UnlockKeyhole size={16} />재작성 허용</> : <><ShieldCheck size={16} />부서 업무분장 확정</>}</Button></section>
    {action && <Modal title={action === 'confirm' ? '부서 업무분장을 확정할까요?' : '부서 업무분장 재작성 허용'} description={`${departmentName} · 부서 전체 업무분장에 적용됩니다.`} onClose={close}><form className="form-stack" onSubmit={async event => { event.preventDefault(); if (saving || receipt || revision.conflicted) return; const submittedReason = reason; if (action === 'reopen' && !reason.trim()) { setError('재작성 허용 사유를 입력해 주세요.'); return; } setSaving(true); setError(''); try { const success = await revision.command(`department.${action}`, { departmentId, ...(action === 'reopen' ? { reason: reason.trim() } : {}) }); if (success) { setSavedReason(submittedReason); if (latestReason.current === submittedReason) { clearDraft(draftId); setAction(null); setReason(''); setSavedReason(''); } else setReceipt('요청 시점의 사유로 처리했습니다. 이후 작성한 내용은 입력칸에 보존했으며 처리 내역에는 포함되지 않았습니다.'); } else setError('변경하지 못했습니다. 표시된 안내를 확인한 뒤 다시 시도해 주세요.'); } catch (caught) { setError(caught instanceof Error ? caught.message : '변경하지 못했습니다.'); } finally { setSaving(false); } }}>{revision.conflict}<div className="dw-confirm-summary"><Building2 size={23} /><div><strong>{departmentName}</strong><p>단위업무 {unitCount}개 · 등록된 세부업무 {taskCount}건</p></div></div><p className="dw-modal-copy">{action === 'confirm' ? '등록된 세부업무를 검증·확정하고 부서 업무분장 기록을 저장합니다. 실행 회차가 없는 업무는 현재 회차를 만듭니다. 업무 내용의 추가·수정·삭제는 잠기며, 실행 진행과 성과 기록은 계속할 수 있습니다. 이후 내용을 바꾸려면 재작성 허용이 필요합니다.' : '직원들이 업무분장 내용을 다시 수정할 수 있도록 허용합니다. 기존 확정 기록은 유지되며, 수정이 끝나면 다시 확정할 수 있습니다.'}</p>{action === 'reopen' && <Field name="reason" label="재작성 허용 사유"><textarea required rows={4} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} placeholder="예: 조직 내 담당 조정에 따른 세부업무 재정리" /></Field>}{error && <p role="alert" className="form-error">{error}</p>}{receipt && <p role="status" className="dw-modal-copy">{receipt}</p>}<div className="form-actions"><Button variant="secondary" disabled={saving} onClick={close}>취소</Button><Button type="submit" disabled={saving || revision.conflicted || !!receipt}>{saving ? '저장 중…' : action === 'confirm' ? '업무분장 확정' : '재작성 허용'}</Button></div></form></Modal>}
  </>;
}

function DepartmentCommon({ workspace: w, departmentId, onOpenTask }: { workspace: Workspace; departmentId: string; onOpenTask: (id: string) => void }) {
  const rows = w.commonTasks.flatMap(common => common.distributions.filter(distribution => distribution.departmentId === departmentId).map(distribution => ({ common, distribution })));
  const stageFor = (distribution: CommonDistribution) => distribution.stage || (distribution.status === 'pending' ? 'team_pending' : distribution.status === 'team_assigned' ? 'person_pending' : distribution.status === 'person_assigned' ? 'registration_pending' : distribution.status === 'submitted' ? 'completed' : 'in_progress');
  const pending = rows.filter(({ distribution }) => ['team_pending', 'person_pending', 'registration_pending'].includes(stageFor(distribution))).length;
  return <section className="panel dw-common"><div className="panel-header"><div><p className="eyebrow">부서 공통업무 · 읽기 요약</p><h2>함께 배정받은 업무</h2></div><div className="dw-common-counts"><Badge tone="outline">전체 {rows.length}건</Badge><Badge tone={pending ? 'info' : 'soft'}>배정·등록 대기 {pending}건</Badge></div></div>{rows.length ? <div className="dw-common-list">{rows.map(({ common, distribution }) => { const stage = stageFor(distribution); const task = w.tasks.find(item => item.id === distribution.taskId && !item.deletedAt); const canOpen = task && ['registered', 'assigned', 'submitted'].includes(distribution.status); const status = stage === 'in_progress' ? commonExecutionState(distribution.executionStatus ?? 'not_started') : commonStageState(stage); return <article key={distribution.id}><span className="dw-common-icon"><GitBranch size={20} /></span><div className="dw-common-main"><strong>{common.title}</strong><p>{distribution.team || '팀 미배정'} · {nameOf(w, distribution.currentAssigneeId || distribution.assigneeId)}{distribution.dueDate && <> · {formatDate(distribution.dueDate, { today: w.serverTime })} 마감</>}</p><small>{distribution.nextAction || '담당자의 다음 절차를 기다리고 있습니다.'}</small></div><div className="dw-common-status"><Badge tone={status.tone}>{status.label}</Badge>{distribution.overdue && <Badge tone="warning">기한 경과</Badge>}<div className="dw-progress"><Progress value={distribution.progress || 0} /><span>{distribution.progress || 0}%</span></div></div>{canOpen && <Button variant="ghost" onClick={() => onOpenTask(task.id)}>업무 보기 <ArrowUpRight size={15} /></Button>}</article>; })}</div> : <EmptyState title="배정받은 공통업무가 없습니다." description="작성 부서장의 승인을 거쳐 이 부서에 접수된 업무의 배정·실행 상태가 표시됩니다." />}</section>;
}

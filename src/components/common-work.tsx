'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, Building2, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, Clock3, FileText, Folder, GitBranch, Layers3, LayoutList, ListChecks, Plus, RefreshCw, Search, Send, Table2, UserRound, Users, X } from 'lucide-react';
import type { CommonApprovalRequest, CommonDistribution, CommonTask, DirectiveIssuer, User, Workspace } from '@/lib/types';
import { Badge, Button, EmptyState, Field, HelpButton, HelpCallout, Modal, Progress, Tabs, useTabs, useHelpControls, validateTextFields, type CommandFn } from './ui';
import { sameDraft } from '@/lib/pending-draft';
import { useRevisionCommand } from './command-revision';
import { CommonRegistrationModal } from './common-registration-modal';
import { useUnsavedChanges, useUnsavedNavigation } from './unsaved-changes';
import { useNotificationFocus } from './notification-focus';
import './common-work.css';
import { isDepartmentConfirmed } from '@/lib/work-division';
import { canManageDirective, canRecordDirectiveReport, directiveIssuerLabels, isCentralDirective, isDirectiveCoordinator } from '@/lib/directives';
import { DirectiveMonthlyReports } from './directive-monthly';
import { canCreateCommon, canReviewCommon, commonPublished } from '@/lib/common-approval';
import { DirectiveMetadataEditor, DirectiveOverview } from './directive-overview';
import { taskExecution } from '@/lib/common-status';
import { commonExecutionState, commonStageLabel, commonStageState, executionStatus as taskExecutionStatus } from '@/lib/status-labels';
import { formatDate as shortDate, formatDateFull as dateLabel, formatDateTimeFull, isPastDate } from '@/lib/date-format';

type Props = { workspace: Workspace; command: CommandFn };
function useMountedDraft() { const mounted = useRef(true); useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []); return mounted; }
type CommonProps = Props & { onOpenTask: (id: string) => void; onRefresh?: () => Promise<void>; onGoPersonal?: () => void; focusId?: string; focusToken?: number };
type Stage = 'team_pending' | 'person_pending' | 'registration_pending' | 'in_progress' | 'completed';
type ExecutionStatus = 'not_started' | 'in_progress' | 'review' | 'completed' | 'paused' | 'archived' | 'deleted';
type Distribution = CommonDistribution & { stage?: Stage; executionStatus?: ExecutionStatus; nextActorIds?: string[]; nextAction?: string; completedSteps?: number; totalSteps?: number; dueDate?: string; updatedAt?: string; overdue?: boolean; unitTitle?: string; runId?: string; period?: string; progressSource?: 'run' | 'task' | 'none'; teamAssignedAt?: string; personAssignedAt?: string; registeredAt?: string; currentAssigneeId?: string; taskOwnerId?: string };
type Row = { common: CommonTask; distribution: Distribution; stage: Stage; executionStatus: ExecutionStatus; progress: number; completedSteps: number; totalSteps: number; dueDate: string; overdue: boolean; unitTitle: string; nextActorIds: string[]; nextAction: string; canTeam: boolean; canPerson: boolean; canRegister: boolean; canOpen: boolean; actionable: boolean };
type Actions = { assign: (row: Row, mode: 'team' | 'person') => void; register: (row: Row) => void; report: (row: Row) => void; open: (taskId: string) => void; goPersonal?: () => void };

const approvalStatusLabels = { pending: '부서장 승인 대기', approved: '승인·배포 완료', rejected: '반려' };
const roleLabels: Record<User['role'], string> = { admin: '관리자', head: '부서장', manager: '부서 담당자', lead: '팀장', member: '업무 담당자' };
const frequencyLabels = { once: '1회', monthly: '매월', quarterly: '분기별', half_yearly: '반기별', yearly: '매년' };
const stageOrder: Stage[] = ['team_pending', 'person_pending', 'registration_pending', 'in_progress', 'completed'];
const departmentName = (w: Workspace, id: string) => (w.departmentDirectory ?? w.departments).find(item => item.id === id)?.name || '부서 미지정';
const userName = (w: Workspace, id?: string) => w.users.find(user => user.id === id)?.name || w.identities?.find(user => user.id === id)?.name || '미배정';
const canManageCommon = (user: User) => canCreateCommon(user);

function toRow(w: Workspace, common: CommonTask, distribution: Distribution): Row {
  const task = w.tasks.find(item => item.id === distribution.taskId);
  const registered = ['registered', 'assigned', 'submitted'].includes(distribution.status);
  const execution = taskExecution(w, registered ? task : undefined);
  const latest = execution.run;
  const totalSteps = distribution.totalSteps ?? (registered ? (latest?.steps.length || task?.workflow.length || 0) : 0);
  const completedSteps = distribution.completedSteps ?? (registered ? (latest?.steps.filter(step => step.status === 'completed').length ?? task?.workflow.filter(step => step.done).length ?? 0) : 0);
  const progress = Math.max(0, Math.min(100, distribution.progress ?? (totalSteps ? Math.round(completedSteps / totalSteps * 100) : 0)));
  const fallbackKey = task && registered ? taskExecutionStatus(task, latest, progress, execution.nextRole).key : 'scheduled';
  const executionStatus: ExecutionStatus = distribution.executionStatus ?? (task?.deletedAt ? 'deleted' : task?.status === 'archived' ? 'archived' : fallbackKey === 'scheduled' ? 'not_started' : fallbackKey);
  const stage: Stage = distribution.stage ?? (distribution.status === 'pending' ? 'team_pending' : distribution.status === 'team_assigned' ? 'person_pending' : distribution.status === 'person_assigned' ? 'registration_pending' : executionStatus === 'completed' ? 'completed' : 'in_progress');
  const dueDate = distribution.dueDate || common.dueDate;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(w.serverTime));
  const overdue = distribution.overdue ?? (dueDate < today && stage !== 'completed' && !['paused', 'archived', 'deleted'].includes(executionStatus));
  const nextStep = task?.workflow.find(step => !step.done);
  const nextActorIds = distribution.nextActorIds ?? (stage === 'team_pending' ? w.users.filter(user => user.active && user.role === 'manager' && user.departmentId === distribution.departmentId).map(user => user.id) : stage === 'person_pending' ? [distribution.leadId].filter(Boolean) as string[] : stage === 'registration_pending' ? [distribution.assigneeId].filter(Boolean) as string[] : stage === 'in_progress' ? [nextStep?.role === 'reviewer' ? task?.reviewerId : distribution.assigneeId || task?.primaryId].filter(Boolean) as string[] : []);
  const nextAction = isDepartmentConfirmed(w, distribution.departmentId) && ['team_pending', 'person_pending', 'registration_pending'].includes(stage) ? '업무분장이 확정되어 있습니다. 부서장이 재작성을 허용한 후 배정을 진행하세요.' : distribution.nextAction || (stage === 'team_pending' ? '부서 담당자가 팀과 팀장을 지정합니다.' : stage === 'person_pending' ? '배정받은 팀장이 업무 담당자를 지정합니다.' : stage === 'registration_pending' ? '업무 담당자가 내 단위업무에 등록합니다.' : stage === 'in_progress' ? executionStatus === 'review' ? '검토자가 업무 절차를 확인합니다.' : executionStatus === 'paused' ? '중지된 업무의 재개 여부를 확인합니다.' : executionStatus === 'archived' ? '보관된 업무입니다.' : executionStatus === 'deleted' ? '삭제된 업무입니다.' : '업무 담당자가 세부업무를 수행합니다.' : '모든 절차를 완료했습니다.');
  const user = w.currentUser;
  const divisionLocked = isDepartmentConfirmed(w, distribution.departmentId);
  const canTeam = !divisionLocked && distribution.status === 'pending' && (user.role === 'admin' || user.role === 'manager' && user.departmentId === distribution.departmentId);
  const canPerson = !divisionLocked && distribution.status === 'team_assigned' && (user.role === 'admin' || user.role === 'lead' && distribution.leadId === user.id && user.departmentId === distribution.departmentId);
  const canRegister = !divisionLocked && distribution.status === 'person_assigned' && distribution.assigneeId === user.id;
  const canOpen = !!task && !task.deletedAt && registered;
  return { common, distribution, stage, executionStatus, progress, completedSteps, totalSteps, dueDate, overdue, unitTitle: distribution.unitTitle || w.units.find(unit => unit.id === task?.unitId)?.title || '', nextActorIds, nextAction, canTeam, canPerson, canRegister, canOpen, actionable: canTeam || canPerson || canRegister || (canOpen && stage === 'in_progress' && nextActorIds.includes(user.id) && !['archived', 'deleted', 'paused'].includes(executionStatus)) };
}

function summarize(rows: Row[]) {
  const stages = Object.fromEntries(stageOrder.map(stage => [stage, rows.filter(row => row.stage === stage).length])) as Record<Stage, number>;
  return { stages, total: rows.length, tasks: new Set(rows.map(row => row.common.id)).size, overdue: rows.filter(row => row.overdue).length, action: rows.filter(row => row.actionable).length, average: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.progress, 0) / rows.length) : 0 };
}

export function CommonWork({ workspace: w, command, onOpenTask, onRefresh, onGoPersonal, focusId, focusToken }: CommonProps) {
  const coordinator = isDirectiveCoordinator(w, w.currentUser);
  const centralAccess = coordinator || w.currentUser.role === 'admin';
  const canCreate = canCreateCommon(w.currentUser, new Date(w.serverTime));
  const [scope, setScope] = useState('all');
  const [departmentId, setDepartmentId] = useState('all');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [stage, setStage] = useState<Stage | 'all' | 'overdue'>('all');
  const [view, setView] = useState<'work' | 'table'>('work');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [create, setCreate] = useState(false);
  const [resubmitting, setResubmitting] = useState<CommonTask | null>(null);
  const [reviewing, setReviewing] = useState<{ commonId: string; requestId: string } | null>(null);
  const [approvalFilter, setApprovalFilter] = useState<'pending' | 'rejected' | 'all'>(w.currentUser.role === 'head' ? 'pending' : 'all');
  const [assignment, setAssignment] = useState<{ row: Row; mode: 'team' | 'person' } | null>(null);
  const [registering, setRegistering] = useState<Row | null>(null);
  const [distributing, setDistributing] = useState<CommonTask | null>(null);
  const [reporting, setReporting] = useState<{ commonId: string; distributionId: string; month?: string } | null>(null);
  const [metadata, setMetadata] = useState<CommonTask | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const help = useHelpControls(w.currentUser.id, ['common.approval-flow', 'common.assignment-flow', 'common.metrics', 'common.additional-distribution']);
  const approvalTabs = useTabs({ value: approvalFilter, onChange: setApprovalFilter, items: [
    { value: 'pending', label: '승인 대기' }, { value: 'rejected', label: '반려' }, { value: 'all', label: '요청·처리 이력' },
  ] });
  const scopeTabs = useTabs({ value: scope, onChange: setScope, items: [
    ...(centralAccess ? [{ value: 'central', label: '장·차관 지시사항' }] : []),
    ...(canManageCommon(w.currentUser) ? [{ value: 'managed', label: '내가 작성·총괄하는 업무' }] : []),
    { value: 'action', label: '내 처리 대상' }, { value: 'all', label: '전체 조회' },
  ] });
  const rows = w.commonTasks.filter(commonPublished).flatMap(common => common.distributions.map(distribution => toRow(w, common, distribution)));
  const contextRows = rows.filter(row => (scope !== 'central' || isCentralDirective(row.common)) && (scope !== 'managed' || row.common.managerId === w.currentUser.id) && (scope !== 'action' || row.actionable) && (departmentId === 'all' || row.distribution.departmentId === departmentId) && (kind === 'all' || (row.common.kind || 'common') === kind) && `${row.common.title} ${row.common.description} ${row.common.projectName || ''} ${row.common.directiveIssuer ? directiveIssuerLabels[row.common.directiveIssuer] : ''} ${departmentName(w, row.distribution.departmentId)} ${row.distribution.team || ''} ${userName(w, row.distribution.leadId)} ${userName(w, row.distribution.currentAssigneeId)} ${userName(w, row.distribution.assigneeId)} ${userName(w, row.distribution.taskOwnerId)} ${row.unitTitle}`.toLowerCase().includes(query.trim().toLowerCase()));
  const summary = summarize(contextRows);
  const visible = contextRows.filter(row => stage === 'all' || (stage === 'overdue' ? row.overdue : row.stage === stage));
  const grouped = w.commonTasks.map(common => ({ common, rows: visible.filter(row => row.common.id === common.id), context: contextRows.filter(row => row.common.id === common.id) })).filter(group => group.rows.length > 0);
  const actions: Actions = { assign: (row, mode) => setAssignment({ row, mode }), register: setRegistering, report: row => setReporting({ commonId: row.common.id, distributionId: row.distribution.id }), open: onOpenTask, goPersonal: onGoPersonal };
  const reportCommon = reporting ? w.commonTasks.find(item => item.id === reporting.commonId) : undefined;
  const reportCommons = w.commonTasks.filter(isCentralDirective).map(common => ({ ...common, distributions: contextRows.filter(row => row.common.id === common.id).map(row => row.distribution) })).filter(common => common.distributions.length > 0);
  const reportDistribution = reportCommon?.distributions.find(item => item.id === reporting?.distributionId);
  const approvalEntries = w.commonTasks.flatMap(common => (common.approvalRequests ?? []).filter(request => w.currentUser.role === 'admin' || request.requestedBy === w.currentUser.id || common.managerId === w.currentUser.id || request.departmentId === w.currentUser.departmentId && ['head', 'manager'].includes(w.currentUser.role)).map(request => ({ common, request }))).sort((a, b) => b.request.requestedAt.localeCompare(a.request.requestedAt));
  const visibleApprovals = approvalEntries.filter(entry => approvalFilter === 'all' || entry.request.status === approvalFilter);
  const reviewCommon = reviewing ? w.commonTasks.find(common => common.id === reviewing.commonId) : undefined;
  const reviewRequest = reviewCommon?.approvalRequests?.find(request => request.id === reviewing?.requestId);
  const scopeLabel = scope === 'central' ? '장·차관 지시사항 통합 관리' : scope === 'managed' ? '내가 작성·총괄하는 업무' : scope === 'action' ? '내 처리 대상' : '조회 가능한 전체';
  const queryLabel = [scopeLabel, departmentId !== 'all' ? departmentName(w, departmentId) : '전체 부서', kind === 'directive' ? '지시사항' : kind === 'common' ? '공통업무' : '전체 종류', query.trim() ? `검색: ${query.trim()}` : ''].filter(Boolean).join(' · ');
  const reset = () => { setDepartmentId('all'); setQuery(''); setKind('all'); setStage('all'); };
  const activeFilters = departmentId !== 'all' || !!query.trim() || kind !== 'all' || stage !== 'all';
  const focusProps = useNotificationFocus(focusId, focusToken, id => {
    const common = w.commonTasks.find(item => item.id === id);
    if (!common) return;
    const targetRows = rows.filter(row => row.common.id === id);
    const approvals = approvalEntries.filter(entry => entry.common.id === id);
    const approval = !targetRows.length ? approvals[0] : approvals.find(entry => canReviewCommon(w, w.currentUser, common, entry.request, new Date(w.serverTime)));
    if (!targetRows.length && !approval) return;
    reset(); setView('work'); setApprovalFilter('all');
    setScope(targetRows.some(row => row.actionable) ? 'action' : 'all');
    setCollapsed(current => current.filter(commonId => commonId !== id));
    setCreate(false); setResubmitting(null); setReviewing(null); setAssignment(null);
    setRegistering(null); setDistributing(null); setReporting(null); setMetadata(null);
    return approval ? `approval:${approval.request.id}` : `common:${id}`;
  });

  return <div className="cw-view">
    <div className="page-heading"><div><p className="eyebrow">함께하는 업무</p><div className="help-title"><h1>공통업무 · 지시사항</h1><HelpButton controls={help} label="공통업무 도움말 다시 보기" /></div></div><div className="cw-header-actions">{onRefresh && <Button variant="secondary" disabled={refreshing} onClick={async () => { setRefreshing(true); setRefreshError(''); try { await onRefresh(); } catch (error) { setRefreshError(error instanceof Error ? error.message : '최신 현황을 불러오지 못했습니다. 다시 시도해 주세요.'); } finally { setRefreshing(false); } }}><RefreshCw size={16} className={refreshing ? 'cw-spinning' : ''} />{refreshing ? '불러오는 중…' : '현황 새로고침'}</Button>}{canCreate && <Button onClick={() => setCreate(true)}><Plus size={17} />공통 세부업무 작성</Button>}</div></div>
    {refreshError && <p className="cw-refresh-error" role="alert">{refreshError}</p>}
    <section className="cw-approval-section" aria-label="공통업무 작성 및 배포 승인">
      <header><div><h2>작성·배포 승인</h2></div><Badge tone={approvalEntries.some(entry => entry.request.status === 'pending') ? 'warning' : 'soft'}>승인 대기 {approvalEntries.filter(entry => entry.request.status === 'pending').length}건</Badge></header>
      <HelpCallout controls={help} id="common.approval-flow" summary="부서장 승인 후 팀과 담당자를 배정합니다."><p>새 업무와 대상 부서 추가는 작성 부서장 승인 후 접수됩니다.</p></HelpCallout>
      <Tabs tabs={approvalTabs} label="공통업무 승인 조회" className="tabs cw-approval-tabs" />
      <div {...approvalTabs.panelAttrs(approvalFilter)}>
      {visibleApprovals.length ? <div className="cw-approval-list">{visibleApprovals.map(({ common, request }) => <article key={request.id} className="cw-approval-card" {...focusProps(`approval:${request.id}`)}>
        <div className="cw-approval-tags"><Badge tone={request.status === 'pending' ? 'warning' : request.status === 'approved' ? 'success' : 'outline'}>{approvalStatusLabels[request.status]}</Badge><span>{request.kind === 'additional' ? '대상 부서 추가' : '새 세부업무 등록'}</span><span>{request.snapshot.kind === 'directive' ? '지시사항' : '공통업무'}</span></div>
        <h3>{request.snapshot.title}</h3><p>{request.snapshot.description}</p><dl><div><dt>요청자</dt><dd>{userName(w, request.requestedBy)} · {departmentName(w, request.departmentId)}</dd></div><div><dt>대상 부서</dt><dd>{request.targetDepartmentIds.map(id => departmentName(w, id)).join(', ')}</dd></div><div><dt>요청 일시</dt><dd>{formatDateTimeFull(request.requestedAt)}</dd></div></dl>
        {request.reason && <p className="cw-approval-reason">{request.status === 'rejected' ? '반려 사유' : '처리 의견'}: {request.reason}</p>}
        <footer><span>{request.status === 'pending' ? '승인 전에는 대상 부서에 접수되지 않습니다.' : request.status === 'approved' ? `${userName(w, request.resolvedBy)} 승인 · ${dateLabel(request.resolvedAt)}` : '내용을 보완하여 다시 요청할 수 있습니다.'}</span><div><Button variant={canReviewCommon(w, w.currentUser, common, request, new Date(w.serverTime)) ? 'primary' : 'secondary'} onClick={() => setReviewing({ commonId: common.id, requestId: request.id })}>{canReviewCommon(w, w.currentUser, common, request, new Date(w.serverTime)) ? '검토 및 승인' : '요청 상세'}</Button>{request.kind === 'initial' && common.publicationStatus === 'rejected' && common.approvalRequests?.[0]?.id === request.id && canCreate && (common.managerId === w.currentUser.id || w.currentUser.role === 'admin') && <Button variant="secondary" onClick={() => setResubmitting(common)}>보완 후 재요청</Button>}</div></footer>
      </article>)}</div> : <p className="cw-approval-empty">{approvalFilter === 'pending' ? '승인을 기다리는 요청이 없습니다.' : approvalFilter === 'rejected' ? '반려된 요청이 없습니다.' : '아직 작성·배포 승인 요청이 없습니다. 업무 담당자는 공통 세부업무를 작성해 부서장에게 승인을 요청할 수 있습니다.'}</p>}
      </div>
      {approvalTabs.items.filter(item => item.value !== approvalFilter).map(item => <div key={item.value} {...approvalTabs.panelAttrs(item.value)} />)}
    </section>
    <HelpCallout controls={help} id="common.assignment-flow" summary="부서 접수 → 팀 배정 → 개인 배정 → 등록·수행"><p>부서 담당자가 팀·팀장을 정하고, 팀장이 업무 담당자를 지정하면 개인이 내 단위업무에 등록해 수행합니다.</p></HelpCallout>

    <section className="cw-query-panel" aria-label="공통업무 조회 조건"><div className="cw-query-top"><Tabs tabs={scopeTabs} label="공통업무 조회 범위" className="tabs cw-scope-tabs" /><span className="cw-last-refreshed"><Clock3 size={13} />마지막 조회 {formatDateTimeFull(w.serverTime)}</span></div><div className="cw-query-fields"><label className="cw-search"><Search size={17} /><input aria-label="공통업무 검색" value={query} onChange={event => setQuery(event.target.value)} placeholder="업무·사업·부서·담당자 검색" /></label><select aria-label="공통업무 대상 부서" value={departmentId} onChange={event => setDepartmentId(event.target.value)}><option value="all">전체 부서</option>{(w.departmentDirectory ?? w.departments).map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</select><select aria-label="공통업무 종류" value={kind} onChange={event => setKind(event.target.value)}><option value="all">전체 종류</option><option value="common">공통업무</option><option value="directive">지시사항</option></select>{activeFilters && <button className="cw-reset" onClick={reset}><X size={15} />조건 초기화</button>}</div></section>

    <div className="cw-scope-panel" {...scopeTabs.panelAttrs(scope)}>
    {scope === 'central' && <DirectiveOverview workspace={w} commons={reportCommons} onOpenReport={(commonId, distributionId, month) => setReporting({ commonId, distributionId, month })} />}

    <section className="cw-summary" aria-label="조회 범위 현황"><div><span>업무</span><strong>{summary.tasks}<small>건</small></strong><p>공통업무·지시사항</p></div><div><span>전체 배정</span><strong>{summary.total}<small>건</small></strong><p>업무별 대상 부서의 배정 건수</p></div><div><span>내 처리 대상</span><strong>{summary.action}<small>건</small></strong><p>현재 내 권한으로 처리할 수 있는 일</p></div><div data-tone="success"><span>완료한 배정</span><strong>{summary.stages.completed}<small>건</small></strong><p>전체 {summary.total}건 중 완료</p></div><div data-tone="warning"><span>기한 경과</span><strong>{summary.overdue}<small>건</small></strong><p>미완료 중 마감이 지난 배정</p></div></section>
    <div className="cw-summary-note"><p><span>조회 범위</span>{queryLabel}<small>위 현황과 단계별 건수는 아래 단계 필터를 적용하기 전 기준입니다.</small></p><div className="cw-average"><span>배정 건별 평균 진행률</span><Progress value={summary.average} /><b>{summary.average}%</b><small>미등록 0% 포함</small></div></div>

    <div className="cw-stage-filters" aria-label="배정 단계 필터"><button className={stage === 'all' ? 'active' : ''} aria-pressed={stage === 'all'} onClick={() => setStage('all')}>전체 단계 <b>{summary.total}</b></button>{stageOrder.map((item, index) => <button key={item} className={stage === item ? 'active' : ''} aria-pressed={stage === item} onClick={() => setStage(item)}><span className="cw-filter-number">{index + 1}</span>{commonStageLabel(item)}<b>{summary.stages[item]}</b></button>)}<button className={`${stage === 'overdue' ? 'active' : ''} cw-overdue-filter`} aria-pressed={stage === 'overdue'} onClick={() => setStage('overdue')}><Clock3 size={13} />지연 <b>{summary.overdue}</b></button></div>
    <div className="cw-results-bar"><p><b>{visible.length}건 배정</b> 표시 <span>/ 조회 범위 {summary.total}건</span>{stage !== 'all' && <Badge tone={stage === 'overdue' ? 'warning' : 'info'}>{stage === 'overdue' ? '지연' : commonStageLabel(stage)}</Badge>}</p><div className="tabs cw-view-toggle" aria-label="공통업무 보기 방식"><button className={view === 'work' ? 'active' : ''} aria-pressed={view === 'work'} onClick={() => setView('work')}><LayoutList size={15} />업무별 보기</button><button className={view === 'table' ? 'active' : ''} aria-pressed={view === 'table'} onClick={() => setView('table')}><Table2 size={15} />전체 배정표</button></div></div>

    <HelpCallout controls={help} id="common.metrics" persistentSummary summary="진행률은 절차 완료율이며, 지연은 중앙 제출기한 기준입니다."><p>평균 진행률은 미등록 0%를 포함한 배정 건별 평균이며, 현황·단계별 건수는 단계 필터 적용 전 기준입니다.</p><p>수행 단계에는 시작 전·진행 중·검토 대기·일시 중지·보관이 포함됩니다. 지연에서 일시 중지·보관·삭제는 제외하며, 내부 회차 종료일을 바꿔도 중앙 기한은 연장되지 않습니다.</p><p>확정된 수신 부서의 배정은 해당 부서장이 재작성을 허용한 후 진행합니다.</p></HelpCallout>

    {!visible.length ? <EmptyState title="현재 조건에 맞는 배정이 없습니다." description={scope === 'managed' ? '내가 총괄하는 업무가 없거나 선택한 조건에 해당하는 배정이 없습니다. 전체 조회에서 받은 업무도 확인할 수 있습니다.' : scope === 'action' ? '현재 내 권한으로 처리할 배정이나 수행 절차가 없습니다. 전체 조회에서 현황을 확인할 수 있습니다.' : '검색어·부서·단계 조건을 변경해 다시 확인해 주세요.'} action={<div className="cw-empty-actions">{activeFilters && <Button variant="secondary" onClick={reset}>조회 조건 초기화</Button>}{scope !== 'all' && <Button variant="secondary" onClick={() => setScope('all')}>전체 조회</Button>}</div>} /> : view === 'table' ? <section className="cw-flat-table"><AssignmentTable workspace={w} rows={visible} actions={actions} showWork /><HelpCallout controls={help} id="common.additional-distribution" summary="대상 부서 추가는 업무별 보기에서 진행하세요."><p>해당 업무의 ‘대상 부서 추가’를 선택해 작성 부서장에게 승인을 요청합니다.</p></HelpCallout></section> : <div className="cw-work-list">{grouped.map(({ common, rows: displayed, context }) => {
      const stats = summarize(context); const closed = collapsed.includes(common.id); const owner = common.kind === 'directive' ? canManageDirective(w, w.currentUser, common) : canManageCommon(w.currentUser) && (common.managerId === w.currentUser.id || w.currentUser.role === 'admin');
      return <article className="cw-work-card" key={common.id} data-kind={common.kind || 'common'} {...focusProps(`common:${common.id}`)}><header className="cw-work-header"><span className="cw-work-icon">{common.kind === 'directive' ? <FileText size={23} /> : <Layers3 size={23} />}</span><div className="cw-work-heading"><div className="cw-work-tags"><Badge tone={common.kind === 'directive' ? 'warning' : 'info'}>{common.kind === 'directive' ? '지시사항' : '공통업무'}</Badge>{common.projectName && <span>{common.projectName}</span>}<span>등록 {userName(w, common.managerId)}</span>{common.kind === 'directive' && <><span>지시자 {common.directiveIssuer ? directiveIssuerLabels[common.directiveIssuer] : '미입력'}</span><span>지시일자 {dateLabel(common.instructedOn)}</span>{isCentralDirective(common) && <Badge tone="info">기획재정담당관실 기획팀 통합 관리</Badge>}</>}</div><h2>{common.title}</h2><p>{common.description}</p></div><button className="cw-icon-button" aria-label={`${common.title} 배정 현황 ${closed ? '펼치기' : '접기'}`} aria-expanded={!closed} onClick={() => setCollapsed(items => closed ? items.filter(id => id !== common.id) : [...items, common.id])}>{closed ? <ChevronRight size={20} /> : <ChevronDown size={20} />}</button></header><div className="cw-work-summary"><span><CalendarDays size={14} />{dateLabel(common.dueDate)} 마감 · {frequencyLabels[common.frequency]}</span><Badge tone="success">{common.publicationStatus === "approved" ? "부서장 승인 완료" : "기존 등록 업무"}</Badge>{common.approvalRequests?.some(request => request.status === "pending") && <Badge tone="warning">추가 배포 승인 대기</Badge>}<span>범위 내 배정 <b>{context.length}건</b></span><span>완료 <b>{stats.stages.completed}건</b></span>{stats.overdue > 0 && <span className="cw-warning-text">지연 <b>{stats.overdue}건</b></span>}<div><Progress value={stats.average} /><b>{stats.average}%</b></div>{common.kind === 'directive' && owner && !common.approvalRequests?.some(request => request.status === 'pending') && <Button variant="secondary" onClick={() => setMetadata(common)}>지시정보 수정</Button>}{owner && !common.approvalRequests?.some(request => request.status === 'pending') && common.departmentIds.length < (w.departmentDirectory ?? w.departments).length && <Button variant="secondary" onClick={() => setDistributing(common)}><Plus size={14} />대상 부서 추가</Button>}</div>{!closed && <><div className="cw-group-caption"><span>현재 조건에 맞는 배정 {displayed.length}건</span><details><summary>공통 필수 절차 <ChevronDown size={13} /></summary><ol>{common.requiredSteps.map((step, index) => <li key={`${step}-${index}`}><b>{index + 1}</b>{step}</li>)}</ol></details></div><AssignmentTable workspace={w} rows={displayed} actions={actions} />{common.kind === 'directive' && <p className="cw-table-footnote"><FileText size={13} />지시사항은 팀·개인 배정과 단위업무 등록 후 수행합니다. 담당자는 완료 전까지 매월 추진실적과 다음 계획을 기록할 수 있습니다.</p>}</>}</article>;
    })}</div>}

    </div>
    {scopeTabs.items.filter(item => item.value !== scope).map(item => <div key={item.value} {...scopeTabs.panelAttrs(item.value)} />)}

    {reportCommon && reportDistribution && <DirectiveMonthlyReports key={`${reportCommon.id}-${reportDistribution.id}-${reporting?.month || 'current'}`} workspace={w} common={reportCommon} distribution={reportDistribution} command={command} initialMonth={reporting?.month} onClose={() => setReporting(null)} />}
    {metadata && <DirectiveMetadataEditor workspace={w} common={metadata} command={command} onClose={() => setMetadata(null)} />}
    {create && <CreateCommon workspace={w} command={command} onClose={() => setCreate(false)} />}
    {resubmitting && <CreateCommon key={resubmitting.id} workspace={w} command={command} existing={resubmitting} onClose={() => setResubmitting(null)} />}
    {reviewCommon && reviewRequest && <CommonApprovalReview workspace={w} command={command} common={reviewCommon} request={reviewRequest} onClose={() => setReviewing(null)} />}
    {assignment && <AssignCommon workspace={w} command={command} row={assignment.row} mode={assignment.mode} onClose={() => setAssignment(null)} />}
    {distributing && <DistributeCommon workspace={w} command={command} common={distributing} onClose={() => setDistributing(null)} />}
    {registering && <CommonRegistrationModal key={registering.distribution.id} workspace={w} command={command} commonId={registering.common.id} distributionId={registering.distribution.id} onGoPersonal={onGoPersonal} onClose={() => setRegistering(null)} />}
  </div>;
}

function CommonApprovalReview({ workspace: w, command, common, request, onClose }: Props & { common: CommonTask; request: CommonApprovalRequest; onClose: () => void }) {
  const mounted = useMountedDraft();
  const revision = useRevisionCommand(w, command, { kind: 'common', id: common.id });
  const [reason, setReason] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const allowed = canReviewCommon(w, w.currentUser, common, request, new Date(w.serverTime));
  const snapshot = request.snapshot;
  const latestReason = useRef(reason); latestReason.current = reason;
  const [processed, setProcessed] = useState(false);
  const [notice, setNotice] = useState('');
  const [savedReason, setSavedReason] = useState(reason);
  const draftId = useUnsavedChanges(reason !== savedReason, '공통업무 검토 의견');
  const { requestNavigation, clearDraft } = useUnsavedNavigation();
  const closeReview = () => requestNavigation(() => { clearDraft(draftId); onClose(); });
  async function resolve(action: 'approve' | 'reject') {
    if (saving || processed || revision.conflicted || !allowed) return;
    if (action === 'reject' && !validateTextFields([{ path: 'reason', value: reason, label: '반려 사유' }])) return;
    const submitted = reason; setSaving(true); setError('');
    try { if (await revision.command(`common.${action}`, { commonId: common.id, requestId: request.id, reason: submitted.trim() })) { if (!mounted.current) return; setProcessed(true); setSavedReason(submitted); if (latestReason.current === submitted) { clearDraft(draftId); onClose(); } else setNotice('요청한 검토 의견으로 처리했습니다. 처리 중 추가로 입력한 의견은 저장되지 않았으며 이 화면에 보관했습니다.'); } else setError('처리하지 못했습니다. 화면 위 안내를 확인하고 최신 요청을 다시 열어 주세요.'); }
    catch { setError('승인 요청을 처리하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setSaving(false); }
  }
  return <Modal title="공통업무 배포 요청 검토" description="요청 당시의 업무 내용과 대상 부서를 확인합니다." onClose={closeReview} wide>
    <div className="form-stack cw-approval-detail">
      <div className="cw-approval-tags"><Badge tone={request.status === 'approved' ? 'success' : request.status === 'pending' ? 'warning' : 'outline'}>{approvalStatusLabels[request.status]}</Badge><span>{request.kind === 'initial' ? '신규 등록' : '대상 부서 추가'}</span><span>{snapshot.kind === 'directive' ? '지시사항' : '공통업무'}</span></div>
      <h3>{snapshot.title}</h3><p className="cw-approval-description">{snapshot.description}</p>
      <dl><div><dt>작성 부서</dt><dd>{departmentName(w, request.departmentId)}</dd></div><div><dt>요청자</dt><dd>{userName(w, request.requestedBy)}</dd></div><div><dt>요청 일시</dt><dd>{formatDateTimeFull(request.requestedAt)}</dd></div><div><dt>중앙 제출기한</dt><dd>{dateLabel(snapshot.dueDate)} · {frequencyLabels[snapshot.frequency]}</dd></div>{snapshot.projectName && <div><dt>사업명</dt><dd>{snapshot.projectName}</dd></div>}{snapshot.kind === 'directive' && <><div><dt>지시자</dt><dd>{snapshot.directiveIssuer ? directiveIssuerLabels[snapshot.directiveIssuer] : '미지정'}</dd></div><div><dt>지시일자</dt><dd>{dateLabel(snapshot.instructedOn)}</dd></div></>}</dl>
      <section><h4>등록할 대상 부서 · {request.targetDepartmentIds.length}개</h4><ul className="cw-approval-targets">{request.targetDepartmentIds.map(id => <li key={id}><Building2 size={16}/>{departmentName(w, id)}</li>)}</ul></section>
      <section><h4>공통 필수 절차</h4><ol className="cw-approval-steps">{snapshot.requiredSteps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol></section>
      {request.resolvedAt && <div className="cw-form-info"><CheckCircle2 size={18}/><p>{userName(w, request.resolvedBy)} · {formatDateTimeFull(request.resolvedAt)}<br/>{request.reason || '처리 의견 없음'}</p></div>}
      {allowed || processed ? <><div className="cw-form-info"><GitBranch size={18}/><p>승인하면 선택한 부서에 공통 세부업무가 접수됩니다. 각 부서의 부서 담당자가 팀에 배정하고, 팀장이 업무 담당자를 지정합니다. 기존에 배포된 업무와 진행 기록은 유지됩니다.</p></div><Field name="reason" label="검토 의견 · 반려 시 필수" validationLabel="반려 사유"><textarea rows={3} maxLength={5000} value={reason} onChange={event => setReason(event.target.value)} placeholder="보완할 내용이나 승인 의견을 입력하세요." /></Field></> : request.status === 'pending' && <p className="muted">{departmentName(w, request.departmentId)} 부서장이 승인 또는 반려할 수 있습니다.</p>}
      {error && <p className="cw-form-error" role="alert">{error}</p>}
      {notice && <p className="cw-form-info" role="status">{notice}</p>}{revision.conflict}<div className="form-actions"><Button variant="secondary" onClick={closeReview}>닫기</Button>{allowed && !processed && <><Button variant="secondary" disabled={saving || revision.conflicted} onClick={() => void resolve('reject')}>반려</Button><Button disabled={saving || revision.conflicted} onClick={() => void resolve('approve')}><CheckCircle2 size={16}/>{saving ? '처리 중…' : '승인하여 부서에 배포'}</Button></>}</div>
    </div>
  </Modal>;
}

function StageBadge({ row }: { row: Row }) {
  const { label, tone } = row.stage === 'in_progress' ? commonExecutionState(row.executionStatus) : commonStageState(row.stage);
  return <div className="cw-stage-cell"><Badge tone={tone}><span>{stageOrder.indexOf(row.stage) + 1}</span>{label}</Badge>{row.overdue && <span className="cw-overdue-tag"><Clock3 size={11} />기한 경과</span>}</div>;
}

function ExecutionProgress({ row }: { row: Row }) {
  const registered = ['in_progress', 'completed'].includes(row.stage);
  return <div className="cw-progress-cell"><div><Progress value={row.progress} /><b>{row.progress}%</b></div><small>{registered ? `${row.completedSteps}/${row.totalSteps}개 절차 완료` : '단위업무 등록 전 · 수행 미시작'}</small>{row.distribution.period && registered && <span>{row.distribution.period}</span>}</div>;
}

function NextAction({ workspace: w, row, actions }: { workspace: Workspace; row: Row; actions: Actions }) {
  const names = row.nextActorIds.map(id => userName(w, id));
  return <div className="cw-next-action"><p>{row.nextAction}</p>{row.stage !== 'completed' && <small><UserRound size={12} />{names.length ? names.slice(0, 2).join(', ') + (names.length > 2 ? ` 외 ${names.length - 2}명` : '') : ['paused', 'archived', 'deleted'].includes(row.executionStatus) ? '진행 상태 확인 필요' : '다음 담당자 확인 필요'}</small>}<div>{row.common.kind === 'directive' && <Button variant="secondary" onClick={() => actions.report(row)}><CalendarDays size={14} />{canRecordDirectiveReport(w, w.currentUser, row.common, row.distribution, new Date(w.serverTime)) ? '월별 실적 입력' : '월별 실적 보기'}</Button>}{row.canTeam && <Button variant="secondary" onClick={() => actions.assign(row, 'team')}>팀 배정 <ArrowRight size={13} /></Button>}{row.canPerson && <Button variant="secondary" onClick={() => actions.assign(row, 'person')}>개인 배정 <ArrowRight size={13} /></Button>}{row.canRegister && <Button onClick={() => actions.register(row)}><Folder size={13} />내 단위업무에 등록</Button>}{row.canOpen && <Button variant="ghost" onClick={() => actions.open(row.distribution.taskId!)}>{row.actionable && row.stage === 'in_progress' ? row.executionStatus === 'review' ? '절차 검토' : '업무 수행' : '세부업무 보기'}<ArrowUpRight size={13} /></Button>}{row.canRegister && actions.goPersonal && <button className="cw-personal-link" onClick={actions.goPersonal}>개인업무로 이동 <ArrowRight size={12} /></button>}</div></div>;
}

function AssignmentTable({ workspace: w, rows, actions, showWork = false }: { workspace: Workspace; rows: Row[]; actions: Actions; showWork?: boolean }) {
  return <><div className="cw-table-scroll"><table className="cw-assignment-table"><thead><tr><th>{showWork ? '업무 / 대상 부서' : '대상 부서'}</th><th>배정 팀 · 팀장</th><th>업무 담당자 / 현재 수행자</th><th>등록 단위 · 현재 단계</th><th>실행 진행률</th><th>중앙 제출기한</th><th>다음 조치</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.common.id}-${row.distribution.id}`} data-overdue={row.overdue}><td>{showWork && <span className="cw-table-work-title">{row.common.title}</span>}<strong>{departmentName(w, row.distribution.departmentId)}</strong><small>접수 {shortDate(row.distribution.distributedAt, { today: w.serverTime })}</small></td><td>{row.distribution.team ? <><strong>{row.distribution.team}</strong><span>{userName(w, row.distribution.leadId)} · 팀장</span>{row.distribution.teamAssignedAt && <small>{shortDate(row.distribution.teamAssignedAt, { today: w.serverTime })} 배정</small>}</> : <span className="cw-unassigned">팀 배정 전</span>}</td><td>{row.distribution.currentAssigneeId || row.distribution.assigneeId ? <><strong>{userName(w, row.distribution.currentAssigneeId || row.distribution.assigneeId)}</strong>{row.distribution.taskOwnerId && row.distribution.currentAssigneeId && row.distribution.taskOwnerId !== row.distribution.currentAssigneeId && <small>업무 담당 · {userName(w, row.distribution.taskOwnerId)}</small>}<small>{row.distribution.personAssignedAt ? `최초 배정 ${shortDate(row.distribution.personAssignedAt, { today: w.serverTime })}${row.distribution.currentAssigneeId && row.distribution.currentAssigneeId !== row.distribution.assigneeId ? ` · ${userName(w, row.distribution.assigneeId)}` : ''}` : '업무 담당자'}</small></> : <span className="cw-unassigned">개인 배정 전</span>}</td><td><StageBadge row={row} />{row.unitTitle && ['in_progress', 'completed'].includes(row.stage) ? <span className="cw-unit-title"><Folder size={12} />{row.unitTitle}</span> : <small>{row.stage === 'registration_pending' ? '개인이 내 단위업무를 선택해야 합니다.' : '등록 전'}</small>}{row.distribution.registeredAt && <small>{shortDate(row.distribution.registeredAt, { today: w.serverTime })} 단위업무 등록</small>}</td><td><ExecutionProgress row={row} /></td><td><span className={row.overdue ? 'cw-warning-text' : ''}>{dateLabel(row.dueDate)}</span>{row.distribution.executionDueDate && row.distribution.executionDueDate !== row.dueDate && <small className={row.distribution.scheduleExceedsDeadline ? "cw-warning-text" : ""}>내부 종료 {dateLabel(row.distribution.executionDueDate)}{row.distribution.scheduleExceedsDeadline ? " · 중앙 기한 초과" : ""}</small>}{row.distribution.updatedAt && <small>변경 {shortDate(row.distribution.updatedAt, { today: w.serverTime })}</small>}</td><td><NextAction workspace={w} row={row} actions={actions} /></td></tr>)}</tbody></table></div><div className="cw-mobile-assignments">{rows.map(row => <article key={`${row.common.id}-${row.distribution.id}`} className="cw-assignment-card"><header><div>{showWork && <small>{row.common.title}</small>}<h3><Building2 size={16} />{departmentName(w, row.distribution.departmentId)}</h3></div><StageBadge row={row} /></header><div className="cw-assignment-people"><div><span>배정 팀 · 팀장</span><strong>{row.distribution.team || '팀 배정 전'}</strong><small>{row.distribution.leadId ? userName(w, row.distribution.leadId) : '부서 담당자가 지정'}</small></div><ChevronRight size={16} /><div><span>{row.distribution.currentAssigneeId ? '현재 수행자' : '업무 담당자'}</span><strong>{row.distribution.currentAssigneeId || row.distribution.assigneeId ? userName(w, row.distribution.currentAssigneeId || row.distribution.assigneeId) : '개인 배정 전'}</strong><small>{row.distribution.taskOwnerId && row.distribution.currentAssigneeId && row.distribution.taskOwnerId !== row.distribution.currentAssigneeId ? `업무 담당 · ${userName(w, row.distribution.taskOwnerId)}` : row.distribution.currentAssigneeId || row.distribution.assigneeId ? '담당자 지정 완료' : '팀장이 지정'}</small></div></div><div className="cw-mobile-unit"><Folder size={14} /><span>{row.unitTitle && ['in_progress', 'completed'].includes(row.stage) ? row.unitTitle : '단위업무 등록 전'}</span></div><ExecutionProgress row={row} /><div className="cw-mobile-deadline"><span><CalendarDays size={13} />{dateLabel(row.dueDate)} 중앙 제출기한</span><small>접수 {shortDate(row.distribution.distributedAt, { today: w.serverTime })}</small></div>{row.distribution.executionDueDate && row.distribution.executionDueDate !== row.dueDate && <p className={row.distribution.scheduleExceedsDeadline ? "cw-warning-text" : ""}>내부 종료 {dateLabel(row.distribution.executionDueDate)}{row.distribution.scheduleExceedsDeadline ? " · 중앙 기한 초과" : ""}</p>}<NextAction workspace={w} row={row} actions={actions} /></article>)}</div></>;
}

function CreateCommon({ workspace: w, command, existing, onClose }: Props & { existing?: CommonTask; onClose: () => void }) {
  const mounted = useMountedDraft();
  const revision = useRevisionCommand(w, command, existing ? { kind: 'common', id: existing.id } : null);
  const [kind, setKind] = useState<'common' | 'directive'>(existing?.kind ?? 'common');
  const [directiveIssuer, setDirectiveIssuer] = useState<DirectiveIssuer | ''>(existing?.directiveIssuer ?? '');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(w.serverTime));
  const [instructedOn, setInstructedOn] = useState(existing?.instructedOn ?? today);
  const [title, setTitle] = useState(existing?.title ?? ''); const [description, setDescription] = useState(existing?.description ?? ''); const [projectName, setProjectName] = useState(existing?.projectName ?? '');
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? ''); const [frequency, setFrequency] = useState(existing?.frequency ?? 'once');
  const [steps, setSteps] = useState(existing?.requiredSteps.join('\n') ?? '자료 준비\n내용 검증\n결과 검토\n최종 제출');
  const [mode, setMode] = useState<'all' | 'selected'>(existing ? 'selected' : 'all'); const [departmentIds, setDepartmentIds] = useState<string[]>(existing?.approvalRequests?.[0]?.targetDepartmentIds ?? []); const [saving, setSaving] = useState(false);
  const targets = mode === 'all' ? (w.departmentDirectory ?? w.departments).map(department => department.id) : departmentIds;
  const currentDraft = { kind, directiveIssuer, instructedOn, title, description, projectName, dueDate, frequency, steps, mode, departmentIds: [...departmentIds].sort() };
  const latestDraft = useRef(currentDraft); latestDraft.current = currentDraft;
  const [submittedDraft, setSubmittedDraft] = useState<typeof currentDraft | null>(null);
  const [notice, setNotice] = useState('');
  const [initialDraft] = useState(currentDraft);
  const draftId = useUnsavedChanges(!sameDraft(currentDraft, submittedDraft ?? initialDraft), existing ? '공통업무 보완·재요청' : '공통업무 작성');
  const { requestNavigation, clearDraft } = useUnsavedNavigation();
  const closeEditor = () => requestNavigation(() => { clearDraft(draftId); onClose(); });
  async function submit(event: FormEvent) {
    event.preventDefault(); if (saving || revision.conflicted || submittedDraft) return;
    const submitted = latestDraft.current; setSaving(true);
    try {
      if (await revision.command(existing ? 'common.resubmit' : 'common.create', { ...(existing ? { commonId: existing.id } : {}), title, description, projectName, dueDate, frequency, requiredSteps: steps.split('\n').map(step => step.trim()).filter(Boolean), departmentIds: targets, kind, distributionMode: mode, ...(kind === 'directive' ? { directiveIssuer, instructedOn } : {}) })) {
        if (!mounted.current) return;
        setSubmittedDraft(submitted);
        if (sameDraft(latestDraft.current, submitted)) { clearDraft(draftId); onClose(); }
        else setNotice('제출 시점의 내용으로 승인 요청을 접수했습니다. 요청 중 추가로 입력한 내용은 저장되지 않았으며 이 화면에 보관했습니다. 중복 요청은 보내지 않습니다. 보완이 필요하면 승인 요청을 확인해 주세요.');
      }
    } finally { setSaving(false); }
  }
  return <Modal title={existing ? "공통 세부업무 보완·재요청" : "공통 세부업무 작성"} description="세부업무 한 건을 작성하여 소속 부서장에게 배포 승인을 요청합니다." onClose={closeEditor} wide><form className="form-stack" onSubmit={submit}><div className="cw-kind-picker">{([['common', '공통업무', '여러 부서가 동일한 기준으로 수행'], ['directive', '지시사항', '부서장 승인 후 대상 부서에 접수']] as const).map(([value, label, help]) => <button key={value} type="button" className={kind === value ? 'selected' : ''} aria-pressed={kind === value} onClick={() => setKind(value)}><span>{value === 'common' ? <Layers3 size={19} /> : <FileText size={19} />}{label}{kind === value && <Check size={16} />}</span><small>{help}</small></button>)}</div>{kind === 'directive' && <div className="cw-directive-fields"><div className="form-grid"><Field name="directiveIssuer" label="지시자"><select required value={directiveIssuer} onChange={event => setDirectiveIssuer(event.target.value as DirectiveIssuer)}><option value="">지시자를 선택해 주세요</option>{Object.entries(directiveIssuerLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field><Field name="instructedOn" label="지시일자"><input required type="date" max={today} value={instructedOn} onChange={event => setInstructedOn(event.target.value)} /></Field></div><p>{['minister', 'vice_minister'].includes(directiveIssuer) ? '장·차관 지시사항은 기획재정담당관실 기획팀에서 일괄 관리합니다.' : '지시자와 지시일자를 등록하면 부서별 업무와 월별 실적에 함께 표시됩니다.'} 담당자는 완료 전까지 매월 실적을 기록합니다.</p></div>}<Field name="title" label="세부업무 이름"><input required maxLength={150} value={title} onChange={event => setTitle(event.target.value)} placeholder="예: 하반기 예산 집행 현황 점검" /></Field><Field name="description" label="업무 설명"><textarea required maxLength={5000} rows={3} value={description} onChange={event => setDescription(event.target.value)} placeholder="수행 목적과 제출 내용, 유의사항을 입력하세요." /></Field><div className="form-grid"><Field name="projectName" label="사업명 · 선택"><input maxLength={150} value={projectName} onChange={event => setProjectName(event.target.value)} placeholder="사업별로 배포할 때 입력" /></Field><Field name="dueDate" label="공통 마감일"><input required type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} />{isPastDate(dueDate, w.serverTime) && <small className="muted" role="status">오늘 이전 날짜입니다. 이미 지난 업무를 기록하는 경우에만 사용해 주세요.</small>}</Field><Field name="frequency" label="업무 반복 주기"><select value={frequency} onChange={event => setFrequency(event.target.value as CommonTask['frequency'])}>{Object.entries(frequencyLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field></div>{kind === 'directive' && <p className="muted">업무 반복 주기와 관계없이 월별 실적을 관리합니다.</p>}<Field name="requiredSteps" label="공통 필수 절차"><textarea required rows={4} value={steps} onChange={event => setSteps(event.target.value)} /><small className="muted">한 줄에 한 단계씩 입력합니다. 배포된 부서의 세부업무에도 이 절차가 연결됩니다.</small></Field><fieldset className="cw-fieldset"><legend>배포 대상 부서</legend><div className="cw-radio-row"><label><input type="radio" name="common-distribution" checked={mode === 'all'} onChange={() => setMode('all')} />전체 부서</label><label><input type="radio" name="common-distribution" checked={mode === 'selected'} onChange={() => setMode('selected')} />선택한 부서</label></div><div className="cw-department-picker">{(w.departmentDirectory ?? w.departments).map(department => <label key={department.id}><input type="checkbox" checked={targets.includes(department.id)} disabled={mode === 'all'} onChange={event => setDepartmentIds(event.target.checked ? [...departmentIds, department.id] : departmentIds.filter(id => id !== department.id))} /><Building2 size={15} />{department.name}</label>)}</div></fieldset><div className="cw-form-info"><GitBranch size={18} /><p>작성 부서장이 승인한 후 대상 부서에 접수됩니다. 대상 부서 담당자 → 팀장 → 업무 담당자 순서로 배정하며, 업무 담당자가 내 단위업무에 등록하여 수행합니다.</p></div>{notice && <p className="cw-form-info" role="status">{notice}</p>}{revision.conflict}<div className="form-actions"><Button variant="secondary" onClick={closeEditor}>취소</Button><Button type="submit" disabled={saving || revision.conflicted || !!submittedDraft || !targets.length || kind === 'directive' && (!directiveIssuer || !instructedOn)}><Send size={16} />{saving ? '요청 중…' : submittedDraft ? '승인 요청 접수 완료' : `${targets.length}개 부서 배포 승인 요청`}</Button></div></form></Modal>;
}

function AssignCommon({ workspace: w, command, row, mode, onClose }: Props & { row: Row; mode: 'team' | 'person'; onClose: () => void }) {
  const mounted = useMountedDraft();
  const revision = useRevisionCommand(w, command, { kind: 'common', id: row.common.id });
  const d = row.distribution;
  const candidates = w.users.filter(user => user.active && user.departmentId === d.departmentId && (mode === 'team' ? user.role === 'lead' : user.team === d.team && !['admin', 'head'].includes(user.role)));
  const [personId, setPersonId] = useState(candidates[0]?.id || ''); const [saving, setSaving] = useState(false);
  const person = candidates.find(user => user.id === personId);
  const latestSelection = useRef(personId); latestSelection.current = personId;
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState('');
  const [savedSelection, setSavedSelection] = useState(personId);
  const draftId = useUnsavedChanges(personId !== savedSelection, mode === 'team' ? '공통업무 담당 팀 배정' : '공통업무 담당자 배정');
  const { requestNavigation, clearDraft } = useUnsavedNavigation();
  const closeEditor = () => requestNavigation(() => { clearDraft(draftId); onClose(); });
  return <Modal title={mode === 'team' ? '1단계 · 담당 팀 배정' : '2단계 · 업무 담당자 배정'} description={row.common.title} onClose={closeEditor}><form className="form-stack" onSubmit={async event => { event.preventDefault(); if (saving || revision.conflicted || submitted) return; const selectedAtSubmit = personId; setSaving(true); try { const payload = mode === 'team' ? { commonId: row.common.id, distributionId: d.id, leadId: personId, team: person?.team || '' } : { commonId: row.common.id, distributionId: d.id, assigneeId: personId }; if (await revision.command(mode === 'team' ? 'common.assignTeam' : 'common.assignPerson', payload)) { if (!mounted.current) return; setSubmitted(true); setSavedSelection(selectedAtSubmit); if (sameDraft(latestSelection.current, selectedAtSubmit)) { clearDraft(draftId); onClose(); } else setNotice('제출한 선택으로 처리했습니다. 대기 중 바꾼 선택은 반영되지 않았으며 화면에 남아 있습니다. 처리 결과를 확인한 뒤 다시 열어 주세요.'); } } finally { setSaving(false); } }}><div className="cw-assign-context"><Building2 size={21} /><div><strong>{departmentName(w, d.departmentId)}</strong><span>{mode === 'team' ? '부서 담당자가 수행할 팀과 팀장을 지정합니다.' : `${d.team} · ${userName(w, d.leadId)} 팀장이 개인을 지정합니다.`}</span></div></div><Field name={mode === 'team' ? 'leadId' : 'assigneeId'} label={mode === 'team' ? '담당 팀 · 팀장' : '업무 담당자'}><select required value={personId} onChange={event => setPersonId(event.target.value)}><option value="">선택해 주세요</option>{candidates.map(user => <option key={user.id} value={user.id}>{user.team} · {user.name} · {roleLabels[user.role]}</option>)}</select></Field><div className="cw-form-info"><ArrowRight size={18} /><p>{mode === 'team' ? person ? `${person.team}에 배정됩니다. 다음은 ${person.name}님이 업무 담당자를 지정할 차례입니다.` : '팀장을 선택하면 다음 담당자를 확인할 수 있습니다.' : person ? `${person.name}님이 내 단위업무에 등록한 뒤 수행합니다.` : '업무 담당자를 선택해 주세요.'}</p></div>{!candidates.length && <p className="cw-form-error" role="alert">배정 가능한 {mode === 'team' ? '팀장' : '팀원'}이 없습니다. 조직의 소속·팀·활성 상태를 확인해 주세요.</p>}{notice && <p className="cw-form-info" role="status">{notice}</p>}{revision.conflict}<div className="form-actions"><Button variant="secondary" onClick={closeEditor}>취소</Button><Button type="submit" disabled={saving || revision.conflicted || submitted || !personId}>{saving ? '배정 중…' : mode === 'team' ? '팀에 배정' : '개인에게 배정'}<ArrowRight size={15} /></Button></div></form></Modal>;
}

function DistributeCommon({ workspace: w, command, common, onClose }: Props & { common: CommonTask; onClose: () => void }) {
  const mounted = useMountedDraft();
  const revision = useRevisionCommand(w, command, { kind: 'common', id: common.id });
  const departments = (w.departmentDirectory ?? w.departments).filter(department => !common.departmentIds.includes(department.id));
  const [selected, setSelected] = useState(departments.map(department => department.id)); const [saving, setSaving] = useState(false);
  const selectionSnapshot = [...selected].sort();
  const latestSelection = useRef(selectionSnapshot); latestSelection.current = selectionSnapshot;
  const [submitted, setSubmitted] = useState(false);
  const [notice, setNotice] = useState('');
  const [savedSelection, setSavedSelection] = useState(selectionSnapshot);
  const draftId = useUnsavedChanges(!sameDraft(selectionSnapshot, savedSelection), '공통업무 추가 배포 대상');
  const { requestNavigation, clearDraft } = useUnsavedNavigation();
  const closeEditor = () => requestNavigation(() => { clearDraft(draftId); onClose(); });
  return <Modal title="대상 부서 추가 승인 요청" description={common.title} onClose={closeEditor}><form className="form-stack" onSubmit={async event => { event.preventDefault(); if (saving || revision.conflicted || submitted) return; const selectedAtSubmit = selectionSnapshot; setSaving(true); try { if (await revision.command('common.distribute', { commonId: common.id, departmentIds: selected })) { if (!mounted.current) return; setSubmitted(true); setSavedSelection(selectedAtSubmit); if (sameDraft(latestSelection.current, selectedAtSubmit)) { clearDraft(draftId); onClose(); } else setNotice('제출한 선택으로 처리했습니다. 대기 중 바꾼 선택은 반영되지 않았으며 화면에 남아 있습니다. 처리 결과를 확인한 뒤 다시 열어 주세요.'); } } finally { setSaving(false); } }}><div className="cw-department-picker">{departments.map(department => <label key={department.id}><input type="checkbox" checked={selected.includes(department.id)} onChange={event => setSelected(event.target.checked ? [...selected, department.id] : selected.filter(id => id !== department.id))} /><Building2 size={15} />{department.name}</label>)}</div><p className="muted">작성 부서장이 승인하면 추가 부서에 동일한 필수 절차와 마감일로 접수됩니다. 승인 전에는 기존 부서의 배정과 진행 상태가 유지됩니다.</p>{notice && <p className="cw-form-info" role="status">{notice}</p>}{revision.conflict}<div className="form-actions"><Button variant="secondary" onClick={closeEditor}>취소</Button><Button type="submit" disabled={saving || revision.conflicted || submitted || !selected.length}><Send size={15} />{saving ? '요청 중…' : `${selected.length}개 부서 추가 승인 요청`}</Button></div></form></Modal>;
}

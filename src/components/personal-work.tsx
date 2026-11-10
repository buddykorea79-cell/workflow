'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Circle, CircleHelp, Clock3, FileText, Folder, FolderPlus, Inbox, Pencil, RotateCcw, Landmark, Layers3, Link2, ListChecks, Plus, Search, Sparkles, Trash2, Trophy, UserRound, Wallet } from 'lucide-react';
import type { Expense, Frequency, Task, TaskReference, Unit, WorkflowStep, Workspace } from '@/lib/types';
import type { TaskTab } from '@/lib/hash-route';
import { Badge, Button, EmptyState, Field, Modal, Progress, ReadField, Tabs, useTabs, validateTextFields, type CommandFn } from './ui';
import { sameDraft, savedCommandTarget } from '@/lib/pending-draft';
import { useRevisionCommand } from './command-revision';
import { useNotificationFocus } from './notification-focus';
import { canSelectPersonalUnit } from '@/lib/search';
import { UnsavedChangesBoundary, useUnsavedChanges, useUnsavedNavigation } from './unsaved-changes';
import './personal-work.css';
import { canEditDepartmentDefinitions, isDepartmentConfirmed } from '@/lib/work-division';
import { createLazyScreen } from './lazy-screen';
import { CommonRegistrationModal } from './common-registration-modal';
import { UnitFormFields, validateUnitImportance } from './unit-form-fields';
import { sortUnitsByImportance, unitImportance } from '@/lib/unit-importance';
import { AiWorkRegistrationDialog } from './ai-work-registration-dialog';
import { directiveIssuerLabels } from '@/lib/directives';
import { referencesForSave } from '@/lib/task-references';
import { latestTaskRun, taskExecution } from '@/lib/common-status';
import { currentExecutionWorkflow } from '@/lib/work-cycles';
import { deadlineState } from '@/lib/task-deadline';
import { definitionState, executionStatus } from '@/lib/status-labels';
import { formatDate, formatDateFull as formatDeadline, formatDateTimeFull, isPastDate } from '@/lib/date-format';
import { activeTaskDelegations, canActAsDeputy } from '@/lib/delegations';
import { DeputyRequestFields, TaskDelegationSection } from './delegation-fields';
import { deputyPayload, initialDeputyDraft, validDeputyDraft } from '@/lib/delegation-draft';
import { DateInput } from './date-input';
import { TaskAssignmentFields } from './task-assignment-fields';
import { TaskDescriptionFiles } from './task-description-files';
import { procedureErrors } from '@/lib/procedure-draft';
import { appendProcedureStep, moveProcedureStep, removeProcedureStep, type ProcedureOrderChange } from '@/lib/procedure-order';
import { taskProcedureParticipants } from '@/lib/procedure-participants';
import { taskProcedureContext } from '@/lib/procedure-context';
import { taskBudgetDraft, taskBudgetPayload, taskBudgetIssue, taskExpenseIssue } from '@/lib/task-budget-draft';

const { Component: ProcedureBuilder, preload: preloadProcedureBuilder } = createLazyScreen(() => import('./procedure-builder').then(module => module.ProcedureBuilder), { label: '절차 초안 작성', kind: 'section' });
const { Component: TaskPerformance, preload: preloadTaskPerformance } = createLazyScreen(() => import('./task-performance').then(module => module.TaskPerformance), { label: '업무 성과', kind: 'section' });
const { Component: ProcedureEditor } = createLazyScreen(() => import('./procedure-editor').then(module => module.ProcedureEditor), { label: '업무 절차', kind: 'section' });
const { Component: WorkCycles } = createLazyScreen(() => import('./work-cycles').then(module => module.WorkCycles), { label: '일정·수행', kind: 'section' });
const { Component: TaskReferences } = createLazyScreen(() => import('./task-references').then(module => module.TaskReferences), { label: '관련 근거', kind: 'section' });
const { Component: DirectiveMonthlyReports } = createLazyScreen(() => import('./directive-monthly').then(module => module.DirectiveMonthlyReports), { label: '월별 실적', kind: 'section' });
const { Component: TaskBudgetFields } = createLazyScreen(() => import('./task-budget').then(module => module.TaskBudgetFields), { label: '사업 예산', kind: 'section' });
const { Component: TaskBudgetSection } = createLazyScreen(() => import('./task-budget').then(module => module.TaskBudgetSection), { label: '예산·집행', kind: 'section' });

type ViewProps = { workspace: Workspace; command: CommandFn; onOpenTask?: (id: string, options?: { mode?: 'view' | 'edit' }) => void; onWorkspace?: (workspace: Workspace) => void; focusId?: string; focusToken?: number };
type TaskRoutingProps = { routedTab?: TaskTab; onTabChange?: (tab: TaskTab) => void; onNavigateView?: (view: 'organization' | 'performance') => void };
type Reference = TaskReference;
type PlannedStep = WorkflowStep & { startDate?: string; dueDate?: string; done?: boolean };
type DetailedTask = Task & { budget?: number; expenses?: Expense[]; references?: Reference[]; workflow: PlannedStep[] };

const frequencyNames: Record<Frequency, string> = { once: '한 번', monthly: '매월', quarterly: '분기별', half_yearly: '반기별', yearly: '매년' };
const roleNames: Record<WorkflowStep['role'], string> = { primary: '담당자 수행', support: '협업·지원', reviewer: '검토·승인' };
function useMountedDraft() { const mounted = useRef(true); useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []); return mounted; }
const money = (value: number) => new Intl.NumberFormat('ko-KR').format(value);
const todayFor = (w: Workspace) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(w.serverTime));
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const DELEGATED_UNIT_ID = '__personal_delegated_work__';
const cleanWorkflow = (steps: PlannedStep[]) => steps.map(step => ({ ...step, checklist: step.checklist.map(item => item.trim()).filter(Boolean), startDate: step.startDate || undefined, dueDate: step.dueDate || undefined }));
const isRegistered = (task: Task, workspace: Workspace) => {
  const distribution = workspace.commonTasks.find(common => common.id === task.commonId)?.distributions.find(item => item.taskId === task.id);
  return !distribution || ['registered', 'submitted', 'assigned'].includes(distribution.status);
};

export function taskProgress(task: Task, workspace: Workspace): number {
  return taskExecution(workspace, task).progress;
}

export function PersonalWork({ workspace: w, command, onOpenTask, onWorkspace, focusId, focusToken }: ViewProps) {
  const definitionEditable = canEditDepartmentDefinitions(w, w.currentUser, w.currentUser.departmentId);
  const ownedTasks = w.tasks.filter(task => task.primaryId === w.currentUser.id && !task.deletedAt && task.status !== 'archived' && isRegistered(task, w));
  const delegatedTasks = w.tasks.filter(task => task.primaryId !== w.currentUser.id && (w.delegatedTaskIds ?? []).includes(task.id) && !task.deletedAt && task.status !== 'archived');
  const delegatedIds = new Set(delegatedTasks.map(task => task.id));
  const mine = [...ownedTasks, ...delegatedTasks];
  const taskUnitId = (task: Task) => delegatedIds.has(task.id) ? DELEGATED_UNIT_ID : task.unitId;
  const ownUnits = sortUnitsByImportance(w.units.filter(unit => unit.ownerId === w.currentUser.id && !unit.deletedAt));
  const units: Unit[] = [...sortUnitsByImportance(w.units.filter(unit => canSelectPersonalUnit(w, unit))), ...(delegatedTasks.length ? [{ id: DELEGATED_UNIT_ID, title: '업무대행', description: '승인된 기간에 원담당자의 업무를 대신 수행합니다. 원본 업무와 기록을 함께 사용합니다.', ownerId: w.currentUser.id, departmentId: w.currentUser.departmentId, color: 'blue', icon: 'folder' }] : [])];
  const trashUnits = w.units.filter(unit => unit.ownerId === w.currentUser.id && !!unit.deletedAt);
  const trashTasks = w.tasks.filter(task => task.primaryId === w.currentUser.id && !!task.deletedAt);
  const [unitId, setUnitId] = useState('all');
  const [filter, setFilter] = useState<'all' | 'personal' | 'common'>('all');
  const [query, setQuery] = useState('');
  const [collapsedUnits, setCollapsedUnits] = useState<string[]>([]);
  const [create, setCreate] = useState<'unit' | 'task' | null>(null);
  const [createTaskUnitId, setCreateTaskUnitId] = useState('');
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [pendingUnitTitle, setPendingUnitTitle] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ id: string; mode: 'view' | 'edit' } | null>(null);
  const [deleting, setDeleting] = useState<{ kind: 'unit' | 'task'; id: string; title: string } | null>(null);
  const [registering, setRegistering] = useState<{ commonId: string; distributionId: string; title: string } | null>(null);
  const [registerUnit, setRegisterUnit] = useState('');
  const [aiRegistration, setAiRegistration] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const focusProps = useNotificationFocus(focusId, focusToken, id => {
    const unit = w.units.find(item => item.id === id && canSelectPersonalUnit(w, item));
    if (!unit) return;
    setUnitId(unit.id); setFilter('all'); setQuery('');
    setCollapsedUnits(current => current.filter(item => item !== unit.id));
    setCreate(null); setCreateTaskUnitId(''); setEditingUnitId(null); setPendingUnitTitle(null);
    setDetail(null); setDeleting(null); setRegistering(null); setRegisterUnit(''); setAiRegistration(false);
    return `unit:${unit.id}`;
  });
  const selectedUnit = units.find(unit => unit.id === unitId);
  const editingUnit = w.units.find(unit => unit.id === editingUnitId);
  const inTrash = unitId === 'trash';
  const normalizedQuery = query.trim().toLowerCase();
  const visible = mine.filter(task => (unitId === 'all' || taskUnitId(task) === unitId) && (filter === 'all' || (filter === 'common' ? !!task.commonId : !task.commonId)) && `${task.title} ${task.description} ${units.find(unit => unit.id === taskUnitId(task))?.title ?? ''}`.toLowerCase().includes(normalizedQuery));
  const inbox = w.commonTasks.flatMap(common => common.distributions.filter(item => item.assigneeId === w.currentUser.id && item.status === 'person_assigned').map(item => ({ common, distribution: item })));
  const complete = mine.filter(task => { const execution = taskExecution(w, task); return executionStatus(task, execution.run, execution.progress, execution.nextRole).key === 'completed'; }).length;
  const grouped = (selectedUnit ? [selectedUnit] : units).map(unit => ({ unit, tasks: visible.filter(task => taskUnitId(task) === unit.id) })).filter(group => !!selectedUnit || group.tasks.length > 0 || filter === 'all' && (!normalizedQuery || group.unit.title.toLowerCase().includes(normalizedQuery)));
  const missingUnitTasks = unitId === 'all' ? visible.filter(task => !units.some(unit => unit.id === taskUnitId(task))) : [];
  const beginTask = (preferredUnitId?: string) => {
    if (!definitionEditable) return;
    if (!ownUnits.length) { setCreate('unit'); return; }
    const target = ownUnits.find(unit => unit.id === preferredUnitId) || ownUnits.find(unit => unit.id === unitId) || ownUnits[0];
    setCreateTaskUnitId(target.id); setCreate('task');
  };
  useEffect(() => {
    if (!pendingUnitTitle) return;
    const created = w.units.find(unit => unit.ownerId === w.currentUser.id && !unit.deletedAt && unit.title === pendingUnitTitle);
    if (created) { setUnitId(created.id); setPendingUnitTitle(null); setFilter('all'); setQuery(''); }
  }, [pendingUnitTitle, w.units, w.currentUser.id]);
  useEffect(() => {
    if (unitId === DELEGATED_UNIT_ID && delegatedTasks.length) return;
    if (!['all', 'trash'].includes(unitId) && !w.units.some(unit => unit.id === unitId && !unit.deletedAt)) setUnitId('all');
  }, [unitId, w.units, delegatedTasks.length]);
  const openTask = (id: string, mode: 'view' | 'edit') => onOpenTask ? onOpenTask(id, { mode }) : setDetail({ id, mode });
  const cards = (tasks: Task[]) => <div className="pw-task-list">{tasks.map(task => <PersonalTaskRow key={task.id} task={task} workspace={w} onView={() => openTask(task.id, 'view')} onEdit={() => openTask(task.id, 'edit')} onDelete={() => setDeleting({ kind: 'task', id: task.id, title: task.title })} />)}</div>;
  const toggleUnit = (id: string) => setCollapsedUnits(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);

  return <>
    <div className="pw-page">
    <div className="page-heading">
      <div><p className="eyebrow">나의 업무 공간</p><div className="help-title"><h1>개인업무</h1><button type="button" className="help-button" aria-label="개인업무 도움말" aria-haspopup="dialog" onClick={() => setHelpOpen(true)}><CircleHelp size={17} aria-hidden="true"/><span>도움말</span></button></div><p className="muted">단위업무는 업무 묶음, 세부업무는 실제 수행할 과제입니다.</p></div>
      <div className="pw-page-actions"><Button variant="accent" disabled={!definitionEditable || w.currentUser.role === 'head'} onClick={() => setAiRegistration(true)}><Sparkles size={17} />AI 업무등록</Button><Button variant="secondary" disabled={!definitionEditable} onClick={() => setCreate('unit')}><FolderPlus size={17} />단위업무 추가</Button><Button disabled={!definitionEditable} onClick={() => beginTask()}><Plus size={17} />세부업무 추가</Button></div>
    </div>
    {!definitionEditable && <div className="pw-division-lock" role="status"><CheckCircle2 size={20}/><div><strong>부서 업무분장이 확정되었습니다.</strong><p>단위·세부업무의 추가, 수정, 삭제는 부서장의 재작성 허용 후 가능합니다. 진행 체크와 성과 기록은 계속할 수 있습니다.</p></div></div>}
    {!inTrash && inbox.length > 0 && <details className="pw-inbox pw-inbox-collapsible">
      <summary><Inbox size={20}/><strong>공통업무 등록 대기 <b>{inbox.length}건</b></strong><span>목록 보기</span><ChevronDown size={18}/></summary>
      <p className="pw-inbox-help">배정받은 공통업무를 내 단위업무에 연결하면 세부업무로 등록됩니다.</p>
      <div className="pw-inbox-list">{inbox.map(({ common, distribution }) => <div className="pw-inbox-item" key={distribution.id}><span><Badge tone={common.kind === 'directive' ? 'warning' : 'info'}>{common.kind === 'directive' ? '지시사항' : '공통업무'}</Badge><b>{common.title}</b><small>{formatDate(common.dueDate, { today: w.serverTime })}까지</small></span><Button variant="secondary" disabled={!definitionEditable} onClick={() => { setRegistering({ commonId: common.id, distributionId: distribution.id, title: common.title }); setRegisterUnit(ownUnits.find(unit => unit.id === unitId)?.id || ownUnits[0]?.id || ''); }}>내 업무에 등록 <ArrowDownLeft size={15} /></Button></div>)}</div>
    </details>}

    <div className="pw-layout">
      <aside className="pw-unit-rail">
        <div className="pw-rail-heading"><span>단위업무 · 업무 묶음</span><button className="pw-icon-button" aria-label="단위업무 추가" disabled={!definitionEditable} onClick={() => setCreate('unit')}><Plus size={17} /></button></div>
        <button className={`pw-unit-button ${unitId === 'all' ? 'active' : ''}`} aria-current={unitId === 'all' ? 'page' : undefined} onClick={() => setUnitId('all')}><Layers3 size={18} /><span>전체 업무</span><b>{mine.length}</b></button>
        <div className="pw-unit-list">{units.map(unit => <button key={unit.id} className={`pw-unit-button ${unitId === unit.id ? 'active' : ''}`} aria-current={unitId === unit.id ? 'page' : undefined} onClick={() => setUnitId(unit.id)}><Folder size={18} /><span>{unit.title}{unit.id !== DELEGATED_UNIT_ID && <small>중요도 {unitImportance(unit)}</small>}{unit.ownerId !== w.currentUser.id && <small>공유 단위 · {w.users.find(user => user.id === unit.ownerId)?.name || '다른 담당자'}</small>}</span><b>{mine.filter(task => taskUnitId(task) === unit.id).length}</b></button>)}</div>
        <button className="pw-add-unit" disabled={!definitionEditable} onClick={() => setCreate('unit')}><FolderPlus size={17} />단위업무 추가</button>
        <button className={`pw-unit-button pw-trash-nav ${inTrash ? 'active' : ''}`} aria-current={inTrash ? 'page' : undefined} onClick={() => setUnitId('trash')}><Trash2 size={17} /><span>휴지통</span><b>{trashUnits.length + trashTasks.length}</b></button>
        <div className="pw-rail-note"><span className="pw-rail-number">{complete}<span> / {mine.length}</span></span><p>완료한 세부업무</p><Progress value={mine.length ? complete / mine.length * 100 : 0} /></div>
      </aside>

      <section className="pw-work-area">
        <nav className="pw-hierarchy-breadcrumb" aria-label="개인업무 위치"><button onClick={() => setUnitId('all')}>개인업무</button><ChevronRight size={14} /><span>{inTrash ? '휴지통' : selectedUnit ? selectedUnit.title : '전체 단위업무'}</span>{selectedUnit && <><ChevronRight size={14} /><span>세부업무</span></>}</nav>
        {inTrash ? <PersonalTrash workspace={w} command={command} /> : <>
          <div className="pw-unit-header"><div>{selectedUnit && <p className="pw-unit-kind"><Folder size={14} />단위업무 · 업무 묶음{selectedUnit.id !== DELEGATED_UNIT_ID && <> · 중요도 {unitImportance(selectedUnit)}</>}</p>}<h2>{selectedUnit?.title || '전체 업무'} <span>{visible.length}</span></h2><p>{selectedUnit?.description || '단위업무를 펼쳐 세부업무를 확인하고, 업무 이름을 눌러 상세 내용을 엽니다.'}</p></div>{selectedUnit ? <div className="pw-unit-actions">{selectedUnit.id === DELEGATED_UNIT_ID ? <Badge tone='info'>원본 업무 연결 · 수행 권한</Badge> : selectedUnit.ownerId === w.currentUser.id ? <><Button variant="secondary" disabled={!definitionEditable} onClick={() => setEditingUnitId(selectedUnit.id)}><Pencil size={14} />단위 수정</Button><Button variant="secondary" disabled={!definitionEditable} onClick={() => setDeleting({ kind: 'unit', id: selectedUnit.id, title: selectedUnit.title })}><Trash2 size={14} />단위 삭제</Button></> : <Badge tone="outline">공유 단위 · {w.users.find(user => user.id === selectedUnit.ownerId)?.name || '다른 담당자'} 소유</Badge>}</div> : <span className="pw-view-symbol"><Layers3 size={24} /></span>}</div>
          {selectedUnit && selectedUnit.ownerId !== w.currentUser.id && <p className="pw-legacy-note">기존에 연결된 나의 세부업무입니다. 세부업무의 ‘수정’에서 내가 만든 단위업무로 옮길 수 있습니다.</p>}
          <div className="pw-toolbar"><div className="tabs pw-filter-tabs" aria-label="업무 구분">{([['all', '전체'], ['personal', '개인업무'], ['common', '공통업무']] as const).map(([value, label]) => <button key={value} type="button" className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => { setFilter(value); setCollapsedUnits([]); }}>{label}</button>)}</div><label className="pw-search"><Search size={18} /><input aria-label="단위업무와 세부업무 검색" placeholder="단위·세부업무 검색" value={query} onChange={e => { setQuery(e.target.value); setCollapsedUnits([]); }} /></label></div>
          <div className="pw-tree-toolbar"><p><b>{selectedUnit ? '세부업무' : `단위업무 ${grouped.length}개`}</b><span>{selectedUnit ? `${visible.length}건` : `세부업무 ${visible.length}건`}</span>{normalizedQuery && <span>검색 결과</span>}</p>{!selectedUnit && grouped.length > 0 && <div><button type="button" disabled={!grouped.some(({ unit }) => collapsedUnits.includes(unit.id))} onClick={() => setCollapsedUnits([])}><ChevronDown size={16}/>전체 펼치기</button><button type="button" disabled={grouped.every(({ unit }) => collapsedUnits.includes(unit.id))} onClick={() => setCollapsedUnits(grouped.map(({ unit }) => unit.id))}><ChevronRight size={16}/>전체 접기</button></div>}</div>
          <div className={`pw-task-groups ${selectedUnit ? 'pw-selected-unit' : 'pw-unit-tree'}`}>
            {grouped.map(({ unit, tasks }) => {
              const expanded = !!selectedUnit || !collapsedUnits.includes(unit.id);
              const total = mine.filter(task => taskUnitId(task) === unit.id).length;
              const canAddTask = unit.id !== DELEGATED_UNIT_ID && unit.ownerId === w.currentUser.id;
              const contentId = `pw-unit-content-${unit.id}`;
              return <section className="pw-task-group" key={unit.id} aria-label={`${unit.title}의 세부업무`} {...focusProps(`unit:${unit.id}`)}>
                {!selectedUnit && <header className="pw-tree-unit-header">
                  <button type="button" className="pw-tree-toggle" aria-expanded={expanded} aria-controls={contentId} aria-label={`${unit.title} 세부업무 ${expanded ? '접기' : '펼치기'}`} onClick={() => toggleUnit(unit.id)}>
                    <span className="pw-tree-chevron">{expanded ? <ChevronDown size={20}/> : <ChevronRight size={20}/>}</span><span className="pw-tree-folder"><Folder size={21}/></span>
                    <span className="pw-tree-unit-copy">{unit.ownerId !== w.currentUser.id && <span className="pw-tree-unit-kicker">공유 단위업무 · {w.users.find(user => user.id === unit.ownerId)?.name || '다른 담당자'}</span>}<span className="pw-tree-unit-title">{unit.title}{unit.id !== DELEGATED_UNIT_ID && <Badge tone="info">중요도 {unitImportance(unit)}</Badge>}<span className="pw-tree-count">{tasks.length === total ? `${total}건` : `${tasks.length} / ${total}건`}</span></span><span className="pw-tree-unit-description" title={unit.description || '이 단위업무에 속한 세부업무를 관리합니다.'}>{unit.description || '이 단위업무에 속한 세부업무를 관리합니다.'}</span></span>
                  </button>
                  <div className="pw-tree-unit-actions"><Button variant="ghost" onClick={() => setUnitId(unit.id)} aria-label={`${unit.title} 단위업무 열기`}>단위 열기<ArrowRight size={15}/></Button>{unit.id !== DELEGATED_UNIT_ID && unit.ownerId === w.currentUser.id && <Button variant="secondary" disabled={!definitionEditable} onClick={() => beginTask(unit.id)} aria-label={`${unit.title}에 세부업무 추가`}><Plus size={16}/><span>세부업무 추가</span></Button>}</div>
                </header>}
                <div id={contentId} className="pw-tree-children" hidden={!expanded}>
                  {tasks.length ? <>{cards(tasks)}{selectedUnit && canAddTask && <div className="pw-list-add-task"><Button disabled={!definitionEditable} onClick={() => beginTask(unit.id)}><Plus size={17}/>세부업무 추가</Button></div>}</> : <div className="pw-group-empty"><FileText size={selectedUnit ? 30 : 22}/><div><b>{total ? '조건에 맞는 세부업무가 없습니다.' : '아직 세부업무가 없습니다.'}</b><p>{total ? '검색어나 업무 구분을 변경해 보세요.' : '이 단위업무에서 수행할 세부업무를 추가하세요.'}</p></div>{canAddTask && <Button variant={selectedUnit ? 'primary' : 'ghost'} disabled={!definitionEditable} onClick={() => beginTask(unit.id)}><Plus size={17}/>{selectedUnit ? '세부업무 추가' : '첫 세부업무 추가'}</Button>}</div>}
                </div>
              </section>;
            })}
            {missingUnitTasks.length > 0 && <section className="pw-task-group pw-unlinked-group"><div className="pw-group-header"><h3>단위업무 연결 확인</h3><p className="muted">수정에서 내 단위업무를 선택해 주세요.</p></div>{cards(missingUnitTasks)}</section>}
          </div>
          {!grouped.length && !missingUnitTasks.length && <EmptyState title={query || filter !== 'all' ? '조건에 맞는 세부업무가 없습니다.' : '첫 단위업무를 만들어 보세요.'} description={query || filter !== 'all' ? '검색어나 업무 구분을 변경해 보세요.' : '단위업무는 여러 세부 실행 과제를 담는 업무 묶음입니다.'} action={!query && filter === 'all' && <Button variant="secondary" disabled={!definitionEditable} onClick={() => setCreate('unit')}><FolderPlus size={16} />단위업무 만들기</Button>} />}
        </>}
      </section>
    </div>
    </div>

    {helpOpen && <Modal title="개인업무 도움말" onClose={() => setHelpOpen(false)}><div className="form-stack">
      <section><h3>업무 만들기</h3><p>단위업무를 만든 뒤 그 안에 세부업무를 추가하세요. 단위업무 중요도는 1~10이며 기본값은 5입니다. 중요도가 높은 업무가 먼저 표시됩니다.</p></section>
      <section><h3>AI 업무등록과 AI 절차 작성</h3><p>개인업무의 ‘AI 업무등록’은 설명과 인수인계 파일로 단위·세부업무 초안을 만듭니다. 세부업무의 ‘AI로 절차·절차도 작성’은 저장한 업무 개요·첨부파일을 중심으로 관련 근거를 참고해 절차를 만듭니다. 초안을 확인한 뒤 적용하세요.</p></section>
      <section><h3>절차·일정·성과 기록</h3><p>절차는 누가·무엇을·어떻게를 입력하고 순서를 조정한 뒤 ‘수정사항 저장·절차도 반영’을 누릅니다. 일정·수행에서 만들어진 절차별 일정을 등록하고, 성과 탭에는 500자 이내의 성과 내용과 참고 파일을 저장하세요.</p></section>
      <section><h3>수정 버튼이 보이지 않을 때</h3><p>세부업무의 ‘업무 기준 수정’을 먼저 선택하세요. 부서 업무분장이 확정되면 부서장의 재작성 허용이 필요합니다. 수행 기록은 해당 담당자의 권한으로 계속 입력할 수 있습니다.</p></section>
      <div className="form-actions"><Button variant="secondary" onClick={() => setHelpOpen(false)}>도움말 닫기</Button></div>
    </div></Modal>}
    {aiRegistration && <AiWorkRegistrationDialog key={w.currentUser.id} workspace={w} command={command} onWorkspace={onWorkspace} onClose={() => setAiRegistration(false)} />}
    {create === 'unit' && <UnitForm workspace={w} command={command} onClose={() => setCreate(null)} onCreated={title => setPendingUnitTitle(title)} />}
    {editingUnit && <UnitForm key={editingUnit.id} unit={editingUnit} workspace={w} command={command} onClose={() => setEditingUnitId(null)} />}
    {create === 'task' && <CreateTask workspace={w} units={ownUnits} selectedUnitId={createTaskUnitId} command={command} onWorkspace={onWorkspace} onClose={() => setCreate(null)} />}
    {!onOpenTask && detail && <TaskPanel key={detail.id} workspace={w} taskId={detail.id} initialMode={detail.mode} command={command} onWorkspace={onWorkspace} onClose={() => setDetail(null)} />}
    {deleting && <DeleteWorkConfirm target={deleting} workspace={w} command={command} onClose={() => setDeleting(null)} onInspectUnit={id => { setUnitId(id); setDeleting(null); }} />}
    {registering && <CommonRegistrationModal key={registering.distributionId} workspace={w} commonId={registering.commonId} distributionId={registering.distributionId} initialUnitId={registerUnit} command={command} onRegistered={setUnitId} onClose={() => setRegistering(null)} />}
  </>;
}

function PersonalTaskRow({ task, workspace: w, onView, onEdit, onDelete }: { task: Task; workspace: Workspace; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  const delegated = task.primaryId !== w.currentUser.id && (w.delegatedTaskIds ?? []).includes(task.id);
  const definitionEditable = !delegated && canEditDepartmentDefinitions(w, w.currentUser, task.departmentId);
  const execution = taskExecution(w, task);
  const progress = execution.progress;
  const { overdue } = deadlineState({ taskDueDate: task.dueDate, progress, runStatus: execution.run?.status, taskStatus: task.status, deletedAt: task.deletedAt }, todayFor(w));
  const common = w.commonTasks.find(item => item.id === task.commonId);
  const status = executionStatus(task, execution.run, progress, execution.nextRole);
  const definition = definitionState(task.status);
  return <article className="pw-task-card pw-task-row" data-status={overdue ? 'attention' : status.key === 'completed' ? 'complete' : ['in_progress', 'review'].includes(status.key) ? 'progress' : 'neutral'} aria-label={task.title}>
    <div className="pw-row-main">
      <div className="pw-row-heading"><span className="pw-row-document"><FileText size={20}/></span><div><div className="pw-row-kicker"><span>세부업무</span><span>{task.code}</span><Badge tone={task.commonId ? 'info' : 'outline'}>{delegated ? '업무대행' : common?.kind === 'directive' ? '지시사항' : task.commonId ? '공통업무' : '개인업무'}</Badge>{task.status !== 'confirmed' && <Badge tone={definition.tone}>{definition.label}</Badge>}</div><h3><button type="button" className="pw-task-title-button" onClick={onView}>{task.title}<ChevronRight size={17}/></button></h3></div></div>
      <p className="pw-row-description" title={task.description}>{task.description}</p>
      {delegated && <p className='pw-row-delegation-origin'><Link2 size={14}/>원본 연결 · {w.units.find(unit => unit.id === task.unitId)?.title || '원담당자의 단위업무'}</p>}<dl className="pw-row-facts"><div><dt><UserRound size={15}/>{delegated ? '원담당' : '담당'}</dt><dd>{w.users.find(user => user.id === task.primaryId)?.name || '배정 대기'}</dd></div><div className={overdue ? 'pw-row-overdue' : ''}><dt><CalendarDays size={15}/>업무 마감</dt><dd><time dateTime={task.dueDate}>{formatDate(task.dueDate, { today: w.serverTime })}</time>{overdue && <strong>기한 경과</strong>}</dd></div><div><dt><ListChecks size={15}/>절차</dt><dd>{execution.totalSteps}단계 · {frequencyNames[task.frequency]}</dd></div></dl>
    </div>
    <div className="pw-row-side"><div className="pw-row-state"><Badge tone={status.tone}>{status.key === 'completed' ? <CheckCircle2 size={17}/> : <Circle size={14}/>}<b>{status.label}</b></Badge><span className="pw-row-percent">{progress}%</span></div><Progress value={progress}/><div className="pw-task-actions"><Button variant="accent-outline" onClick={onView} aria-label={`${task.title} 보기`}>보기</Button><Button variant="secondary" disabled={!definitionEditable} onClick={onEdit} aria-label={`${task.title} 수정`}><Pencil size={14}/>수정</Button><Button variant="ghost" className="pw-delete-button" disabled={!definitionEditable || !!task.commonId} title={task.commonId ? '공통 배정업무는 배정 이력을 보존하므로 삭제할 수 없습니다.' : '세부업무를 휴지통으로 이동'} onClick={onDelete} aria-label={`${task.title} 삭제`}><Trash2 size={14}/>삭제</Button></div></div>
  </article>;
}

function UnitForm({ workspace: w, unit, command, onClose, onCreated }: { workspace: Workspace; unit?: Unit; command: CommandFn; onClose: () => void; onCreated?: (title: string) => void }) {
  const [title, setTitle] = useState(unit?.title || '');
  const [description, setDescription] = useState(unit?.description || '');
  const [importance, setImportance] = useState(() => String(unitImportance(unit || {})));
  const [busy, setBusy] = useState(false);
  const mounted = useMountedDraft();
  const [savedId, setSavedId] = useState(unit?.id || '');
  const revision = useRevisionCommand(w, command, savedId ? { kind: 'unit', id: savedId } : null);
  const [created, setCreated] = useState(false);
  const [notice, setNotice] = useState('');
  const draft = { title, description, importance };
  const latest = useRef(draft); latest.current = draft;
  const [savedDraft, setSavedDraft] = useState(draft);
  useUnsavedChanges(!sameDraft(draft, savedDraft), '단위업무');
  const { requestNavigation } = useUnsavedNavigation();
  const closeForm = () => requestNavigation(onClose);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy || revision.conflicted || created && !savedId) return;
    const submitted = latest.current; const action = savedId ? 'unit.update' : 'unit.create';
    if (!validateUnitImportance(submitted.importance)) return;
    let nextId = savedId;
    setBusy(true); setNotice('');
    try {
      if (await revision.command(action, savedId ? { unitId: savedId, ...submitted, importance: Number(submitted.importance) } : { ...submitted, importance: Number(submitted.importance), ownerId: w.currentUser.id }, { onSaved: result => { nextId = savedId || savedCommandTarget(result, action, w.currentUser.id) || ''; } })) {
        if (!mounted.current) return;
        setSavedId(nextId); setCreated(true); setSavedDraft(submitted);
        if (sameDraft(latest.current, submitted)) { if (!unit) onCreated?.(submitted.title.trim()); onClose(); }
        else setNotice(nextId ? '요청한 내용은 저장했습니다. 저장 중 추가로 입력한 내용은 남아 있으며, 다시 저장하면 같은 단위업무를 수정합니다.' : '단위업무는 생성되었지만 연결 정보를 확인하지 못했습니다. 추가 입력은 유지했습니다. 중복 생성을 막기 위해 목록에서 생성된 단위업무를 다시 열어 주세요.');
      }
    } finally { setBusy(false); }
  }
  return <Modal title={savedId ? '단위업무 수정' : '단위업무 만들기'} description="단위업무는 여러 세부업무를 담는 나의 업무 묶음입니다." onClose={closeForm}><form className="form-stack" onSubmit={save}><UnitFormFields title={title} description={description} importance={importance} onTitleChange={setTitle} onDescriptionChange={setDescription} onImportanceChange={setImportance} autoFocus/><p className="pw-form-note"><Folder size={15} />{w.currentUser.name}님이 관리하는 단위업무입니다.</p>{notice && <p className="pw-form-note" role="status">{notice}</p>}{revision.conflict}<div className="form-actions"><Button type="button" variant="secondary" onClick={closeForm}>취소</Button><Button type="submit" disabled={busy || revision.conflicted || created && !savedId}>{busy ? '저장 중…' : savedId ? '수정사항 저장' : '단위업무 만들기'}</Button></div></form></Modal>;
}

function DeleteWorkConfirm({ target, workspace: w, command, onClose, onInspectUnit }: { target: { kind: 'unit' | 'task'; id: string; title: string }; workspace: Workspace; command: CommandFn; onClose: () => void; onInspectUnit: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const children = target.kind === 'unit' ? w.tasks.filter(task => task.unitId === target.id && !task.deletedAt && task.status !== 'archived') : [];
  const blocked = children.length > 0;
  return <Modal title={blocked ? '세부업무를 먼저 정리해 주세요.' : `${target.kind === 'unit' ? '단위업무' : '세부업무'}를 삭제할까요?`} description={blocked ? '하위 세부업무가 남아 있는 단위업무는 삭제할 수 없습니다.' : '삭제한 항목은 휴지통에서 다시 복원할 수 있습니다.'} onClose={onClose}><div className="form-stack"><div className="pw-delete-summary">{target.kind === 'unit' ? <Folder size={24} /> : <FileText size={24} />}<div><Badge tone="outline">{target.kind === 'unit' ? '단위업무 · 업무 묶음' : '세부업무 · 실행 과제'}</Badge><h3>{target.title}</h3></div></div>{blocked ? <><p className="muted">이 업무 묶음에 세부업무 {children.length}건이 남아 있습니다. 다른 단위업무로 옮기거나 세부업무를 삭제한 뒤 다시 시도해 주세요.</p><ul className="pw-delete-children">{children.slice(0, 5).map(task => <li key={task.id}><FileText size={14} />{task.title}{task.commonId && <Badge tone="info">공통 배정</Badge>}</li>)}</ul>{children.some(task => task.commonId) && <p className="pw-form-note">공통 배정업무는 삭제할 수 없습니다. 세부업무 수정에서 소속 단위업무를 변경해 주세요.</p>}</> : <p className="muted">{target.kind === 'task' ? '업무 내용과 절차, 예산 및 근거 기록은 함께 보관됩니다. 휴지통으로 이동하면 현재 업무와 일정 목록에서 제외됩니다.' : '이 업무 묶음을 현재 단위업무 목록에서 제외합니다.'}</p>}<div className="form-actions"><Button variant="secondary" disabled={busy} onClick={onClose}>취소</Button>{blocked ? <Button onClick={() => onInspectUnit(target.id)}>세부업무 확인 <ArrowRight size={15} /></Button> : <Button disabled={busy} onClick={async () => { setBusy(true); try { if (await command(`${target.kind}.delete`, target.kind === 'unit' ? { unitId: target.id } : { taskId: target.id })) onClose(); } finally { setBusy(false); } }}><Trash2 size={15} />{busy ? '이동 중…' : '휴지통으로 이동'}</Button>}</div></div></Modal>;
}

function PersonalTrash({ workspace: w, command }: { workspace: Workspace; command: CommandFn }) {
  const definitionEditable = canEditDepartmentDefinitions(w, w.currentUser, w.currentUser.departmentId);
  const units = sortUnitsByImportance(w.units.filter(unit => unit.ownerId === w.currentUser.id && !!unit.deletedAt));
  const tasks = w.tasks.filter(task => task.primaryId === w.currentUser.id && !!task.deletedAt);
  const [restoringTaskId, setRestoringTaskId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState('');
  const restoringTask = w.tasks.find(task => task.id === restoringTaskId);
  return <><div className="pw-unit-header"><div><h2>휴지통 <span>{units.length + tasks.length}</span></h2><p>내가 삭제한 단위업무와 세부업무를 다시 복원할 수 있습니다.</p></div><span className="pw-view-symbol"><Trash2 size={24} /></span></div><p className="pw-trash-note">휴지통은 삭제한 항목만 표시합니다. 일반 ‘보관’ 상태의 업무와는 구분됩니다.</p>{!units.length && !tasks.length ? <EmptyState title="휴지통이 비어 있습니다." description="삭제한 내 업무는 이곳에서 복원할 수 있습니다." /> : <div className="pw-trash-sections">{units.length > 0 && <section><h3><Folder size={17} />단위업무 <span>{units.length}</span></h3><div className="pw-trash-list">{units.map(unit => <article key={unit.id}><span className="pw-trash-icon"><Folder size={20} /></span><div><Badge tone="outline">업무 묶음</Badge><h4>{unit.title}</h4><p>{unit.description}</p><small>{formatDeadline(unit.deletedAt)} 삭제</small></div><Button variant="secondary" disabled={!definitionEditable || !!busyId} onClick={async () => { setBusyId(unit.id); try { await command('unit.restore', { unitId: unit.id }); } finally { setBusyId(''); } }}><RotateCcw size={15} />{busyId === unit.id ? '복원 중…' : '복원'}</Button></article>)}</div></section>}{tasks.length > 0 && <section><h3><FileText size={17} />세부업무 <span>{tasks.length}</span></h3><div className="pw-trash-list">{tasks.map(task => { const unit = w.units.find(item => item.id === task.unitId); return <article key={task.id}><span className="pw-trash-icon"><FileText size={20} /></span><div><Badge tone="soft">실행 과제</Badge><h4>{task.title}</h4><p>소속 단위업무 · {unit?.title || '연결 확인 필요'}{unit?.deletedAt ? ' (삭제됨)' : ''}</p><small>{formatDeadline(task.deletedAt)} 삭제{task.deletedFromStatus === 'archived' ? ' · 복원 후 보관 상태 유지' : ''}</small></div><Button variant="secondary" disabled={!definitionEditable} onClick={() => setRestoringTaskId(task.id)}><RotateCcw size={15} />복원</Button></article>; })}</div></section>}</div>}{restoringTask && <RestoreTask key={restoringTask.id} task={restoringTask} workspace={w} command={command} onClose={() => setRestoringTaskId(null)} />}</>;
}

function RestoreTask({ task, workspace: w, command, onClose }: { task: Task; workspace: Workspace; command: CommandFn; onClose: () => void }) {
  const original = w.units.find(unit => unit.id === task.unitId);
  const ownUnits = sortUnitsByImportance(w.units.filter(unit => unit.ownerId === w.currentUser.id && !unit.deletedAt));
  const options = original && !original.deletedAt && !ownUnits.some(unit => unit.id === original.id) ? sortUnitsByImportance([original, ...ownUnits]) : ownUnits;
  const [unitId, setUnitId] = useState(original && !original.deletedAt ? original.id : ownUnits[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [parentBusy, setParentBusy] = useState(false);
  const mounted = useMountedDraft();
  const latestUnit = useRef(unitId); latestUnit.current = unitId;
  const [restored, setRestored] = useState(false);
  const [notice, setNotice] = useState('');
  return <Modal title="세부업무 복원" description="복원할 업무의 소속 단위업무를 확인해 주세요." onClose={onClose}><form className="form-stack" onSubmit={async event => { event.preventDefault(); if (busy || restored) return; const submitted = unitId; setBusy(true); try { if (await command('task.restore', { taskId: task.id, ...(submitted !== task.unitId ? { unitId: submitted } : {}) }) && mounted.current) { setRestored(true); if (latestUnit.current === submitted) onClose(); else setNotice('선택했던 단위업무로 복원했습니다. 복원 중 바꾼 선택은 반영하지 않았습니다. 업무 수정 화면에서 소속을 변경해 주세요.'); } } finally { setBusy(false); } }}><div className="pw-soft-block"><Badge tone="info">복원할 세부업무</Badge><h3>{task.title}</h3></div>{original?.deletedAt && <div className="pw-restore-parent"><p>원래 단위업무 ‘{original.title}’도 삭제되어 있습니다. 아래에서 다른 업무 묶음을 선택하거나 원래 단위업무를 먼저 복원하세요.</p>{original.ownerId === w.currentUser.id && <Button variant="secondary" disabled={busy || parentBusy} onClick={async () => { const submitted = unitId; setParentBusy(true); try { if (await command('unit.restore', { unitId: original.id }) && mounted.current && latestUnit.current === submitted) setUnitId(original.id); } finally { setParentBusy(false); } }}><RotateCcw size={14} />{parentBusy ? '복원 중…' : '원래 단위업무 복원'}</Button>}</div>}<Field name="unitId" label="소속 단위업무"><select required value={unitId} onChange={e => setUnitId(e.target.value)}><option value="">단위업무 선택</option>{options.map(unit => <option key={unit.id} value={unit.id}>{unit.title} · 중요도 {unitImportance(unit)}{unit.ownerId !== w.currentUser.id ? ' · 기존 연결' : ''}</option>)}</select></Field>{!options.length && <p className="pw-form-note">사용할 단위업무가 없습니다. 원래 단위업무를 복원하거나 새 단위업무를 먼저 만들어 주세요.</p>}{task.deletedFromStatus === 'archived' && <p className="pw-form-note">삭제 전 ‘보관’ 상태로 복원됩니다. 현재 진행 중인 개인업무 목록에는 표시되지 않습니다.</p>}{notice && <p className="pw-form-note" role="status">{notice}</p>}<div className="form-actions"><Button variant="secondary" onClick={onClose}>취소</Button><Button type="submit" disabled={busy || parentBusy || restored || !options.some(unit => unit.id === unitId)}><RotateCcw size={15} />{busy ? '복원 중…' : '세부업무 복원'}</Button></div></form></Modal>;
}

function CreateTask({ workspace: w, units, selectedUnitId, command, onClose, onWorkspace }: { workspace: Workspace; units: Workspace['units']; selectedUnitId?: string; command: CommandFn; onClose: () => void; onWorkspace?: (workspace: Workspace) => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [descriptionAttachmentIds, setDescriptionAttachmentIds] = useState<string[]>([]);
  const [unitId, setUnitId] = useState(selectedUnitId || units[0]?.id || '');
  const [dueDate, setDueDate] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('once');
  const [supportIds, setSupportIds] = useState<string[]>([]);
  const [cooperationDepartmentIds, setCooperationDepartmentIds] = useState<string[]>([]);
  const [budgetDraft, setBudgetDraft] = useState(() => taskBudgetDraft());
  const [budgetMessage, setBudgetMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [includeDeputy, setIncludeDeputy] = useState(false);
  const [deputy, setDeputy] = useState(() => initialDeputyDraft(w));
  const creationValues = { supportIds, cooperationDepartmentIds, title, description, descriptionAttachmentIds, unitId, dueDate, frequency, budgetDraft, includeDeputy, deputy };
  const latestCreation = useRef(creationValues); latestCreation.current = creationValues;
  const [savedCreation, setSavedCreation] = useState(creationValues);
  const [createdTaskId, setCreatedTaskId] = useState('');
  const revision = useRevisionCommand(w, command, createdTaskId ? { kind: 'task', id: createdTaskId } : null);
  const [creationCommitted, setCreationCommitted] = useState(false);
  const mounted = useMountedDraft();
  const [createdDeputy, setCreatedDeputy] = useState<{ includeDeputy: boolean; deputy: typeof deputy } | null>(null);
  const [creationNotice, setCreationNotice] = useState('');
  const deputyChanged = !!createdDeputy && !sameDraft({ includeDeputy, deputy }, createdDeputy);
  useUnsavedChanges(!sameDraft(creationValues, savedCreation) || deputyChanged, '새 세부업무');
  const { requestNavigation } = useUnsavedNavigation();
  const closeCreation = () => requestNavigation(onClose);
  return <Modal title="세부업무 등록" description="단위업무 아래에 실행할 일을 구체적으로 기록합니다." onClose={closeCreation} wide>
    <form className="form-stack" onSubmit={async event => {
      event.preventDefault(); if (busy || uploadBusy || revision.conflicted || creationCommitted && !createdTaskId || !createdTaskId && includeDeputy && !validDeputyDraft(deputy)) return;
      const submitted = latestCreation.current;
      const issue = taskBudgetIssue(submitted.budgetDraft); setBudgetMessage(issue); if (issue) return; setBusy(true); setCreationNotice('');
      const action = createdTaskId ? 'task.configure' : 'task.create'; let nextId = createdTaskId;
      const details = { supportIds: submitted.supportIds, cooperationDepartmentIds: submitted.cooperationDepartmentIds, title: submitted.title, description: submitted.description, descriptionAttachmentIds: submitted.descriptionAttachmentIds, unitId: submitted.unitId, dueDate: submitted.dueDate, frequency: submitted.frequency, ...taskBudgetPayload(submitted.budgetDraft) };
      try {
        if (await revision.command(action, createdTaskId ? { taskId: createdTaskId, ...details } : { ...details, primaryId: w.currentUser.id, priority: 'medium', expenses: [], references: [], ...(submitted.includeDeputy ? { deputy: deputyPayload(submitted.deputy) } : {}) }, { onSaved: result => { nextId = createdTaskId || savedCommandTarget(result, action, w.currentUser.id) || ''; } })) {
          if (!mounted.current) return;
          setCreatedTaskId(nextId); setCreationCommitted(true); setSavedCreation(submitted);
          const deputyAtCreation = createdDeputy || { includeDeputy: submitted.includeDeputy, deputy: submitted.deputy };
          setCreatedDeputy(deputyAtCreation);
          const hasDeputyChanges = !sameDraft({ includeDeputy: latestCreation.current.includeDeputy, deputy: latestCreation.current.deputy }, deputyAtCreation);
          if (sameDraft(latestCreation.current, submitted) && !hasDeputyChanges) onClose();
          else setCreationNotice(!nextId ? '세부업무는 생성되었습니다. 추가 입력은 유지했으며 중복 생성을 막기 위해 목록에서 생성된 업무를 다시 열어 주세요.' : hasDeputyChanges ? '업무 내용은 요청한 시점까지 저장했습니다. 이후 변경한 대행 정보는 요청에 반영되지 않았습니다. 입력을 보관하고 있으니 생성된 업무의 업무대행 요청에서 확인해 주세요. 다시 저장하면 업무 내용만 수정합니다.' : '요청한 내용은 저장했습니다. 저장 중 추가한 입력은 남아 있으며, 다시 저장하면 생성된 세부업무를 수정합니다.');
        }
      } finally { setBusy(false); }
    }}>
      <div className="form-grid"><Field name="unitId" label="단위업무"><select required value={unitId} onChange={event => setUnitId(event.target.value)}><option value="">단위업무 선택</option>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.title} · 중요도 {unitImportance(unit)}</option>)}</select></Field><Field label="업무 구분"><input value="개인이 등록하는 세부업무" disabled/></Field><Field name="title" label="세부업무 이름" span><input required maxLength={150} value={title} onChange={event => setTitle(event.target.value)} placeholder="예: 2027년 예산 요구자료 작성" autoFocus/></Field><Field name="description" label="업무 설명" span><textarea required maxLength={20000} rows={4} value={description} onChange={event => setDescription(event.target.value)} placeholder="업무의 목적, 수행 범위, 기대하는 결과를 적어 주세요."/></Field></div>
      <TaskDescriptionFiles workspace={w} taskId={createdTaskId || undefined} title={title} description={description} attachmentIds={descriptionAttachmentIds} onAttachmentsChange={setDescriptionAttachmentIds} onDescriptionChange={setDescription} onWorkspace={onWorkspace} onBusyChange={setUploadBusy}/>
      <div className="form-grid"><Field name="dueDate" label="업무 마감일"><DateInput required aria-label="업무 마감일" value={dueDate} onChange={setDueDate}/>{isPastDate(dueDate, w.serverTime) && <small className="muted" role="status">오늘 이전 날짜입니다. 이미 지난 업무를 기록하는 경우에만 사용해 주세요.</small>}</Field><Field name="frequency" label="반복 주기"><select value={frequency} onChange={event => setFrequency(event.target.value as Frequency)}>{Object.entries(frequencyNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field></div>
      <TaskAssignmentFields workspace={w} primaryId={w.currentUser.id} departmentId={w.currentUser.departmentId} supportIds={supportIds} cooperationDepartmentIds={cooperationDepartmentIds} onSupportChange={setSupportIds} onDepartmentsChange={setCooperationDepartmentIds}/>
      <TaskBudgetFields value={budgetDraft} onChange={value => { setBudgetDraft(value); setBudgetMessage(''); }} />
      {budgetMessage && <p className="pw-form-error" role="alert">{budgetMessage}</p>}
      <section className="task-delegation-section"><label className="delegation-opt-in"><input type="checkbox" checked={includeDeputy} onChange={event => setIncludeDeputy(event.target.checked)}/>업무대행자를 지정하고 부서장 승인을 요청합니다</label>{includeDeputy ? <DeputyRequestFields workspace={w} departmentId={w.currentUser.departmentId} fromId={w.currentUser.id} value={deputy} onChange={setDeputy}/> : <p className="delegation-empty">업무 등록 후에도 업무대행자를 지정할 수 있습니다.</p>}</section>
      <p className="pw-form-note"><ListChecks size={16}/>기본 절차 4단계(자료 준비 → 내용 검증 → 내부 검토 → 최종 제출)가 함께 만들어집니다. 등록 후 ‘절차’ 탭에서 바꿀 수 있습니다.</p>
      {revision.conflict}
      {creationNotice && <p className="pw-form-note" role="status">{creationNotice}</p>}<div className="form-actions"><Button variant="secondary" onClick={closeCreation}>취소</Button><Button type="submit" disabled={busy || uploadBusy || revision.conflicted || creationCommitted && !createdTaskId || !createdTaskId && includeDeputy && !validDeputyDraft(deputy)}>{busy ? '저장 중…' : createdTaskId ? '추가 변경사항 저장' : includeDeputy ? '세부업무 등록·대행 승인 요청' : '세부업무 등록'}</Button></div>
    </form>
  </Modal>;
}
export function TaskPanel({ workspace: w, taskId, command, onClose, onWorkspace, initialMode = 'edit', routedTab, onTabChange, onNavigateView }: { workspace: Workspace; taskId: string; command: CommandFn; onClose: () => void; onWorkspace?: (workspace: Workspace) => void; initialMode?: 'view' | 'edit' } & TaskRoutingProps) {
  const currentTask = w.tasks.find(item => item.id === taskId) as DetailedTask | undefined;
  const lastAllowed = useRef<{ actorId: string; taskId: string; task: DetailedTask } | null>(null);
  if (lastAllowed.current?.actorId !== w.currentUser.id || lastAllowed.current?.taskId !== taskId) lastAllowed.current = null;
  const unavailable = !currentTask || !!currentTask.deletedAt;
  if (!unavailable) lastAllowed.current = { actorId: w.currentUser.id, taskId, task: currentTask };
  const task = unavailable ? lastAllowed.current?.task : currentTask;
  if (!task) return <Modal title="업무를 확인할 수 없습니다." onClose={onClose}><EmptyState title="접근 가능한 업무가 아닙니다." description="삭제한 업무는 개인업무의 휴지통에서 복원할 수 있습니다. 접근 권한이 변경된 경우 담당자에게 확인해 주세요." /></Modal>;
  return <UnsavedChangesBoundary key={`${w.currentUser.id}-${task.id}`}><TaskEditor task={task} workspace={w} command={command} unavailable={unavailable} onClose={onClose} onWorkspace={onWorkspace} initialMode={initialMode} routedTab={routedTab} onTabChange={onTabChange} onNavigateView={onNavigateView} /></UnsavedChangesBoundary>;
}

function TaskEditor({ task, workspace: w, command: executeCommand, onClose, onWorkspace, initialMode, unavailable = false, routedTab, onTabChange, onNavigateView }: { task: DetailedTask; workspace: Workspace; command: CommandFn; onClose: () => void; onWorkspace?: (workspace: Workspace) => void; initialMode: 'view' | 'edit'; unavailable?: boolean } & TaskRoutingProps) {
  const mounted = useMountedDraft();
  const unavailableRef = useRef(unavailable); unavailableRef.current = unavailable;
  const command: CommandFn = (type, payload, options) => unavailableRef.current ? Promise.resolve(false) : executeCommand(type, payload, options);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [recoveryText, setRecoveryText] = useState('');
  const [recoveryNotice, setRecoveryNotice] = useState('');
  const [localTab, setLocalTab] = useState<TaskTab>(routedTab ?? 'overview');
  const [mode, setMode] = useState<'view' | 'edit' | 'records'>(initialMode);
  const revision = useRevisionCommand(w, command, { kind: 'task', id: task.id });
  const [historyViewing, setHistoryViewing] = useState(false);
  const currentRun = latestTaskRun(w, task.id);
  const currentRunId = currentRun?.id || '';
  const previousRunId = useRef(currentRunId);
  const [showBuilder, setShowBuilder] = useState(false);
  const procedureAiReasonId = useId();
  const divisionLocked = isDepartmentConfirmed(w, task.departmentId);
  const [unitId, setUnitId] = useState(task.unitId);
  const ownUnits = sortUnitsByImportance(w.units.filter(unit => !unit.deletedAt && unit.ownerId === w.currentUser.id));
  const originalUnit = w.units.find(unit => unit.id === task.unitId);
  const unitOptions = originalUnit && !ownUnits.some(unit => unit.id === originalUnit.id) ? sortUnitsByImportance([originalUnit, ...ownUnits]) : ownUnits;
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.dueDate);
  const [frequency, setFrequency] = useState<Frequency>(task.frequency);
  const [supportIds, setSupportIds] = useState<string[]>(task.supportIds);
  const [cooperationDepartmentIds, setCooperationDepartmentIds] = useState<string[]>(task.cooperationDepartmentIds ?? []);
  const [reviewRequired, setReviewRequired] = useState(task.commonId ? true : task.reviewRequired !== false);
  const [description, setDescription] = useState(task.description);
  const [descriptionAttachmentIds, setDescriptionAttachmentIds] = useState<string[]>(task.descriptionAttachmentIds ?? []);
  const [budgetDraft, setBudgetDraft] = useState(() => taskBudgetDraft(task));
  const [expenses, setExpenses] = useState<Expense[]>(structuredClone(task.expenses || []));
  const [references, setReferences] = useState<Reference[]>(structuredClone(task.references || []));
  const [workflow, setWorkflow] = useState<PlannedStep[]>(structuredClone(task.workflow));
  const [flowRevision, setFlowRevision] = useState(0);
  const [drawnWorkflow, setDrawnWorkflow] = useState(JSON.stringify(task.workflow));
  const [procedureNotice, setProcedureNotice] = useState('');
  const [scheduleResetIds, setScheduleResetIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const mayEdit = !unavailable && canEditDepartmentDefinitions(w, w.currentUser, task.departmentId) && (task.primaryId === w.currentUser.id || w.currentUser.role === 'admin') && task.status !== 'archived' && !task.deletedAt && isRegistered(task, w);
  const editable = mayEdit && mode === 'edit' && !historyViewing;
  const isDeputy = canActAsDeputy(w, w.currentUser, task, undefined, new Date(w.serverTime));
  const deputies = activeTaskDelegations(w, task, undefined, new Date(w.serverTime));
  const canRecord = task.primaryId === w.currentUser.id || task.supportIds.includes(w.currentUser.id) || canActAsDeputy(w, w.currentUser, task, 'task.record', new Date(w.serverTime));
  const mayRecord = !unavailable && w.currentUser.role !== 'head' && (canRecord || w.currentUser.role === 'admin') && task.status !== 'archived' && !task.deletedAt && isRegistered(task, w);
  const recordsEditable = mayRecord && mode === 'records' && !historyViewing;
  const expensesEditable = editable || recordsEditable;
  const canReview = w.currentUser.id === task.reviewerId || w.currentUser.role === 'admin' || (w.currentUser.role === 'head' && w.currentUser.departmentId === task.departmentId);
  const currentCommon = task.commonId ? w.commonTasks.find(item => item.id === task.commonId) : undefined;
  const lastCommon = useRef(currentCommon);
  if (!unavailable) lastCommon.current = currentCommon;
  const common = unavailable ? lastCommon.current : currentCommon;
  const directiveDistribution = common?.kind === 'directive' ? common.distributions.find(item => item.taskId === task.id) : undefined;
  const requestedTab = routedTab ?? localTab;
  const tab = requestedTab === 'monthly' && !directiveDistribution ? 'overview' : requestedTab;
  const activeTab = useRef(tab); activeTab.current = tab;
  const setTab = (next: TaskTab) => { if (!mounted.current) return; setLocalTab(next); onTabChange?.(next); };
  useEffect(() => {
    if (routedTab === 'monthly' && !directiveDistribution) onTabChange?.('overview');
  }, [routedTab, directiveDistribution, onTabChange]);
  useEffect(() => { setHistoryViewing(false); }, [routedTab]);
  const execution = taskExecution(w, task);
  const progress = execution.progress;
  const workspaceTask = w.tasks.find(item => item.id === task.id);
  const status = executionStatus(task, execution.run, progress, execution.nextRole);
  const definition = definitionState(task.status);
  const { overdue } = deadlineState({ taskDueDate: task.dueDate, cycleDueDate: workspaceTask?.cycleDueDate, progress, runStatus: execution.run?.status, taskStatus: task.status, deletedAt: task.deletedAt }, todayFor(w));
  const withoutDone = (steps: PlannedStep[]) => JSON.stringify(cleanWorkflow(steps).map(({ done: _done, ...rest }) => rest));
  const workflowDirty = withoutDone(workflow) !== withoutDone(task.workflow);
  const participants = taskProcedureParticipants(w, { ...task, supportIds, cooperationDepartmentIds });
  const procedureContext = taskProcedureContext(w, { ...task, title, unitId });
  const diagramChanged = JSON.stringify(workflow) !== drawnWorkflow;
  const savedReferences = referencesForSave(references);
  const formDirty = JSON.stringify(supportIds) !== JSON.stringify(task.supportIds) || JSON.stringify(cooperationDepartmentIds) !== JSON.stringify(task.cooperationDepartmentIds ?? []) || reviewRequired !== (task.commonId ? true : task.reviewRequired !== false) || workflowDirty || unitId !== task.unitId || title !== task.title || description !== task.description || JSON.stringify(descriptionAttachmentIds) !== JSON.stringify(task.descriptionAttachmentIds ?? []) || dueDate !== task.dueDate || frequency !== task.frequency || JSON.stringify(budgetDraft) !== JSON.stringify(taskBudgetDraft(task)) || JSON.stringify(expenses) !== JSON.stringify(task.expenses || []) || JSON.stringify(savedReferences) !== JSON.stringify(task.references || []);
  const taskDraftId = useUnsavedChanges(formDirty, '업무·절차 수정');
  const { requestNavigation, requestWorkspaceNavigation } = useUnsavedNavigation();
  const closeEditor = () => requestNavigation(onClose);
  const navigateToView = (view: 'organization' | 'performance') => requestWorkspaceNavigation(() => {
    if (onNavigateView) onNavigateView(view);
    else { onClose(); window.location.hash = view; }
  });
  const changeTab = (next: typeof tab) => { if (next !== tab) requestNavigation(() => { setTab(next); setHistoryViewing(false); setMessage(''); }, undefined, [taskDraftId]); };
  const detailTabs = useTabs<TaskTab>({ value: tab, onChange: changeTab, items: [
    { value: 'overview', label: <><FileText size={16} />업무 개요</> },
    { value: 'references', label: <><Landmark size={16} />관련 근거</> },
    { value: 'workflow', label: <><ListChecks size={16} />절차</> },
    { value: 'schedule', label: <><CalendarDays size={16} />일정·수행</> },
    { value: 'performance', label: <><Trophy size={16} />성과</> },
    { value: 'budget', label: <><Wallet size={16} />예산·집행</> },
    ...(directiveDistribution ? [{ value: 'monthly' as const, label: <><CalendarDays size={16} />월별 실적</> }] : []),
  ] });
  const showValidation = (next: typeof tab, message: string) => { setMessage(message); requestNavigation(() => { setTab(next); setMessage(message); }, undefined, [taskDraftId]); };
  const draftValues = { supportIds, cooperationDepartmentIds, reviewRequired, unitId, title, description, descriptionAttachmentIds, dueDate, frequency, budgetDraft, expenses, references, workflow };
  const latestDraft = useRef(draftValues); latestDraft.current = draftValues;
  const [saveAcknowledgement, setSaveAcknowledgement] = useState<{ revision: number; draft: typeof draftValues } | null>(null);
  useEffect(() => {
    if (revision.conflicted || unavailable) { setSaveAcknowledgement(null); return; }
    if (!saveAcknowledgement || w.revision <= saveAcknowledgement.revision) return;
    const submitted = saveAcknowledgement.draft;
    // Accept server normalization only for fields unchanged since submission.
    setUnitId(current => current === submitted.unitId ? task.unitId : current);
    setTitle(current => current === submitted.title ? task.title : current);
    setSupportIds(current => sameDraft(current, submitted.supportIds) ? task.supportIds : current);
    setCooperationDepartmentIds(current => sameDraft(current, submitted.cooperationDepartmentIds) ? task.cooperationDepartmentIds ?? [] : current);
    setReviewRequired(current => current === submitted.reviewRequired ? task.commonId ? true : task.reviewRequired !== false : current);
    setDescription(current => current === submitted.description ? task.description : current);
    setDescriptionAttachmentIds(current => JSON.stringify(current) === JSON.stringify(submitted.descriptionAttachmentIds) ? task.descriptionAttachmentIds ?? [] : current);
    setDueDate(current => current === submitted.dueDate ? task.dueDate : current);
    setFrequency(current => current === submitted.frequency ? task.frequency : current);
    setBudgetDraft(current => JSON.stringify(current) === JSON.stringify(submitted.budgetDraft) ? taskBudgetDraft(task) : current);
    setExpenses(current => JSON.stringify(current) === JSON.stringify(submitted.expenses) ? structuredClone(task.expenses || []) : current);
    setReferences(current => JSON.stringify(current) === JSON.stringify(submitted.references) ? structuredClone(task.references || []) : current);
    setWorkflow(current => withoutDone(current) === withoutDone(submitted.workflow) ? structuredClone(task.workflow) : current);
    setSaveAcknowledgement(null);
  }, [saveAcknowledgement, task, w.revision, revision.conflicted, unavailable]);
  const previousTask = useRef(task);
  useEffect(() => {
    const previous = previousTask.current;
    previousTask.current = task;
    if (revision.conflicted || unavailable) return;
    // Schedule/execution commands update the task projection without replacing
    // unsaved definition edits in another tab.
    setWorkflow(current => withoutDone(current) === withoutDone(previous.workflow) ? structuredClone(task.workflow) : current);
    setDueDate(current => current === previous.dueDate ? task.dueDate : current);
    setSupportIds(current => sameDraft(current, previous.supportIds) ? task.supportIds : current);
    setCooperationDepartmentIds(current => sameDraft(current, previous.cooperationDepartmentIds ?? []) ? task.cooperationDepartmentIds ?? [] : current);
    setReviewRequired(current => current === (previous.commonId ? true : previous.reviewRequired !== false) ? task.commonId ? true : task.reviewRequired !== false : current);
    setReferences(current => JSON.stringify(current) === JSON.stringify(previous.references || []) ? structuredClone(task.references || []) : current);
    setExpenses(current => JSON.stringify(current) === JSON.stringify(previous.expenses || []) ? structuredClone(task.expenses || []) : current);
    setBudgetDraft(current => JSON.stringify(current) === JSON.stringify(taskBudgetDraft(previous)) ? taskBudgetDraft(task) : current);
    setDescriptionAttachmentIds(current => JSON.stringify(current) === JSON.stringify(previous.descriptionAttachmentIds ?? []) ? task.descriptionAttachmentIds ?? [] : current);
  }, [task, revision.conflicted, unavailable]);
  useEffect(() => {
    if (previousRunId.current === currentRunId) return;
    previousRunId.current = currentRunId;
    if (revision.conflicted || unavailable) return;
    if (formDirty) { setMessage('회차가 갱신되었습니다. 작성 중인 업무 변경사항은 유지했습니다.'); return; }
    setSupportIds(task.supportIds); setCooperationDepartmentIds(task.cooperationDepartmentIds ?? []); setReviewRequired(task.commonId ? true : task.reviewRequired !== false);
    setWorkflow(structuredClone(task.workflow)); setDueDate(task.dueDate); setTitle(task.title); setDescription(task.description); setUnitId(task.unitId); setFrequency(task.frequency); setDescriptionAttachmentIds(task.descriptionAttachmentIds ?? []);
    setBudgetDraft(taskBudgetDraft(task)); setExpenses(structuredClone(task.expenses || [])); setReferences(structuredClone(task.references || []));
    setShowBuilder(false); setHistoryViewing(false); setMessage(''); setSaved(false); setProcedureNotice(''); setScheduleResetIds([]); setDrawnWorkflow(JSON.stringify(task.workflow)); setFlowRevision(value => value + 1);
  }, [currentRunId]);
  const changeStep = (id: string, changes: Partial<PlannedStep>) => { setSaved(false); setProcedureNotice(''); setWorkflow(items => items.map(item => item.id === id ? { ...item, ...changes } : item)); };
  function updateProcedureOrder(result: ProcedureOrderChange, notice: string) {
    if (!result.changed) return;
    setWorkflow(result.workflow); setSaved(false); setMessage(''); setProcedureNotice(notice);
    setScheduleResetIds(ids => [...new Set([...ids, ...result.clearedScheduleIds])].filter(id => result.workflow.some(step => step.id === id)));
  }
  const moveStep = (id: string, direction: 'up' | 'down') => updateProcedureOrder(moveProcedureStep(workflow, id, direction), '표시 순서를 변경했습니다. 선행 관계와 병렬 일정은 유지됩니다.');
  const removeStep = (id: string) => updateProcedureOrder(removeProcedureStep(workflow, id), '절차를 삭제했습니다. 저장·반영 버튼을 눌러 적용해 주세요.');
  function addStep() {
    if (!editable || workflow.length >= 50) return;
    const id = newId('step');
    updateProcedureOrder(appendProcedureStep(workflow, { id, title: '', role: 'primary', description: '', output: '', required: true, dependsOn: [], checklist: [] }), '새 절차의 담당자와 내용을 입력해 주세요.');
    return id;
  }

  async function applyProcedure(steps: WorkflowStep[], addedReferences: TaskReference[], isCurrentDraft?: () => boolean): Promise<boolean> {
    if (!editable || busy || uploadBusy || revision.conflicted || formDirty) { setMessage('작성 중인 업무 변경사항을 먼저 저장한 뒤 절차를 적용해 주세요.'); return false; }
    const submitted = latestDraft.current;
    const nextReferences = referencesForSave([...submitted.references.filter(item => !addedReferences.some(added => added.id === item.id)), ...addedReferences]);
    setMessage(''); setBusy(true);
    try {
      if (!await revision.command('task.procedure.replace', { taskId: task.id, workflow: cleanWorkflow(steps), references: nextReferences, reason: '근거 분석 초안 검토 후 절차 교체' })) return false;
      const unchanged = sameDraft(latestDraft.current, submitted) && (!isCurrentDraft || isCurrentDraft());
      setWorkflow(current => sameDraft(current, submitted.workflow) ? steps : current);
      setReferences(current => sameDraft(current, submitted.references) ? nextReferences : current); setSaved(unchanged);
      setSaveAcknowledgement({ revision: w.revision, draft: { ...submitted, workflow: steps, references: nextReferences } });
      setDrawnWorkflow(JSON.stringify(steps)); setFlowRevision(value => value + 1); if (unchanged) setShowBuilder(false);
      setProcedureNotice(unchanged ? '새 절차를 저장하고 기존 절차를 교체했습니다. 아래 절차를 수정하거나 일정 등록에서 업무를 이어갈 수 있습니다.' : '요청한 절차는 저장했습니다. 저장 중 추가로 수정한 내용은 초안에 남아 있습니다. 검토한 뒤 다시 저장해 주세요.');
      return true;
    } catch { setMessage('절차를 적용하지 못했습니다. 초안을 유지했으니 연결 상태와 최신 업무를 확인한 뒤 다시 적용해 주세요.'); return false; }
    finally { setBusy(false); }
  }

  async function save(): Promise<boolean> {
    if (!formDirty) return true;
    if (!editable || busy || uploadBusy || revision.conflicted) return false;
    setMessage(''); setSaved(false);
    const requiredFields = [
      ...(!task.commonId ? [{ path: 'title', value: title, label: '세부업무 이름' }, { path: 'dueDate', value: dueDate, label: '업무 마감일' }] : []),
      { path: 'description', value: description, label: '업무 설명' },
    ];
    if (requiredFields.some(field => !field.value.trim())) {
      if (activeTab.current === 'overview') { validateTextFields(requiredFields); return false; }
      requestNavigation(() => { setTab('overview'); setHistoryViewing(false); requestAnimationFrame(() => validateTextFields(requiredFields)); }, undefined, [taskDraftId]);
      return false;
    }
    const budgetError = taskBudgetIssue(budgetDraft, expenses) || taskExpenseIssue(expenses, task.expenses);
    if (budgetError) { showValidation('budget', budgetError); return false; }
    if (savedReferences.some(item => !item.title.trim() || (!item.content.trim() && !item.attachmentId) || (item.url && !/^https?:\/\//i.test(item.url)))) { showValidation('references', '근거의 제목과 내용 또는 첨부파일을 입력하고, 링크는 http:// 또는 https://로 시작해 주세요.'); return false; }
    if (!workflow.length || workflow.some(step => !step.title.trim() || (step.startDate && step.dueDate && step.startDate > step.dueDate))) { showValidation('workflow', '각 절차의 이름을 입력하고 종료일을 시작일 이후로 설정해 주세요.'); return false; }
    const workflowErrors = procedureErrors(cleanWorkflow(workflow), { reviewRequired });
    if (workflowErrors.length) { showValidation('workflow', workflowErrors[0]); return false; }
    setBusy(true);
    try { if (await revision.command('task.configure', { taskId: task.id, supportIds, cooperationDepartmentIds, reviewRequired, ...(unitId !== task.unitId ? { unitId } : {}), ...(!task.commonId ? { title, ...(dueDate !== task.dueDate ? { dueDate } : {}), frequency } : {}), description, descriptionAttachmentIds, ...taskBudgetPayload(budgetDraft), expenses, references: savedReferences, ...(workflowDirty ? { workflow: cleanWorkflow(workflow) } : {}) })) { setSaved(sameDraft(latestDraft.current, draftValues)); setSaveAcknowledgement({ revision: w.revision, draft: draftValues }); if (workflowDirty || tab === 'workflow') { setDrawnWorkflow(JSON.stringify(workflow)); setFlowRevision(value => value + 1); setProcedureNotice('수정한 절차와 순서를 저장하고 절차도에 반영했습니다.' + (scheduleResetIds.length ? ' 일정 미정으로 바뀐 절차의 날짜는 일정·수행에서 다시 등록해 주세요.' : '')); if (sameDraft(latestDraft.current.workflow, workflow)) setScheduleResetIds([]); } return true; } return false; }
    finally { setBusy(false); }
  }

  async function saveRecords() {
    if (!recordsEditable || busy || uploadBusy || revision.conflicted) return;
    setMessage(''); setSaved(false);
    const documents = savedReferences.filter(reference => reference.type === 'document');
    const expenseError = taskExpenseIssue(expenses, task.expenses);
    if (expenseError) { showValidation('budget', expenseError); return; }
    if (documents.some(item => !item.title.trim() || (!item.content.trim() && !item.attachmentId) || (item.url && !/^https?:\/\//i.test(item.url)))) { showValidation('references', '생산 문서의 제목과 내용 또는 첨부파일을 입력하고 원문 링크를 확인해 주세요.'); return; }
    setBusy(true);
    try { if (await revision.command('task.record', { taskId: task.id, expenses, documents })) { setSaved(sameDraft(latestDraft.current, draftValues)); setSaveAcknowledgement({ revision: w.revision, draft: draftValues }); } }
    finally { setBusy(false); }
  }
  function changeMode(next: 'view' | 'edit' | 'records') {
    if (formDirty) { setMessage('작성 중인 변경사항을 먼저 저장한 뒤 입력 모드를 바꿔 주세요.'); return; }
    requestNavigation(() => {
      setMode(next); setMessage(''); setSaved(false);
      if (next === 'records' && !['budget', 'references'].includes(tab)) setTab('references');
    }, undefined, [taskDraftId]);
  }

  const procedureAiDisabledReason = unavailable ? '업무 접근 권한을 확인한 뒤 절차를 작성할 수 있습니다.'
    : !mayEdit || historyViewing ? divisionLocked ? '업무분장이 확정되어 있습니다. 부서장의 재작성 허용 후 AI로 절차를 작성할 수 있습니다.' : '업무 기준을 수정할 수 있는 담당자만 AI로 절차를 작성할 수 있습니다.'
    : revision.conflicted ? '최신 업무 내용을 확인한 뒤 다시 작성해 주세요. 현재 입력값은 유지됩니다.'
    : busy || uploadBusy ? '저장 또는 파일 처리가 끝난 뒤 절차를 작성해 주세요.'
    : formDirty ? '변경한 업무 개요·관련 근거·절차를 먼저 저장해 주세요. 저장된 내용을 기준으로 분석합니다.' : '';
  function openProcedureBuilder() {
    if (procedureAiDisabledReason) return;
    requestNavigation(() => {
      setMode('edit'); setShowBuilder(true); setMessage(''); setProcedureNotice('');
    }, undefined, [taskDraftId]);
  }

  async function copyVisibleDraft() {
    const values = Array.from(bodyRef.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select') || []).filter(control => !['file', 'hidden', 'password'].includes(control.type) && !(['checkbox', 'radio'].includes(control.type) && !(control as HTMLInputElement).checked)).map(control => {
      const label = control.closest<HTMLElement>('[data-field-label]')?.dataset.fieldLabel || control.getAttribute('aria-label') || control.name || '입력 내용';
      const value = control instanceof HTMLSelectElement ? Array.from(control.selectedOptions).map(option => option.text).join(', ') : control.value;
      return `${label}: ${value}`;
    });
    const readValues = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>('[data-read-label][data-read-value]') || []).map(field => `${field.dataset.readLabel}: ${field.dataset.readValue}`);
    const fileName = (id: string) => w.attachments.find(file => file.id === id)?.name || id;
    const text = [
      `세부업무: ${title}`, `업무 설명: ${description}`, `업무 마감: ${dueDate}`,
      `소속 단위업무: ${w.units.find(unit => unit.id === unitId)?.title || unitId}`, `반복 주기: ${frequencyNames[frequency]}`,
      `사업 예산: ${budgetDraft.amount}원`, `업무 설명 자료: ${descriptionAttachmentIds.map(fileName).join(', ') || '없음'}`,
      ...workflow.map((step, index) => `절차 ${index + 1}: ${step.title} · ${roleNames[step.role]}\n${step.description}\n${[step.startDate, step.dueDate].filter(Boolean).join(' ~ ')}`),
      ...expenses.map(item => `집행: ${item.date} · ${item.projectName || title} · ${item.vendor || ''} · ${money(item.amount)}원\n${item.description}`),
      ...references.map(item => `참고자료: ${item.title}\n${item.content || ''}${item.url ? `\n원문 링크: ${item.url}` : ''}${item.attachmentId ? `\n참고 파일: ${fileName(item.attachmentId)}` : ''}`),
      ...values, ...readValues,
    ].join('\n\n');
    setRecoveryText(text);
    try { await navigator.clipboard.writeText(text); setRecoveryNotice('현재 화면의 입력 내용을 복사했습니다.'); }
    catch { setRecoveryNotice('아래 내용을 선택하여 직접 복사해 주세요.'); }
  }

  return <Modal className="pw-task-detail" title={task.title} description={`${w.units.find(unit => unit.id === task.unitId)?.title || '단위업무'} · ${task.code}`} onClose={closeEditor} wide>
    <>{isDeputy && <p className="delegation-current"><CheckCircle2 size={17}/>업무대행 중 · 원담당자의 업무에서 수행 기록을 함께 작성합니다. 업무 소유권과 최종 검토 권한은 원래대로 유지됩니다.</p>}</><div className="pw-detail-modebar"><nav className="pw-detail-hierarchy" aria-label="업무 계층"><span><Folder size={14} />단위업무 · {originalUnit?.title || '연결 확인 필요'}</span><ChevronRight size={14} /><span><FileText size={14} />세부업무</span></nav><div className="pw-detail-mode-actions">{!historyViewing && mayEdit && mode !== 'edit' && <Button variant="accent" onClick={() => changeMode('edit')}><Pencil size={14} />업무 기준 수정</Button>}{!historyViewing && mayRecord && mode !== 'records' && <Button variant="secondary" onClick={() => changeMode('records')}><FileText size={14} />수행 기록 입력</Button>}{!historyViewing && mode === 'records' && <Badge tone="info">수행 기록 입력 중</Badge>}{!historyViewing && mode === 'edit' && <Badge tone="info">{mayEdit ? '업무 기준 수정 중' : canReview || canRecord ? '진행상태 확인' : '보기'}</Badge>}</div></div>
    {mode === 'records' && !historyViewing && <p className="pw-form-note">관련 근거의 생산 문서와 예산·집행의 집행 내역을 입력합니다. 저장한 기록은 업무 기준과 진행 중인 절차를 바꾸지 않습니다.</p>}
    {divisionLocked && <div className="pw-division-lock compact" role="status"><CheckCircle2 size={18}/><p>업무분장 확정 · 업무 기준은 잠겨 있습니다. 일정 등록과 수행 기록은 계속 입력할 수 있습니다.</p></div>}
    {unavailable && <section className="pw-form-error" role="alert"><strong>업무가 삭제되었거나 접근 권한이 변경되었습니다.</strong><p>작성 중인 내용을 보관했습니다. 저장과 파일 업로드는 중지되어 있습니다. 필요한 입력 내용을 복사한 뒤 닫아 주세요.</p><Button type="button" variant="secondary" onClick={() => void copyVisibleDraft()}>현재 입력 내용 복사</Button>{recoveryNotice && <p role="status">{recoveryNotice}</p>}{recoveryText && <textarea aria-label="보관된 입력 내용" readOnly rows={6} value={recoveryText} onFocus={event => event.currentTarget.select()} />}</section>}
    {!unavailable && revision.conflict}
    <div className="pw-detail-summary"><div><Badge tone={task.commonId ? 'info' : 'soft'}>{common?.kind === 'directive' ? '지시사항' : task.commonId ? '공통업무' : '개인업무'}</Badge><Badge tone={status.tone}>{status.label}</Badge><Badge tone={definition.tone}>{definition.label}</Badge><span>업무 마감 {formatDeadline(task.dueDate)}{workspaceTask?.cycleDueDate && <> · 회차 {formatDeadline(workspaceTask.cycleStartDate)}~{formatDeadline(workspaceTask.cycleDueDate)}</>}</span>{overdue && <Badge tone="warning">기한 경과</Badge>}</div><div className="pw-detail-progress"><Progress value={progress} /><b>{progress}%</b></div></div>
    <Tabs tabs={detailTabs} label="세부업무 상세" className="tabs pw-detail-tabs" />
    <fieldset disabled={unavailable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} onSubmitCapture={event => { if (unavailable) { event.preventDefault(); event.stopPropagation(); } }} onChangeCapture={event => { if (unavailable) { event.preventDefault(); event.stopPropagation(); } }} onClickCapture={event => { if (unavailable && event.currentTarget.contains(event.target as Node) && (event.target as HTMLElement).closest('a, button, label')) { event.preventDefault(); event.stopPropagation(); } }}>
    <div className="pw-detail-body" ref={bodyRef} {...detailTabs.panelAttrs(tab)}>
      {tab === 'overview' && <div className="form-stack">
        <div className="pw-unit-move">
          {editable && task.primaryId === w.currentUser.id ? <Field name="unitId" label="소속 단위업무 · 상위 업무 묶음"><select value={unitId} onChange={e => { setUnitId(e.target.value); setSaved(false); }}>{!unitOptions.some(unit => unit.id === task.unitId) && <option value={task.unitId}>기존 연결 단위업무</option>}{unitOptions.map(unit => <option key={unit.id} value={unit.id}>{unit.title} · 중요도 {unitImportance(unit)}{unit.ownerId !== task.primaryId ? ' · 공유 단위' : ''}</option>)}</select></Field>
            : <ReadField label="소속 단위업무 · 상위 업무 묶음" value={w.units.find(unit => unit.id === unitId)?.title || '연결 확인 필요'} />}
          <p><Folder size={13} />{!editable || task.primaryId !== w.currentUser.id ? '이 세부업무가 속한 단위업무입니다.' : unitId !== task.unitId ? '변경사항을 저장하면 선택한 단위업무 아래로 이동합니다.' : ownUnits.some(unit => unit.id === task.unitId) ? '내 단위업무를 선택해 이 세부업무를 다른 업무 묶음으로 옮길 수 있습니다.' : '공유 단위에 연결된 업무입니다. 내가 만든 단위업무로 옮길 수 있습니다.'}</p>
          {!ownUnits.length && editable && <p>옮길 단위업무가 없습니다. 개인업무 화면에서 내 단위업무를 먼저 만들어 주세요.</p>}
        </div>
        <div className="form-grid">
          {editable && !task.commonId ? <>
            <Field name="title" label="세부업무 이름" span><input required maxLength={150} value={title} onChange={e => { setTitle(e.target.value); setSaved(false); }} /></Field>
            <Field name="dueDate" label="업무 마감일"><DateInput required aria-label="업무 마감일" value={dueDate} onChange={value => { setDueDate(value); setSaved(false); }} />{isPastDate(dueDate, w.serverTime) && <small className="muted" role="status">오늘 이전 날짜입니다. 이미 지난 업무를 기록하는 경우에만 사용해 주세요.</small>}</Field>
            <Field name="frequency" label="반복 주기"><select value={frequency} onChange={e => { setFrequency(e.target.value as Frequency); setSaved(false); }}>{Object.entries(frequencyNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
          </> : <>
            <ReadField label="세부업무 이름" value={title} span />
            <ReadField label="업무 마감일" value={dueDate} date />
            <ReadField label="반복 주기" value={frequencyNames[frequency]} />
          </>}
        </div>
        <div className="pw-facts"><div><span>담당자</span><strong>{w.users.find(user => user.id === task.primaryId)?.name || '배정 대기'}</strong></div><div><span>소속 부서</span><strong>{w.departments.find(dept => dept.id === task.departmentId)?.name || '부서'}</strong></div><div><span>업무대행</span><strong>{deputies.length ? deputies.map(item => w.users.find(user => user.id === item.toId)?.name || '대행자').join(', ') : '현재 대행자 없음'}</strong></div></div>
        {editable ? <Field name="description" label="업무 설명"><textarea rows={7} maxLength={20000} value={description} onChange={e => { setDescription(e.target.value); setSaved(false); }} /></Field> : <ReadField label="업무 설명" value={description} />}
        <TaskDescriptionFiles workspace={w} taskId={task.id} title={title} description={description} attachmentIds={descriptionAttachmentIds} onAttachmentsChange={ids => { if (unavailableRef.current) return; setDescriptionAttachmentIds(ids); setSaved(false); }} onDescriptionChange={value => { if (unavailableRef.current) return; setDescription(value); setSaved(false); }} onWorkspace={next => { if (!unavailableRef.current) onWorkspace?.(next); }} onBusyChange={setUploadBusy} disabled={!editable}/>
        {editable ? <TaskAssignmentFields workspace={w} primaryId={task.primaryId} departmentId={task.departmentId} supportIds={supportIds} cooperationDepartmentIds={cooperationDepartmentIds} onSupportChange={ids => { setSupportIds(ids); setSaved(false); }} onDepartmentsChange={ids => { setCooperationDepartmentIds(ids); setSaved(false); }}/> : <ReadField label="협업·지원" value={participants.support}/>}
        <TaskDelegationSection workspace={w} command={command} task={task} disabled={formDirty || unavailable}/>
        <div className="pw-soft-block"><h3>완료 기준</h3><p>{task.completionCriteria}</p></div>
        {common && <div className="pw-source-origin"><Inbox size={19} /><div><strong>공통업무에서 이어진 일</strong><p>{common.title}{common.projectName ? ` · ${common.projectName}` : ''}</p>{common.kind === 'directive' && <p>지시자 {common.directiveIssuer ? directiveIssuerLabels[common.directiveIssuer] : '미입력'} · 지시일자 {formatDeadline(common.instructedOn)} · 완료 전까지 매월 실적 관리</p>}</div></div>}
        <div className="pw-detail-footnote"><span>업무 기준 v{task.version}</span><span>{formatDeadline(task.updatedAt)} 수정</span></div>
      </div>}

      {tab === 'workflow' && <div className="form-stack">
        <section className="pw-procedure-ai-entry" aria-label="AI 절차 작성">
          <div className="pw-procedure-ai-copy"><span><Sparkles size={20}/></span><div><h3>업무 개요에서 절차도로</h3><p>업무 개요와 첨부파일을 중심으로 분석하고, 관련 근거를 참고해 담당자·수행 단계·진행 순서를 작성합니다.</p></div></div>
          {showBuilder ? <Button type="button" variant="secondary" disabled={busy || uploadBusy} onClick={() => requestNavigation(() => { setShowBuilder(false); setProcedureNotice(''); }, undefined, [taskDraftId])}>현재 절차로 돌아가기</Button>
            : <Button type="button" variant="accent" disabled={!!procedureAiDisabledReason} aria-describedby={procedureAiDisabledReason ? procedureAiReasonId : undefined} onPointerEnter={() => void preloadProcedureBuilder()} onFocus={() => void preloadProcedureBuilder()} onClick={openProcedureBuilder}><Sparkles size={16}/>AI로 절차·절차도 작성</Button>}
          {!showBuilder && procedureAiDisabledReason && <p className="pw-procedure-ai-reason" id={procedureAiReasonId}>{procedureAiDisabledReason}</p>}
        </section>
        {editable && <label className="task-review-option"><input type="checkbox" checked={reviewRequired} disabled={!!task.commonId} onChange={event => { setReviewRequired(event.target.checked); setSaved(false); }}/><span>필수 검토 단계 유지{task.commonId ? " · 공통업무의 필수 검토는 유지됩니다." : " · 해제하면 불필요한 검토 단계를 삭제할 수 있습니다."}</span></label>}
        {formDirty && <p className="pw-form-note">작성한 절차와 파일 연결은 저장 후 반영됩니다.</p>}
        {procedureNotice && <p className="pw-procedure-notice" role="status"><CheckCircle2 size={17}/>{procedureNotice}</p>}{scheduleResetIds.length > 0 && <p className="pw-form-note" role="status">바뀐 순서와 날짜가 맞지 않는 절차({workflow.filter(step => scheduleResetIds.includes(step.id)).map(step => step.title || '새 절차').join(', ')})는 일정 미정으로 바뀝니다. 저장 후 일정·수행에서 날짜를 다시 정해 주세요.</p>}
        {showBuilder && (editable || unavailable) ? <ProcedureBuilder taskId={task.id} overview={{ title, description, completionCriteria: task.completionCriteria, descriptionAttachmentIds, reviewRequired }} overviewAttachments={w.attachments.filter(file => descriptionAttachmentIds.includes(file.id))} disabled={formDirty || unavailable} workflow={workflow} references={references} participants={participants} context={procedureContext} hasSupport={supportIds.length > 0 || cooperationDepartmentIds.length > 0} reviewRequired={reviewRequired} requiredStepTitles={common?.requiredSteps} onApply={applyProcedure}/>
          : <ProcedureEditor hasReviewer={!!task.reviewerId} onStartEditing={mayEdit && !historyViewing ? () => changeMode('edit') : undefined} onOpenOrganization={() => navigateToView('organization')} workspace={w} taskId={task.id} command={command} onWorkspace={next => { if (!unavailableRef.current) onWorkspace?.(next); }} onBusyChange={setUploadBusy} workflow={workflow} originalWorkflow={task.workflow} participants={participants} context={procedureContext} hasSupport={supportIds.length > 0 || cooperationDepartmentIds.length > 0} reviewRequired={reviewRequired} hasChanges={formDirty} requiredStepTitles={common?.requiredSteps} editable={editable} busy={busy || uploadBusy || revision.conflicted} diagramChanged={diagramChanged} redrawKey={flowRevision} onApply={save} onChange={changeStep} onRemove={removeStep} onMove={moveStep} onAdd={addStep}/>
        }
        {!showBuilder && <div className="pw-task-route"><p>{formDirty ? '절차를 저장하면 각 절차에 일정을 등록할 수 있습니다.' : '절차가 준비되었다면 수행할 날짜를 정해 보세요.'}</p><Button type="button" variant="accent" disabled={busy || uploadBusy || revision.conflicted} onClick={async () => { if (formDirty) { const submitted = latestDraft.current; const submittedTab = activeTab.current; if (await save() && sameDraft(latestDraft.current, submitted) && activeTab.current === submittedTab) setTab('schedule'); } else setTab('schedule'); }}><CalendarDays size={16}/>{formDirty ? '저장하고 일정 등록' : '일정 등록'}<ArrowRight size={15}/></Button></div>}
      </div>}

      {tab === 'schedule' && <><WorkCycles key={task.id} workspace={w} task={task} command={command} dirty={formDirty} unavailable={unavailable} onHistoryChange={setHistoryViewing}/>{!historyViewing && <Button type="button" variant="secondary" onPointerEnter={() => void preloadTaskPerformance()} onFocus={() => void preloadTaskPerformance()} onClick={() => changeTab('performance')}><Trophy size={16}/>업무 성과 입력<ArrowRight size={15}/></Button>}</>}

      {tab === 'monthly' && common && directiveDistribution && <DirectiveMonthlyReports workspace={w} common={common} distribution={directiveDistribution} command={command} embedded preservedDraftIds={[taskDraftId]} onBusyChange={setUploadBusy} />}

      {tab === 'performance' && <TaskPerformance workspace={w} task={unavailable ? { ...task, deletedAt: task.deletedAt || w.serverTime } : task} command={command} onBusyChange={setUploadBusy} preservedDraftIds={[taskDraftId]} onGoPerformance={() => navigateToView('performance')} />}

      {tab === 'budget' && <TaskBudgetSection value={budgetDraft} onChange={value => { setBudgetDraft(value); setSaved(false); }} expenses={expenses} onExpensesChange={items => { setExpenses(items); setSaved(false); }} previousExpenses={task.expenses ?? []} definitionEditable={editable} expensesEditable={expensesEditable} today={todayFor(w)} defaultProjectName={title}/> }

      {tab === 'references' && <TaskReferences workspace={w} taskId={task.id} references={references} editable={editable || recordsEditable} documentsOnly={recordsEditable} command={command} onBusyChange={setUploadBusy} onChange={items => { if (unavailableRef.current) return; setReferences(items); setSaved(false); }}/>}
      {!historyViewing && ['budget', 'references'].includes(tab) && !!task.recordHistory?.length && <details className="pw-record-history"><summary>수행 기록 변경 이력 · {task.recordHistory.length}건</summary>{[...task.recordHistory].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).map(record => <article key={record.id}><strong>{formatDateTimeFull(record.recordedAt)}</strong><small> · {w.users.find(user => user.id === record.recordedBy)?.name || w.identities?.find(user => user.id === record.recordedBy)?.name || '이전 담당자'}</small><p>집행 합계 {money(record.expensesBefore.reduce((sum, item) => sum + item.amount, 0))}원 → {money(record.expensesAfter.reduce((sum, item) => sum + item.amount, 0))}원</p><p>이전 생산 문서: {record.documentsBefore.map(document => document.title).join(', ') || '없음'}</p><p>변경 후 생산 문서: {record.documentsAfter.map(document => document.title).join(', ') || '없음'}</p></article>)}</details>}

    </div>
    {(['overview', 'references', 'workflow', 'schedule', 'performance', 'budget', ...(directiveDistribution ? ['monthly'] : [])] as TaskTab[]).filter(value => value !== tab).map(value => <div key={value} {...detailTabs.panelAttrs(value)} />)}
    </fieldset>
    {message && <p className="pw-form-error" role="alert">{message}</p>}
    <div className="form-actions pw-editor-actions"><span className="pw-save-state" role="status">{historyViewing ? '지난 회차의 기록을 확인하고 있습니다. 현재 회차에서 업무를 이어갈 수 있습니다.' : tab === 'monthly' ? '월별 실적은 이 탭에서 별도로 저장합니다.' : tab === 'performance' ? '업무 성과는 이 탭에서 저장하고, 성과 · 평가에서 제출합니다.' : saved ? <><CheckCircle2 size={15} />변경사항을 저장했습니다.</> : tab === 'schedule' ? '일정과 수행 기록은 이 탭에서 별도로 저장합니다.' : recordsEditable ? '생산 문서와 집행 내역은 수행 기록 저장을 눌러 반영합니다.' : divisionLocked ? '업무 기준은 잠겨 있습니다. 수행 기록 입력으로 생산 문서·집행 내역을 추가할 수 있습니다.' : !mayEdit ? '업무 담당자가 내용을 수정할 수 있습니다.' : mode === 'view' ? "보기 모드입니다. '업무 기준 수정'을 눌러 내용을 바꿀 수 있습니다." : '변경한 내용은 저장 후 반영됩니다.'}</span><Button type="button" variant="secondary" onClick={closeEditor}>닫기</Button>{recordsEditable && (['references', 'budget'].includes(tab) || formDirty) && <Button type="button" variant="accent" disabled={busy || uploadBusy || revision.conflicted || !formDirty} onClick={saveRecords}>{busy ? '저장 중…' : '수행 기록 저장'}</Button>}{editable && (!['schedule', 'performance', 'monthly'].includes(tab) || formDirty) && <Button type="button" variant="accent" disabled={busy || uploadBusy || revision.conflicted || !formDirty || (tab === 'workflow' && showBuilder)} onClick={save}>{busy ? '저장 중…' : tab === 'workflow' ? '수정사항 저장·절차도 반영' : '변경사항 저장'}</Button>}</div>
  </Modal>;
}

type ScheduleEvent = { id: string; taskId: string; taskTitle: string; title: string; startDate: string; dueDate: string; kind: 'task' | 'step'; done: boolean; role?: WorkflowStep['role'] };

export function ScheduleView({ workspace: w, command, onOpenTask }: ViewProps) {
  const today = todayFor(w);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selectedDay, setSelectedDay] = useState(today);
  const [kind, setKind] = useState<'all' | 'step' | 'task'>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const tasks = w.tasks.filter(task => !task.deletedAt && task.status !== 'archived' && isRegistered(task, w) && (task.primaryId === w.currentUser.id || task.supportIds.includes(w.currentUser.id) || task.reviewerId === w.currentUser.id || (['head', 'admin'].includes(w.currentUser.role) && task.departmentId === w.currentUser.departmentId)));
  const events: ScheduleEvent[] = tasks.flatMap(task => {
    const execution = taskExecution(w, task);
    const steps = currentExecutionWorkflow(w, task).filter(step => step.startDate || step.dueDate).map(step => ({ id: `${task.id}-${step.id}`, taskId: task.id, taskTitle: task.title, title: step.title, startDate: step.startDate || step.dueDate!, dueDate: step.dueDate || step.startDate!, kind: 'step' as const, done: !!step.done, role: step.role }));
    return [...steps, { id: `${task.id}-due`, taskId: task.id, taskTitle: task.title, title: task.title, startDate: task.dueDate, dueDate: task.dueDate, kind: 'task' as const, done: executionStatus(task, execution.run, execution.progress, execution.nextRole).key === 'completed' }];
  }).filter(event => kind === 'all' || event.kind === kind);
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const offset = first.getUTCDay();
  const days = Array.from({ length: 42 }, (_, index) => new Date(Date.UTC(year, monthNumber - 1, index - offset + 1)).toISOString().slice(0, 10));
  const daily = events.filter(event => event.startDate <= selectedDay && event.dueDate >= selectedDay);
  const unscheduled = tasks.flatMap(task => currentExecutionWorkflow(w, task).filter(step => !step.startDate && !step.dueDate && !step.done).map(step => ({ task, step })));
  const monthEvents = events.filter(event => event.startDate.slice(0, 7) <= month && event.dueDate.slice(0, 7) >= month);
  const openTask = (id: string) => onOpenTask ? onOpenTask(id) : setDetailId(id);
  const changeMonth = (change: number) => { const next = new Date(Date.UTC(year, monthNumber - 1 + change, 1)).toISOString().slice(0, 7); setMonth(next); setSelectedDay(next === today.slice(0, 7) ? today : `${next}-01`); };

  return <>
    <div className="page-heading"><div><p className="eyebrow">다가오는 일정</p><h1>업무 일정</h1><p className="muted">업무 마감과 현재 회차의 절차별 일정을 확인하세요. 지난 회차의 일정은 세부업무에서 조회할 수 있습니다.</p></div><Badge tone="outline"><CalendarDays size={14} />이번 달 일정 {monthEvents.length}건</Badge></div>
    <div className="pw-calendar-toolbar"><div className="pw-month-control"><button className="pw-icon-button" aria-label="이전 달" onClick={() => changeMonth(-1)}><ChevronLeft size={19} /></button><h2>{year}년 {monthNumber}월</h2><button className="pw-icon-button" aria-label="다음 달" onClick={() => changeMonth(1)}><ChevronRight size={19} /></button><Button variant="secondary" onClick={() => { setMonth(today.slice(0, 7)); setSelectedDay(today); }}>오늘</Button></div><div className="tabs">{([['all', '전체'], ['step', '업무 절차'], ['task', '업무 마감']] as const).map(([id, label]) => <button key={id} className={kind === id ? 'active' : ''} aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</button>)}</div></div>
    <div className="pw-calendar-layout"><section className="pw-calendar" aria-label={`${year}년 ${monthNumber}월 업무 일정`}><div className="pw-calendar-weekdays">{['일', '월', '화', '수', '목', '금', '토'].map(day => <span key={day}>{day}</span>)}</div><div className="pw-calendar-grid">{days.map(day => { const dayEvents = events.filter(event => event.startDate <= day && event.dueDate >= day); return <button key={day} className={`pw-calendar-day ${day.slice(0, 7) !== month ? 'outside' : ''} ${day === today ? 'today' : ''} ${day === selectedDay ? 'selected' : ''}`} aria-label={`${day}, 일정 ${dayEvents.length}건`} aria-pressed={day === selectedDay} onClick={() => setSelectedDay(day)}><span className="pw-day-number">{Number(day.slice(8))}</span><span className="pw-calendar-chips">{dayEvents.slice(0, 2).map(event => <span key={event.id} className={`pw-calendar-chip ${event.done ? 'done' : ''} ${event.kind === 'task' ? 'deadline' : ''}`}>{event.kind === 'task' ? '마감 · ' : ''}{event.title}</span>)}{dayEvents.length > 2 && <span className="pw-calendar-more">+{dayEvents.length - 2}개</span>}</span><span className="pw-calendar-mobile-dots">{dayEvents.slice(0, 3).map(event => <i key={event.id} data-status={event.done ? "complete" : event.kind === "task" ? "attention" : "progress"} />)}</span></button>; })}</div></section><aside className="pw-day-detail"><div className="pw-day-detail-header"><span className="eyebrow">선택한 날짜</span><h2>{Number(selectedDay.slice(5, 7))}월 {Number(selectedDay.slice(8))}일</h2><p>{daily.length ? `${daily.length}개의 일정이 있습니다.` : '등록된 일정이 없습니다.'}</p></div><div className="pw-day-events">{daily.map(event => <button key={event.id} className="pw-day-event" onClick={() => openTask(event.taskId)}><div><Badge tone={event.done ? 'success' : event.kind === 'task' ? 'warning' : 'info'}>{event.kind === 'task' ? '업무 마감' : event.done ? '완료한 절차' : '업무 절차'}</Badge><ArrowRight size={15} /></div><h3>{event.title}</h3>{event.kind === 'step' && <p>{event.taskTitle}</p>}<span><CalendarDays size={13} />{formatDate(event.startDate, { today: w.serverTime })}{event.startDate !== event.dueDate ? ` — ${formatDate(event.dueDate, { today: w.serverTime })}` : ''}{event.role === 'reviewer' ? ' · 검토' : ''}</span></button>)}{!daily.length && <div className="pw-day-empty"><CalendarDays size={28} /><p>여유 있는 하루입니다.</p><span>세부업무에서 절차별 날짜를 설정하면 이곳에 표시됩니다.</span></div>}</div></aside></div>
    {unscheduled.length > 0 && <section className="pw-unscheduled"><div className="pw-section-intro"><div><h3>일정을 기다리는 절차 <span>{unscheduled.length}</span></h3><p>업무를 열어 시작일과 종료일을 연결해 주세요.</p></div><Clock3 size={22} /></div><div className="pw-unscheduled-list">{unscheduled.slice(0, 6).map(({ task, step }) => <button key={`${task.id}-${step.id}`} onClick={() => openTask(task.id)}><span><b>{step.title}</b><small>{task.title}</small></span><span>일정 설정 <ArrowRight size={15} /></span></button>)}</div>{unscheduled.length > 6 && <p className="pw-form-note">외 {unscheduled.length - 6}개 절차의 일정은 각 세부업무에서 설정할 수 있습니다.</p>}</section>}
    {detailId && <TaskPanel workspace={w} taskId={detailId} command={command} onClose={() => setDetailId(null)} />}
  </>;
}

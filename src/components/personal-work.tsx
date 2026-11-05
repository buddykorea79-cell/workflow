'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowRight, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, Clock3, FileText, Folder, FolderPlus, Inbox, Pencil, RotateCcw, Landmark, Layers3, Link2, ListChecks, Plus, Search, Trash2, Trophy, Wallet } from 'lucide-react';
import type { Frequency, Task, TaskReference, Unit, WorkflowStep, Workspace } from '@/lib/types';
import { Badge, Button, EmptyState, Field, Modal, Progress } from './ui';
import './personal-work.css';
import { canEditDepartmentDefinitions, isDepartmentConfirmed } from '@/lib/work-division';
import { ProcedureBuilder, ProcedureFlow } from './procedure-builder';
import { WorkCycles } from './work-cycles';
import { TaskReferences } from './task-references';
import { TaskPerformance } from './task-performance';
import { DirectiveMonthlyReports } from './directive-monthly';
import { directiveIssuerLabels } from '@/lib/directives';
import { referencesForSave } from '@/lib/task-references';
import { latestTaskRun, taskExecution } from '@/lib/common-status';

type CommandFn = (type: string, payload: Record<string, unknown>) => Promise<boolean>;
type ViewProps = { workspace: Workspace; command: CommandFn; onOpenTask?: (id: string) => void };
type Expense = { id: string; date: string; description: string; amount: number };
type Reference = TaskReference;
type PlannedStep = WorkflowStep & { startDate?: string; dueDate?: string; done?: boolean };
type DetailedTask = Task & { budget?: number; expenses?: Expense[]; references?: Reference[]; workflow: PlannedStep[] };

const frequencyNames: Record<Frequency, string> = { once: '한 번', monthly: '매월', quarterly: '분기별', half_yearly: '반기별', yearly: '매년' };
const definitionNames: Record<Task['status'], string> = { draft: '작성 중', review: '검토 대기', confirmed: '확정', revision: '수정 중', archived: '보관' };
const roleNames: Record<WorkflowStep['role'], string> = { primary: '담당자 수행', support: '협업·지원', reviewer: '검토·승인' };
const money = (value: number) => new Intl.NumberFormat('ko-KR').format(value);
const formatDate = (date?: string) => date ? `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}` : '일정 미정';
const todayFor = (w: Workspace) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(w.serverTime));
const newId = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const cleanWorkflow = (steps: PlannedStep[]) => steps.map(step => ({ ...step, startDate: step.startDate || undefined, dueDate: step.dueDate || undefined }));
const isRegistered = (task: Task, workspace: Workspace) => {
  const distribution = workspace.commonTasks.find(common => common.id === task.commonId)?.distributions.find(item => item.taskId === task.id);
  return !distribution || ['registered', 'submitted', 'assigned'].includes(distribution.status);
};

export function taskProgress(task: Task, workspace: Workspace): number {
  return taskExecution(workspace, task).progress;
}

export function PersonalWork({ workspace: w, command }: ViewProps) {
  const definitionEditable = canEditDepartmentDefinitions(w, w.currentUser, w.currentUser.departmentId);
  const mine = w.tasks.filter(task => task.primaryId === w.currentUser.id && !task.deletedAt && task.status !== 'archived' && isRegistered(task, w));
  const ownUnits = w.units.filter(unit => unit.ownerId === w.currentUser.id && !unit.deletedAt);
  const units = w.units.filter(unit => !unit.deletedAt && (unit.ownerId === w.currentUser.id || mine.some(task => task.unitId === unit.id)));
  const trashUnits = w.units.filter(unit => unit.ownerId === w.currentUser.id && !!unit.deletedAt);
  const trashTasks = w.tasks.filter(task => task.primaryId === w.currentUser.id && !!task.deletedAt);
  const [unitId, setUnitId] = useState('all');
  const [filter, setFilter] = useState<'all' | 'personal' | 'common'>('all');
  const [query, setQuery] = useState('');
  const [create, setCreate] = useState<'unit' | 'task' | null>(null);
  const [createTaskUnitId, setCreateTaskUnitId] = useState('');
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [pendingUnitTitle, setPendingUnitTitle] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ id: string; mode: 'view' | 'edit' } | null>(null);
  const [deleting, setDeleting] = useState<{ kind: 'unit' | 'task'; id: string; title: string } | null>(null);
  const [registering, setRegistering] = useState<{ commonId: string; distributionId: string; title: string } | null>(null);
  const [registerUnit, setRegisterUnit] = useState('');
  const [busy, setBusy] = useState(false);
  const selectedUnit = units.find(unit => unit.id === unitId);
  const editingUnit = w.units.find(unit => unit.id === editingUnitId);
  const inTrash = unitId === 'trash';
  const visible = mine.filter(task => (unitId === 'all' || task.unitId === unitId) && (filter === 'all' || (filter === 'common' ? !!task.commonId : !task.commonId)) && `${task.title} ${task.description}`.toLowerCase().includes(query.toLowerCase()));
  const inbox = w.commonTasks.flatMap(common => common.distributions.filter(item => item.assigneeId === w.currentUser.id && item.status === 'person_assigned').map(item => ({ common, distribution: item })));
  const complete = mine.filter(task => taskProgress(task, w) === 100).length;
  const grouped = (selectedUnit ? [selectedUnit] : units).map(unit => ({ unit, tasks: visible.filter(task => task.unitId === unit.id) })).filter(group => group.tasks.length > 0 || (!query && filter === 'all'));
  const missingUnitTasks = unitId === 'all' ? visible.filter(task => !units.some(unit => unit.id === task.unitId)) : [];
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
    if (!['all', 'trash'].includes(unitId) && !w.units.some(unit => unit.id === unitId && !unit.deletedAt)) setUnitId('all');
  }, [unitId, w.units]);
  const openTask = (id: string, mode: 'view' | 'edit') => setDetail({ id, mode });
  const cards = (tasks: Task[]) => <div className="pw-task-list">{tasks.map(task => <PersonalTaskCard key={task.id} task={task} workspace={w} onView={() => openTask(task.id, 'view')} onEdit={() => openTask(task.id, 'edit')} onDelete={() => setDeleting({ kind: 'task', id: task.id, title: task.title })} />)}</div>;

  return <>
    <div className="page-heading">
      <div><p className="eyebrow">My workspace</p><h1>개인업무.</h1><p className="muted">나의 단위업무와 세부업무를 한 화면에서 관리하세요.</p></div>
      <div className="pw-page-actions"><Button variant="secondary" disabled={!definitionEditable} onClick={() => setCreate('unit')}><FolderPlus size={17} />단위업무 추가</Button><Button disabled={!definitionEditable} onClick={() => beginTask()}><Plus size={17} />세부업무 추가</Button></div>
    </div>
    {!definitionEditable && <div className="pw-division-lock" role="status"><CheckCircle2 size={20}/><div><strong>부서 업무분장이 확정되었습니다.</strong><p>단위·세부업무의 추가, 수정, 삭제는 부서장의 재작성 허용 후 가능합니다. 진행 체크와 성과 기록은 계속할 수 있습니다.</p></div></div>}
    <div className="pw-hierarchy-guide" aria-label="업무 구조 안내"><div><span className="pw-hierarchy-icon"><Folder size={19} /></span><span><b>단위업무</b><small>여러 일을 묶는 업무 폴더</small></span></div><ChevronRight size={19} /><div><span className="pw-hierarchy-icon child"><FileText size={18} /></span><span><b>세부업무</b><small>폴더 안에서 수행하는 실행 과제</small></span></div></div>

    {!inTrash && inbox.length > 0 && <section className="pw-inbox">
      <div className="pw-inbox-title"><Inbox size={21} /><div><strong>배정받은 공통업무 {inbox.length}건</strong><p>내 단위업무에 연결하면 세부업무로 등록됩니다.</p></div></div>
      <div className="pw-inbox-list">{inbox.map(({ common, distribution }) => <div className="pw-inbox-item" key={distribution.id}><span><Badge tone={common.kind === 'directive' ? 'warning' : 'info'}>{common.kind === 'directive' ? '지시사항' : '공통업무'}</Badge><b>{common.title}</b><small>{formatDate(common.dueDate)}까지</small></span><Button variant="secondary" disabled={!definitionEditable} onClick={() => { setRegistering({ commonId: common.id, distributionId: distribution.id, title: common.title }); setRegisterUnit(ownUnits.find(unit => unit.id === unitId)?.id || ownUnits[0]?.id || ''); }}>내 업무에 등록 <ArrowDownLeft size={15} /></Button></div>)}</div>
    </section>}

    <div className="pw-layout">
      <aside className="pw-unit-rail">
        <div className="pw-rail-heading"><span>단위업무 · 업무 묶음</span><button className="pw-icon-button" aria-label="단위업무 추가" disabled={!definitionEditable} onClick={() => setCreate('unit')}><Plus size={17} /></button></div>
        <button className={`pw-unit-button ${unitId === 'all' ? 'active' : ''}`} onClick={() => setUnitId('all')}><Layers3 size={18} /><span>전체 업무</span><b>{mine.length}</b></button>
        <div className="pw-unit-list">{units.map(unit => <button key={unit.id} className={`pw-unit-button ${unitId === unit.id ? 'active' : ''}`} onClick={() => setUnitId(unit.id)}><Folder size={18} /><span>{unit.title}{unit.ownerId !== w.currentUser.id && <small>공유 단위 · {w.users.find(user => user.id === unit.ownerId)?.name || '다른 담당자'}</small>}</span><b>{mine.filter(task => task.unitId === unit.id).length}</b></button>)}</div>
        <button className="pw-add-unit" disabled={!definitionEditable} onClick={() => setCreate('unit')}><FolderPlus size={17} />단위업무 추가</button>
        <button className={`pw-unit-button pw-trash-nav ${inTrash ? 'active' : ''}`} onClick={() => setUnitId('trash')}><Trash2 size={17} /><span>휴지통</span><b>{trashUnits.length + trashTasks.length}</b></button>
        <div className="pw-rail-note"><span className="pw-rail-number">{complete}<span> / {mine.length}</span></span><p>완료한 세부업무</p><Progress value={mine.length ? complete / mine.length * 100 : 0} /></div>
      </aside>

      <section className="pw-work-area">
        <nav className="pw-hierarchy-breadcrumb" aria-label="개인업무 위치"><button onClick={() => setUnitId('all')}>개인업무</button><ChevronRight size={14} /><span>{inTrash ? '휴지통' : selectedUnit ? selectedUnit.title : '전체 단위업무'}</span>{selectedUnit && <><ChevronRight size={14} /><span>세부업무</span></>}</nav>
        {inTrash ? <PersonalTrash workspace={w} command={command} /> : <>
          <div className="pw-unit-header"><div>{selectedUnit && <p className="pw-unit-kind"><Folder size={14} />단위업무 · 업무 묶음</p>}<h2>{selectedUnit?.title || '단위업무별 세부업무'} <span>{visible.length}</span></h2><p>{selectedUnit?.description || '업무 묶음을 선택해 세부 실행 과제를 추가·수정·삭제합니다.'}</p></div>{selectedUnit ? <div className="pw-unit-actions">{selectedUnit.ownerId === w.currentUser.id ? <><Button variant="secondary" disabled={!definitionEditable} onClick={() => setEditingUnitId(selectedUnit.id)}><Pencil size={14} />단위 수정</Button><Button variant="secondary" disabled={!definitionEditable} onClick={() => setDeleting({ kind: 'unit', id: selectedUnit.id, title: selectedUnit.title })}><Trash2 size={14} />단위 삭제</Button><Button disabled={!definitionEditable} onClick={() => beginTask(selectedUnit.id)}><Plus size={15} />세부업무 추가</Button></> : <Badge tone="outline">공유 단위 · {w.users.find(user => user.id === selectedUnit.ownerId)?.name || '다른 담당자'} 소유</Badge>}</div> : <span className="pw-view-symbol"><Layers3 size={24} /></span>}</div>
          {selectedUnit && selectedUnit.ownerId !== w.currentUser.id && <p className="pw-legacy-note">기존에 연결된 나의 세부업무입니다. 세부업무의 ‘수정’에서 내가 만든 단위업무로 옮길 수 있습니다.</p>}
          <div className="pw-toolbar"><div className="tabs pw-filter-tabs" aria-label="업무 구분">{([['all', '전체'], ['personal', '개인업무'], ['common', '공통업무']] as const).map(([value, label]) => <button key={value} type="button" className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div><label className="pw-search"><Search size={16} /><input aria-label="세부업무 검색" placeholder="세부업무 검색" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
          <div className="pw-task-groups">{grouped.map(({ unit, tasks }) => <section className="pw-task-group" key={unit.id} aria-label={`${unit.title}의 세부업무`}>
            {!selectedUnit && <div className="pw-group-header"><button className="pw-group-title" onClick={() => setUnitId(unit.id)}><span><Folder size={19} /></span><div><small>{unit.ownerId === w.currentUser.id ? '내 단위업무' : `공유 단위 · ${w.users.find(user => user.id === unit.ownerId)?.name || '다른 담당자'} 소유`}</small><h3>{unit.title}<b>{tasks.length}</b></h3></div><ChevronRight size={16} /></button>{unit.ownerId === w.currentUser.id && <Button variant="secondary" disabled={!definitionEditable} onClick={() => beginTask(unit.id)}><Plus size={15} />세부업무 추가</Button>}</div>}
            {tasks.length ? cards(tasks) : <div className="pw-group-empty"><FileText size={22} /><div><b>아직 세부업무가 없습니다.</b><p>이 업무 묶음 안에서 수행할 실행 과제를 추가하세요.</p></div>{unit.ownerId === w.currentUser.id && <Button variant="ghost" disabled={!definitionEditable} onClick={() => beginTask(unit.id)}><Plus size={15} />첫 세부업무 추가</Button>}</div>}
          </section>)}{missingUnitTasks.length > 0 && <section className="pw-task-group"><div className="pw-group-header"><h3>단위업무 연결 확인</h3><p className="muted">수정에서 내 단위업무를 선택해 주세요.</p></div>{cards(missingUnitTasks)}</section>}</div>
          {!grouped.length && !missingUnitTasks.length && <EmptyState title={query || filter !== 'all' ? '조건에 맞는 세부업무가 없습니다.' : '첫 단위업무를 만들어 보세요.'} description={query || filter !== 'all' ? '검색어나 업무 구분을 변경해 보세요.' : '단위업무는 여러 세부 실행 과제를 담는 업무 묶음입니다.'} action={!query && filter === 'all' && <Button variant="secondary" disabled={!definitionEditable} onClick={() => setCreate('unit')}><FolderPlus size={16} />단위업무 만들기</Button>} />}
        </>}
      </section>
    </div>

    {create === 'unit' && <UnitForm workspace={w} command={command} onClose={() => setCreate(null)} onCreated={title => setPendingUnitTitle(title)} />}
    {editingUnit && <UnitForm key={editingUnit.id} unit={editingUnit} workspace={w} command={command} onClose={() => setEditingUnitId(null)} />}
    {create === 'task' && <CreateTask workspace={w} units={ownUnits} selectedUnitId={createTaskUnitId} command={command} onClose={() => setCreate(null)} />}
    {detail && <TaskPanel workspace={w} taskId={detail.id} initialMode={detail.mode} command={command} onClose={() => setDetail(null)} />}
    {deleting && <DeleteWorkConfirm target={deleting} workspace={w} command={command} onClose={() => setDeleting(null)} onInspectUnit={id => { setUnitId(id); setDeleting(null); }} />}
    {registering && <Modal title="내 단위업무에 등록" description="배정받은 공통업무를 내 업무 묶음 아래의 세부업무로 연결합니다." onClose={() => setRegistering(null)}><form className="form-stack" onSubmit={async event => { event.preventDefault(); setBusy(true); try { if (await command('common.register', { commonId: registering.commonId, distributionId: registering.distributionId, unitId: registerUnit })) { setUnitId(registerUnit); setRegistering(null); } } finally { setBusy(false); } }}><div className="pw-soft-block"><Badge tone="info">배정받은 세부업무</Badge><h3>{registering.title}</h3></div><Field label="소속 단위업무 · 내가 만든 업무 묶음"><select required value={registerUnit} onChange={e => setRegisterUnit(e.target.value)}><option value="">단위업무 선택</option>{ownUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></Field>{!ownUnits.length && <p className="muted">이 창을 닫고 내 단위업무를 먼저 만들어 주세요.</p>}<div className="form-actions"><Button type="button" variant="secondary" onClick={() => setRegistering(null)}>취소</Button><Button type="submit" disabled={busy || !registerUnit}>{busy ? '등록 중…' : '세부업무로 등록'}</Button></div></form></Modal>}
  </>;
}

function PersonalTaskCard({ task, workspace: w, onView, onEdit, onDelete }: { task: Task; workspace: Workspace; onView: () => void; onEdit: () => void; onDelete: () => void }) {
  const definitionEditable = canEditDepartmentDefinitions(w, w.currentUser, task.departmentId);
  const progress = taskProgress(task, w);
  const overdue = task.dueDate < todayFor(w) && progress < 100;
  const unit = w.units.find(item => item.id === task.unitId);
  return <article className="pw-task-card" data-status={overdue ? 'attention' : progress === 100 ? 'complete' : progress > 0 ? 'progress' : 'neutral'}>
    <div className="pw-task-card-top"><span className="pw-task-code"><FileText size={13} />세부업무 · {task.code}</span><Badge tone={task.commonId ? 'info' : 'soft'}>{task.commonId ? '공통 배정' : '개인 등록'}</Badge></div>
    <h3><button className="pw-task-title-button" onClick={onView}>{task.title}</button></h3><p className="pw-task-description">{task.description}</p>
    <div className="pw-task-parent"><Folder size={13} /><span>소속 단위업무</span><b>{unit?.title || '연결 확인 필요'}</b></div>
    <div className="pw-task-meta"><span><CalendarDays size={14} />{formatDate(task.dueDate)} 마감{overdue ? ' · 지연' : ''}</span><span>{task.workflow.length}개 절차 · {frequencyNames[task.frequency]}</span></div>
    <div className="pw-task-progress"><Progress value={progress} /><span>{progress}%</span></div>
    <div className="pw-task-card-bottom"><span>{progress === 100 ? <CheckCircle2 size={14} /> : <Circle size={13} />}{progress === 100 ? '완료' : progress > 0 ? '진행 중' : definitionNames[task.status]}</span></div>
    <div className="pw-task-actions"><Button variant="secondary" onClick={onView}><FileText size={14} />보기</Button><Button variant="secondary" disabled={!definitionEditable} onClick={onEdit}><Pencil size={14} />수정</Button><Button variant="ghost" className="pw-delete-button" disabled={!definitionEditable || !!task.commonId} title={task.commonId ? '공통 배정업무는 배정 이력을 보존하므로 삭제할 수 없습니다.' : '세부업무를 휴지통으로 이동'} onClick={onDelete}><Trash2 size={14} />삭제</Button></div>
  </article>;
}

function UnitForm({ workspace: w, unit, command, onClose, onCreated }: { workspace: Workspace; unit?: Unit; command: CommandFn; onClose: () => void; onCreated?: (title: string) => void }) {
  const [title, setTitle] = useState(unit?.title || '');
  const [description, setDescription] = useState(unit?.description || '');
  const [busy, setBusy] = useState(false);
  return <Modal title={unit ? '단위업무 수정' : '단위업무 만들기'} description="단위업무는 여러 세부업무를 담는 나의 업무 묶음입니다." onClose={onClose}><form className="form-stack" onSubmit={async e => { e.preventDefault(); setBusy(true); try { if (await command(unit ? 'unit.update' : 'unit.create', unit ? { unitId: unit.id, title, description } : { title, description, ownerId: w.currentUser.id })) { if (!unit) onCreated?.(title.trim()); onClose(); } } finally { setBusy(false); } }}><Field label="단위업무 이름 · 업무 묶음의 이름"><input required maxLength={100} value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 예산 편성 및 집행 관리" autoFocus /></Field><Field label="업무 범위와 목적"><textarea required maxLength={5000} rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="이 업무 묶음에 어떤 세부업무를 모아둘지 적어 주세요." /></Field><p className="pw-form-note"><Folder size={15} />{w.currentUser.name}님이 관리하는 단위업무입니다.</p><div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>취소</Button><Button type="submit" disabled={busy}>{busy ? '저장 중…' : unit ? '수정사항 저장' : '단위업무 만들기'}</Button></div></form></Modal>;
}

function DeleteWorkConfirm({ target, workspace: w, command, onClose, onInspectUnit }: { target: { kind: 'unit' | 'task'; id: string; title: string }; workspace: Workspace; command: CommandFn; onClose: () => void; onInspectUnit: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const children = target.kind === 'unit' ? w.tasks.filter(task => task.unitId === target.id && !task.deletedAt && task.status !== 'archived') : [];
  const blocked = children.length > 0;
  return <Modal title={blocked ? '세부업무를 먼저 정리해 주세요.' : `${target.kind === 'unit' ? '단위업무' : '세부업무'}를 삭제할까요?`} description={blocked ? '하위 세부업무가 남아 있는 단위업무는 삭제할 수 없습니다.' : '삭제한 항목은 휴지통에서 다시 복원할 수 있습니다.'} onClose={onClose}><div className="form-stack"><div className="pw-delete-summary">{target.kind === 'unit' ? <Folder size={24} /> : <FileText size={24} />}<div><Badge tone="outline">{target.kind === 'unit' ? '단위업무 · 업무 묶음' : '세부업무 · 실행 과제'}</Badge><h3>{target.title}</h3></div></div>{blocked ? <><p className="muted">이 업무 묶음에 세부업무 {children.length}건이 남아 있습니다. 다른 단위업무로 옮기거나 세부업무를 삭제한 뒤 다시 시도해 주세요.</p><ul className="pw-delete-children">{children.slice(0, 5).map(task => <li key={task.id}><FileText size={14} />{task.title}{task.commonId && <Badge tone="info">공통 배정</Badge>}</li>)}</ul>{children.some(task => task.commonId) && <p className="pw-form-note">공통 배정업무는 삭제할 수 없습니다. 세부업무 수정에서 소속 단위업무를 변경해 주세요.</p>}</> : <p className="muted">{target.kind === 'task' ? '업무 내용과 절차, 예산 및 근거 기록은 함께 보관됩니다. 휴지통으로 이동하면 현재 업무와 일정 목록에서 제외됩니다.' : '이 업무 묶음을 현재 단위업무 목록에서 제외합니다.'}</p>}<div className="form-actions"><Button variant="secondary" disabled={busy} onClick={onClose}>취소</Button>{blocked ? <Button onClick={() => onInspectUnit(target.id)}>세부업무 확인 <ArrowRight size={15} /></Button> : <Button disabled={busy} onClick={async () => { setBusy(true); try { if (await command(`${target.kind}.delete`, target.kind === 'unit' ? { unitId: target.id } : { taskId: target.id })) onClose(); } finally { setBusy(false); } }}><Trash2 size={15} />{busy ? '이동 중…' : '휴지통으로 이동'}</Button>}</div></div></Modal>;
}

function PersonalTrash({ workspace: w, command }: { workspace: Workspace; command: CommandFn }) {
  const definitionEditable = canEditDepartmentDefinitions(w, w.currentUser, w.currentUser.departmentId);
  const units = w.units.filter(unit => unit.ownerId === w.currentUser.id && !!unit.deletedAt);
  const tasks = w.tasks.filter(task => task.primaryId === w.currentUser.id && !!task.deletedAt);
  const [restoringTaskId, setRestoringTaskId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState('');
  const restoringTask = tasks.find(task => task.id === restoringTaskId);
  return <><div className="pw-unit-header"><div><h2>휴지통 <span>{units.length + tasks.length}</span></h2><p>내가 삭제한 단위업무와 세부업무를 다시 복원할 수 있습니다.</p></div><span className="pw-view-symbol"><Trash2 size={24} /></span></div><p className="pw-trash-note">휴지통은 삭제한 항목만 표시합니다. 일반 ‘보관’ 상태의 업무와는 구분됩니다.</p>{!units.length && !tasks.length ? <EmptyState title="휴지통이 비어 있습니다." description="삭제한 내 업무는 이곳에서 복원할 수 있습니다." /> : <div className="pw-trash-sections">{units.length > 0 && <section><h3><Folder size={17} />단위업무 <span>{units.length}</span></h3><div className="pw-trash-list">{units.map(unit => <article key={unit.id}><span className="pw-trash-icon"><Folder size={20} /></span><div><Badge tone="outline">업무 묶음</Badge><h4>{unit.title}</h4><p>{unit.description}</p><small>{new Date(unit.deletedAt!).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })} 삭제</small></div><Button variant="secondary" disabled={!definitionEditable || !!busyId} onClick={async () => { setBusyId(unit.id); try { await command('unit.restore', { unitId: unit.id }); } finally { setBusyId(''); } }}><RotateCcw size={15} />{busyId === unit.id ? '복원 중…' : '복원'}</Button></article>)}</div></section>}{tasks.length > 0 && <section><h3><FileText size={17} />세부업무 <span>{tasks.length}</span></h3><div className="pw-trash-list">{tasks.map(task => { const unit = w.units.find(item => item.id === task.unitId); return <article key={task.id}><span className="pw-trash-icon"><FileText size={20} /></span><div><Badge tone="soft">실행 과제</Badge><h4>{task.title}</h4><p>소속 단위업무 · {unit?.title || '연결 확인 필요'}{unit?.deletedAt ? ' (삭제됨)' : ''}</p><small>{new Date(task.deletedAt!).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })} 삭제{task.deletedFromStatus === 'archived' ? ' · 복원 후 보관 상태 유지' : ''}</small></div><Button variant="secondary" disabled={!definitionEditable} onClick={() => setRestoringTaskId(task.id)}><RotateCcw size={15} />복원</Button></article>; })}</div></section>}</div>}{restoringTask && <RestoreTask key={restoringTask.id} task={restoringTask} workspace={w} command={command} onClose={() => setRestoringTaskId(null)} />}</>;
}

function RestoreTask({ task, workspace: w, command, onClose }: { task: Task; workspace: Workspace; command: CommandFn; onClose: () => void }) {
  const original = w.units.find(unit => unit.id === task.unitId);
  const ownUnits = w.units.filter(unit => unit.ownerId === w.currentUser.id && !unit.deletedAt);
  const options = original && !original.deletedAt && !ownUnits.some(unit => unit.id === original.id) ? [original, ...ownUnits] : ownUnits;
  const [unitId, setUnitId] = useState(original && !original.deletedAt ? original.id : ownUnits[0]?.id || '');
  const [busy, setBusy] = useState(false);
  const [parentBusy, setParentBusy] = useState(false);
  return <Modal title="세부업무 복원" description="복원할 업무의 소속 단위업무를 확인해 주세요." onClose={onClose}><form className="form-stack" onSubmit={async event => { event.preventDefault(); setBusy(true); try { if (await command('task.restore', { taskId: task.id, ...(unitId !== task.unitId ? { unitId } : {}) })) onClose(); } finally { setBusy(false); } }}><div className="pw-soft-block"><Badge tone="info">복원할 세부업무</Badge><h3>{task.title}</h3></div>{original?.deletedAt && <div className="pw-restore-parent"><p>원래 단위업무 ‘{original.title}’도 삭제되어 있습니다. 아래에서 다른 업무 묶음을 선택하거나 원래 단위업무를 먼저 복원하세요.</p>{original.ownerId === w.currentUser.id && <Button variant="secondary" disabled={busy || parentBusy} onClick={async () => { setParentBusy(true); try { if (await command('unit.restore', { unitId: original.id })) setUnitId(original.id); } finally { setParentBusy(false); } }}><RotateCcw size={14} />{parentBusy ? '복원 중…' : '원래 단위업무 복원'}</Button>}</div>}<Field label="소속 단위업무"><select required value={unitId} onChange={e => setUnitId(e.target.value)}><option value="">단위업무 선택</option>{options.map(unit => <option key={unit.id} value={unit.id}>{unit.title}{unit.ownerId !== w.currentUser.id ? ' · 기존 연결' : ''}</option>)}</select></Field>{!options.length && <p className="pw-form-note">사용할 단위업무가 없습니다. 원래 단위업무를 복원하거나 새 단위업무를 먼저 만들어 주세요.</p>}{task.deletedFromStatus === 'archived' && <p className="pw-form-note">삭제 전 ‘보관’ 상태로 복원됩니다. 현재 진행 중인 개인업무 목록에는 표시되지 않습니다.</p>}<div className="form-actions"><Button variant="secondary" onClick={onClose} disabled={busy || parentBusy}>취소</Button><Button type="submit" disabled={busy || parentBusy || !options.some(unit => unit.id === unitId)}><RotateCcw size={15} />{busy ? '복원 중…' : '세부업무 복원'}</Button></div></form></Modal>;
}

function CreateTask({ workspace: w, units, selectedUnitId, command, onClose }: { workspace: Workspace; units: Workspace['units']; selectedUnitId?: string; command: CommandFn; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [unitId, setUnitId] = useState(selectedUnitId || units[0]?.id || '');
  const [dueDate, setDueDate] = useState(todayFor(w));
  const [frequency, setFrequency] = useState<Frequency>('once');
  const reviewers = w.users.filter(user => user.active && user.departmentId === w.currentUser.departmentId && user.id !== w.currentUser.id);
  const [reviewerId, setReviewerId] = useState(reviewers.find(user => user.role === 'head')?.id || reviewers[0]?.id || '');
  const [budget, setBudget] = useState('0');
  const [busy, setBusy] = useState(false);
  return <Modal title="세부업무 등록" description="단위업무 아래에 실행할 일을 구체적으로 기록합니다." onClose={onClose} wide><form className="form-stack" onSubmit={async e => { e.preventDefault(); setBusy(true); try { if (await command('task.create', { title, description, unitId, primaryId: w.currentUser.id, supportIds: [], reviewerId, dueDate, frequency, priority: 'medium', budget: Number(budget), expenses: [], references: [] })) onClose(); } finally { setBusy(false); } }}><div className="form-grid"><Field label="단위업무"><select required value={unitId} onChange={e => setUnitId(e.target.value)}><option value="">단위업무 선택</option>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></Field><Field label="업무 구분"><input value="개인이 등록하는 세부업무" disabled /></Field><Field label="세부업무 이름" span><input required maxLength={150} value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 2027년 예산 요구자료 작성" autoFocus /></Field><Field label="업무 설명" span><textarea required maxLength={5000} rows={4} value={description} onChange={e => setDescription(e.target.value)} placeholder="업무의 목적, 수행 범위, 기대하는 결과를 적어 주세요." /></Field><Field label="업무 마감일"><input required type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} /></Field><Field label="반복 주기"><select value={frequency} onChange={e => setFrequency(e.target.value as Frequency)}>{Object.entries(frequencyNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="사업 예산 (원)"><input type="number" required min="0" step="1" value={budget} onChange={e => setBudget(e.target.value)} /></Field><Field label="최종 검토자"><select required value={reviewerId} onChange={e => setReviewerId(e.target.value)}><option value="">검토자 선택</option>{reviewers.map(user => <option key={user.id} value={user.id}>{user.name} · {user.title}</option>)}</select></Field></div><p className="pw-form-note"><ListChecks size={16} />등록 후 업무 절차와 일정, 집행 내역, 법령·지침 등 근거를 추가할 수 있습니다.</p><div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>취소</Button><Button type="submit" disabled={busy || !reviewerId}>{busy ? '등록 중…' : '세부업무 등록'}</Button></div></form></Modal>;
}

export function TaskPanel({ workspace: w, taskId, command, onClose, initialMode = 'edit' }: { workspace: Workspace; taskId: string; command: CommandFn; onClose: () => void; initialMode?: 'view' | 'edit' }) {
  const task = w.tasks.find(item => item.id === taskId) as DetailedTask | undefined;
  if (!task || task.deletedAt) return <Modal title="업무를 확인할 수 없습니다." onClose={onClose}><EmptyState title="접근 가능한 업무가 아닙니다." description="삭제한 업무는 개인업무의 휴지통에서 복원할 수 있습니다. 접근 권한이 변경된 경우 담당자에게 확인해 주세요." /></Modal>;
  return <TaskEditor key={task.id} task={task} workspace={w} command={command} onClose={onClose} initialMode={initialMode} />;
}

function TaskEditor({ task, workspace: w, command, onClose, initialMode }: { task: DetailedTask; workspace: Workspace; command: CommandFn; onClose: () => void; initialMode: 'view' | 'edit' }) {
  const [tab, setTab] = useState<'details' | 'workflow' | 'schedule' | 'budget' | 'references' | 'performance' | 'monthly'>('details');
  const [mode, setMode] = useState<'view' | 'edit' | 'records'>(initialMode);
  const [historyViewing, setHistoryViewing] = useState(false);
  const currentRun = latestTaskRun(w, task.id);
  const currentRunId = currentRun?.id || '';
  const previousRunId = useRef(currentRunId);
  const [showBuilder, setShowBuilder] = useState(false);
  const divisionLocked = isDepartmentConfirmed(w, task.departmentId);
  const [unitId, setUnitId] = useState(task.unitId);
  const ownUnits = w.units.filter(unit => !unit.deletedAt && unit.ownerId === w.currentUser.id);
  const originalUnit = w.units.find(unit => unit.id === task.unitId);
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.dueDate);
  const [frequency, setFrequency] = useState<Frequency>(task.frequency);
  const [description, setDescription] = useState(task.description);
  const [budget, setBudget] = useState(String(task.budget ?? 0));
  const [expenses, setExpenses] = useState<Expense[]>(structuredClone(task.expenses || []));
  const [references, setReferences] = useState<Reference[]>(structuredClone(task.references || []));
  const [workflow, setWorkflow] = useState<PlannedStep[]>(structuredClone(task.workflow));
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const mayEdit = canEditDepartmentDefinitions(w, w.currentUser, task.departmentId) && (task.primaryId === w.currentUser.id || w.currentUser.role === 'admin') && task.status !== 'archived' && !task.deletedAt && isRegistered(task, w);
  const editable = mayEdit && mode === 'edit' && !historyViewing;
  const canRecord = task.primaryId === w.currentUser.id || task.supportIds.includes(w.currentUser.id);
  const mayRecord = w.currentUser.role !== 'head' && (canRecord || w.currentUser.role === 'admin') && task.status !== 'archived' && !task.deletedAt && isRegistered(task, w);
  const recordsEditable = mayRecord && mode === 'records' && !historyViewing;
  const expensesEditable = editable || recordsEditable;
  const canReview = w.currentUser.id === task.reviewerId || w.currentUser.role === 'admin' || (w.currentUser.role === 'head' && w.currentUser.departmentId === task.departmentId);
  const common = task.commonId ? w.commonTasks.find(item => item.id === task.commonId) : undefined;
  const directiveDistribution = common?.kind === 'directive' ? common.distributions.find(item => item.taskId === task.id) : undefined;
  const total = expenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const progress = taskProgress(task, w);
  const withoutDone = (steps: PlannedStep[]) => JSON.stringify(cleanWorkflow(steps).map(({ done: _done, ...rest }) => rest));
  const workflowDirty = withoutDone(workflow) !== withoutDone(task.workflow);
  const savedReferences = referencesForSave(references);
  const formDirty = workflowDirty || unitId !== task.unitId || title !== task.title || description !== task.description || dueDate !== task.dueDate || frequency !== task.frequency || budget !== String(task.budget ?? 0) || JSON.stringify(expenses) !== JSON.stringify(task.expenses || []) || JSON.stringify(savedReferences) !== JSON.stringify(task.references || []);
  const draftValues = { unitId, title, description, dueDate, frequency, budget, expenses, references, workflow };
  const [saveAcknowledgement, setSaveAcknowledgement] = useState<{ revision: number; draft: typeof draftValues } | null>(null);
  useEffect(() => {
    if (!saveAcknowledgement || w.revision <= saveAcknowledgement.revision) return;
    const submitted = saveAcknowledgement.draft;
    // Accept server normalization only for fields unchanged since submission.
    setUnitId(current => current === submitted.unitId ? task.unitId : current);
    setTitle(current => current === submitted.title ? task.title : current);
    setDescription(current => current === submitted.description ? task.description : current);
    setDueDate(current => current === submitted.dueDate ? task.dueDate : current);
    setFrequency(current => current === submitted.frequency ? task.frequency : current);
    setBudget(current => current === submitted.budget ? String(task.budget ?? 0) : current);
    setExpenses(current => JSON.stringify(current) === JSON.stringify(submitted.expenses) ? structuredClone(task.expenses || []) : current);
    setReferences(current => JSON.stringify(current) === JSON.stringify(submitted.references) ? structuredClone(task.references || []) : current);
    setWorkflow(current => withoutDone(current) === withoutDone(submitted.workflow) ? structuredClone(task.workflow) : current);
    setSaveAcknowledgement(null);
  }, [saveAcknowledgement, task, w.revision]);
  const previousTask = useRef(task);
  useEffect(() => {
    const previous = previousTask.current;
    previousTask.current = task;
    // Schedule/execution commands update the task projection without replacing
    // unsaved definition edits in another tab.
    setWorkflow(current => withoutDone(current) === withoutDone(previous.workflow) ? structuredClone(task.workflow) : current);
    setDueDate(current => current === previous.dueDate ? task.dueDate : current);
    setReferences(current => JSON.stringify(current) === JSON.stringify(previous.references || []) ? structuredClone(task.references || []) : current);
    setExpenses(current => JSON.stringify(current) === JSON.stringify(previous.expenses || []) ? structuredClone(task.expenses || []) : current);
  }, [task]);
  useEffect(() => {
    if (previousRunId.current === currentRunId) return;
    previousRunId.current = currentRunId;
    setWorkflow(structuredClone(task.workflow)); setDueDate(task.dueDate); setTitle(task.title); setDescription(task.description); setUnitId(task.unitId); setFrequency(task.frequency);
    setBudget(String(task.budget ?? 0)); setExpenses(structuredClone(task.expenses || [])); setReferences(structuredClone(task.references || []));
    setShowBuilder(false); setHistoryViewing(false); setMessage(''); setSaved(false);
  }, [currentRunId]);
  const changeStep = (id: string, changes: Partial<PlannedStep>) => { setSaved(false); setWorkflow(items => items.map(item => item.id === id ? { ...item, ...changes } : item)); };
  const removeStep = (id: string) => { setSaved(false); setWorkflow(items => items.filter(item => item.id !== id).map(item => ({ ...item, dependsOn: item.dependsOn.filter(dependency => dependency !== id) }))); };

  async function save() {
    if (!editable || uploadBusy) return;
    setMessage(''); setSaved(false);
    if (!task.commonId && (!title.trim() || !dueDate)) { setTab('details'); setMessage('세부업무 이름과 마감일을 입력해 주세요.'); return; }
    if (!description.trim()) { setTab('details'); setMessage('업무 설명을 입력해 주세요.'); return; }
    if (!Number.isFinite(Number(budget)) || Number(budget) < 0) { setTab('budget'); setMessage('사업 예산은 0 이상의 숫자로 입력해 주세요.'); return; }
    if (expenses.some(item => !item.date || !item.description.trim() || !Number.isFinite(item.amount) || item.amount < 0)) { setTab('budget'); setMessage('집행일, 집행 내용, 0 이상의 금액을 모두 입력해 주세요.'); return; }
    if (savedReferences.some(item => !item.title.trim() || (!item.content.trim() && !item.attachmentId) || (item.url && !/^https?:\/\//i.test(item.url)))) { setTab('references'); setMessage('근거의 제목과 내용 또는 첨부파일을 입력하고, 링크는 http:// 또는 https://로 시작해 주세요.'); return; }
    if (!workflow.length || workflow.some(step => !step.title.trim() || (step.startDate && step.dueDate && step.startDate > step.dueDate))) { setTab('workflow'); setMessage('각 절차의 이름을 입력하고 종료일을 시작일 이후로 설정해 주세요.'); return; }
    setBusy(true);
    try { if (await command('task.configure', { taskId: task.id, ...(unitId !== task.unitId ? { unitId } : {}), ...(!task.commonId ? { title, ...(dueDate !== task.dueDate ? { dueDate } : {}), frequency } : {}), description, budget: Number(budget), expenses, references: savedReferences, ...(workflowDirty ? { workflow: cleanWorkflow(workflow) } : {}) })) { setSaved(true); setSaveAcknowledgement({ revision: w.revision, draft: draftValues }); } }
    finally { setBusy(false); }
  }

  async function saveRecords() {
    if (!recordsEditable || uploadBusy) return;
    setMessage(''); setSaved(false);
    const documents = savedReferences.filter(reference => reference.type === 'document');
    if (expenses.some(item => !item.date || !item.description.trim() || !Number.isFinite(item.amount) || item.amount < 0)) { setTab('budget'); setMessage('집행일, 집행 내용, 0 이상의 금액을 모두 입력해 주세요.'); return; }
    if (documents.some(item => !item.title.trim() || (!item.content.trim() && !item.attachmentId) || (item.url && !/^https?:\/\//i.test(item.url)))) { setTab('references'); setMessage('생산 문서의 제목과 내용 또는 첨부파일을 입력하고 원문 링크를 확인해 주세요.'); return; }
    setBusy(true);
    try { if (await command('task.record', { taskId: task.id, expenses, documents })) { setSaved(true); setSaveAcknowledgement({ revision: w.revision, draft: draftValues }); } }
    finally { setBusy(false); }
  }
  function changeMode(next: 'view' | 'edit' | 'records') {
    if (formDirty) { setMessage('작성 중인 변경사항을 먼저 저장한 뒤 입력 모드를 바꿔 주세요.'); return; }
    setMode(next); setMessage(''); setSaved(false);
    if (next === 'records' && !['budget', 'references'].includes(tab)) setTab('references');
  }

  return <Modal title={task.title} description={`${task.code} · ${w.units.find(unit => unit.id === task.unitId)?.title || '단위업무'} · ${task.commonId ? '공통업무' : '개인업무'}`} onClose={onClose} wide>
    <div className="pw-detail-modebar"><nav className="pw-detail-hierarchy" aria-label="업무 계층"><span><Folder size={14} />단위업무 · {originalUnit?.title || '연결 확인 필요'}</span><ChevronRight size={14} /><span><FileText size={14} />세부업무</span></nav><div className="pw-detail-mode-actions">{!historyViewing && mayEdit && mode !== 'edit' && <Button variant="secondary" disabled={uploadBusy || busy} onClick={() => changeMode('edit')}><Pencil size={14} />업무 기준 수정</Button>}{!historyViewing && mayRecord && mode !== 'records' && <Button variant="secondary" disabled={uploadBusy || busy} onClick={() => changeMode('records')}><FileText size={14} />수행 기록 입력</Button>}{!historyViewing && mode === 'records' && <Badge tone="info">수행 기록 입력 중</Badge>}{!historyViewing && mode === 'edit' && <Badge tone="info">{mayEdit ? '업무 기준 수정 중' : canReview || canRecord ? '진행상태 확인' : '보기'}</Badge>}</div></div>
    {mode === 'records' && !historyViewing && <p className="pw-form-note">관련 근거의 생산 문서와 예산·집행의 집행 내역을 입력합니다. 저장한 기록은 업무 기준과 진행 중인 절차를 바꾸지 않습니다.</p>}
    {divisionLocked && <div className="pw-division-lock compact" role="status"><CheckCircle2 size={18}/><p>업무분장 확정 · 업무 기준은 잠겨 있습니다. 일정 등록과 수행 기록은 계속 입력할 수 있습니다.</p></div>}
    <div className="pw-detail-summary"><div><Badge tone={task.commonId ? 'info' : 'soft'}>{common?.kind === 'directive' ? '지시사항' : task.commonId ? '공통업무' : '개인업무'}</Badge><Badge tone="outline">{definitionNames[task.status]}</Badge><span>{formatDate(task.dueDate)} 마감</span></div><div className="pw-detail-progress"><Progress value={progress} /><b>{progress}%</b></div></div>
    <div className="tabs pw-detail-tabs" aria-label="세부업무 상세">{([['details', '업무 개요', FileText], ['references', '관련 근거', Landmark], ['workflow', '절차', ListChecks], ['schedule', '일정 등록', CalendarDays], ['budget', '예산·집행', Wallet], ...(directiveDistribution ? [['monthly', '월별 실적', CalendarDays] as const] : []), ['performance', '업무 성과', Trophy]] as const).map(([id, title, Icon]) => <button key={id} type="button" className={tab === id ? 'active' : ''} disabled={uploadBusy} aria-pressed={tab === id} onClick={() => { setTab(id); setHistoryViewing(false); setMessage(''); }}><Icon size={16} />{title}</button>)}</div>
    <div className="pw-detail-body">
      {tab === 'details' && <div className="form-stack"><div className="pw-unit-move"><Field label="소속 단위업무 · 상위 업무 묶음"><select value={unitId} disabled={!editable || task.primaryId !== w.currentUser.id} onChange={e => { setUnitId(e.target.value); setSaved(false); }}>{!ownUnits.some(unit => unit.id === task.unitId) && <option value={task.unitId}>{originalUnit?.title || '기존 연결 단위업무'}{originalUnit?.ownerId !== task.primaryId ? ' · 공유 단위' : ''}</option>}{ownUnits.map(unit => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></Field><p><Folder size={13} />{!mayEdit ? '이 세부업무가 속한 단위업무입니다.' : unitId !== task.unitId ? '변경사항을 저장하면 선택한 단위업무 아래로 이동합니다.' : ownUnits.some(unit => unit.id === task.unitId) ? '내 단위업무를 선택해 이 세부업무를 다른 업무 묶음으로 옮길 수 있습니다.' : '공유 단위에 연결된 업무입니다. 내가 만든 단위업무로 옮길 수 있습니다.'}</p>{!ownUnits.length && editable && <p>옮길 단위업무가 없습니다. 개인업무 화면에서 내 단위업무를 먼저 만들어 주세요.</p>}</div>{!task.commonId && <div className="form-grid"><Field label="세부업무 이름" span><input required maxLength={150} value={title} disabled={!editable} onChange={e => { setTitle(e.target.value); setSaved(false); }} /></Field><Field label="업무 마감일"><input required type="date" value={dueDate} disabled={!editable} onChange={e => { setDueDate(e.target.value); setSaved(false); }} /></Field><Field label="반복 주기"><select value={frequency} disabled={!editable} onChange={e => { setFrequency(e.target.value as Frequency); setSaved(false); }}>{Object.entries(frequencyNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field></div>}<div className="pw-facts"><div><span>담당자</span><strong>{w.users.find(user => user.id === task.primaryId)?.name || '배정 대기'}</strong></div><div><span>소속 부서</span><strong>{w.departments.find(dept => dept.id === task.departmentId)?.name || '부서'}</strong></div><div><span>최종 검토자</span><strong>{w.users.find(user => user.id === task.reviewerId)?.name || '미지정'}</strong></div><div><span>수행 주기</span><strong>{frequencyNames[task.frequency]}</strong></div></div><Field label="업무 설명"><textarea rows={7} maxLength={5000} value={description} disabled={!editable} onChange={e => { setDescription(e.target.value); setSaved(false); }} /></Field><div className="pw-soft-block"><h3>완료 기준</h3><p>{task.completionCriteria}</p></div>{common && <div className="pw-source-origin"><Inbox size={19} /><div><strong>공통업무에서 이어진 일</strong><p>{common.title}{common.projectName ? ` · ${common.projectName}` : ''}</p>{common.kind === 'directive' && <p>지시자 {common.directiveIssuer ? directiveIssuerLabels[common.directiveIssuer] : '미입력'} · 지시일자 {common.instructedOn || '미입력'} · 완료 전까지 매월 실적 관리</p>}</div></div>}<div className="pw-detail-footnote"><span>업무 기준 v{task.version}</span><span>{new Date(task.updatedAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })} 수정</span></div></div>}

      {tab === 'workflow' && <div className="form-stack">
        <div className="pw-section-intro"><div><h3>근거를 바탕으로 업무 절차 만들기</h3><p>수행 순서와 역할, 결과물을 정하고 일정 등록 탭에서 날짜와 상세 내용을 계획하세요.</p></div>{editable && <Button type="button" variant="secondary" onClick={() => { const last = workflow.at(-1); setWorkflow(items => [...items, { id: newId('step'), title: '', role: 'primary', description: '', output: '업무 결과', required: true, dependsOn: last ? [last.id] : [], checklist: [] }]); setSaved(false); }}><Plus size={15}/>절차 추가</Button>}</div>
        <div className="pw-procedure-launch"><div><h3>관련 근거 → AI 분석 → 절차도</h3><p>저장한 법령·지침·생산 문서에서 BizRouter AI가 업무 프로세스를 분석합니다. 생성된 역할과 선행 관계는 절차도로 함께 표시됩니다.</p></div><Button variant="secondary" disabled={!editable || formDirty || busy} onClick={() => setShowBuilder(value => !value)}><ListChecks size={16}/>{showBuilder ? '분석 닫기' : 'AI로 절차·절차도 만들기'}</Button></div>
        {formDirty && <p className="pw-form-note">관련 근거와 업무 내용을 먼저 저장한 뒤 AI 분석을 실행하세요.</p>}
        {showBuilder && editable && <ProcedureBuilder taskId={task.id} disabled={formDirty || busy} workflow={workflow} references={references} canReplace={!task.commonId && !task.workflow.some(step => step.done)} onApply={(steps, addedReferences) => { setWorkflow(steps); setReferences(items => [...items.filter(item => !addedReferences.some(added => added.id === item.id)), ...addedReferences]); setSaved(false); setShowBuilder(false); setMessage('AI·자료 초안을 적용했습니다. 절차와 근거를 검토한 뒤 변경사항을 저장하고 일정을 등록하세요.'); }}/> }
        <ProcedureFlow workflow={workflow}/>
        <div className="pw-workflow-list">{workflow.map((step, index) => {
          const done = task.workflow.find(item => item.id === step.id)?.done ?? false;
          const requiredCommon = !!common?.requiredSteps.includes(step.title);
          const lastReviewer = step.role === 'reviewer' && workflow.filter(item => item.role === 'reviewer').length === 1;
          return <section className={`pw-step ${done ? 'is-done' : ''}`} key={step.id}>
            <div className="pw-step-heading"><span className="pw-step-number">{String(index + 1).padStart(2, '0')}</span><div><span>{roleNames[step.role]}</span>{requiredCommon && <Badge tone="outline">공통 필수</Badge>}</div>{editable && !requiredCommon && !lastReviewer && !done && <button type="button" className="pw-icon-button" aria-label={`${step.title || index + 1 + '번'} 절차 삭제`} onClick={() => removeStep(step.id)}><Trash2 size={16}/></button>}</div>
            <div className="form-grid"><Field label="절차 이름" span><input value={step.title} disabled={!editable || requiredCommon || done} maxLength={150} placeholder="예: 자료 취합 및 검증" onChange={e => changeStep(step.id, { title: e.target.value })}/></Field><Field label="수행 내용과 근거" span><textarea rows={3} maxLength={5000} disabled={!editable || done} value={step.description} onChange={e => changeStep(step.id, { description: e.target.value })}/></Field><Field label="담당 역할"><select disabled={!editable || requiredCommon || lastReviewer || done} value={step.role} onChange={e => changeStep(step.id, { role: e.target.value as WorkflowStep['role'] })}>{Object.entries(roleNames).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></Field><Field label="결과물"><input disabled={!editable || done} maxLength={1000} value={step.output} onChange={e => changeStep(step.id, { output: e.target.value })} placeholder="예: 검토 보고서"/></Field></div>
            <p className="pw-step-dependency"><Link2 size={13}/>{step.dependsOn.length ? step.dependsOn.map(id => workflow.find(item => item.id === id)?.title).filter(Boolean).join(', ') + ' 완료 후 수행' : '시작 절차'}</p>
          </section>;
        })}</div><div className="pw-section-intro"><Button type="button" variant="secondary" onClick={() => setTab('schedule')}><CalendarDays size={16}/>일정 등록으로 이동<ArrowRight size={15}/></Button><Button type="button" variant="secondary" onClick={() => setTab('performance')}><Trophy size={16}/>마지막 절차 · 업무 성과 입력<ArrowRight size={15}/></Button></div>
      </div>}

      {tab === 'schedule' && <><WorkCycles key={currentRunId || task.id} workspace={w} task={task} command={command} dirty={formDirty} onHistoryChange={setHistoryViewing}/>{!historyViewing && <Button type="button" variant="secondary" onClick={() => setTab('performance')}><Trophy size={16}/>업무 성과 입력<ArrowRight size={15}/></Button>}</>}

      {tab === 'monthly' && common && directiveDistribution && <DirectiveMonthlyReports workspace={w} common={common} distribution={directiveDistribution} command={command} embedded />}

      {tab === 'performance' && <TaskPerformance workspace={w} task={task} command={command} onGoPerformance={() => { window.location.hash = 'performance'; onClose(); }} />}

      {tab === 'budget' && <div className="form-stack"><div className="pw-budget-summary"><div><span>사업 예산</span><strong>{money(Number(budget) || 0)}<small>원</small></strong></div><div><span>집행 합계</span><strong>{money(total)}<small>원</small></strong></div><div><span>{Number(budget) >= total ? '남은 예산' : '초과 집행'}</span><strong>{money(Math.abs((Number(budget) || 0) - total))}<small>원</small></strong></div></div><Field label="사업 예산 (원)"><input type="number" min="0" step="1" disabled={!editable} value={budget} onChange={e => { setBudget(e.target.value); setSaved(false); }} /></Field><div className="pw-section-intro"><div><h3>집행 내역</h3><p>집행일과 금액을 기록하면 합계가 자동으로 계산됩니다.</p></div>{expensesEditable && <Button type="button" variant="secondary" onClick={() => { setExpenses(items => [...items, { id: newId('expense'), date: todayFor(w), description: '', amount: 0 }]); setSaved(false); }}><Plus size={15} />집행 추가</Button>}</div><div className="pw-expense-list">{expenses.map((expense, index) => <div className="pw-expense-row" key={expense.id}><Field label={`${index + 1}. 집행일`}><input aria-label={`${index + 1}번 집행일`} type="date" disabled={!expensesEditable} value={expense.date} onChange={e => { setExpenses(items => items.map(item => item.id === expense.id ? { ...item, date: e.target.value } : item)); setSaved(false); }} /></Field><Field label="집행 내용"><input aria-label={`${index + 1}번 집행 내용`} disabled={!expensesEditable} value={expense.description} maxLength={500} placeholder="예: 보고서 인쇄비" onChange={e => { setExpenses(items => items.map(item => item.id === expense.id ? { ...item, description: e.target.value } : item)); setSaved(false); }} /></Field><Field label="금액 (원)"><input aria-label={`${index + 1}번 집행 금액`} type="number" min="0" step="1" disabled={!expensesEditable} value={expense.amount} onChange={e => { setExpenses(items => items.map(item => item.id === expense.id ? { ...item, amount: Number(e.target.value) } : item)); setSaved(false); }} /></Field>{expensesEditable && <button type="button" className="pw-icon-button" aria-label={`${index + 1}번 집행 내역 삭제`} onClick={() => { setExpenses(items => items.filter(item => item.id !== expense.id)); setSaved(false); }}><Trash2 size={17} /></button>}</div>)}</div>{!expenses.length && <div className="pw-inline-empty"><Wallet size={25} /><p>아직 등록된 집행 내역이 없습니다.</p></div>}</div>}

      {tab === 'references' && <TaskReferences workspace={w} taskId={task.id} references={references} editable={editable || recordsEditable} documentsOnly={recordsEditable} command={command} onBusyChange={setUploadBusy} onChange={items => { setReferences(items); setSaved(false); }}/>}
      {!historyViewing && ['budget', 'references'].includes(tab) && !!task.recordHistory?.length && <details className="pw-record-history"><summary>수행 기록 변경 이력 · {task.recordHistory.length}건</summary>{[...task.recordHistory].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)).map(record => <article key={record.id}><strong>{new Date(record.recordedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</strong><small> · {w.users.find(user => user.id === record.recordedBy)?.name || w.identities?.find(user => user.id === record.recordedBy)?.name || '이전 담당자'}</small><p>집행 합계 {money(record.expensesBefore.reduce((sum, item) => sum + item.amount, 0))}원 → {money(record.expensesAfter.reduce((sum, item) => sum + item.amount, 0))}원</p><p>이전 생산 문서: {record.documentsBefore.map(document => document.title).join(', ') || '없음'}</p><p>변경 후 생산 문서: {record.documentsAfter.map(document => document.title).join(', ') || '없음'}</p></article>)}</details>}

    </div>
    {message && <p className="pw-form-error" role="alert">{message}</p>}
    <div className="form-actions pw-editor-actions"><span className="pw-save-state" role="status">{historyViewing ? '지난 회차의 기록을 확인하고 있습니다. 현재 회차에서 업무를 이어갈 수 있습니다.' : tab === 'monthly' ? '월별 실적은 이 탭에서 별도로 저장합니다.' : tab === 'performance' ? '업무 성과는 이 탭에서 저장하고, 성과 · 평가에서 제출합니다.' : saved ? <><CheckCircle2 size={15} />변경사항을 저장했습니다.</> : tab === 'schedule' ? '일정과 수행 기록은 이 탭에서 별도로 저장합니다.' : recordsEditable ? '생산 문서와 집행 내역은 수행 기록 저장을 눌러 반영합니다.' : divisionLocked ? '업무 기준은 잠겨 있습니다. 수행 기록 입력으로 생산 문서·집행 내역을 추가할 수 있습니다.' : !mayEdit ? '업무 담당자가 내용을 수정할 수 있습니다.' : mode === 'view' ? '보기 모드입니다. 수정하기를 눌러 내용을 변경하세요.' : '변경한 내용은 저장 후 반영됩니다.'}</span><Button type="button" variant="secondary" onClick={onClose}>닫기</Button>{recordsEditable && (['references', 'budget'].includes(tab) || formDirty) && <Button type="button" disabled={busy || uploadBusy || !formDirty} onClick={saveRecords}>{busy ? '저장 중…' : '수행 기록 저장'}</Button>}{editable && (!['schedule', 'performance', 'monthly'].includes(tab) || formDirty) && <Button type="button" disabled={busy || uploadBusy} onClick={save}>{busy ? '저장 중…' : '변경사항 저장'}</Button>}</div>
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
    const steps = (task.workflow as PlannedStep[]).filter(step => step.startDate || step.dueDate).map(step => ({ id: `${task.id}-${step.id}`, taskId: task.id, taskTitle: task.title, title: step.title, startDate: step.startDate || step.dueDate!, dueDate: step.dueDate || step.startDate!, kind: 'step' as const, done: !!step.done, role: step.role }));
    return [...steps, { id: `${task.id}-due`, taskId: task.id, taskTitle: task.title, title: task.title, startDate: task.dueDate, dueDate: task.dueDate, kind: 'task' as const, done: taskProgress(task, w) === 100 }];
  }).filter(event => kind === 'all' || event.kind === kind);
  const [year, monthNumber] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const offset = first.getUTCDay();
  const days = Array.from({ length: 42 }, (_, index) => new Date(Date.UTC(year, monthNumber - 1, index - offset + 1)).toISOString().slice(0, 10));
  const daily = events.filter(event => event.startDate <= selectedDay && event.dueDate >= selectedDay);
  const unscheduled = tasks.flatMap(task => (task.workflow as PlannedStep[]).filter(step => !step.startDate && !step.dueDate && !step.done).map(step => ({ task, step })));
  const monthEvents = events.filter(event => event.startDate.slice(0, 7) <= month && event.dueDate.slice(0, 7) >= month);
  const openTask = (id: string) => onOpenTask ? onOpenTask(id) : setDetailId(id);
  const changeMonth = (change: number) => { const next = new Date(Date.UTC(year, monthNumber - 1 + change, 1)).toISOString().slice(0, 7); setMonth(next); setSelectedDay(next === today.slice(0, 7) ? today : `${next}-01`); };

  return <>
    <div className="page-heading"><div><p className="eyebrow">Plan your next step</p><h1>일정.</h1><p className="muted">현재 업무 회차의 마감과 절차별 일정을 확인하세요. 지난 회차의 일정은 세부업무에서 조회할 수 있습니다.</p></div><Badge tone="outline"><CalendarDays size={14} />이번 달 일정 {monthEvents.length}건</Badge></div>
    <div className="pw-calendar-toolbar"><div className="pw-month-control"><button className="pw-icon-button" aria-label="이전 달" onClick={() => changeMonth(-1)}><ChevronLeft size={19} /></button><h2>{year}년 {monthNumber}월</h2><button className="pw-icon-button" aria-label="다음 달" onClick={() => changeMonth(1)}><ChevronRight size={19} /></button><Button variant="secondary" onClick={() => { setMonth(today.slice(0, 7)); setSelectedDay(today); }}>오늘</Button></div><div className="tabs">{([['all', '전체'], ['step', '업무 절차'], ['task', '업무 마감']] as const).map(([id, label]) => <button key={id} className={kind === id ? 'active' : ''} aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</button>)}</div></div>
    <div className="pw-calendar-layout"><section className="pw-calendar" aria-label={`${year}년 ${monthNumber}월 업무 일정`}><div className="pw-calendar-weekdays">{['일', '월', '화', '수', '목', '금', '토'].map(day => <span key={day}>{day}</span>)}</div><div className="pw-calendar-grid">{days.map(day => { const dayEvents = events.filter(event => event.startDate <= day && event.dueDate >= day); return <button key={day} className={`pw-calendar-day ${day.slice(0, 7) !== month ? 'outside' : ''} ${day === today ? 'today' : ''} ${day === selectedDay ? 'selected' : ''}`} aria-label={`${day}, 일정 ${dayEvents.length}건`} aria-pressed={day === selectedDay} onClick={() => setSelectedDay(day)}><span className="pw-day-number">{Number(day.slice(8))}</span><span className="pw-calendar-chips">{dayEvents.slice(0, 2).map(event => <span key={event.id} className={`pw-calendar-chip ${event.done ? 'done' : ''} ${event.kind === 'task' ? 'deadline' : ''}`}>{event.kind === 'task' ? '마감 · ' : ''}{event.title}</span>)}{dayEvents.length > 2 && <span className="pw-calendar-more">+{dayEvents.length - 2}개</span>}</span><span className="pw-calendar-mobile-dots">{dayEvents.slice(0, 3).map(event => <i key={event.id} data-status={event.done ? "complete" : event.kind === "task" ? "attention" : "progress"} />)}</span></button>; })}</div></section><aside className="pw-day-detail"><div className="pw-day-detail-header"><span className="eyebrow">Selected day</span><h2>{Number(selectedDay.slice(5, 7))}월 {Number(selectedDay.slice(8))}일</h2><p>{daily.length ? `${daily.length}개의 일정이 있습니다.` : '등록된 일정이 없습니다.'}</p></div><div className="pw-day-events">{daily.map(event => <button key={event.id} className="pw-day-event" onClick={() => openTask(event.taskId)}><div><Badge tone={event.done ? 'success' : event.kind === 'task' ? 'warning' : 'info'}>{event.kind === 'task' ? '업무 마감' : event.done ? '완료한 절차' : '업무 절차'}</Badge><ArrowRight size={15} /></div><h3>{event.title}</h3>{event.kind === 'step' && <p>{event.taskTitle}</p>}<span><CalendarDays size={13} />{formatDate(event.startDate)}{event.startDate !== event.dueDate ? ` — ${formatDate(event.dueDate)}` : ''}{event.role === 'reviewer' ? ' · 검토' : ''}</span></button>)}{!daily.length && <div className="pw-day-empty"><CalendarDays size={28} /><p>여유 있는 하루입니다.</p><span>세부업무에서 절차별 날짜를 설정하면 이곳에 표시됩니다.</span></div>}</div></aside></div>
    {unscheduled.length > 0 && <section className="pw-unscheduled"><div className="pw-section-intro"><div><h3>일정을 기다리는 절차 <span>{unscheduled.length}</span></h3><p>업무를 열어 시작일과 종료일을 연결해 주세요.</p></div><Clock3 size={22} /></div><div className="pw-unscheduled-list">{unscheduled.slice(0, 6).map(({ task, step }) => <button key={`${task.id}-${step.id}`} onClick={() => openTask(task.id)}><span><b>{step.title}</b><small>{task.title}</small></span><span>일정 설정 <ArrowRight size={15} /></span></button>)}</div>{unscheduled.length > 6 && <p className="pw-form-note">외 {unscheduled.length - 6}개 절차의 일정은 각 세부업무에서 설정할 수 있습니다.</p>}</section>}
    {detailId && <TaskPanel workspace={w} taskId={detailId} command={command} onClose={() => setDetailId(null)} />}
  </>;
}

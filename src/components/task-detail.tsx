'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Check, CheckCheck, ChevronDown, ChevronRight, Clock3, FileText, GitBranch, History, Link2, LockKeyhole, MessageSquare, Pencil, Plus, Save, Send, ShieldCheck, Trash2, Upload, X } from 'lucide-react';
import { Background, Controls, MarkerType, ReactFlow, type Connection, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Card, Task, WorkflowStep, Workspace } from '@/lib/types';
import { uploadAttachment } from '@/lib/upload-attachment';
import { currentPeriod, dueDateForPeriod, normalizePeriod } from '@/lib/schedule';
import { activeTaskDelegations, canActAsDeputy } from '@/lib/delegations';
import './task-detail.css';

type Props = { task: Task; workspace: Workspace; command: (type: string, payload: Record<string, unknown>) => Promise<boolean>; onClose: () => void };
type Tab = 'overview' | 'execution' | 'workflow' | 'sources' | 'performance' | 'history';
const tabs: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: 'overview', label: '업무 개요', icon: FileText }, { id: 'execution', label: '회차 수행', icon: CheckCheck },
  { id: 'workflow', label: '워크플로', icon: GitBranch }, { id: 'sources', label: '근거·자료', icon: Link2 },
  { id: 'performance', label: '성과', icon: ShieldCheck }, { id: 'history', label: '이력·버전', icon: History },
];
const cardFields: { key: keyof Card; title: string; hint: string }[] = [
  { key: 'purpose', title: '목적', hint: '이 업무가 해결할 문제와 기대하는 결과' },
  { key: 'stakeholders', title: '이해관계자', hint: '협업 부서, 요청자와 주요 연락 대상' },
  { key: 'evidence', title: '근거', hint: '관련 법령, 지침, 매뉴얼과 인용 위치' },
  { key: 'responsibility', title: '권한과 책임', hint: '정·부·총괄의 책임과 검토 역할' },
  { key: 'procedure', title: '절차', hint: '연결된 워크플로의 핵심 단계' },
  { key: 'finance', title: '자금 흐름', hint: '예산·비용 부담 또는 해당 없음 사유' },
  { key: 'documents', title: '문서와 데이터', hint: '입력 자료, 서식, 산출물과 전달 대상' },
  { key: 'issues', title: '병목과 쟁점', hint: '의존 관계와 해결이 필요한 사항' },
  { key: 'handover', title: '개선과 인계 유의점', hint: '다음 담당자가 알아야 할 예외와 맥락' },
];
const statusLabels = { draft: '작성 중', review: '검토 중', confirmed: '확정', revision: '변경본 작성', archived: '폐기' };
const runLabels = { scheduled: '예정', in_progress: '진행 중', review: '검토 중', completed: '완료', paused: '보류' };
const roleLabels = { primary: '정담당', support: '부담당', reviewer: '총괄·검토' };
const frequencyLabels = { once: '일회', monthly: '매월', quarterly: '매 분기', half_yearly: '매 반기', yearly: '매년' };
const formatDate = (value?: string) => value ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value.length === 10 ? `${value}T00:00:00+09:00` : value)) : '미정';
const safeUrl = (url: string) => /^https?:\/\//i.test(url) ? url : undefined;
const avatarColor = (color?: string) => ({ sage: '#758369', clay: '#a07464', gold: '#a98b50', stone: '#716d63' }[color ?? ''] ?? '#858578');

export default function TaskDetail({ task, workspace, command, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [card, setCard] = useState<Card>(task.card);
  const [description, setDescription] = useState(task.description);
  const [criteria, setCriteria] = useState(task.completionCriteria);
  const [title, setTitle] = useState(task.title);
  const [dueDate, setDueDate] = useState(task.dueDate);
  const [frequency, setFrequency] = useState(task.frequency);
  const [priority, setPriority] = useState(task.priority);
  const [sourceIds, setSourceIds] = useState(task.sourceIds);
  const [workflow, setWorkflow] = useState<WorkflowStep[]>(task.workflow);
  const [selectedStep, setSelectedStep] = useState(task.workflow[0]?.id ?? '');
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [reason, setReason] = useState('');
  const [showRevision, setShowRevision] = useState(false);
  const runs = workspace.runs.filter(run => run.taskId === task.id);
  const [runId, setRunId] = useState(runs[0]?.id ?? '');
  const run = runs.find(item => item.id === runId) ?? runs[0];
  const [note, setNote] = useState('');
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const [newPeriod, setNewPeriod] = useState('');
  const [showRunForm, setShowRunForm] = useState(false);
  const [performanceForm, setPerformanceForm] = useState(false);
  const [performanceTarget, setPerformanceTarget] = useState<string | null>(null);
  const [correctionId, setCorrectionId] = useState<string | null>(null);
  const [performance, setPerformance] = useState({ title: '', description: '', evidence: '', metricName: '', value: '', unit: '' });
  const [uploadMessage, setUploadMessage] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const fileRef = useRef<HTMLInputElement>(null);
  const user = workspace.currentUser;
  const person = (id?: string) => workspace.users.find(item => item.id === id);
  const department = workspace.departments.find(item => item.id === task.departmentId);
  const unit = workspace.units.find(item => item.id === task.unitId);
  const inScope = user.role === 'admin' || user.departmentId === task.departmentId;
  const canManage = inScope && ['admin', 'head', 'manager'].includes(user.role);
  const canConfirm = inScope && ['admin', 'head'].includes(user.role);
  const canRevise = canConfirm;
  const canEdit = canManage || task.primaryId === user.id;
  const isDraft = task.status === 'draft' || task.status === 'revision';
  const deputies = activeTaskDelegations(workspace, task, undefined, new Date(workspace.serverTime));
  const canRunAction = (action: string) => !!run && (run.primaryId === user.id || run.supportIds.includes(user.id) || canActAsDeputy(workspace, user, task, action, new Date(workspace.serverTime)));
  const canExecute = canRunAction('run.note') || !!run && (run.reviewerId === user.id || canConfirm);
  const taskSources = workspace.sources.filter(source => task.sourceIds.includes(source.id));
  const attachments = workspace.attachments.filter(item => item.taskId === task.id);
  const performances = workspace.performances.filter(item => item.taskId === task.id);
  const events = workspace.audit.filter(event => event.targetId === task.id || runs.some(r => r.id === event.targetId));
  const completeCount = run?.steps.filter(step => step.status === 'completed').length ?? 0;
  const progress = run?.steps.length ? Math.round(completeCount / run.steps.length * 100) : 0;
  const canCreateRun = task.versions.length > 0 && task.status !== 'archived' && canEdit;
  const activeFrequency = task.versions.at(-1)?.frequency ?? task.frequency;
  const canonicalNewPeriod = normalizePeriod(activeFrequency, newPeriod, new Date(workspace.serverTime));
  const newDueDate = canonicalNewPeriod ? dueDateForPeriod(activeFrequency, canonicalNewPeriod, task.versions.at(-1)?.dueDate ?? task.dueDate) : '';
  const duplicateNewPeriod = !!canonicalNewPeriod && runs.some(item => item.period === canonicalNewPeriod);
  const openRunForm = () => { setNewPeriod(currentPeriod(activeFrequency, new Date(workspace.serverTime))); setShowRunForm(true); };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'Tab') {
        const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ?? []).filter(el => el.offsetParent !== null);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);

  useEffect(() => { if (!editing) { setCard(task.card); setDescription(task.description); setCriteria(task.completionCriteria); setTitle(task.title); setDueDate(task.dueDate); setFrequency(task.frequency); setPriority(task.priority); setSourceIds(task.sourceIds); } }, [task, editing]);
  useEffect(() => { setWorkflow(task.workflow); }, [task.id, task.updatedAt, task.workflow]);

  async function act(type: string, payload: Record<string, unknown> = {}) {
    setBusy(true);
    try { return await command(type, { taskId: task.id, ...payload }); }
    finally { setBusy(false); }
  }

  function startPerformance(item?: Workspace['performances'][number], correction = false) {
    setPerformanceTarget(item && !correction ? item.id : null);
    setCorrectionId(item && correction ? item.id : null);
    setPerformance(item ? { title: item.title, description: item.description, evidence: item.evidence, metricName: item.metricName ?? '', value: item.value === undefined ? '' : String(item.value), unit: item.unit ?? '' } : { title: '', description: '', evidence: '', metricName: '', value: '', unit: '' });
    if (item) setRunId(item.runId);
    setPerformanceForm(true);
  }

  const nodes = useMemo<Node[]>(() => workflow.map((step, index) => ({
    id: step.id,
    position: positions[step.id] ?? { x: 70 + index * 215, y: ({ primary: 0, support: 1, reviewer: 2 }[step.role]) * 115 + 45 },
    data: { label: <div className="td-node-label"><span>{roleLabels[step.role]}</span><strong>{step.title || '제목 없는 단계'}</strong><small>{step.required ? '필수 단계' : '선택 단계'} · {step.checklist.length}개 체크</small></div> },
    selected: selectedStep === step.id,
    className: `td-flow-node td-flow-${step.role}`,
    style: { width: 180 },
  })), [workflow, positions, selectedStep]);
  const edges = useMemo(() => workflow.flatMap(step => step.dependsOn.map(dependency => ({ id: `${dependency}-${step.id}`, source: dependency, target: step.id, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, color: '#8c9281' }, style: { stroke: '#8c9281', strokeWidth: 1.5 } }))), [workflow]);
  const activeStep = workflow.find(step => step.id === selectedStep);
  const updateStep = (patch: Partial<WorkflowStep>) => setWorkflow(current => current.map(step => step.id === selectedStep ? { ...step, ...patch } : step));
  const graphIssues = workflow.flatMap(step => [
    ...(!step.title.trim() ? [`${step.id}: 단계명을 입력해 주세요.`] : []),
    ...step.dependsOn.filter(id => id === step.id || !workflow.some(item => item.id === id)).map(() => `${step.title}: 잘못된 선행 단계입니다.`),
  ]);

  function onConnect(connection: Connection) {
    if (!isDraft || !canEdit || connection.source === connection.target) return;
    setWorkflow(current => current.map(step => step.id === connection.target ? { ...step, dependsOn: Array.from(new Set([...step.dependsOn, connection.source])) } : step));
  }

  async function uploadFile(file: File) {
    if (file.size > 10 * 1024 * 1024) { setUploadMessage('파일은 10MB 이하로 선택해 주세요.'); return; }
    setBusy(true); setUploadMessage('파일을 업로드하고 있습니다.');
    try {
      await uploadAttachment(file, task.id);
      setUploadMessage('업로드했습니다. 관리자 계정에서 테스트 파일을 허용하면 다운로드할 수 있습니다.');
      await command('workspace.refresh', {});
    } catch (error) { setUploadMessage(error instanceof Error ? error.message : '업로드에 실패했습니다.'); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }

  return <div className="td-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="td-panel" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="td-title" tabIndex={-1}>
      <div className="td-topline"><span><span>{department?.name}</span><ChevronRight size={13}/>{unit?.title}<ChevronRight size={13}/><strong>{task.code}</strong></span><button className="td-icon" onClick={onClose} aria-label="업무 상세 닫기"><X size={20}/></button></div>
      <header className="td-header">
        <div className="td-title-row"><div><div className="td-eyebrow">WORK MANAGEMENT CARD <span>VERSION {task.version.toString().padStart(2, '0')}</span></div><h2 id="td-title">{task.title}</h2></div><span className={`td-badge td-status-${task.status}`}>{task.status === 'confirmed' && <LockKeyhole size={12}/>} {statusLabels[task.status]}</span></div>
        <p className="td-description">{task.description}</p>
        <div className="td-meta-row"><div className="td-people"><span className="td-avatar" style={{ background: avatarColor(person(task.primaryId)?.color) }}>{person(task.primaryId)?.initials}</span><span><small>정담당</small><strong>{person(task.primaryId)?.name ?? '미배정'}</strong></span>{task.supportIds.length > 0 && <><i/><span><small>부담당</small><strong>{task.supportIds.map(id => person(id)?.name).filter(Boolean).join(', ')}</strong></span></>}<i/><span><small>업무대행</small><strong>{deputies.map(item => person(item.toId)?.name).filter(Boolean).join(', ') || '현재 대행자 없음'}</strong></span></div><div className="td-meta-tags"><span><Clock3 size={14}/>{formatDate(task.dueDate)}</span><span>{frequencyLabels[task.frequency]}</span></div></div>
        <div className="td-actionline"><div className="td-tags">{task.tags.map(tag => <span key={tag}>{tag}</span>)}</div><div className="td-actions">{isDraft && canEdit && <button className={`td-btn ${tab === 'workflow' || editing || performanceForm ? '' : 'td-btn-primary'}`} disabled={busy} onClick={() => act('task.submit')}><Send size={14}/>검토 요청</button>}{task.status === 'review' && canConfirm && <button className="td-btn td-btn-primary" disabled={busy} onClick={() => act('task.confirm')}><ShieldCheck size={15}/>업무 확정</button>}{task.status === 'confirmed' && canRevise && <button className="td-btn" onClick={() => setShowRevision(value => !value)}><Pencil size={14}/>변경본 작성</button>}</div></div>
        {showRevision && <form className="td-revision-form" onSubmit={async event => { event.preventDefault(); if (await act('task.revise', { reason })) { setShowRevision(false); setReason(''); setEditing(true); } }}><label htmlFor="td-revision-reason">변경 사유</label><input id="td-revision-reason" value={reason} onChange={event => setReason(event.target.value)} required placeholder="변경할 내용과 이유를 적어 주세요"/><button className="td-btn td-btn-primary" disabled={busy || !reason.trim()}>변경본 만들기</button></form>}
      </header>
      <nav className="td-tabs" role="tablist" aria-label="업무 상세 메뉴">{tabs.map(item => <button key={item.id} id={`td-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`td-pane-${item.id}`} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><item.icon size={15}/>{item.label}{item.id === 'execution' && <span>{runs.length}</span>}</button>)}</nav>
      <div className="td-content" role="tabpanel" id={`td-pane-${tab}`} aria-labelledby={`td-tab-${tab}`}>
        {tab === 'overview' && <>
          <div className="td-section-heading"><div><h3>업무를 이해하는 아홉 가지 관점</h3><p>목적부터 다음 담당자를 위한 맥락까지, 한눈에 이어집니다.</p></div>{isDraft && canEdit && <button className="td-btn td-btn-small" onClick={() => setEditing(value => !value)}><Pencil size={13}/>{editing ? '편집 취소' : '내용 편집'}</button>}</div>
          {task.status === 'confirmed' && <div className="td-inline-notice"><LockKeyhole size={15}/><span>확정된 {task.version}판을 보고 있습니다. 수행 기록은 계속 추가할 수 있습니다.</span></div>}
          {editing && <div className="td-basic-editor"><label className="td-field">업무명<input value={title} onChange={event => setTitle(event.target.value)} required/></label><div className="td-metric-fields"><label className="td-field">마감일<input type="date" value={dueDate} disabled={!!task.commonId} onChange={event => setDueDate(event.target.value)}/></label><label className="td-field">반복 주기<select value={frequency} onChange={event => setFrequency(event.target.value as Task['frequency'])}>{Object.entries(frequencyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="td-field">우선순위<select value={priority} onChange={event => setPriority(event.target.value as Task['priority'])}><option value="high">높음</option><option value="medium">보통</option><option value="low">낮음</option></select></label></div>{task.commonId && <p className="td-quiet">공통업무의 필수 기한은 중앙 기준을 따릅니다.</p>}</div>}
          <div className="td-nine-grid">{cardFields.map((field, index) => <section className="td-card-cell" key={field.key}><div><span>{String(index + 1).padStart(2, '0')}</span><h4>{field.title}</h4>{field.key === 'procedure' && <GitBranch size={14}/>}</div>{editing ? field.key === 'procedure' ? <p className="td-quiet">{workflow.map(step => step.title).join(' → ')}<small>절차는 워크플로 탭에서 같은 단계로 편집합니다.</small></p> : <textarea aria-label={field.title} value={card[field.key]} placeholder={field.hint} onChange={event => setCard(current => ({ ...current, [field.key]: event.target.value }))}/> : <p>{field.key === 'procedure' ? task.workflow.map(step => step.title).join(' → ') || '워크플로를 작성해 주세요.' : task.card[field.key] || '아직 작성된 내용이 없습니다.'}</p>}</section>)}</div>
          <section className="td-completion"><div className="td-completion-icon"><CheckCheck size={22}/></div><div><h4>이 업무의 완료 기준</h4>{editing ? <textarea aria-label="완료 기준" value={criteria} onChange={event => setCriteria(event.target.value)}/> : <p>{task.completionCriteria}</p>}</div></section>
          {editing && <><label className="td-field">상세 설명<textarea value={description} onChange={event => setDescription(event.target.value)} rows={3}/></label><div className="td-editor-footer"><span>변경본은 검토·확정을 거쳐 적용됩니다.</span><button className="td-btn td-btn-primary" disabled={busy || !title.trim() || !description.trim() || !criteria.trim()} onClick={async () => { if (await act('task.update', { title, dueDate, frequency, priority, card: { ...card, procedure: task.workflow.map(step => step.title).join(' → ') }, description, completionCriteria: criteria })) setEditing(false); }}><Save size={15}/>변경 내용 저장</button></div></>}
        </>}

        {tab === 'execution' && <>
          <div className="td-section-heading"><div><h3>회차별 업무 수행</h3><p>각 회차는 생성 당시의 확정 버전으로 진행됩니다.</p></div><div className="td-actions">{runs.length > 0 && <select aria-label="수행 회차 선택" value={run?.id ?? ''} onChange={event => setRunId(event.target.value)}>{runs.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>}{canCreateRun && <button className="td-btn td-btn-small" onClick={openRunForm}><Plus size={14}/>회차 생성</button>}</div></div>
          {showRunForm && <form className="td-new-run-form" onSubmit={async event => { event.preventDefault(); if (await act('run.create', { period: newPeriod })) { setShowRunForm(false); setNewPeriod(''); setRunId(''); } }}><div className="td-new-run-fields"><label className="td-field">대상 기간<input placeholder="예: 2026년 4분기" value={newPeriod} onChange={event => setNewPeriod(event.target.value)} required/></label><label className="td-field">회차 마감일<input type="date" value={newDueDate} readOnly required/></label></div><div className="td-run-preview"><span>생성 미리보기</span><strong>{task.versions.at(-1)?.title ?? task.title} · {canonicalNewPeriod || '주기에 맞는 대상 기간을 입력해 주세요'}</strong><p>확정 {task.versions.at(-1)?.version ?? task.version}판 · 마감 {formatDate(newDueDate)}{task.commonId ? ' · 공통 기준 기한 적용' : ' · 확정 기준 자동 계산'}</p>{duplicateNewPeriod && <p role="status">같은 대상 기간의 회차가 이미 있습니다. 다른 기간을 입력해 주세요.</p>}</div><div className="td-editor-footer"><button type="button" className="td-btn td-btn-small" onClick={() => setShowRunForm(false)}>취소</button><button className="td-btn td-btn-primary" disabled={busy || !newPeriod.trim() || !newDueDate || duplicateNewPeriod}><Plus size={14}/>회차 만들기</button></div></form>}
          {!run ? <div className="td-empty"><CheckCheck size={32}/><h4>아직 실행회차가 없습니다</h4><p>{canCreateRun ? '확정한 기준으로 첫 번째 회차를 시작해 보세요.' : '업무를 확정한 뒤 첫 번째 회차를 만들어 보세요.'}</p>{canCreateRun && !showRunForm && <button className="td-btn td-btn-primary" onClick={openRunForm}><Plus size={14}/>첫 회차 만들기</button>}</div> : <>
            <div className="td-run-summary"><div><span className={`td-badge td-run-${run.status}`}>{runLabels[run.status]}</span><h4>{run.title}</h4><p>기준 {run.definitionVersion}판 · 정담당 {person(run.primaryId)?.name} · 마감 {formatDate(run.dueDate)}</p></div><div className="td-progress-wrap"><div><strong>{progress}<small>%</small></strong><span>{completeCount}/{run.steps.length} 단계 완료</span></div><div className="td-progress"><span style={{ width: `${progress}%` }}/></div></div></div>
            <div className="td-execution-layout"><div className="td-step-list">{run.steps.map((step, index) => {
              const definition = (task.versions.find(version => version.version === run.definitionVersion)?.workflow ?? task.workflow).find(item => item.id === step.stepId);
              const predecessors = definition?.dependsOn.map(id => run.steps.find(item => item.stepId === id)).filter(Boolean) ?? [];
              const blocked = predecessors.some(item => item?.status !== 'completed');
              return <section className={`td-execution-step ${step.status === 'completed' ? 'is-complete' : ''}`} key={step.id}><div className="td-step-heading"><div className="td-step-number">{step.status === 'completed' ? <Check size={16}/> : String(index + 1).padStart(2, '0')}</div><div><span>{roleLabels[step.role]}{blocked && ' · 선행 단계 대기'}</span><h4>{step.title}</h4></div><span className="td-step-state">{step.status === 'completed' ? '완료' : step.status === 'in_progress' ? '진행 중' : '대기'}</span></div><div className="td-step-body">{definition?.description && <p>{definition.description}</p>}<div className="td-checklist">{step.checklist.map(check => <label key={check.id} className={check.done ? 'checked' : ''}><input type="checkbox" checked={check.done} disabled={busy || !(step.role === 'reviewer' ? run.reviewerId === user.id || canConfirm : canRunAction('run.check')) || run.status === 'completed' || step.status === 'completed' || blocked} onChange={event => act('run.check', { runId: run.id, stepId: step.id, checkId: check.id, done: event.target.checked })}/><span>{check.title}</span>{check.done && <Check size={13}/>}</label>)}</div>{step.status === 'completed' ? <div className="td-output-record"><FileText size={14}/><div><strong>수행 결과</strong><p>{step.output || '단계 완료 조건을 확인했습니다.'}</p><small>{person(step.completedBy)?.name} · {formatDate(step.completedAt)}</small></div></div> : <><label className="td-field td-output-label">결과물·수행 내용<textarea rows={2} placeholder={definition?.output || '완료한 내용 또는 결과물 링크를 기록해 주세요.'} value={outputs[step.id] ?? step.output ?? ''} disabled={!(step.role === 'reviewer' ? run.reviewerId === user.id || canConfirm : canRunAction('run.completeStep')) || run.status === 'completed' || blocked} onChange={event => setOutputs(current => ({ ...current, [step.id]: event.target.value }))}/></label><div className="td-step-footer"><span>{blocked ? '앞선 필수 단계를 먼저 완료해 주세요.' : '필수 체크와 결과물을 확인한 후 완료합니다.'}</span>{(step.role === 'reviewer' ? run.reviewerId === user.id || canConfirm : canRunAction('run.completeStep')) && <button className="td-btn td-btn-small" disabled={busy || run.status === 'completed' || blocked || step.checklist.some(check => !check.done)} onClick={() => act('run.completeStep', { runId: run.id, stepId: step.id, output: outputs[step.id] ?? step.output ?? '' })}><Check size={14}/>단계 완료</button>}</div></>}</div></section>;
            })}</div><aside className="td-notes-panel"><div className="td-notes-heading"><MessageSquare size={17}/><h4>함께 남기는 기록</h4><span>{run.notes.length}</span></div>{run.notes.length === 0 ? <p className="td-quiet">진행 상황과 확인할 사항을 남겨 주세요.</p> : <div className="td-note-list">{run.notes.map(item => <article key={item.id}><header><span className="td-mini-avatar" style={{ background: avatarColor(person(item.authorId)?.color) }}>{person(item.authorId)?.initials}</span><strong>{person(item.authorId)?.name}</strong><time>{formatDate(item.createdAt)}</time></header><p>{item.body}</p></article>)}</div>}{canExecute && <form className="td-note-form" onSubmit={async event => { event.preventDefault(); if (await act('run.note', { runId: run.id, body: note })) setNote(''); }}><textarea aria-label="업무 메모" placeholder="업무의 맥락을 기록해 주세요…" value={note} onChange={event => setNote(event.target.value)} required/><button className="td-btn td-btn-small" disabled={busy || !note.trim()}><Plus size={14}/>기록 추가</button></form>}<div className="td-note-tip"><span>RECORD, THEN CONNECT</span><p>작은 기록 하나가<br/>다음 담당자의 좋은 시작이 됩니다.</p></div></aside></div>
          </>}
        </>}

        {tab === 'workflow' && <>
          <div className="td-section-heading"><div><h3>역할을 잇는 업무의 흐름</h3><p>{isDraft ? '단계를 선택해 내용을 편집하고, 연결점으로 선행 관계를 지정하세요.' : '확정된 기준 절차입니다. 실제 진행 상태는 회차 수행에서 확인하세요.'}</p></div>{isDraft && canEdit && <div className="td-actions"><button className="td-btn td-btn-small" onClick={() => { const id = `step-${crypto.randomUUID().slice(0, 8)}`; setWorkflow(current => [...current, { id, title: '새 단계', role: 'primary', description: '', output: '', required: true, dependsOn: current.length ? [current[current.length - 1].id] : [], checklist: [] }]); setSelectedStep(id); }}><Plus size={14}/>단계 추가</button><button className="td-btn td-btn-primary td-btn-small" disabled={busy || graphIssues.length > 0} onClick={() => act('task.update', { workflow: workflow.map(step => ({ ...step, checklist: step.checklist.map(item => item.trim()).filter(Boolean) })), card: { ...task.card, procedure: workflow.map(step => step.title).join(' → ') } })}><Save size={14}/>흐름 저장</button></div>}</div>
          <div className="td-flow-legend"><span><i className="td-dot-primary"/>정담당</span><span><i className="td-dot-support"/>부담당</span><span><i className="td-dot-reviewer"/>총괄·검토</span><small>화살표는 선행 단계의 완료 조건입니다.</small></div>
          <div className="td-workflow-layout"><div className="td-flow-canvas"><ReactFlow nodes={nodes} edges={edges} onNodeClick={(_, node) => setSelectedStep(node.id)} onNodesChange={changes => { for (const change of changes) if (change.type === 'position' && change.position) { const position = change.position; setPositions(current => ({ ...current, [change.id]: position })); } }} onNodeDragStop={(_, node) => setPositions(current => ({ ...current, [node.id]: node.position }))} onConnect={onConnect} nodesDraggable={isDraft && canEdit} nodesConnectable={isDraft && canEdit} elementsSelectable fitView fitViewOptions={{ padding: 0.2 }} minZoom={0.4} maxZoom={1.6} proOptions={{ hideAttribution: true }} aria-label="역할별 업무 흐름도"><Background color="#d9d5cb" gap={22}/><Controls showInteractive={false}/></ReactFlow></div><aside className="td-step-inspector">{activeStep ? <><div className="td-inspector-eyebrow">STEP DETAILS <span>{workflow.findIndex(step => step.id === activeStep.id) + 1}/{workflow.length}</span></div><label className="td-field">단계명<input value={activeStep.title} readOnly={!isDraft || !canEdit} onChange={event => updateStep({ title: event.target.value })}/></label><label className="td-field">담당 역할<select value={activeStep.role} disabled={!isDraft || !canEdit} onChange={event => updateStep({ role: event.target.value as WorkflowStep['role'] })}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="td-field">수행 내용<textarea value={activeStep.description} readOnly={!isDraft || !canEdit} onChange={event => updateStep({ description: event.target.value })} rows={3}/></label><label className="td-field">필수 결과물<input value={activeStep.output} readOnly={!isDraft || !canEdit} onChange={event => updateStep({ output: event.target.value })}/></label><label className="td-field">체크리스트 <small>한 줄에 한 항목</small><textarea value={activeStep.checklist.join('\n')} readOnly={!isDraft || !canEdit} onChange={event => updateStep({ checklist: event.target.value.split('\n') })} rows={3}/></label><fieldset className="td-dependency-list"><legend>선행 단계</legend>{workflow.filter(step => step.id !== activeStep.id).map(step => <label key={step.id}><input type="checkbox" checked={activeStep.dependsOn.includes(step.id)} disabled={!isDraft || !canEdit} onChange={event => updateStep({ dependsOn: event.target.checked ? [...activeStep.dependsOn, step.id] : activeStep.dependsOn.filter(id => id !== step.id) })}/>{step.title}</label>)}{workflow.length === 1 && <p>첫 번째 단계입니다.</p>}</fieldset>{isDraft && canEdit && <button className="td-text-danger" onClick={() => { setWorkflow(current => current.filter(step => step.id !== activeStep.id).map(step => ({ ...step, dependsOn: step.dependsOn.filter(id => id !== activeStep.id) }))); setSelectedStep(workflow.find(step => step.id !== activeStep.id)?.id ?? ''); }}><Trash2 size={13}/>단계 삭제</button>}</> : <div className="td-empty"><GitBranch size={24}/><p>단계를 선택하면<br/>상세 내용을 볼 수 있습니다.</p></div>}</aside></div>
          {graphIssues.length > 0 && <div className="td-validation" role="alert"><strong>확인이 필요합니다</strong>{graphIssues.map((issue, index) => <p key={index}>{issue}</p>)}</div>}
          <details className="td-flow-table"><summary>표로 흐름 확인하기 <ChevronDown size={14}/></summary><table><thead><tr><th>순서</th><th>단계</th><th>담당 역할</th><th>선행 단계</th><th>결과물</th></tr></thead><tbody>{workflow.map((step, index) => <tr key={step.id}><td>{index + 1}</td><td>{step.title}</td><td>{roleLabels[step.role]}</td><td>{step.dependsOn.map(id => workflow.find(item => item.id === id)?.title).join(', ') || '없음'}</td><td>{step.output || '—'}</td></tr>)}</tbody></table></details>
        </>}

        {tab === 'sources' && <>
          <div className="td-section-heading"><div><h3>업무의 근거와 자료</h3><p>현재 연결된 자료의 버전과 적용 시점을 함께 확인하세요.</p></div><span className="td-count-label">{taskSources.length}개 근거 · {attachments.length}개 첨부</span></div>
          {isDraft && canEdit && <details className="td-source-picker"><summary><Link2 size={14}/>자료실의 근거 연결하기<ChevronDown size={14}/></summary><div>{workspace.sources.map(source => <label key={source.id}><input type="checkbox" checked={sourceIds.includes(source.id)} onChange={event => setSourceIds(current => event.target.checked ? [...current, source.id] : current.filter(id => id !== source.id))}/><span><strong>{source.title}</strong><small>{source.version} · {source.publisher} · {source.verified ? '확인 완료' : '확인 필요'}</small></span></label>)}<button className="td-btn td-btn-small" disabled={busy} onClick={() => act('task.update', { sourceIds })}><Save size={13}/>자료 연결 저장</button></div></details>}
          <div className="td-source-list">{taskSources.map(source => <article key={source.id}><div className="td-source-icon"><FileText size={22}/></div><div className="td-source-main"><div><span className="td-badge">{{ manual: '매뉴얼', guideline: '지침', law: '법령', reference: '참고자료' }[source.type]}</span><span className="td-source-version">{source.version}</span></div><h4>{source.title}</h4><p>{source.description}</p><div className="td-source-meta"><span>{source.publisher}</span><span>적용 {formatDate(source.effectiveDate)}</span><span>{source.classification === 'public' ? '공개' : source.classification === 'internal' ? '내부' : '제한'} 자료</span><span>{source.verified ? '확인 완료' : '확인 필요'}</span></div></div>{safeUrl(source.url) && <a className="td-icon" href={safeUrl(source.url)} target="_blank" rel="noopener noreferrer" aria-label={`${source.title} 원문 열기`}><ArrowRight size={18}/></a>}</article>)}{taskSources.length === 0 && <div className="td-empty"><Link2 size={28}/><h4>연결된 근거 자료가 없습니다</h4><p>자료실에서 등록한 자료를 업무 변경본에 연결할 수 있습니다.</p></div>}</div>
          <div className="td-section-heading td-space-top"><div><h3>첨부파일</h3><p>업무에 필요한 파일을 모으고, 접근과 검사 상태를 확인합니다.</p></div>{canRunAction('attachment.upload') && <><input ref={fileRef} type="file" className="td-hidden-input" aria-label="첨부파일 선택" accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.csv,.hwp,.hwpx" onChange={event => { const file = event.target.files?.[0]; if (file) void uploadFile(file); }}/><button className="td-btn td-btn-small" disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={14}/>파일 첨부</button></>}</div>
          {uploadMessage && <p className="td-upload-message" role="status">{uploadMessage}</p>}
          {attachments.length ? <div className="td-file-list">{attachments.map(file => <div key={file.id}><FileText size={20}/><div><strong>{file.name}</strong><span>{(file.size / 1024).toFixed(0)} KB · {person(file.uploadedBy)?.name} · {formatDate(file.createdAt)}</span></div><span className={`td-badge ${file.status === 'quarantined' ? 'td-badge-warning' : ''}`}>{file.status === 'quarantined' ? '검사 대기' : '테스트 허용'}</span>{file.status === 'test_allowed' && <a className="td-icon" href={`/api/attachments/${file.id}`} aria-label={`${file.name} 다운로드`}><ArrowDownToLine size={17}/></a>}</div>)}</div> : <div className="td-upload-empty"><Upload size={23}/><div><strong>필요한 자료를 한곳에</strong><p>파일당 최대 10MB · 일반 업로드는 검사 대기로 보관됩니다.</p></div></div>}
        </>}

        {tab === 'performance' && <>
          <div className="td-section-heading"><div><h3>기록으로 남는 업무의 성과</h3><p>실제 수행회차와 증빙을 연결하고, 검토를 거쳐 확정합니다.</p></div>{canRunAction('performance.create') && <button className="td-btn td-btn-primary td-btn-small" onClick={() => startPerformance()}><Plus size={14}/>성과 등록</button>}</div>
          {performanceForm && run && <form className="td-performance-form" onSubmit={async event => { event.preventDefault(); if (await act(performanceTarget ? 'performance.resubmit' : 'performance.create', { ...performance, performanceId: performanceTarget ?? undefined, previousId: correctionId ?? undefined, runId: run.id, value: performance.value ? Number(performance.value) : undefined })) { setPerformanceForm(false); setPerformance({ title: '', description: '', evidence: '', metricName: '', value: '', unit: '' }); } }}><div className="td-form-title"><h4>{performanceTarget ? '성과 보완' : correctionId ? '성과 정정본' : '새 성과 기록'}</h4><span>{run.title}</span></div><label className="td-field">성과 제목<input required readOnly={!!performanceTarget} value={performance.title} placeholder="어떤 결과를 만들었나요?" onChange={event => setPerformance(value => ({ ...value, title: event.target.value }))}/></label><label className="td-field">결과와 후속 조치<textarea required rows={3} value={performance.description} onChange={event => setPerformance(value => ({ ...value, description: event.target.value }))}/></label><label className="td-field">증빙·결과물<input required value={performance.evidence} placeholder="보고서 제목, 문서번호 또는 증빙 링크" onChange={event => setPerformance(value => ({ ...value, evidence: event.target.value }))}/></label><div className="td-metric-fields"><label className="td-field">지표명 <small>선택</small><input value={performance.metricName} onChange={event => setPerformance(value => ({ ...value, metricName: event.target.value }))}/></label><label className="td-field">값<input type="number" step="any" value={performance.value} onChange={event => setPerformance(value => ({ ...value, value: event.target.value }))}/></label><label className="td-field">단위<input value={performance.unit} placeholder="건, % 등" onChange={event => setPerformance(value => ({ ...value, unit: event.target.value }))}/></label></div><div className="td-editor-footer"><button type="button" className="td-btn td-btn-small" onClick={() => setPerformanceForm(false)}>취소</button><button className="td-btn td-btn-primary" disabled={busy}><Save size={14}/>성과 검토 요청</button></div></form>}
          <div className="td-performance-list">{performances.map(item => <article key={item.id}><div className="td-performance-heading"><span className={`td-badge td-status-${item.status === 'confirmed' ? 'confirmed' : 'draft'}`}>{{ draft: '작성 중', review: '검토 중', confirmed: '확정', changes_requested: '보완 요청' }[item.status]}</span><span>{runs.find(r => r.id === item.runId)?.title}</span></div><h4>{item.title}</h4><p>{item.description}</p>{item.metricName && <div className="td-performance-number"><strong>{item.value?.toLocaleString('ko-KR')}<small>{item.unit}</small></strong><span>{item.metricName}</span></div>}<div className="td-evidence"><FileText size={14}/>{safeUrl(item.evidence) ? <a href={safeUrl(item.evidence)} target="_blank" rel="noopener noreferrer">{item.evidence}</a> : item.evidence}</div><footer><span>{person(item.authorId)?.name} · {formatDate(item.createdAt)}</span><div>{item.status === 'changes_requested' && item.authorId === user.id && <button className="td-btn td-btn-small" disabled={busy} onClick={() => startPerformance(item)}><Pencil size={13}/>보완 작성</button>}{item.status === 'confirmed' && !performances.some(other => other.previousId === item.id) && canRunAction('performance.create') && <button className="td-btn td-btn-small" disabled={busy} onClick={() => startPerformance(item, true)}><Pencil size={13}/>정정본</button>}{item.status === 'review' && item.authorId !== user.id && (canConfirm || runs.find(candidate => candidate.id === item.runId)?.reviewerId === user.id) && <><button className="td-btn td-btn-small" disabled={busy} onClick={() => act('performance.requestChanges', { performanceId: item.id })}>보완 요청</button><button className="td-btn td-btn-small" disabled={busy} onClick={() => act('performance.approve', { performanceId: item.id })}><Check size={13}/>성과 확정</button></>}{item.status === 'confirmed' && <span className="td-performance-approved"><ShieldCheck size={14}/>{person(item.approvedBy)?.name} 확인</span>}</div></footer></article>)}</div>{performances.length === 0 && !performanceForm && <div className="td-empty"><ShieldCheck size={32}/><h4>아직 등록된 성과가 없습니다</h4><p>작은 개선과 완료한 결과부터 기록해 보세요.</p></div>}
        </>}

        {tab === 'history' && <>
          <div className="td-section-heading"><div><h3>기준은 보존하고, 변화는 기록합니다</h3><p>확정 버전과 주요 업무 활동을 시간 순서대로 살펴보세요.</p></div><span className="td-count-label">현재 {task.version}판</span></div>
          <div className="td-history-layout"><section><h4 className="td-subheading">확정 버전</h4><div className="td-version-list">{task.versions.slice().reverse().map(version => <details key={version.version}><summary><span className="td-version-number">{String(version.version).padStart(2, '0')}</span><div><strong>{version.title}</strong><span>{formatDate(version.confirmedAt)} · {person(version.confirmedBy)?.name ?? '확정 기록'}</span></div>{version.version === task.version && <span className="td-badge">현재 기준</span>}<ChevronDown size={15}/></summary><div className="td-version-body"><p>{version.description}</p><strong>완료 기준</strong><p>{version.completionCriteria}</p><strong>기준 절차</strong><p>{version.workflow.map(step => step.title).join(' → ')}</p></div></details>)}{task.versions.length === 0 && <p className="td-quiet">첫 확정 이후 기준 버전이 보존됩니다.</p>}</div></section><section><h4 className="td-subheading">업무 활동</h4><div className="td-timeline">{events.map(event => <article key={event.id}><span className="td-timeline-dot"/><div><header><strong>{event.title}</strong><time>{formatDate(event.createdAt)}</time></header><p>{event.detail}</p><small>{person(event.actorId)?.name ?? '시스템'}</small></div></article>)}{events.length === 0 && <p className="td-quiet">이 업무의 활동 이력이 아직 없습니다.</p>}</div></section></div>
        </>}
      </div>
      <footer className="td-panel-footer"><span><LockKeyhole size={12}/>조직과 업무 권한에 따라 제공되는 정보입니다.</span><span>마지막 변경 {formatDate(task.updatedAt)}</span></footer>
    </div>
  </div>;
}

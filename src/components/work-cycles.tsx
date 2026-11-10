'use client';

import { canActAsDeputy } from '@/lib/delegations';
import { commonDeadline } from '@/lib/common-deadline';
import { currentPeriod } from '@/lib/schedule';
import { formatDateFull as displayDate, formatDateTimeFull as displayTime } from '@/lib/date-format';

import { DateInput } from './date-input';
import { RunOutputCorrectionForm, RunOutputCorrectionHistory } from './run-output-correction';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, CalendarDays, Check, CheckCircle2, ChevronDown, FileText, History, LoaderCircle, LockKeyhole, MessageSquare, Pencil, RotateCcw, Save, UserRound, X } from 'lucide-react';
import type { Run, RunProcedureHistory, Task, WorkflowStep, Workspace } from '@/lib/types';
import { nextCycleWorkflow, runWorkflow, taskCycleState } from '@/lib/work-cycles';
import { taskProcedureParticipants } from '@/lib/procedure-participants';
import { taskProcedureContext, type ProcedureContext } from '@/lib/procedure-context';
import { procedureScheduleConflicts } from '@/lib/procedure-schedule';
import { savedCommandTarget } from '@/lib/pending-draft';
import { useRevisionCommand } from './command-revision';
import { deadlineState } from '@/lib/task-deadline';
import { executionLabel, executionState, executionStatus } from '@/lib/status-labels';
import { Badge, Button, ConfirmDialog, Field, Progress, Tabs, useTabs, type CommandFn } from './ui';
import { createLazyScreen } from './lazy-screen';
import { TaskFileAttachments } from './task-file-attachments';
import { useUnsavedChanges, useUnsavedNavigation } from './unsaved-changes';
import './work-cycles.css';

const { Component: ProcedureFlow, preload: preloadProcedureFlow } = createLazyScreen(() => import('./procedure-builder').then(module => module.ProcedureFlow), { label: '절차도', kind: 'section' });

const roleNames: Record<WorkflowStep['role'], string> = { primary: '담당자 수행', support: '협업·지원', reviewer: '검토·승인' };
const dayValue = (value: string) => Date.parse(`${value}T00:00:00Z`);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dayValue(value)) && new Date(dayValue(value)).toISOString().slice(0, 10) === value;
const nameOf = (w: Workspace, id?: string) => w.users.find(user => user.id === id)?.name || w.identities?.find(user => user.id === id)?.name || '담당자 기록 없음';

function cycleProcedureContext(workspace: Workspace, task: Task, definitionVersion?: number): ProcedureContext {
  const definition = definitionVersion === undefined ? undefined : task.versions.find(version => version.version === definitionVersion);
  return taskProcedureContext(workspace, {
    departmentId: definition?.departmentId ?? task.departmentId,
    unitId: definition?.unitId ?? task.unitId,
    title: definition?.title ?? task.title,
  });
}

type Props = { workspace: Workspace; task: Task; command: CommandFn; dirty: boolean; unavailable?: boolean; children?: ReactNode; onHistoryChange?: (value: boolean) => void };

export function WorkCycles({ workspace: w, task, command, dirty, unavailable = false, children, onHistoryChange }: Props) {
  const { requestNavigation } = useUnsavedNavigation();
  const currentState = taskCycleState(w, task);
  const [displayedRunId, setDisplayedRunId] = useState(currentState.latest?.id || '');
  const newestRunId = currentState.latest?.id || '';
  const newerCycleAvailable = !unavailable && newestRunId !== displayedRunId;
  const lastVisibleState = useRef(currentState);
  if (!unavailable && !newerCycleAvailable) lastVisibleState.current = currentState;
  const state = unavailable || newerCycleAvailable ? lastVisibleState.current : currentState;
  const [selection, setSelection] = useState('current');
  const [formMode, setFormMode] = useState<'current' | 'next' | null>(null);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState('');
  const selected = selection === 'current' ? undefined : state.runs.find(run => run.id === selection);
  const isHistory = !!selected;
  const latest = state.latest;
  const hasNewDefinition = latest?.status === 'completed' && task.version > latest.definitionVersion;
  const past = state.runs.filter(run => hasNewDefinition || run.id !== latest?.id);
  const count = latest?.cycleNumber || state.runs.length || 1;
  const distribution = w.commonTasks.find(common => common.id === task.commonId)?.distributions.find(item => item.taskId === task.id);
  const registered = !task.commonId || !!distribution && ['registered', 'assigned', 'submitted'].includes(distribution.status);
  const authorized = (task.primaryId === w.currentUser.id || w.currentUser.role === 'admin' || canActAsDeputy(w, w.currentUser, task, 'run.schedule', new Date(w.serverTime))) && w.currentUser.role !== 'head';
  const definitionPending = task.status === 'review' || task.status === 'revision';
  const activeTask = !unavailable && registered && !task.deletedAt && task.status !== 'archived';
  const needsCompletion = state.completed && !latest?.cycleManaged;
  const mayStart = authorized && activeTask && !definitionPending && state.canStart && !needsCompletion;
  const maySchedule = authorized && activeTask && !state.completed && latest?.status !== 'paused' && (!definitionPending || !!latest) && task.workflow.length > 0;
  const currentProgress = latest?.steps.length ? Math.round(latest.steps.filter(step => step.status === 'completed').length / latest.steps.length * 100) : task.workflow.length ? Math.round(task.workflow.filter(step => step.done).length / task.workflow.length * 100) : 0;
  const status = executionStatus(task, latest, currentProgress);
  const { cycleOverdue } = deadlineState({ taskDueDate: task.dueDate, cycleDueDate: latest?.dueDate, progress: currentProgress, runStatus: latest?.status, taskStatus: task.status, deletedAt: task.deletedAt }, new Date(w.serverTime).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' }));
  const choose = (id: string) => { setSelection(id); setFormMode(null); setError(''); onHistoryChange?.(id !== 'current'); };
  const changeSelection = (id: string) => { if (id !== selection || formMode) requestNavigation(() => choose(id)); };
  const openSchedule = (mode: 'current' | 'next') => { if (mode !== formMode || isHistory) requestNavigation(() => { choose('current'); setFormMode(mode); }); };
  const numberFor = (run: Run) => run.cycleNumber || state.runs.length - state.runs.findIndex(item => item.id === run.id);
  const view = isHistory ? 'history' : 'current';
  const tabs = useTabs({ value: view, onChange: value => { if (value === 'current') changeSelection('current'); else if (past[0]) changeSelection(past[0].id); }, items: [
    { value: 'current', label: hasNewDefinition ? '다음 회차의 절차' : '현재 회차' },
    { value: 'history', label: <><History size={15} />지난 회차 <span>{past.length}</span></>, disabled: !past.length },
  ] });

  return <div className="wc-workspace">
    {newerCycleAvailable && <div className="wc-warning" role="status"><strong>이전 회차를 보고 있습니다.</strong><p>다른 곳에서 회차가 갱신되었습니다. 작성 중인 일정·수행 결과·메모는 이전 회차에 보관했습니다. 새 회차로 이동하기 전에 입력 내용을 확인해 주세요.</p><Button variant="secondary" onClick={() => requestNavigation(() => { setDisplayedRunId(newestRunId); choose('current'); })}>새 회차 확인<ArrowRight size={15}/></Button></div>}
    <section className="wc-cycle-card" aria-label="업무 회차 관리">
      <div className="wc-cycle-top"><span className="wc-cycle-symbol"><RotateCcw size={22} /></span><div><p>절차에 일정을 연결하고, 완료한 기록을 이어갑니다.</p><h3>{hasNewDefinition ? '마지막 완료' : '현재'} {count}회차 <Badge tone={status.tone}>{status.label}</Badge></h3></div><strong>{currentProgress}<small>%</small></strong></div>
      <Progress value={currentProgress} />
      <div className="wc-cycle-dates"><span><CalendarDays size={14} />업무 마감 {displayDate(task.dueDate)}</span><span>회차 일정 {latest ? `${displayDate(latest.startDate)} — ${displayDate(latest.dueDate)}` : '미등록'}{cycleOverdue && <Badge tone="outline">회차 일정 지남</Badge>}</span>{latest?.completedAt && <span><CheckCircle2 size={14} />{displayTime(latest.completedAt)} 완료</span>}</div>
      <div className="wc-cycle-bottom"><p>{state.completed ? needsCompletion ? '모든 절차를 마쳤습니다. 업무 사이클을 완료 처리한 뒤 새로운 일정을 등록하세요.' : '이번 업무 사이클이 완료되었습니다. 새 일정을 등록하면 다음 회차가 시작되고 완료한 기록은 보존됩니다.' : '절차별 날짜와 세부 내용을 등록하고 수행 결과를 기록하세요. 마지막 검토까지 마치면 업무 사이클이 완료됩니다.'}</p><div className="wc-cycle-actions">{maySchedule && <Button data-task-action="true" variant="accent-outline" disabled={dirty} onClick={() => openSchedule('current')}><Pencil size={15} />{latest?.startDate ? '일정 수정' : '일정 등록'}</Button>}{needsCompletion && authorized && activeTask && <Button data-task-action="true" disabled={dirty || completing} onClick={async () => { setCompleting(true); setError(''); try { if (!await command('run.completeCycle', { taskId: task.id, ...(latest ? { runId: latest.id } : {}) }, { onSaved: updated => { const runId = savedCommandTarget(updated, 'run.completeCycle', w.currentUser.id); if (runId) setDisplayedRunId(runId); } })) setError('업무 사이클을 완료하지 못했습니다. 현재 수행 상태를 확인해 주세요.'); } catch (cause) { setError(cause instanceof Error ? cause.message : '업무 사이클을 완료하지 못했습니다.'); } finally { setCompleting(false); } }}><CheckCircle2 size={15} />{completing ? '완료 처리 중…' : '업무 사이클 완료'}</Button>}{mayStart && <Button data-task-action="true" variant="accent-outline" disabled={dirty} onClick={() => openSchedule('next')}><RotateCcw size={15} />새 일정 등록</Button>}</div></div>
      {state.completed && !authorized && <p className="wc-note">다음 회차는 해당 업무의 담당자 또는 관리자가 시작할 수 있습니다.</p>}
      {state.completed && authorized && definitionPending && <p className="wc-warning">변경 중인 업무 기준을 확정한 뒤 다음 회차를 시작할 수 있습니다.</p>}
      {dirty && <p className="wc-warning" role="status">저장하지 않은 업무 변경사항이 있습니다. 변경사항을 저장한 뒤 일정을 등록하거나 절차를 수행해 주세요.</p>}
      {latest?.scheduleDetails && <div className="wc-cycle-details"><strong>이번 회차 세부 내용</strong><p>{latest.scheduleDetails}</p></div>}
      {error && <p className="wc-error" role="alert">{error}</p>}
    </section>
    <div className="wc-view-controls"><Tabs tabs={tabs} label="업무 회차" className="tabs"/>{past.length > 0 && <label className="wc-history-select"><span>지난 회차 선택</span><select aria-label="지난 업무 회차" value={isHistory ? selected.id : ''} onChange={event => event.target.value && changeSelection(event.target.value)}><option value="">회차를 선택하세요</option>{past.map(run => <option key={run.id} value={run.id}>{numberFor(run)}회차 · {run.period} · {executionLabel(run.status)}</option>)}</select><ChevronDown size={14} /></label>}</div>
    <div {...tabs.panelAttrs(view)} className="wc-tab-panel">
    {formMode && !isHistory && <CycleScheduleForm key={`${task.id}-${formMode}`} workspace={w} task={task} latest={latest} cycleNumber={formMode === 'next' ? state.nextCycleNumber : count} mode={formMode} command={command} disabled={dirty || unavailable} onSavedRunId={setDisplayedRunId} onClose={() => setFormMode(null)} />}
    {hasNewDefinition && !isHistory && <><p className="wc-readonly"><FileText size={15} />변경된 업무 절차는 다음 회차를 시작할 때 적용됩니다. 완료한 회차의 원래 절차는 지난 회차에서 확인하세요.</p>{!formMode && <ProcedureFlow workflow={nextCycleWorkflow(task)} participants={taskProcedureParticipants(w, task)} context={taskProcedureContext(w, task)} />}</>}
    {isHistory ? <CycleHistory workspace={w} task={task} run={selected} number={numberFor(selected)} /> : <>{!past.length && <p className="wc-history-empty"><History size={14} />새 일정을 등록하면 완료한 절차·일정·결과를 지난 회차에서 확인할 수 있습니다.</p>}{!formMode && <CurrentCycleSteps key={latest?.id || task.id} workspace={w} task={task} run={latest} command={command} disabled={dirty || !activeTask} hideCompletedVersion={hasNewDefinition} />}{!formMode && latest && <CurrentCycleNotes key={latest.id} workspace={w} task={task} run={latest} command={command} disabled={dirty || !activeTask}/>}{children}</>}
    </div>
    <div {...tabs.panelAttrs(isHistory ? 'current' : 'history')}/>
  </div>;
}

function CycleScheduleForm({ workspace: w, task, latest, cycleNumber, mode, command, disabled, onSavedRunId, onClose }: { workspace: Workspace; task: Task; latest?: Run; cycleNumber: number; mode: 'current' | 'next'; command: CommandFn; disabled: boolean; onSavedRunId: (runId: string) => void; onClose: () => void }) {
  const { requestNavigation } = useUnsavedNavigation();
  const formRef = useRef<HTMLFormElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const isNext = mode === 'next';
  const [editingRun] = useState(latest);
  const [workflow] = useState(() => structuredClone(isNext ? nextCycleWorkflow(task) : latest ? runWorkflow(task, latest) : task.workflow));
  const participants = taskProcedureParticipants(w, isNext ? task : latest || task);
  const [editingCycleNumber] = useState(cycleNumber);
  const [title] = useState(() => (isNext ? `${task.title} · ${cycleNumber}회차` : latest?.title || `${task.title} · ${cycleNumber}회차`).slice(0, 150));
  const [savedRunId, setSavedRunId] = useState('');
  const targetRunId = savedRunId || (!isNext ? editingRun?.id : '');
  const revision = useRevisionCommand(w, command, targetRunId ? { kind: 'run', id: targetRunId } : { kind: 'task', id: task.id });
  const [scheduleDetails, setScheduleDetails] = useState(isNext ? '' : latest?.scheduleDetails || '');
  const [steps, setSteps] = useState(() => workflow.map(step => ({ stepId: step.id, startDate: !isNext && step.startDate && validDate(step.startDate) ? step.startDate : '', dueDate: !isNext && step.dueDate && validDate(step.dueDate) ? step.dueDate : '', scheduleDetails: isNext ? '' : step.scheduleDetails || '' })));
  const scheduleSnapshot = JSON.stringify({ scheduleDetails, steps });
  const latestSchedule = useRef(scheduleSnapshot); latestSchedule.current = scheduleSnapshot;
  const [savedSnapshot, setSavedSnapshot] = useState(scheduleSnapshot);
  const dates = steps.flatMap(step => [step.startDate, step.dueDate]).filter(validDate).sort();
  const startDate = dates[0] || '';
  const dueDate = dates.at(-1) || '';
  const scheduledCount = steps.filter(step => step.startDate || step.dueDate).length;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const [confirmDeadline, setConfirmDeadline] = useState(false);
  const exceedsTaskDeadline = validDate(task.dueDate) && validDate(dueDate) && dueDate > task.dueDate;
  useUnsavedChanges(saving || scheduleSnapshot !== savedSnapshot, '절차별 일정');
  const common = w.commonTasks.find(item => item.id === task.commonId);
  const reportingRun = isNext && common && validDate(startDate) ? { period: currentPeriod(common.frequency, new Date(`${startDate}T12:00:00+09:00`)) } : latest;
  const deadline = common ? commonDeadline(common, reportingRun) : undefined;
  function validate() {
    if (!workflow.length) return '절차를 먼저 만들고 저장해 주세요.';
    if (!dates.length) return '일정을 등록할 절차에 시작일 또는 종료일을 입력해 주세요.';
    for (const step of steps) {
      const name = workflow.find(item => item.id === step.stepId)?.title || '절차';
      if ([step.startDate, step.dueDate].some(value => value && !validDate(value))) return `‘${name}’의 날짜를 올바르게 입력해 주세요.`;
      if (step.startDate && step.dueDate && step.startDate > step.dueDate) return `‘${name}’의 종료일은 시작일 이후여야 합니다.`;
    }
    const conflict = procedureScheduleConflicts(workflow, steps)[0];
    if (conflict) {
      const name = workflow.find(step => step.id === conflict.stepId)?.title || '절차';
      const prerequisite = workflow.find(step => step.id === conflict.prerequisiteId)?.title || '선행 절차';
      return `‘${name}’은 선행 절차 ‘${prerequisite}’이 끝난 뒤 시작하도록 일정을 설정해 주세요.`;
    }
    return '';
  }
  async function saveSchedule() {
    if (disabled || saving || revision.conflicted) return;
    if (formRef.current && !formRef.current.reportValidity()) return;
    const message = validate(); setError(message); if (message) return;
    setSaving(true); setSaveNotice('');
    try {
      const type = isNext && !savedRunId ? 'run.nextCycle' : 'run.schedule';
      const saved = await revision.command(type, { taskId: task.id, ...(savedRunId ? { runId: savedRunId } : editingRun ? isNext ? { previousRunId: editingRun.id } : { runId: editingRun.id } : {}), title: title.trim(), startDate, dueDate, scheduleDetails: scheduleDetails.trim(), steps: steps.map(step => ({ stepId: step.stepId, ...(step.startDate ? { startDate: step.startDate } : {}), ...(step.dueDate ? { dueDate: step.dueDate } : {}), scheduleDetails: step.scheduleDetails.trim() })) }, { onSaved: updated => {
        if (!mounted.current) return;
        const targetId = savedCommandTarget(updated, type, w.currentUser.id);
        if (targetId) { setSavedRunId(targetId); onSavedRunId(targetId); }
        setSavedSnapshot(scheduleSnapshot);
      } });
      if (!mounted.current) return;
      if (saved) {
        if (latestSchedule.current === scheduleSnapshot) onClose();
        else setSaveNotice('요청한 일정은 저장했습니다. 저장 중 추가로 바꾼 내용은 남아 있으니 다시 저장해 주세요.');
      } else setError('일정을 저장하지 못했습니다. 표시된 안내와 현재 회차 상태를 확인해 주세요.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '일정을 저장하지 못했습니다.'); } finally { setSaving(false); }
  }
  return <form ref={formRef} className="wc-next-form" aria-label={isNext ? '다음 업무 회차 일정' : '현재 업무 회차 일정 등록'} onSubmit={event => {
    event.preventDefault(); if (disabled || saving || revision.conflicted) return;
    if (!event.currentTarget.reportValidity()) return;
    const message = validate(); setError(message); if (message) return;
    if (exceedsTaskDeadline) setConfirmDeadline(true); else void saveSchedule();
  }}>
    <div className="wc-form-heading"><div><span>{editingCycleNumber}회차 · 저장된 절차 {workflow.length}개</span><h3>절차별 일정 {isNext && !savedRunId ? '등록' : '설정'}</h3></div><button type="button" className="icon-btn" aria-label="일정 등록 닫기" onClick={() => requestNavigation(onClose)}><X size={18} /></button></div>
    <p className="wc-form-description">절차별로 날짜만 정해 주세요. 전체 기간은 입력한 날짜에 맞춰 자동으로 정해집니다.{isNext && ' 지난 회차의 완료 기록은 그대로 보관됩니다.'}</p>
    <p className={exceedsTaskDeadline ? 'wc-warning' : 'wc-note'} role="status">업무 마감: {displayDate(task.dueDate)}. {exceedsTaskDeadline ? '회차 종료일이 업무 마감일을 넘습니다. 일정을 저장해도 업무 마감일과 기한 경과 표시는 바뀌지 않습니다.' : '회차 일정을 바꿔도 업무 마감일은 유지됩니다.'}</p>
    {deadline && <p className={validDate(dueDate) && dueDate > deadline ? "wc-warning" : "wc-note"} role="status">중앙 제출기한: {deadline}. {validDate(dueDate) && dueDate > deadline ? "내부 종료일이 중앙 제출기한을 넘습니다. 저장해도 제출기한은 연장되지 않고 중앙 기준으로 지연 표시됩니다." : "회차 일정을 수정해도 중앙 제출기한은 유지됩니다."}</p>}
    <fieldset disabled={disabled} className="wc-form-fields">
    <div className="wc-schedule-summary" aria-live="polite"><CalendarDays size={19}/><div><span>전체 일정</span><strong>{dates.length ? `${displayDate(startDate)} — ${displayDate(dueDate)}` : '절차의 날짜를 입력해 주세요'}</strong></div><span>{scheduledCount} / {workflow.length}개 설정</span></div>
    <div className="wc-date-steps">{workflow.map((step, index) => { const stepDates = steps.find(item => item.stepId === step.id)!; return <section key={step.id} aria-label={`${index + 1}. ${step.title} 일정`}><div><span>{String(index + 1).padStart(2, '0')}</span><div><h4>{step.title}</h4><small><UserRound size={13}/>{participants[step.role]}</small></div></div><div className="wc-procedure-dates"><Field label="시작일"><DateInput aria-label={`${step.title} 시작일`} value={stepDates.startDate} onChange={value => { setSteps(items => items.map(item => item.stepId === step.id ? { ...item, startDate: value } : item)); setError(''); }} /></Field><span aria-hidden="true">—</span><Field label="종료일"><DateInput aria-label={`${step.title} 종료일`} min={stepDates.startDate || undefined} value={stepDates.dueDate} onChange={value => { setSteps(items => items.map(item => item.stepId === step.id ? { ...item, dueDate: value } : item)); setError(''); }} /></Field></div>{step.dependsOn.length > 0 && <p className="wc-step-dependencies"><ArrowRight size={13}/>{step.dependsOn.map(id => workflow.find(item => item.id === id)?.title).filter(Boolean).join(', ')} 완료 후 시작</p>}<details className="wc-schedule-extra"><summary><span>진행 방법 · 일정 메모{stepDates.scheduleDetails ? ' 있음' : ' (선택)'}</span><ChevronDown size={15}/></summary>{step.description && <p className="wc-step-description">{step.description}</p>}<Field label="일정 메모"><textarea aria-label={`${step.title} 일정 메모`} rows={2} maxLength={5000} value={stepDates.scheduleDetails} placeholder="이번 일정에 필요한 장소, 준비 사항 등을 적어 주세요." onChange={event => setSteps(items => items.map(item => item.stepId === step.id ? { ...item, scheduleDetails: event.target.value } : item))} /></Field></details></section>; })}</div>
    <details className="wc-schedule-extra wc-cycle-memo"><summary><span>전체 일정 메모{scheduleDetails ? ' 있음' : ' (선택)'}</span><ChevronDown size={15}/></summary><Field label="전체 일정 메모"><textarea rows={2} maxLength={5000} value={scheduleDetails} placeholder="전체 절차에 공통으로 적용할 안내가 있으면 적어 주세요." onChange={event => setScheduleDetails(event.target.value)}/></Field></details>
    </fieldset>
    <p className="wc-note">날짜가 정해진 절차부터 등록할 수 있습니다. 비워 둔 절차는 ‘일정 미정’으로 표시됩니다.</p>
    {error && <p role="alert" className="wc-error">{error}</p>}
    {saveNotice && <p role="status" className="wc-note">{saveNotice}</p>}
    {revision.conflict}<div className="form-actions"><Button variant="secondary" onClick={() => requestNavigation(onClose)}>취소</Button><Button variant="accent" type="submit" disabled={saving || disabled || revision.conflicted || !workflow.length}><CalendarDays size={15} />{saving ? '일정 저장 중…' : isNext && !savedRunId ? '새 일정으로 회차 시작' : '일정 저장'}</Button></div>
    {confirmDeadline && <ConfirmDialog title="회차 종료일이 업무 마감일을 넘습니다" description="회차 일정을 저장해도 업무 마감일은 연장되지 않습니다." cancelLabel="일정 다시 확인" confirmLabel="확인하고 일정 저장" destructive={false} onCancel={() => setConfirmDeadline(false)} onConfirm={() => { setConfirmDeadline(false); void saveSchedule(); }}><p>업무 마감 {displayDate(task.dueDate)} · 회차 종료 {displayDate(dueDate)}</p></ConfirmDialog>}
  </form>;
}

function CurrentCycleSteps({ workspace: w, task, run, command, disabled, hideCompletedVersion = false }: { workspace: Workspace; task: Task; run?: Run; command: CommandFn; disabled: boolean; hideCompletedVersion?: boolean }) {
  const workflow = run ? runWorkflow(task, run) : task.workflow;
  const participants = taskProcedureParticipants(w, run || task);
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const pendingRef = useRef(new Set<string>());
  const [error, setError] = useState('');
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const reviewer = w.currentUser.id === (run?.reviewerId || task.reviewerId) || w.currentUser.role === 'admin' || w.currentUser.role === 'head' && w.currentUser.departmentId === task.departmentId;
  const assigned = [run?.primaryId || task.primaryId, ...(run?.supportIds || task.supportIds)].includes(w.currentUser.id);
  const delegated = (action: string) => canActAsDeputy(w, w.currentUser, task, action, new Date(w.serverTime));
  const permitted = (step: WorkflowStep, action: string) => step.role === 'reviewer' ? reviewer : assigned || (run ? delegated(action) : delegated('task.setProgress') || w.currentUser.role === 'admin');
  const structuralLock = disabled || run?.status === 'paused' || run?.status === 'completed';
  const saving = pendingKeys.size > 0;
  const done = (id: string) => run ? run.steps.find(step => step.stepId === id)?.status === 'completed' : !!workflow.find(step => step.id === id)?.done;
  useUnsavedChanges(Object.values(outputs).some(output => output.length > 0), '절차 수행 결과');
  async function perform(type: string, payload: Record<string, unknown>, stepId: string, key = `step:${stepId}`) {
    if (disabled || pendingRef.current.has(key)) return;
    const submittedOutput = outputs[stepId];
    pendingRef.current.add(key); setPendingKeys(new Set(pendingRef.current)); setError('');
    try {
      if (!await command(type, payload)) setError('수행 내용을 저장하지 못했습니다. 안내 메시지와 현재 절차 상태를 확인해 주세요.');
      else if (type === 'run.completeStep' || type === 'run.note' || type === 'task.setProgress' && payload.done === true) setOutputs(items => {
        if (items[stepId] !== submittedOutput) return items;
        const next = { ...items }; delete next[stepId]; return next;
      });
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '수행 내용을 저장하지 못했습니다.'); }
    finally { pendingRef.current.delete(key); setPendingKeys(new Set(pendingRef.current)); }
  }
  if (hideCompletedVersion && !saving && !Object.values(outputs).some(output => output.length > 0)) return null;
  if (!workflow.length) return <p className="wc-readonly"><FileText size={16} />절차 탭에서 프로세스를 만들고 저장한 뒤 일정을 등록해 주세요.</p>;
  return <section className="wc-current" aria-label="현재 회차 절차 수행">
    <div className="wc-current-heading"><div><h3>일정에 따라 한 단계씩</h3><p>수행 내용을 확인하고 체크리스트와 결과를 기록하세요.</p></div><Badge tone="outline">{workflow.filter(step => done(step.id)).length} / {workflow.length} 완료</Badge></div>
    {!run && <p className="wc-note">일정을 등록하면 이번 회차의 체크리스트와 수행 결과를 함께 기록할 수 있습니다.</p>}
    {run?.status === 'paused' && <p className="wc-warning">일시 중지된 회차입니다. 현재 수행 상태를 변경할 수 없습니다.</p>}
    <CollapsedProcedureFlow workflow={workflow} participants={participants} context={cycleProcedureContext(w, task, run?.definitionVersion)}/>
    <div className="wc-history-steps wc-execution-steps">{workflow.map((step, index) => {
      const execution = run?.steps.find(item => item.stepId === step.id);
      const completed = done(step.id);
      const ready = step.dependsOn.every(done);
      const mayCheck = permitted(step, 'run.check');
      const mayComplete = permitted(step, 'run.completeStep');
      const output = outputs[step.id] ?? '';
      return <article key={step.id} className={completed ? 'is-complete' : ''}>
        <header><span className={completed ? 'wc-step-number done' : 'wc-step-number'}>{completed ? <Check size={16} /> : String(index + 1).padStart(2, '0')}</span><div><span>{roleNames[step.role]}</span><h4>{step.title}</h4><p className="wc-step-participant"><UserRound size={14}/>{participants[step.role]}</p></div><Badge tone={completed ? 'success' : ready ? 'info' : 'soft'}>{completed ? '완료' : ready ? '수행 가능' : '선행 절차 대기'}</Badge></header>
        <div className="wc-step-times"><span><CalendarDays size={14} />{step.startDate || step.dueDate ? `${displayDate(step.startDate)} — ${displayDate(step.dueDate)}` : '일정 미정'}</span>{completed && execution?.completedAt && <span><UserRound size={14} />{nameOf(w, execution.completedBy)} · {displayTime(execution.completedAt)}</span>}</div>
        {step.description && <p className="wc-step-description">{step.description}</p>}
        <TaskFileAttachments workspace={w} taskId={task.id} attachmentIds={step.attachmentIds || []} label="절차 참고 파일"/>
        {step.scheduleDetails && <div className="wc-schedule-details"><strong>이번 일정의 세부 내용</strong><p>{step.scheduleDetails}</p></div>}
        {step.dependsOn.length > 0 && <p className="wc-step-dependencies"><ArrowRight size={13} />{step.dependsOn.map(id => workflow.find(item => item.id === id)?.title).filter(Boolean).join(', ')} 완료 후 수행</p>}
        {!!execution?.checklist.length && <div className="wc-execution-checklist" aria-label={`${step.title} 체크리스트`}>{execution.checklist.map(item => <label key={item.id}><input type="checkbox" checked={item.done} disabled={structuralLock || completed || !ready || !mayCheck || pendingKeys.has(`check:${step.id}:${item.id}`)} onChange={event => void perform('run.check', { runId: run!.id, stepId: step.id, checkId: item.id, done: event.target.checked }, step.id, `check:${step.id}:${item.id}`)} /><span>{item.title}</span>{pendingKeys.has(`check:${step.id}:${item.id}`) && <LoaderCircle size={13} className="spin" aria-label="저장 중" />}</label>)}</div>}
        {completed ? (execution?.output || step.output) && <div className="wc-output"><FileText size={16} /><div><span>{execution?.output ? '기록된 수행 결과' : '계획한 결과물'}</span><p>{execution?.output || step.output}</p></div></div> : <>
          {step.output && <p className="wc-planned-output"><FileText size={14} />예정 결과물: {step.output}</p>}
          {run && (mayComplete || output.length > 0) && <Field label={`${step.title} 수행 결과`}><textarea rows={2} maxLength={5000} disabled={structuralLock || !ready} value={output} placeholder="완료한 내용과 생산 문서 등을 기록하세요." onChange={event => setOutputs(items => ({ ...items, [step.id]: event.target.value }))} /></Field>}
          <div className="wc-step-actions">{mayComplete ? <><span>{!ready ? '선행 절차를 먼저 완료해 주세요.' : execution?.checklist.some(item => !item.done) ? '체크리스트를 모두 확인한 뒤 완료하세요.' : run && !output.trim() ? '수행 결과를 입력한 뒤 완료하세요.' : step.role === 'reviewer' ? '검토 결과를 확인하고 완료하세요.' : '수행한 내용을 확인하고 완료하세요.'}</span><Button data-task-action="true" variant="secondary" disabled={structuralLock || saving || !ready || !!execution?.checklist.some(item => !item.done) || !!run && !output.trim()} onClick={() => void perform(run ? 'run.completeStep' : 'task.setProgress', run ? { runId: run.id, stepId: step.id, output: output.trim() } : { taskId: task.id, stepId: step.id, done: true }, step.id)}><CheckCircle2 size={15} />{pendingKeys.has(`step:${step.id}`) ? '저장 중…' : step.role === 'reviewer' ? '검토 완료' : '절차 완료'}</Button></> : <span>{step.role === 'reviewer' ? '지정된 검토자 또는 부서장이 완료합니다.' : '지정된 업무 담당자가 수행합니다.'}</span>}</div>
        </>}
        {completed && run && execution && <RunOutputCorrectionForm workspace={w} task={task} run={run} step={execution} command={command} disabled={disabled || saving || run.status === 'paused'}/>}
        {completed && output.length > 0 && <div className="wc-output-draft">
          <p className="wc-warning" role="status">절차 완료를 요청한 뒤 추가로 입력한 내용입니다. 완료 기록은 보존되며, 이 내용은 보완 메모로 저장할 수 있습니다.</p>
          <Field label={`${step.title} 추가 작성 내용`}><textarea rows={3} maxLength={5000} value={output} onChange={event => setOutputs(items => ({ ...items, [step.id]: event.target.value }))}/></Field>
          {run && !disabled && (assigned || reviewer || delegated('run.note')) && <Button variant="secondary" disabled={saving || !output.trim()} onClick={() => void perform('run.note', { runId: run.id, stepId: step.id, body: output.trim() }, step.id)}><Save size={15}/>보완 메모로 저장</Button>}
        </div>}
      </article>;
    })}</div>
    {run && <RunOutputCorrectionHistory workspace={w} run={run}/>}
    {run && <ProcedureRevisionHistory workspace={w} task={task} run={run}/>}
    {error && <p className="wc-error" role="alert">{error}</p>}
  </section>;
}

function CurrentCycleNotes({ workspace: w, task, run, command, disabled }: { workspace: Workspace; task: Task; run: Run; command: CommandFn; disabled: boolean }) {
  const [body, setBody] = useState('');
  const [stepId, setStepId] = useState('');
  const noteSnapshot = JSON.stringify({ body, stepId });
  const latestNote = useRef(noteSnapshot); latestNote.current = noteSnapshot;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const workflow = runWorkflow(task, run);
  const user = w.currentUser;
  const assigned = [run.primaryId, ...run.supportIds].includes(user.id);
  const delegated = task.primaryId === run.primaryId && canActAsDeputy(w, user, task, 'run.note', new Date(w.serverTime));
  const reviewer = run.reviewerId === user.id || user.role === 'admin' || user.role === 'head' && user.departmentId === run.departmentId;
  const canWrite = !disabled && (assigned || delegated || reviewer);
  useUnsavedChanges(!!body.trim(), '회차 보완 메모');

  return <section className="wc-current-notes" aria-label="현재 회차 메모">
    <header><h3><MessageSquare size={18}/>회차 메모 <span>{run.notes.length}건</span></h3><p>진행 상황이나 정정할 내용을 남겨 주세요. 완료한 절차의 원래 기록은 유지됩니다.</p></header>
    {run.notes.length ? <div className="wc-note-list">{run.notes.map(note => <article key={note.id}>
      <header><strong>{nameOf(w, note.authorId)}</strong><time dateTime={note.createdAt}>{displayTime(note.createdAt)}</time></header>
      <small>{note.stepId ? workflow.find(step => step.id === note.stepId)?.title || run.steps.find(step => step.id === note.stepId || step.stepId === note.stepId)?.title || '기존 절차' : '회차 전체'}</small>
      <p>{note.body}</p>
    </article>)}</div> : <p className="wc-note-empty">아직 남긴 메모가 없습니다.</p>}
    {(canWrite || body.length > 0) && <form className="wc-note-form" onSubmit={async event => {
      event.preventDefault(); if (!canWrite || saving || !body.trim()) return;
      setSaving(true); setError(''); setSaved(false);
      try {
        if (await command('run.note', { runId: run.id, body: body.trim(), ...(stepId ? { stepId } : {}) })) {
          if (latestNote.current === noteSnapshot) { setBody(''); setStepId(''); }
          setSaved(true);
        }
        else setError('메모를 저장하지 못했습니다. 작성한 내용을 확인한 뒤 다시 저장해 주세요.');
      } catch (cause) { setError(cause instanceof Error ? cause.message : '메모를 저장하지 못했습니다.'); }
      finally { setSaving(false); }
    }}>
      <fieldset disabled={!canWrite}>
        <Field label="연결할 절차 · 선택"><select value={stepId} onChange={event => { setStepId(event.target.value); setSaved(false); }}><option value="">회차 전체</option>{workflow.map((step, index) => <option key={step.id} value={step.id}>{index + 1}. {step.title}</option>)}</select></Field>
        <Field label="보완 메모"><textarea rows={3} maxLength={5000} required value={body} placeholder="진행 중 확인한 사항이나 완료 후 보완할 내용을 적어 주세요." onChange={event => { setBody(event.target.value); setError(''); setSaved(false); }}/></Field>
      </fieldset>
      <div className="wc-note-form-actions"><small>{body.length.toLocaleString('ko-KR')} / 5,000자</small><Button type="submit" disabled={!canWrite || saving || !body.trim()}><Save size={15}/>{saving ? '메모 저장 중…' : '메모 저장'}</Button></div>
      {error && <p className="wc-error" role="alert">{error}</p>}{saved && <p className="wc-note" role="status"><CheckCircle2 size={15}/>{body ? '요청한 메모는 저장했습니다. 저장 중 바꾼 내용은 입력칸에 남아 있습니다.' : '메모를 저장했습니다.'}</p>}
    </form>}
  </section>;
}

function CycleHistory({ workspace: w, task, run, number }: { workspace: Workspace; task: Task; run: Run; number: number }) {
  const workflow = runWorkflow(task, run);
  const participants = taskProcedureParticipants(w, run);
  const completed = run.steps.filter(step => step.status === 'completed').length;
  return <section className="wc-history" aria-label={`${number}회차 지난 절차 기록`}>
    <div className="wc-history-heading"><span className="wc-history-symbol"><History size={22} /></span><div><p>지난 회차 · 기록 보기</p><h3>{number}회차 <Badge tone={executionState(run.status).tone}>{executionLabel(run.status)}</Badge></h3><span>{run.title}</span></div><strong>{completed}<small> / {run.steps.length} 절차</small></strong></div>
    <div className="wc-history-meta"><div><span>회차 일정</span><strong>{run.startDate ? `${displayDate(run.startDate)} — ` : ''}{displayDate(run.dueDate)}</strong></div><div><span>완료 시각</span><strong>{displayTime(run.completedAt)}</strong></div><div><span>당시 담당자</span><strong>{nameOf(w, run.primaryId)}</strong></div><div><span>당시 검토자</span><strong>{nameOf(w, run.reviewerId)}</strong></div></div>
    <p className="wc-readonly"><LockKeyhole size={15} />지난 회차의 절차·일정·수행 결과입니다. 현재 회차를 수정해도 이 기록은 바뀌지 않습니다.</p>
    {run.scheduleDetails && <div className="wc-schedule-details"><strong>회차 세부 내용</strong><p>{run.scheduleDetails}</p></div>}
    {!run.workflowSnapshot && <p className="wc-note">이전 버전의 회차는 연결된 업무 기준과 남아 있는 수행 기록으로 표시합니다. 기록되지 않은 날짜·완료자는 미지정으로 표시합니다.</p>}
    <CollapsedProcedureFlow workflow={workflow} participants={participants} context={cycleProcedureContext(w, task, run.definitionVersion)}/>
    <div className="wc-history-steps">{workflow.map((step, index) => {
      const execution = run.steps.find(item => item.stepId === step.id);
      const done = execution?.status === 'completed';
      return <article key={step.id}><header><span className={done ? 'wc-step-number done' : 'wc-step-number'}>{done ? <Check size={16} /> : String(index + 1).padStart(2, '0')}</span><div><span>{roleNames[step.role]}</span><h4>{step.title}</h4><p className="wc-step-participant"><UserRound size={14}/>{participants[step.role]}</p></div><Badge tone={done ? 'success' : 'soft'}>{done ? '완료' : execution?.status === 'in_progress' ? '진행 중' : '대기'}</Badge></header>
        <div className="wc-step-times"><span><CalendarDays size={14} />{step.startDate || step.dueDate ? `${displayDate(step.startDate)} — ${displayDate(step.dueDate)}` : '절차 일정 미지정'}</span>{done && <span><UserRound size={14} />{nameOf(w, execution?.completedBy)} · {displayTime(execution?.completedAt)}</span>}</div>
        {step.description && <p className="wc-step-description">{step.description}</p>}
        <TaskFileAttachments workspace={w} taskId={task.id} attachmentIds={step.attachmentIds || []} label="절차 참고 파일"/>
        {step.scheduleDetails && <div className="wc-schedule-details"><strong>일정 세부 내용</strong><p>{step.scheduleDetails}</p></div>}
        {step.dependsOn.length > 0 && <p className="wc-step-dependencies"><ArrowRight size={13} />{step.dependsOn.map(id => workflow.find(item => item.id === id)?.title).filter(Boolean).join(', ')} 완료 후 수행</p>}
        {!!execution?.checklist.length && <ul className="wc-checklist" aria-label={`${step.title} 체크리스트`}>{execution.checklist.map(item => <li key={item.id}><span className={item.done ? 'checked' : ''}>{item.done ? <Check size={12} /> : null}</span><div><strong>{item.title}</strong>{item.done && <small>{nameOf(w, item.completedBy)} · {displayTime(item.completedAt)}</small>}</div></li>)}</ul>}
        {(execution?.output || step.output) && <div className="wc-output"><FileText size={16} /><div><span>{execution?.output ? '기록된 수행 결과' : '계획한 결과물'}</span><p>{execution?.output || step.output}</p></div></div>}
      </article>;
    })}</div>
    {run.notes.length > 0 && <div className="wc-history-notes"><h4><FileText size={16} />회차 메모</h4>{run.notes.map(note => <article key={note.id}><header><strong>{nameOf(w, note.authorId)}</strong><time>{displayTime(note.createdAt)}</time></header>{note.stepId && <small>{workflow.find(step => step.id === note.stepId)?.title || run.steps.find(step => step.stepId === note.stepId)?.title || '연결된 절차'}</small>}<p>{note.body}</p></article>)}</div>}
    <RunOutputCorrectionHistory workspace={w} run={run}/>
    <ProcedureRevisionHistory workspace={w} task={task} run={run}/>
  </section>;
}

function ProcedureRevisionHistory({ workspace, task, run }: { workspace: Workspace; task: Task; run: Run }) {
  const [open, setOpen] = useState(false);
  const history = run.procedureHistory ?? [];
  if (!history.length) return null;
  return <details className="wc-procedure-history" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><History size={17}/><span>이 회차의 절차 변경 이력 <b>{history.length}</b></span><ChevronDown size={17}/></summary>
    {open && <div className="wc-procedure-history-body"><p className="wc-readonly"><LockKeyhole size={15}/>교체 전 절차와 당시 수행 기록입니다. 현재 절차에 합쳐지거나 다시 적용되지 않습니다.</p>{[...history].reverse().map(entry => <ProcedureRevisionEntry key={entry.id} workspace={workspace} task={task} run={run} entry={entry}/>)}</div>}
  </details>;
}

function ProcedureRevisionEntry({ workspace: w, task, run, entry }: { workspace: Workspace; task: Task; run: Run; entry: RunProcedureHistory }) {
  const [open, setOpen] = useState(false);
  const previous: Run = { ...run, ...entry, procedureHistory: undefined };
  const workflow = runWorkflow(task, previous);
  const participants = taskProcedureParticipants(w, entry);
  const completed = entry.steps.filter(step => step.status === 'completed').length;
  return <details className="wc-procedure-revision" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><div><strong>{displayTime(entry.replacedAt)} 교체</strong><span>{nameOf(w, entry.replacedBy)} · 이전 기준 v{entry.definitionVersion} · {completed}/{entry.steps.length}단계 완료</span></div><ChevronDown size={17}/></summary>
    {open && <div className="wc-procedure-revision-body">
      <div className="wc-procedure-reason"><strong>교체 사유</strong><p>{entry.reason || '사유 기록 없음'}</p></div>
      <div className="wc-history-meta"><div><span>당시 회차 상태</span><strong>{executionLabel(entry.status)}</strong></div><div><span>당시 회차 일정</span><strong>{entry.startDate ? `${displayDate(entry.startDate)} — ` : ''}{displayDate(entry.dueDate)}</strong></div><div><span>당시 업무 담당자</span><strong>{participants.primary}</strong></div><div><span>당시 지원 담당자</span><strong>{participants.support}</strong></div><div><span>당시 검토자</span><strong>{participants.reviewer}</strong></div>{entry.completedAt && <div><span>완료 시각</span><strong>{displayTime(entry.completedAt)}</strong></div>}</div>
      {entry.scheduleDetails && <div className="wc-schedule-details"><strong>당시 회차 세부 내용</strong><p>{entry.scheduleDetails}</p></div>}
      <CollapsedProcedureFlow workflow={workflow} participants={participants} context={cycleProcedureContext(w, task, entry.definitionVersion)}/>
      <div className="wc-history-steps">{workflow.map((step, index) => {
        const execution = entry.steps.find(item => item.stepId === step.id);
        const done = execution?.status === 'completed';
        return <article key={step.id}><header><span className={done ? 'wc-step-number done' : 'wc-step-number'}>{done ? <Check size={16}/> : String(index + 1).padStart(2, '0')}</span><div><span>{roleNames[step.role]}</span><h4>{step.title}</h4><p className="wc-step-participant"><UserRound size={14}/>{participants[step.role]}</p></div><Badge tone={done ? 'success' : 'soft'}>{done ? '완료' : execution?.status === 'in_progress' ? '진행 중' : '대기'}</Badge></header>
          <div className="wc-step-times"><span><CalendarDays size={14}/>{step.startDate || step.dueDate ? `${displayDate(step.startDate)} — ${displayDate(step.dueDate)}` : '절차 일정 미지정'}</span>{done && <span><UserRound size={14}/>{nameOf(w, execution?.completedBy)} · {displayTime(execution?.completedAt)}</span>}</div>
          {step.description && <p className="wc-step-description">{step.description}</p>}
          <TaskFileAttachments workspace={w} taskId={task.id} attachmentIds={step.attachmentIds || []} label="절차 참고 파일"/>
          {step.scheduleDetails && <div className="wc-schedule-details"><strong>당시 일정의 세부 내용</strong><p>{step.scheduleDetails}</p></div>}
          {!!step.dependsOn.length && <p className="wc-step-dependencies"><ArrowRight size={13}/>{step.dependsOn.map(id => workflow.find(item => item.id === id)?.title).filter(Boolean).join(', ')} 완료 후 수행</p>}
          {!!execution?.checklist.length && <ul className="wc-checklist">{execution.checklist.map(item => <li key={item.id}><span className={item.done ? 'checked' : ''}>{item.done ? <Check size={12}/> : null}</span><div><strong>{item.title}</strong>{item.done && <small>{nameOf(w, item.completedBy)} · {displayTime(item.completedAt)}</small>}</div></li>)}</ul>}
          {(execution?.output || step.output) && <div className="wc-output"><FileText size={16}/><div><span>{execution?.output ? '당시 기록된 수행 결과' : '당시 계획한 결과물'}</span><p>{execution?.output || step.output}</p></div></div>}
        </article>;
      })}</div>
      {!!entry.notes.length && <div className="wc-history-notes"><h4><FileText size={16}/>당시 회차 메모</h4>{entry.notes.map(note => <article key={note.id}><header><strong>{nameOf(w, note.authorId)}</strong><time>{displayTime(note.createdAt)}</time></header>{note.stepId && <small>{workflow.find(step => step.id === note.stepId)?.title || '연결된 절차'}</small>}<p>{note.body}</p></article>)}</div>}
    </div>}
  </details>;
}

function CollapsedProcedureFlow({ workflow, participants, context }: { workflow: WorkflowStep[]; participants: ReturnType<typeof taskProcedureParticipants>; context: ProcedureContext }) {
  const [open, setOpen] = useState(false);
  return <details className="wc-flow-disclosure" onToggle={event => setOpen(event.currentTarget.open)}><summary onPointerEnter={() => void preloadProcedureFlow()} onFocus={() => void preloadProcedureFlow()}><span>전체 절차 흐름 보기</span><ChevronDown size={15}/></summary>{open && <ProcedureFlow workflow={workflow} participants={participants} context={context}/>}</details>;
}

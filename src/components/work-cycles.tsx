'use client';

import { canActAsDeputy } from '@/lib/delegations';
import { commonDeadline } from '@/lib/common-deadline';
import { currentPeriod } from '@/lib/schedule';

import { useState, type ReactNode } from 'react';
import { ArrowRight, CalendarDays, Check, CheckCircle2, ChevronDown, FileText, History, LockKeyhole, Pencil, RotateCcw, UserRound, X } from 'lucide-react';
import type { Run, Task, WorkflowStep, Workspace } from '@/lib/types';
import { nextCycleWorkflow, runWorkflow, taskCycleState } from '@/lib/work-cycles';
import { Badge, Button, Field, Progress, type CommandFn } from './ui';
import { ProcedureFlow } from './procedure-builder';
import './work-cycles.css';

const roleNames: Record<WorkflowStep['role'], string> = { primary: '담당자 수행', support: '협업·지원', reviewer: '검토·승인' };
const statusNames: Record<Run['status'], string> = { scheduled: '시작 전', in_progress: '진행 중', review: '검토 대기', completed: '완료', paused: '일시 중지' };
const displayDate = (value?: string) => value ? value.slice(0, 10).replaceAll('-', '.') : '미지정';
const displayTime = (value?: string) => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '기록 없음';
const todayFor = (w: Workspace) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(w.serverTime));
const dayValue = (value: string) => Date.parse(`${value}T00:00:00Z`);
const dayOffset = (value: string, days: number) => new Date(dayValue(value) + days * 86_400_000).toISOString().slice(0, 10);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dayValue(value)) && new Date(dayValue(value)).toISOString().slice(0, 10) === value;
const nameOf = (w: Workspace, id?: string) => w.users.find(user => user.id === id)?.name || w.identities?.find(user => user.id === id)?.name || '담당자 기록 없음';

type Props = { workspace: Workspace; task: Task; command: CommandFn; dirty: boolean; children?: ReactNode; onHistoryChange?: (value: boolean) => void };

export function WorkCycles({ workspace: w, task, command, dirty, children, onHistoryChange }: Props) {
  const state = taskCycleState(w, task);
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
  const activeTask = registered && !task.deletedAt && task.status !== 'archived';
  const needsCompletion = state.completed && !latest?.cycleManaged;
  const mayStart = authorized && activeTask && !definitionPending && state.canStart && !needsCompletion;
  const maySchedule = authorized && activeTask && !state.completed && latest?.status !== 'paused' && (!definitionPending || !!latest) && task.workflow.length > 0;
  const currentProgress = latest?.steps.length ? Math.round(latest.steps.filter(step => step.status === 'completed').length / latest.steps.length * 100) : task.workflow.length ? Math.round(task.workflow.filter(step => step.done).length / task.workflow.length * 100) : 0;
  const choose = (id: string) => { setSelection(id); setFormMode(null); setError(''); onHistoryChange?.(id !== 'current'); };
  const numberFor = (run: Run) => run.cycleNumber || state.runs.length - state.runs.findIndex(item => item.id === run.id);

  return <div className="wc-workspace">
    <section className="wc-cycle-card" aria-label="업무 회차 관리">
      <div className="wc-cycle-top"><span className="wc-cycle-symbol"><RotateCcw size={22} /></span><div><p>절차에 일정을 연결하고, 완료한 기록을 이어갑니다.</p><h3>{hasNewDefinition ? '마지막 완료' : '현재'} {count}회차 <Badge tone={state.completed ? 'success' : latest?.status === 'paused' ? 'warning' : 'info'}>{state.completed ? '모든 절차 완료' : latest ? statusNames[latest.status] : '일정 등록 대기'}</Badge></h3></div><strong>{currentProgress}<small>%</small></strong></div>
      <Progress value={currentProgress} />
      <div className="wc-cycle-dates"><span><CalendarDays size={14} />{latest?.startDate ? `${displayDate(latest.startDate)} — ` : ''}{displayDate(latest?.dueDate || task.dueDate)} 마감</span>{latest?.completedAt && <span><CheckCircle2 size={14} />{displayTime(latest.completedAt)} 완료</span>}</div>
      <div className="wc-cycle-bottom"><p>{state.completed ? needsCompletion ? '모든 절차를 마쳤습니다. 업무 사이클을 완료 처리한 뒤 새로운 일정을 등록하세요.' : '이번 업무 사이클이 완료되었습니다. 새 일정을 등록하면 다음 회차가 시작되고 완료한 기록은 보존됩니다.' : '절차별 날짜와 세부 내용을 등록하고 수행 결과를 기록하세요. 마지막 검토까지 마치면 업무 사이클이 완료됩니다.'}</p><div className="wc-cycle-actions">{maySchedule && <Button disabled={dirty} onClick={() => { choose('current'); setFormMode('current'); }}><Pencil size={15} />{latest?.startDate ? '일정 수정' : '일정 등록'}</Button>}{needsCompletion && authorized && activeTask && <Button disabled={dirty || completing} onClick={async () => { setCompleting(true); setError(''); try { if (!await command('run.completeCycle', { taskId: task.id, ...(latest ? { runId: latest.id } : {}) })) setError('업무 사이클을 완료하지 못했습니다. 현재 수행 상태를 확인해 주세요.'); } catch (cause) { setError(cause instanceof Error ? cause.message : '업무 사이클을 완료하지 못했습니다.'); } finally { setCompleting(false); } }}><CheckCircle2 size={15} />{completing ? '완료 처리 중…' : '업무 사이클 완료'}</Button>}{mayStart && <Button disabled={dirty} onClick={() => { choose('current'); setFormMode('next'); }}><RotateCcw size={15} />새 일정 등록</Button>}</div></div>
      {state.completed && !authorized && <p className="wc-note">다음 회차는 해당 업무의 담당자 또는 관리자가 시작할 수 있습니다.</p>}
      {state.completed && authorized && definitionPending && <p className="wc-warning">변경 중인 업무 기준을 확정한 뒤 다음 회차를 시작할 수 있습니다.</p>}
      {dirty && <p className="wc-warning" role="status">저장하지 않은 업무 변경사항이 있습니다. 변경사항을 저장한 뒤 일정을 등록하거나 절차를 수행해 주세요.</p>}
      {latest?.scheduleDetails && <div className="wc-cycle-details"><strong>이번 회차 세부 내용</strong><p>{latest.scheduleDetails}</p></div>}
      {error && <p className="wc-error" role="alert">{error}</p>}
    </section>
    <div className="wc-view-controls"><div className="tabs"><button type="button" className={!isHistory ? 'active' : ''} aria-pressed={!isHistory} onClick={() => choose('current')}>{hasNewDefinition ? '다음 회차의 절차' : '현재 회차'}</button><button type="button" className={isHistory ? 'active' : ''} aria-pressed={isHistory} disabled={!past.length} onClick={() => choose(past[0].id)}><History size={15} />지난 회차 <span>{past.length}</span></button></div>{past.length > 0 && <label className="wc-history-select"><span>지난 회차 선택</span><select aria-label="지난 업무 회차" value={isHistory ? selected.id : ''} onChange={event => event.target.value && choose(event.target.value)}><option value="">회차를 선택하세요</option>{past.map(run => <option key={run.id} value={run.id}>{numberFor(run)}회차 · {run.period} · {statusNames[run.status]}</option>)}</select><ChevronDown size={14} /></label>}</div>
    {formMode && !isHistory && <CycleScheduleForm key={`${latest?.id || task.id}-${formMode}`} workspace={w} task={task} latest={latest} cycleNumber={formMode === 'next' ? state.nextCycleNumber : count} mode={formMode} command={command} disabled={dirty} onClose={() => setFormMode(null)} />}
    {hasNewDefinition && !isHistory && <><p className="wc-readonly"><FileText size={15} />변경된 업무 절차는 다음 회차를 시작할 때 적용됩니다. 완료한 회차의 원래 절차는 지난 회차에서 확인하세요.</p>{!formMode && <ProcedureFlow workflow={nextCycleWorkflow(task)} />}</>}
    {isHistory ? <CycleHistory workspace={w} task={task} run={selected} number={numberFor(selected)} /> : <>{!past.length && <p className="wc-history-empty"><History size={14} />새 일정을 등록하면 완료한 절차·일정·결과를 지난 회차에서 확인할 수 있습니다.</p>}{!formMode && !hasNewDefinition && <CurrentCycleSteps workspace={w} task={task} run={latest} command={command} disabled={dirty || !activeTask} />}{children}</>}
  </div>;
}

function CycleScheduleForm({ workspace: w, task, latest, cycleNumber, mode, command, disabled, onClose }: { workspace: Workspace; task: Task; latest?: Run; cycleNumber: number; mode: 'current' | 'next'; command: CommandFn; disabled: boolean; onClose: () => void }) {
  const isNext = mode === 'next';
  const workflow = isNext ? nextCycleWorkflow(task) : latest ? runWorkflow(task, latest) : task.workflow;
  const priorWorkflow = latest ? runWorkflow(task, latest) : task.workflow;
  const priorDates = priorWorkflow.flatMap(step => [step.startDate, step.dueDate]).filter((value): value is string => !!value && validDate(value)).sort();
  const previousStart = latest?.startDate || priorDates[0] || latest?.dueDate || task.dueDate;
  const previousEnd = latest?.dueDate || priorDates.at(-1) || task.dueDate;
  const defaultStart = isNext ? dayOffset([todayFor(w), previousEnd].sort().at(-1)!, 1) : latest?.startDate || priorDates[0] || [todayFor(w), previousEnd].sort()[0];
  const duration = Math.max(1, Math.round((dayValue(previousEnd) - dayValue(previousStart)) / 86_400_000));
  const initialShift = Math.round((dayValue(defaultStart) - dayValue(previousStart)) / 86_400_000);
  const [title, setTitle] = useState((isNext ? `${task.title} · ${cycleNumber}회차` : latest?.title || `${task.title} · ${cycleNumber}회차`).slice(0, 150));
  const [startDate, setStartDate] = useState(defaultStart);
  const [dueDate, setDueDate] = useState(isNext ? dayOffset(defaultStart, duration) : previousEnd);
  const [scheduleDetails, setScheduleDetails] = useState(isNext ? '' : latest?.scheduleDetails || '');
  const [steps, setSteps] = useState(() => workflow.map(step => {
    const prior = priorWorkflow.find(item => item.id === step.id);
    return { stepId: step.id, startDate: prior?.startDate && validDate(prior.startDate) ? isNext ? dayOffset(prior.startDate, initialShift) : prior.startDate : '', dueDate: prior?.dueDate && validDate(prior.dueDate) ? isNext ? dayOffset(prior.dueDate, initialShift) : prior.dueDate : '', scheduleDetails: isNext ? '' : prior?.scheduleDetails || '' };
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const common = w.commonTasks.find(item => item.id === task.commonId);
  const reportingRun = isNext && common && validDate(startDate) ? { period: currentPeriod(common.frequency, new Date(`${startDate}T12:00:00+09:00`)) } : latest;
  const deadline = common ? commonDeadline(common, reportingRun) : undefined;
  const updateStart = (value: string) => {
    if (validDate(startDate) && validDate(value)) {
      const shift = Math.round((dayValue(value) - dayValue(startDate)) / 86_400_000);
      if (validDate(dueDate)) setDueDate(dayOffset(dueDate, shift));
      setSteps(items => items.map(item => ({ ...item, startDate: item.startDate ? dayOffset(item.startDate, shift) : '', dueDate: item.dueDate ? dayOffset(item.dueDate, shift) : '' })));
    }
    setStartDate(value); setError('');
  };
  function validate() {
    if (!title.trim()) return '회차 이름을 입력해 주세요.';
    if (!validDate(startDate) || !validDate(dueDate) || startDate > dueDate) return '회차 시작일과 종료일을 올바르게 입력해 주세요.';
    for (const step of steps) {
      const name = workflow.find(item => item.id === step.stepId)?.title || '절차';
      if ([step.startDate, step.dueDate].some(value => value && (!validDate(value) || value < startDate || value > dueDate))) return `‘${name}’의 일정은 회차 시작일과 종료일 사이로 입력해 주세요.`;
      if (step.startDate && step.dueDate && step.startDate > step.dueDate) return `‘${name}’의 종료일은 시작일 이후여야 합니다.`;
      const dependencies = workflow.find(item => item.id === step.stepId)?.dependsOn || [];
      if (dependencies.some(id => { const prior = steps.find(item => item.stepId === id); return prior?.dueDate && step.startDate && prior.dueDate > step.startDate; })) return `‘${name}’은 선행 절차가 끝난 뒤 시작하도록 일정을 설정해 주세요.`;
    }
    return '';
  }
  return <form className="wc-next-form" aria-label={isNext ? '다음 업무 회차 일정' : '현재 업무 회차 일정 등록'} onSubmit={async event => {
    event.preventDefault(); if (disabled || saving) return; const message = validate(); setError(message); if (message) return;
    setSaving(true);
    try {
      const saved = await command(isNext ? 'run.nextCycle' : 'run.schedule', { taskId: task.id, ...(latest ? isNext ? { previousRunId: latest.id } : { runId: latest.id } : {}), title: title.trim(), startDate, dueDate, scheduleDetails: scheduleDetails.trim(), steps: steps.map(step => ({ stepId: step.stepId, ...(step.startDate ? { startDate: step.startDate } : {}), ...(step.dueDate ? { dueDate: step.dueDate } : {}), scheduleDetails: step.scheduleDetails.trim() })) });
      if (saved) onClose(); else setError('일정을 저장하지 못했습니다. 표시된 안내와 현재 회차 상태를 확인해 주세요.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '일정을 저장하지 못했습니다.'); } finally { setSaving(false); }
  }}>
    <div className="wc-form-heading"><div><span>{isNext ? '새로운 업무 사이클' : '이번 업무 사이클'}</span><h3>{cycleNumber}회차 일정 등록</h3></div><button type="button" className="icon-btn" aria-label="일정 등록 닫기" disabled={saving} onClick={onClose}><X size={18} /></button></div>
    <p className="wc-form-description">{isNext ? '등록된 절차를 새 일정에 적용합니다. 완료 표시·체크리스트·결과물은 새로 시작하며 지난 회차의 기록은 보존합니다.' : '만들어진 절차별로 날짜와 이번 회차에서 수행할 세부 내용을 입력하세요. 저장한 날짜는 전체 일정에도 표시됩니다.'}</p>
    {deadline && <p className={validDate(dueDate) && dueDate > deadline ? "wc-warning" : "wc-note"} role="status">중앙 제출기한: {deadline}. {validDate(dueDate) && dueDate > deadline ? "내부 종료일이 중앙 제출기한을 넘습니다. 저장해도 제출기한은 연장되지 않고 중앙 기준으로 지연 표시됩니다." : "회차 일정을 수정해도 중앙 제출기한은 유지됩니다."}</p>}
    <fieldset disabled={saving || disabled} className="wc-form-fields">
    <div className="form-grid"><Field label="회차 이름" span><input required maxLength={150} value={title} onChange={event => setTitle(event.target.value)} /></Field><Field label="회차 시작일"><input type="date" required value={startDate} onChange={event => updateStart(event.target.value)} /></Field><Field label="회차 종료일"><input type="date" required min={startDate || undefined} value={dueDate} onChange={event => { setDueDate(event.target.value); setError(''); }} /></Field><Field label="이번 회차 세부 내용" span><textarea rows={3} maxLength={5000} value={scheduleDetails} placeholder="이번 회차의 목표, 대상, 제출 일정 등을 입력하세요." onChange={event => setScheduleDetails(event.target.value)} /></Field></div>
    <p className="wc-note"><CalendarDays size={14} />시작일을 바꾸면 이전 절차의 일정 간격을 유지해 함께 옮깁니다. 각 날짜를 개별 조정할 수 있습니다.</p>
    <div className="wc-date-steps">{workflow.map((step, index) => { const dates = steps.find(item => item.stepId === step.id)!; return <section key={step.id}><div><span>{String(index + 1).padStart(2, '0')}</span><div><h4>{step.title}</h4><small>{roleNames[step.role]}{step.dependsOn.length > 0 && ` · 선행: ${step.dependsOn.map(id => workflow.find(item => item.id === id)?.title).filter(Boolean).join(', ')}`}</small></div></div>{step.description && <p className="wc-step-description">{step.description}</p>}<div className="form-grid"><Field label={`${step.title} 시작일`}><input type="date" min={startDate || undefined} max={dueDate || undefined} value={dates.startDate} onChange={event => { setSteps(items => items.map(item => item.stepId === step.id ? { ...item, startDate: event.target.value } : item)); setError(''); }} /></Field><Field label={`${step.title} 종료일`}><input type="date" min={dates.startDate || startDate || undefined} max={dueDate || undefined} value={dates.dueDate} onChange={event => { setSteps(items => items.map(item => item.stepId === step.id ? { ...item, dueDate: event.target.value } : item)); setError(''); }} /></Field><Field label={`${step.title} 세부 내용`} span><textarea rows={3} maxLength={5000} value={dates.scheduleDetails} placeholder="담당 업무, 준비 자료, 회의 장소, 제출 방법 등을 입력하세요." onChange={event => setSteps(items => items.map(item => item.stepId === step.id ? { ...item, scheduleDetails: event.target.value } : item))} /></Field></div></section>; })}</div>
    </fieldset>
    <p className="wc-note">날짜를 비워 둔 절차는 일정 미정으로 시작합니다. 이전 회차의 날짜가 자동으로 남지 않습니다.</p>
    {error && <p role="alert" className="wc-error">{error}</p>}
    <div className="form-actions"><Button variant="secondary" disabled={saving} onClick={onClose}>취소</Button><Button type="submit" disabled={saving || disabled || !workflow.length}><CalendarDays size={15} />{saving ? '일정 저장 중…' : isNext ? '새 일정으로 회차 시작' : '일정 저장'}</Button></div>
  </form>;
}

function CurrentCycleSteps({ workspace: w, task, run, command, disabled }: { workspace: Workspace; task: Task; run?: Run; command: CommandFn; disabled: boolean }) {
  const workflow = run ? runWorkflow(task, run) : task.workflow;
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const reviewer = w.currentUser.id === (run?.reviewerId || task.reviewerId) || w.currentUser.role === 'admin' || w.currentUser.role === 'head' && w.currentUser.departmentId === task.departmentId;
  const assigned = [run?.primaryId || task.primaryId, ...(run?.supportIds || task.supportIds)].includes(w.currentUser.id);
  const delegated = (action: string) => canActAsDeputy(w, w.currentUser, task, action, new Date(w.serverTime));
  const permitted = (step: WorkflowStep, action: string) => step.role === 'reviewer' ? reviewer : assigned || (run ? delegated(action) : delegated('task.setProgress') || w.currentUser.role === 'admin');
  const locked = disabled || !!busy || run?.status === 'paused' || run?.status === 'completed';
  const done = (id: string) => run ? run.steps.find(step => step.stepId === id)?.status === 'completed' : !!workflow.find(step => step.id === id)?.done;
  async function perform(type: string, payload: Record<string, unknown>, stepId: string) {
    setBusy(stepId); setError('');
    try { if (!await command(type, payload)) setError('수행 내용을 저장하지 못했습니다. 안내 메시지와 현재 절차 상태를 확인해 주세요.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '수행 내용을 저장하지 못했습니다.'); }
    finally { setBusy(''); }
  }
  if (!workflow.length) return <p className="wc-readonly"><FileText size={16} />절차 탭에서 프로세스를 만들고 저장한 뒤 일정을 등록해 주세요.</p>;
  return <section className="wc-current" aria-label="현재 회차 절차 수행">
    <div className="wc-current-heading"><div><h3>일정에 따라 한 단계씩</h3><p>수행 내용을 확인하고 체크리스트와 결과를 기록하세요.</p></div><Badge tone="outline">{workflow.filter(step => done(step.id)).length} / {workflow.length} 완료</Badge></div>
    {!run && <p className="wc-note">일정을 등록하면 이번 회차의 체크리스트와 수행 결과를 함께 기록할 수 있습니다.</p>}
    {run?.status === 'paused' && <p className="wc-warning">일시 중지된 회차입니다. 현재 수행 상태를 변경할 수 없습니다.</p>}
    <div className="wc-history-steps wc-execution-steps">{workflow.map((step, index) => {
      const execution = run?.steps.find(item => item.stepId === step.id);
      const completed = done(step.id);
      const ready = step.dependsOn.every(done);
      const mayCheck = permitted(step, 'run.check');
      const mayComplete = permitted(step, 'run.completeStep');
      const output = outputs[step.id] ?? '';
      return <article key={step.id} className={completed ? 'is-complete' : ''}>
        <header><span className={completed ? 'wc-step-number done' : 'wc-step-number'}>{completed ? <Check size={16} /> : String(index + 1).padStart(2, '0')}</span><div><span>{roleNames[step.role]}</span><h4>{step.title}</h4></div><Badge tone={completed ? 'success' : ready ? 'info' : 'soft'}>{completed ? '완료' : ready ? '수행 가능' : '선행 절차 대기'}</Badge></header>
        <div className="wc-step-times"><span><CalendarDays size={14} />{step.startDate || step.dueDate ? `${displayDate(step.startDate)} — ${displayDate(step.dueDate)}` : '일정 미정'}</span>{completed && execution?.completedAt && <span><UserRound size={14} />{nameOf(w, execution.completedBy)} · {displayTime(execution.completedAt)}</span>}</div>
        {step.description && <p className="wc-step-description">{step.description}</p>}
        {step.scheduleDetails && <div className="wc-schedule-details"><strong>이번 일정의 세부 내용</strong><p>{step.scheduleDetails}</p></div>}
        {step.dependsOn.length > 0 && <p className="wc-step-dependencies"><ArrowRight size={13} />{step.dependsOn.map(id => workflow.find(item => item.id === id)?.title).filter(Boolean).join(', ')} 완료 후 수행</p>}
        {!!execution?.checklist.length && <div className="wc-execution-checklist" aria-label={`${step.title} 체크리스트`}>{execution.checklist.map(item => <label key={item.id}><input type="checkbox" checked={item.done} disabled={locked || completed || !ready || !mayCheck} onChange={event => void perform('run.check', { runId: run!.id, stepId: step.id, checkId: item.id, done: event.target.checked }, step.id)} /><span>{item.title}</span></label>)}</div>}
        {completed ? (execution?.output || step.output) && <div className="wc-output"><FileText size={16} /><div><span>{execution?.output ? '기록된 수행 결과' : '계획한 결과물'}</span><p>{execution?.output || step.output}</p></div></div> : <>
          {step.output && <p className="wc-planned-output"><FileText size={14} />예정 결과물: {step.output}</p>}
          {run && mayComplete && <Field label={`${step.title} 수행 결과`}><textarea rows={2} maxLength={5000} disabled={locked || !ready} value={output} placeholder="완료한 내용과 생산 문서 등을 기록하세요." onChange={event => setOutputs(items => ({ ...items, [step.id]: event.target.value }))} /></Field>}
          <div className="wc-step-actions">{mayComplete ? <><span>{!ready ? '선행 절차를 먼저 완료해 주세요.' : execution?.checklist.some(item => !item.done) ? '체크리스트를 모두 확인한 뒤 완료하세요.' : run && !output.trim() ? '수행 결과를 입력한 뒤 완료하세요.' : step.role === 'reviewer' ? '검토 결과를 확인하고 완료하세요.' : '수행한 내용을 확인하고 완료하세요.'}</span><Button variant="secondary" disabled={locked || !ready || !!execution?.checklist.some(item => !item.done) || !!run && !output.trim()} onClick={() => void perform(run ? 'run.completeStep' : 'task.setProgress', run ? { runId: run.id, stepId: step.id, output: output.trim() } : { taskId: task.id, stepId: step.id, done: true }, step.id)}><CheckCircle2 size={15} />{busy === step.id ? '저장 중…' : step.role === 'reviewer' ? '검토 완료' : '절차 완료'}</Button></> : <span>{step.role === 'reviewer' ? '지정된 검토자 또는 부서장이 완료합니다.' : '지정된 업무 담당자가 수행합니다.'}</span>}</div>
        </>}
      </article>;
    })}</div>
    {error && <p className="wc-error" role="alert">{error}</p>}
  </section>;
}

function CycleHistory({ workspace: w, task, run, number }: { workspace: Workspace; task: Task; run: Run; number: number }) {
  const workflow = runWorkflow(task, run);
  const completed = run.steps.filter(step => step.status === 'completed').length;
  return <section className="wc-history" aria-label={`${number}회차 지난 절차 기록`}>
    <div className="wc-history-heading"><span className="wc-history-symbol"><History size={22} /></span><div><p>지난 회차 · 기록 보기</p><h3>{number}회차 <Badge tone={run.status === 'completed' ? 'success' : 'soft'}>{statusNames[run.status]}</Badge></h3><span>{run.title}</span></div><strong>{completed}<small> / {run.steps.length} 절차</small></strong></div>
    <div className="wc-history-meta"><div><span>회차 일정</span><strong>{run.startDate ? `${displayDate(run.startDate)} — ` : ''}{displayDate(run.dueDate)}</strong></div><div><span>완료 시각</span><strong>{displayTime(run.completedAt)}</strong></div><div><span>당시 담당자</span><strong>{nameOf(w, run.primaryId)}</strong></div><div><span>당시 검토자</span><strong>{nameOf(w, run.reviewerId)}</strong></div></div>
    <p className="wc-readonly"><LockKeyhole size={15} />지난 회차의 절차·일정·수행 결과입니다. 현재 회차를 수정해도 이 기록은 바뀌지 않습니다.</p>
    {run.scheduleDetails && <div className="wc-schedule-details"><strong>회차 세부 내용</strong><p>{run.scheduleDetails}</p></div>}
    {!run.workflowSnapshot && <p className="wc-note">이전 버전의 회차는 연결된 업무 기준과 남아 있는 수행 기록으로 표시합니다. 기록되지 않은 날짜·완료자는 미지정으로 표시합니다.</p>}
    <ProcedureFlow workflow={workflow} />
    <div className="wc-history-steps">{workflow.map((step, index) => {
      const execution = run.steps.find(item => item.stepId === step.id);
      const done = execution?.status === 'completed';
      return <article key={step.id}><header><span className={done ? 'wc-step-number done' : 'wc-step-number'}>{done ? <Check size={16} /> : String(index + 1).padStart(2, '0')}</span><div><span>{roleNames[step.role]}</span><h4>{step.title}</h4></div><Badge tone={done ? 'success' : 'soft'}>{done ? '완료' : execution?.status === 'in_progress' ? '진행 중' : '대기'}</Badge></header>
        <div className="wc-step-times"><span><CalendarDays size={14} />{step.startDate || step.dueDate ? `${displayDate(step.startDate)} — ${displayDate(step.dueDate)}` : '절차 일정 미지정'}</span>{done && <span><UserRound size={14} />{nameOf(w, execution?.completedBy)} · {displayTime(execution?.completedAt)}</span>}</div>
        {step.description && <p className="wc-step-description">{step.description}</p>}
        {step.scheduleDetails && <div className="wc-schedule-details"><strong>일정 세부 내용</strong><p>{step.scheduleDetails}</p></div>}
        {step.dependsOn.length > 0 && <p className="wc-step-dependencies"><ArrowRight size={13} />{step.dependsOn.map(id => workflow.find(item => item.id === id)?.title).filter(Boolean).join(', ')} 완료 후 수행</p>}
        {!!execution?.checklist.length && <ul className="wc-checklist" aria-label={`${step.title} 체크리스트`}>{execution.checklist.map(item => <li key={item.id}><span className={item.done ? 'checked' : ''}>{item.done ? <Check size={12} /> : null}</span><div><strong>{item.title}</strong>{item.done && <small>{nameOf(w, item.completedBy)} · {displayTime(item.completedAt)}</small>}</div></li>)}</ul>}
        {(execution?.output || step.output) && <div className="wc-output"><FileText size={16} /><div><span>{execution?.output ? '기록된 수행 결과' : '계획한 결과물'}</span><p>{execution?.output || step.output}</p></div></div>}
      </article>;
    })}</div>
    {run.notes.length > 0 && <div className="wc-history-notes"><h4><FileText size={16} />회차 메모</h4>{run.notes.map(note => <article key={note.id}><header><strong>{nameOf(w, note.authorId)}</strong><time>{displayTime(note.createdAt)}</time></header>{note.stepId && <small>{workflow.find(step => step.id === note.stepId)?.title || run.steps.find(step => step.id === note.stepId)?.title || '연결된 절차'}</small>}<p>{note.body}</p></article>)}</div>}
  </section>;
}

'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, CalendarDays, LockKeyhole, Trophy } from 'lucide-react';
import type { Task, Workspace } from '@/lib/types';
import { currentPersonPerformances, getUnitEvaluation, getUnitScorePlan } from '@/lib/unit-evaluation';
import { currentHalf, halfYearOptions, isFutureHalf } from '@/lib/period';
import { Badge, Button, EmptyState, ReadField, type CommandFn } from './ui';
import { PerformanceEditor } from './unit-evaluation';
import { TaskFileAttachments } from './task-file-attachments';
import { useUnsavedNavigation } from './unsaved-changes';
import './task-performance.css';

export function TaskPerformance({ workspace: w, task, command, onGoPerformance, onBusyChange, preservedDraftIds = [] }: { workspace: Workspace; task: Task; command: CommandFn; onGoPerformance: () => void; onBusyChange?: (busy: boolean) => void; preservedDraftIds?: string[] }) {
  const now = new Date(w.serverTime);
  const periods = halfYearOptions(now, [...w.performances.map(item => item.period), ...(w.unitScorePlans || []).map(item => item.period), ...(w.unitEvaluations || []).map(item => item.period), ...(w.performanceSubmissionStatuses || []).map(item => item.period)]);
  const [period, setPeriod] = useState(() => currentHalf(now));
  const futurePeriod = isFutureHalf(period, now);
  const personId = task.primaryId;
  const plan = getUnitScorePlan(w, personId, period);
  const evaluation = getUnitEvaluation(w, personId, period);
  const performance = evaluation ? evaluation.performanceSnapshot.find(item => item.taskId === task.id) : currentPersonPerformances(w, personId, period).find(item => item.taskId === task.id);
  const distribution = task.commonId ? w.commonTasks.find(item => item.id === task.commonId)?.distributions.find(item => item.taskId === task.id) : undefined;
  const registered = !task.commonId || !!distribution && ['registered', 'assigned', 'submitted'].includes(distribution.status);
  const canWrite = !futurePeriod && personId === w.currentUser.id && w.currentUser.role !== 'head' && task.status !== 'archived' && !task.deletedAt && registered && !evaluation && !plan?.submittedAt && performance?.status !== 'confirmed';
  const [editorPeriod, setEditorPeriod] = useState<string | null>(canWrite ? period : null);
  useEffect(() => { if (canWrite) setEditorPeriod(period); }, [canWrite, period]);
  const years = [...new Set(periods.map(value => value.slice(0, 4)))].sort();
  const unavailableHalves = ['H1', 'H2'].map(half => `${period.slice(0, 4)}-${half}`).filter(value => !periods.includes(value));
  const { requestNavigation } = useUnsavedNavigation();
  const changePeriod = (value: string) => { if (value !== period && periods.includes(value)) requestNavigation(() => setPeriod(value), undefined, preservedDraftIds); };
  const changeYear = (year: string) => changePeriod(periods.find(value => value === `${year}-${period.slice(5)}`) || periods.find(value => value.startsWith(`${year}-`)) || currentHalf(now));

  return <section className="tp-view" aria-label="세부업무 업무 성과">
    <div className="pw-section-intro"><div><h3><Trophy size={18} />업무 성과</h3><p>이 세부업무의 성과를 500자 이내로 정리하고 참고 파일을 첨부하세요.</p></div><Badge tone={evaluation ? 'success' : plan?.submittedAt ? 'info' : 'soft'}>{evaluation ? '평가 완료' : plan?.submittedAt ? '제출 완료 · 평가 대기' : performance ? '저장 완료 · 제출 전' : '미작성'}</Badge></div>
    <div className="tp-period"><CalendarDays size={17} /><label><span>성과 연도</span><select aria-label="업무 성과 연도" value={period.slice(0, 4)} onChange={event => changeYear(event.target.value)}>{years.map(value => <option key={value} value={value}>{value}년</option>)}</select></label><label><span>반기</span><select aria-label="업무 성과 반기" value={period.slice(5)} onChange={event => changePeriod(`${period.slice(0, 4)}-${event.target.value}`)}><option value="H1" disabled={!periods.includes(`${period.slice(0, 4)}-H1`)}>상반기 (1–6월)</option><option value="H2" disabled={!periods.includes(`${period.slice(0, 4)}-H2`)}>하반기 (7–12월)</option></select></label></div>
    {unavailableHalves.some(value => isFutureHalf(value, now)) && <p className="tp-locked">아직 시작하지 않은 반기는 선택할 수 없습니다. 기존 기록이 있는 반기는 조회만 가능합니다.</p>}
    {unavailableHalves.some(value => !isFutureHalf(value, now)) && <p className="tp-locked">최근 2년보다 오래된 연도는 기존 기록이 있는 반기만 조회할 수 있습니다.</p>}
    {futurePeriod && <p className="tp-locked" role="status"><LockKeyhole size={16} />아직 시작하지 않은 반기입니다. 기존 기록은 조회할 수 있지만 성과와 업무 비중의 저장·제출은 반기가 시작된 후 가능합니다.</p>}
    {!futurePeriod && (evaluation || plan?.submittedAt) && <p className="tp-locked"><LockKeyhole size={16} />{evaluation ? '평가가 확정되어 성과를 수정할 수 없습니다.' : '제출된 성과입니다. 수정하려면 성과 · 평가에서 제출 회수를 눌러 주세요.'}</p>}
    {canWrite || editorPeriod === period ? <PerformanceEditor key={`${task.id}-${period}`} workspace={w} command={command} period={period} existing={performance} fixedTaskId={task.id} embedded readOnly={!canWrite} onClose={() => undefined} onBusyChange={onBusyChange} /> : performance ? <article className="tp-record"><ReadField label="성과 내용" value={performance.description}/><TaskFileAttachments workspace={w} taskId={task.id} performanceId={performance.id} attachmentIds={performance.attachmentIds || []} label="성과 참고 파일"/>{performance.metricName && performance.value !== undefined && <div className="tp-metric"><span>{performance.metricName}</span><strong>{performance.value.toLocaleString('ko-KR')} {performance.unit}</strong></div>}{performance.evidence && <details className="ue-legacy-evidence"><summary>이전에 작성한 근거 보기</summary><ReadField label="기존 근거" value={performance.evidence}/></details>}</article> : <EmptyState title="아직 작성된 업무 성과가 없습니다." description={!registered ? '개인 단위업무에 등록한 뒤 성과를 입력할 수 있습니다.' : personId !== w.currentUser.id ? '세부업무 담당자가 작성한 성과가 여기에 표시됩니다.' : '이 업무의 성과를 작성할 수 있는 상태가 아닙니다.'} />}
    <div className="tp-next"><div><strong>{w.units.find(unit => unit.id === (performance?.unitId || task.unitId))?.title || '소속 단위업무'}에 모아집니다.</strong><p>저장한 성과는 성과 · 평가에서 확인하고 제출할 수 있습니다.</p></div><Button variant="secondary" onClick={onGoPerformance}>성과 · 평가<ArrowRight size={15} /></Button></div>
  </section>;
}

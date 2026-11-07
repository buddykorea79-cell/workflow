'use client';

import { useState } from 'react';
import { ArrowRight, CalendarDays, FileText, LockKeyhole, Trophy } from 'lucide-react';
import type { Task, Workspace } from '@/lib/types';
import { currentPersonPerformances, getUnitEvaluation, getUnitScorePlan } from '@/lib/unit-evaluation';
import { Badge, Button, EmptyState, type CommandFn } from './ui';
import { PerformanceEditor } from './unit-evaluation';
import { TaskFileAttachments } from './task-file-attachments';
import './task-performance.css';

export function TaskPerformance({ workspace: w, task, command, onGoPerformance, onBusyChange }: { workspace: Workspace; task: Task; command: CommandFn; onGoPerformance: () => void; onBusyChange?: (busy: boolean) => void }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(w.serverTime));
  const year = Number(today.slice(0, 4));
  const [period, setPeriod] = useState(`${year}-H${Number(today.slice(5, 7)) <= 6 ? 1 : 2}`);
  const [busy, setBusy] = useState(false);
  const updateBusy = (value: boolean) => { setBusy(value); onBusyChange?.(value); };
  const personId = task.primaryId;
  const plan = getUnitScorePlan(w, personId, period);
  const evaluation = getUnitEvaluation(w, personId, period);
  const performance = evaluation ? evaluation.performanceSnapshot.find(item => item.taskId === task.id) : currentPersonPerformances(w, personId, period).find(item => item.taskId === task.id);
  const distribution = task.commonId ? w.commonTasks.find(item => item.id === task.commonId)?.distributions.find(item => item.taskId === task.id) : undefined;
  const registered = !task.commonId || !!distribution && ['registered', 'assigned', 'submitted'].includes(distribution.status);
  const canWrite = personId === w.currentUser.id && w.currentUser.role !== 'head' && task.status !== 'archived' && !task.deletedAt && registered && !evaluation && !plan?.submittedAt && performance?.status !== 'confirmed';
  const years = [...new Set([year - 2, year - 1, year, year + 1, ...w.performances.filter(item => item.taskId === task.id && item.period).map(item => Number(item.period!.slice(0, 4)))])].sort((a, b) => a - b);
  const changePeriod = (value: string) => setPeriod(value);

  return <section className="tp-view" aria-label="세부업무 업무 성과">
    <div className="pw-section-intro"><div><h3><Trophy size={18} />업무 성과</h3><p>이 세부업무의 성과를 500자 이내로 정리하고 참고 파일을 첨부하세요.</p></div><Badge tone={evaluation ? 'success' : plan?.submittedAt ? 'info' : 'soft'}>{evaluation ? '평가 완료' : plan?.submittedAt ? '제출 완료 · 평가 대기' : performance ? '저장 완료 · 제출 전' : '미작성'}</Badge></div>
    <div className="tp-period"><CalendarDays size={17} /><label><span>성과 연도</span><select disabled={busy} aria-label="업무 성과 연도" value={period.slice(0, 4)} onChange={event => changePeriod(`${event.target.value}-${period.slice(5)}`)}>{years.map(value => <option key={value} value={value}>{value}년</option>)}</select></label><label><span>반기</span><select disabled={busy} aria-label="업무 성과 반기" value={period.slice(5)} onChange={event => changePeriod(`${period.slice(0, 4)}-${event.target.value}`)}><option value="H1">상반기 (1–6월)</option><option value="H2">하반기 (7–12월)</option></select></label></div>
    {(evaluation || plan?.submittedAt) && <p className="tp-locked"><LockKeyhole size={16} />{evaluation ? '평가가 확정되어 성과를 수정할 수 없습니다.' : '제출된 성과입니다. 수정하려면 성과 · 평가에서 제출 회수를 눌러 주세요.'}</p>}
    {canWrite ? <PerformanceEditor key={`${task.id}-${period}`} workspace={w} command={command} period={period} existing={performance} fixedTaskId={task.id} embedded onClose={() => undefined} onBusyChange={updateBusy} /> : performance ? <article className="tp-record"><h4><FileText size={17} />성과 내용</h4><p>{performance.description}</p><TaskFileAttachments workspace={w} taskId={task.id} attachmentIds={performance.attachmentIds || []} label="성과 참고 파일"/>{performance.metricName && performance.value !== undefined && <div className="tp-metric"><span>{performance.metricName}</span><strong>{performance.value.toLocaleString('ko-KR')} {performance.unit}</strong></div>}{performance.evidence && <details className="ue-legacy-evidence"><summary>이전에 작성한 근거 보기</summary><p>{performance.evidence}</p></details>}</article> : <EmptyState title="아직 작성된 업무 성과가 없습니다." description={!registered ? '개인 단위업무에 등록한 뒤 성과를 입력할 수 있습니다.' : personId !== w.currentUser.id ? '세부업무 담당자가 작성한 성과가 여기에 표시됩니다.' : '이 업무의 성과를 작성할 수 있는 상태가 아닙니다.'} />}
    <div className="tp-next"><div><strong>{w.units.find(unit => unit.id === (performance?.unitId || task.unitId))?.title || '소속 단위업무'}에 모아집니다.</strong><p>저장한 성과는 성과 · 평가에서 확인하고 제출할 수 있습니다.</p></div><Button variant="secondary" disabled={busy} onClick={onGoPerformance}>성과 · 평가<ArrowRight size={15} /></Button></div>
  </section>;
}

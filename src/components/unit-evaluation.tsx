'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, CalendarDays, CheckCheck, CheckCircle2, ChevronRight, ClipboardCheck, FileText, FolderOpen, LockKeyhole, Pencil, Plus, Save, Search, Send, ShieldCheck, SlidersHorizontal, Undo2, Users } from 'lucide-react';
import type { Performance, UnitScorePlan, User, Workspace } from '@/lib/types';
import { canEvaluateUnitPerformance, currentPersonPerformances, eligibleScoreUnits, scoreUnitsForPeriod, getUnitEvaluation, getUnitScorePlan, hasCompletePerformance, missingPerformanceUnitIds, personUnitPerformanceSummary, validateWeights } from '@/lib/unit-evaluation';
import { currentHalf, halfYearOptions, isFutureHalf } from '@/lib/period';
import { formatDateFull, formatDateTimeFull as dateText } from '@/lib/date-format';
import { Badge, Button, EmptyState, Field, HelpButton, HelpCallout, Modal, ReadField, useHelpControls, type CommandFn, type HelpControls } from './ui';
import { TaskFileAttachments } from './task-file-attachments';
import { useUnsavedChanges, useUnsavedNavigation } from './unsaved-changes';
import { useRevisionCommand } from './command-revision';
import './unit-evaluation.css';

type Props = { workspace: Workspace; command: CommandFn; onOpenTask: (id: string) => void; initialSelection?: { personId?: string; period?: string } };
type Summary = ReturnType<typeof personUnitPerformanceSummary>;
const statusLabels: Record<Performance['status'], string> = { draft: '작성 완료 · 제출 전', review: '제출 완료', confirmed: '확인 완료', changes_requested: '보완 요청' };
const periodName = (value: string) => `${value.slice(0, 4)}년 ${value.endsWith('H1') ? '상반기' : '하반기'}`;
const scoreText = (value: number) => Number(value.toFixed(2)).toLocaleString('ko-KR');
const personName = (w: Workspace, id: string) => w.users.find(user => user.id === id)?.name || w.identities?.find(user => user.id === id)?.name || '담당자';
function performancePeople(w: Workspace): User[] {
  const people = [...w.users];
  for (const identity of w.identities ?? []) if (!people.some(person => person.id === identity.id)) people.push({ ...identity, initials: identity.name.slice(0, 1), role: 'member', title: '전출 직원', active: false, color: '#64748b' });
  return people;
}
const isRegistered = (w: Workspace, taskId: string, commonId?: string) => !commonId || !!w.commonTasks.find(common => common.id === commonId)?.distributions.some(item => item.taskId === taskId && ['registered', 'assigned', 'submitted'].includes(item.status));
const activeTasks = (w: Workspace, personId: string) => w.tasks.filter(task => task.primaryId === personId && !task.deletedAt && task.status !== 'archived' && w.units.some(unit => unit.id === task.unitId && !unit.deletedAt) && isRegistered(w, task.id, task.commonId));

function useMountedEditor() {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return mounted;
}

function metrics(items: Performance[]) {
  const groups = new Map<string, { name: string; unit: string; values: number[]; additive: boolean }>();
  for (const item of items) {
    if (!item.metricName || item.value === undefined || !Number.isFinite(item.value)) continue;
    const name = item.metricName.trim(), unit = (item.unit || '').trim();
    const key = `${name}\u0000${unit}`;
    const additive = !!unit && unit !== '점' && !/[%％]|퍼센트|백분율|비율|평균|점수|평점/.test(`${name} ${unit}`);
    const group = groups.get(key) || { name, unit, values: [], additive };
    group.values.push(item.value); groups.set(key, group);
  }
  return [...groups.values()];
}

export function PerformanceView({ workspace: w, command, onOpenTask, initialSelection }: Props) {
  const help = useHelpControls(w.currentUser.id);
  const now = new Date(w.serverTime);
  const periods = halfYearOptions(now, [...w.performances.map(item => item.period), ...(w.unitScorePlans || []).map(item => item.period), ...(w.unitEvaluations || []).map(item => item.period), ...(w.performanceSubmissionStatuses || []).map(item => item.period)]);
  const [period, setPeriod] = useState(initialSelection?.period && periods.includes(initialSelection.period) ? initialSelection.period : currentHalf(now));
  const futurePeriod = isFutureHalf(period, now);
  const [departmentId, setDepartmentId] = useState(w.currentUser.role === 'admin' && initialSelection?.personId ? w.unitScorePlans?.find(plan => plan.personId === initialSelection.personId && plan.period === initialSelection.period)?.departmentId || w.currentUser.departmentId : w.currentUser.departmentId);
  const [selectedPerson, setSelectedPerson] = useState(initialSelection?.personId || '');
  const [query, setQuery] = useState('');
  const [team, setTeam] = useState('all');
  const [editing, setEditing] = useState<Performance | 'new' | null>(null);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const { requestNavigation } = useUnsavedNavigation();
  const changePeriod = (value: string) => { if (value !== period && periods.includes(value)) requestNavigation(() => { setPeriod(value); setEditing(null); setWeightsOpen(false); }); };
  const changeYear = (year: string) => changePeriod(periods.find(value => value === `${year}-${period.slice(5)}`) || periods.find(value => value.startsWith(`${year}-`)) || currentHalf(now));
  const changeFilter = (action: () => void) => requestNavigation(() => { action(); setSelectionRevision(value => value + 1); });
  const changeDepartment = (value: string) => { if (value !== departmentId) changeFilter(() => { setDepartmentId(value); setSelectedPerson(''); setTeam('all'); }); };
  const changeQuery = (value: string) => { if (value !== query) changeFilter(() => setQuery(value)); };
  const changeTeam = (value: string) => { if (value !== team) changeFilter(() => setTeam(value)); };
  const user = w.currentUser;
  const isReviewer = user.role === 'head' || user.role === 'admin';
  const scopeDepartment = user.role === 'admin' ? departmentId : user.departmentId;
  const hasHistoricalEvaluation = (personId: string) => (w.unitScorePlans ?? []).some(plan => plan.personId === personId && plan.period === period && plan.departmentId === scopeDepartment) || (w.unitEvaluations ?? []).some(evaluation => evaluation.personId === personId && evaluation.period === period && evaluation.departmentId === scopeDepartment) || w.performances.some(item => item.authorId === personId && item.period === period && item.departmentId === scopeDepartment);
  const people = isReviewer ? performancePeople(w).filter(person => hasHistoricalEvaluation(person.id) || person.departmentId === scopeDepartment && !['head', 'admin'].includes(person.role) && person.active).sort((a, b) => a.team.localeCompare(b.team, 'ko') || a.name.localeCompare(b.name, 'ko')) : [user];
  const teams = [...new Set(people.map(person => person.team))];
  const filteredPeople = people.filter(person => (team === 'all' || person.team === team) && `${person.name} ${person.team}`.toLowerCase().includes(query.trim().toLowerCase()));
  const person = filteredPeople.find(item => item.id === selectedPerson) || filteredPeople.find(item => currentPersonPerformances(w, item.id, period).length > 0) || filteredPeople.find(item => eligibleScoreUnits(w, item.id).length > 0) || filteredPeople[0];
  const changePerson = (value: string) => { if (value !== person?.id) requestNavigation(() => setSelectedPerson(value)); };
  const summaries = people.map(person => personUnitPerformanceSummary(w, person.id, period));
  const summary = person ? personUnitPerformanceSummary(w, person.id, period) : undefined;
  const ownEvaluation = getUnitEvaluation(w, user.id, period);
  const ownPlan = getUnitScorePlan(w, user.id, period);
  const ownTasks = activeTasks(w, user.id).filter(task => !ownPlan || task.departmentId === ownPlan.departmentId);
  const canEdit = !futurePeriod && !isReviewer && !ownEvaluation && !ownPlan?.submittedAt && ownTasks.length > 0;
  const ownUnits = scoreUnitsForPeriod(w, user.id, period);
  const totalPerformanceCount = summaries.reduce((sum, item) => sum + item.performances.length, 0);
  const evaluated = summaries.filter(item => item.evaluation).length;
  const ready = summaries.filter(item => canEvaluateUnitPerformance(w, user, item.personId, period, now)).length;
  const years = [...new Set(periods.map(value => value.slice(0, 4)))].sort();
  const unavailableHalves = ['H1', 'H2'].map(half => `${period.slice(0, 4)}-${half}`).filter(value => !periods.includes(value));

  return <div className="ue-view">
    <div className="page-heading"><div><p className="eyebrow">성과와 평가</p><div className="help-title"><h1>{isReviewer ? '개인별 성과와 평가' : '나의 성과와 평가'}</h1><HelpButton controls={help} label="성과·평가 도움말 다시 보기" /></div><p>세부업무의 성과를 단위업무별로 모아 보고, 업무 비중을 정해 부서장에게 제출합니다.</p></div><div className="ue-heading-actions">{!isReviewer && ownUnits.length > 0 && <Button variant="secondary" disabled={futurePeriod || !!ownEvaluation || !!ownPlan?.submittedAt} onClick={() => { if (!futurePeriod) setWeightsOpen(true); }}><SlidersHorizontal size={16} />업무 비중 설정</Button>}{canEdit && <Button onClick={() => setEditing('new')}><Plus size={17} />반기 성과 입력</Button>}</div></div>
    <div className="ue-period-bar"><span><CalendarDays size={18} />평가 기간</span><select aria-label="성과 평가 연도" value={period.slice(0, 4)} onChange={event => changeYear(event.target.value)}>{years.map(value => <option key={value} value={value}>{value}년</option>)}</select><div className="tabs" role="group" aria-label="성과 평가 반기"><button type="button" className={period.endsWith('H1') ? 'active' : ''} aria-pressed={period.endsWith('H1')} disabled={!periods.includes(`${period.slice(0, 4)}-H1`)} onClick={() => changePeriod(`${period.slice(0, 4)}-H1`)}>상반기 <small>01–06월</small></button><button type="button" className={period.endsWith('H2') ? 'active' : ''} aria-pressed={period.endsWith('H2')} disabled={!periods.includes(`${period.slice(0, 4)}-H2`)} onClick={() => changePeriod(`${period.slice(0, 4)}-H2`)}>하반기 <small>07–12월</small></button></div>{user.role === 'admin' && <select aria-label="성과 평가 부서" value={scopeDepartment} onChange={event => changeDepartment(event.target.value)}>{w.departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</select>}<Badge tone="info">업무 비중 합계 50점</Badge></div>
    {unavailableHalves.some(value => isFutureHalf(value, now)) && <p className="ue-validation">아직 시작하지 않은 반기는 선택할 수 없습니다. 기존 기록이 있는 반기는 조회만 가능합니다.</p>}
    {unavailableHalves.some(value => !isFutureHalf(value, now)) && <p className="ue-validation">최근 2년보다 오래된 연도는 기존 기록이 있는 반기만 조회할 수 있습니다.</p>}
    {futurePeriod && <div className="ue-notice ue-notice-warning" role="status"><LockKeyhole size={18} /><div><strong>아직 시작하지 않은 반기입니다.</strong><p>기존 성과와 업무 비중은 조회할 수 있지만 저장·제출은 반기가 시작된 후 가능합니다. 이미 제출한 기록의 회수와 부서장 평가는 가능합니다.</p></div></div>}
    <HelpCallout controls={help} id="performance.process" summary="성과를 작성하고 업무 비중 50점을 정해 제출하세요."><p>세부업무의 성과 탭에서 저장한 내용이 단위업무별로 모입니다. 업무 비중과 성과를 확인해 제출하면 부서장이 평가합니다.</p></HelpCallout>
    {user.role === 'manager' && <SubmissionStatusPanel workspace={w} period={period} />}
    {isReviewer && <section className="ue-stats" aria-label="개인별 평가 요약"><div><span>평가 대상</span><strong>{people.length}<small>명</small></strong></div><div><span>등록된 성과</span><strong>{totalPerformanceCount}<small>건</small></strong></div><div><span>제출 완료 · 평가 대기</span><strong>{ready}<small>명</small></strong></div><div><span>평가 완료</span><strong>{evaluated}<small>명</small></strong></div></section>}
    <div className={`ue-layout ${isReviewer ? 'ue-with-people' : ''}`}>
      {isReviewer && <aside className="ue-people" aria-label="평가 대상 직원"><header><h2><Users size={17} />직원별 성과</h2><span>{filteredPeople.length}명</span></header><div className="ue-people-filters"><label><Search size={15} /><input aria-label="평가 대상 이름 검색" placeholder="이름·팀 검색" value={query} onChange={event => changeQuery(event.target.value)} /></label><select aria-label="평가 대상 팀" value={team} onChange={event => changeTeam(event.target.value)}><option value="all">모든 팀</option>{teams.map(value => <option key={value}>{value}</option>)}</select></div><div className="ue-person-list">{filteredPeople.map(item => { const data = personUnitPerformanceSummary(w, item.id, period); return <button key={item.id} className={person?.id === item.id ? 'selected' : ''} aria-pressed={person?.id === item.id} onClick={() => changePerson(item.id)}><span className="ue-avatar">{item.name.slice(0, 1)}</span><span><strong>{item.name}<small>{item.title}</small></strong><em>{item.team}</em><span>{data.units.length}개 단위업무 · 성과 {data.performances.length}건</span><b className={data.evaluation ? 'ue-complete' : ''}>{data.evaluation ? `${scoreText(data.totalScore || 0)} / 50점 · 평가 완료` : data.plan?.submittedAt ? '제출 완료 · 평가 대기' : data.plan ? '업무 비중 설정 · 미제출' : '업무 비중 미설정 · 미제출'}</b></span><ChevronRight size={15} /></button>; })}</div>{!filteredPeople.length && <p className="ue-small-empty">조건에 맞는 직원이 없습니다.</p>}</aside>}
      {person && summary ? <PersonPerformance key={`${person.id}-${period}-${selectionRevision}`} workspace={w} command={command} onOpenTask={onOpenTask} person={person} period={period} summary={summary} isReviewer={isReviewer} help={help} onWeights={() => { if (!futurePeriod) setWeightsOpen(true); }} onEdit={item => { if (!futurePeriod) setEditing(item); }} /> : <EmptyState title="표시할 직원이 없습니다." description="검색어나 팀을 변경해 확인해 주세요." />}
    </div>
    {weightsOpen && <WeightEditor key={period} workspace={w} command={command} period={period} plan={ownPlan} onClose={() => setWeightsOpen(false)} />}
    {editing && <PerformanceEditor key={`${period}-${editing === 'new' ? 'new' : editing.id}`} workspace={w} command={command} period={period} existing={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
  </div>;
}

function SubmissionStatusPanel({ workspace: w, period }: { workspace: Workspace; period: string }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const statuses = (w.performanceSubmissionStatuses || []).filter(item => item.period === period && item.departmentId === w.currentUser.departmentId);
  const members = w.users.filter(person => person.departmentId === w.currentUser.departmentId && !['head', 'admin'].includes(person.role) && (person.active || statuses.some(item => item.personId === person.id))).sort((a, b) => a.team.localeCompare(b.team, 'ko') || a.name.localeCompare(b.name, 'ko'));
  const rows = members.map(person => ({ person, submission: statuses.find(item => item.personId === person.id) }));
  const submittedCount = rows.filter(row => row.submission?.status === 'submitted').length;
  const evaluatedCount = rows.filter(row => row.submission?.status === 'evaluated').length;
  const visible = rows.filter(row => (status === 'all' || (row.submission?.status || 'not_submitted') === status) && `${row.person.name} ${row.person.team}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="ue-submission-status" aria-label="부서 성과 제출 현황">
    <header><div><h2><Users size={19} />부서 성과 제출 현황</h2><p>{periodName(period)} · 부서 담당자는 직원별 제출 여부와 평가 진행 상태를 확인할 수 있습니다.</p></div><Badge tone="outline">현황 조회</Badge></header>
    <div className="ue-stats"><div><span>대상 직원</span><strong>{rows.length}<small>명</small></strong></div><div><span>미제출</span><strong>{rows.length - submittedCount - evaluatedCount}<small>명</small></strong></div><div><span>제출 완료 · 평가 대기</span><strong>{submittedCount}<small>명</small></strong></div><div><span>평가 완료</span><strong>{evaluatedCount}<small>명</small></strong></div></div>
    <div className="ue-status-filters"><label><Search size={16} /><input aria-label="제출 현황 이름 또는 팀 검색" placeholder="이름·팀 검색" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="제출 상태 필터" value={status} onChange={event => setStatus(event.target.value)}><option value="all">모든 상태</option><option value="not_submitted">미제출</option><option value="submitted">제출 완료</option><option value="evaluated">평가 완료</option></select></div>
    <div className="ue-status-table-wrap"><table className="ue-status-table"><thead><tr><th>직원</th><th>소속 팀</th><th>제출 여부</th><th>제출 일시</th><th>평가 일시</th></tr></thead><tbody>{visible.map(({ person, submission }) => <tr key={person.id}><td><strong>{person.name}</strong><small>{person.title}</small></td><td>{person.team}</td><td><Badge tone={submission?.status === 'evaluated' ? 'success' : submission?.status === 'submitted' ? 'info' : 'soft'}>{submission?.status === 'evaluated' ? '평가 완료' : submission?.status === 'submitted' ? '제출 완료' : '미제출'}</Badge></td><td>{submission?.submittedAt ? dateText(submission.submittedAt) : '—'}</td><td>{submission?.evaluatedAt ? dateText(submission.evaluatedAt) : '—'}</td></tr>)}</tbody></table></div>
    {!visible.length && <p className="ue-small-empty">조건에 맞는 직원이 없습니다.</p>}
  </section>;
}

function PersonPerformance({ workspace: w, command, onOpenTask, person, period, summary, isReviewer, help, onWeights, onEdit }: Props & { person: User; period: string; summary: Summary; isReviewer: boolean; help: HelpControls; onWeights: () => void; onEdit: (item: Performance) => void }) {
  const mounted = useMountedEditor();
  const futurePeriod = isFutureHalf(period, new Date(w.serverTime));
  const revision = useRevisionCommand(w, command, { kind: 'plan', id: JSON.stringify([person.id, period]) });
  const [scores, setScores] = useState<Record<string, string>>(() => Object.fromEntries(summary.units.map(unit => [unit.unitId, unit.score === undefined ? unit.performances.some(item => ['review', 'confirmed'].includes(item.status)) ? '' : '0' : String(unit.score)])));
  const [comments, setComments] = useState<Record<string, string>>(() => Object.fromEntries(summary.units.map(unit => [unit.unitId, unit.comment || ''])));
  const [comment, setComment] = useState(summary.evaluation?.comment || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { plan, evaluation } = summary;
  const submitted = !!plan?.submittedAt;
  const self = person.id === w.currentUser.id;
  const currentUnits = scoreUnitsForPeriod(w, person.id, period);
  const evaluationDepartment = plan?.departmentId ?? summary.performances[0]?.departmentId ?? person.departmentId;
  const stalePlan = !!plan && !submitted && !evaluation && (plan.allocations.length !== currentUnits.length || currentUnits.some(unit => !plan.allocations.some(item => item.unitId === unit.id)));
  const ratedUnits = summary.units.filter(unit => plan?.allocations.some(allocation => allocation.unitId === unit.unitId));
  const ratedPerformances = ratedUnits.flatMap(unit => unit.performances);
  const needsChanges = summary.performances.some(item => item.departmentId === evaluationDepartment && item.status === 'changes_requested');
  const hasEvidence = ratedPerformances.some(item => ['review', 'confirmed'].includes(item.status));
  const canEvaluate = isReviewer && canEvaluateUnitPerformance(w, w.currentUser, person.id, period, new Date(w.serverTime));
  const evaluationDraft = JSON.stringify({ scores, comments, comment });
  const evaluationDraftRef = useRef(evaluationDraft); evaluationDraftRef.current = evaluationDraft;
  const [savedEvaluationDraft, setSavedEvaluationDraft] = useState(evaluationDraft);
  const savedEvaluationDraftRef = useRef(savedEvaluationDraft); savedEvaluationDraftRef.current = savedEvaluationDraft;
  const serverEvaluationDraft = JSON.stringify({
    scores: Object.fromEntries(summary.units.map(unit => [unit.unitId, unit.score === undefined ? unit.performances.some(item => ['review', 'confirmed'].includes(item.status)) ? '' : '0' : String(unit.score)])),
    comments: Object.fromEntries(summary.units.map(unit => [unit.unitId, unit.comment || ''])),
    comment: summary.evaluation?.comment || '',
  });
  useEffect(() => {
    if (evaluationDraftRef.current !== savedEvaluationDraftRef.current) return;
    const incoming = JSON.parse(serverEvaluationDraft) as { scores: Record<string, string>; comments: Record<string, string>; comment: string };
    setScores(incoming.scores); setComments(incoming.comments); setComment(incoming.comment);
    setSavedEvaluationDraft(serverEvaluationDraft);
  }, [serverEvaluationDraft]);
  const hasEvaluationDraft = isReviewer && evaluationDraft !== savedEvaluationDraft;
  useUnsavedChanges(hasEvaluationDraft, '직원 평가 점수·의견');
  const missingUnitIds = missingPerformanceUnitIds(w, plan?.allocations || [], summary.performances, evaluationDepartment);
  const incompleteUnits = ratedUnits.filter(unit => missingUnitIds.includes(unit.unitId));
  const incompleteRecords = summary.performances.filter(item => item.departmentId === evaluationDepartment && !hasCompletePerformance(item));
  const canSubmit = !futurePeriod && self && !isReviewer && !!plan && !submitted && !evaluation && !stalePlan && summary.totalMaxScore === 50 && incompleteUnits.length === 0 && incompleteRecords.length === 0 && ratedPerformances.length > 0 && !needsChanges;
  const allValid = ratedUnits.length > 0 && ratedUnits.every(unit => scores[unit.unitId] !== '' && Number.isFinite(Number(scores[unit.unitId])) && Number(scores[unit.unitId]) >= 0 && Number(scores[unit.unitId]) <= (unit.maxScore || 0) && Math.abs(Number(scores[unit.unitId]) * 100 - Math.round(Number(scores[unit.unitId]) * 100)) < 0.000001);
  const scoreTotal = ratedUnits.reduce((sum, unit) => sum + (Number(scores[unit.unitId]) || 0), 0);
  const displayedTotal = evaluation ? summary.totalScore || 0 : scoreTotal;
  const changeSubmission = async (withdraw: boolean) => {
    if (!plan || saving || revision.conflicted || (withdraw ? !self || !submitted || !!evaluation : !canSubmit)) return;
    setSaving(true); setError('');
    try {
      const saved = await revision.command(withdraw ? 'performance.withdrawSubmission' : 'performance.submitPerson', { period, ...(withdraw ? {} : { planVersion: plan.version }) });
      if (!saved) setError(withdraw ? '제출을 회수하지 못했습니다. 안내 메시지를 확인해 주세요.' : '성과를 제출하지 못했습니다. 안내 메시지를 확인해 주세요.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '제출 상태를 변경하지 못했습니다.'); }
    finally { setSaving(false); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!canEvaluate || !allValid || !plan || saving || revision.conflicted) return;
    const submittedDraft = evaluationDraft;
    setSaving(true); setError('');
    try { const saved = await revision.command('performance.evaluatePerson', { personId: person.id, period, planVersion: plan.version, scores: ratedUnits.map(unit => ({ unitId: unit.unitId, score: Number(scores[unit.unitId]), comment: comments[unit.unitId] || '' })), comment }, { onSaved: () => { if (mounted.current) { savedEvaluationDraftRef.current = submittedDraft; setSavedEvaluationDraft(submittedDraft); } } }); if (!saved && mounted.current) setError('평가를 저장하지 못했습니다. 안내 메시지를 확인해 주세요.'); }
    catch (error) { setError(error instanceof Error ? error.message : '평가를 저장하지 못했습니다.'); }
    finally { if (mounted.current) setSaving(false); }
  };
  return <section className="ue-person-detail" aria-label={`${person.name} 성과 상세`}>
    {revision.conflict}
    {!canEvaluate && hasEvaluationDraft && <div className="ue-notice ue-notice-warning"><div><strong>확정 요청 뒤 추가로 작성한 내용이 남아 있습니다.</strong><p>확정된 평가에는 요청 당시의 내용이 반영되었습니다. 아래 내용은 저장되지 않았으며 복사해서 보관할 수 있습니다.</p><Field label="저장되지 않은 평가 초안"><textarea readOnly rows={6} value={[...summary.units.map(unit => `${unit.unitTitle}: ${scores[unit.unitId] || '미입력'}점${comments[unit.unitId] ? ` · ${comments[unit.unitId]}` : ''}`), `종합 의견: ${comment || '없음'}`].join('\n')} /></Field><Button variant="secondary" onClick={() => setSavedEvaluationDraft(evaluationDraftRef.current)}>추가 작성 내용 확인 완료</Button></div></div>}
    <header className="ue-person-heading"><span className="ue-avatar ue-avatar-large">{person.name.slice(0, 1)}</span><div><span>{w.departments.find(department => department.id === person.departmentId)?.name} · {person.team}</span><h2>{person.name}<small>{person.title}</small></h2><p>{periodName(period)} · 단위업무 {summary.units.length}개 · 세부업무 성과 {summary.performances.length}건</p></div><div className="ue-total-score"><span>{evaluation ? '개인 평가 총점' : '업무 비중 합계'}</span><strong>{evaluation ? scoreText(summary.totalScore || 0) : plan ? scoreText(summary.totalMaxScore) : '—'}<small>/ 50</small></strong><Badge tone={evaluation ? 'success' : plan ? 'info' : 'soft'}>{evaluation ? '평가 완료' : submitted ? '제출 완료 · 평가 대기' : '미제출'}</Badge></div></header>
    {evaluationDepartment !== person.departmentId && <div className="ue-notice"><FileText size={18} /><div><strong>이전 부서에서 수행한 성과입니다.</strong><p>기존 성과와 업무 비중을 보존하며, 배점 당시 부서장이 평가합니다. 현재 담당 업무의 접근 권한은 변경되지 않습니다.</p></div></div>}
    {!plan && <div className="ue-notice"><SlidersHorizontal size={18} /><div><strong>{self ? '업무 비중을 합계 50점으로 설정해 주세요.' : `${person.name}님이 업무 비중과 성과를 제출한 뒤 평가할 수 있습니다.`}</strong></div>{self && currentUnits.length > 0 && <Button variant="secondary" disabled={futurePeriod} onClick={onWeights}>업무 비중 설정 <ArrowRight size={14} /></Button>}</div>}
    {stalePlan && <div className="ue-notice ue-notice-warning"><ClipboardCheck size={18} /><div><strong>단위업무가 변경되어 업무 비중을 다시 설정해야 합니다.</strong><p>이미 제출했다면 먼저 제출을 회수해 주세요.</p></div>{self && !submitted && <Button variant="secondary" disabled={futurePeriod} onClick={onWeights}>업무 비중 다시 설정</Button>}</div>}
    {evaluation && <div className="ue-notice"><LockKeyhole size={18} /><div><strong>평가가 확정되어 성과와 업무 비중이 보존됩니다.</strong><p>평가자 {personName(w, evaluation.evaluatedBy)} · 평가일 {formatDateFull(evaluation.evaluatedAt)}</p></div></div>}
    {submitted && !evaluation && <div className="ue-notice"><Send size={18} /><div><strong>제출했습니다. 평가 전에는 회수하여 수정할 수 있습니다.</strong><p>제출 일시 {dateText(plan!.submittedAt!)}</p></div>{self && <Button variant="secondary" disabled={saving || revision.conflicted} onClick={() => void changeSubmission(true)}><Undo2 size={14} />{saving ? '처리 중…' : '제출 회수'}</Button>}</div>}
    {isReviewer && !submitted && !evaluation && <div className="ue-notice ue-notice-warning"><ClipboardCheck size={18} /><div><strong>직원의 제출을 기다리고 있습니다.</strong><p>성과 작성과 업무 비중 저장을 마친 직원이 제출하기를 누르면 평가를 시작할 수 있습니다.</p></div></div>}
    {self && submitted && error && <p className="form-error" role="alert">{error}</p>}
    <form onSubmit={submit} className="ue-evaluation-form">
      <div className="ue-unit-list">{summary.units.map((unit, index) => {
        const isRated = unit.maxScore !== undefined && (!!evaluation || !!plan?.allocations.some(allocation => allocation.unitId === unit.unitId));
        const evidence = unit.performances.filter(item => ['review', 'confirmed'].includes(item.status));
        const aggregates = metrics(unit.performances);
        const score = scores[unit.unitId] ?? '';
        const scoreInvalid = score !== '' && (!Number.isFinite(Number(score)) || Number(score) < 0 || Number(score) > (unit.maxScore || 0));
        return <article className="ue-unit" key={unit.unitId}><header><span className="ue-unit-number">{String(index + 1).padStart(2, '0')}</span><div><span><FolderOpen size={13} />단위업무</span><h3>{unit.unitTitle}</h3><p>세부업무 {unit.taskCount}개 · 성과 {unit.performances.length}건</p></div><div className="ue-unit-weight"><span>업무 비중</span><strong>{unit.maxScore === undefined ? plan || evaluation ? '참고 성과' : '미설정' : <>{scoreText(unit.maxScore)}<small>점</small></>}</strong></div></header>
          {aggregates.length > 0 && <div className="ue-metric-summary" aria-label={`${unit.unitTitle} 성과 집계`}>{aggregates.map((metric, metricIndex) => <div key={metricIndex}><span>{metric.name}<small>{metric.values.length > 1 && metric.additive ? `${metric.values.length}건 합계` : metric.values.length > 1 ? '개별 값' : '실적'}</small></span><strong>{metric.additive ? scoreText(metric.values.reduce((sum, value) => sum + value, 0)) : metric.values.map(scoreText).join(' · ')}<small>{metric.unit}</small></strong></div>)}</div>}
          <div className="ue-evidence-list">{unit.performances.map(performance => {
            const source = performance as Performance & { taskTitle?: string };
            const task = w.tasks.find(task => task.id === performance.taskId);
            const canOpen = !!task;
            return <section className="ue-performance" key={performance.id}><div className="ue-performance-heading"><span><FileText size={14} />세부업무</span>{canOpen ? <button type="button" className="ue-task-link" onClick={() => onOpenTask(performance.taskId)}>{source.taskTitle || task.title}<ArrowUpRight size={14} /></button> : <strong>{source.taskTitle || '기존 세부업무'}</strong>}<Badge tone={performance.status === 'changes_requested' ? 'warning' : 'soft'}>{evaluation ? '평가 반영' : performance.status === 'confirmed' ? '기존 확정 성과' : !submitted && performance.status === 'review' ? '작성 완료 · 제출 전' : statusLabels[performance.status]}</Badge></div><p className="ue-performance-content">{performance.description}</p>{performance.metricName && performance.value !== undefined && <div className="ue-individual-metric">{performance.metricName}<strong>{scoreText(performance.value)} {performance.unit}</strong></div>}<TaskFileAttachments workspace={w} taskId={performance.taskId} performanceId={performance.id} attachmentIds={performance.attachmentIds || []} label="성과 참고 파일"/>{performance.evidence && <details className="ue-legacy-evidence"><summary>이전에 작성한 근거 보기</summary><p>{performance.evidence}</p></details>}{performance.status === 'changes_requested' && <div className="ue-correction"><p><strong>보완 의견</strong>{performance.comment || '성과 내용과 참고 파일을 확인해 주세요.'}</p></div>}{self && !submitted && !evaluation && performance.status !== 'confirmed' && performance.authorId === w.currentUser.id && <div className="ue-performance-actions"><Button variant="secondary" type="button" disabled={futurePeriod} onClick={() => { if (!futurePeriod) onEdit(performance); }}><Pencil size={14} />{performance.status === 'changes_requested' ? '성과 보완' : '성과 수정'}</Button></div>}</section>;
          })}{!unit.performances.length && <p className="ue-no-performance"><FileText size={16} />이 단위업무에 등록된 반기 성과가 없습니다.</p>}</div>
          {isRated && <div className="ue-unit-rating"><div><span><ShieldCheck size={15} />부서장 평가</span>{!evaluation && submitted && !evidence.length && <small>제출된 성과가 없어 0점으로 평가합니다.</small>}</div>{evaluation ? <><strong className="ue-readonly-score">{scoreText(unit.score || 0)}<small>/ {scoreText(unit.maxScore || 0)}점</small></strong>{unit.comment && <p className="ue-rating-comment">{unit.comment}</p>}</> : isReviewer ? <><label className="ue-score-input"><span className="sr-only">{unit.unitTitle} 평가 점수</span><input type="number" min="0" max={unit.maxScore || 0} step="0.01" required disabled={!canEvaluate || !evidence.length} value={score} aria-invalid={scoreInvalid} onChange={event => setScores(previous => ({ ...previous, [unit.unitId]: event.target.value }))} placeholder="점수" /><span>/ {scoreText(unit.maxScore || 0)}점</span></label><label className="ue-unit-comment"><span className="sr-only">{unit.unitTitle} 평가 의견</span><textarea rows={2} maxLength={5000} disabled={!canEvaluate} value={comments[unit.unitId] || ''} onChange={event => setComments(previous => ({ ...previous, [unit.unitId]: event.target.value }))} placeholder="이 단위업무의 성과에 대한 의견을 남겨 주세요. (선택)" /></label>{scoreInvalid && <p className="form-error">점수는 0점부터 업무 비중 {scoreText(unit.maxScore || 0)}점 이내로 입력해 주세요.</p>}</> : <span className="ue-awaiting">{submitted ? '부서장 평가 대기' : '제출 후 평가 진행'}</span>}</div>}
        </article>;
      })}</div>
      {!summary.units.length && <EmptyState title="아직 단위업무가 없습니다." description={self ? '개인업무에서 단위업무를 등록한 뒤 업무 비중과 성과를 입력해 주세요.' : '직원이 단위업무와 성과를 등록하면 여기에 표시됩니다.'} />}
      {evaluation && <div className="ue-final-comment"><CheckCheck size={21} /><div><h3>종합 평가 의견</h3><p>{evaluation.comment || '등록된 종합 의견이 없습니다.'}</p></div><strong>{scoreText(summary.totalScore || 0)}<small>/ 50점</small></strong></div>}
      {isReviewer && !evaluation && submitted && plan && <div className="ue-submit-panel"><div><h3>개인 평가 확정</h3><p>각 단위업무에 입력한 점수를 합산합니다. 확정 후에는 업무 비중과 평가를 변경할 수 없습니다.</p></div><Field label="종합 평가 의견 · 선택"><textarea rows={3} maxLength={5000} disabled={!canEvaluate} value={comment} onChange={event => setComment(event.target.value)} placeholder="이번 반기의 성과와 다음 반기의 개선 방향을 기록하세요." /></Field>{!hasEvidence && <p className="ue-validation">제출된 성과가 최소 1건 있어야 평가를 확정할 수 있습니다.</p>}{needsChanges && <p className="ue-validation">보완 요청된 성과를 직원이 다시 제출한 뒤 평가해 주세요.</p>}{stalePlan && <p className="ue-validation">변경된 단위업무의 업무 비중을 다시 설정해야 합니다.</p>}{error && <p className="form-error" role="alert">{error}</p>}<footer><div><span>입력한 평가 총점</span><strong>{scoreText(displayedTotal)}<small>/ 50점</small></strong></div><Button type="submit" disabled={!canEvaluate || !allValid || saving || revision.conflicted}><CheckCircle2 size={17} />{saving ? '평가 저장 중…' : '개인 평가 확정'}</Button></footer></div>}
    </form>
    {self && !isReviewer && !submitted && !evaluation && <section className="ue-submit-panel ue-person-submission" aria-label="성과 제출">
      <div><h3>성과와 업무 비중을 확인하고 제출하세요.</h3><p>제출하면 부서장이 단위업무별 성과를 평가합니다. 부서 담당자는 제출 여부를 확인할 수 있습니다.</p></div>
      <ul className="ue-readiness"><li data-ready={!!plan && !stalePlan && summary.totalMaxScore === 50}><CheckCircle2 size={16} /><span>모든 단위업무의 업무 비중 합계 50점</span><strong>{plan ? `${scoreText(summary.totalMaxScore)} / 50점` : '설정 필요'}</strong></li><li data-ready={!!plan && incompleteUnits.length === 0 && incompleteRecords.length === 0 && ratedPerformances.length > 0 && !needsChanges}><CheckCircle2 size={16} /><span>업무 비중이 있는 단위업무의 성과 작성</span><strong>{plan ? incompleteUnits.length ? `${incompleteUnits.length}개 미작성` : needsChanges || incompleteRecords.length ? '보완 필요' : ratedPerformances.length ? '작성 완료' : '작성 필요' : '비중 설정 후 확인'}</strong></li></ul>
      {incompleteUnits.length > 0 && <p className="ue-validation">성과를 입력할 단위업무: {incompleteUnits.map(unit => unit.unitTitle).join(', ')}</p>}
      {incompleteRecords.length > 0 && <p className="ue-validation">성과 내용이 누락된 {incompleteRecords.length}건을 보완해 주세요.</p>}
      {needsChanges && <p className="ue-validation">보완 요청된 성과를 수정하여 저장한 뒤 제출해 주세요.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><p className="ue-footnote">{futurePeriod ? '아직 시작하지 않은 반기에는 성과와 업무 비중을 저장하거나 제출할 수 없습니다.' : '제출 전에는 저장한 성과와 업무 비중을 수정할 수 있습니다.'}</p><Button disabled={!canSubmit || saving || revision.conflicted} onClick={() => void changeSubmission(false)}><Send size={17} />{saving ? '제출 중…' : '제출하기'}</Button></footer>
    </section>}
    {summary.performances.length > 0 && <HelpCallout controls={help} id="performance.scoring" summary="반기 평가는 단위업무별 점수를 합산해 50점으로 계산합니다."><p>같은 지표명·단위의 수치는 합산하고, 비율·평균·점수는 개별 값으로 표시합니다. 세부업무별 과거 100점 평가는 이번 50점 총점에 포함하지 않습니다.</p></HelpCallout>}
  </section>;
}

function WeightEditor({ workspace: w, command, period, plan, onClose }: { workspace: Workspace; command: CommandFn; period: string; plan?: UnitScorePlan; onClose: () => void }) {
  const mounted = useMountedEditor();
  const errorIdPrefix = useId();
  const saveReasonId = useId();
  const futurePeriod = isFutureHalf(period, new Date(w.serverTime));
  const revision = useRevisionCommand(w, command, { kind: 'plan', id: JSON.stringify([w.currentUser.id, period]) });
  const units = scoreUnitsForPeriod(w, w.currentUser.id, period);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(units.map(unit => [unit.id, String(plan?.allocations.find(item => item.unitId === unit.id)?.maxScore ?? '')])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedNotice, setSavedNotice] = useState('');
  const { requestNavigation } = useUnsavedNavigation();
  const weightDraft = JSON.stringify(values);
  const draftRef = useRef(weightDraft); draftRef.current = weightDraft;
  const [savedWeightDraft, setSavedWeightDraft] = useState(weightDraft);
  const locked = futurePeriod || !!getUnitEvaluation(w, w.currentUser.id, period) || !!getUnitScorePlan(w, w.currentUser.id, period)?.submittedAt;
  useUnsavedChanges(weightDraft !== savedWeightDraft, '단위업무 비중');
  const closeEditor = () => requestNavigation(onClose);
  const validation = validateWeights(units, values);
  const { total, fieldErrors, validTotal } = validation;
  const fieldErrorCount = Object.keys(fieldErrors).length;
  const valid = !locked && validation.canSave;
  const totalMessage = fieldErrorCount ? `입력값을 확인해 주세요 (오류 ${fieldErrorCount}개)` : validTotal ? '합계가 50점입니다.' : total > 50 ? `${scoreText(total - 50)}점을 줄여 주세요.` : `${scoreText(50 - total)}점을 더 배정해 주세요.`;
  const saveDisabledReason = futurePeriod ? '아직 시작하지 않은 반기에는 업무 비중을 저장할 수 없습니다.'
    : locked ? '제출되었거나 평가가 확정된 업무 비중은 변경할 수 없습니다.'
    : revision.conflicted ? '최신 내용을 확인한 뒤 다시 저장해 주세요. 입력값은 보존됩니다.'
    : saving ? '저장 중입니다. 입력값은 계속 수정할 수 있습니다.'
    : !units.length ? '배정할 단위업무를 먼저 등록해 주세요.'
    : fieldErrorCount ? `입력값을 확인해 주세요 (오류 ${fieldErrorCount}개)`
    : !validTotal ? totalMessage : '';
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!valid || saving || revision.conflicted) return;
    const submittedDraft = weightDraft;
    const submittedValues = { ...values };
    let closeAfterSave = false;
    setSaving(true); setError(''); setSavedNotice('');
    try {
      const saved = await revision.command('performance.setWeights', { period, allocations: units.map(unit => ({ unitId: unit.id, maxScore: Number(submittedValues[unit.id]) })) }, { onSaved: savedWorkspace => {
        if (!mounted.current) return;
        const savedPlan = getUnitScorePlan(savedWorkspace, w.currentUser.id, period);
        const normalized = Object.fromEntries(units.map(unit => [unit.id, String(savedPlan?.allocations.find(item => item.unitId === unit.id)?.maxScore ?? submittedValues[unit.id])]));
        closeAfterSave = draftRef.current === submittedDraft;
        setValues(current => Object.fromEntries(Object.entries(current).map(([id, value]) => [id, value === submittedValues[id] ? normalized[id] ?? value : value])));
        setSavedWeightDraft(JSON.stringify(normalized));
        setSavedNotice(closeAfterSave ? '업무 비중을 저장했습니다.' : '요청한 업무 비중을 저장했습니다. 이후 변경한 값은 한 번 더 저장해 주세요.');
      } });
      if (!mounted.current) return;
      if (saved && closeAfterSave) onClose();
      else if (!saved) setError('업무 비중을 저장하지 못했습니다. 안내 메시지를 확인해 주세요.');
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '업무 비중을 저장하지 못했습니다.'); }
    finally { if (mounted.current) setSaving(false); }
  };
  return <Modal title="단위업무별 업무 비중 설정" description={`${periodName(period)} · 내 단위업무의 업무 비중 합계를 50점으로 정합니다.`} onClose={closeEditor}><form className="form-stack" onSubmit={submit}>
    <div className="ue-weight-total" data-valid={validTotal && !fieldErrorCount}><div><span>{fieldErrorCount ? '유효한 입력 합계' : '업무 비중 합계'}</span><strong>{scoreText(total)}<small>/ 50점</small></strong></div><span role="status">{totalMessage}</span></div>
    <>{futurePeriod ? <p className="ue-validation" role="status">아직 시작하지 않은 반기입니다. 기존 업무 비중은 조회할 수 있지만 저장·제출은 반기가 시작된 후 가능합니다. 작성 중이던 값은 아래에 보존됩니다.</p> : locked && <p className="ue-validation">제출되었거나 평가가 확정되어 업무 비중을 변경할 수 없습니다. 작성 중이던 값은 아래에 보존됩니다.</p>}</>
    <div className="ue-weight-fields">{units.map((unit, index) => {
      const fieldError = fieldErrors[unit.id];
      const fieldErrorId = `${errorIdPrefix}-${index}`;
      return <label key={unit.id} data-invalid={!!fieldError}><span><small>단위업무 {index + 1}</small><strong>{unit.title}</strong></span><span className="ue-weight-entry"><span className="ue-weight-input"><input type="number" min="0" max="50" step="0.01" required readOnly={locked} aria-label={`${unit.title} 업무 비중`} aria-invalid={!!fieldError} aria-describedby={fieldError ? fieldErrorId : undefined} value={values[unit.id] ?? ''} onChange={event => { setValues(previous => ({ ...previous, [unit.id]: event.target.value })); setSavedNotice(''); }} placeholder="0" /><small>점</small></span>{fieldError && <small className="ue-weight-error" id={fieldErrorId}>{fieldError}</small>}</span></label>;
    })}</div>
    <p className="ue-footnote">업무 비중은 각 단위업무의 최고 점수입니다. 평가 대상이 아닌 단위업무는 0점으로 설정할 수 있습니다. 제출 전까지 수정할 수 있으며, 저장 후에는 성과 · 평가에서 제출하기를 눌러 주세요.</p>
    {revision.conflict}{error && <p role="alert" className="form-error">{error}</p>}{savedNotice && <p role="status" className="ue-save-success">{savedNotice}</p>}
    <div className="form-actions ue-weight-actions">{saveDisabledReason && <p className="ue-weight-save-reason" id={saveReasonId}>{saveDisabledReason}</p>}<Button variant="secondary" type="button" onClick={closeEditor}>닫기</Button><Button type="submit" disabled={!valid || saving || revision.conflicted} aria-describedby={saveDisabledReason ? saveReasonId : undefined}><Save size={16} />{saving ? '저장 중…' : '업무 비중 저장'}</Button></div>
  </form></Modal>;
}

export function PerformanceEditor({ workspace: w, command, period, existing, fixedTaskId, embedded = false, readOnly = false, onClose, onBusyChange }: { workspace: Workspace; command: CommandFn; period: string; existing?: Performance; fixedTaskId?: string; embedded?: boolean; readOnly?: boolean; onClose: () => void; onBusyChange?: (busy: boolean) => void }) {
  const mounted = useMountedEditor();
  const futurePeriod = isFutureHalf(period, new Date(w.serverTime));
  const plan = getUnitScorePlan(w, w.currentUser.id, period);
  const tasks = activeTasks(w, w.currentUser.id).filter(task => !plan || task.departmentId === plan.departmentId);
  const current = currentPersonPerformances(w, w.currentUser.id, period);
  const pinnedTaskId = fixedTaskId || existing?.taskId;
  const [taskId, setTaskId] = useState(pinnedTaskId || tasks.find(task => !current.some(item => item.taskId === task.id))?.id || '');
  const revision = useRevisionCommand(w, command, taskId ? { kind: 'halfPerformance', id: JSON.stringify([w.currentUser.id, taskId, period]) } : null);
  const record = current.find(item => item.taskId === taskId) || (existing?.taskId === taskId ? existing : undefined);
  const eligible = tasks.filter(task => pinnedTaskId ? task.id === pinnedTaskId : task.id === taskId || !current.some(item => item.taskId === task.id));
  const contentHelpId = useId();
  const [description, setDescription] = useState(record?.description || '');
  const [attachmentIds, setAttachmentIds] = useState(record?.attachmentIds || []);
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const uploadCallbackRef = useRef(onBusyChange); uploadCallbackRef.current = onBusyChange;
  useEffect(() => () => { uploadCallbackRef.current?.(false); }, []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [savedNotice, setSavedNotice] = useState('');
  const locked = futurePeriod || readOnly || !!getUnitScorePlan(w, w.currentUser.id, period)?.submittedAt || !!getUnitEvaluation(w, w.currentUser.id, period) || record?.status === 'confirmed';
  const { requestNavigation } = useUnsavedNavigation();
  const draftSnapshot = JSON.stringify({ taskId, description, attachmentIds });
  const draftRef = useRef(draftSnapshot); draftRef.current = draftSnapshot;
  const taskIdRef = useRef(taskId); taskIdRef.current = taskId;
  const selectionRevisionRef = useRef(0);
  const selectionRevision = selectionRevisionRef.current;
  const [savedSnapshot, setSavedSnapshot] = useState(draftSnapshot);
  useUnsavedChanges(draftSnapshot !== savedSnapshot || uploading, '성과 내용·참고 파일');
  const closeEditor = () => requestNavigation(onClose);
  const changeTask = (value: string) => {
    if (value === taskId || locked) return;
    requestNavigation(() => {
      selectionRevisionRef.current += 1;
      setTaskId(value); setDescription(''); setAttachmentIds([]); setSaved(false); setError('');
      uploadingRef.current = false; setUploading(false); onBusyChange?.(false);
      setSavedSnapshot(JSON.stringify({ taskId: value, description: '', attachmentIds: [] }));
    });
  };
  const ownHistoricalRecord = record?.authorId === w.currentUser.id && record.period === period && record.taskId === taskId;
  const selectedTask = tasks.find(task => task.id === taskId) || w.tasks.find(task => task.id === taskId);
  const selectedTaskLabel = [w.units.find(unit => unit.id === (selectedTask?.unitId || record?.unitId))?.title, selectedTask?.title || record?.title].filter(Boolean).join(' › ');
  const valid = !locked && !uploading && (ownHistoricalRecord || eligible.some(task => task.id === taskId)) && !!description.trim() && description.length <= 500;
  const form = <form className="form-stack ue-performance-editor" onSubmit={async event => {
    event.preventDefault(); if (!valid || saving || revision.conflicted) return;
    const submittedDraft = draftSnapshot;
    const submittedRevision = selectionRevisionRef.current;
    const submitted = { taskId, description, attachmentIds: [...attachmentIds] };
    let closeAfterSave = false;
    setSaving(true); setError(''); setSaved(false); setSavedNotice('');
    try {
      const completed = await revision.command('performance.saveHalf', { ...submitted, period, metricName: record?.metricName, value: record?.value, unit: record?.unit }, { onSaved: savedWorkspace => {
        if (!mounted.current || taskIdRef.current !== submitted.taskId || selectionRevisionRef.current !== submittedRevision) return;
        const savedRecord = currentPersonPerformances(savedWorkspace, w.currentUser.id, period).find(item => item.taskId === submitted.taskId);
        const normalized = { taskId: submitted.taskId, description: savedRecord?.description ?? submitted.description, attachmentIds: savedRecord?.attachmentIds ?? submitted.attachmentIds };
        closeAfterSave = draftRef.current === submittedDraft && !uploadingRef.current;
        setDescription(value => value === submitted.description ? normalized.description : value);
        setAttachmentIds(value => JSON.stringify(value) === JSON.stringify(submitted.attachmentIds) ? normalized.attachmentIds : value);
        setSavedSnapshot(JSON.stringify(normalized)); setSaved(true);
        setSavedNotice(closeAfterSave ? '성과를 저장했습니다. 성과 · 평가에서 제출을 진행해 주세요.' : '요청한 성과를 저장했습니다. 이후 작성한 내용은 한 번 더 저장해 주세요.');
      } });
      if (!mounted.current || selectionRevisionRef.current !== submittedRevision) return;
      if (completed && closeAfterSave) onClose();
      else if (!completed) setError('성과를 저장하지 못했습니다. 안내 메시지를 확인해 주세요.');
    } catch (cause) { if (mounted.current && selectionRevisionRef.current === submittedRevision) setError(cause instanceof Error ? cause.message : '성과를 저장하지 못했습니다.'); }
    finally { if (mounted.current) setSaving(false); }
  }}>
    {ownHistoricalRecord && !eligible.length && <div className="ue-notice"><FileText size={18} /><div><strong>인수인계 전 작성한 내 성과를 보완합니다.</strong><p>이 성과의 작성자·당시 부서·단위업무는 보존됩니다. 후임자의 업무 내용은 변경하지 않습니다.</p></div></div>}
    {record?.status === 'changes_requested' && record.comment && <div className="ue-notice"><ClipboardCheck size={18} /><div><strong>부서장 보완 의견</strong><p>{record.comment}</p></div></div>}
    {!embedded && <p className="ue-footnote">{periodName(period)} · 성과 내용과 필요한 참고 파일을 저장하세요.</p>}
    {pinnedTaskId ? !embedded && <div className="ue-editor-task"><FolderOpen size={17} /><div><small>{w.units.find(item => item.id === tasks.find(task => task.id === pinnedTaskId)?.unitId)?.title}</small><strong>{tasks.find(task => task.id === pinnedTaskId)?.title || '이전 담당 업무 · ' + (record?.title || '기존 성과')}</strong></div></div> : locked ? <ReadField label="세부업무" value={selectedTaskLabel}/> : <Field label="세부업무"><select required value={taskId} onChange={event => changeTask(event.target.value)}><option value="">성과를 기록할 업무 선택</option>{eligible.map(task => <option key={task.id} value={task.id}>{w.units.find(item => item.id === task.unitId)?.title} › {task.title}</option>)}</select></Field>}
    {!eligible.length && !ownHistoricalRecord && <p role="alert" className="ue-validation">새로 작성할 세부업무가 없습니다. 이미 작성한 성과는 단위업무별 성과 목록에서 수정할 수 있습니다.</p>}
    <>{futurePeriod ? <p className="ue-validation" role="status">아직 시작하지 않은 반기입니다. 기존 성과와 참고 파일은 조회할 수 있지만 저장·첨부·제출은 반기가 시작된 후 가능합니다. 작성 중이던 내용은 보존됩니다.</p> : locked && <p className="ue-validation">현재 수정할 수 없는 성과입니다. 제출한 성과는 성과 · 평가에서 제출을 회수한 후 수정할 수 있습니다. 작성 중이던 내용은 보존됩니다.</p>}</>{locked && draftSnapshot !== savedSnapshot && <Field label="저장되지 않은 성과 초안"><textarea readOnly rows={5} value={description} /></Field>}
    <fieldset disabled={locked} className="ue-editor-fields" onChange={() => setSaved(false)}>
      <div className="ue-content-field">{locked ? <ReadField label="성과 내용" value={description}/> : <><Field label="성과 내용"><textarea required rows={6} maxLength={500} value={description} aria-describedby={contentHelpId} aria-invalid={description.length > 500} onChange={event => setDescription(event.target.value)} placeholder="무엇을 추진했고, 어떤 결과나 개선을 이루었나요? 핵심 내용을 500자 이내로 작성해 주세요." /></Field><div className="ue-content-help" id={contentHelpId}><span>{description.length > 500 ? '기존 내용을 500자 이내로 정리해 주세요.' : '결과와 달라진 점을 간결하게 적어 주세요.'}</span><strong data-over={description.length > 500}>{description.length.toLocaleString()} / 500자</strong></div></>}</div>
      <TaskFileAttachments key={taskId} workspace={w} taskId={taskId} performanceId={record?.id} attachmentIds={attachmentIds} onChange={ids => { if (mounted.current && taskIdRef.current === taskId && selectionRevisionRef.current === selectionRevision) { setAttachmentIds(ids); setSaved(false); } }} command={command} onBusyChange={busy => { if (mounted.current && taskIdRef.current === taskId && selectionRevisionRef.current === selectionRevision) { uploadingRef.current = busy; setUploading(busy); onBusyChange?.(busy); } }} disabled={locked} label="성과 참고 파일"/>
    </fieldset>
    {revision.conflict}{error && <p role="alert" className="form-error">{error}</p>}{saved && <p role="status" className="ue-save-success"><CheckCircle2 size={16} />{savedNotice}</p>}
    <div className="form-actions">{!embedded && <Button type="button" variant="secondary" onClick={closeEditor}>닫기</Button>}<Button type="submit" disabled={saving || !valid || revision.conflicted}><Save size={16} />{uploading ? '파일 업로드 중…' : saving ? '저장 중…' : '성과 저장'}</Button></div>
  </form>;
  return embedded ? form : <Modal title={record ? '업무 성과 수정' : '반기 성과 입력'} description="성과 내용은 500자 이내로 작성하고, 참고 자료는 파일로 첨부하세요." wide onClose={closeEditor}>{form}</Modal>;
}

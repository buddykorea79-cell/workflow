'use client';

import { useState } from 'react';
import { ArrowRight, ArrowUpRight, CalendarDays, CheckCheck, CheckCircle2, ChevronRight, ClipboardCheck, FileText, FolderOpen, LockKeyhole, Pencil, Plus, Save, Search, Send, ShieldCheck, SlidersHorizontal, Undo2, Users } from 'lucide-react';
import type { Performance, UnitScorePlan, User, Workspace } from '@/lib/types';
import { currentPersonPerformances, eligibleScoreUnits, scoreUnitsForPeriod, getUnitEvaluation, getUnitScorePlan, hasCompletePerformance, missingPerformanceUnitIds, personUnitPerformanceSummary } from '@/lib/unit-evaluation';
import { Badge, Button, EmptyState, Field, Modal, type CommandFn } from './ui';
import './unit-evaluation.css';

type Props = { workspace: Workspace; command: CommandFn; onOpenTask: (id: string) => void };
type Summary = ReturnType<typeof personUnitPerformanceSummary>;
const statusLabels: Record<Performance['status'], string> = { draft: '작성 완료 · 제출 전', review: '제출 완료', confirmed: '확인 완료', changes_requested: '보완 요청' };
const periodName = (value: string) => `${value.slice(0, 4)}년 ${value.endsWith('H1') ? '상반기' : '하반기'}`;
const scoreText = (value: number) => Number(value.toFixed(2)).toLocaleString('ko-KR');
const dateText = (value: string) => new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const personName = (w: Workspace, id: string) => w.users.find(user => user.id === id)?.name || w.identities?.find(user => user.id === id)?.name || '담당자';
function performancePeople(w: Workspace): User[] {
  const people = [...w.users];
  for (const identity of w.identities ?? []) if (!people.some(person => person.id === identity.id)) people.push({ ...identity, initials: identity.name.slice(0, 1), role: 'member', title: '전출 직원', active: false, color: '#64748b' });
  return people;
}
const isRegistered = (w: Workspace, taskId: string, commonId?: string) => !commonId || !!w.commonTasks.find(common => common.id === commonId)?.distributions.some(item => item.taskId === taskId && ['registered', 'assigned', 'submitted'].includes(item.status));
const activeTasks = (w: Workspace, personId: string) => w.tasks.filter(task => task.primaryId === personId && !task.deletedAt && task.status !== 'archived' && w.units.some(unit => unit.id === task.unitId && !unit.deletedAt) && isRegistered(w, task.id, task.commonId));

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

export function PerformanceView({ workspace: w, command, onOpenTask }: Props) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(w.serverTime));
  const year = Number(today.slice(0, 4));
  const [period, setPeriod] = useState(`${year}-H${Number(today.slice(5, 7)) <= 6 ? 1 : 2}`);
  const [departmentId, setDepartmentId] = useState(w.currentUser.departmentId);
  const [selectedPerson, setSelectedPerson] = useState('');
  const [query, setQuery] = useState('');
  const [team, setTeam] = useState('all');
  const [editing, setEditing] = useState<Performance | 'new' | null>(null);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const user = w.currentUser;
  const isReviewer = user.role === 'head' || user.role === 'admin';
  const scopeDepartment = user.role === 'admin' ? departmentId : user.departmentId;
  const hasHistoricalEvaluation = (personId: string) => (w.unitScorePlans ?? []).some(plan => plan.personId === personId && plan.period === period && plan.departmentId === scopeDepartment) || (w.unitEvaluations ?? []).some(evaluation => evaluation.personId === personId && evaluation.period === period && evaluation.departmentId === scopeDepartment) || w.performances.some(item => item.authorId === personId && item.period === period && item.departmentId === scopeDepartment);
  const people = isReviewer ? performancePeople(w).filter(person => hasHistoricalEvaluation(person.id) || person.departmentId === scopeDepartment && !['head', 'admin'].includes(person.role) && person.active).sort((a, b) => a.team.localeCompare(b.team, 'ko') || a.name.localeCompare(b.name, 'ko')) : [user];
  const teams = [...new Set(people.map(person => person.team))];
  const filteredPeople = people.filter(person => (team === 'all' || person.team === team) && `${person.name} ${person.team}`.toLowerCase().includes(query.trim().toLowerCase()));
  const person = filteredPeople.find(item => item.id === selectedPerson) || filteredPeople.find(item => currentPersonPerformances(w, item.id, period).length > 0) || filteredPeople.find(item => eligibleScoreUnits(w, item.id).length > 0) || filteredPeople[0];
  const summaries = people.map(person => personUnitPerformanceSummary(w, person.id, period));
  const summary = person ? personUnitPerformanceSummary(w, person.id, period) : undefined;
  const ownEvaluation = getUnitEvaluation(w, user.id, period);
  const ownPlan = getUnitScorePlan(w, user.id, period);
  const ownTasks = activeTasks(w, user.id).filter(task => !ownPlan || task.departmentId === ownPlan.departmentId);
  const canEdit = !isReviewer && !ownEvaluation && !ownPlan?.submittedAt && ownTasks.length > 0;
  const ownUnits = scoreUnitsForPeriod(w, user.id, period);
  const totalPerformanceCount = summaries.reduce((sum, item) => sum + item.performances.length, 0);
  const evaluated = summaries.filter(item => item.evaluation).length;
  const ready = summaries.filter(item => item.plan?.submittedAt && !item.evaluation).length;
  const years = [...new Set([year - 2, year - 1, year, year + 1, year + 2, ...w.performances.map(item => Number(item.period?.slice(0, 4))).filter(Number.isFinite), ...(w.unitScorePlans || []).map(item => Number(item.period.slice(0, 4))), ...(w.unitEvaluations || []).map(item => Number(item.period.slice(0, 4))), ...(w.performanceSubmissionStatuses || []).map(item => Number(item.period.slice(0, 4)))])].filter(value => value > 1900).sort((a, b) => a - b);

  return <div className="ue-view">
    <div className="page-heading"><div><p className="eyebrow">Performance & evaluation</p><h1>{isReviewer ? '개인별 성과와 평가' : '나의 성과와 평가'}</h1><p>세부업무의 성과를 단위업무별로 모아 보고, 업무 비중을 정해 부서장에게 제출합니다.</p></div><div className="ue-heading-actions">{!isReviewer && ownUnits.length > 0 && <Button variant="secondary" disabled={!!ownEvaluation || !!ownPlan?.submittedAt} onClick={() => setWeightsOpen(true)}><SlidersHorizontal size={16} />업무 비중 설정</Button>}{canEdit && <Button onClick={() => setEditing('new')}><Plus size={17} />반기 성과 입력</Button>}</div></div>
    <div className="ue-period-bar"><span><CalendarDays size={18} />평가 기간</span><select aria-label="성과 평가 연도" value={period.slice(0, 4)} onChange={event => setPeriod(`${event.target.value}-${period.slice(5)}`)}>{years.map(value => <option key={value} value={value}>{value}년</option>)}</select><div className="tabs"><button className={period.endsWith('H1') ? 'active' : ''} onClick={() => setPeriod(`${period.slice(0, 4)}-H1`)}>상반기 <small>01–06월</small></button><button className={period.endsWith('H2') ? 'active' : ''} onClick={() => setPeriod(`${period.slice(0, 4)}-H2`)}>하반기 <small>07–12월</small></button></div>{user.role === 'admin' && <select aria-label="성과 평가 부서" value={scopeDepartment} onChange={event => { setDepartmentId(event.target.value); setSelectedPerson(''); setTeam('all'); }}>{w.departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</select>}<Badge tone="info">업무 비중 합계 50점</Badge></div>
    <div className="ue-explanation"><ClipboardCheck size={20} /><div><strong>성과 입력 → 업무 비중 50점 설정 → 제출하기 → 부서장 평가</strong><p>세부업무의 마지막 업무 성과 탭에서 저장한 내용이 단위업무별로 모입니다. 업무 비중과 성과를 모두 확인한 뒤 제출하면 부서장이 평가를 진행합니다.</p></div></div>
    {user.role === 'manager' && <SubmissionStatusPanel workspace={w} period={period} />}
    {isReviewer && <section className="ue-stats" aria-label="개인별 평가 요약"><div><span>평가 대상</span><strong>{people.length}<small>명</small></strong></div><div><span>등록된 성과</span><strong>{totalPerformanceCount}<small>건</small></strong></div><div><span>제출 완료 · 평가 대기</span><strong>{ready}<small>명</small></strong></div><div><span>평가 완료</span><strong>{evaluated}<small>명</small></strong></div></section>}
    <div className={`ue-layout ${isReviewer ? 'ue-with-people' : ''}`}>
      {isReviewer && <aside className="ue-people" aria-label="평가 대상 직원"><header><h2><Users size={17} />직원별 성과</h2><span>{filteredPeople.length}명</span></header><div className="ue-people-filters"><label><Search size={15} /><input aria-label="평가 대상 이름 검색" placeholder="이름·팀 검색" value={query} onChange={event => setQuery(event.target.value)} /></label><select aria-label="평가 대상 팀" value={team} onChange={event => setTeam(event.target.value)}><option value="all">모든 팀</option>{teams.map(value => <option key={value}>{value}</option>)}</select></div><div className="ue-person-list">{filteredPeople.map(item => { const data = personUnitPerformanceSummary(w, item.id, period); return <button key={item.id} className={person?.id === item.id ? 'selected' : ''} aria-pressed={person?.id === item.id} onClick={() => setSelectedPerson(item.id)}><span className="ue-avatar">{item.name.slice(0, 1)}</span><span><strong>{item.name}<small>{item.title}</small></strong><em>{item.team}</em><span>{data.units.length}개 단위업무 · 성과 {data.performances.length}건</span><b className={data.evaluation ? 'ue-complete' : ''}>{data.evaluation ? `${scoreText(data.totalScore || 0)} / 50점 · 평가 완료` : data.plan?.submittedAt ? '제출 완료 · 평가 대기' : data.plan ? '업무 비중 설정 · 미제출' : '업무 비중 미설정 · 미제출'}</b></span><ChevronRight size={15} /></button>; })}</div>{!filteredPeople.length && <p className="ue-small-empty">조건에 맞는 직원이 없습니다.</p>}</aside>}
      {person && summary ? <PersonPerformance key={`${person.id}-${period}-${summary.plan?.version || 0}-${summary.plan?.submittedAt || 'unsubmitted'}-${summary.evaluation?.id || 'draft'}`} workspace={w} command={command} onOpenTask={onOpenTask} person={person} period={period} summary={summary} isReviewer={isReviewer} onWeights={() => setWeightsOpen(true)} onEdit={setEditing} /> : <EmptyState title="표시할 직원이 없습니다." description="검색어나 팀을 변경해 확인해 주세요." />}
    </div>
    {weightsOpen && !ownEvaluation && !ownPlan?.submittedAt && <WeightEditor key={period} workspace={w} command={command} period={period} plan={ownPlan} onClose={() => setWeightsOpen(false)} />}
    {editing && !ownEvaluation && !ownPlan?.submittedAt && <PerformanceEditor key={`${period}-${editing === 'new' ? 'new' : editing.id}`} workspace={w} command={command} period={period} existing={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
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

function PersonPerformance({ workspace: w, command, onOpenTask, person, period, summary, isReviewer, onWeights, onEdit }: Props & { person: User; period: string; summary: Summary; isReviewer: boolean; onWeights: () => void; onEdit: (item: Performance) => void }) {
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
  const canEvaluate = isReviewer && !self && !!plan && submitted && !evaluation && !stalePlan && hasEvidence && !needsChanges;
  const missingUnitIds = missingPerformanceUnitIds(w, plan?.allocations || [], summary.performances, evaluationDepartment);
  const incompleteUnits = ratedUnits.filter(unit => missingUnitIds.includes(unit.unitId));
  const incompleteRecords = summary.performances.filter(item => item.departmentId === evaluationDepartment && !hasCompletePerformance(item));
  const canSubmit = self && !isReviewer && !!plan && !submitted && !evaluation && !stalePlan && summary.totalMaxScore === 50 && incompleteUnits.length === 0 && incompleteRecords.length === 0 && ratedPerformances.length > 0 && !needsChanges;
  const allValid = ratedUnits.length > 0 && ratedUnits.every(unit => scores[unit.unitId] !== '' && Number.isFinite(Number(scores[unit.unitId])) && Number(scores[unit.unitId]) >= 0 && Number(scores[unit.unitId]) <= (unit.maxScore || 0) && Math.abs(Number(scores[unit.unitId]) * 100 - Math.round(Number(scores[unit.unitId]) * 100)) < 0.000001);
  const scoreTotal = ratedUnits.reduce((sum, unit) => sum + (Number(scores[unit.unitId]) || 0), 0);
  const displayedTotal = evaluation ? summary.totalScore || 0 : scoreTotal;
  const changeSubmission = async (withdraw: boolean) => {
    if (!plan || saving || (withdraw ? !self || !submitted || !!evaluation : !canSubmit)) return;
    setSaving(true); setError('');
    try {
      const saved = await command(withdraw ? 'performance.withdrawSubmission' : 'performance.submitPerson', { period, ...(withdraw ? {} : { planVersion: plan.version }) });
      if (!saved) setError(withdraw ? '제출을 회수하지 못했습니다. 안내 메시지를 확인해 주세요.' : '성과를 제출하지 못했습니다. 안내 메시지를 확인해 주세요.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '제출 상태를 변경하지 못했습니다.'); }
    finally { setSaving(false); }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (!canEvaluate || !allValid || !plan) return;
    setSaving(true); setError('');
    try { const saved = await command('performance.evaluatePerson', { personId: person.id, period, planVersion: plan.version, scores: ratedUnits.map(unit => ({ unitId: unit.unitId, score: Number(scores[unit.unitId]), comment: comments[unit.unitId] || '' })), comment }); if (!saved) setError('평가를 저장하지 못했습니다. 안내 메시지를 확인해 주세요.'); }
    catch (error) { setError(error instanceof Error ? error.message : '평가를 저장하지 못했습니다.'); }
    finally { setSaving(false); }
  };
  return <section className="ue-person-detail" aria-label={`${person.name} 성과 상세`}>
    <header className="ue-person-heading"><span className="ue-avatar ue-avatar-large">{person.name.slice(0, 1)}</span><div><span>{w.departments.find(department => department.id === person.departmentId)?.name} · {person.team}</span><h2>{person.name}<small>{person.title}</small></h2><p>{periodName(period)} · 단위업무 {summary.units.length}개 · 세부업무 성과 {summary.performances.length}건</p></div><div className="ue-total-score"><span>{evaluation ? '개인 평가 총점' : '업무 비중 합계'}</span><strong>{evaluation ? scoreText(summary.totalScore || 0) : plan ? scoreText(summary.totalMaxScore) : '—'}<small>/ 50</small></strong><Badge tone={evaluation ? 'success' : plan ? 'info' : 'soft'}>{evaluation ? '평가 완료' : submitted ? '제출 완료 · 평가 대기' : '미제출'}</Badge></div></header>
    {evaluationDepartment !== person.departmentId && <div className="ue-notice"><FileText size={18} /><div><strong>이전 부서에서 수행한 성과입니다.</strong><p>기존 성과와 업무 비중을 보존하며, 배점 당시 부서장이 평가합니다. 현재 담당 업무의 접근 권한은 변경되지 않습니다.</p></div></div>}
    {!plan && <div className="ue-notice"><SlidersHorizontal size={18} /><div><strong>단위업무의 업무 비중을 먼저 설정해 주세요.</strong><p>{self ? '각 단위업무의 업무 비중을 합계 50점으로 저장하고, 성과를 확인한 뒤 제출하기를 눌러 주세요.' : `${person.name}님이 업무 비중과 성과를 모두 제출한 뒤 평가를 진행할 수 있습니다.`}</p></div>{self && currentUnits.length > 0 && <Button variant="secondary" onClick={onWeights}>업무 비중 설정 <ArrowRight size={14} /></Button>}</div>}
    {stalePlan && <div className="ue-notice ue-notice-warning"><ClipboardCheck size={18} /><div><strong>단위업무 구성이 변경되었습니다.</strong><p>변경된 단위업무에 맞게 업무 비중을 다시 저장해야 합니다. 이미 제출했다면 먼저 제출을 회수해 주세요.</p></div>{self && !submitted && <Button variant="secondary" onClick={onWeights}>업무 비중 다시 설정</Button>}</div>}
    {evaluation && <div className="ue-notice"><LockKeyhole size={18} /><div><strong>{personName(w, evaluation.evaluatedBy)}님이 평가를 확정했습니다.</strong><p>{new Date(evaluation.evaluatedAt).toLocaleDateString('ko-KR')} · 평가 당시의 업무 비중과 성과를 보존합니다.</p></div></div>}
    {submitted && !evaluation && <div className="ue-notice"><Send size={18} /><div><strong>부서장에게 성과를 제출했습니다.</strong><p>{dateText(plan!.submittedAt!)} · 평가 완료 전 제출을 회수하면 업무 비중과 성과를 수정할 수 있습니다.</p></div>{self && <Button variant="secondary" disabled={saving} onClick={() => void changeSubmission(true)}><Undo2 size={14} />{saving ? '처리 중…' : '제출 회수'}</Button>}</div>}
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
            return <section className="ue-performance" key={performance.id}><div className="ue-performance-heading"><span><FileText size={14} />세부업무</span>{canOpen ? <button type="button" className="ue-task-link" onClick={() => onOpenTask(performance.taskId)}>{source.taskTitle || task.title}<ArrowUpRight size={14} /></button> : <strong>{source.taskTitle || '기존 세부업무'}</strong>}<Badge tone={performance.status === 'changes_requested' ? 'warning' : 'soft'}>{evaluation ? '평가 반영' : performance.status === 'confirmed' ? '기존 확정 성과' : !submitted && performance.status === 'review' ? '작성 완료 · 제출 전' : statusLabels[performance.status]}</Badge></div><h4>{performance.title}</h4><p>{performance.description}</p>{performance.metricName && performance.value !== undefined && <div className="ue-individual-metric">{performance.metricName}<strong>{scoreText(performance.value)} {performance.unit}</strong></div>}<div className="ue-evidence"><span>성과 근거</span><p>{performance.evidence}</p></div>{performance.status === 'changes_requested' && <div className="ue-correction"><p><strong>보완 의견</strong>{performance.comment || '성과 내용과 근거를 보완해 주세요.'}</p></div>}{self && !submitted && !evaluation && performance.status !== 'confirmed' && performance.authorId === w.currentUser.id && <div className="ue-performance-actions"><Button variant="secondary" type="button" onClick={() => onEdit(performance)}><Pencil size={14} />{performance.status === 'changes_requested' ? '성과 보완' : '성과 수정'}</Button></div>}</section>;
          })}{!unit.performances.length && <p className="ue-no-performance"><FileText size={16} />이 단위업무에 등록된 반기 성과가 없습니다.</p>}</div>
          {isRated && <div className="ue-unit-rating"><div><span><ShieldCheck size={15} />부서장 평가</span>{!evaluation && submitted && !evidence.length && <small>제출된 성과가 없어 0점으로 평가합니다.</small>}</div>{evaluation ? <><strong className="ue-readonly-score">{scoreText(unit.score || 0)}<small>/ {scoreText(unit.maxScore || 0)}점</small></strong>{unit.comment && <p className="ue-rating-comment">{unit.comment}</p>}</> : isReviewer ? <><label className="ue-score-input"><span className="sr-only">{unit.unitTitle} 평가 점수</span><input type="number" min="0" max={unit.maxScore || 0} step="0.01" required disabled={!canEvaluate || !evidence.length} value={score} aria-invalid={scoreInvalid} onChange={event => setScores(previous => ({ ...previous, [unit.unitId]: event.target.value }))} placeholder="점수" /><span>/ {scoreText(unit.maxScore || 0)}점</span></label><label className="ue-unit-comment"><span className="sr-only">{unit.unitTitle} 평가 의견</span><textarea rows={2} maxLength={5000} disabled={!canEvaluate} value={comments[unit.unitId] || ''} onChange={event => setComments(previous => ({ ...previous, [unit.unitId]: event.target.value }))} placeholder="이 단위업무의 성과에 대한 의견을 남겨 주세요. (선택)" /></label>{scoreInvalid && <p className="form-error">점수는 0점부터 업무 비중 {scoreText(unit.maxScore || 0)}점 이내로 입력해 주세요.</p>}</> : <span className="ue-awaiting">{submitted ? '부서장 평가 대기' : '제출 후 평가 진행'}</span>}</div>}
        </article>;
      })}</div>
      {!summary.units.length && <EmptyState title="아직 단위업무가 없습니다." description={self ? '개인업무에서 단위업무를 등록한 뒤 업무 비중과 성과를 입력해 주세요.' : '직원이 단위업무와 성과를 등록하면 여기에 표시됩니다.'} />}
      {evaluation && <div className="ue-final-comment"><CheckCheck size={21} /><div><h3>종합 평가 의견</h3><p>{evaluation.comment || '등록된 종합 의견이 없습니다.'}</p></div><strong>{scoreText(summary.totalScore || 0)}<small>/ 50점</small></strong></div>}
      {isReviewer && !evaluation && submitted && plan && <div className="ue-submit-panel"><div><h3>개인 평가 확정</h3><p>각 단위업무에 입력한 점수를 합산합니다. 확정 후에는 업무 비중과 평가를 변경할 수 없습니다.</p></div><Field label="종합 평가 의견 · 선택"><textarea rows={3} maxLength={5000} disabled={!canEvaluate} value={comment} onChange={event => setComment(event.target.value)} placeholder="이번 반기의 성과와 다음 반기의 개선 방향을 기록하세요." /></Field>{!hasEvidence && <p className="ue-validation">제출된 성과가 최소 1건 있어야 평가를 확정할 수 있습니다.</p>}{needsChanges && <p className="ue-validation">보완 요청된 성과를 직원이 다시 제출한 뒤 평가해 주세요.</p>}{stalePlan && <p className="ue-validation">변경된 단위업무의 업무 비중을 다시 설정해야 합니다.</p>}{error && <p className="form-error" role="alert">{error}</p>}<footer><div><span>입력한 평가 총점</span><strong>{scoreText(displayedTotal)}<small>/ 50점</small></strong></div><Button type="submit" disabled={!canEvaluate || !allValid || saving}><CheckCircle2 size={17} />{saving ? '평가 저장 중…' : '개인 평가 확정'}</Button></footer></div>}
    </form>
    {self && !isReviewer && !submitted && !evaluation && <section className="ue-submit-panel ue-person-submission" aria-label="성과 제출">
      <div><h3>성과와 업무 비중을 확인하고 제출하세요.</h3><p>제출하면 부서장이 단위업무별 성과를 평가합니다. 부서 담당자는 제출 여부를 확인할 수 있습니다.</p></div>
      <ul className="ue-readiness"><li data-ready={!!plan && !stalePlan && summary.totalMaxScore === 50}><CheckCircle2 size={16} /><span>모든 단위업무의 업무 비중 합계 50점</span><strong>{plan ? `${scoreText(summary.totalMaxScore)} / 50점` : '설정 필요'}</strong></li><li data-ready={!!plan && incompleteUnits.length === 0 && incompleteRecords.length === 0 && ratedPerformances.length > 0 && !needsChanges}><CheckCircle2 size={16} /><span>업무 비중이 있는 단위업무의 성과 작성</span><strong>{plan ? incompleteUnits.length ? `${incompleteUnits.length}개 미작성` : needsChanges || incompleteRecords.length ? '보완 필요' : ratedPerformances.length ? '작성 완료' : '작성 필요' : '비중 설정 후 확인'}</strong></li></ul>
      {incompleteUnits.length > 0 && <p className="ue-validation">성과를 입력할 단위업무: {incompleteUnits.map(unit => unit.unitTitle).join(', ')}</p>}
      {incompleteRecords.length > 0 && <p className="ue-validation">제목·내용·근거가 누락된 성과 {incompleteRecords.length}건을 보완해 주세요.</p>}
      {needsChanges && <p className="ue-validation">보완 요청된 성과를 수정하여 저장한 뒤 제출해 주세요.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><p className="ue-footnote">제출 전에는 저장한 성과와 업무 비중을 수정할 수 있습니다.</p><Button disabled={!canSubmit || saving} onClick={() => void changeSubmission(false)}><Send size={17} />{saving ? '제출 중…' : '제출하기'}</Button></footer>
    </section>}
    {summary.performances.length > 0 && <p className="ue-footnote">같은 지표명·단위의 수치는 합산합니다. 비율·평균·점수는 개별 값으로 표시하며, 세부업무별 과거 100점 평가는 이번 50점 총점에 포함하지 않습니다.</p>}
  </section>;
}

function WeightEditor({ workspace: w, command, period, plan, onClose }: { workspace: Workspace; command: CommandFn; period: string; plan?: UnitScorePlan; onClose: () => void }) {
  const units = scoreUnitsForPeriod(w, w.currentUser.id, period);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(units.map(unit => [unit.id, String(plan?.allocations.find(item => item.unitId === unit.id)?.maxScore ?? '')])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const total = units.reduce((sum, unit) => sum + (Number(values[unit.id]) || 0), 0);
  const valid = units.length > 0 && Math.abs(total - 50) < 0.000001 && units.every(unit => values[unit.id] !== '' && Number.isFinite(Number(values[unit.id])) && Number(values[unit.id]) >= 0 && Number(values[unit.id]) <= 50 && Math.abs(Number(values[unit.id]) * 100 - Math.round(Number(values[unit.id]) * 100)) < 0.000001);
  return <Modal title="단위업무별 업무 비중 설정" description={`${periodName(period)} · 내 단위업무의 업무 비중 합계를 50점으로 정합니다.`} onClose={onClose}><form className="form-stack" onSubmit={async event => { event.preventDefault(); if (!valid) return; setSaving(true); setError(''); try { const saved = await command('performance.setWeights', { period, allocations: units.map(unit => ({ unitId: unit.id, maxScore: Number(values[unit.id]) })) }); if (saved) onClose(); else setError('업무 비중을 저장하지 못했습니다. 안내 메시지를 확인해 주세요.'); } catch (error) { setError(error instanceof Error ? error.message : '업무 비중을 저장하지 못했습니다.'); } finally { setSaving(false); } }}><div className="ue-weight-total" data-valid={valid}><div><span>업무 비중 합계</span><strong>{scoreText(total)}<small>/ 50점</small></strong></div><span>{valid ? '합계가 50점입니다.' : total > 50 ? `${scoreText(total - 50)}점을 줄여 주세요.` : `${scoreText(50 - total)}점을 더 배정해 주세요.`}</span></div><div className="ue-weight-fields">{units.map((unit, index) => <label key={unit.id}><span><small>단위업무 {index + 1}</small><strong>{unit.title}</strong></span><span><input type="number" min="0" max="50" step="0.01" required aria-label={`${unit.title} 업무 비중`} value={values[unit.id]} onChange={event => setValues(previous => ({ ...previous, [unit.id]: event.target.value }))} placeholder="0" /><small>점</small></span></label>)}</div><p className="ue-footnote">업무 비중은 각 단위업무의 최고 점수입니다. 평가 대상이 아닌 단위업무는 0점으로 설정할 수 있습니다. 제출 전까지 수정할 수 있으며, 저장 후에는 성과 · 평가에서 제출하기를 눌러 주세요.</p>{error && <p role="alert" className="form-error">{error}</p>}<div className="form-actions"><Button variant="secondary" type="button" onClick={onClose}>취소</Button><Button type="submit" disabled={!valid || saving}><Save size={16} />{saving ? '저장 중…' : '업무 비중 저장'}</Button></div></form></Modal>;
}

export function PerformanceEditor({ workspace: w, command, period, existing, fixedTaskId, embedded = false, onClose }: { workspace: Workspace; command: CommandFn; period: string; existing?: Performance; fixedTaskId?: string; embedded?: boolean; onClose: () => void }) {
  const plan = getUnitScorePlan(w, w.currentUser.id, period);
  const tasks = activeTasks(w, w.currentUser.id).filter(task => !plan || task.departmentId === plan.departmentId);
  const current = currentPersonPerformances(w, w.currentUser.id, period);
  const record = existing || (fixedTaskId ? current.find(item => item.taskId === fixedTaskId) : undefined);
  const pinnedTaskId = fixedTaskId || record?.taskId;
  const eligible = tasks.filter(task => pinnedTaskId ? task.id === pinnedTaskId : !current.some(item => item.taskId === task.id));
  const [taskId, setTaskId] = useState(pinnedTaskId || eligible[0]?.id || '');
  const [title, setTitle] = useState(record?.title || '');
  const [description, setDescription] = useState(record?.description || '');
  const [evidence, setEvidence] = useState(record?.evidence || '');
  const [metricName, setMetricName] = useState(record?.metricName || '');
  const [value, setValue] = useState(record?.value === undefined ? '' : String(record.value));
  const [unit, setUnit] = useState(record?.unit || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const locked = !!getUnitScorePlan(w, w.currentUser.id, period)?.submittedAt || !!getUnitEvaluation(w, w.currentUser.id, period) || record?.status === 'confirmed';
  const ownHistoricalRecord = record?.authorId === w.currentUser.id && record.period === period && record.taskId === taskId;
  const valid = !locked && (ownHistoricalRecord || eligible.some(task => task.id === taskId)) && !!title.trim() && !!description.trim() && !!evidence.trim() && (value === '' || Number.isFinite(Number(value)));
  const form = <form className="form-stack ue-performance-editor" onSubmit={async event => {
    event.preventDefault(); if (!valid || saving) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      const completed = await command('performance.saveHalf', { taskId, period, title, description, evidence, metricName: metricName || undefined, value: value === '' ? undefined : Number(value), unit: unit || undefined });
      if (completed) { setSaved(true); onClose(); }
      else setError('성과를 저장하지 못했습니다. 안내 메시지를 확인해 주세요.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '성과를 저장하지 못했습니다.'); }
    finally { setSaving(false); }
  }}>
    {ownHistoricalRecord && !eligible.length && <div className="ue-notice"><FileText size={18} /><div><strong>인수인계 전 작성한 내 성과를 보완합니다.</strong><p>이 성과의 작성자·당시 부서·단위업무는 보존됩니다. 후임자의 업무 내용은 변경하지 않습니다.</p></div></div>}
    {record?.status === 'changes_requested' && record.comment && <div className="ue-notice"><ClipboardCheck size={18} /><div><strong>부서장 보완 의견</strong><p>{record.comment}</p></div></div>}
    <p className="ue-footnote">{periodName(period)} 성과를 저장합니다. 성과 · 평가에서 단위업무별 업무 비중을 정한 뒤 제출하기를 눌러 주세요.</p>
    {pinnedTaskId ? <div className="ue-editor-task"><FolderOpen size={17} /><div><small>{w.units.find(item => item.id === tasks.find(task => task.id === pinnedTaskId)?.unitId)?.title}</small><strong>{tasks.find(task => task.id === pinnedTaskId)?.title || '이전 담당 업무 · ' + (record?.title || '기존 성과')}</strong></div></div> : <Field label="세부업무"><select required disabled={saving || locked} value={taskId} onChange={event => { setTaskId(event.target.value); setSaved(false); }}><option value="">성과를 기록할 업무 선택</option>{eligible.map(task => <option key={task.id} value={task.id}>{w.units.find(item => item.id === task.unitId)?.title} › {task.title}</option>)}</select></Field>}
    {!eligible.length && !ownHistoricalRecord && <p role="alert" className="ue-validation">새로 작성할 세부업무가 없습니다. 이미 작성한 성과는 단위업무별 성과 목록에서 수정할 수 있습니다.</p>}
    {locked && <p className="ue-validation">제출되었거나 평가가 확정된 성과입니다. 제출한 성과는 성과 · 평가에서 제출을 회수한 후 수정할 수 있습니다.</p>}
    <fieldset disabled={saving || locked} className="ue-editor-fields" onChange={() => setSaved(false)}>
      <Field label="성과 제목"><input required maxLength={150} value={title} onChange={event => setTitle(event.target.value)} placeholder="예: 예산 집행 자료의 정확도 및 처리 속도 개선" /></Field>
      <Field label="성과 내용"><textarea required rows={4} maxLength={5000} value={description} onChange={event => setDescription(event.target.value)} placeholder="목표 대비 결과, 추진 내용, 개선 사항을 기록하세요." /></Field>
      <div className="ue-performance-metric-fields"><Field label="성과 지표 · 선택"><input value={metricName} onChange={event => setMetricName(event.target.value)} placeholder="예: 점검 완료 사업" maxLength={150} /></Field><Field label="달성 수치 · 선택"><input type="number" step="any" value={value} onChange={event => setValue(event.target.value)} placeholder="0" /></Field><Field label="단위 · 선택"><input value={unit} onChange={event => setUnit(event.target.value)} placeholder="건, %, 명" maxLength={30} /></Field></div>
      <Field label="성과 근거"><textarea required rows={3} maxLength={5000} value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="결과보고서, 실적 수치의 산출 기준, 확인 가능한 자료를 작성하세요." /></Field>
    </fieldset>
    {error && <p role="alert" className="form-error">{error}</p>}{saved && embedded && <p role="status" className="ue-save-success"><CheckCircle2 size={16} />성과를 저장했습니다. 성과 · 평가에서 제출을 진행해 주세요.</p>}
    <div className="form-actions">{!embedded && <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>취소</Button>}<Button type="submit" disabled={saving || !valid}><Save size={16} />{saving ? '저장 중…' : '성과 저장'}</Button></div>
  </form>;
  return embedded ? form : <Modal title={record ? '업무 성과 수정' : '반기 성과 입력'} description={`${periodName(period)} · 세부업무별 성과가 단위업무 아래 모입니다.`} wide onClose={onClose}>{form}</Modal>;
}

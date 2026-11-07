'use client';

import { useState, type FormEvent } from 'react';
import { CalendarDays, CheckCircle2, ChevronRight, Clock3, FileText, LockKeyhole, Save, UserRound } from 'lucide-react';
import type { CommonDistribution, CommonTask, DirectiveMonthlyReport, Workspace } from '@/lib/types';
import { canRecordDirectiveReport, directiveIssuerLabels, directiveReportStartMonth, isCentralDirective } from '@/lib/directives';
import { Badge, Button, EmptyState, Field, Modal, type CommandFn } from './ui';
import './directive-monthly.css';

type Props = {
  workspace: Workspace;
  common: CommonTask;
  distribution: CommonDistribution;
  command: CommandFn;
  embedded?: boolean;
  onClose?: () => void;
  initialMonth?: string;
};

const monthLabel = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`;
const dateLabel = (date: string) => new Date(date).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const personName = (w: Workspace, userId?: string) => w.users.find(user => user.id === userId)?.name || w.identities?.find(user => user.id === userId)?.name || '담당자';

export function DirectiveMonthlyReports({ workspace: w, common: initialCommon, distribution: initialDistribution, command, embedded = false, onClose, initialMonth }: Props) {
  const common = w.commonTasks.find(item => item.id === initialCommon.id) || initialCommon;
  const distribution = common.distributions.find(item => item.id === initialDistribution.id) || initialDistribution;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(w.serverTime));
  const currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(initialMonth && /^20\d{2}-(0[1-9]|1[0-2])$/.test(initialMonth) ? initialMonth : currentMonth);
  const [saving, setSaving] = useState(false);
  const reports = [...(distribution.monthlyReports || [])].sort((a, b) => b.month.localeCompare(a.month));
  const selected = reports.find(report => report.month === month);
  const startMonth = directiveReportStartMonth(common, distribution);
  const canRecord = canRecordDirectiveReport(w, w.currentUser, common, distribution, new Date(w.serverTime));
  const monthAllowed = /^20\d{2}-(0[1-9]|1[0-2])$/.test(month) && month >= startMonth && month <= currentMonth;
  const registered = ['registered', 'assigned', 'submitted'].includes(distribution.status);
  const completed = distribution.executionStatus === 'completed' || distribution.stage === 'completed';
  const department = (w.departmentDirectory || w.departments).find(item => item.id === distribution.departmentId)?.name || '담당 부서';
  const currentAssigneeId = distribution.currentAssigneeId || distribution.taskOwnerId || distribution.assigneeId;
  const unavailable = completed ? '완료된 지시사항입니다. 월별 실적은 보존되며 새로 작성하거나 수정할 수 없습니다.' : !registered ? '팀·개인 배정과 내 단위업무 등록을 마친 뒤 담당자가 매월 실적을 기록할 수 있습니다.' : ['archived', 'deleted'].includes(distribution.executionStatus || '') ? '보관되거나 삭제된 업무의 월별 실적은 조회만 가능합니다.' : '현재 수행 담당자가 완료 전까지 월별 실적을 작성합니다. 이 화면에서는 저장된 실적을 확인할 수 있습니다.';

  const content = <section className="dm-view" aria-label="지시사항 월별 실적관리">
    <header className="dm-context">
      <div className="dm-context-title"><FileText size={21} /><div><span>{common.directiveIssuer ? `${directiveIssuerLabels[common.directiveIssuer]} 지시사항` : '지시사항 · 지시자 미등록'}</span><h3>{common.title}</h3></div></div>
      <div className="dm-context-facts"><span><CalendarDays size={14} />지시일자 {common.instructedOn?.replaceAll('-', '.') || '미등록'}</span><span>{department}{distribution.team ? ` · ${distribution.team}` : ''}</span><span><UserRound size={14} />{currentAssigneeId ? personName(w, currentAssigneeId) : '담당자 배정 전'}</span></div>
      {isCentralDirective(common) && <p className="dm-coordinator">장·차관 지시사항 · 기획재정담당관실 기획팀 총괄 관리</p>}
    </header>
    <div className="dm-month-bar"><label><CalendarDays size={18} /><span>실적 대상 월</span><input aria-label="실적 대상 월" type="month" required min={canRecord ? startMonth : undefined} max={currentMonth} value={month} disabled={saving} onChange={event => setMonth(event.target.value)} /></label><Badge tone={selected ? 'success' : 'soft'}>{selected ? '실적 등록' : '실적 미등록'}</Badge></div>
    {!canRecord && <p className="dm-readonly"><LockKeyhole size={16} />{unavailable}</p>}
    {canRecord && !monthAllowed && <p className="dm-validation" role="alert">{monthLabel(startMonth)}부터 이번 달까지의 실적을 입력할 수 있습니다.</p>}
    {canRecord && monthAllowed ? <MonthlyReportForm key={`${distribution.id}-${month}`} workspace={w} common={common} distribution={distribution} month={month} report={selected} command={command} onSavingChange={setSaving} /> : selected ? <div className="dm-selected-record"><div className="dm-record-meta"><strong>{monthLabel(selected.month)} 실적</strong><span>{personName(w, selected.authorId)} · {dateLabel(selected.updatedAt)}</span></div><ReportBody report={selected} /></div> : <EmptyState title={`${month ? monthLabel(month) : '선택한 월'} 실적이 없습니다.`} description={completed ? '업무 완료 전 저장한 다른 월의 실적은 아래 이력에서 확인할 수 있습니다.' : '담당자가 월별 추진 실적을 저장하면 이곳에 표시됩니다.'} />}
    <section className="dm-history" aria-label="월별 실적 이력"><header><h3><Clock3 size={17} />월별 실적 이력</h3><span>{reports.length}개월 기록</span></header>{reports.length ? <div className="dm-history-list">{reports.map(report => <details key={report.id} className="dm-history-item"><summary><span><strong>{monthLabel(report.month)}</strong><small>{personName(w, report.authorId)} · {dateLabel(report.updatedAt)}</small></span><ChevronRight size={16} /></summary><ReportBody report={report} />{canRecord && report.month >= startMonth && report.month <= currentMonth && <Button data-task-action="true" variant="ghost" disabled={saving} onClick={() => setMonth(report.month)}>이 달 실적 수정<ChevronRight size={14} /></Button>}</details>)}</div> : <p className="dm-history-empty">아직 등록된 월별 실적이 없습니다. 지시사항을 완료하기 전까지 매월 추진 내용을 기록하세요.</p>}</section>
    <p className="dm-footnote">{canRecord ? '같은 달의 실적은 수정하여 저장할 수 있습니다. 월별 실적 저장은 업무의 절차 완료 상태를 변경하지 않습니다.' : '월별 추진 실적과 업무 절차의 완료 상태는 별도로 관리합니다. 완료 전 저장한 실적 이력은 계속 확인할 수 있습니다.'}</p>
    {!embedded && onClose && <div className="form-actions"><Button variant="secondary" disabled={saving} onClick={onClose}>닫기</Button></div>}
  </section>;

  return embedded || !onClose ? content : <Modal title="지시사항 월별 실적관리" description="담당자가 완료 전까지 매월 추진 실적을 기록하고, 총괄 부서에서 함께 확인합니다." wide onClose={onClose}>{content}</Modal>;
}

function ReportBody({ report }: { report: DirectiveMonthlyReport }) {
  return <dl className="dm-report-body"><div><dt>추진 실적</dt><dd>{report.achievements}</dd></div>{report.nextPlan && <div><dt>향후 계획</dt><dd>{report.nextPlan}</dd></div>}{report.issues && <div><dt>쟁점·지원 요청</dt><dd>{report.issues}</dd></div>}</dl>;
}

function MonthlyReportForm({ workspace: w, common, distribution, month, report, command, onSavingChange }: { workspace: Workspace; common: CommonTask; distribution: CommonDistribution; month: string; report?: DirectiveMonthlyReport; command: CommandFn; onSavingChange: (saving: boolean) => void }) {
  const [achievements, setAchievements] = useState(report?.achievements || '');
  const [nextPlan, setNextPlan] = useState(report?.nextPlan || '');
  const [issues, setIssues] = useState(report?.issues || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const valid = !!achievements.trim();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || saving || !canRecordDirectiveReport(w, w.currentUser, common, distribution, new Date(w.serverTime))) return;
    setSaving(true); onSavingChange(true); setSaved(false); setError('');
    try {
      if (await command('directive.saveMonthlyReport', { commonId: common.id, distributionId: distribution.id, month, achievements, nextPlan, issues })) setSaved(true);
      else setError('월별 실적을 저장하지 못했습니다. 안내 메시지를 확인하고 다시 저장해 주세요.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '월별 실적을 저장하지 못했습니다.'); }
    finally { setSaving(false); onSavingChange(false); }
  }
  return <form className="form-stack dm-report-form" onSubmit={submit}>
    <div className="dm-form-heading"><h3>{monthLabel(month)} 추진 실적</h3>{report && <span>최근 저장 {dateLabel(report.updatedAt)}</span>}</div>
    <fieldset disabled={saving} onChange={() => setSaved(false)}><Field label="추진 실적"><textarea required rows={5} maxLength={5000} value={achievements} onChange={event => setAchievements(event.target.value)} placeholder="이번 달 추진 내용, 달성 결과와 확인 가능한 근거를 입력하세요." /></Field><div className="dm-form-grid"><Field label="향후 계획 · 선택"><textarea rows={3} maxLength={5000} value={nextPlan} onChange={event => setNextPlan(event.target.value)} placeholder="다음 달 추진 일정과 남은 조치를 기록하세요." /></Field><Field label="쟁점·지원 요청 · 선택"><textarea rows={3} maxLength={5000} value={issues} onChange={event => setIssues(event.target.value)} placeholder="추진 과정의 어려움이나 협조가 필요한 내용을 기록하세요." /></Field></div></fieldset>
    {error && <p className="dm-validation" role="alert">{error}</p>}{saved && <p className="dm-save-success" role="status"><CheckCircle2 size={16} />{monthLabel(month)} 실적을 저장했습니다.</p>}
    <div className="dm-form-footer"><span>업무 완료 전까지 매월 기록을 추가하거나 수정할 수 있습니다.</span><Button type="submit" disabled={!valid || saving}><Save size={16} />{saving ? '저장 중…' : '월별 실적 저장'}</Button></div>
  </form>;
}

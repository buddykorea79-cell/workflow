'use client';

import { useState } from 'react';
import { ArrowRight, Building2, CalendarDays, Save } from 'lucide-react';
import type { CommonDistribution, CommonTask, DirectiveIssuer, Workspace } from '@/lib/types';
import { directiveIssuerLabels, directiveReportStartMonth } from '@/lib/directives';
import { Badge, Button, EmptyState, Field, Modal, type CommandFn } from './ui';
import './directive-overview.css';

const koreaDate = (value: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const personName = (w: Workspace, id?: string) => w.users.find(item => item.id === id)?.name || w.identities?.find(item => item.id === id)?.name || '미배정';
const departmentName = (w: Workspace, id: string) => (w.departmentDirectory || w.departments).find(item => item.id === id)?.name || '부서';

function reportStatus(common: CommonTask, distribution: CommonDistribution, month: string) {
  if (directiveReportStartMonth(common, distribution) > month) return { label: '지시 전', state: 'not_due' };
  if (distribution.monthlyReports?.some(report => report.month === month)) return { label: '입력 완료', state: 'recorded' };
  if (distribution.executionStatus === 'completed' || distribution.stage === 'completed') return { label: '업무 완료', state: 'complete' };
  if (['archived', 'deleted'].includes(distribution.executionStatus || '')) return { label: '업무 보관·삭제', state: 'not_due' };
  if (!['registered', 'assigned', 'submitted'].includes(distribution.status)) return { label: '담당자 등록 전', state: 'not_due' };
  return { label: '미입력', state: 'missing' };
}

export function DirectiveOverview({ workspace: w, commons, onOpenReport }: { workspace: Workspace; commons: CommonTask[]; onOpenReport: (commonId: string, distributionId: string, month: string) => void }) {
  const currentMonth = koreaDate(w.serverTime).slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [issuer, setIssuer] = useState('all');
  const [status, setStatus] = useState('all');
  const rows = commons.filter(common => issuer === 'all' || common.directiveIssuer === issuer).flatMap(common => common.distributions.map(distribution => ({ common, distribution, report: distribution.monthlyReports?.find(item => item.month === month), ...reportStatus(common, distribution, month) })));
  const displayed = rows.filter(row => status === 'all' || row.state === status);
  return <section className="do-panel" aria-label="장·차관 지시사항 월별 통합 관리">
    <header><div><span><Building2 size={16} />기획재정담당관실 기획팀</span><h2>장·차관 지시사항 통합 관리</h2><p>각 부서가 등록한 장·차관 지시사항과 담당자의 월별 추진실적을 함께 확인합니다.</p></div><Badge tone="info">장관 · 차관</Badge></header>
    <div className="do-controls"><label><CalendarDays size={16} /><span>실적 관리월</span><input aria-label="지시사항 실적 관리월" type="month" required max={currentMonth} value={month} onChange={event => { if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(event.target.value) && event.target.value <= currentMonth) setMonth(event.target.value); }} /></label><select aria-label="통합 관리 지시자" value={issuer} onChange={event => setIssuer(event.target.value)}><option value="all">장·차관 전체</option><option value="minister">장관</option><option value="vice_minister">차관</option></select><select aria-label="월별 실적 입력 상태" value={status} onChange={event => setStatus(event.target.value)}><option value="all">모든 입력 상태</option><option value="missing">미입력</option><option value="recorded">입력 완료</option><option value="complete">업무 완료 · 실적 없음</option><option value="not_due">등록 전 · 해당 없음</option></select></div>
    <div className="do-stats"><div><span>지시사항</span><strong>{new Set(rows.map(row => row.common.id)).size}<small>건</small></strong></div><div><span>대상 부서 배정</span><strong>{rows.length}<small>건</small></strong></div><div><span>{month.slice(5)}월 실적 입력</span><strong>{rows.filter(row => row.state === 'recorded').length}<small>건</small></strong></div><div data-warning><span>수행 중 · 실적 미입력</span><strong>{rows.filter(row => row.state === 'missing').length}<small>건</small></strong></div></div>
    {displayed.length ? <div className="do-table-wrap"><table><thead><tr><th>지시사항 · 지시정보</th><th>담당 부서 · 담당자</th><th>추진 상태</th><th>선택 월 실적</th><th>확인</th></tr></thead><tbody>{displayed.map(({ common, distribution, report, label, state }) => <tr key={`${common.id}-${distribution.id}`}><td><strong>{common.title}</strong><small>{common.directiveIssuer ? directiveIssuerLabels[common.directiveIssuer] : '지시자 미입력'} · {common.instructedOn || '지시일자 미입력'}</small></td><td><strong>{departmentName(w, distribution.departmentId)}</strong><small>{distribution.team || '팀 미배정'} · {personName(w, distribution.currentAssigneeId || distribution.assigneeId)}</small></td><td><Badge tone={distribution.stage === 'completed' ? 'success' : 'soft'}>{distribution.stage === 'completed' ? '완료' : distribution.executionStatus === 'paused' ? '일시중지' : ['registered', 'assigned', 'submitted'].includes(distribution.status) ? '수행 중' : '배정·등록 중'}</Badge></td><td><Badge tone={state === 'recorded' ? 'success' : state === 'missing' ? 'warning' : 'soft'}>{label}</Badge>{report && <p>{report.achievements}</p>}</td><td><Button variant="ghost" onClick={() => onOpenReport(common.id, distribution.id, month)}>실적 보기<ArrowRight size={14} /></Button></td></tr>)}</tbody></table></div> : <EmptyState title="표시할 장·차관 지시사항이 없습니다." description="등록된 지시사항이나 조회 조건을 확인해 주세요." />}
    <p className="do-footnote">완료한 업무의 지난 실적은 보존됩니다. 월별 실적은 해당 업무 담당자가 입력하며, 기획팀에서는 부서별 실적 확인과 지시정보·배포 대상을 관리합니다.</p>
  </section>;
}

export function DirectiveMetadataEditor({ workspace: w, common, command, onClose }: { workspace: Workspace; common: CommonTask; command: CommandFn; onClose: () => void }) {
  const [issuer, setIssuer] = useState<DirectiveIssuer | ''>(common.directiveIssuer || '');
  const [instructedOn, setInstructedOn] = useState(common.instructedOn || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const onlyCentral = w.currentUser.role !== 'admin' && !(common.managerId === w.currentUser.id);
  return <Modal title="지시정보 수정" description={common.title} onClose={onClose}><form className="form-stack" onSubmit={async event => {
    event.preventDefault(); if (!issuer || !instructedOn || saving) return;
    setSaving(true); setError('');
    try { if (await command('directive.updateMetadata', { commonId: common.id, directiveIssuer: issuer, instructedOn })) onClose(); else setError('지시정보를 저장하지 못했습니다. 안내 메시지를 확인해 주세요.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '저장하지 못했습니다.'); }
    finally { setSaving(false); }
  }}><Field label="지시자"><select required disabled={saving} value={issuer} onChange={event => setIssuer(event.target.value as DirectiveIssuer)}><option value="">선택해 주세요</option>{Object.entries(directiveIssuerLabels).filter(([key]) => !onlyCentral || ['minister', 'vice_minister'].includes(key)).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></Field><Field label="지시일자"><input required disabled={saving} type="date" max={koreaDate(w.serverTime)} value={instructedOn} onChange={event => setInstructedOn(event.target.value)} /></Field><p className="muted">장·차관 지시사항은 기획재정담당관실 기획팀의 통합 관리 대상입니다. 기존 월별 실적은 보존됩니다.</p>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><Button variant="secondary" disabled={saving} onClick={onClose}>취소</Button><Button type="submit" disabled={saving || !issuer || !instructedOn}><Save size={16} />{saving ? '저장 중…' : '지시정보 저장'}</Button></div></form></Modal>;
}

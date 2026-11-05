'use client';

import { useState } from 'react';
import { ArrowLeftRight, ArrowRight, Building2, Clock3, GitBranch, Inbox, Search, ShieldCheck, Users } from 'lucide-react';
import type { CommonDistribution, CommonTask, Workspace } from '@/lib/types';
import { Badge, Button, EmptyState, Field, Modal, formatDate, type CommandFn } from './ui';
import './allocation-review.css';

type Tab = 'received' | 'approvals' | 'handovers';
type Allocation = { common: CommonTask; distribution: CommonDistribution };
type Props = { workspace: Workspace; command: CommandFn; onOpenCommon: () => void; onOpenHandover: () => void; onOpenDivision: () => void };
const distributionLabels: Record<CommonDistribution['status'], string> = { pending: '팀 배부 대기', team_assigned: '담당자 배정 대기', person_assigned: '개인업무 등록 대기', registered: '수행 중', assigned: '수행 중', submitted: '완료' };
const approvalLabels = { pending: '부서장 승인 대기', approved: '승인 완료', rejected: '반려' };
function distributionState(distribution: CommonDistribution): { label: string; tone: 'warning' | 'success' | 'info' | 'soft' } {
  if (distribution.executionStatus === 'deleted' || distribution.executionStatus === 'archived') return { label: distribution.executionStatus === 'deleted' ? '삭제된 업무' : '보관된 업무', tone: 'soft' };
  if (distribution.executionStatus === 'paused') return { label: '일시 중지', tone: 'warning' };
  if (distribution.stage === 'completed' || distribution.executionStatus === 'completed') return { label: '완료', tone: 'success' };
  if (distribution.executionStatus === 'review') return { label: '검토 대기', tone: 'info' };
  if (distribution.stage === 'in_progress' || distribution.executionStatus === 'in_progress') return { label: '수행 중', tone: 'info' };
  return { label: distributionLabels[distribution.status], tone: distribution.status === 'pending' ? 'warning' : 'info' };
}

export function AllocationReview({ workspace: w, command, onOpenCommon, onOpenHandover, onOpenDivision }: Props) {
  const [departmentId, setDepartmentId] = useState(w.currentUser.departmentId);
  const [tab, setTab] = useState<Tab>('received');
  const [query, setQuery] = useState('');
  const [onlyPending, setOnlyPending] = useState(true);
  const [selection, setSelection] = useState<Allocation | null>(null);
  if (!['manager', 'admin'].includes(w.currentUser.role)) return <EmptyState title="부서 담당자의 관리 화면입니다." description="공통업무와 인수인계 메뉴에서 본인에게 해당하는 업무를 확인해 주세요."/>;
  const department = w.departments.find(item => item.id === departmentId);
  const nameOf = (id?: string) => w.users.find(item => item.id === id)?.name || w.identities?.find(item => item.id === id)?.name || '담당자 확인 필요';
  const received = w.commonTasks.flatMap(common => common.distributions.filter(distribution => distribution.departmentId === departmentId).map(distribution => ({ common, distribution })));
  const requests = w.commonTasks.flatMap(common => (common.approvalRequests || []).filter(request => request.departmentId === departmentId).map(request => ({ common, request }))).sort((a, b) => b.request.requestedAt.localeCompare(a.request.requestedAt));
  const handovers = (w.workTransfers || []).filter(item => item.departmentId === departmentId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pendingReceived = received.filter(item => item.distribution.status === 'pending').length;
  const pendingRequests = requests.filter(item => item.request.status === 'pending').length;
  const pendingHandovers = handovers.filter(item => item.status === 'pending').length;
  const search = query.trim().toLocaleLowerCase();
  const matches = (value: string) => !search || value.toLocaleLowerCase().includes(search);
  const visibleReceived = received.filter(({ common, distribution }) => (!onlyPending || distribution.status === 'pending') && matches(`${common.title} ${distribution.team || ''} ${nameOf(distribution.leadId)}`));
  const visibleRequests = requests.filter(({ common, request }) => (!onlyPending || request.status === 'pending') && matches(`${common.title} ${nameOf(request.requestedBy)} ${request.reason || ''}`));
  const visibleHandovers = handovers.filter(item => (!onlyPending || item.status === 'pending') && matches(`${item.fromName} ${item.toName} ${item.reason}`));
  const locked = w.departmentWorkPlans?.some(item => item.departmentId === departmentId && item.status === 'confirmed');
  const tabs = [{ id: 'received' as const, title: '받은 업무 배부', count: pendingReceived, icon: Inbox }, { id: 'approvals' as const, title: '공통업무 승인 현황', count: pendingRequests, icon: ShieldCheck }, { id: 'handovers' as const, title: '인수인계 현황', count: pendingHandovers, icon: ArrowLeftRight }];
  return <div className="allocation-page">
    <header className="page-heading"><div><p className="eyebrow">부서 담당자 워크스페이스</p><h1>배부·승인 관리</h1><p>{department?.name} · 접수된 업무를 팀에 배부하고, 부서장 승인 진행을 확인합니다.</p></div><Button variant="secondary" onClick={onOpenDivision}><Users size={17}/>업무분장표</Button></header>
    {w.currentUser.role === 'admin' && <Field label="관리할 부서"><select aria-label="배부 관리 부서" value={departmentId} onChange={event => { setDepartmentId(event.target.value); setSelection(null); setQuery(''); }}>{w.departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>}
    <section className="allocation-responsibility"><ShieldCheck size={22}/><div><strong>배부는 부서 담당자가, 최종 승인은 부서장이 맡습니다.</strong><p>공통업무 배포 요청과 인수인계 요청의 승인·반려 결과를 이곳에서 함께 확인할 수 있습니다.</p></div></section>
    <div className="allocation-tabs" role="tablist" aria-label="배부·승인 업무 구분">{tabs.map(({ id, title, count, icon: Icon }) => <button key={id} id={`allocation-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`allocation-panel-${id}`} onClick={() => { setTab(id); setQuery(''); setOnlyPending(true); }}><Icon size={21}/><span>{title}<small>{id === 'received' ? '담당 팀을 지정할 업무' : '부서장 승인 대기'}</small></span><strong>{count}</strong></button>)}</div>
    <section className="allocation-panel" id={`allocation-panel-${tab}`} role="tabpanel" aria-labelledby={`allocation-tab-${tab}`}>
      <div className="allocation-toolbar"><div><h2>{tabs.find(item => item.id === tab)?.title}</h2><p>{tab === 'received' ? '우리 부서에 접수된 공통업무와 지시사항입니다. 새 업무는 작성 부서장 승인 후 도착합니다.' : tab === 'approvals' ? '우리 부서에서 작성했거나 추가 배포를 요청한 업무의 승인 기록입니다.' : '업무와 역할의 새 담당자 배정은 부서장 승인 후 반영됩니다.'}</p></div><Button variant="secondary" onClick={tab === 'handovers' ? onOpenHandover : onOpenCommon}>{tab === 'handovers' ? '인수인계 열기' : '공통업무 열기'}<ArrowRight size={16}/></Button></div>
      <div className="allocation-filters"><label className="allocation-search"><Search size={18}/><input value={query} onChange={event => setQuery(event.target.value)} aria-label="배부·승인 검색" placeholder={tab === 'handovers' ? '인계자·인수자·사유 검색' : '업무명·담당자 검색'}/></label><div className="allocation-status-filter" aria-label="처리 상태"><button aria-pressed={onlyPending} onClick={() => setOnlyPending(true)}>{tab === 'received' ? '배부 대기' : '승인 대기'}</button><button aria-pressed={!onlyPending} onClick={() => setOnlyPending(false)}>전체 내역</button></div></div>
      {tab === 'received' && <>{locked && <div className="allocation-lock"><Clock3 size={18}/><p>업무분장이 확정되어 있습니다. 부서장이 재작성을 허용하면 팀 배부를 진행할 수 있습니다.</p></div>}{visibleReceived.length ? <div className="allocation-list">{visibleReceived.map(({ common, distribution }) => <article key={distribution.id}><span className="allocation-row-icon"><Inbox size={21}/></span><div className="allocation-row-main"><div className="allocation-row-meta"><Badge tone={common.kind === 'directive' ? 'info' : 'soft'}>{common.kind === 'directive' ? '지시사항' : '공통업무'}</Badge><span>접수 {formatDate(distribution.distributedAt)}</span></div><h3>{common.title}</h3><p>{distribution.team ? `${distribution.team} · ${nameOf(distribution.leadId)}` : '담당 팀을 지정해 주세요.'}<span>제출기한 {formatDate(common.dueDate)}</span></p></div><Badge tone={distributionState(distribution).tone}>{distributionState(distribution).label}</Badge>{distribution.status === 'pending' ? <Button disabled={locked} onClick={() => setSelection({ common, distribution })}>팀 배부<ArrowRight size={16}/></Button> : <Button variant="secondary" onClick={onOpenCommon}>진행 확인</Button>}</article>)}</div> : <EmptyState title={onlyPending ? '팀 배부를 기다리는 업무가 없습니다.' : '접수된 업무가 없습니다.'} description="부서장 승인을 받은 업무가 도착하면 이곳에서 팀을 지정할 수 있습니다."/>}</>}
      {tab === 'approvals' && (visibleRequests.length ? <div className="allocation-list">{visibleRequests.map(({ common, request }) => <article key={request.id}><span className="allocation-row-icon"><GitBranch size={21}/></span><div className="allocation-row-main"><div className="allocation-row-meta"><span>{request.kind === 'initial' ? '최초 배포 요청' : '대상 부서 추가 요청'}</span><span>{formatDate(request.requestedAt)}</span></div><h3>{request.snapshot.title}</h3><p>요청자 {nameOf(request.requestedBy)}<span>대상 {request.targetDepartmentIds.length}개 부서</span>{request.resolvedBy && <span>처리자 {nameOf(request.resolvedBy)}</span>}</p>{request.reason && <p className="allocation-request-reason">처리 사유: {request.reason}</p>}</div><Badge tone={request.status === 'approved' ? 'success' : request.status === 'rejected' ? 'warning' : 'info'}>{approvalLabels[request.status]}</Badge><Button variant="secondary" onClick={onOpenCommon}>요청 확인</Button></article>)}</div> : <EmptyState title={onlyPending ? '부서장 승인 대기 요청이 없습니다.' : '공통업무 승인 요청이 없습니다.'} description="우리 부서가 작성한 공통업무와 추가 배포 요청의 처리 결과가 표시됩니다."/>)}
      {tab === 'handovers' && (visibleHandovers.length ? <div className="allocation-list">{visibleHandovers.map(item => <article key={item.id}><span className="allocation-row-icon"><ArrowLeftRight size={21}/></span><div className="allocation-row-main"><div className="allocation-row-meta"><span>{item.kind === 'emergency' ? '긴급 업무 보관' : item.kind === 'roles' ? '남은 역할 정리' : item.kind === 'reassignment' ? '보관 업무 재배정' : '직접 인수인계'}</span><span>{formatDate(item.createdAt)}</span></div><h3>{item.fromName}<ArrowRight size={16}/>{item.toName}</h3><p>{item.kind === 'roles' ? `역할 ${item.roles?.length || 0}건` : `단위 ${item.unitIds.length}개 · 세부 ${item.taskIds.length}건`}<span>요청자 {item.requestedByName}</span></p></div><Badge tone={item.status === 'completed' ? 'success' : item.status === 'pending' ? 'warning' : 'soft'}>{item.status === 'pending' ? '부서장 승인 대기' : item.status === 'completed' ? '처리 완료' : item.status === 'rejected' ? '반려' : '취소'}</Badge><Button variant="secondary" onClick={onOpenHandover}>인수인계 확인</Button></article>)}</div> : <EmptyState title={onlyPending ? '승인을 기다리는 인수인계가 없습니다.' : '인수인계 내역이 없습니다.'} description="인수인계 메뉴에서 업무 보관, 재배정, 남은 역할 정리를 요청할 수 있습니다."/>) }
    </section>
    {selection && <TeamAllocation key={selection.distribution.id} workspace={w} command={command} allocation={selection} onClose={() => setSelection(null)}/>}
  </div>;
}

function TeamAllocation({ workspace: w, command, allocation, onClose }: { workspace: Workspace; command: CommandFn; allocation: Allocation; onClose: () => void }) {
  const [leadId, setLeadId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const candidates = w.users.filter(user => user.departmentId === allocation.distribution.departmentId && user.role === 'lead' && user.active && (!user.endsAt || new Date(user.endsAt) > new Date(w.serverTime)));
  const lead = candidates.find(user => user.id === leadId);
  const close = () => { if (!saving) onClose(); };
  return <Modal title="담당 팀에 업무 배부" description={allocation.common.title} onClose={close}><form className="form-stack" onSubmit={async event => { event.preventDefault(); if (!lead || saving) return; setSaving(true); setError(''); try { if (await command('common.assignTeam', { commonId: allocation.common.id, distributionId: allocation.distribution.id, leadId: lead.id, team: lead.team })) onClose(); else setError('배부하지 못했습니다. 화면 안내를 확인하고 다시 시도해 주세요.'); } catch (caught) { setError(caught instanceof Error ? caught.message : '배부하지 못했습니다.'); } finally { setSaving(false); } }}><div className="allocation-modal-info"><Building2 size={22}/><p>업무를 맡을 팀과 팀장을 지정합니다. 배부 후 팀장이 업무 담당자를 배정합니다.</p></div><Field label="담당 팀 · 팀장"><select required disabled={saving} value={leadId} onChange={event => setLeadId(event.target.value)}><option value="">팀장을 선택해 주세요</option>{candidates.map(user => <option key={user.id} value={user.id}>{user.team} · {user.name}</option>)}</select></Field>{!candidates.length && <p className="form-error">배부할 수 있는 팀장이 없습니다. 조직 · 구성원에서 소속과 활성 상태를 확인해 주세요.</p>}{lead && <p className="allocation-modal-next">다음 담당자: {lead.team} {lead.name} 팀장</p>}{error && <p role="alert" className="form-error">{error}</p>}<div className="form-actions"><Button variant="secondary" disabled={saving} onClick={close}>취소</Button><Button type="submit" disabled={saving || !lead}>{saving ? '배부 중…' : '팀에 배부'}<ArrowRight size={16}/></Button></div></form></Modal>;
}

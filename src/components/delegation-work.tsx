'use client';

import { useState } from 'react';
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, FileText, Plus, ShieldCheck, UserRound } from 'lucide-react';
import type { Delegation, Task, Workspace } from '@/lib/types';
import { activeTaskDelegations, canRequestTaskDelegation, canReviewTaskDelegation, delegationStatus } from '@/lib/delegations';
import { Badge, Button, EmptyState, Field, Modal, type CommandFn } from './ui';
import { OrganizationPersonPicker } from './organization-person-picker';
import './delegation-work.css';

type Props = { workspace: Workspace; command: CommandFn };
export type DeputyDraft = { toId: string; startsOn: string; endsOn: string; reason: string };
const dateFor = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
const personName = (workspace: Workspace, id?: string) => workspace.users.find(person => person.id === id)?.name || workspace.identities?.find(person => person.id === id)?.name || '구성원 확인 필요';
const departmentName = (workspace: Workspace, id?: string) => (workspace.departmentDirectory ?? workspace.departments).find(department => department.id === id)?.name || '소유 부서';
const dateTime = (value?: string) => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '미정';
export function initialDeputyDraft(workspace: Workspace): DeputyDraft { return { toId: '', startsOn: dateFor(new Date(workspace.serverTime)), endsOn: dateFor(new Date(new Date(workspace.serverTime).getTime() + 7 * 86400000)), reason: '' }; }
export function deputyPayload(draft: DeputyDraft) { return { toId: draft.toId, startsAt: new Date(draft.startsOn + 'T00:00:00+09:00').toISOString(), endsAt: new Date(new Date(draft.endsOn + 'T00:00:00+09:00').getTime() + 86400000).toISOString(), reason: draft.reason.trim() }; }
export function validDeputyDraft(draft: DeputyDraft) { return !!draft.toId && !!draft.startsOn && !!draft.endsOn && draft.endsOn >= draft.startsOn && !!draft.reason.trim(); }
export function delegationLabel(delegation: Delegation, now: Date, workspace?: Workspace, task?: Task) {
  const status = delegationStatus(delegation);
  if (status === 'revoked') return '대행 종료';
  if (status === 'pending') return '부서장 승인 대기';
  if (status === 'rejected') return '반려';
  if (status === 'cancelled') return '요청 취소';
  if (new Date(delegation.endsAt) <= now) return '기간 종료';
  if (new Date(delegation.startsAt) > now) return '승인 · 시작 예정';
  if (workspace && task && !activeTaskDelegations(workspace, task, undefined, now).some(item => item.id === delegation.id)) return '대행 자격 확인 필요';
  return '대행 중';
}

export function DeputyRequestFields({ workspace, fromId, departmentId, reviewerId, value, onChange, disabled = false }: { workspace: Workspace; fromId: string; departmentId: string; reviewerId?: string; value: DeputyDraft; onChange: (draft: DeputyDraft) => void; disabled?: boolean }) {
  const now = new Date(workspace.serverTime);
  const candidates = workspace.users.filter(person => person.active && (!person.endsAt || new Date(person.endsAt) > now) && person.departmentId === departmentId && person.id !== fromId && person.id !== reviewerId && person.role !== 'head');
  return <div className="delegation-fields"><OrganizationPersonPicker workspace={workspace} value={value.toId} onChange={toId => onChange({ ...value, toId })} candidates={candidates} disabled={disabled}/>
    <div className="form-grid"><Field label="대행 시작일"><input type="date" required value={value.startsOn} disabled={disabled} onChange={event => onChange({ ...value, startsOn: event.target.value })}/></Field><Field label="대행 종료일 · 해당 날짜 포함"><input type="date" required min={value.startsOn} value={value.endsOn} disabled={disabled} onChange={event => onChange({ ...value, endsOn: event.target.value })}/></Field></div>
    <Field label="대행 요청 사유"><textarea required rows={3} maxLength={5000} value={value.reason} disabled={disabled} onChange={event => onChange({ ...value, reason: event.target.value })} placeholder="부재 사유와 대행자가 이어서 수행할 내용을 적어 주세요."/></Field>
    <p className="delegation-note"><ShieldCheck size={17}/>원담당자의 부서장이 승인한 뒤 지정 기간에 업무대행을 시작합니다. 같은 업무에 대행 기간을 겹쳐 요청할 수 없습니다.</p>
  </div>;
}

export function DelegationRequestDialog({ workspace, command, task, onClose }: Props & { task?: Task; onClose: () => void }) {
  const candidates = workspace.tasks.filter(item => canRequestTaskDelegation(workspace, workspace.currentUser, item, new Date(workspace.serverTime)));
  const [taskId, setTaskId] = useState(task?.id || candidates[0]?.id || '');
  const selected = task || candidates.find(item => item.id === taskId);
  const [draft, setDraft] = useState(() => initialDeputyDraft(workspace));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Modal title="업무대행 승인 요청" description="원래 업무의 소유자와 기록을 유지하며, 기간을 정해 수행 권한을 맡깁니다." onClose={() => { if (!busy) onClose(); }} wide><form className="form-stack" onSubmit={async event => { event.preventDefault(); if (!selected || !validDeputyDraft(draft) || busy) return; setBusy(true); setError(''); try { if (await command('delegation.request', { taskId: selected.id, ...deputyPayload(draft) })) onClose(); else setError('요청하지 못했습니다. 화면 안내를 확인한 뒤 다시 시도해 주세요.'); } catch { setError('요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'); } finally { setBusy(false); } }}>
    {task ? <div className="delegation-context"><FileText size={19}/><div><strong>{task.title}</strong><span>원담당자 {personName(workspace, task.primaryId)} · {departmentName(workspace, task.departmentId)}</span></div></div> : <Field label="대행을 요청할 세부업무"><select required value={taskId} disabled={busy} onChange={event => { setTaskId(event.target.value); setDraft(initialDeputyDraft(workspace)); }}><option value="">세부업무 선택</option>{candidates.map(item => <option value={item.id} key={item.id}>{item.title} · {personName(workspace, item.primaryId)}</option>)}</select></Field>}
    {selected ? <DeputyRequestFields workspace={workspace} fromId={selected.primaryId} departmentId={selected.departmentId} reviewerId={selected.reviewerId} value={draft} onChange={setDraft} disabled={busy}/> : <p className="delegation-note">요청할 수 있는 업무가 없습니다. 본인 또는 관리하는 부서의 유효한 세부업무가 필요합니다.</p>}
    {error && <p className="delegation-error" role="alert">{error}</p>}<div className="form-actions"><Button variant="secondary" disabled={busy} onClick={onClose}>취소</Button><Button type="submit" disabled={busy || !selected || !validDeputyDraft(draft)}>{busy ? '요청 중…' : '부서장 승인 요청'}</Button></div>
  </form></Modal>;
}

export function TaskDelegationSection({ workspace, command, task, disabled = false }: Props & { task: Task; disabled?: boolean }) {
  const [requesting, setRequesting] = useState(false);
  const [draft, setDraft] = useState(() => initialDeputyDraft(workspace));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const now = new Date(workspace.serverTime);
  const records = workspace.delegations.filter(item => item.taskId === task.id).slice().sort((a, b) => (b.requestedAt || b.startsAt).localeCompare(a.requestedAt || a.startsAt));
  const active = activeTaskDelegations(workspace, task, undefined, now);
  return <section className="task-delegation-section"><header><div><h3>업무대행 지정</h3><p>원담당자는 유지되며, 승인된 대행자가 같은 업무의 수행 기록을 이어서 작성합니다.</p></div>{canRequestTaskDelegation(workspace, workspace.currentUser, task, now) && <Button variant="secondary" disabled={disabled || busy} onClick={() => setRequesting(true)}><Plus size={16}/>대행 승인 요청</Button>}</header>
    {active.some(item => item.toId === workspace.currentUser.id) && <p className="delegation-current"><CheckCircle2 size={17}/>현재 이 업무를 대행하고 있습니다. 기록에는 실제 작성자가 남고 원담당자와 함께 확인합니다.</p>}
    {records.length ? <div className="task-delegation-list">{records.slice(0, 5).map(item => <div key={item.id}><UserRound size={17}/><div><strong>{personName(workspace, item.toId)}</strong><span>{dateTime(item.startsAt)} ~ {dateTime(item.endsAt)}</span></div><Badge tone={item.status === 'pending' ? 'warning' : active.some(record => record.id === item.id) ? 'info' : 'soft'}>{delegationLabel(item, now, workspace, task)}</Badge></div>)}</div> : <p className="delegation-empty">지정된 업무대행자가 없습니다.</p>}
    {requesting && <form className="form-stack delegation-inline-form" onSubmit={async event => { event.preventDefault(); if (busy || disabled || !validDeputyDraft(draft)) return; setBusy(true); setError(''); try { if (await command('delegation.request', { taskId: task.id, ...deputyPayload(draft) })) { setRequesting(false); setDraft(initialDeputyDraft(workspace)); } else setError('요청하지 못했습니다. 화면 안내를 확인해 주세요.'); } catch { setError('요청하지 못했습니다. 다시 시도해 주세요.'); } finally { setBusy(false); } }}><DeputyRequestFields workspace={workspace} fromId={task.primaryId} departmentId={task.departmentId} reviewerId={task.reviewerId} value={draft} onChange={setDraft} disabled={busy || disabled}/>{error && <p className="delegation-error" role="alert">{error}</p>}<div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => setRequesting(false)}>취소</Button><Button type="submit" disabled={busy || disabled || !validDeputyDraft(draft)}>{busy ? '요청 중…' : '부서장 승인 요청'}</Button></div></form>}
  </section>;
}

export function DelegationWork({ workspace: w, command, onOpenTask }: Props & { onOpenTask?: (id: string) => void }) {
  const [filter, setFilter] = useState<'pending' | 'active' | 'history' | 'all'>(w.currentUser.role === 'head' ? 'pending' : 'all');
  const [requesting, setRequesting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const now = new Date(w.serverTime);
  const phase = (record: Delegation) => delegationStatus(record) === 'pending' ? 'pending' : delegationStatus(record) === 'approved' && new Date(record.endsAt) > now ? 'active' : 'history';
  const all = [...w.delegations].sort((a, b) => (b.requestedAt || b.startsAt).localeCompare(a.requestedAt || a.startsAt));
  const visible = all.filter(record => filter === 'all' || phase(record) === filter);
  const selected = all.find(item => item.id === selectedId);
  const taskFor = (record: Delegation) => w.tasks.find(task => task.id === record.taskId);
  const managerFor = (record: Delegation) => w.currentUser.role === 'admin' || w.currentUser.role === 'manager' && w.currentUser.departmentId === (record.departmentId || taskFor(record)?.departmentId);
  const canCancel = (record: Delegation) => record.status === 'pending' && ([record.fromId, record.requestedBy].includes(w.currentUser.id) || managerFor(record));
  const canRevoke = (record: Delegation) => phase(record) === 'active' && ([record.fromId, record.toId, record.requestedBy].includes(w.currentUser.id) || managerFor(record) || w.currentUser.role === 'head' && w.currentUser.departmentId === (record.departmentId || taskFor(record)?.departmentId));
  async function decide(action: 'approve' | 'reject' | 'cancel' | 'revoke') {
    if (!selected || busy) return;
    if (action !== 'approve' && !resolution.trim()) { setError('처리 사유를 입력해 주세요.'); return; }
    setBusy(true); setError('');
    try { if (await command('delegation.' + action, { delegationId: selected.id, reason: resolution.trim() })) setSelectedId(null); else setError('처리하지 못했습니다. 최신 상태와 화면 안내를 확인해 주세요.'); } catch { setError('처리하지 못했습니다. 다시 시도해 주세요.'); } finally { setBusy(false); }
  }
  return <div className="delegation-work"><div className="page-heading"><div><p className="eyebrow">부재 중에도 이어지는 업무</p><h1>업무대행</h1><p className="muted">대행자를 지정하고 부서장 승인부터 기간 종료까지 관리합니다.</p></div>{w.tasks.some(task => canRequestTaskDelegation(w, w.currentUser, task, now)) && <Button onClick={() => setRequesting(true)}><Plus size={17}/>업무대행 요청</Button>}</div>
    <div className="delegation-flow"><ShieldCheck size={21}/><p><strong>대행 요청 → 원담당자 부서장 승인 → 대행자의 개인업무에서 수행</strong><span>원본 업무의 수행 기록을 함께 사용합니다. 업무 소유권·최종 검토 권한과 반기 성과 제출·평가는 대행 범위에 포함되지 않습니다.</span></p></div>
    <div className="tabs delegation-tabs">{([['all', '전체'], ['pending', '승인 대기'], ['active', '승인·대행 중'], ['history', '종료·처리 이력']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{value === 'all' ? all.length : all.filter(record => phase(record) === value).length}</span></button>)}</div>
    {visible.length ? <div className="delegation-list">{visible.map(record => <article className="delegation-card" key={record.id}><header><Badge tone={record.status === 'pending' ? 'warning' : phase(record) === 'active' ? 'info' : 'soft'}>{delegationLabel(record, now, w, taskFor(record))}</Badge><span>{departmentName(w, record.departmentId || taskFor(record)?.departmentId)}</span></header><h2>{taskFor(record)?.title || record.taskTitle || '업무대행 요청'}</h2><p className="delegation-people"><span><small>원담당자</small><b>{personName(w, record.fromId)}</b></span><ArrowRight size={18}/><span><small>업무대행자</small><b>{personName(w, record.toId)}</b></span></p><p className="delegation-period"><CalendarDays size={16}/>{dateTime(record.startsAt)} ~ {dateTime(record.endsAt)}</p><p className="delegation-card-reason">{record.reason || '기존 업무대행 지정'}</p>{record.resolutionReason && <p className="delegation-resolution">처리 의견 · {record.resolutionReason}</p>}<footer><span>요청 {personName(w, record.requestedBy || record.fromId)}</span><div>{taskFor(record) && onOpenTask && <Button variant="secondary" onClick={() => onOpenTask(record.taskId)}>원본 업무 보기</Button>}<Button variant={canReviewTaskDelegation(w, w.currentUser, record, now) ? 'primary' : 'secondary'} onClick={() => { setSelectedId(record.id); setResolution(''); setError(''); }}>{canReviewTaskDelegation(w, w.currentUser, record, now) ? '검토·승인' : '요청 상세'}</Button></div></footer></article>)}</div> : <EmptyState title="해당하는 업무대행 내역이 없습니다." description="세부업무의 업무대행 지정 또는 이 화면에서 승인 요청을 시작할 수 있습니다."/>}
    {requesting && <DelegationRequestDialog workspace={w} command={command} onClose={() => setRequesting(false)}/>}
    {selected && <Modal title="업무대행 요청 상세" description={taskFor(selected)?.title || selected.taskTitle || '업무대행'} onClose={() => { if (!busy) setSelectedId(null); }} wide><div className="form-stack"><div className="delegation-context"><UserRound size={20}/><div><strong>{personName(w, selected.fromId)} → {personName(w, selected.toId)}</strong><span>{departmentName(w, selected.departmentId || taskFor(selected)?.departmentId)} · {delegationLabel(selected, now, w, taskFor(selected))}</span></div></div><dl className="delegation-detail"><div><dt>대행 기간</dt><dd>{dateTime(selected.startsAt)} ~ {dateTime(selected.endsAt)}</dd></div><div><dt>요청자·시각</dt><dd>{personName(w, selected.requestedBy || selected.fromId)} · {dateTime(selected.requestedAt)}</dd></div><div><dt>요청 사유</dt><dd>{selected.reason || '기존 업무대행 지정'}</dd></div>{selected.resolvedAt && <div><dt>처리자·시각</dt><dd>{personName(w, selected.resolvedBy || selected.approvedBy)} · {dateTime(selected.resolvedAt)}</dd></div>}{selected.resolutionReason && <div><dt>처리 사유</dt><dd>{selected.resolutionReason}</dd></div>}</dl><p className="delegation-note"><Clock3 size={17}/>승인된 기간에 원본 업무의 수행 결과·메모·문서를 기록합니다. 대행이 끝나도 기존 기록과 작성자는 보존됩니다.</p>
      {(canReviewTaskDelegation(w, w.currentUser, selected, now) || canCancel(selected) || canRevoke(selected)) && <Field label="처리 의견 · 반려·취소·종료 시 필수"><textarea value={resolution} onChange={event => setResolution(event.target.value)} rows={3} maxLength={5000} disabled={busy}/></Field>}{error && <p className="delegation-error" role="alert">{error}</p>}<div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => setSelectedId(null)}>닫기</Button>{canCancel(selected) && <Button variant="secondary" disabled={busy} onClick={() => void decide('cancel')}>요청 취소</Button>}{canRevoke(selected) && <Button variant="secondary" disabled={busy} onClick={() => void decide('revoke')}>업무대행 종료</Button>}{canReviewTaskDelegation(w, w.currentUser, selected, now) && <><Button variant="secondary" disabled={busy} onClick={() => void decide('reject')}>반려</Button><Button disabled={busy} onClick={() => void decide('approve')}><CheckCircle2 size={16}/>{busy ? '처리 중…' : '승인하여 업무대행 시작'}</Button></>}</div>
    </div></Modal>}
  </div>;
}

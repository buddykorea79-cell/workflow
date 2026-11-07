'use client';

import { useState } from 'react';
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, FileText, Plus, ShieldCheck, UserRound } from 'lucide-react';
import type { Delegation, Task, Workspace } from '@/lib/types';
import { activeTaskDelegations, canRequestTaskDelegation, canReviewTaskDelegation, delegationStatus, requestableDelegationTasks } from '@/lib/delegations';
import { Badge, Button, EmptyState, Field, Modal, type CommandFn } from './ui';
import { OrganizationPersonPicker } from './organization-person-picker';
import { DelegationTaskSelection } from './delegation-task-selection';
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

export function DeputyRequestFields({ workspace, fromId, departmentId, reviewerId, excludedIds = [], value, onChange, disabled = false }: { workspace: Workspace; fromId: string; departmentId: string; reviewerId?: string; excludedIds?: string[]; value: DeputyDraft; onChange: (draft: DeputyDraft) => void; disabled?: boolean }) {
  const now = new Date(workspace.serverTime);
  const candidates = workspace.users.filter(person => person.active && (!person.endsAt || new Date(person.endsAt) > now) && person.departmentId === departmentId && person.id !== fromId && person.id !== reviewerId && !excludedIds.includes(person.id) && person.role !== 'head');
  return <div className="delegation-fields"><OrganizationPersonPicker workspace={workspace} value={value.toId} onChange={toId => onChange({ ...value, toId })} candidates={candidates} disabled={disabled}/>
    <div className="form-grid"><Field label="대행 시작일"><input type="date" required value={value.startsOn} disabled={disabled} onChange={event => onChange({ ...value, startsOn: event.target.value })}/></Field><Field label="대행 종료일 · 해당 날짜 포함"><input type="date" required min={value.startsOn} value={value.endsOn} disabled={disabled} onChange={event => onChange({ ...value, endsOn: event.target.value })}/></Field></div>
    <Field label="대행 요청 사유"><textarea required rows={3} maxLength={2000} value={value.reason} disabled={disabled} onChange={event => onChange({ ...value, reason: event.target.value })} placeholder="부재 사유와 대행자가 이어서 수행할 내용을 적어 주세요."/></Field>
    <p className="delegation-note"><ShieldCheck size={17}/>원담당자의 부서장이 승인한 뒤 지정 기간에 업무대행을 시작합니다. 같은 업무에 대행 기간을 겹쳐 요청할 수 없습니다.</p>
  </div>;
}

export function DelegationRequestDialog({ workspace, command, task, onClose }: Props & { task?: Task; onClose: () => void }) {
  const candidates = requestableDelegationTasks(workspace, workspace.currentUser, new Date(workspace.serverTime));
  const owners = workspace.users.filter(person => candidates.some(item => item.primaryId === person.id)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const [fromId, setFromId] = useState(task?.primaryId || (owners.some(person => person.id === workspace.currentUser.id) ? workspace.currentUser.id : owners[0]?.id || ''));
  const [selectedIds, setSelectedIds] = useState<string[]>(task ? [task.id] : []);
  const ownerTasks = candidates.filter(item => item.primaryId === fromId);
  const selectedTasks = ownerTasks.filter(item => selectedIds.includes(item.id));
  const selectedOwner = owners.find(person => person.id === fromId);
  const [draft, setDraft] = useState(() => initialDeputyDraft(workspace));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const validSelection = selectedTasks.length > 0 && selectedTasks.length === selectedIds.length && selectedTasks.length <= 300;
  const validRecipient = !selectedTasks.some(item => item.reviewerId === draft.toId);
  const changeSelection = (ids: string[]) => { setSelectedIds(ids); if (ownerTasks.some(item => ids.includes(item.id) && item.reviewerId === draft.toId)) setDraft({ ...draft, toId: '' }); };
  return <Modal title="업무대행 승인 요청" description="업무분장표에서 전체 또는 단위·세부업무를 선택한 뒤 대행자를 지정합니다." onClose={() => { if (!busy) onClose(); }} wide>
    <form className="form-stack" onSubmit={async event => {
      event.preventDefault(); if (!validSelection || !validRecipient || !validDeputyDraft(draft) || busy) return;
      setBusy(true); setError('');
      try { if (await command('delegation.requestBatch', { fromId, taskIds: selectedTasks.map(item => item.id), ...deputyPayload(draft) })) onClose(); else setError('요청하지 못했습니다. 화면 안내를 확인한 뒤 다시 시도해 주세요.'); }
      catch { setError('요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
      finally { setBusy(false); }
    }}>
      {['manager', 'admin'].includes(workspace.currentUser.role) && !task ? <Field label="업무를 맡길 원담당자"><select required value={fromId} disabled={busy} onChange={event => { setFromId(event.target.value); setSelectedIds([]); setDraft(initialDeputyDraft(workspace)); }}><option value="">원담당자 선택</option>{owners.map(person => <option value={person.id} key={person.id}>{person.name} · {departmentName(workspace, person.departmentId)} · {person.team}</option>)}</select></Field> : <div className="delegation-context"><UserRound size={19}/><div><strong>원담당자 {selectedOwner?.name || '담당자'}</strong><span>{departmentName(workspace, selectedOwner?.departmentId)} · 본인이 담당하는 업무를 선택합니다.</span></div></div>}
      <DelegationTaskSelection workspace={workspace} tasks={ownerTasks} selectedIds={selectedIds} onChange={changeSelection} disabled={busy}/>
      {selectedOwner && ownerTasks.length > 0 && <DeputyRequestFields workspace={workspace} fromId={fromId} departmentId={selectedOwner.departmentId} excludedIds={selectedTasks.map(item => item.reviewerId)} value={draft} onChange={setDraft} disabled={busy}/>}
      <p className="delegation-note">선택한 {selectedTasks.length}개 세부업무는 하나의 승인 요청으로 묶입니다. 부서장이 전체 내용을 검토한 뒤 함께 승인하며 원본 업무·단위업무는 이동하거나 복제하지 않습니다.</p>
      {selectedTasks.length > 300 && <p className="delegation-error" role="alert">한 번에 300개까지 요청할 수 있습니다. 선택 범위를 나누어 주세요.</p>}
      {error && <p className="delegation-error" role="alert">{error}</p>}
      <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={onClose}>취소</Button><Button type="submit" disabled={busy || !validSelection || !validRecipient || !validDeputyDraft(draft)}>{busy ? '요청 중…' : `선택한 ${selectedTasks.length}건 부서장 승인 요청`}</Button></div>
    </form>
  </Modal>;
}

export function TaskDelegationSection({ workspace, command, task, disabled = false }: Props & { task: Task; disabled?: boolean }) {
  const [requesting, setRequesting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([task.id]);
  const [draft, setDraft] = useState(() => initialDeputyDraft(workspace));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const now = new Date(workspace.serverTime);
  const records = workspace.delegations.filter(item => item.taskId === task.id).slice().sort((a, b) => (b.requestedAt || b.startsAt).localeCompare(a.requestedAt || a.startsAt));
  const active = activeTaskDelegations(workspace, task, undefined, now);
  const candidates = requestableDelegationTasks(workspace, workspace.currentUser, now).filter(item => item.primaryId === task.primaryId);
  const selectedTasks = candidates.filter(item => selectedIds.includes(item.id));
  const validSelection = selectedTasks.length > 0 && selectedTasks.length === selectedIds.length && selectedTasks.length <= 300 && !selectedTasks.some(item => item.reviewerId === draft.toId);
  const changeSelection = (ids: string[]) => { setSelectedIds(ids); if (candidates.some(item => ids.includes(item.id) && item.reviewerId === draft.toId)) setDraft({ ...draft, toId: '' }); };
  return <section className="task-delegation-section"><header><div><h3>업무대행 지정</h3><p>원담당자는 유지되며, 승인된 대행자가 같은 업무의 수행 기록을 이어서 작성합니다.</p></div>{canRequestTaskDelegation(workspace, workspace.currentUser, task, now) && <Button data-task-action="true" variant="secondary" disabled={disabled || busy} onClick={() => { setSelectedIds([task.id]); setRequesting(true); }}><Plus size={16}/>대행 승인 요청</Button>}</header>
    {active.some(item => item.toId === workspace.currentUser.id) && <p className="delegation-current"><CheckCircle2 size={17}/>현재 이 업무를 대행하고 있습니다. 기록에는 실제 작성자가 남고 원담당자와 함께 확인합니다.</p>}
    {records.length ? <div className="task-delegation-list">{records.slice(0, 5).map(item => <div key={item.id}><UserRound size={17}/><div><strong>{personName(workspace, item.toId)}</strong><span>{dateTime(item.startsAt)} ~ {dateTime(item.endsAt)}</span></div><Badge tone={item.status === 'pending' ? 'warning' : active.some(record => record.id === item.id) ? 'info' : 'soft'}>{delegationLabel(item, now, workspace, task)}</Badge></div>)}</div> : <p className="delegation-empty">지정된 업무대행자가 없습니다.</p>}
    {requesting && <form className="form-stack delegation-inline-form" onSubmit={async event => { event.preventDefault(); if (busy || disabled || !validSelection || !validDeputyDraft(draft)) return; setBusy(true); setError(''); try { if (await command('delegation.requestBatch', { fromId: task.primaryId, taskIds: selectedTasks.map(item => item.id), ...deputyPayload(draft) })) { setRequesting(false); setDraft(initialDeputyDraft(workspace)); } else setError('요청하지 못했습니다. 화면 안내를 확인해 주세요.'); } catch { setError('요청하지 못했습니다. 다시 시도해 주세요.'); } finally { setBusy(false); } }}><DelegationTaskSelection workspace={workspace} tasks={candidates} selectedIds={selectedIds} onChange={changeSelection} disabled={busy || disabled}/><DeputyRequestFields workspace={workspace} fromId={task.primaryId} departmentId={task.departmentId} excludedIds={selectedTasks.map(item => item.reviewerId)} value={draft} onChange={setDraft} disabled={busy || disabled}/>{error && <p className="delegation-error" role="alert">{error}</p>}<div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => setRequesting(false)}>취소</Button><Button type="submit" disabled={busy || disabled || !validSelection || !validDeputyDraft(draft)}>{busy ? '요청 중…' : `선택한 ${selectedTasks.length}건 부서장 승인 요청`}</Button></div></form>}
  </section>;
}

type DelegationGroup = { id: string; records: Delegation[] };

export function DelegationWork({ workspace: w, command, onOpenTask, initialDelegationId }: Props & { onOpenTask?: (id: string) => void; initialDelegationId?: string }) {
  const [filter, setFilter] = useState<'pending' | 'active' | 'history' | 'all'>(w.currentUser.role === 'head' ? 'pending' : 'all');
  const [requesting, setRequesting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => { const item = w.delegations.find(record => record.id === initialDelegationId); return item ? item.batchId || item.id : null; });
  const [resolution, setResolution] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const now = new Date(w.serverTime);
  const recordPhase = (record: Delegation) => delegationStatus(record) === 'pending' ? 'pending' : delegationStatus(record) === 'approved' && new Date(record.endsAt) > now ? 'active' : 'history';
  const sorted = [...w.delegations].sort((a, b) => (b.requestedAt || b.startsAt).localeCompare(a.requestedAt || a.startsAt));
  const all = sorted.reduce<DelegationGroup[]>((groups, record) => { const id = record.batchId || record.id; const group = groups.find(item => item.id === id); if (group) group.records.push(record); else groups.push({ id, records: [record] }); return groups; }, []);
  const phase = (group: DelegationGroup) => group.records.some(record => recordPhase(record) === 'pending') ? 'pending' : group.records.some(record => recordPhase(record) === 'active') ? 'active' : 'history';
  const visible = all.filter(group => filter === 'all' || phase(group) === filter);
  const selected = all.find(group => group.id === selectedId);
  const taskFor = (record: Delegation) => w.tasks.find(task => task.id === record.taskId);
  const managerFor = (record: Delegation) => w.currentUser.role === 'admin' || w.currentUser.role === 'manager' && w.currentUser.departmentId === (record.departmentId || taskFor(record)?.departmentId);
  const canCancel = (record: Delegation) => delegationStatus(record) === 'pending' && ([record.fromId, record.requestedBy].includes(w.currentUser.id) || managerFor(record));
  const canRevoke = (record: Delegation) => recordPhase(record) === 'active' && ([record.fromId, record.toId, record.requestedBy].includes(w.currentUser.id) || managerFor(record) || w.currentUser.role === 'head' && w.currentUser.departmentId === (record.departmentId || taskFor(record)?.departmentId));
  const canReview = (group: DelegationGroup) => group.records.some(record => canReviewTaskDelegation(w, w.currentUser, record, now));
  const groupTitle = (group: DelegationGroup) => group.records.length > 1 ? `${personName(w, group.records[0].fromId)}의 세부업무 ${group.records.length}건` : taskFor(group.records[0])?.title || group.records[0].taskTitle || '업무대행 요청';
  const groupLabel = (group: DelegationGroup) => {
    const labels = [...new Set(group.records.map(record => delegationLabel(record, now, w, taskFor(record))))];
    return labels.length === 1 ? labels[0] : labels.join(' · ');
  };
  const selectedRecord = selected?.records[0];
  async function decide(action: 'approve' | 'reject' | 'cancel' | 'revoke') {
    if (!selected || !selectedRecord || busy) return;
    if (action !== 'approve' && !resolution.trim()) { setError('처리 사유를 입력해 주세요.'); return; }
    setBusy(true); setError('');
    try { if (await command('delegation.' + action, { ...(selectedRecord.batchId ? { batchId: selectedRecord.batchId } : { delegationId: selectedRecord.id }), reason: resolution.trim() })) setSelectedId(null); else setError('처리하지 못했습니다. 최신 상태와 화면 안내를 확인해 주세요.'); }
    catch { setError('처리하지 못했습니다. 다시 시도해 주세요.'); } finally { setBusy(false); }
  }
  return <div className="delegation-work">
    <div className="page-heading"><div><p className="eyebrow">부재 중에도 이어지는 업무</p><h1>업무대행</h1><p className="muted">전체 업무 또는 단위·세부업무를 골라 대행자를 지정하고 부서장 승인을 받습니다.</p></div>{requestableDelegationTasks(w, w.currentUser, now).length > 0 && <Button onClick={() => setRequesting(true)}><Plus size={17}/>업무대행 요청</Button>}</div>
    <div className="delegation-flow"><ShieldCheck size={21}/><p><strong>업무 범위 선택 → 원담당자 부서장 승인 → 대행자의 개인업무에서 수행</strong><span>선택한 원본 업무의 수행 기록을 함께 사용합니다. 업무 소유권·최종 검토 권한과 반기 성과 제출·평가는 대행 범위에 포함되지 않습니다.</span></p></div>
    <div className="tabs delegation-tabs">{([['all', '전체'], ['pending', '승인 대기'], ['active', '승인·대행 중'], ['history', '종료·처리 이력']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}<span>{value === 'all' ? all.length : all.filter(group => phase(group) === value).length}</span></button>)}</div>
    {visible.length ? <div className="delegation-list">{visible.map(group => {
      const record = group.records[0]; const unitTitles = [...new Set(group.records.map(item => item.unitTitle || w.units.find(unit => unit.id === taskFor(item)?.unitId)?.title || '단위업무'))];
      return <article className="delegation-card" key={group.id}><header><Badge tone={phase(group) === 'pending' ? 'warning' : phase(group) === 'active' ? 'info' : 'soft'}>{groupLabel(group)}</Badge><span>{departmentName(w, record.departmentId || taskFor(record)?.departmentId)}</span></header>
        <h2>{groupTitle(group)}</h2>{group.records.length > 1 && <p className="delegation-batch-scope">단위업무 {unitTitles.length}개 · 세부업무 {group.records.length}건 선택</p>}
        <p className="delegation-people"><span><small>원담당자</small><b>{personName(w, record.fromId)}</b></span><ArrowRight size={18}/><span><small>업무대행자</small><b>{personName(w, record.toId)}</b></span></p>
        <p className="delegation-period"><CalendarDays size={16}/>{dateTime(record.startsAt)} ~ {dateTime(record.endsAt)}</p><p className="delegation-card-reason">{record.reason || '기존 업무대행 지정'}</p>{record.resolutionReason && <p className="delegation-resolution">처리 의견 · {record.resolutionReason}</p>}
        <footer><span>요청 {personName(w, record.requestedBy || record.fromId)}</span><div>{group.records.length === 1 && taskFor(record) && onOpenTask && <Button variant="secondary" onClick={() => onOpenTask(record.taskId)}>원본 업무 보기</Button>}<Button variant={canReview(group) ? 'primary' : 'secondary'} onClick={() => { setSelectedId(group.id); setResolution(''); setError(''); }}>{canReview(group) ? '검토·승인' : '요청 상세'}</Button></div></footer>
      </article>;
    })}</div> : <EmptyState title="해당하는 업무대행 내역이 없습니다." description="업무대행 요청에서 업무분장표의 전체 또는 필요한 업무를 선택해 주세요."/>}
    {requesting && <DelegationRequestDialog workspace={w} command={command} onClose={() => setRequesting(false)}/>}
    {selected && selectedRecord && <Modal title="업무대행 요청 상세" description={groupTitle(selected)} onClose={() => { if (!busy) setSelectedId(null); }} wide><div className="form-stack">
      <div className="delegation-context"><UserRound size={20}/><div><strong>{personName(w, selectedRecord.fromId)} → {personName(w, selectedRecord.toId)}</strong><span>{departmentName(w, selectedRecord.departmentId || taskFor(selectedRecord)?.departmentId)} · {groupLabel(selected)}</span></div></div>
      <dl className="delegation-detail"><div><dt>대행 기간</dt><dd>{dateTime(selectedRecord.startsAt)} ~ {dateTime(selectedRecord.endsAt)}</dd></div><div><dt>요청자·시각</dt><dd>{personName(w, selectedRecord.requestedBy || selectedRecord.fromId)} · {dateTime(selectedRecord.requestedAt)}</dd></div><div><dt>요청 사유</dt><dd>{selectedRecord.reason || '기존 업무대행 지정'}</dd></div>{selectedRecord.resolvedAt && <div><dt>처리자·시각</dt><dd>{personName(w, selectedRecord.resolvedBy || selectedRecord.approvedBy)} · {dateTime(selectedRecord.resolvedAt)}</dd></div>}{selectedRecord.resolutionReason && <div><dt>처리 사유</dt><dd>{selectedRecord.resolutionReason}</dd></div>}</dl>
      <div className="delegation-selection-scroll delegation-review-table" role="region" aria-label="선택된 대행 업무 검토" tabIndex={0}><table><caption>승인 요청에 포함된 원본 업무 {selected.records.length}건</caption><thead><tr><th scope="col">단위업무</th><th scope="col">세부업무</th><th scope="col">상태</th></tr></thead><tbody>{selected.records.map(record => <tr key={record.id}><td>{record.unitTitle || w.units.find(unit => unit.id === taskFor(record)?.unitId)?.title || '단위업무'}</td><td>{taskFor(record) && onOpenTask ? <button type="button" className="text-link" onClick={() => { setSelectedId(null); onOpenTask(record.taskId); }}>{taskFor(record)?.title || record.taskTitle}</button> : record.taskTitle || '세부업무'}</td><td>{delegationLabel(record, now, w, taskFor(record))}</td></tr>)}</tbody></table></div>
      <p className="delegation-note"><Clock3 size={17}/>선택한 업무를 함께 승인합니다. 하나라도 담당자·업무 기준·기간이 달라지면 전체 승인이 중단됩니다. 대행이 끝나도 업무별 기록과 실제 작성자는 보존됩니다.</p>
      {(canReview(selected) || selected.records.some(canCancel) || selected.records.some(canRevoke)) && <Field label="처리 의견 · 반려·취소·종료 시 필수"><textarea value={resolution} onChange={event => setResolution(event.target.value)} rows={3} maxLength={2000} disabled={busy}/></Field>}
      {error && <p className="delegation-error" role="alert">{error}</p>}
      <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => setSelectedId(null)}>닫기</Button>{selected.records.some(canCancel) && <Button variant="secondary" disabled={busy} onClick={() => void decide('cancel')}>요청 취소</Button>}{selected.records.some(canRevoke) && <Button variant="secondary" disabled={busy} onClick={() => void decide('revoke')}>업무대행 종료</Button>}{canReview(selected) && <><Button variant="secondary" disabled={busy} onClick={() => void decide('reject')}>반려</Button><Button disabled={busy || !selected.records.every(record => delegationStatus(record) === 'pending')} onClick={() => void decide('approve')}><CheckCircle2 size={16}/>{busy ? '처리 중…' : `선택한 ${selected.records.length}건 승인`}</Button></>}</div>
    </div></Modal>}
  </div>;
}

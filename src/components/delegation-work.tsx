'use client';

import { useRevisionCommand } from './command-revision';

import { useRef, useState } from 'react';
import { sameDraft } from '@/lib/pending-draft';
import { formatDateTimeFull as dateTime } from '@/lib/date-format';
import { useUnsavedChanges, useUnsavedNavigation } from './unsaved-changes';
import { ArrowRight, CalendarDays, CheckCircle2, Clock3, Plus, ShieldCheck, UserRound } from 'lucide-react';
import type { Delegation, Task, Workspace } from '@/lib/types';
import { canReviewTaskDelegation, delegationStatus, requestableDelegationTasks } from '@/lib/delegations';
import { Badge, Button, EmptyState, Field, Modal, validateTextFields, type CommandFn } from './ui';
import { DeputyRequestFields } from './delegation-fields';
import { delegationLabel, delegationPersonName as personName, deputyPayload, initialDeputyDraft, validDeputyDraft } from '@/lib/delegation-draft';
export { DeputyRequestFields, TaskDelegationSection } from './delegation-fields';
export { delegationLabel, deputyPayload, initialDeputyDraft, validDeputyDraft, type DeputyDraft } from '@/lib/delegation-draft';
import { DelegationTaskSelection } from './delegation-task-selection';
import './delegation-work.css';

type Props = { workspace: Workspace; command: CommandFn };
const departmentName = (workspace: Workspace, id?: string) => (workspace.departmentDirectory ?? workspace.departments).find(department => department.id === id)?.name || '소유 부서';

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
  const [receipt, setReceipt] = useState('');
  const currentDraft = { fromId, selectedIds, draft };
  const latestDraft = useRef(currentDraft); latestDraft.current = currentDraft;
  const [savedDraft, setSavedDraft] = useState(currentDraft);
  const sourceChangePending = useRef(false);
  const draftId = useUnsavedChanges(busy || !sameDraft(currentDraft, savedDraft), '업무대행 승인 요청');
  const { requestNavigation, clearDraft } = useUnsavedNavigation();
  const close = () => { if (!busy) requestNavigation(() => { clearDraft(draftId); onClose(); }); };
  const validSelection = selectedTasks.length > 0 && selectedTasks.length === selectedIds.length && selectedTasks.length <= 300;
  const validRecipient = !selectedTasks.some(item => item.reviewerId === draft.toId);
  const changeSelection = (ids: string[]) => { setSelectedIds(ids); if (ownerTasks.some(item => ids.includes(item.id) && item.reviewerId === draft.toId)) setDraft({ ...draft, toId: '' }); };
  return <Modal title="업무대행 승인 요청" description="업무분장표에서 전체 또는 단위·세부업무를 선택한 뒤 대행자를 지정합니다." onClose={close} wide>
    <form className="form-stack" onSubmit={async event => {
      event.preventDefault(); if (!validSelection || !validRecipient || !validDeputyDraft(draft) || busy || receipt) return;
      const submitted = latestDraft.current;
      setBusy(true); setError('');
      try { if (await command('delegation.requestBatch', { fromId, taskIds: selectedTasks.map(item => item.id), ...deputyPayload(draft) })) { setSavedDraft(submitted); if (sameDraft(latestDraft.current, submitted) && !sourceChangePending.current) { clearDraft(draftId); onClose(); } else setReceipt(`요청 시점의 세부업무 ${selectedTasks.length}건·대행자·기간·사유로 승인 요청했습니다. 이후 입력은 보존했으며 제출하지 않았습니다. 추가 요청은 이 창을 닫고 승인 대기 내역을 확인해 주세요.`); } else setError('요청하지 못했습니다. 화면 안내를 확인한 뒤 다시 시도해 주세요.'); }
      catch { setError('요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
      finally { setBusy(false); }
    }}>
      {['manager', 'admin'].includes(workspace.currentUser.role) && !task ? <Field label="업무를 맡길 원담당자"><select required value={fromId} onChange={event => { const nextId = event.target.value; sourceChangePending.current = true; requestNavigation(() => { sourceChangePending.current = false; setFromId(nextId); setSelectedIds([]); setDraft(initialDeputyDraft(workspace)); }, () => { sourceChangePending.current = false; }); }}><option value="">원담당자 선택</option>{owners.map(person => <option value={person.id} key={person.id}>{person.name} · {departmentName(workspace, person.departmentId)} · {person.team}</option>)}</select></Field> : <div className="delegation-context"><UserRound size={19}/><div><strong>원담당자 {selectedOwner?.name || '담당자'}</strong><span>{departmentName(workspace, selectedOwner?.departmentId)} · 본인이 담당하는 업무를 선택합니다.</span></div></div>}
      <DelegationTaskSelection workspace={workspace} tasks={ownerTasks} selectedIds={selectedIds} onChange={changeSelection}/>
      {selectedOwner && ownerTasks.length > 0 && <DeputyRequestFields workspace={workspace} fromId={fromId} departmentId={selectedOwner.departmentId} excludedIds={selectedTasks.map(item => item.reviewerId)} value={draft} onChange={setDraft}/>}
      <p className="delegation-note">선택한 {selectedTasks.length}개 세부업무는 하나의 승인 요청으로 묶입니다. 부서장이 전체 내용을 검토한 뒤 함께 승인하며 원본 업무·단위업무는 이동하거나 복제하지 않습니다.</p>
      {selectedTasks.length > 300 && <p className="delegation-error" role="alert">한 번에 300개까지 요청할 수 있습니다. 선택 범위를 나누어 주세요.</p>}
      {error && <p className="delegation-error" role="alert">{error}</p>}{receipt && <p className="delegation-note" role="status">{receipt}</p>}
      <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={close}>취소</Button><Button type="submit" disabled={busy || !!receipt || !validSelection || !validRecipient || !validDeputyDraft(draft)}>{busy ? '요청 중…' : `선택한 ${selectedTasks.length}건 부서장 승인 요청`}</Button></div>
    </form>
  </Modal>;
}

type DelegationGroup = { id: string; records: Delegation[] };

export function DelegationWork({ workspace: w, command, onOpenTask, initialDelegationId }: Props & { onOpenTask?: (id: string) => void; initialDelegationId?: string }) {
  const [filter, setFilter] = useState<'pending' | 'active' | 'history' | 'all'>(w.currentUser.role === 'head' ? 'pending' : 'all');
  const [requesting, setRequesting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => { const item = w.delegations.find(record => record.id === initialDelegationId); return item ? item.batchId || item.id : null; });
  const [resolution, setResolution] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const latestReview = useRef({ selectedId, resolution }); latestReview.current = { selectedId, resolution };
  const [savedResolution, setSavedResolution] = useState('');
  const draftId = useUnsavedChanges(!!selectedId && (busy || resolution !== savedResolution), '업무대행 처리 의견');
  const { requestNavigation, clearDraft } = useUnsavedNavigation();
  const closeReview = () => { if (!busy) requestNavigation(() => { clearDraft(draftId); setSelectedId(null); setResolution(''); setSavedResolution(''); }); };
  const openOriginal = (taskId: string) => requestNavigation(() => { clearDraft(draftId); setSelectedId(null); setResolution(''); setSavedResolution(''); onOpenTask?.(taskId); });
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
  const revision = useRevisionCommand(w, command, selectedRecord ? { kind: selectedRecord.batchId ? 'delegationBatch' : 'delegation', id: selectedRecord.batchId || selectedRecord.id } : null);
  async function decide(action: 'approve' | 'reject' | 'cancel' | 'revoke') {
    if (!selected || !selectedRecord || busy || receipt || revision.conflicted) return;
    if (action !== 'approve' && !validateTextFields([{ path: 'reason', value: resolution, label: action === 'reject' ? '반려 사유' : '처리 사유' }])) return;
    const submitted = latestReview.current;
    setBusy(true); setError('');
    try { if (await revision.command('delegation.' + action, { ...(selectedRecord.batchId ? { batchId: selectedRecord.batchId } : { delegationId: selectedRecord.id }), reason: resolution.trim() })) { setSavedResolution(submitted.resolution); if (sameDraft(latestReview.current, submitted)) { clearDraft(draftId); setSelectedId(null); setResolution(''); setSavedResolution(''); } else if (latestReview.current.selectedId === submitted.selectedId) setReceipt('요청 시점의 의견으로 처리했습니다. 이후 작성한 의견은 아래에 보존했으며 처리 내역에는 포함되지 않았습니다.'); } else setError('처리하지 못했습니다. 최신 상태와 화면 안내를 확인해 주세요.'); }
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
        <footer><span>요청 {personName(w, record.requestedBy || record.fromId)}</span><div>{group.records.length === 1 && taskFor(record) && onOpenTask && <Button variant="secondary" onClick={() => openOriginal(record.taskId)}>원본 업무 보기</Button>}<Button variant={canReview(group) ? 'primary' : 'secondary'} onClick={() => requestNavigation(() => { clearDraft(draftId); setSelectedId(group.id); setResolution(''); setSavedResolution(''); setReceipt(''); setError(''); })}>{canReview(group) ? '검토·승인' : '요청 상세'}</Button></div></footer>
      </article>;
    })}</div> : <EmptyState title="해당하는 업무대행 내역이 없습니다." description="업무대행 요청에서 업무분장표의 전체 또는 필요한 업무를 선택해 주세요."/>}
    {requesting && <DelegationRequestDialog workspace={w} command={command} onClose={() => setRequesting(false)}/>}
    {selected && selectedRecord && <Modal title="업무대행 요청 상세" description={groupTitle(selected)} onClose={closeReview} wide><div className="form-stack">{revision.conflict}
      <div className="delegation-context"><UserRound size={20}/><div><strong>{personName(w, selectedRecord.fromId)} → {personName(w, selectedRecord.toId)}</strong><span>{departmentName(w, selectedRecord.departmentId || taskFor(selectedRecord)?.departmentId)} · {groupLabel(selected)}</span></div></div>
      <dl className="delegation-detail"><div><dt>대행 기간</dt><dd>{dateTime(selectedRecord.startsAt)} ~ {dateTime(selectedRecord.endsAt)}</dd></div><div><dt>요청자·시각</dt><dd>{personName(w, selectedRecord.requestedBy || selectedRecord.fromId)} · {dateTime(selectedRecord.requestedAt)}</dd></div><div><dt>요청 사유</dt><dd>{selectedRecord.reason || '기존 업무대행 지정'}</dd></div>{selectedRecord.resolvedAt && <div><dt>처리자·시각</dt><dd>{personName(w, selectedRecord.resolvedBy || selectedRecord.approvedBy)} · {dateTime(selectedRecord.resolvedAt)}</dd></div>}{selectedRecord.resolutionReason && <div><dt>처리 사유</dt><dd>{selectedRecord.resolutionReason}</dd></div>}</dl>
      <div className="delegation-selection-scroll delegation-review-table" role="region" aria-label="선택된 대행 업무 검토" tabIndex={0}><table><caption>승인 요청에 포함된 원본 업무 {selected.records.length}건</caption><thead><tr><th scope="col">단위업무</th><th scope="col">세부업무</th><th scope="col">상태</th></tr></thead><tbody>{selected.records.map(record => <tr key={record.id}><td>{record.unitTitle || w.units.find(unit => unit.id === taskFor(record)?.unitId)?.title || '단위업무'}</td><td>{taskFor(record) && onOpenTask ? <button type="button" className="text-link" onClick={() => openOriginal(record.taskId)}>{taskFor(record)?.title || record.taskTitle}</button> : record.taskTitle || '세부업무'}</td><td>{delegationLabel(record, now, w, taskFor(record))}</td></tr>)}</tbody></table></div>
      <p className="delegation-note"><Clock3 size={17}/>선택한 업무를 함께 승인합니다. 하나라도 담당자·업무 기준·기간이 달라지면 전체 승인이 중단됩니다. 대행이 끝나도 업무별 기록과 실제 작성자는 보존됩니다.</p>
      {(canReview(selected) || selected.records.some(canCancel) || selected.records.some(canRevoke) || !!receipt || busy) && <Field name="reason" label="처리 의견 · 반려·취소·종료 시 필수" validationLabel="처리 사유"><textarea value={resolution} onChange={event => setResolution(event.target.value)} rows={3} maxLength={2000} readOnly={!busy && !canReview(selected) && !selected.records.some(canCancel) && !selected.records.some(canRevoke)}/></Field>}
      {error && <p className="delegation-error" role="alert">{error}</p>}{receipt && <p className="delegation-note" role="status">{receipt}</p>}
      <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={closeReview}>닫기</Button>{!receipt && selected.records.some(canCancel) && <Button variant="secondary" disabled={busy || revision.conflicted} onClick={() => void decide('cancel')}>요청 취소</Button>}{!receipt && selected.records.some(canRevoke) && <Button variant="secondary" disabled={busy || revision.conflicted} onClick={() => void decide('revoke')}>업무대행 종료</Button>}{!receipt && canReview(selected) && <><Button variant="secondary" disabled={busy || revision.conflicted} onClick={() => void decide('reject')}>반려</Button><Button disabled={busy || revision.conflicted || !selected.records.every(record => delegationStatus(record) === 'pending')} onClick={() => void decide('approve')}><CheckCircle2 size={16}/>{busy ? '처리 중…' : `선택한 ${selected.records.length}건 승인`}</Button></>}</div>
    </div></Modal>}
  </div>;
}

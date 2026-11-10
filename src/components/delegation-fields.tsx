'use client';

import { useRef, useState } from 'react';
import { CheckCircle2, Plus, ShieldCheck, UserRound } from 'lucide-react';
import type { Task, Workspace } from '@/lib/types';
import { activeTaskDelegations, canRequestTaskDelegation, requestableDelegationTasks } from '@/lib/delegations';
import { delegationLabel, delegationPersonName as personName, deputyPayload, deputyRequestCandidates, initialDeputyDraft, validDeputyDraft, type DeputyDraft } from '@/lib/delegation-draft';
import { sameDraft } from '@/lib/pending-draft';
import { formatDateTimeFull as dateTime } from '@/lib/date-format';
import { Badge, Button, Field, type CommandFn } from './ui';
import { useUnsavedChanges, useUnsavedNavigation } from './unsaved-changes';
import { OrganizationPersonPicker } from './organization-person-picker';
import { DelegationTaskSelection } from './delegation-task-selection';
import './delegation-work.css';

type Props = { workspace: Workspace; command: CommandFn };

export function DeputyRequestFields({ workspace, fromId, departmentId, reviewerId, excludedIds = [], value, onChange, disabled = false }: { workspace: Workspace; fromId: string; departmentId: string; reviewerId?: string; excludedIds?: string[]; value: DeputyDraft; onChange: (draft: DeputyDraft) => void; disabled?: boolean }) {
  const candidates = deputyRequestCandidates(workspace, fromId, reviewerId ? [...excludedIds, reviewerId] : excludedIds).filter(person => person.departmentId === departmentId);
  return <div className="delegation-fields"><OrganizationPersonPicker workspace={workspace} value={value.toId} onChange={toId => onChange({ ...value, toId })} candidates={candidates} disabled={disabled}/>
    <div className="form-grid"><Field label="대행 시작일"><input type="date" required value={value.startsOn} disabled={disabled} onChange={event => onChange({ ...value, startsOn: event.target.value })}/></Field><Field label="대행 종료일 · 해당 날짜 포함"><input type="date" required min={value.startsOn} value={value.endsOn} disabled={disabled} onChange={event => onChange({ ...value, endsOn: event.target.value })}/></Field></div>
    <Field name="reason" label="대행 요청 사유"><textarea required rows={3} maxLength={2000} value={value.reason} disabled={disabled} onChange={event => onChange({ ...value, reason: event.target.value })} placeholder="부재 사유와 대행자가 이어서 수행할 내용을 적어 주세요."/></Field>
    <p className="delegation-note"><ShieldCheck size={17}/>원담당자의 부서장이 승인한 뒤 지정 기간에 업무대행을 시작합니다. 같은 업무에 대행 기간을 겹쳐 요청할 수 없습니다.</p>
  </div>;
}

export function TaskDelegationSection({ workspace, command, task, disabled = false }: Props & { task: Task; disabled?: boolean }) {
  const [requesting, setRequesting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([task.id]);
  const [draft, setDraft] = useState(() => initialDeputyDraft(workspace, task.primaryId, [task.reviewerId]));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const currentDraft = { selectedIds, draft };
  const latestDraft = useRef(currentDraft); latestDraft.current = currentDraft;
  const [savedDraft, setSavedDraft] = useState(currentDraft);
  const draftId = useUnsavedChanges(requesting && (busy || !sameDraft(currentDraft, savedDraft)), '업무대행 승인 요청');
  const { requestNavigation, clearDraft } = useUnsavedNavigation();
  const closeRequest = () => { if (!busy) requestNavigation(() => { clearDraft(draftId); setRequesting(false); }); };
  const now = new Date(workspace.serverTime);
  const records = workspace.delegations.filter(item => item.taskId === task.id).slice().sort((a, b) => (b.requestedAt || b.startsAt).localeCompare(a.requestedAt || a.startsAt));
  const active = activeTaskDelegations(workspace, task, undefined, now);
  const candidates = requestableDelegationTasks(workspace, workspace.currentUser, now).filter(item => item.primaryId === task.primaryId);
  const selectedTasks = candidates.filter(item => selectedIds.includes(item.id));
  const validSelection = selectedTasks.length > 0 && selectedTasks.length === selectedIds.length && selectedTasks.length <= 300 && deputyRequestCandidates(workspace, task.primaryId, selectedTasks.map(item => item.reviewerId)).some(person => person.id === draft.toId);
  const changeSelection = (ids: string[]) => { setSelectedIds(ids); if (candidates.some(item => ids.includes(item.id) && item.reviewerId === draft.toId)) setDraft({ ...draft, toId: '' }); };
  return <section className="task-delegation-section"><header><div><h3>업무대행 지정</h3><p>원담당자는 유지되며, 승인된 대행자가 같은 업무의 수행 기록을 이어서 작성합니다.</p></div>{canRequestTaskDelegation(workspace, workspace.currentUser, task, now) && <Button data-task-action="true" variant="secondary" disabled={disabled || busy || requesting} onClick={() => { const initialDraft = { selectedIds: [task.id], draft: initialDeputyDraft(workspace, task.primaryId, [task.reviewerId]) }; setSelectedIds(initialDraft.selectedIds); setDraft(initialDraft.draft); setSavedDraft(initialDraft); setReceipt(''); setRequesting(true); }}><Plus size={16}/>대행 승인 요청</Button>}</header>
    {active.some(item => item.toId === workspace.currentUser.id) && <p className="delegation-current"><CheckCircle2 size={17}/>현재 이 업무를 대행하고 있습니다. 기록에는 실제 작성자가 남고 원담당자와 함께 확인합니다.</p>}
    {records.length ? <div className="task-delegation-list">{records.slice(0, 5).map(item => <div key={item.id}><UserRound size={17}/><div><strong>{personName(workspace, item.toId)}</strong><span>{dateTime(item.startsAt)} ~ {dateTime(item.endsAt)}</span></div><Badge tone={item.status === 'pending' ? 'warning' : active.some(record => record.id === item.id) ? 'info' : 'soft'}>{delegationLabel(item, now, workspace, task)}</Badge></div>)}</div> : <p className="delegation-empty">지정된 업무대행자가 없습니다.</p>}
    {requesting && <form className="form-stack delegation-inline-form" onSubmit={async event => { event.preventDefault(); if (busy || disabled || receipt || !validSelection || !validDeputyDraft(draft)) return; const submitted = latestDraft.current; setBusy(true); setError(''); try { if (await command('delegation.requestBatch', { fromId: task.primaryId, taskIds: selectedTasks.map(item => item.id), ...deputyPayload(draft) })) { setSavedDraft(submitted); if (sameDraft(latestDraft.current, submitted)) { clearDraft(draftId); setRequesting(false); setDraft(initialDeputyDraft(workspace, task.primaryId, [task.reviewerId])); } else setReceipt(`요청 시점의 세부업무 ${selectedTasks.length}건·대행자·기간·사유로 승인 요청했습니다. 이후 입력은 아래에 남아 있으며 제출되지 않았습니다.`); } else setError('요청하지 못했습니다. 화면 안내를 확인해 주세요.'); } catch { setError('요청하지 못했습니다. 다시 시도해 주세요.'); } finally { setBusy(false); } }}><DelegationTaskSelection workspace={workspace} tasks={candidates} selectedIds={selectedIds} onChange={changeSelection} disabled={disabled}/><DeputyRequestFields workspace={workspace} fromId={task.primaryId} departmentId={task.departmentId} excludedIds={selectedTasks.map(item => item.reviewerId)} value={draft} onChange={setDraft} disabled={disabled}/>{error && <p className="delegation-error" role="alert">{error}</p>}{receipt && <p className="delegation-note" role="status">{receipt}</p>}<div className="form-actions"><Button variant="secondary" disabled={busy} onClick={closeRequest}>취소</Button><Button type="submit" disabled={busy || disabled || !!receipt || !validSelection || !validDeputyDraft(draft)}>{busy ? '요청 중…' : `선택한 ${selectedTasks.length}건 부서장 승인 요청`}</Button></div></form>}
  </section>;
}

'use client';

import { useState } from 'react';
import { ArrowLeftRight, ArrowRight, Check, ChevronRight, Clock3, FileText, FolderOpen, History, Inbox, LoaderCircle, RefreshCw, ShieldCheck, UserRound, X } from 'lucide-react';
import type { Task, Unit, User, WorkTransfer, Workspace } from '@/lib/types';
import { residualTransferRoles, transferRoleLabels, transferRoleRecipientError } from '@/lib/transfer-roles';
import { Badge, Button, EmptyState, Field, Modal, type CommandFn } from './ui';
import './personnel-handover.css';

type Tab = 'pending' | 'custody' | 'history';
type Composer = { mode: 'request' | 'emergency'; fromId?: string; unitIds?: string[]; taskIds?: string[]; runIds?: string[] };
const kindLabels = { emergency: '긴급 인사이동', reassignment: '보관 업무 재배정', direct: '직접 인수인계', roles: '남은 역할 정리' };
const statusLabels = { pending: '부서장 승인 대기', completed: '이관 완료', rejected: '반려', cancelled: '취소' };
const transferSummary = (item: WorkTransfer) => item.kind === 'roles' ? `이관 역할 ${item.roles?.length ?? 0}건` : `단위업무 ${item.unitIds.length}개 · 세부업무 ${item.taskIds.length}건 · 진행 회차 ${item.runIds.length}건`;
const timeLabel = (value?: string) => value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
const isActive = (user: User, serverTime: string) => user.active && (!user.endsAt || new Date(user.endsAt) > new Date(serverTime));
const currentTasks = (workspace: Workspace, departmentId: string, fromId?: string) => workspace.tasks.filter(task => task.departmentId === departmentId && (!fromId || task.primaryId === fromId) && !task.deletedAt && task.status !== 'archived' && workspace.units.some(unit => unit.id === task.unitId && !unit.deletedAt));

function personName(workspace: Workspace, personId: string) {
  return workspace.users.find(user => user.id === personId)?.name || workspace.identities?.find(user => user.id === personId)?.name || '이전 담당자';
}

function custodyItems(workspace: Workspace, transfer: WorkTransfer) {
  const taskIds = transfer.taskIds.filter(id => currentTasks(workspace, transfer.departmentId, transfer.toId).some(task => task.id === id));
  const unitIds = transfer.unitIds.filter(id => workspace.units.some(unit => unit.id === id && !unit.deletedAt && unit.ownerId === transfer.toId));
  const runIds = (transfer.executionOnly || []).map(item => item.runId).filter(id => workspace.runs.some(run => run.id === id && run.status !== 'completed' && run.primaryId === transfer.toId));
  return { taskIds, unitIds, runIds };
}

export function PersonnelHandover({ workspace, command, busy = false, onOpenTask }: { workspace: Workspace; command: CommandFn; busy?: boolean; onOpenTask: (id: string) => void }) {
  const user = workspace.currentUser;
  const canManage = user.role === 'manager' || user.role === 'admin';
  const canViewDepartment = canManage || user.role === 'head';
  const [departmentId, setDepartmentId] = useState(user.departmentId);
  const [tab, setTab] = useState<Tab>('pending');
  const [composer, setComposer] = useState<Composer | null>(null);
  const [roleComposer, setRoleComposer] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [legacyBusy, setLegacyBusy] = useState(false);
  const department = workspace.departments.find(item => item.id === departmentId);
  // The server already limits access. Keep the participant's previous-department
  // requests visible after a personnel move, without widening department custody.
  const transfers = (workspace.workTransfers || []).filter(item => item.departmentId === departmentId || user.role !== 'admin' && [item.fromId, item.toId, item.requestedBy].includes(user.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pending = transfers.filter(item => item.status === 'pending');
  const history = transfers.filter(item => item.status !== 'pending');
  const custody = transfers.filter(item => item.departmentId === departmentId && item.kind === 'emergency' && item.status === 'completed').map(transfer => ({ transfer, ...custodyItems(workspace, transfer) })).filter(item => item.unitIds.length || item.taskIds.length || item.runIds.length);
  const query = search.trim().toLocaleLowerCase();
  const matches = (item: WorkTransfer) => !query || `${item.fromName} ${item.toName} ${item.reason} ${item.tasks.map(task => task.title).join(' ')} ${item.units.map(unit => unit.title).join(' ')} ${(item.executionOnly || []).map(run => run.taskTitle).join(' ')}`.toLocaleLowerCase().includes(query);
  const visible = (tab === 'pending' ? pending : history).filter(matches);
  const detail = transfers.find(item => item.id === detailId);
  const canRequest = user.role !== 'head';
  const legacy = workspace.handovers.filter(item => item.departmentId === departmentId && !['completed', 'cancelled'].includes(item.status));
  const legacyStatus = { approval: '승인 대기', acceptance: '인수 확인 대기', changes_requested: '보완 요청', scheduled: '예정', completed: '완료', cancelled: '취소' };
  async function cancelLegacy(handoverId: string) {
    if (busy || legacyBusy) return;
    setLegacyBusy(true);
    try { await command('handover.cancel', { handoverId }); }
    finally { setLegacyBusy(false); }
  }

  return <div className="handover-page">
    <header className="page-heading"><div><p className="eyebrow">업무의 맥락을 다음 담당자에게</p><h1>인수인계</h1><p>{department?.name} · 업무를 맡기고, 승인하고, 이어받은 기록을 남깁니다.</p></div><div className="handover-heading-actions"><Button variant="secondary" disabled={busy} onClick={() => command('workspace.refresh', {})}><RefreshCw size={15}/>현황 새로고침</Button>{canRequest && <Button disabled={busy} onClick={() => setComposer({ mode: 'request' })}><ArrowLeftRight size={16}/>인수인계 요청</Button>}</div></header>

    {user.role === 'admin' && <div className="handover-department"><Field label="관리할 부서"><select value={departmentId} onChange={event => { setDepartmentId(event.target.value); setSearch(''); setDetailId(null); }} disabled={busy}>{workspace.departments.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><p>이관 요청과 긴급 보관을 관리합니다. 최종 배정 승인은 해당 부서장이 처리합니다.</p></div>}
    <div className="handover-confirm-summary"><UserRound size={19}/><div><strong>주담당 외에 남은 역할도 확인하세요.</strong><p>지원·검토·공통업무 총괄·배정 대기 역할을 후임에게 요청하고 부서장 승인을 받습니다. 대행 권한은 승인 후 해제합니다.</p></div><Button variant="secondary" disabled={busy} onClick={() => setRoleComposer(true)}>남은 역할 정리</Button></div>

    <section className="handover-intro" aria-label="인수인계 진행 방법"><div className="handover-intro-symbol"><ArrowLeftRight size={25}/></div><div><h2>{user.role === 'head' ? '배정할 업무와 새 담당자를 확인해 주세요.' : '갑작스러운 이동에도 업무가 이어집니다.'}</h2><p>긴급 인사이동은 부서담당자에게 업무를 먼저 모읍니다. 새 담당자가 정해지면 전체 또는 일부를 선택해 부서장 승인을 받고 배정합니다.</p><div className="handover-flow"><span><Inbox size={14}/>부서 보관 또는 직접 인계</span><ChevronRight size={14}/><span><ShieldCheck size={14}/>부서장 승인</span><ChevronRight size={14}/><span><UserRound size={14}/>새 담당자 배정</span></div></div>{canManage && <Button variant="secondary" disabled={busy} onClick={() => setComposer({ mode: 'emergency' })}>긴급 인사이동<ArrowRight size={15}/></Button>}</section>

    <div className="handover-summary" aria-label="인수인계 요약"><div><Clock3 size={18}/><span>승인 대기</span><strong>{pending.length}<small>건</small></strong></div>{canViewDepartment && <div><Inbox size={18}/><span>부서 보관</span><strong>{custody.length}<small>건</small></strong></div>}<div><History size={18}/><span>처리 이력</span><strong>{history.length}<small>건</small></strong></div></div>

    <section className="handover-list-section"><div className="handover-list-toolbar"><nav className="handover-tabs" aria-label="인수인계 구분"><button type="button" aria-pressed={tab === 'pending'} onClick={() => setTab('pending')}>승인 대기 <span>{pending.length}</span></button>{canViewDepartment && <button type="button" aria-pressed={tab === 'custody'} onClick={() => setTab('custody')}>부서 보관 업무 <span>{custody.length}</span></button>}<button type="button" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>인수인계 이력</button></nav><input className="handover-search" aria-label="인수인계 검색" placeholder="이름·업무·사유 검색" value={search} onChange={event => setSearch(event.target.value)}/></div>
      <p className="handover-list-help">{tab === 'pending' ? '승인 전에는 현재 담당자가 유지됩니다. 승인 대기 중에도 체크리스트와 일정을 기록할 수 있으며, 승인 시 최신 진행 상태로 인계됩니다.' : tab === 'custody' ? '긴급 이관 후 부서담당자에게 남아 있는 업무입니다. 전부 또는 일부를 새 담당자에게 배정 요청할 수 있습니다.' : `요청 당시 업무명, 인계자·인수자, 처리자, 사유와 처리 시각을 확인할 수 있습니다.${user.role !== 'admin' ? ' 본인이 참여한 이전 부서 이력도 함께 표시합니다.' : ''}`}</p>
      {tab === 'custody' ? <div className="handover-records">{custody.filter(item => matches(item.transfer)).map(({ transfer, unitIds, taskIds, runIds }) => <article className="handover-record" key={transfer.id}><div className="handover-record-top"><Badge tone="info">부서 보관 중</Badge><time>{timeLabel(transfer.appliedAt)}</time></div><h3>{transfer.fromName}님의 업무</h3><p className="handover-people"><span>{transfer.fromName}</span><ArrowRight size={15}/><strong>{transfer.toName} · 부서담당자</strong></p><p className="handover-record-reason">{transfer.reason}</p><div className="handover-record-bottom"><span>남은 단위업무 {unitIds.length}개 · 세부업무 {taskIds.length}건{runIds.length > 0 && ` · 별도 회차 ${runIds.length}건`}</span><div><Button variant="ghost" onClick={() => setDetailId(transfer.id)}>이관 기록</Button>{canManage && <Button variant="secondary" disabled={busy} onClick={() => setComposer({ mode: 'request', fromId: transfer.toId, unitIds, taskIds, runIds })}>새 담당자 배정<ArrowRight size={14}/></Button>}</div></div></article>)}{!custody.some(item => matches(item.transfer)) && <EmptyState title={query ? '검색 결과가 없습니다.' : '보관 중인 업무가 없습니다.'} description={query ? '다른 이름이나 업무명으로 검색해 주세요.' : '긴급 인사이동으로 이관한 업무가 이곳에 모입니다.'}/>}</div> : <div className="handover-records">{visible.map(item => <article className="handover-record" key={item.id}><div className="handover-record-top"><div><Badge tone={item.status === 'pending' ? 'warning' : item.status === 'completed' ? 'success' : 'soft'}>{statusLabels[item.status]}</Badge><span className="handover-kind">{kindLabels[item.kind]}</span></div><time>{timeLabel(item.createdAt)}</time></div><h3>{item.fromName}<ArrowRight size={17}/>{item.toName}</h3><p className="handover-record-reason">{item.reason}</p><div className="handover-record-bottom"><span>{transferSummary(item)}<span className="handover-requestor">요청 {item.requestedByName}</span></span><Button variant="secondary" onClick={() => setDetailId(item.id)}>{item.status === 'pending' && user.role === 'head' ? '검토 및 승인' : '상세 보기'}<ChevronRight size={15}/></Button></div></article>)}{!visible.length && <EmptyState title={query ? '검색 결과가 없습니다.' : tab === 'pending' ? '승인을 기다리는 요청이 없습니다.' : '아직 인수인계 이력이 없습니다.'} description={query ? '다른 이름이나 업무명으로 검색해 주세요.' : tab === 'pending' ? canRequest ? '인계할 업무와 새 담당자를 선택해 부서장에게 요청해 보세요.' : '부서에서 제출한 인수인계 요청이 이곳에 표시됩니다.' : '긴급 이관과 승인·반려·취소 내역이 기록됩니다.'}/>}</div>}
    </section>
    {!!legacy.length && <details className="handover-legacy"><summary>이전 인수인계 요청 · {legacy.length}건</summary><p>진행 중인 이전 요청은 취소 후 새 인수인계를 요청할 수 있습니다. 긴급 인사이동 시에는 이관 대상의 이전 요청이 자동으로 취소됩니다.</p>{legacy.map(item => <article className="handover-legacy-record" key={item.id}><div><strong>{item.title}</strong><p>{personName(workspace, item.fromId)} → {personName(workspace, item.toId)} · {legacyStatus[item.status]}</p></div>{(user.id === item.fromId || user.role === 'admin' || user.role === 'head' && user.departmentId === item.departmentId) && <Button variant="secondary" disabled={busy || legacyBusy} onClick={() => cancelLegacy(item.id)}>이전 요청 취소</Button>}</article>)}</details>}
    {composer && <TransferComposer key={`${composer.mode}-${composer.fromId || ''}-${departmentId}`} workspace={workspace} departmentId={departmentId} initial={composer} command={command} busy={busy} onClose={() => setComposer(null)} onCreated={() => { setComposer(null); setTab(composer.mode === 'emergency' ? 'custody' : 'pending'); }}/>} 
    {detail && <TransferDetail key={detail.id} transfer={detail} workspace={workspace} command={command} busy={busy} onClose={() => setDetailId(null)} onOpenTask={onOpenTask}/>} 
    {roleComposer && <RoleTransferComposer workspace={workspace} departmentId={departmentId} command={command} busy={busy} onClose={() => setRoleComposer(false)} onCreated={() => { setRoleComposer(false); setTab('pending'); }}/>}
  </div>;
}

function RoleTransferComposer({ workspace, departmentId, command, busy, onClose, onCreated }: { workspace: Workspace; departmentId: string; command: CommandFn; busy: boolean; onClose: () => void; onCreated: () => void }) {
  const user = workspace.currentUser;
  const managing = ['admin', 'head', 'manager'].includes(user.role);
  const now = new Date(workspace.serverTime);
  const people = [...new Set([...workspace.users.map(person => person.id), ...(workspace.identities ?? []).map(person => person.id)])];
  const sources = (managing ? people : [user.id]).filter(personId => residualTransferRoles(workspace, personId, departmentId, now).length > 0);
  const [fromId, setFromId] = useState(sources.includes(user.id) ? user.id : sources[0] ?? '');
  const [toId, setToId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const roles = residualTransferRoles(workspace, fromId, departmentId, now);
  const pending = (workspace.workTransfers ?? []).filter(item => item.status === 'pending');
  const blocked = (role: typeof roles[number]) => pending.some(item => item.roles?.some(selected => selected.id === role.id) || role.taskId && (item.taskIds.includes(role.taskId) || item.unitIds.some(unitId => workspace.tasks.some(task => task.id === role.taskId && task.unitId === unitId))));
  const selected = roles.filter(role => selectedIds.includes(role.id));
  const recipients = workspace.users.filter(person => person.id !== fromId && person.departmentId === departmentId && isActive(person, workspace.serverTime) && selected.every(role => !transferRoleRecipientError(workspace, role, person, now)));
  const recipientId = recipients.some(person => person.id === toId) ? toId : '';
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || saving || !recipientId || !selected.length || !reason.trim()) return;
    setSaving(true); setError('');
    try {
      if (await command('transfer.rolesRequest', { departmentId, fromId, toId: recipientId, roleIds: selected.map(role => role.id), reason: reason.trim() })) onCreated();
      else setError('역할 정리 요청을 저장하지 못했습니다. 최신 역할과 안내 메시지를 확인해 주세요.');
    } finally { setSaving(false); }
  }
  return <Modal title="남은 역할 정리" description="주담당 업무를 넘긴 뒤에도 남아 있는 책임을 확인합니다. 선택한 역할은 부서장 승인 후 바뀝니다." wide onClose={() => { if (!saving) onClose(); }}><form className="handover-form" onSubmit={submit}>
    <div className="form-grid"><Field label="역할을 인계할 직원"><select value={fromId} disabled={!managing || busy || saving} onChange={event => { setFromId(event.target.value); setSelectedIds([]); setToId(''); }}>{!sources.length && <option value="">남은 역할이 없습니다</option>}{sources.map(personId => <option key={personId} value={personId}>{personName(workspace, personId)}</option>)}</select></Field><Field label="역할을 인수할 후임"><select value={recipientId} disabled={!selected.length || busy || saving} onChange={event => setToId(event.target.value)}><option value="">역할에 맞는 후임 선택</option>{recipients.map(person => <option key={person.id} value={person.id}>{person.name} · {person.team} · {person.title}</option>)}</select></Field></div>
    {!selected.length && <p className="handover-form-hint" role="status">아래에서 이관할 역할을 먼저 선택하세요. 선택한 역할에 맞는 후임만 표시합니다.</p>}
    <p className="handover-form-hint">검토는 부서장·부서담당자·팀장, 공통업무 총괄은 관리 권한 보유자, 배정 대기 역할은 해당 팀의 후임이 맡습니다. 자격이 다른 역할은 나누어 요청하세요.</p>
    <section className="handover-selection" aria-label="남은 역할 선택"><div className="handover-selection-heading"><h3>남은 역할 {roles.length}건</h3><div><button type="button" onClick={() => setSelectedIds(roles.filter(role => !blocked(role)).map(role => role.id))}>전체 선택</button><button type="button" onClick={() => setSelectedIds([])}>선택 해제</button></div></div><div className="handover-work-tree">{roles.map(role => <label className="handover-task-choice" key={role.id}><input type="checkbox" checked={selectedIds.includes(role.id)} disabled={busy || saving || blocked(role)} aria-label={`${transferRoleLabels[role.kind]} ${role.title} 선택`} onChange={event => setSelectedIds(ids => event.target.checked ? [...ids, role.id] : ids.filter(id => id !== role.id))}/><UserRound size={15}/><span><strong>{role.title}</strong><small>{transferRoleLabels[role.kind]}</small></span>{blocked(role) && <Badge tone="warning">요청 중</Badge>}</label>)}{!roles.length && <EmptyState title="정리할 역할이 없습니다." description="소유 단위업무와 주담당 업무는 기존 인수인계 요청에서 처리할 수 있습니다."/>}</div></section>
    {!!selected.length && !recipients.length && <p className="handover-inline-warning">선택한 모든 역할을 맡을 수 있는 후임이 없습니다. 역할별로 나누거나 같은 팀·필요 권한을 가진 구성원을 확인해 주세요.</p>}
    <Field label="역할 변경 · 대행 해제 사유"><textarea required rows={4} maxLength={5000} value={reason} disabled={busy || saving} onChange={event => setReason(event.target.value)} placeholder="인사이동 사유와 후임이 확인할 내용을 적어 주세요."/></Field>
    <p className="handover-form-hint">완료 회차와 기존 작성자 기록은 보존합니다. 대행 권한 해제를 선택한 경우 기존 대행만 해제하며 후임에게 새 대행 권한을 자동 부여하지 않습니다.</p>
    {error && <p className="form-error" role="alert">{error}</p>}<div className="handover-form-actions"><Button variant="secondary" disabled={saving} onClick={onClose}>닫기</Button><Button type="submit" disabled={busy || saving || !recipientId || !selected.length || !reason.trim()}>{saving ? '요청 중…' : `역할 ${selected.length}건 승인 요청`}</Button></div>
  </form></Modal>;
}

function TransferComposer({ workspace, departmentId, initial, command, busy, onClose, onCreated }: { workspace: Workspace; departmentId: string; initial: Composer; command: CommandFn; busy: boolean; onClose: () => void; onCreated: () => void }) {
  const user = workspace.currentUser;
  const managing = user.role === 'manager' || user.role === 'admin';
  const emergency = initial.mode === 'emergency';
  const activeUnits = workspace.units.filter(unit => unit.departmentId === departmentId && !unit.deletedAt);
  const departmentTasks = currentTasks(workspace, departmentId);
  const unfinishedRuns = workspace.runs.filter(run => run.departmentId === departmentId && run.status !== 'completed' && departmentTasks.some(task => task.id === run.taskId));
  const ownerIds = [...new Set([...activeUnits.map(unit => unit.ownerId), ...departmentTasks.map(task => task.primaryId), ...unfinishedRuns.map(run => run.primaryId)])];
  const sources = (managing ? ownerIds : [user.id]).map(id => ({ id, name: personName(workspace, id), user: workspace.users.find(person => person.id === id) })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const [fromId, setFromId] = useState(initial.fromId || (emergency ? sources.find(source => source.id !== user.id)?.id || '' : sources.some(source => source.id === user.id) ? user.id : sources[0]?.id || ''));
  const [toId, setToId] = useState(emergency && user.role === 'manager' && user.id !== fromId ? user.id : '');
  const [unitIds, setUnitIds] = useState<string[]>(initial.unitIds || []);
  const [taskIds, setTaskIds] = useState<string[]>(initial.taskIds || []);
  const [runIds, setRunIds] = useState<string[]>(initial.runIds || []);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const sourceUnits = activeUnits.filter(unit => unit.ownerId === fromId);
  const sourceTasks = departmentTasks.filter(task => task.primaryId === fromId);
  const executionOnly = unfinishedRuns.filter(run => run.primaryId === fromId && !sourceTasks.some(task => task.id === run.taskId));
  const recipients = workspace.users.filter(person => person.departmentId === departmentId && person.id !== fromId && isActive(person, workspace.serverTime) && (emergency ? person.role === 'manager' : ['member', 'lead', 'manager'].includes(person.role)));
  const recipientId = recipients.some(person => person.id === toId) ? toId : emergency && recipients.length === 1 ? recipients[0].id : '';
  const groups = activeUnits.filter(unit => unit.ownerId === fromId || sourceTasks.some(task => task.unitId === unit.id));
  const pending = (workspace.workTransfers || []).filter(item => item.departmentId === departmentId && item.status === 'pending');
  const blockedTaskIds = new Set(pending.flatMap(item => item.taskIds));
  const blockedUnitIds = new Set(pending.flatMap(item => item.unitIds));
  const blockedRunIds = new Set(pending.flatMap(item => item.runIds));
  const selectedUnitIds = emergency ? sourceUnits.map(unit => unit.id) : unitIds.filter(id => sourceUnits.some(unit => unit.id === id));
  const selectedTaskIds = emergency ? sourceTasks.map(task => task.id) : sourceTasks.filter(task => taskIds.includes(task.id) || selectedUnitIds.includes(task.unitId)).map(task => task.id);
  const selectedRunIds = executionOnly.filter(run => emergency || runIds.includes(run.id)).map(run => run.id);
  const selectedRecipient = recipients.find(person => person.id === recipientId);
  const reviewerConflict = !emergency && !!recipientId && (sourceTasks.some(task => selectedTaskIds.includes(task.id) && (task.reviewerId === recipientId || task.versions.at(-1)?.reviewerId === recipientId)) || unfinishedRuns.some(run => run.primaryId === fromId && (selectedTaskIds.includes(run.taskId) || selectedRunIds.includes(run.id)) && run.reviewerId === recipientId));
  const disabled = busy || saving;
  const pendingOverlap = !emergency && (selectedUnitIds.some(id => blockedUnitIds.has(id)) || selectedTaskIds.some(id => blockedTaskIds.has(id)) || selectedRunIds.some(id => blockedRunIds.has(id)));

  function changeSource(id: string) { setFromId(id); setToId(emergency && user.role === 'manager' && user.id !== id ? user.id : ''); setUnitIds([]); setTaskIds([]); setRunIds([]); setConfirmed(false); setError(''); }
  function toggleUnit(unit: Unit, checked: boolean) {
    const tasks = sourceTasks.filter(task => task.unitId === unit.id);
    if (unit.ownerId === fromId) setUnitIds(ids => checked ? [...new Set([...ids, unit.id])] : ids.filter(id => id !== unit.id));
    setTaskIds(ids => checked ? [...new Set([...ids, ...tasks.map(task => task.id)])] : ids.filter(id => !tasks.some(task => task.id === id)));
  }
  function toggleTask(task: Task, checked: boolean) {
    if (selectedUnitIds.includes(task.unitId) && !checked) {
      setUnitIds(ids => ids.filter(id => id !== task.unitId));
      setTaskIds(ids => [...new Set([...ids, ...sourceTasks.filter(item => item.unitId === task.unitId && item.id !== task.id).map(item => item.id)])].filter(id => id !== task.id));
    } else setTaskIds(ids => checked ? [...new Set([...ids, task.id])] : ids.filter(id => id !== task.id));
  }
  function selectAll() {
    setUnitIds(sourceUnits.filter(unit => !blockedUnitIds.has(unit.id) && !sourceTasks.some(task => task.unitId === unit.id && blockedTaskIds.has(task.id))).map(unit => unit.id));
    setTaskIds(sourceTasks.filter(task => !blockedTaskIds.has(task.id) && !blockedUnitIds.has(task.unitId)).map(task => task.id));
    setRunIds(executionOnly.filter(run => !blockedRunIds.has(run.id)).map(run => run.id));
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (disabled) return; setError('');
    if (!fromId || !recipientId || !reason.trim() || (!selectedUnitIds.length && !selectedTaskIds.length && !selectedRunIds.length)) { setError('인계자, 새 담당자, 업무 범위와 인사이동 사유를 확인해 주세요.'); return; }
    if (pendingOverlap) { setError('선택한 업무에 진행 중인 요청이 있습니다. 승인 대기 목록을 확인한 뒤 다시 선택해 주세요.'); return; }
    if (reviewerConflict) { setError('새 담당자가 선택한 업무 또는 진행 회차의 검토자입니다. 다른 담당자를 선택해 주세요.'); return; }
    if (emergency && !confirmed) { setError('전체 업무의 즉시 이관 내용을 확인해 주세요.'); return; }
    setSaving(true);
    try {
      const payload = emergency ? { departmentId, fromId, toId: recipientId, reason: reason.trim() } : { departmentId, fromId, toId: recipientId, unitIds: selectedUnitIds, taskIds: selectedTaskIds, runIds: selectedRunIds, reason: reason.trim() };
      if (await command(emergency ? 'transfer.emergency' : 'transfer.request', payload)) onCreated();
      else setError('처리하지 못했습니다. 화면의 안내를 확인하고 다시 시도해 주세요. 입력한 내용은 유지됩니다.');
    } finally { setSaving(false); }
  }

  return <Modal title={emergency ? '긴급 인사이동' : '인수인계 요청'} description={emergency ? '업무를 부서담당자에게 먼저 이관한 뒤 새 담당자를 배정합니다.' : '인계할 업무와 새 담당자를 선택해 부서장에게 승인을 요청합니다.'} wide onClose={() => { if (!disabled) onClose(); }}><form className="handover-form" onSubmit={submit}><fieldset disabled={disabled}>
    <div className="handover-form-people"><Field label="인계자"><select value={fromId} onChange={event => changeSource(event.target.value)} disabled={!managing} required><option value="">인계자를 선택하세요</option>{sources.map(source => <option key={source.id} value={source.id}>{source.name}{source.user && !isActive(source.user, workspace.serverTime) ? ' · 비활성' : source.user?.departmentId !== departmentId ? ' · 이전 소속' : source.user?.team ? ` · ${source.user.team}` : ''}</option>)}</select></Field><ArrowRight size={19}/><Field label={emergency ? '업무를 보관할 부서담당자' : '새 담당자'}><select value={recipientId} onChange={event => setToId(event.target.value)} required><option value="">{emergency ? '부서담당자를 선택하세요' : '새 담당자를 선택하세요'}</option>{recipients.map(person => <option key={person.id} value={person.id}>{person.name} · {person.team} · {person.title}</option>)}</select></Field></div>
    <p className="handover-form-hint">{emergency ? '퇴직·전출 등으로 계정이 비활성화되었거나 소속이 바뀐 직원도 남아 있는 업무를 이관할 수 있습니다.' : '새로 전입한 직원도 소속 부서의 활성 구성원으로 등록되어 있으면 선택할 수 있습니다.'}</p>
    {!recipients.length && <p className="handover-inline-warning" role="status">{emergency ? '이관받을 활성 부서담당자가 없습니다. 해당 부서의 부서담당자 계정을 확인해 주세요.' : '인수할 수 있는 다른 활성 구성원이 없습니다. 새 담당자의 소속 부서와 계정 상태를 확인해 주세요.'}</p>}
    {reviewerConflict && <p className="handover-inline-warning" role="status">새 담당자가 선택한 업무 또는 진행 회차의 검토자입니다. 수행과 검토를 구분할 수 있도록 다른 담당자를 선택해 주세요.</p>}

    <section className="handover-selection" aria-label="인계 업무 선택"><div className="handover-selection-heading"><div><h3>{emergency ? '전체 이관 대상' : '인계할 업무'}</h3><p>{emergency ? '해당 직원이 소유한 단위업무와 담당 세부업무가 모두 포함됩니다.' : '단위업무 전체 또는 필요한 세부업무만 선택하세요.'}</p></div>{!emergency && <div><button type="button" onClick={selectAll}>전체 선택</button><button type="button" onClick={() => { setUnitIds([]); setTaskIds([]); setRunIds([]); }}>선택 해제</button></div>}</div>
      <div className="handover-work-tree">{groups.map(unit => {
        const tasks = sourceTasks.filter(task => task.unitId === unit.id);
        const owned = unit.ownerId === fromId;
        const checked = owned ? selectedUnitIds.includes(unit.id) : tasks.length > 0 && tasks.every(task => selectedTaskIds.includes(task.id));
        const partial = !checked && tasks.some(task => selectedTaskIds.includes(task.id));
        const blocked = blockedUnitIds.has(unit.id) || tasks.some(task => blockedTaskIds.has(task.id));
        return <div className="handover-work-group" key={unit.id}><label className="handover-unit-choice"><input type="checkbox" aria-label={`${unit.title} ${owned ? '단위업무 전체' : '세부업무 전체'} 선택`} checked={emergency ? true : checked} ref={element => { if (element) element.indeterminate = !emergency && partial; }} onChange={event => toggleUnit(unit, event.target.checked)} disabled={emergency || blocked}/><FolderOpen size={18}/><span><strong>{unit.title}</strong><small>{owned ? '단위업무와 내 세부업무를 함께 이관' : '다른 직원의 단위업무 · 내 세부업무만 이관'}</small></span><span className="handover-work-count">{tasks.length}건</span>{blocked && !emergency && <Badge tone="warning">요청 중</Badge>}</label>{tasks.map(task => <label className="handover-task-choice" key={task.id}><input type="checkbox" aria-label={`${task.title} 선택`} checked={selectedTaskIds.includes(task.id)} disabled={emergency || blockedTaskIds.has(task.id) || blockedUnitIds.has(unit.id)} onChange={event => toggleTask(task, event.target.checked)}/><FileText size={15}/><span><strong>{task.title}</strong><small>{task.code} · {task.dueDate ? `${task.dueDate} 마감` : '기한 미정'}</small></span>{blockedTaskIds.has(task.id) && !emergency && <Badge tone="warning">요청 중</Badge>}</label>)}{!tasks.length && <p className="handover-empty-unit">담당 세부업무가 없는 단위업무입니다.</p>}</div>;
      })}{!groups.length && !executionOnly.length && <EmptyState title="이관할 업무가 없습니다." description="해당 부서에 남아 있는 단위업무와 활성 세부업무가 표시됩니다."/>}{!!executionOnly.length && <div className="handover-work-group"><div className="handover-unit-choice"><Clock3 size={17}/><span><strong>이전 배정에서 남은 진행 회차</strong><small>현재 업무 담당자와 별개로 수행 중인 회차를 함께 이관합니다.</small></span></div>{executionOnly.map(run => <label className="handover-task-choice" key={run.id}><input type="checkbox" aria-label={`${run.title} 진행 회차 선택`} checked={selectedRunIds.includes(run.id)} disabled={emergency || blockedRunIds.has(run.id)} onChange={event => setRunIds(ids => event.target.checked ? [...new Set([...ids, run.id])] : ids.filter(id => id !== run.id))}/><Clock3 size={15}/><span><strong>{departmentTasks.find(task => task.id === run.taskId)?.title || run.title}</strong><small>{run.title} · {run.period}</small></span>{blockedRunIds.has(run.id) && !emergency && <Badge tone="warning">요청 중</Badge>}</label>)}</div>}</div>
      <div className="handover-selection-total"><span>{emergency ? '전체 이관' : '선택한 범위'}</span><strong>단위업무 {selectedUnitIds.length}개 · 세부업무 {selectedTaskIds.length}건{selectedRunIds.length > 0 && ` · 별도 진행 회차 ${selectedRunIds.length}건`}</strong></div>
      {!emergency && <p className="handover-form-hint">세부업무만 선택하면 새 담당자 소유의 단위업무에 연결됩니다. 다른 직원의 담당 업무는 함께 이전되지 않습니다.</p>}
    </section>
    <Field label="인사이동 사유 · 인계할 내용"><textarea value={reason} onChange={event => setReason(event.target.value)} placeholder="인사이동 사유, 진행 중인 일과 다음 담당자가 알아야 할 내용을 적어 주세요." rows={4} required maxLength={5000}/></Field>
    <div className={`handover-confirm-summary${emergency ? ' is-emergency' : ''}`}><ShieldCheck size={19}/><div><strong>{emergency ? `${selectedRecipient?.name || '부서담당자'}에게 즉시 이관합니다.` : `${selectedRecipient?.name || '새 담당자'}에게 부서장 승인 후 배정합니다.`}</strong><p>{emergency ? '이관 대상의 기존 승인 대기 요청은 취소됩니다. 보관한 업무의 새 담당자 배정은 별도로 부서장 승인을 받습니다.' : '승인 전까지 현재 담당자가 유지됩니다. 완료된 회차와 기존 수행·성과 기록은 보존됩니다.'}</p>{emergency && <label className="handover-emergency-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/>전체 업무의 즉시 이관과 기존 요청 취소를 확인했습니다.</label>}</div></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="handover-form-actions"><Button variant="secondary" onClick={onClose}>닫기</Button><Button type="submit" disabled={disabled || !recipientId || !reason.trim() || (!selectedUnitIds.length && !selectedTaskIds.length && !selectedRunIds.length) || pendingOverlap || reviewerConflict || emergency && !confirmed}>{saving ? <LoaderCircle className="spin" size={16}/> : emergency ? <Inbox size={16}/> : <ShieldCheck size={16}/>} {emergency ? '전체 업무 부서 보관' : '부서장 승인 요청'}</Button></div>
  </fieldset></form></Modal>;
}

function TransferDetail({ transfer, workspace, command, busy, onClose, onOpenTask }: { transfer: WorkTransfer; workspace: Workspace; command: CommandFn; busy: boolean; onClose: () => void; onOpenTask: (id: string) => void }) {
  const user = workspace.currentUser;
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const canApprove = user.role === 'head' && user.departmentId === transfer.departmentId && transfer.status === 'pending';
  const canCancel = transfer.requestedBy === user.id && transfer.status === 'pending';
  const disabled = busy || saving;
  const eventLabels = { requested: '승인 요청', emergency: '긴급 이관', approved: '승인 · 배정 완료', rejected: '반려', cancelled: '요청 취소' };
  async function resolve(action: 'approve' | 'reject' | 'cancel') {
    if (disabled || action === 'reject' && !reason.trim()) return;
    setSaving(true); setError('');
    try { if (await command(`transfer.${action}`, { transferId: transfer.id, ...(action === 'reject' ? { reason: reason.trim() } : {}) })) { setRejecting(false); setReason(''); } else setError('처리하지 못했습니다. 안내 메시지와 현재 요청 상태를 확인해 주세요.'); }
    finally { setSaving(false); }
  }
  return <Modal title="인수인계 상세" description="요청 당시의 업무 범위와 처리 이력을 확인합니다." wide onClose={() => { if (!disabled) onClose(); }}><div className="handover-detail">
    <div className="handover-detail-heading"><Badge tone={transfer.status === 'pending' ? 'warning' : transfer.status === 'completed' ? 'success' : 'soft'}>{statusLabels[transfer.status]}</Badge><span>{kindLabels[transfer.kind]}</span></div>
    <div className="handover-person-route"><div><span>인계자</span><strong>{transfer.fromName}</strong></div><ArrowRight size={22}/><div><span>{transfer.kind === 'emergency' ? '보관 부서담당자' : '새 담당자'}</span><strong>{transfer.toName}</strong></div></div>
    <dl className="handover-detail-meta"><div><dt>요청자</dt><dd>{transfer.requestedByName}</dd></div><div><dt>요청 일시</dt><dd>{timeLabel(transfer.createdAt)}</dd></div>{transfer.approvedBy && <div><dt>승인자</dt><dd>{transfer.events.find(event => event.action === 'approved')?.actorName || personName(workspace, transfer.approvedBy)}</dd></div>}{transfer.appliedAt && <div><dt>실제 이관 일시</dt><dd>{timeLabel(transfer.appliedAt)}</dd></div>}</dl>
    <section className="handover-detail-reason"><h3>인사이동 사유 · 인계 내용</h3><p>{transfer.reason}</p></section>
    {!!transfer.roles?.length && <section className="handover-detail-work"><div><h3>정리할 역할</h3><span>{transfer.roles.length}건</span></div><ul className="handover-task-snapshots">{transfer.roles.map(role => <li key={role.id}><UserRound size={16}/><div><strong>{role.title}</strong><span>{transferRoleLabels[role.kind]} · {role.kind === 'delegation_revoke' ? '기존 대행 권한 해제' : `${transfer.fromName} → ${transfer.toName}`}</span></div></li>)}</ul></section>}
    {transfer.resolutionReason && <div className="handover-inline-warning"><strong>처리 사유</strong><p>{transfer.resolutionReason}</p></div>}
    <section className="handover-detail-work"><div><h3>인계 범위</h3><span>{transferSummary(transfer)}</span></div>{transfer.units.length > 0 && <ul className="handover-unit-snapshots">{transfer.units.map(unit => <li key={unit.unitId}><FolderOpen size={16}/><span>{unit.title}</span><Badge tone="outline">단위업무</Badge></li>)}</ul>}<ul className="handover-task-snapshots">{transfer.tasks.map(task => <li key={task.taskId}><FileText size={16}/><div><strong>{task.title}</strong><span>{task.code} · {task.unitTitle}</span></div>{workspace.tasks.some(item => item.id === task.taskId && !item.deletedAt) && <button type="button" onClick={() => { onClose(); onOpenTask(task.taskId); }}>업무 보기<ChevronRight size={14}/></button>}</li>)}</ul>{!!transfer.unitMappings?.length && <p className="handover-form-hint">세부업무는 {transfer.unitMappings.map(mapping => mapping.title).join(', ')} 단위업무에 연결되었습니다.</p>}</section>
    {!!transfer.executionOnly?.length && <section className="handover-detail-work"><div><h3>{transfer.status === 'pending' ? '함께 이관할 진행 회차' : '진행 회차 이관 범위'}</h3><span>{transfer.executionOnly.length}건</span></div><ul className="handover-task-snapshots">{transfer.executionOnly.map(item => <li key={item.runId}><Clock3 size={16}/><div><strong>{item.taskTitle}</strong><span>업무의 현재 담당자는 유지하며, 이 진행 회차의 수행 담당자를 인계합니다.</span></div></li>)}</ul></section>}
    <section className="handover-event-log"><h3><History size={17}/>인수인계 로그</h3><ol>{transfer.events.map(event => <li key={event.id}><span className="handover-event-dot"/><div><strong>{eventLabels[event.action]} <span>· {event.actorName}</span></strong><time>{timeLabel(event.at)}</time><p>{event.note}</p></div></li>)}</ol></section>
    {transfer.status === 'pending' && <div className="handover-confirm-summary"><ShieldCheck size={19}/><div><strong>현재 담당자는 아직 변경되지 않았습니다.</strong><p>{transfer.kind === 'roles' ? '부서장이 승인하면 선택한 역할을 후임에게 넘기고 선택한 대행 권한을 해제합니다. 완료 회차 기록은 보존합니다.' : canApprove ? '선택된 업무와 진행 중인 회차를 새 담당자에게 배정합니다. 승인 시점에도 대상과 소속이 유효한지 다시 확인합니다.' : '해당 부서장이 승인하면 새 담당자에게 업무가 배정됩니다.'}</p></div></div>}
    {rejecting && canApprove && <Field label="반려 사유"><textarea value={reason} onChange={event => setReason(event.target.value)} rows={3} maxLength={5000} disabled={disabled} placeholder="보완이 필요한 업무 범위나 배정 사유를 적어 주세요."/></Field>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="handover-detail-actions"><Button variant="secondary" disabled={disabled} onClick={onClose}>닫기</Button><div>{canCancel && <Button variant="ghost" disabled={disabled} onClick={() => resolve('cancel')}>요청 취소</Button>}{canApprove && (rejecting ? <><Button variant="secondary" disabled={disabled} onClick={() => setRejecting(false)}>반려 취소</Button><Button disabled={disabled || !reason.trim()} onClick={() => resolve('reject')}><X size={15}/>반려 처리</Button></> : <><Button variant="secondary" disabled={disabled} onClick={() => setRejecting(true)}>반려</Button><Button disabled={disabled} onClick={() => resolve('approve')}><Check size={16}/>승인하여 배정</Button></>)}</div></div>
  </div></Modal>;
}

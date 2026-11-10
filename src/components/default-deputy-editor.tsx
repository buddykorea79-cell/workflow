'use client';

import { useEffect, useRef, useState } from 'react';
import { Save, ShieldCheck } from 'lucide-react';
import { defaultDeputyCandidates, getDefaultDeputy } from '@/lib/default-deputy';
import { isOrganizationUserActive } from '@/lib/organization-management';
import type { User, Workspace } from '@/lib/types';
import { Button, Field, Modal, type CommandFn } from './ui';
import { useRevisionCommand } from './command-revision';
import { useUnsavedChanges, useUnsavedNavigation } from './unsaved-changes';

export const defaultDeputyNotice = '기본 대행자는 부재 시 연락·업무 협조를 위한 지정 정보입니다. 실제 업무대행은 기간과 부서장 승인 후 시작합니다.';

export function defaultDeputyLabel(workspace: Workspace, person: User) {
  const deputy = getDefaultDeputy(workspace, person, new Date(workspace.serverTime));
  if (deputy) return deputy.name;
  if (!person.defaultDeputyId) return '미지정';
  const saved = workspace.users.find(candidate => candidate.id === person.defaultDeputyId);
  return `${saved?.name || '구성원'} · 지정 정보 확인 필요`;
}

export function DefaultDeputyEditor({ workspace, command, person, onClose }: { workspace: Workspace; command: CommandFn; person: User; onClose: () => void }) {
  const revision = useRevisionCommand(workspace, command, { kind: 'user', id: person.id });
  const [deputyId, setDeputyId] = useState(person.defaultDeputyId || '');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const initialDeputyId = useRef(person.defaultDeputyId || '');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const draftId = useUnsavedChanges(saving || deputyId !== initialDeputyId.current || !!reason, '기본 대행자 지정');
  const { requestNavigation, clearDraft } = useUnsavedNavigation();
  const close = () => { if (!saving) requestNavigation(() => { clearDraft(draftId); onClose(); }); };
  if (workspace.currentUser.role !== 'admin') return null;
  const currentPerson = workspace.users.find(candidate => candidate.id === person.id);
  const editable = !!currentPerson && isOrganizationUserActive(currentPerson, new Date(workspace.serverTime));
  const candidates = currentPerson ? defaultDeputyCandidates(workspace, currentPerson, new Date(workspace.serverTime)) : [];
  const validCandidate = !deputyId || candidates.some(candidate => candidate.id === deputyId);
  const canSave = editable && validCandidate && deputyId !== initialDeputyId.current && !!reason.trim() && !saving && !revision.conflicted;
  const selectedName = workspace.users.find(candidate => candidate.id === deputyId)?.name || '구성원 확인 필요';
  return <Modal title="기본 대행자 변경" description={`${person.name} · ${person.team} · ${person.title}`} onClose={close}>
    <form className="form-stack" onSubmit={async event => {
      event.preventDefault(); if (!canSave) return;
      setSaving(true); setError('');
      try {
        const saved = await revision.command('organization.setDefaultDeputy', { userId: person.id, deputyId: deputyId || null, reason: reason.trim() });
        if (!mounted.current) return;
        if (saved) { clearDraft(draftId); onClose(); }
        else setError('저장하지 못했습니다. 화면 안내와 지정 후보를 확인해 주세요.');
      } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '기본 대행자를 저장하지 못했습니다.'); }
      finally { if (mounted.current) setSaving(false); }
    }}>
      <p className="muted">현재 기본 대행자: {currentPerson ? defaultDeputyLabel(workspace, currentPerson) : '구성원 확인 필요'}</p>
      <Field label="기본 대행자"><select value={deputyId} disabled={saving || !editable} onChange={event => setDeputyId(event.target.value)}>
        <option value="">미지정 · 기존 지정 해제</option>
        {!validCandidate && <option value={deputyId} disabled>{selectedName} · 지정 정보 확인 필요</option>}
        {candidates.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.team} · {candidate.title}</option>)}
      </select><small className="muted">같은 부서의 활성 구성원 중에서 지정합니다.{person.role === 'head' ? ' 부서장은 팀장을 기본 대행자로 지정할 수 있습니다.' : ''}</small></Field>
      <Field label="변경 사유"><textarea required rows={3} maxLength={2000} value={reason} disabled={saving || !editable} onChange={event => setReason(event.target.value)} placeholder="지정하거나 해제하는 사유를 기록하세요." /></Field>
      <div className="management-info"><ShieldCheck size={18}/><p>{defaultDeputyNotice}</p></div>
      {!editable && <p className="form-error" role="alert">활성 구성원의 기본 대행자만 변경할 수 있습니다.</p>}{revision.conflict}{error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><Button variant="secondary" disabled={saving} onClick={close}>취소</Button><Button type="submit" disabled={!canSave}><Save size={16}/>{saving ? '저장 중…' : '기본 대행자 저장'}</Button></div>
    </form>
  </Modal>;
}

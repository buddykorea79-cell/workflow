'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, FileText, FolderPlus, Pencil } from 'lucide-react';
import { commonRegistrationState, registrationUnitTitle, savedRegistrationUnit } from '@/lib/common-registration';
import { sameDraft } from '@/lib/pending-draft';
import { unitImportance } from '@/lib/unit-importance';
import type { Unit, Workspace } from '@/lib/types';
import { useRevisionCommand } from './command-revision';
import { UnitFormFields, validateUnitImportance } from './unit-form-fields';
import { useUnsavedChanges, useUnsavedNavigation } from './unsaved-changes';
import { Button, Field, Modal, type CommandFn } from './ui';
import './common-registration-modal.css';

type Props = {
  workspace: Workspace;
  command: CommandFn;
  commonId: string;
  distributionId: string;
  initialUnitId?: string;
  onRegistered?: (unitId: string) => void;
  onGoPersonal?: () => void;
  onClose: () => void;
};

export function CommonRegistrationModal({ workspace: w, command, commonId, distributionId, initialUnitId, onRegistered, onGoPersonal, onClose }: Props) {
  // The saved response can arrive one render before the parent publishes its workspace.
  const [savedUnitResult, setSavedUnitResult] = useState<{ unit: Unit; revision: number } | null>(null);
  const localWorkspace = savedUnitResult && savedUnitResult.revision > w.revision
    ? { ...w, units: [...w.units.filter(unit => unit.id !== savedUnitResult.unit.id), savedUnitResult.unit] } : w;
  const state = commonRegistrationState(localWorkspace, commonId, distributionId);
  const [unitId, setUnitId] = useState(() => state.units.find(unit => unit.id === initialUnitId)?.id || state.units[0]?.id || '');
  const [savedSelection, setSavedSelection] = useState(unitId);
  const [unitDraft, setUnitDraft] = useState(() => ({ title: registrationUnitTitle(state.common?.projectName), description: '', importance: '5' }));
  const [savedUnitDraft, setSavedUnitDraft] = useState(unitDraft);
  const [unitOpen, setUnitOpen] = useState(!state.units.length);
  const [createdUnitId, setCreatedUnitId] = useState('');
  const [creationConfirmed, setCreationConfirmed] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [busy, setBusy] = useState<'unit' | 'registration' | null>(null);
  const [unitNotice, setUnitNotice] = useState('');
  const [registrationNotice, setRegistrationNotice] = useState('');
  const busyRef = useRef(false);
  const registeredRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const latest = useRef({ unitId, unitDraft }); latest.current = { unitId, unitDraft };
  const registrationFormId = useId(), unitRegionId = useId();
  const commonRevision = useRevisionCommand(w, command, { kind: 'common', id: commonId });
  const unitRevision = useRevisionCommand(localWorkspace, command, createdUnitId ? { kind: 'unit', id: createdUnitId } : null);
  const unitDirty = !sameDraft(unitDraft, savedUnitDraft);
  const selectionDraftId = useUnsavedChanges(unitId !== savedSelection, '공통업무 등록 단위업무');
  const unitDraftId = useUnsavedChanges(unitDirty, '새 단위업무 내용');
  const { requestNavigation, clearDraft, clearDrafts } = useUnsavedNavigation();
  const draftIds = [selectionDraftId, unitDraftId];
  const close = () => requestNavigation(() => { clearDrafts(draftIds); onClose(); });
  const currentUnit = state.units.find(unit => unit.id === unitId);
  const createdUnit = state.units.find(unit => unit.id === createdUnitId);
  const activeUser = w.currentUser.active && (!w.currentUser.endsAt || new Date(w.currentUser.endsAt) > new Date(w.serverTime));
  const unitWritable = activeUser && state.definitionEditable && (createdUnitId ? !!createdUnit : !state.blocked || registered);
  const missingCreatedId = creationConfirmed && !createdUnitId;

  const changeUnit = (value: string) => { latest.current = { ...latest.current, unitId: value }; setUnitId(value); };
  const changeDraft = (field: 'title' | 'description' | 'importance', value: string) => {
    const next = { ...latest.current.unitDraft, [field]: value };
    latest.current = { ...latest.current, unitDraft: next }; setUnitDraft(next);
  };

  async function saveUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || !unitWritable || missingCreatedId || unitRevision.conflicted) return;
    const submitted = { ...latest.current.unitDraft };
    if (!validateUnitImportance(submitted.importance)) return;
    const selectedAtSubmit = latest.current.unitId;
    const action = createdUnitId ? 'unit.update' : 'unit.create';
    const previousUnitIds = w.units.map(unit => unit.id);
    const departmentId = state.distribution?.departmentId || w.currentUser.departmentId;
    let saved: Unit | undefined;
    busyRef.current = true; setBusy('unit'); setUnitNotice('');
    try {
      const success = await unitRevision.command(action, createdUnitId
        ? { unitId: createdUnitId, ...submitted, importance: Number(submitted.importance) }
        : { ...submitted, importance: Number(submitted.importance), ownerId: w.currentUser.id }, {
        onSaved: result => {
          saved = savedRegistrationUnit(result, { ownerId: w.currentUser.id, departmentId, previousUnitIds, title: submitted.title, unitId: createdUnitId || undefined });
          if (saved && mounted.current) setSavedUnitResult({ unit: saved, revision: result.revision });
        },
      });
      if (!mounted.current) return;
      if (!success) {
        setUnitNotice(createdUnitId ? '수정 내용은 유지했습니다. 오류를 확인한 뒤 다시 저장해 주세요.' : '입력 내용은 유지했습니다. 같은 이름의 단위업무가 목록에 있으면 선택하고, 없으면 오류를 확인한 뒤 다시 시도해 주세요.');
        return;
      }
      setCreationConfirmed(true); setSavedUnitDraft(submitted);
      if (!saved) {
        setUnitNotice('단위업무는 저장했지만 연결 정보를 확인하지 못했습니다. 중복 생성을 막기 위해 다시 만들지 않습니다. 아래 목록에서 저장된 단위업무를 선택하거나 개인업무에서 확인해 주세요.');
        return;
      }
      setCreatedUnitId(saved.id);
      const unchangedDraft = sameDraft(latest.current.unitDraft, submitted);
      const unchangedSelection = latest.current.unitId === selectedAtSubmit;
      if (action === 'unit.create' && unchangedSelection) changeUnit(saved.id);
      if (unchangedDraft) clearDraft(unitDraftId);
      if (unchangedDraft && unchangedSelection) setUnitOpen(false);
      setUnitNotice(!unchangedDraft
        ? '요청한 단위업무는 저장했습니다. 저장 중 추가한 내용은 그대로 남아 있습니다. 다시 저장하면 같은 단위업무를 수정합니다.'
        : action === 'unit.create' && !unchangedSelection
          ? '새 단위업무를 만들었습니다. 저장 중 바꾼 선택은 유지했습니다. 등록할 단위업무를 확인해 주세요.'
          : action === 'unit.create'
            ? '새 단위업무를 만들고 선택했습니다. 아래에서 세부업무로 등록을 눌러 연결하세요.'
            : '단위업무 수정사항을 저장했습니다.');
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || registeredRef.current || state.blocked || commonRevision.conflicted || !currentUnit || unitDirty) return;
    const submitted = { unitId: latest.current.unitId, unitDraft: { ...latest.current.unitDraft } };
    busyRef.current = true; setBusy('registration'); setRegistrationNotice('');
    try {
      const success = await commonRevision.command('common.register', { commonId, distributionId, unitId: submitted.unitId });
      if (!mounted.current) return;
      if (!success) {
        setRegistrationNotice(creationConfirmed
          ? '단위업무는 저장되어 있습니다. 공통업무 연결은 완료하지 못했으니 오류를 확인한 뒤 같은 단위업무로 다시 등록해 주세요.'
          : '선택한 단위업무는 유지했습니다. 오류를 확인한 뒤 다시 등록해 주세요.');
        return;
      }
      registeredRef.current = true; setRegistered(true); setSavedSelection(submitted.unitId);
      if (sameDraft(latest.current, submitted)) {
        clearDrafts(draftIds); onRegistered?.(submitted.unitId); onClose();
      } else {
        setRegistrationNotice('요청한 단위업무로 등록했습니다. 등록 중 바꾼 선택이나 추가 입력은 반영되지 않았으며 그대로 남아 있습니다. 단위업무 수정은 여기서 저장하고, 소속 변경은 개인업무의 세부업무 수정에서 진행해 주세요.');
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(null);
    }
  }

  function discardUnitDraft() {
    requestNavigation(() => {
      latest.current = { ...latest.current, unitDraft: savedUnitDraft };
      setUnitDraft(savedUnitDraft); setUnitOpen(false); clearDraft(unitDraftId);
    }, undefined, [selectionDraftId]);
  }

  return <Modal title="내 단위업무에 등록" description="업무 묶음을 선택하거나 이 창에서 만든 뒤, 배정받은 공통업무를 세부업무로 연결합니다." onClose={close} initialFocusSelector={state.units.length ? 'select[name="unitId"]' : 'input[name="unitTitle"]'}>
    <div className="form-stack">
      <div className="common-registration-context"><FileText size={23} /><div><strong>{state.common?.title || '배정받은 공통업무'}</strong><span>{w.departments.find(department => department.id === state.distribution?.departmentId)?.name || '소속 부서'} · {w.currentUser.name}</span></div></div>
      <form id={registrationFormId} className="common-registration-choice" onSubmit={register}>
        <Field name="unitId" label="소속 단위업무 · 내가 만든 업무 묶음">
          <select name="unitId" required value={unitId} onChange={event => changeUnit(event.target.value)}>
            <option value="">단위업무 선택</option>
            {state.units.map(unit => <option key={unit.id} value={unit.id}>{unit.title} · 중요도 {unitImportance(unit)}</option>)}
          </select>
        </Field>
      </form>
      <Button className="common-registration-toggle" variant="secondary" aria-expanded={unitOpen} aria-controls={unitRegionId} onClick={() => setUnitOpen(open => !open)}>
        {createdUnitId ? <Pencil size={16} /> : <FolderPlus size={16} />}{unitOpen ? '단위업무 입력 접기' : createdUnitId ? '만든 단위업무 수정' : '새 단위업무 만들기'}
      </Button>
      {unitOpen && <section id={unitRegionId} aria-label={createdUnitId ? '만든 단위업무 수정' : '새 단위업무 만들기'}>
        <form className="common-registration-unit" onSubmit={saveUnit}>
          <h3>{createdUnitId ? '만든 단위업무 수정' : '새 단위업무 만들기'}</h3>
          {!state.units.length && <p className="muted">단위업무가 없습니다. 이름과 업무 범위를 적어 첫 업무 묶음을 만들어 주세요.</p>}
          {!creationConfirmed && (state.common?.projectName?.length || 0) > 100 && <p className="muted">사업명이 길어 단위업무 이름은 앞부분 100자 이내로 제안했습니다. 필요한 이름으로 바꿔 주세요.</p>}
          <UnitFormFields title={unitDraft.title} description={unitDraft.description} importance={unitDraft.importance} onTitleChange={value => changeDraft('title', value)} onDescriptionChange={value => changeDraft('description', value)} onImportanceChange={value => changeDraft('importance', value)} />
          {unitRevision.conflict}
          <div className="form-actions"><Button variant="ghost" disabled={busy === 'unit'} onClick={discardUnitDraft}>입력 취소</Button><Button type="submit" variant="secondary" disabled={!!busy || !unitWritable || unitRevision.conflicted || missingCreatedId || !!createdUnitId && !unitDirty}>{busy === 'unit' ? '저장 중…' : createdUnitId ? '단위업무 수정사항 저장' : '단위업무 만들기'}</Button></div>
        </form>
      </section>}
      {unitNotice && <p className="common-registration-note" role="status">{unitNotice}</p>}
      {unitDirty && <p className="muted">작성한 단위업무 내용을 먼저 저장해 주세요. 입력 취소를 선택하면 기존 단위업무로 바로 등록할 수 있습니다.</p>}
      {state.blocked && !registered && <p className="common-registration-note" role="status">{state.blocked}</p>}
      {!state.definitionEditable && registered && <p className="common-registration-note" role="status">부서 업무분장이 확정되어 단위업무를 수정할 수 없습니다. 입력 내용은 유지했습니다.</p>}
      <p className="muted">단위업무를 만든 다음 세부업무로 등록합니다. 등록이 실패해도 만들어진 단위업무는 그대로 남으며 다시 선택할 수 있습니다.</p>
      {registrationNotice && <p className="common-registration-note" role="status">{registrationNotice}</p>}
      {commonRevision.conflict}
      <div className="form-actions common-registration-actions">
        {onGoPersonal && <Button variant="ghost" onClick={() => requestNavigation(() => { clearDrafts(draftIds); onClose(); onGoPersonal(); })}>개인업무로 이동</Button>}
        <Button variant="secondary" onClick={close}>{registered ? '닫기' : '취소'}</Button>
        <Button type="submit" form={registrationFormId} disabled={!!busy || registered || !!state.blocked || commonRevision.conflicted || !currentUnit || unitDirty}>{busy === 'registration' ? '등록 중…' : '세부업무로 등록'}<ArrowRight size={15} /></Button>
      </div>
    </div>
  </Modal>;
}

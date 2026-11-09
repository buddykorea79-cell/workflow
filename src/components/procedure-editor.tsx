'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import type { WorkflowStep, Workspace } from '@/lib/types';
import type { ProcedureParticipants } from '@/lib/procedure-participants';
import { taskProcedureContext, type ProcedureContext } from '@/lib/procedure-context';
import { canMoveProcedureStep, canRemoveProcedureStep, canSetProcedureDependency, procedureOrderStart } from '@/lib/procedure-order';
import { Button, Badge, Field, type CommandFn } from './ui';
import { createLazyScreen } from './lazy-screen';
import { TaskFileAttachments } from './task-file-attachments';
import './procedure-editor.css';

const { Component: ProcedureFlow } = createLazyScreen(() => import('./procedure-builder').then(module => module.ProcedureFlow), { label: '절차도', kind: 'section' });

const roles: Record<WorkflowStep['role'], string> = { primary: '담당자', support: '협업·지원', reviewer: '검토자' };

interface Props {
  workspace: Workspace;
  taskId: string;
  command: CommandFn;
  onWorkspace?: (workspace: Workspace) => void;
  onBusyChange?: (busy: boolean) => void;
  workflow: WorkflowStep[];
  originalWorkflow: WorkflowStep[];
  participants: ProcedureParticipants;
  context?: ProcedureContext;
  hasSupport?: boolean;
  hasReviewer?: boolean;
  reviewRequired?: boolean;
  onStartEditing?: () => void;
  onOpenOrganization?: () => void;
  requiredStepTitles?: string[];
  editable: boolean;
  busy: boolean;
  hasChanges?: boolean;
  diagramChanged: boolean;
  redrawKey: number;
  onApply: () => Promise<boolean>;
  onChange: (id: string, patch: Partial<WorkflowStep>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onAdd: () => string | undefined;
}

export function ProcedureEditor({ workspace, taskId, command, onWorkspace, onBusyChange, workflow, originalWorkflow, participants, context, hasSupport = false, hasReviewer = true, reviewRequired = true, onStartEditing, onOpenOrganization, requiredStepTitles = [], editable, busy, hasChanges = false, diagramChanged, redrawKey, onApply, onChange, onRemove, onMove, onAdd }: Props) {
  const [selectedId, setSelectedId] = useState('');
  const [focusStep, setFocusStep] = useState('');
  const warningId = useId();
  const titleInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const roleSelects = useRef<Record<string, HTMLSelectElement | null>>({});
  const stepSections = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    if (!focusStep || !stepSections.current[focusStep]) return;
    const input = titleInputs.current[focusStep];
    const target = input && !input.disabled ? input : stepSections.current[focusStep];
    target?.focus({ preventScroll: true });
    stepSections.current[focusStep]?.scrollIntoView({ block: 'start' });
    setFocusStep('');
  }, [focusStep, workflow]);
  const selectStep = (id: string) => { setSelectedId(id); setFocusStep(id); };
  const add = () => { const id = onAdd(); if (id) selectStep(id); };
  const focusRole = (id: string) => {
    const select = roleSelects.current[id];
    if (!select || select.disabled) return;
    select.focus();
    select.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const firstMovable = procedureOrderStart(workflow);
  const task = workspace.tasks.find(item => item.id === taskId);
  const flowContext = context ?? (task ? taskProcedureContext(workspace, task) : undefined);
  return <section className="pe-editor" aria-label="현재 적용된 업무 절차">
    {workflow.length > 0 && <section className="pe-diagram" aria-label="전체 업무 절차도"><ProcedureFlow workflow={workflow} participants={participants} context={flowContext} selectedId={selectedId} onSelect={selectStep} redrawKey={redrawKey} compact/><p className="pe-diagram-status">{diagramChanged ? '수정 중인 절차도 · 저장·반영하면 적용됩니다.' : '저장된 절차도'}<span>절차를 선택하면 아래 내용으로 이동합니다.</span></p></section>}
    <div className="pw-section-intro"><div><h3>업무 절차 <span>{workflow.length}개</span></h3><p>{editable ? '위·아래 버튼은 표시 순서를 바꿉니다. 실제 수행 순서는 각 절차의 선행 절차로 정하세요.' : '절차별 담당자, 수행 방법과 참고 파일을 확인하세요.'}</p></div>{editable && <Button variant="secondary" disabled={workflow.length >= 50} onClick={add}><Plus size={15}/>수기로 절차 추가</Button>}</div>
    {editable && <div className="pe-apply-bar"><p>누가 · 무엇을 · 어떻게<br/><span>{hasChanges ? '수정한 내용과 순서를 저장하면 절차도에도 함께 반영됩니다.' : '저장된 절차입니다. 내용을 수정하면 저장할 수 있습니다.'}</span></p><Button variant="accent" disabled={busy || !workflow.length || !hasChanges} onClick={() => void onApply()}><Save size={16}/>{busy ? '저장 중…' : '수정사항 저장·절차도 반영'}</Button></div>}
    {editable && firstMovable > 0 && <p className="pe-locked-order">완료된 절차까지의 순서는 유지됩니다. 이후 절차를 추가하거나 이동할 수 있습니다.</p>}
    {!workflow.length && <div className="pw-inline-empty"><p>첫 절차를 추가해 보세요.</p><span>예: 담당자가 자료를 모으고, 검토자가 결과를 확인합니다.</span></div>}
    <div className="pe-steps">{workflow.map((step, index) => {
      const done = originalWorkflow.find(item => item.id === step.id)?.done ?? false;
      const requiredCommon = requiredStepTitles.includes(step.title);
      const lastReviewer = reviewRequired && step.role === 'reviewer' && workflow.filter(item => item.role === 'reviewer').length === 1;
      const locked = !editable || done;
      const name = step.title || `${index + 1}번 절차`;
      const missingSupport = step.role === 'support' && !hasSupport;
      const missingReviewer = step.role === 'reviewer' && !hasReviewer;
      const participantWarningId = `${warningId}-${step.id}`;
      return <section className={`pe-step ${done ? 'is-done' : ''}${selectedId === step.id ? ' is-selected' : ''}`} key={step.id} ref={element => { stepSections.current[step.id] = element; }} tabIndex={-1} aria-label={`${index + 1}단계 ${step.title || '새 절차'}`}>
        <header className="pe-step-heading"><span className="pe-step-number">{String(index + 1).padStart(2, '0')}</span><h4>{step.title || '새 절차'}</h4>{requiredCommon && <Badge tone="outline">공통 필수</Badge>}{done && <Badge tone="success">완료</Badge>}{(missingSupport || missingReviewer) && <Badge tone="warning">{missingSupport ? '지원자 미지정' : '검토자 미지정'}</Badge>}
          {editable && <div className="pe-step-controls"><div className="pe-move-buttons" role="group" aria-label={`${name} 순서 조정`}><Button variant="secondary" disabled={done || !canMoveProcedureStep(workflow, step.id, 'up')} aria-label={`${name} 위로 이동`} title="위로 이동" onClick={() => onMove(step.id, 'up')}><ArrowUp size={15}/><span>위로</span></Button><Button variant="secondary" disabled={done || !canMoveProcedureStep(workflow, step.id, 'down')} aria-label={`${name} 아래로 이동`} title="아래로 이동" onClick={() => onMove(step.id, 'down')}><ArrowDown size={15}/><span>아래로</span></Button></div>{!done && !requiredCommon && !lastReviewer && canRemoveProcedureStep(workflow, step.id) && <button type="button" className="pw-icon-button pe-delete" aria-label={`${name} 절차 삭제`} title="절차 삭제" onClick={() => onRemove(step.id)}><Trash2 size={15}/></button>}</div>}
        </header>
        {editable && !done && lastReviewer && <p className="pe-review-policy">{requiredCommon ? '공통업무에서 정한 필수 검토 단계이므로 삭제할 수 없습니다.' : '검토가 필요한 업무의 마지막 검토 단계입니다. 삭제하려면 업무 설정에서 검토 필요 여부를 변경해 주세요.'}</p>}
        {(missingSupport || missingReviewer) && <div className="pe-participant-warning" id={participantWarningId} role="status">
          <p>{missingSupport
            ? done ? '완료된 절차의 담당 역할은 기록으로 보존합니다. 이후 미완료 절차의 담당 역할을 확인해 주세요.'
              : requiredCommon ? '공통 필수 절차의 담당 역할은 이 화면에서 바꿀 수 없습니다. 공통업무 담당자에게 절차 기준 확인을 요청해 주세요.'
                : editable ? '지원자가 지정되지 않았습니다. 아래 ‘누가’에서 담당자 역할로 바꾼 뒤 수정사항을 저장해 주세요.'
                  : onStartEditing ? '지원자가 지정되지 않았습니다. 업무 기준 수정에서 ‘누가’를 담당자 역할로 바꿔 주세요.'
                    : '지원자가 지정되지 않았습니다. 업무 담당자에게 담당 역할 수정을 요청해 주세요. 업무분장이 확정된 경우에는 부서장의 재작성 허용이 필요합니다.'
            : workspace.currentUser.role === 'admin'
              ? '검토자는 소유 부서의 활성 부서장으로 자동 지정됩니다. 조직 · 구성원에서 업무 담당자와 다른 부서장을 등록하거나 확인해 주세요.'
              : '검토자는 소유 부서의 활성 부서장으로 자동 지정됩니다. 관리자에게 소유 부서의 부서장 등록·확인을 요청해 주세요.'}</p>
          {missingSupport && !done && !requiredCommon && (editable
            ? <Button variant="secondary" aria-label={`${name} 담당자 지정`} onClick={() => focusRole(step.id)}>담당자 지정</Button>
            : onStartEditing && <Button variant="secondary" onClick={onStartEditing}>업무 기준 수정</Button>)}
          {missingReviewer && workspace.currentUser.role === 'admin' && onOpenOrganization && <Button variant="secondary" onClick={onOpenOrganization}>조직 · 구성원 확인</Button>}
        </div>}
        {editable && !done ? <div className="pe-essential-fields">
          <Field label="누가"><select ref={element => { roleSelects.current[step.id] = element; }} aria-describedby={missingSupport || missingReviewer ? participantWarningId : undefined} disabled={locked || requiredCommon || lastReviewer} value={step.role} onChange={event => onChange(step.id, { role: event.target.value as WorkflowStep['role'] })}>{Object.entries(roles).map(([key, label]) => <option value={key} key={key} disabled={key === 'support' && !hasSupport}>{participants[key as WorkflowStep['role']]} · {label}</option>)}</select></Field>
          <Field label="무엇을"><input ref={element => { titleInputs.current[step.id] = element; }} value={step.title} disabled={locked || requiredCommon} maxLength={150} placeholder="예: 월별 자료 취합" onChange={event => onChange(step.id, { title: event.target.value })}/></Field>
          <Field label="어떻게" span><textarea rows={3} maxLength={5000} disabled={locked} value={step.description} placeholder="예: 부서별 자료를 받아 누락과 중복을 확인한 뒤 취합표를 작성합니다." onChange={event => onChange(step.id, { description: event.target.value })}/></Field>
        </div> : <dl className="pe-essential-readonly"><div><dt>누가</dt><dd>{participants[step.role]}<small>{roles[step.role]}</small></dd></div><div><dt>무엇을</dt><dd>{step.title}</dd></div><div><dt>어떻게</dt><dd>{step.description || '등록된 수행 방법이 없습니다.'}</dd></div></dl>}
        {editable && !done ? <fieldset className="pe-dependencies" disabled={locked || busy || requiredCommon}>
          <legend>{name} · 선행 절차</legend>
          <p>선택한 절차를 마친 뒤 시작합니다. 선택하지 않으면 다른 절차와 병행할 수 있습니다.</p>
          <div>{workflow.filter(prerequisite => prerequisite.id !== step.id).map(prerequisite => {
            const checked = step.dependsOn.includes(prerequisite.id);
            const allowed = checked || canSetProcedureDependency(workflow, step.id, prerequisite.id);
            return <label key={prerequisite.id}><input type="checkbox" aria-label={`${name} 선행: ${prerequisite.title || '새 절차'}`} checked={checked} disabled={!allowed} onChange={event => onChange(step.id, { dependsOn: event.target.checked ? [...step.dependsOn, prerequisite.id] : step.dependsOn.filter(id => id !== prerequisite.id) })}/><span>{prerequisite.title || '새 절차'}{!allowed && <small>이 절차 이후에 수행하는 단계입니다.</small>}</span></label>;
          })}</div>
          {!workflow.some(prerequisite => prerequisite.id !== step.id) && <small>다른 절차를 추가하면 선행 절차를 선택할 수 있습니다.</small>}
        </fieldset> : <p className="pe-dependencies-readonly">선행 절차: {step.dependsOn.length ? step.dependsOn.map(id => workflow.find(item => item.id === id)?.title || '기존 절차').join(', ') : '없음 · 병행 가능'}</p>}
        <TaskFileAttachments workspace={workspace} taskId={taskId} attachmentIds={step.attachmentIds ?? []} onChange={editable && !done ? ids => onChange(step.id, { attachmentIds: ids }) : undefined} command={command} onWorkspace={onWorkspace} onBusyChange={onBusyChange} disabled={locked} label="절차 참고 파일"/>
      </section>;
    })}</div>
    {editable && workflow.length > 1 && <Button className="pe-add-step" variant="secondary" disabled={workflow.length >= 50} onClick={add}><Plus size={15}/>수기로 절차 추가</Button>}
  </section>;
}

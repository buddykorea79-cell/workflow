'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GitBranch, Plus, Save, Trash2 } from 'lucide-react';
import type { WorkflowStep, Workspace } from '@/lib/types';
import type { ProcedureParticipants } from '@/lib/procedure-participants';
import { canMoveProcedureStep, procedureOrderStart } from '@/lib/procedure-order';
import { Button, Badge, Field, type CommandFn } from './ui';
import { ProcedureFlow } from './procedure-builder';
import { TaskFileAttachments } from './task-file-attachments';
import './procedure-editor.css';

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
  requiredStepTitles?: string[];
  editable: boolean;
  busy: boolean;
  diagramChanged: boolean;
  redrawKey: number;
  onApply: () => Promise<boolean>;
  onChange: (id: string, patch: Partial<WorkflowStep>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  onAdd: () => string | undefined;
}

export function ProcedureEditor({ workspace, taskId, command, onWorkspace, onBusyChange, workflow, originalWorkflow, participants, requiredStepTitles = [], editable, busy, diagramChanged, redrawKey, onApply, onChange, onRemove, onMove, onAdd }: Props) {
  const [diagramOpen, setDiagramOpen] = useState(redrawKey > 0);
  const [focusStep, setFocusStep] = useState('');
  const titleInputs = useRef<Record<string, HTMLInputElement | null>>({});
  useEffect(() => { if (redrawKey > 0) setDiagramOpen(true); }, [redrawKey]);
  useEffect(() => {
    if (!focusStep || !titleInputs.current[focusStep]) return;
    titleInputs.current[focusStep]?.focus();
    titleInputs.current[focusStep]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFocusStep('');
  }, [focusStep, workflow]);
  const add = () => { const id = onAdd(); if (id) setFocusStep(id); };
  const firstMovable = procedureOrderStart(workflow);
  return <section className="pe-editor" aria-label="현재 적용된 업무 절차">
    <div className="pw-section-intro"><div><h3>업무 절차 <span>{workflow.length}개</span></h3><p>{editable ? '절차를 직접 추가하고 위·아래 버튼으로 순서를 바꿔 보세요.' : '절차별 담당자, 수행 방법과 참고 파일을 확인하세요.'}</p></div>{editable && <Button variant="accent" disabled={busy || workflow.length >= 50} onClick={add}><Plus size={15}/>수기로 절차 추가</Button>}</div>
    {editable && <div className="pe-apply-bar"><p>누가 · 무엇을 · 어떻게<br/><span>수정한 내용과 순서를 저장하면 절차도에도 함께 반영됩니다.</span></p><Button variant="accent" disabled={busy || !workflow.length} onClick={() => void onApply()}><Save size={16}/>{busy ? '저장 중…' : '수정사항 저장·절차도 반영'}</Button></div>}
    {workflow.length > 0 && <details className="pe-disclosure pe-diagram" open={diagramOpen} onToggle={event => setDiagramOpen(event.currentTarget.open)}><summary><GitBranch size={16}/><span>전체 절차도 보기</span><small>{workflow.length}개 절차</small></summary>{diagramOpen && <div className="pe-diagram-body"><p className="pe-diagram-status">{diagramChanged ? '수정 중인 절차도 미리보기입니다. 저장·반영 버튼을 눌러 적용하세요.' : '저장된 절차의 순서와 담당자를 보여줍니다.'}</p><ProcedureFlow workflow={workflow} participants={participants} redrawKey={redrawKey}/></div>}</details>}
    {editable && firstMovable > 0 && <p className="pe-locked-order">완료된 절차까지의 순서는 유지됩니다. 이후 절차를 추가하거나 이동할 수 있습니다.</p>}
    {!workflow.length && <div className="pw-inline-empty"><p>첫 절차를 추가해 보세요.</p><span>예: 담당자가 자료를 모으고, 검토자가 결과를 확인합니다.</span></div>}
    <div className="pe-steps">{workflow.map((step, index) => {
      const done = originalWorkflow.find(item => item.id === step.id)?.done ?? false;
      const requiredCommon = requiredStepTitles.includes(step.title);
      const lastReviewer = step.role === 'reviewer' && workflow.filter(item => item.role === 'reviewer').length === 1;
      const locked = !editable || busy || done;
      const name = step.title || `${index + 1}번 절차`;
      return <section className={`pe-step ${done ? 'is-done' : ''}`} key={step.id} aria-label={`${index + 1}단계 ${step.title || '새 절차'}`}>
        <header className="pe-step-heading"><span className="pe-step-number">{String(index + 1).padStart(2, '0')}</span><h4>{step.title || '새 절차'}</h4>{requiredCommon && <Badge tone="outline">공통 필수</Badge>}{done && <Badge tone="success">완료</Badge>}
          {editable && <div className="pe-step-controls"><div className="pe-move-buttons" role="group" aria-label={`${name} 순서 조정`}><Button variant="accent" disabled={busy || !canMoveProcedureStep(workflow, step.id, 'up')} aria-label={`${name} 위로 이동`} title="위로 이동" onClick={() => onMove(step.id, 'up')}><ArrowUp size={15}/><span>위로</span></Button><Button variant="accent" disabled={busy || !canMoveProcedureStep(workflow, step.id, 'down')} aria-label={`${name} 아래로 이동`} title="아래로 이동" onClick={() => onMove(step.id, 'down')}><ArrowDown size={15}/><span>아래로</span></Button></div>{!requiredCommon && !lastReviewer && index >= firstMovable && <button type="button" disabled={busy} className="pw-icon-button pe-delete" aria-label={`${name} 절차 삭제`} title="절차 삭제" onClick={() => onRemove(step.id)}><Trash2 size={15}/></button>}</div>}
        </header>
        {editable && !done ? <div className="pe-essential-fields">
          <Field label="누가"><select disabled={locked || requiredCommon || lastReviewer} value={step.role} onChange={event => onChange(step.id, { role: event.target.value as WorkflowStep['role'] })}>{Object.entries(roles).map(([key, label]) => <option value={key} key={key}>{participants[key as WorkflowStep['role']]} · {label}</option>)}</select></Field>
          <Field label="무엇을"><input ref={element => { titleInputs.current[step.id] = element; }} value={step.title} disabled={locked || requiredCommon} maxLength={150} placeholder="예: 월별 자료 취합" onChange={event => onChange(step.id, { title: event.target.value })}/></Field>
          <Field label="어떻게" span><textarea rows={3} maxLength={5000} disabled={locked} value={step.description} placeholder="예: 부서별 자료를 받아 누락과 중복을 확인한 뒤 취합표를 작성합니다." onChange={event => onChange(step.id, { description: event.target.value })}/></Field>
        </div> : <dl className="pe-essential-readonly"><div><dt>누가</dt><dd>{participants[step.role]}<small>{roles[step.role]}</small></dd></div><div><dt>무엇을</dt><dd>{step.title}</dd></div><div><dt>어떻게</dt><dd>{step.description || '등록된 수행 방법이 없습니다.'}</dd></div></dl>}
        <TaskFileAttachments workspace={workspace} taskId={taskId} attachmentIds={step.attachmentIds ?? []} onChange={editable && !done ? ids => onChange(step.id, { attachmentIds: ids }) : undefined} command={command} onWorkspace={onWorkspace} onBusyChange={onBusyChange} disabled={locked} label="절차 참고 파일"/>
      </section>;
    })}</div>
    {editable && workflow.length > 1 && <Button className="pe-add-step" variant="accent" disabled={busy || workflow.length >= 50} onClick={add}><Plus size={15}/>수기로 절차 추가</Button>}
  </section>;
}

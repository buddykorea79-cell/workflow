'use client';

import { useState } from 'react';
import { GitBranch, Link2, Plus, RotateCcw, Settings2, Trash2 } from 'lucide-react';
import type { WorkflowStep, Workspace } from '@/lib/types';
import type { ProcedureParticipants } from '@/lib/procedure-participants';
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
  onRedraw: () => void;
  onChange: (id: string, patch: Partial<WorkflowStep>) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}

export function ProcedureEditor({ workspace, taskId, command, onWorkspace, onBusyChange, workflow, originalWorkflow, participants, requiredStepTitles = [], editable, busy, diagramChanged, redrawKey, onRedraw, onChange, onRemove, onAdd }: Props) {
  const [diagramOpen, setDiagramOpen] = useState(false);
  return <section className="pe-editor" aria-label="현재 적용된 업무 절차">
    <div className="pw-section-intro"><div><h3>업무 절차 <span>{workflow.length}개</span></h3><p>{editable ? '누가, 무엇을, 어떻게 할지 적고 필요한 파일을 첨부하세요.' : '절차별 담당자, 수행 방법과 참고 파일을 확인하세요.'}</p></div>{editable && <Button variant="secondary" disabled={busy || workflow.length >= 50} onClick={onAdd}><Plus size={15}/>절차 추가</Button>}</div>
    {workflow.length > 0 && <details className="pe-disclosure pe-diagram" onToggle={event => setDiagramOpen(event.currentTarget.open)}><summary><GitBranch size={16}/><span>전체 절차도 보기</span><small>{workflow.length}개 절차</small></summary>{diagramOpen && <div className="pe-diagram-body"><div className="pe-diagram-actions"><p>{diagramChanged ? '수정한 절차가 반영된 흐름입니다. 저장하면 적용됩니다.' : '절차 간 연결과 진행 순서를 확인할 수 있습니다.'}</p><Button variant="ghost" disabled={busy} onClick={onRedraw}><RotateCcw size={14}/>배치 정리</Button></div><ProcedureFlow workflow={workflow} participants={participants} redrawKey={redrawKey}/></div>}</details>}
    {!workflow.length && <div className="pw-inline-empty"><p>첫 절차를 추가해 보세요.</p><span>예: 담당자가 자료를 모으고, 검토자가 결과를 확인합니다.</span></div>}
    <div className="pe-steps">{workflow.map((step, index) => {
      const done = originalWorkflow.find(item => item.id === step.id)?.done ?? false;
      const requiredCommon = requiredStepTitles.includes(step.title);
      const lastReviewer = step.role === 'reviewer' && workflow.filter(item => item.role === 'reviewer').length === 1;
      const locked = !editable || busy || done;
      const predecessors = step.dependsOn.map(id => workflow.find(item => item.id === id)?.title).filter(Boolean);
      return <section className={`pe-step ${done ? 'is-done' : ''}`} key={step.id} aria-label={`${index + 1}단계 ${step.title || '새 절차'}`}>
        <header className="pe-step-heading"><span className="pe-step-number">{String(index + 1).padStart(2, '0')}</span><h4>{step.title || '새 절차'}</h4>{requiredCommon && <Badge tone="outline">공통 필수</Badge>}{done && <Badge tone="success">완료</Badge>}{editable && !requiredCommon && !lastReviewer && !done && <button type="button" disabled={busy} className="pw-icon-button" aria-label={`${step.title || index + 1 + '번'} 절차 삭제`} onClick={() => onRemove(step.id)}><Trash2 size={15}/></button>}</header>
        {editable && !done ? <div className="pe-essential-fields">
          <Field label="누가"><select disabled={locked || requiredCommon || lastReviewer} value={step.role} onChange={event => onChange(step.id, { role: event.target.value as WorkflowStep['role'] })}>{Object.entries(roles).map(([key, label]) => <option value={key} key={key}>{participants[key as WorkflowStep['role']]} · {label}</option>)}</select></Field>
          <Field label="무엇을"><input value={step.title} disabled={locked || requiredCommon} maxLength={150} placeholder="예: 월별 자료 취합" onChange={event => onChange(step.id, { title: event.target.value })}/></Field>
          <Field label="어떻게" span><textarea rows={3} maxLength={5000} disabled={locked} value={step.description} placeholder="예: 부서별 자료를 받아 누락과 중복을 확인한 뒤 취합표를 작성합니다." onChange={event => onChange(step.id, { description: event.target.value })}/></Field>
        </div> : <dl className="pe-essential-readonly"><div><dt>누가</dt><dd>{participants[step.role]}<small>{roles[step.role]}</small></dd></div><div><dt>무엇을</dt><dd>{step.title}</dd></div><div><dt>어떻게</dt><dd>{step.description || '등록된 수행 방법이 없습니다.'}</dd></div></dl>}
        <TaskFileAttachments workspace={workspace} taskId={taskId} attachmentIds={step.attachmentIds ?? []} onChange={editable && !done ? ids => onChange(step.id, { attachmentIds: ids }) : undefined} command={command} onWorkspace={onWorkspace} onBusyChange={onBusyChange} disabled={locked} label="절차 참고 파일"/>
        <details className="pe-disclosure pe-options"><summary><Settings2 size={15}/><span>추가 설정</span><small>순서 · 결과물 · 확인 항목</small></summary><div className="pe-options-body">
          <p className="pe-order-hint"><Link2 size={14}/>{predecessors.length ? `${predecessors.join(', ')} 완료 후 진행` : '먼저 시작할 수 있는 절차'}</p>
          {editable && !done && <fieldset className="pw-step-predecessors" disabled={busy}><legend>먼저 완료할 절차</legend>{workflow.filter(item => item.id !== step.id).map(item => <label key={item.id}><input type="checkbox" checked={step.dependsOn.includes(item.id)} onChange={event => onChange(step.id, { dependsOn: event.target.checked ? [...step.dependsOn, item.id] : step.dependsOn.filter(id => id !== item.id) })}/><span>{item.title || '이름 없는 절차'}</span></label>)}<small>선택한 절차가 모두 끝나면 진행합니다. 선택하지 않으면 바로 시작할 수 있습니다.</small></fieldset>}
          {editable && !done ? <><Field label="결과물 · 선택"><input disabled={locked} maxLength={1000} value={step.output} onChange={event => onChange(step.id, { output: event.target.value })} placeholder="예: 취합표, 검토 보고서"/></Field><Field label="완료 전 확인할 항목 · 선택"><textarea rows={2} disabled={locked} maxLength={20000} value={step.checklist.join('\n')} onChange={event => onChange(step.id, { checklist: event.target.value.split('\n') })} placeholder="한 줄에 하나씩 입력하세요."/></Field><label className="pw-step-required"><input type="checkbox" disabled={locked || requiredCommon || lastReviewer} checked={step.required} onChange={event => onChange(step.id, { required: event.target.checked })}/>필수 절차</label></> : <dl className="pe-extra-readonly"><div><dt>결과물</dt><dd>{step.output || '미등록'}</dd></div><div><dt>확인 항목</dt><dd>{step.checklist.length ? <ul>{step.checklist.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul> : '미등록'}</dd></div><div><dt>완료 조건</dt><dd>{step.required ? '필수 절차' : '선택 절차'}</dd></div></dl>}
        </div></details>
      </section>;
    })}</div>
    {editable && workflow.length > 1 && <Button className="pe-add-step" variant="secondary" disabled={busy || workflow.length >= 50} onClick={onAdd}><Plus size={15}/>절차 추가</Button>}
  </section>;
}

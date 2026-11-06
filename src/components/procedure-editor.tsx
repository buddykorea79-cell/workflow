'use client';

import { Link2, Plus, RotateCcw, Trash2, UserRound } from 'lucide-react';
import type { WorkflowStep } from '@/lib/types';
import type { ProcedureParticipants } from '@/lib/procedure-participants';
import { Button, Badge, Field } from './ui';
import { ProcedureFlow } from './procedure-builder';

const roles: Record<WorkflowStep['role'], string> = { primary: '담당자 수행', support: '협업·지원', reviewer: '검토·승인' };

interface Props {
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

export function ProcedureEditor({ workflow, originalWorkflow, participants, requiredStepTitles = [], editable, busy, diagramChanged, redrawKey, onRedraw, onChange, onRemove, onAdd }: Props) {
  return <section className="pw-current-procedure" aria-label="현재 적용된 업무 절차">
    <div className="pw-section-intro"><div><h3>현재 적용된 절차 · {workflow.length}단계</h3><p>{editable ? '아래에서 절차를 수정하고 다시 그린 뒤 변경사항을 저장하세요.' : '단계별 수행 주체와 선행 관계를 확인하세요.'}</p></div><div className="pw-procedure-actions">
      <Button variant="secondary" disabled={busy} onClick={onRedraw}><RotateCcw size={16}/>절차도 다시 그리기</Button>
      {editable && <Button variant="secondary" disabled={busy || workflow.length >= 50} onClick={onAdd}><Plus size={15}/>절차 추가</Button>}
    </div></div>
    {editable && diagramChanged && <p className="pw-procedure-redraw-note" role="status">절차가 변경되었습니다. 다시 그리기를 누르면 연결을 검사하고 화면에 맞게 배치합니다.</p>}
    <ProcedureFlow workflow={workflow} participants={participants} redrawKey={redrawKey}/>
    <div className="pw-workflow-list">{workflow.map((step, index) => {
      const done = originalWorkflow.find(item => item.id === step.id)?.done ?? false;
      const requiredCommon = requiredStepTitles.includes(step.title);
      const lastReviewer = step.role === 'reviewer' && workflow.filter(item => item.role === 'reviewer').length === 1;
      const locked = !editable || busy || done;
      return <section className={`pw-step ${done ? 'is-done' : ''}`} key={step.id} aria-label={`${index + 1}단계 ${step.title || '새 절차'}`}>
        <div className="pw-step-heading"><span className="pw-step-number">{String(index + 1).padStart(2, '0')}</span><div><span>{roles[step.role]}</span>{requiredCommon && <Badge tone="outline">공통 필수</Badge>}{done && <Badge tone="success">완료 기록 보존</Badge>}</div>{editable && !requiredCommon && !lastReviewer && !done && <button type="button" disabled={busy} className="pw-icon-button" aria-label={`${step.title || index + 1 + '번'} 절차 삭제`} onClick={() => onRemove(step.id)}><Trash2 size={16}/></button>}</div>
        <p className="pw-step-participant"><UserRound size={15}/><span>수행 주체 <strong>{participants[step.role]}</strong></span></p>
        <div className="form-grid">
          <Field label="절차 이름" span><input value={step.title} disabled={locked || requiredCommon} maxLength={150} placeholder="예: 자료 취합 및 검증" onChange={event => onChange(step.id, { title: event.target.value })}/></Field>
          <Field label="수행 내용과 근거" span><textarea rows={3} maxLength={5000} disabled={locked} value={step.description} onChange={event => onChange(step.id, { description: event.target.value })}/></Field>
          <Field label="담당 역할"><select disabled={locked || requiredCommon || lastReviewer} value={step.role} onChange={event => onChange(step.id, { role: event.target.value as WorkflowStep['role'] })}>{Object.entries(roles).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></Field>
          <Field label="결과물"><input disabled={locked} maxLength={1000} value={step.output} onChange={event => onChange(step.id, { output: event.target.value })} placeholder="예: 검토 보고서"/></Field>
          <Field label="확인 항목 · 한 줄에 하나" span><textarea rows={3} disabled={locked} maxLength={20000} value={step.checklist.join('\n')} onChange={event => onChange(step.id, { checklist: event.target.value.split('\n') })}/></Field>
        </div>
        {editable && !done ? <fieldset className="pw-step-predecessors" disabled={busy}><legend><Link2 size={14}/>선행 절차 · 여러 단계 선택 가능</legend>{workflow.filter(item => item.id !== step.id).map(item => <label key={item.id}><input type="checkbox" checked={step.dependsOn.includes(item.id)} onChange={event => onChange(step.id, { dependsOn: event.target.checked ? [...step.dependsOn, item.id] : step.dependsOn.filter(id => id !== item.id) })}/><span>{item.title || '이름을 입력하지 않은 절차'}</span></label>)}<small>선택한 단계가 모두 끝난 뒤 수행합니다. 선택하지 않으면 시작 단계가 됩니다.</small></fieldset>
          : <p className="pw-step-dependency"><Link2 size={13}/>{step.dependsOn.length ? step.dependsOn.map(id => workflow.find(item => item.id === id)?.title).filter(Boolean).join(', ') + ' 완료 후 수행' : '시작 절차'}</p>}
        <label className="pw-step-required"><input type="checkbox" disabled={locked || requiredCommon || lastReviewer} checked={step.required} onChange={event => onChange(step.id, { required: event.target.checked })}/>필수 절차</label>
      </section>;
    })}</div>
  </section>;
}

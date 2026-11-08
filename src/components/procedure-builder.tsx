'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, MarkerType, Position, ReactFlow, type Edge, type Node } from '@xyflow/react';
import { ArrowDown, ArrowUp, ArrowRight, Check, FileText, GitBranch, LoaderCircle, Maximize2, Minimize2, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { Attachment, Task, TaskReference, WorkflowStep } from '@/lib/types';
import { replaceProcedureDraft, generateProcedureDraft, procedureErrors, PROCEDURE_PDF_LIMIT, PROCEDURE_TEXT_LIMIT, type ProcedureDraft, type ProcedurePage } from '@/lib/procedure-draft';
import { appendProcedureStep, canMoveProcedureStep, canRemoveProcedureStep, moveProcedureStep, removeProcedureStep } from '@/lib/procedure-order';
import { AI_REFERENCE_LIMIT, AI_REFERENCE_TEXT_LIMIT, procedureOverviewFingerprint, procedureReferenceFingerprint } from '@/lib/procedure-ai-input';
import { useUnsavedChanges } from './unsaved-changes';
import { sameDraft } from '@/lib/pending-draft';
import '@xyflow/react/dist/style.css';
import './procedure-builder.css';

const roles: WorkflowStep['role'][] = ['primary', 'support', 'reviewer'];
const roleLabels = { primary: '담당자', support: '협업·지원', reviewer: '검토자' };
const participantFallbacks = { primary: '담당자 미지정', support: '지원자 미지정', reviewer: '검토자 미지정' };
export type ProcedureParticipants = Partial<Record<WorkflowStep['role'], string>>;
const prefix = () => `procedure-${crypto.randomUUID().slice(0, 12)}`;

export function ProcedureFlow({ workflow, participants, selectedId, onSelect, redrawKey = 0 }: { workflow: WorkflowStep[]; participants?: ProcedureParticipants; selectedId?: string; onSelect?: (id: string) => void; redrawKey?: number }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setExpanded(false); } };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [expanded]);
  const { nodes, edges } = useMemo(() => {
    const laneRoles = roles.filter(role => role !== 'support' || workflow.some(step => step.role === 'support'));
    const levels = new Map<string, number>();
    const depth = (id: string, trail = new Set<string>()): number => {
      if (levels.has(id)) return levels.get(id)!;
      if (trail.has(id)) return 0;
      const next = new Set(trail).add(id); const step = workflow.find(item => item.id === id);
      const value = step?.dependsOn.length ? 1 + Math.max(...step.dependsOn.map(dep => depth(dep, next))) : 0;
      levels.set(id, Math.min(value, 50)); return levels.get(id)!;
    };
    workflow.forEach(step => depth(step.id));
    const width = Math.max(900, (Math.max(0, ...levels.values()) + 1) * 260 + 210);
    const rowSpacing = 136;
    const counts = new Map<string, number>(); const positions = new Map<string, { x: number; y: number }>();
    const laneHeights = laneRoles.map(role => {
      const occurrences = new Map<number, number>();
      for (const step of workflow.filter(item => item.role === role)) { const level = levels.get(step.id) || 0; occurrences.set(level, (occurrences.get(level) || 0) + 1); }
      return Math.max(1, ...occurrences.values()) * rowSpacing + 65;
    });
    const laneTops = laneHeights.map((_, index) => laneHeights.slice(0, index).reduce((sum, height) => sum + height + 12, 0));
    for (const step of workflow) {
      const lane = laneRoles.indexOf(step.role); const level = levels.get(step.id) || 0; const key = `${lane}-${level}`; const row = counts.get(key) || 0; counts.set(key, row + 1);
      positions.set(step.id, { x: 185 + level * 260, y: laneTops[lane] + 48 + row * rowSpacing });
    }
    const participant = (role: WorkflowStep['role']) => participants?.[role]?.trim() || participantFallbacks[role];
    const nodes: Node[] = laneRoles.map((role, index) => ({ id: `lane-${role}`, position: { x: 0, y: laneTops[index] }, data: { label: <div className="procedure-lane-label"><strong>{roleLabels[role]}</strong><span>{participant(role)}</span></div> }, style: { width, height: laneHeights[index] }, className: `procedure-lane procedure-lane-${role}`, selectable: false, draggable: false, focusable: false, zIndex: -1 }));
    nodes.push(...workflow.map((step, index): Node => ({ id: step.id, position: positions.get(step.id)!, sourcePosition: Position.Right, targetPosition: Position.Left, data: { label: <div className="procedure-node-content"><span>{String(index + 1).padStart(2, '0')} · {roleLabels[step.role]}{step.done && <Check size={12}/>}</span><strong>{step.title}</strong><small className="procedure-node-participant" title={participant(step.role)}>{participant(step.role)}</small></div> }, style: { width: 225 }, className: `procedure-node${step.done ? ' is-complete' : ''}`, selected: step.id === selectedId, ariaLabel: `${index + 1}. ${step.title}, ${roleLabels[step.role]}, ${participant(step.role)}`, draggable: false })));
    const ids = new Set(workflow.map(step => step.id));
    const edges: Edge[] = workflow.flatMap(step => step.dependsOn.filter(id => ids.has(id)).map(id => ({ id: `${id}-${step.id}`, source: id, target: step.id, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, color: '#5483cc' }, style: { stroke: '#5483cc', strokeWidth: 1.6 } })));
    return { nodes, edges };
  }, [workflow, selectedId, participants]);
  if (!workflow.length) return <div className="procedure-flow-empty">절차를 등록하면 담당 역할별 흐름도가 표시됩니다.</div>;
  return <div className={`procedure-flow-section${expanded ? ' is-expanded' : ''}`}>
    <div className="procedure-flow-legend"><span><GitBranch size={15}/>역할별 업무 흐름</span><button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? <Minimize2 size={15}/> : <Maximize2 size={15}/>} {expanded ? '작게 보기' : '크게 보기'}</button></div>
    <p className="procedure-flow-help">화면을 끌어 이동하거나 +/−로 확대하세요. 연결된 선행 절차는 모두 완료해야 합니다.</p>
    <div className="procedure-flow" aria-label="담당자·지원·검토 역할별 절차 흐름도">
      <ReactFlow key={`${expanded}-${redrawKey}-${workflow.map(step => step.id + step.dependsOn.join(',')).join('|')}`} nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: 0.12, maxZoom: 1 }} minZoom={0.2} maxZoom={1.6} nodesDraggable={false} nodesConnectable={false} edgesFocusable={false} deleteKeyCode={null} onNodeClick={(_, node) => { if (!node.id.startsWith('lane-')) onSelect?.(node.id); }}>
        <Background color="#dce6f4" gap={22}/><Controls showInteractive={false}/>
      </ReactFlow>
    </div>
    <details className="procedure-accessible-list"><summary>절차 목록으로 보기</summary><ol>{workflow.map(step => <li key={step.id}><b>{step.title}</b><span>{roleLabels[step.role]} · {participants?.[step.role]?.trim() || participantFallbacks[step.role]} · {step.dependsOn.length ? `선행: ${step.dependsOn.map(id => workflow.find(item => item.id === id)?.title || id).join(', ')}` : '시작 절차'}</span></li>)}</ol></details>
  </div>;
}

export interface ProcedureBuilderProps {
  taskId: string;
  overview: Pick<Task, 'title' | 'description' | 'completionCriteria' | 'descriptionAttachmentIds'>;
  overviewAttachments: Pick<Attachment, 'id' | 'name'>[];
  workflow: WorkflowStep[];
  references?: TaskReference[];
  participants?: ProcedureParticipants;
  hasSupport?: boolean;
  requiredStepTitles?: string[];
  disabled?: boolean;
  onApply: (steps: WorkflowStep[], refs: TaskReference[], isCurrentDraft?: () => boolean) => Promise<boolean> | boolean;
  onClose?: () => void;
}

export function ProcedureBuilder({ taskId, overview, overviewAttachments, workflow, references = [], participants, hasSupport = false, requiredStepTitles = [], disabled = false, onApply, onClose }: ProcedureBuilderProps) {
  const [title, setTitle] = useState(''); const [url, setUrl] = useState('');
  const [type, setType] = useState<TaskReference['type']>('guideline'); const [text, setText] = useState('');
  const [pages, setPages] = useState<ProcedurePage[] | undefined>(); const [draft, setDraft] = useState<ProcedureDraft | null>(null);
  const [selectedId, setSelectedId] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [fileNotice, setFileNotice] = useState(''); const [reviewed, setReviewed] = useState(false);
  const [applying, setApplying] = useState(false); const [diagramChanged, setDiagramChanged] = useState(false); const [redrawKey, setRedrawKey] = useState(0);
  const [sourceMode, setSourceMode] = useState<'ai' | 'local'>('ai');
  const [referenceIds, setReferenceIds] = useState<string[]>(() => references.filter(reference => reference.content.trim() || reference.attachmentId).slice(0, AI_REFERENCE_LIMIT).map(reference => reference.id));
  const initialReferenceIds = useRef(JSON.stringify([...referenceIds].sort()));
  const [generatedBy, setGeneratedBy] = useState('');
  const [readAttachments, setReadAttachments] = useState(true);
  const sourceEdited = title !== '' || url !== '' || text !== '' || type !== 'guideline' || !!pages?.length || !readAttachments || JSON.stringify([...referenceIds].sort()) !== initialReferenceIds.current;
  useUnsavedChanges(!!draft || busy || applying || sourceEdited, '절차 초안');
  const selectedReferences = references.filter(reference => referenceIds.includes(reference.id));
  const referencesFingerprint = procedureReferenceFingerprint(selectedReferences);
  const overviewFingerprint = procedureOverviewFingerprint(overview);
  const sourceFingerprint = JSON.stringify([overviewFingerprint, referencesFingerprint, readAttachments, hasSupport]);
  const latestFingerprint = useRef(sourceFingerprint); latestFingerprint.current = sourceFingerprint;
  const controller = useRef<AbortController | null>(null);
  const selectedLength = overview.title.length + overview.description.length + overview.completionCriteria.length + selectedReferences.reduce((sum, reference) => sum + reference.content.length, 0);
  const hasSourceContent = Boolean(overview.description.trim() || overview.completionCriteria.trim() || overview.descriptionAttachmentIds?.length || selectedReferences.length);
  useEffect(() => { setReviewed(false); setGeneratedBy(''); }, [sourceFingerprint]);
  useEffect(() => () => controller.current?.abort(), []);
  const selected = draft?.steps.find(step => step.id === selectedId);
  const selectedRequired = !!selected && requiredStepTitles.includes(selected.title);
  const selectedLastReviewer = selected?.role === 'reviewer' && draft?.steps.filter(step => step.role === 'reviewer').length === 1;
  const requiredTitles = draft?.steps.filter(step => step.required).map(step => step.title.trim()) || [];
  const missingRequiredTitles = draft ? requiredStepTitles.filter(title => { const index = requiredTitles.indexOf(title); if (index < 0) return true; requiredTitles.splice(index, 1); return false; }) : [];
  const errors = draft ? [...procedureErrors(draft.steps), ...missingRequiredTitles.map(title => `공통 필수 단계 '${title}'을 같은 이름으로 추가해 주세요.`)] : [];
  const locked = disabled;
  const executing = disabled || busy || applying;
  const currentDraft = { title, url, type, text, pages, draft, sourceMode, referenceIds, readAttachments };
  const latestDraft = useRef(currentDraft); latestDraft.current = currentDraft;
  const [applyNotice, setApplyNotice] = useState('');

  function updateStep(id: string, patch: Partial<WorkflowStep>) {
    setDraft(current => current ? { ...current, steps: current.steps.map(step => step.id === id ? { ...step, ...patch } : step) } : current); setReviewed(false); setDiagramChanged(true); setError('');
  }
  function moveSelected(direction: 'up' | 'down') {
    if (!draft || !selected || locked) return;
    const result = moveProcedureStep(draft.steps, selected.id, direction);
    if (!result.changed) return;
    setDraft({ ...draft, steps: result.workflow }); setReviewed(false); setDiagramChanged(true); setRedrawKey(value => value + 1); setError('');
  }
  async function importPdf(file: File) {
    if (executing) return;
    const submitted = latestDraft.current;
    if (file.size > PROCEDURE_PDF_LIMIT) { setError('문서는 10MB 이하로 선택해 주세요.'); return; }
    setBusy(true); setError(''); setFileNotice('');
    try {
      const form = new FormData(); form.append('taskId', taskId); form.append('file', file);
      const response = await fetch('/api/procedure-extract', { method: 'POST', body: form });
      const result = await response.json() as { error?: string; pages?: ProcedurePage[]; text?: string; pageCount?: number; warnings?: string[] };
      if (!response.ok) throw new Error(result.error || '문서 본문을 읽지 못했습니다.');
      if (!sameDraft(latestDraft.current, submitted)) { setFileNotice('문서를 읽는 동안 수정한 자료와 초안을 유지했습니다. 추출 결과로 덮어쓰지 않았습니다.'); return; }
      setText(result.text || ''); setPages(result.pages); if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ''));
      setDraft(null); setReviewed(false); setFileNotice(`${file.name} · ${result.pageCount ? `${result.pageCount}쪽·섹션 · ` : ''}본문 추출 완료${result.warnings?.length ? ` · ${result.warnings.join(' ')}` : ''}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '본문을 추출하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  function generate() {
    if (executing) return;
    setError('');
    try { const next = generateProcedureDraft({ title, text, type, url, pages }, prefix(), { hasSupport }); setDraft(next); setSelectedId(next.steps[0]?.id || ''); setReviewed(false); setDiagramChanged(false); setRedrawKey(value => value + 1); setGeneratedBy('규칙 기반 초안'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '초안을 만들지 못했습니다.'); }
  }
  async function generateAi() {
    if (executing) return;
    const submitted = latestDraft.current;
    setBusy(true); setError(''); setReviewed(false); setGeneratedBy('');
    const fingerprint = sourceFingerprint; const requestController = new AbortController(); controller.current = requestController;
    try {
      const response = await fetch('/api/procedure-generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, overviewFingerprint, referenceIds: selectedReferences.map(reference => reference.id), referencesFingerprint, readAttachments }), signal: requestController.signal });
      const result = await response.json() as { error?: string; draft?: ProcedureDraft; model?: string };
      if (!response.ok || !result.draft) throw new Error(result.error || 'AI 절차를 생성하지 못했습니다.');
      if (latestFingerprint.current !== fingerprint || !sameDraft(latestDraft.current, submitted)) throw new Error('분석 중 업무 개요·붙임 파일 또는 관련 근거가 변경되었습니다. 저장한 뒤 다시 분석해 주세요.');
      const next = { ...result.draft, steps: result.draft.steps.map(step => ({ ...step, role: step.role === 'support' && !hasSupport ? 'primary' as const : step.role })) };
      setDraft(next); setSelectedId(next.steps[0]?.id || ''); setDiagramChanged(false); setRedrawKey(value => value + 1); setGeneratedBy(`BizRouter AI · ${result.model || '분석 완료'}`);
    } catch (cause) { if (!requestController.signal.aborted) setError(cause instanceof Error ? cause.message : 'AI 분석을 완료하지 못했습니다.'); }
    finally { if (!requestController.signal.aborted) setBusy(false); controller.current = null; }
  }
  async function apply() {
    if (!draft || executing || !reviewed) return;
    const submitted = latestDraft.current; const isCurrent = () => sameDraft(latestDraft.current, submitted);
    setApplying(true); setError(''); setApplyNotice('');
    try {
      if (errors.length) throw new Error(errors.join(' '));
      if (references.length + draft.references.length > 100) throw new Error('근거는 최대 100개까지 연결할 수 있습니다. 기존 근거를 먼저 정리해 주세요.');
      const next = replaceProcedureDraft(draft.steps);
      if (await onApply(next, draft.references, isCurrent) !== true) throw new Error('절차를 저장하지 못했습니다. 검토한 초안은 유지되므로 다시 적용해 주세요.');
      if (isCurrent()) { setDraft(null); setReviewed(false); setGeneratedBy(''); setDiagramChanged(false); onClose?.(); }
      else { setReviewed(false); setApplyNotice('요청한 절차는 저장했습니다. 저장 중 추가로 수정한 초안은 유지했으니 다시 검토하고 적용해 주세요.'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '절차를 적용하지 못했습니다.'); }
    finally { setApplying(false); }
  }
  return <section className="procedure-builder" aria-label="업무 개요와 붙임 파일로 AI 절차·절차도 만들기">
    <header className="procedure-builder-heading"><div><p>업무 개요와 붙임 파일에서 시작하는 절차</p><h3>업무를 분석하고, 근거로 보완하세요.</h3></div>{onClose && <button className="procedure-close" type="button" aria-label="절차 초안 닫기" onClick={onClose}><X size={18}/></button>}</header>
    {requiredStepTitles.length > 0 && <div className="procedure-required-steps"><strong>공통업무 필수 단계</strong><p>아래 이름을 그대로 사용하고 각 단계를 필수 절차로 지정해 주세요.</p><ul>{requiredStepTitles.map((name, index) => <li key={`${index}-${name}`}>{name}</li>)}</ul></div>}
    <div className="procedure-source-modes" aria-label="절차 생성 방식"><button type="button" aria-pressed={sourceMode === 'ai'} disabled={locked} onClick={() => { setSourceMode('ai'); setError(''); }}><Sparkles size={15}/>BizRouter AI 분석</button><button type="button" aria-pressed={sourceMode === 'local'} disabled={locked} onClick={() => { setSourceMode('local'); setError(''); }}>본문으로 직접 초안 만들기</button></div>
    {sourceMode === 'ai' ? <div className="procedure-ai-sources">
      <p className="procedure-builder-intro">업무 개요와 붙임 파일을 가장 먼저 분석해 수행 단계·역할·선행 관계를 구성합니다. 관련 근거는 필요한 조건과 의무를 보완하고, 누락되거나 충돌하는 내용을 확인할 때 참고합니다.</p>
      <section className="procedure-primary-sources" aria-label="우선 분석할 업무 개요와 붙임 파일">
        <header><strong>1순위 · 업무 개요와 붙임 파일</strong><span>자동 포함</span></header>
        <h4>{overview.title}</h4><p>{overview.description.trim() || '업무 개요에서 업무 설명을 입력해 주세요.'}</p>
        {overview.completionCriteria.trim() && <p className="procedure-overview-criteria">완료 기준 · {overview.completionCriteria}</p>}
        <div><strong>업무 개요의 붙임 파일 · {overview.descriptionAttachmentIds?.length || 0}개</strong>{overview.descriptionAttachmentIds?.length ? <ul>{overview.descriptionAttachmentIds.map(id => <li key={id}><FileText size={15}/>{overviewAttachments.find(file => file.id === id)?.name || '연결된 파일 확인 필요'}</li>)}</ul> : <p>등록된 붙임 파일이 없습니다. 업무 개요에서 파일을 추가할 수 있습니다.</p>}<small>업무 개요의 파일은 Kordoc으로 본문을 읽어 항상 우선 분석합니다.</small></div>
      </section>
      <fieldset><legend>2순위 · 함께 참고할 관련 근거 · 선택 <span>{selectedReferences.length}/{AI_REFERENCE_LIMIT}</span></legend>{references.length ? references.map(reference => <label key={reference.id} className="procedure-reference-option"><input type="checkbox" disabled={locked || (!referenceIds.includes(reference.id) && ((!reference.content.trim() && !(readAttachments && reference.attachmentId)) || selectedReferences.length >= AI_REFERENCE_LIMIT))} checked={referenceIds.includes(reference.id)} onChange={event => { setReferenceIds(current => event.target.checked ? [...current, reference.id] : current.filter(id => id !== reference.id)); setError(''); }}/><span><strong>{reference.title}</strong><small>{reference.content.trim() ? `${reference.content.length.toLocaleString('ko-KR')}자${reference.attachmentId ? ' · 첨부 본문 포함' : ''}` : reference.attachmentId ? 'Kordoc으로 첨부파일 본문을 읽어 분석합니다.' : '관련 근거에서 본문을 입력하거나 문서 파일을 첨부하세요.'}</small></span></label>) : <p className="procedure-no-sources">등록된 관련 근거가 없습니다. 업무 개요와 붙임 파일로 절차를 만들 수 있습니다.</p>}</fieldset>
      <label className="procedure-file-analysis"><input type="checkbox" checked={readAttachments} disabled={locked} onChange={event => { setReadAttachments(event.target.checked); setDraft(null); }}/><span>관련 근거의 첨부파일도 Kordoc으로 읽기</span></label>
      <p className="procedure-ai-disclosure">저장된 업무 개요, 업무 개요 파일의 본문, 선택한 관련 근거를 BizRouter로 전송합니다. 파일 원본과 원문 주소는 전송하지 않습니다. 변경한 업무 개요와 붙임 파일·근거는 먼저 저장해 주세요.</p>
      <div className="procedure-ai-action"><button className="btn btn-primary" type="button" disabled={executing || !hasSourceContent || selectedReferences.some(reference => !reference.content.trim() && !(readAttachments && reference.attachmentId)) || selectedLength > AI_REFERENCE_TEXT_LIMIT} onClick={() => void generateAi()}><Sparkles size={16}/>{busy ? 'AI가 업무 개요·파일을 분석하는 중…' : 'AI 업무 분석·절차 만들기'}</button><small>입력 본문 {selectedLength.toLocaleString('ko-KR')}자 · 파일 본문 포함 최대 60,000자</small></div>
      {selectedLength > AI_REFERENCE_TEXT_LIMIT && <p className="procedure-error" role="alert">업무 설명과 선택한 근거의 본문 합계를 6만 자 이하로 맞춰 주세요.</p>}
    </div> : <>
    <p className="procedure-builder-intro">문서 파일 또는 붙여 넣은 본문을 번호·문단 단위로 정리합니다. 외부 AI 전송 없이 규칙 기반 초안을 작성합니다.</p>
    <div className="procedure-source-grid"><label><span>자료 제목</span><input value={title} maxLength={300} disabled={locked} onChange={event => { setTitle(event.target.value); setDraft(null); }} placeholder="예: 예산 집행 업무 지침"/></label><label><span>자료 구분</span><select value={type} disabled={locked} onChange={event => { setType(event.target.value as TaskReference['type']); setDraft(null); }}><option value="guideline">지침·매뉴얼</option><option value="law">법령 본문</option><option value="directive">지시사항</option><option value="other">기타 자료</option></select></label><label className="procedure-url"><span>원문 주소 · 선택</span><input type="url" value={url} maxLength={2000} disabled={locked} onChange={event => { setUrl(event.target.value); setDraft(null); }} placeholder="https://… (주소를 자동으로 가져오지는 않습니다)"/></label></div>
    <div className="procedure-import-row"><label className={`procedure-upload${executing ? ' is-disabled' : ''}`}><Upload size={16}/>{busy ? 'Kordoc 본문 추출 중…' : '문서에서 본문 가져오기'}<input type="file" accept=".pdf,.hwp,.hwpx,.docx,.xlsx,.xls,.pptx,.txt,.csv" disabled={executing} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importPdf(file); }}/></label><small>10MB · 150쪽 이내 · 서버에서 Kordoc으로 추출 · 외부 AI 전송 없음</small></div>
    {fileNotice && <p className="procedure-file-notice"><FileText size={15}/>{fileNotice}</p>}
    <label className="procedure-text"><span>자료 본문</span><textarea rows={7} value={text} maxLength={PROCEDURE_TEXT_LIMIT} disabled={locked} onChange={event => { setText(event.target.value); setPages(undefined); setDraft(null); setFileNotice('본문을 직접 수정했습니다. 근거 위치는 문단 기준으로 다시 표시됩니다.'); }} placeholder={'1. 담당자는 요구자료를 작성한다.\n2. 부서장은 자료를 검토한다.\n3. 담당자는 결과를 제출한다.'}/><small>스캔 PDF의 OCR은 지원하지 않습니다. 원문 본문을 붙여 넣거나 추출한 내용을 보완하세요.</small></label>
    <button className="btn btn-primary procedure-generate" type="button" disabled={executing || !title.trim() || !text.trim()} onClick={generate}><GitBranch size={16}/>규칙 기반 절차 초안 만들기<ArrowRight size={15}/></button>
    </>}
    {error && !draft && <p className="procedure-error" role="alert">{error}</p>}
    {generatedBy && <p className="procedure-generated-by" role="status"><Check size={15}/>{generatedBy} · {draft?.analysis ? '업무 요약·절차도 생성 완료' : '절차도 생성 완료'}</p>}
    {draft?.analysis && <section className="procedure-analysis" aria-label="업무 개요·파일·관련 근거 AI 검토 요약">
      <header><span><Sparkles size={17}/></span><div><h4>업무 분석 종합 요약</h4><p>업무 개요와 파일을 우선 분석하고 관련 근거를 참고했습니다. 분석 자료 {draft.analysis.sources.length}건의 요약과 원문 인용을 확인해 주세요.</p></div></header>
      <p className="procedure-analysis-summary">{draft.analysis.summary}</p>
      <details className="procedure-analysis-sources" open><summary>자료별 검토 <span>{draft.analysis.sources.length}건</span></summary><ol>{draft.analysis.sources.map(source => <li key={source.referenceId}>
        <h5>{source.sourceTitle}</h5><p>{source.summary}</p>
        <details className="procedure-analysis-evidence"><summary><FileText size={14}/>원문 인용 확인</summary><span>{source.locator}</span><blockquote>{source.excerpt}</blockquote></details>
      </li>)}</ol></details>
    </section>}
    {draft && <div className="procedure-draft"><div className="procedure-draft-heading"><div><h4>검토할 절차 초안 <span>{draft.steps.length}개</span></h4><p>누가, 무엇을, 어떻게 할지 수정하고 위·아래로 순서를 정하세요.</p></div><button type="button" className="btn btn-secondary" disabled={locked || draft.steps.length >= 50} onClick={() => { const id = `${prefix()}-manual`; setDraft(current => current ? { ...current, steps: appendProcedureStep(current.steps, { id, title: '', role: 'primary', description: '', output: '', required: true, dependsOn: [], checklist: [], done: false }).workflow, evidence: { ...current.evidence, [id]: { sourceTitle: title, locator: '직접 작성한 절차', excerpt: '' } } } : current); setSelectedId(id); setReviewed(false); setDiagramChanged(true); }}><Plus size={15}/>수기로 절차 추가</button></div>
      <ul className="procedure-warnings">{draft.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
      <p className="procedure-draft-status" role="status">{diagramChanged ? '수정한 내용과 순서를 미리 보고 있습니다. 아래 주황색 버튼으로 저장하고 반영하세요.' : '절차를 선택해 내용을 수정할 수 있습니다.'}</p>
      <ProcedureFlow workflow={draft.steps} participants={participants} selectedId={selectedId} onSelect={setSelectedId} redrawKey={redrawKey}/>
      <div className="procedure-edit-layout"><nav className="procedure-step-list" aria-label="초안 단계 선택">{draft.steps.map((step, index) => <button type="button" key={step.id} className={step.id === selectedId ? 'selected' : ''} disabled={locked} onClick={() => setSelectedId(step.id)}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{step.title || '새 절차'}</b><small>{roleLabels[step.role]}<br/>{participants?.[step.role]?.trim() || participantFallbacks[step.role]}</small></div></button>)}</nav>
      {selected && <div className="procedure-step-editor">
        <div className="procedure-editor-title"><h4>{draft.steps.findIndex(step => step.id === selected.id) + 1}번 절차 수정</h4><div className="procedure-draft-order"><button type="button" className="btn btn-secondary" disabled={locked || !canMoveProcedureStep(draft.steps, selected.id, 'up')} aria-label={`${selected.title || '새 절차'} 위로 이동`} onClick={() => moveSelected('up')}><ArrowUp size={14}/>위로</button><button type="button" className="btn btn-secondary" disabled={locked || !canMoveProcedureStep(draft.steps, selected.id, 'down')} aria-label={`${selected.title || '새 절차'} 아래로 이동`} onClick={() => moveSelected('down')}><ArrowDown size={14}/>아래로</button>{!selectedRequired && !selectedLastReviewer && canRemoveProcedureStep(draft.steps, selected.id) && <button type="button" className="procedure-remove" disabled={locked} onClick={() => { const remaining = removeProcedureStep(draft.steps, selected.id).workflow; setDraft({ ...draft, steps: remaining }); setSelectedId(remaining[0]?.id || ''); setReviewed(false); setDiagramChanged(true); }}><Trash2 size={14}/>삭제</button>}</div></div>
        <div className="procedure-source-grid procedure-essential-grid"><label><span>누가</span><select value={selected.role} disabled={locked || selectedRequired || selectedLastReviewer} onChange={event => updateStep(selected.id, { role: event.target.value as WorkflowStep['role'] })}>{roles.map(role => <option key={role} value={role} disabled={role === 'support' && !hasSupport}>{participants?.[role]?.trim() || participantFallbacks[role]} · {roleLabels[role]}</option>)}</select></label><label><span>무엇을</span><input value={selected.title} maxLength={150} disabled={locked || selectedRequired} placeholder="예: 부서별 자료 취합" onChange={event => updateStep(selected.id, { title: event.target.value })}/></label></div>
        <label><span>어떻게</span><textarea rows={4} value={selected.description} maxLength={5000} disabled={locked} placeholder="수행 방법을 간단하게 적어 주세요." onChange={event => updateStep(selected.id, { description: event.target.value })}/></label>
        {draft.evidence[selected.id]?.excerpt && <details className="procedure-evidence"><summary><FileText size={14}/>초안의 원문 참고</summary><span>{draft.evidence[selected.id].locator}</span><strong>{draft.evidence[selected.id].sourceTitle || title}</strong><p>{draft.evidence[selected.id].excerpt}</p></details>}
      </div>}</div>
      {errors.length > 0 && <ul className="procedure-validation" role="alert">{errors.map(item => <li key={item}>{item}</li>)}</ul>}
      {error && <p className="procedure-error" role="alert">{error}</p>}
      {applyNotice && <p className="procedure-file-notice" role="status">{applyNotice}</p>}<div className="procedure-apply"><label className="procedure-check"><input type="checkbox" checked={reviewed} disabled={locked} onChange={event => setReviewed(event.target.checked)}/>원문 자료, 담당자와 진행 순서를 확인했습니다.</label><div><small>적용하면 {workflow.length ? `현재 ${workflow.length}개 절차를 이 초안으로 교체하고` : '이 초안을 최종 절차로'} 바로 저장합니다. 기존 수행 기록은 이력으로 보관합니다.</small><button type="button" className="btn procedure-apply-button" onClick={() => void apply()} disabled={executing || !reviewed || errors.length > 0}>{applying ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>} {applying ? '저장·반영 중…' : '초안 저장·절차도 반영'}</button></div></div>
    </div>}
  </section>;
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, MarkerType, Position, ReactFlow, type Edge, type Node } from '@xyflow/react';
import { ArrowRight, Check, FileText, GitBranch, LoaderCircle, Maximize2, Minimize2, Plus, RefreshCw, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { TaskReference, WorkflowStep } from '@/lib/types';
import { replaceProcedureDraft, generateProcedureDraft, procedureErrors, PROCEDURE_PDF_LIMIT, PROCEDURE_TEXT_LIMIT, type ProcedureDraft, type ProcedurePage } from '@/lib/procedure-draft';
import { AI_REFERENCE_LIMIT, AI_REFERENCE_TEXT_LIMIT, procedureReferenceFingerprint } from '@/lib/procedure-ai-input';
import '@xyflow/react/dist/style.css';
import './procedure-builder.css';

const roles: WorkflowStep['role'][] = ['support', 'primary', 'reviewer'];
const roleLabels = { primary: '담당자 수행', support: '협업·지원', reviewer: '검토·승인' };
const participantFallbacks = { primary: '담당자 미지정', support: '협업자 미지정', reviewer: '부서장 미지정' };
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
    const laneHeights = roles.map(role => {
      const occurrences = new Map<number, number>();
      for (const step of workflow.filter(item => item.role === role)) { const level = levels.get(step.id) || 0; occurrences.set(level, (occurrences.get(level) || 0) + 1); }
      return Math.max(1, ...occurrences.values()) * rowSpacing + 65;
    });
    const laneTops = laneHeights.map((_, index) => laneHeights.slice(0, index).reduce((sum, height) => sum + height + 12, 0));
    for (const step of workflow) {
      const lane = roles.indexOf(step.role); const level = levels.get(step.id) || 0; const key = `${lane}-${level}`; const row = counts.get(key) || 0; counts.set(key, row + 1);
      positions.set(step.id, { x: 185 + level * 260, y: laneTops[lane] + 48 + row * rowSpacing });
    }
    const participant = (role: WorkflowStep['role']) => participants?.[role]?.trim() || participantFallbacks[role];
    const nodes: Node[] = roles.map((role, index) => ({ id: `lane-${role}`, position: { x: 0, y: laneTops[index] }, data: { label: <div className="procedure-lane-label"><strong>{roleLabels[role]}</strong><span>{participant(role)}</span></div> }, style: { width, height: laneHeights[index] }, className: `procedure-lane procedure-lane-${role}`, selectable: false, draggable: false, focusable: false, zIndex: -1 }));
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
  workflow: WorkflowStep[];
  references?: TaskReference[];
  participants?: ProcedureParticipants;
  requiredStepTitles?: string[];
  disabled?: boolean;
  onApply: (steps: WorkflowStep[], refs: TaskReference[]) => Promise<boolean> | boolean;
  onClose?: () => void;
}

export function ProcedureBuilder({ taskId, workflow, references = [], participants, requiredStepTitles = [], disabled = false, onApply, onClose }: ProcedureBuilderProps) {
  const [title, setTitle] = useState(''); const [url, setUrl] = useState('');
  const [type, setType] = useState<TaskReference['type']>('guideline'); const [text, setText] = useState('');
  const [pages, setPages] = useState<ProcedurePage[] | undefined>(); const [draft, setDraft] = useState<ProcedureDraft | null>(null);
  const [selectedId, setSelectedId] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [fileNotice, setFileNotice] = useState(''); const [reviewed, setReviewed] = useState(false);
  const [applying, setApplying] = useState(false); const [diagramChanged, setDiagramChanged] = useState(false); const [redrawKey, setRedrawKey] = useState(0);
  const [sourceMode, setSourceMode] = useState<'ai' | 'local'>('ai');
  const [referenceIds, setReferenceIds] = useState<string[]>(() => references.filter(reference => reference.content.trim() || reference.attachmentId).slice(0, AI_REFERENCE_LIMIT).map(reference => reference.id));
  const [generatedBy, setGeneratedBy] = useState('');
  const [readAttachments, setReadAttachments] = useState(true);
  const selectedReferences = references.filter(reference => referenceIds.includes(reference.id));
  const sourceFingerprint = procedureReferenceFingerprint(selectedReferences);
  const latestFingerprint = useRef(sourceFingerprint); latestFingerprint.current = sourceFingerprint;
  const controller = useRef<AbortController | null>(null);
  const selectedLength = selectedReferences.reduce((sum, reference) => sum + reference.content.length, 0);
  useEffect(() => { setDraft(null); setReviewed(false); setGeneratedBy(''); }, [sourceFingerprint]);
  useEffect(() => () => controller.current?.abort(), []);
  const selected = draft?.steps.find(step => step.id === selectedId);
  const requiredTitles = draft?.steps.filter(step => step.required).map(step => step.title.trim()) || [];
  const missingRequiredTitles = draft ? requiredStepTitles.filter(title => { const index = requiredTitles.indexOf(title); if (index < 0) return true; requiredTitles.splice(index, 1); return false; }) : [];
  const errors = draft ? [...procedureErrors(draft.steps), ...missingRequiredTitles.map(title => `공통 필수 단계 '${title}'을 같은 이름으로 추가하고 필수 절차로 지정해 주세요.`)] : [];
  const locked = disabled || busy || applying;

  function updateStep(id: string, patch: Partial<WorkflowStep>) {
    setDraft(current => current ? { ...current, steps: current.steps.map(step => step.id === id ? { ...step, ...patch } : step) } : current); setReviewed(false); setDiagramChanged(true); setError('');
  }
  async function importPdf(file: File) {
    if (file.size > PROCEDURE_PDF_LIMIT) { setError('문서는 10MB 이하로 선택해 주세요.'); return; }
    setBusy(true); setError(''); setFileNotice('');
    try {
      const form = new FormData(); form.append('taskId', taskId); form.append('file', file);
      const response = await fetch('/api/procedure-extract', { method: 'POST', body: form });
      const result = await response.json() as { error?: string; pages?: ProcedurePage[]; text?: string; pageCount?: number; warnings?: string[] };
      if (!response.ok) throw new Error(result.error || '문서 본문을 읽지 못했습니다.');
      setText(result.text || ''); setPages(result.pages); if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ''));
      setDraft(null); setReviewed(false); setFileNotice(`${file.name} · ${result.pageCount ? `${result.pageCount}쪽·섹션 · ` : ''}본문 추출 완료${result.warnings?.length ? ` · ${result.warnings.join(' ')}` : ''}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '본문을 추출하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  function generate() {
    setError('');
    try { const next = generateProcedureDraft({ title, text, type, url, pages }, prefix()); setDraft(next); setSelectedId(next.steps[0]?.id || ''); setReviewed(false); setDiagramChanged(false); setRedrawKey(value => value + 1); setGeneratedBy('규칙 기반 초안'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '초안을 만들지 못했습니다.'); }
  }
  async function generateAi() {
    setBusy(true); setError(''); setDraft(null); setReviewed(false); setGeneratedBy('');
    const fingerprint = sourceFingerprint; const requestController = new AbortController(); controller.current = requestController;
    try {
      const response = await fetch('/api/procedure-generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, referenceIds: selectedReferences.map(reference => reference.id), referencesFingerprint: fingerprint, readAttachments }), signal: requestController.signal });
      const result = await response.json() as { error?: string; draft?: ProcedureDraft; model?: string };
      if (!response.ok || !result.draft) throw new Error(result.error || 'AI 절차를 생성하지 못했습니다.');
      if (latestFingerprint.current !== fingerprint) throw new Error('분석 중 관련 근거가 변경되었습니다. 저장한 뒤 다시 분석해 주세요.');
      setDraft(result.draft); setSelectedId(result.draft.steps[0]?.id || ''); setDiagramChanged(false); setRedrawKey(value => value + 1); setGeneratedBy(`BizRouter AI · ${result.model || '분석 완료'}`);
    } catch (cause) { if (!requestController.signal.aborted) setError(cause instanceof Error ? cause.message : 'AI 분석을 완료하지 못했습니다.'); }
    finally { if (!requestController.signal.aborted) setBusy(false); controller.current = null; }
  }
  async function apply() {
    if (!draft || locked || !reviewed) return;
    setApplying(true); setError('');
    try {
      if (errors.length) throw new Error(errors.join(' '));
      if (references.length + draft.references.length > 100) throw new Error('근거는 최대 100개까지 연결할 수 있습니다. 기존 근거를 먼저 정리해 주세요.');
      const next = replaceProcedureDraft(draft.steps);
      if (await onApply(next, draft.references) !== true) throw new Error('절차를 저장하지 못했습니다. 검토한 초안은 유지되므로 다시 적용해 주세요.');
      setDraft(null); setReviewed(false); setGeneratedBy(''); setDiagramChanged(false); onClose?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '절차를 적용하지 못했습니다.'); }
    finally { setApplying(false); }
  }
  return <section className="procedure-builder" aria-label="관련 근거로 AI 절차·절차도 만들기">
    <header className="procedure-builder-heading"><div><p>관련 근거에서 시작하는 절차</p><h3>근거를 분석하고, 절차도로 연결하세요.</h3></div>{onClose && <button className="procedure-close" type="button" aria-label="절차 초안 닫기" disabled={applying} onClick={onClose}><X size={18}/></button>}</header>
    {requiredStepTitles.length > 0 && <div className="procedure-required-steps"><strong>공통업무 필수 단계</strong><p>아래 이름을 그대로 사용하고 각 단계를 필수 절차로 지정해 주세요.</p><ul>{requiredStepTitles.map((name, index) => <li key={`${index}-${name}`}>{name}</li>)}</ul></div>}
    <div className="procedure-source-modes" aria-label="절차 생성 방식"><button type="button" aria-pressed={sourceMode === 'ai'} disabled={locked} onClick={() => { setSourceMode('ai'); setError(''); }}><Sparkles size={15}/>BizRouter AI 분석</button><button type="button" aria-pressed={sourceMode === 'local'} disabled={locked} onClick={() => { setSourceMode('local'); setError(''); }}>본문으로 직접 초안 만들기</button></div>
    {sourceMode === 'ai' ? <div className="procedure-ai-sources">
      <p className="procedure-builder-intro">관련 근거에 저장한 법령, 지침, 생산 문서를 선택하세요. AI가 각 근거의 핵심 내용을 요약하고 함께 검토한 뒤, 수행 단계·역할·선행 관계를 정리해 절차와 절차도를 만듭니다.</p>
      <fieldset><legend>분석할 관련 근거 <span>{selectedReferences.length}/{AI_REFERENCE_LIMIT}</span></legend>{references.length ? references.map(reference => <label key={reference.id} className="procedure-reference-option"><input type="checkbox" disabled={locked || (!reference.content.trim() && !(readAttachments && reference.attachmentId)) || (!referenceIds.includes(reference.id) && selectedReferences.length >= AI_REFERENCE_LIMIT)} checked={referenceIds.includes(reference.id)} onChange={event => { setReferenceIds(current => event.target.checked ? [...current, reference.id] : current.filter(id => id !== reference.id)); setError(''); }}/><span><strong>{reference.title}</strong><small>{reference.content.trim() ? `${reference.content.length.toLocaleString('ko-KR')}자${reference.attachmentId ? ' · 첨부 본문 포함' : ''}` : reference.attachmentId ? 'Kordoc으로 첨부파일 본문을 읽어 분석합니다.' : '관련 근거에서 본문을 입력하거나 문서 파일을 첨부하세요.'}</small></span></label>) : <p className="procedure-no-sources">관련 근거 탭에서 법령·지침 또는 생산 문서를 등록하고 저장해 주세요.</p>}</fieldset>
      <label className="procedure-file-analysis"><input type="checkbox" checked={readAttachments} disabled={locked} onChange={event => { setReadAttachments(event.target.checked); setDraft(null); }}/><span>첨부파일은 Kordoc으로 다시 읽어 전체 본문 분석</span></label>
      <p className="procedure-ai-disclosure">선택한 근거 본문과 저장된 업무 설명을 BizRouter로 전송합니다. 파일 본문 분석을 켜면 첨부문서 원문도 함께 검토합니다. 첨부파일 원본과 원문 주소는 전송하지 않습니다. 수정한 근거는 먼저 저장해 주세요.</p>
      <div className="procedure-ai-action"><button className="btn btn-primary" type="button" disabled={locked || !selectedReferences.length || selectedReferences.some(reference => !reference.content.trim() && !(readAttachments && reference.attachmentId)) || selectedLength > AI_REFERENCE_TEXT_LIMIT} onClick={() => void generateAi()}><Sparkles size={16}/>{busy ? 'AI가 근거를 요약하고 절차를 만드는 중…' : 'AI 근거 요약·절차 만들기'}</button><small>{selectedLength.toLocaleString('ko-KR')} / 60,000자</small></div>
      {selectedLength > AI_REFERENCE_TEXT_LIMIT && <p className="procedure-error" role="alert">분석할 근거를 줄여 본문 합계를 6만 자 이하로 맞춰 주세요.</p>}
    </div> : <>
    <p className="procedure-builder-intro">문서 파일 또는 붙여 넣은 본문을 번호·문단 단위로 정리합니다. 외부 AI 전송 없이 규칙 기반 초안을 작성합니다.</p>
    <div className="procedure-source-grid"><label><span>자료 제목</span><input value={title} maxLength={300} disabled={locked} onChange={event => { setTitle(event.target.value); setDraft(null); }} placeholder="예: 예산 집행 업무 지침"/></label><label><span>자료 구분</span><select value={type} disabled={locked} onChange={event => { setType(event.target.value as TaskReference['type']); setDraft(null); }}><option value="guideline">지침·매뉴얼</option><option value="law">법령 본문</option><option value="directive">지시사항</option><option value="other">기타 자료</option></select></label><label className="procedure-url"><span>원문 주소 · 선택</span><input type="url" value={url} maxLength={2000} disabled={locked} onChange={event => { setUrl(event.target.value); setDraft(null); }} placeholder="https://… (주소를 자동으로 가져오지는 않습니다)"/></label></div>
    <div className="procedure-import-row"><label className={`procedure-upload${locked ? ' is-disabled' : ''}`}><Upload size={16}/>{busy ? 'Kordoc 본문 추출 중…' : '문서에서 본문 가져오기'}<input type="file" accept=".pdf,.hwp,.hwpx,.docx,.xlsx,.xls,.pptx,.txt,.csv" disabled={locked} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importPdf(file); }}/></label><small>10MB · 150쪽 이내 · 서버에서 Kordoc으로 추출 · 외부 AI 전송 없음</small></div>
    {fileNotice && <p className="procedure-file-notice"><FileText size={15}/>{fileNotice}</p>}
    <label className="procedure-text"><span>자료 본문</span><textarea rows={7} value={text} maxLength={PROCEDURE_TEXT_LIMIT} disabled={locked} onChange={event => { setText(event.target.value); setPages(undefined); setDraft(null); setFileNotice('본문을 직접 수정했습니다. 근거 위치는 문단 기준으로 다시 표시됩니다.'); }} placeholder={'1. 담당자는 요구자료를 작성한다.\n2. 부서장은 자료를 검토한다.\n3. 담당자는 결과를 제출한다.'}/><small>스캔 PDF의 OCR은 지원하지 않습니다. 원문 본문을 붙여 넣거나 추출한 내용을 보완하세요.</small></label>
    <button className="btn btn-secondary procedure-generate" type="button" disabled={locked || !title.trim() || !text.trim()} onClick={generate}><GitBranch size={16}/>규칙 기반 절차 초안 만들기<ArrowRight size={15}/></button>
    </>}
    {error && !draft && <p className="procedure-error" role="alert">{error}</p>}
    {generatedBy && <p className="procedure-generated-by" role="status"><Check size={15}/>{generatedBy} · {draft?.analysis ? '근거 요약·절차도 생성 완료' : '절차도 생성 완료'}</p>}
    {draft?.analysis && <section className="procedure-analysis" aria-label="관련 근거 AI 검토 요약">
      <header><span><Sparkles size={17}/></span><div><h4>관련 근거 종합 요약</h4><p>선택한 근거 {draft.analysis.sources.length}건을 함께 검토한 내용입니다. 근거별 요약과 원문 인용을 확인해 주세요.</p></div></header>
      <p className="procedure-analysis-summary">{draft.analysis.summary}</p>
      <details className="procedure-analysis-sources" open><summary>근거별 검토 <span>{draft.analysis.sources.length}건</span></summary><ol>{draft.analysis.sources.map(source => <li key={source.referenceId}>
        <h5>{source.sourceTitle}</h5><p>{source.summary}</p>
        <details className="procedure-analysis-evidence"><summary><FileText size={14}/>원문 인용 확인</summary><span>{source.locator}</span><blockquote>{source.excerpt}</blockquote></details>
      </li>)}</ol></details>
    </section>}
    {draft && <div className="procedure-draft"><div className="procedure-draft-heading"><div><h4>검토할 절차 초안 <span>{draft.steps.length}개</span></h4><p>아래 단계를 수정하고 절차도를 확인한 뒤 적용해 주세요.</p></div><button type="button" className="btn btn-ghost" disabled={locked || draft.steps.length >= 50} onClick={() => { const id = `${prefix()}-manual`; setDraft(current => current ? { ...current, steps: [...current.steps, { id, title: '새 절차', role: 'primary', description: '사용자가 추가한 절차입니다. 실제 수행 내용과 근거를 작성해 주세요.', output: '결과물 확인 필요', required: true, dependsOn: current.steps.length ? [current.steps.at(-1)!.id] : [], checklist: ['처리 결과 확인'], done: false }], evidence: { ...current.evidence, [id]: { sourceTitle: title, locator: '직접 추가한 단계 · 근거 확인 필요', excerpt: '' } } } : current); setSelectedId(id); setReviewed(false); setDiagramChanged(true); }}><Plus size={15}/>단계 추가</button></div>
      <ul className="procedure-warnings">{draft.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
      <div className="procedure-redraw"><p role="status">{diagramChanged ? '수정한 내용이 절차도에 반영되었습니다. 다시 그리기로 배치와 화면을 정리하세요.' : '현재 초안의 단계와 선행 관계로 그린 절차도입니다.'}</p><button type="button" className="btn btn-secondary" disabled={locked || !draft.steps.length || errors.length > 0} onClick={() => { setRedrawKey(value => value + 1); setDiagramChanged(false); setError(''); }}><RefreshCw size={16}/>절차도 다시 그리기</button></div>
      <ProcedureFlow workflow={draft.steps} participants={participants} selectedId={selectedId} onSelect={setSelectedId} redrawKey={redrawKey}/>
      <div className="procedure-edit-layout"><nav className="procedure-step-list" aria-label="초안 단계 선택">{draft.steps.map((step, index) => <button type="button" key={step.id} className={step.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(step.id)}><span>{String(index + 1).padStart(2, '0')}</span><div><b>{step.title}</b><small>{roleLabels[step.role]}<br/>{participants?.[step.role]?.trim() || participantFallbacks[step.role]}</small></div></button>)}</nav>
      {selected && <div className="procedure-step-editor"><div className="procedure-editor-title"><h4>선택한 절차 수정</h4><button type="button" className="procedure-remove" disabled={locked} onClick={() => { const remaining = draft.steps.filter(step => step.id !== selected.id).map(step => ({ ...step, dependsOn: step.dependsOn.filter(id => id !== selected.id) })); setDraft({ ...draft, steps: remaining }); setSelectedId(remaining[0]?.id || ''); setReviewed(false); setDiagramChanged(true); }}><Trash2 size={14}/>삭제</button></div><label><span>절차 이름</span><input value={selected.title} maxLength={150} disabled={locked} onChange={event => updateStep(selected.id, { title: event.target.value })}/></label><div className="procedure-source-grid"><label><span>담당 역할</span><select value={selected.role} disabled={locked} onChange={event => updateStep(selected.id, { role: event.target.value as WorkflowStep['role'] })}>{roles.map(role => <option key={role} value={role}>{roleLabels[role]} · {participants?.[role]?.trim() || participantFallbacks[role]}</option>)}</select></label><label><span>결과물</span><input value={selected.output} maxLength={1000} disabled={locked} onChange={event => updateStep(selected.id, { output: event.target.value })}/></label></div><label><span>절차 설명 · 근거</span><textarea rows={4} value={selected.description} maxLength={5000} disabled={locked} onChange={event => updateStep(selected.id, { description: event.target.value })}/></label><label><span>확인 항목 · 한 줄에 하나</span><textarea rows={2} value={selected.checklist.join('\n')} disabled={locked} onChange={event => updateStep(selected.id, { checklist: event.target.value.split('\n') })}/></label><fieldset className="procedure-predecessors"><legend>선행 절차 · 여러 개 선택하면 합류 조건</legend>{draft.steps.filter(step => step.id !== selected.id).map(step => <label key={step.id}><input type="checkbox" checked={selected.dependsOn.includes(step.id)} disabled={locked} onChange={event => updateStep(selected.id, { dependsOn: event.target.checked ? [...selected.dependsOn, step.id] : selected.dependsOn.filter(id => id !== step.id) })}/><span>{step.title}</span></label>)}<small>선행 절차를 비우면 독립적으로 시작합니다. 병렬 단계는 같은 선행 절차를 선택하세요.</small></fieldset><label className="procedure-check"><input type="checkbox" checked={selected.required} disabled={locked} onChange={event => updateStep(selected.id, { required: event.target.checked })}/>필수 절차</label><div className="procedure-evidence"><span><FileText size={14}/>{draft.evidence[selected.id]?.locator || '직접 작성한 절차'}</span><strong>{draft.evidence[selected.id]?.sourceTitle || title}</strong><p>{draft.evidence[selected.id]?.excerpt || '직접 원문 근거를 확인해 주세요.'}</p></div></div>}</div>
      {errors.length > 0 && <ul className="procedure-validation" role="alert">{errors.map(item => <li key={item}>{item}</li>)}</ul>}
      {error && <p className="procedure-error" role="alert">{error}</p>}
      <div className="procedure-apply"><label className="procedure-check"><input type="checkbox" checked={reviewed} disabled={locked} onChange={event => setReviewed(event.target.checked)}/>원문 근거, 담당 역할과 선행 조건을 검토했습니다.</label><div><small>적용하면 {workflow.length ? `현재 ${workflow.length}개 절차를 이 초안으로 교체하고` : '이 초안을 최종 절차로'} 바로 저장합니다. 기존 수행 기록은 이력으로 보관합니다.</small><button type="button" className="btn procedure-apply-button" onClick={() => void apply()} disabled={locked || !reviewed || errors.length > 0}>{applying ? <LoaderCircle size={16} className="spin"/> : <Check size={16}/>} {applying ? '적용 중…' : '적용'}</button></div></div>
    </div>}
  </section>;
}

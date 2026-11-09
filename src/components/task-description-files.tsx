'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText, LoaderCircle, Paperclip, Sparkles, X } from 'lucide-react';
import type { Workspace } from '@/lib/types';
import type { DescriptionDraft } from '@/lib/bizrouter';
import type { ExtractedDocument } from '@/lib/document-extraction';
import { uploadAttachment } from '@/lib/upload-attachment';
import { Button } from './ui';
import { sameDraft } from '@/lib/pending-draft';
import { aiRequestError } from '@/lib/ai-request-lifecycle';
import { AiRequestStatus, useAiRequest } from './ai-request-status';
import { AI_GENERATION_CLIENT_TIMEOUT_MS } from '@/lib/ai-generation-policy';
import './task-description-files.css';

interface Props {
  workspace: Workspace; taskId?: string; attachmentIds: string[]; onAttachmentsChange: (ids: string[]) => void;
  title: string; description: string; onDescriptionChange: (value: string) => void;
  onWorkspace?: (workspace: Workspace) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean;
}
async function api<T>(input: object, signal: AbortSignal): Promise<T> {
  const extraction = 'action' in input && input.action === 'extract';
  const timeout = new AbortController();
  const timer = extraction ? setTimeout(() => timeout.abort(), AI_GENERATION_CLIENT_TIMEOUT_MS) : undefined;
  try {
    const response = await fetch('/api/task-description', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: extraction ? AbortSignal.any([signal, timeout.signal]) : signal });
    const body = await response.json().catch(() => null); if (!response.ok || !body) throw new Error(body?.error || '문서 분석 결과를 받지 못했습니다. 입력과 기존 초안은 유지됩니다.'); return body;
  } catch (cause) {
    if (timeout.signal.aborted && !signal.aborted) throw new Error('파일 본문 읽기 대기 시간이 지났습니다. 저장된 파일과 기존 본문은 유지되므로 다시 읽을 수 있습니다.');
    throw cause;
  } finally { clearTimeout(timer); }
}
export function TaskDescriptionFiles({ workspace, taskId, attachmentIds, onAttachmentsChange, title, description, onDescriptionChange, onWorkspace, onBusyChange, disabled = false }: Props) {
  const draftId = useRef(''); const fileInput = useRef<HTMLInputElement>(null);
  const [localAttachments, setLocalAttachments] = useState(workspace.attachments);
  const [documents, setDocuments] = useState<Record<string, ExtractedDocument>>({});
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [draft, setDraft] = useState<DescriptionDraft | null>(null);
  const [draftBasis, setDraftBasis] = useState(''); const [applied, setApplied] = useState(false);
  const aiRequest = useAiRequest();
  const scope = JSON.stringify([taskId, workspace.currentUser.id, workspace.currentUser.departmentId]);
  const latestScope = useRef({ scope, disabled }); latestScope.current = { scope, disabled };
  const busyCallback = useRef(onBusyChange); busyCallback.current = onBusyChange;
  useEffect(() => { aiRequest.cancel(); setBusy(''); busyCallback.current?.(false); }, [scope, disabled]);
  useEffect(() => () => { busyCallback.current?.(false); }, []);
  const attachments = attachmentIds.map(id => workspace.attachments.find(item => item.id === id) || localAttachments.find(item => item.id === id)).filter(item => item !== undefined);
  const ready = attachments.filter(item => documents[item.id]?.text.trim());
  const total = ready.reduce((sum, item) => sum + documents[item.id].text.length, 0);
  const basis = JSON.stringify({ scope, title, description, documents: ready.map(item => ({ id: item.id, text: documents[item.id].text })) });
  const pending = !!busy || disabled;
  const latest = useRef({ documents, attachmentIds }); latest.current = { documents, attachmentIds };
  const [notice, setNotice] = useState('');
  const begin = (label: string, timeoutMs?: number) => { if (disabled) return null; const request = aiRequest.start(timeoutMs); if (!request) return null; setBusy(label); setError(''); setNotice(''); onBusyChange?.(true); return request; };
  const end = (request: AbortController) => { if (aiRequest.finish(request)) { setBusy(''); onBusyChange?.(false); } };
  const accepts = (request: AbortController) => aiRequest.accepts(request) && latestScope.current.scope === scope && !latestScope.current.disabled;
  async function read(id: string, request: AbortController) {
    const submitted = latest.current.documents[id];
    const result = await api<ExtractedDocument>({ action: 'extract', attachmentId: id }, request.signal);
    if (!accepts(request)) return;
    if (!sameDraft(latest.current.documents[id], submitted)) setNotice('본문을 읽는 동안 수정한 내용을 유지했습니다. 새 추출 결과로 덮어쓰지 않았습니다.');
    else setDocuments(current => sameDraft(current[id], submitted) ? { ...current, [id]: result } : current);
    return result;
  }
  async function upload(files: FileList | null) {
    if (!files?.length || pending) return;
    if (files.length + attachmentIds.length > 10) { setError('설명 자료는 최대 10개까지 등록할 수 있습니다.'); return; }
    const request = begin('파일 저장·본문 읽는 중', 0); if (!request) return;
    const ids = [...attachmentIds]; const failures: string[] = [];
    try {
      if (!draftId.current) draftId.current = `draft:${workspace.currentUser.id}:${crypto.randomUUID()}`;
      for (const file of Array.from(files)) {
        if (!accepts(request)) break;
        try {
          const updated = await uploadAttachment(file, taskId || draftId.current);
          if (!accepts(request) || updated.currentUser.id !== workspace.currentUser.id) break;
          const attachment = updated.attachments.filter(item => item.taskId === (taskId || draftId.current) && item.uploadedBy === workspace.currentUser.id && !ids.includes(item.id) && item.name === file.name).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
          if (!attachment) throw new Error('저장된 파일을 확인하지 못했습니다.');
          ids.push(attachment.id); setLocalAttachments(updated.attachments); onWorkspace?.(updated); onAttachmentsChange([...new Set([...latest.current.attachmentIds, attachment.id])]);
          try { await read(attachment.id, request); } catch (error) { failures.push(`${file.name}: 저장 완료, ${error instanceof Error ? error.message : '본문 읽기 실패'}`); }
        } catch (error) { failures.push(`${file.name}: ${error instanceof Error ? error.message : '업로드 실패'}`); }
      }
      if (accepts(request)) setError(failures.join('\n'));
    } finally { end(request); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function analyze() {
    if (pending) return;
    const request = begin('BizRouter가 문서를 분석하는 중'); if (!request) return;
    try {
      if (ready.length !== attachments.length) throw new Error('모든 설명 파일의 본문을 읽거나, 읽지 못한 파일을 설명 자료에서 제외해 주세요.');
      const result = await api<{ draft: DescriptionDraft }>({ action: 'generate', title, description, documents: ready.map(item => ({ attachmentId: item.id, text: documents[item.id].text })) }, request.signal);
      if (!accepts(request)) return;
      setDraft(result.draft); setDraftBasis(basis); setApplied(false);
    } catch (error) { if (aiRequest.owns(request)) setError(aiRequestError(request, error, 'AI 분석에 실패했습니다. 입력과 기존 초안은 유지됩니다.')); } finally { end(request); }
  }
  async function readOne(id: string) {
    const request = begin('본문 읽는 중'); if (!request) return;
    try { await read(id, request); }
    catch (error) { if (aiRequest.owns(request)) setError(aiRequestError(request, error, '본문을 읽지 못했습니다. 기존 본문은 유지됩니다.')); }
    finally { end(request); }
  }
  function cancel() {
    if (!aiRequest.cancel()) return;
    setBusy(''); onBusyChange?.(false);
    setNotice('분석을 취소했습니다. 입력과 기존 초안은 유지됩니다. 다시 시도할 때 이전 요청이 처리 중이면 잠시 기다려 주세요.');
  }
  return <section className="description-files" aria-label="업무 설명 자료">
    <div className="description-files-heading"><div><b><Paperclip size={17}/> 업무 설명 자료</b><p>파일을 읽고, 여러 자료를 종합해 설명 초안을 만듭니다.</p></div>{!disabled && <Button data-task-action="true" variant="secondary" disabled={pending} onClick={() => fileInput.current?.click()}>파일 추가</Button>}</div>
    <input ref={fileInput} type="file" multiple hidden aria-label="업무 설명 파일 추가" accept=".pdf,.hwp,.hwpx,.docx,.xlsx,.xls,.pptx,.txt,.csv" disabled={pending} onChange={event => void upload(event.target.files)}/>
    {!attachments.length && <p className="description-files-empty">PDF · 한글 · Word · Excel · PowerPoint · 텍스트 / 파일당 10MB, 최대 10개</p>}
    {attachments.map(attachment => <div className="description-file" key={attachment.id}>
      <div className="description-file-row"><FileText size={18}/><span><strong>{attachment.name}</strong><small>{Math.max(1, Math.round(attachment.size / 1024)).toLocaleString()} KB · {documents[attachment.id] ? '본문 읽기 완료' : '원본 저장됨'}</small></span>{attachment.status === 'test_allowed' && <a href={`/api/attachments/${attachment.id}`} target="_blank" rel="noreferrer">다운로드</a>}{!disabled && <><Button variant="ghost" disabled={pending} onClick={() => void readOne(attachment.id)}>본문 읽기</Button><button type="button" className="icon-btn" disabled={disabled} aria-label={`${attachment.name} 설명 자료에서 제외`} onClick={() => { onAttachmentsChange(attachmentIds.filter(id => id !== attachment.id)); setDraft(null); }}><X size={16}/></button></>}</div>
      {documents[attachment.id] && !disabled && <details><summary>읽은 본문 확인 · 분석 범위 편집 ({documents[attachment.id].text.length.toLocaleString()}자)</summary><textarea aria-label={`${attachment.name} 분석 본문`} rows={7} disabled={disabled} value={documents[attachment.id].text} onChange={event => setDocuments(current => ({ ...current, [attachment.id]: { ...current[attachment.id], text: event.target.value } }))}/>{documents[attachment.id].warnings.map((warning, i) => <p className="description-warning" key={i}>{warning}</p>)}</details>}
    </div>)}
    {!disabled && <div className="description-ai-actions"><Button data-task-action="true" variant="secondary" disabled={pending || !ready.length || ready.length !== attachments.length || total > 60_000 || !title.trim()} onClick={() => void analyze()}><Sparkles size={16}/> AI로 업무 설명 초안 만들기</Button><small>{total.toLocaleString()} / 60,000자 · 읽은 본문을 BizRouter로 전송합니다.</small></div>}
    {notice && <p role="status" className="description-warning">{notice}</p>}
    {busy === 'BizRouter가 문서를 분석하는 중' ? <AiRequestStatus startedAt={aiRequest.startedAt} onCancel={cancel}/> : busy && <div className="description-busy"><p role="status"><LoaderCircle size={16} className="spin"/>{busy}</p>{busy === '본문 읽는 중' && <Button variant="secondary" onClick={cancel}>본문 읽기 취소</Button>}</div>}
    {error && <p role="alert" className="form-error description-error">{error}</p>}
    {draft && !disabled && <div className="description-draft"><b><Sparkles size={17}/> AI 설명 초안</b><p className="description-draft-text">{draft.description}</p><details><summary>파일별 검토 요약과 원문 인용</summary>{draft.sources.map(source => <article key={source.attachmentId}><strong>{attachments.find(item => item.id === source.attachmentId)?.name}</strong><p>{source.summary}</p><blockquote>{source.quote}</blockquote></article>)}</details>{draft.warnings.map((warning, index) => <p key={index} className="description-warning">{warning}</p>)}<div><Button data-task-action="true" disabled={pending || applied || draftBasis !== basis} onClick={() => { onDescriptionChange(draft.description); setApplied(true); }}>{applied ? '설명에 적용됨' : '검토한 초안을 업무 설명에 적용'}</Button><small>{applied ? '업무 저장을 눌러 반영해 주세요.' : draftBasis !== basis ? '자료 또는 설명이 바뀌었습니다. 다시 분석해 주세요.' : '기존 설명은 적용 버튼을 눌러야 변경됩니다.'}</small></div></div>}
  </section>;
}

'use client';

import { useRef, useState } from 'react';
import { Download, FileText, Landmark, Link2, Plus, Trash2, Upload } from 'lucide-react';
import type { TaskReference, Workspace } from '@/lib/types';
import { hasReferenceContent } from '@/lib/task-references';
import { uploadAttachment } from '@/lib/upload-attachment';
import { Badge, Button, Field } from './ui';

const referenceNames: Record<TaskReference['type'], string> = { law: '법령', guideline: '지침', national_agenda: '국정과제', directive: '지시사항', document: '생산 문서', other: '기타 근거' };
const contentLimit = 10000;
const newId = () => `ref-${crypto.randomUUID().slice(0, 12)}`;

export function TaskReferences({ workspace, taskId, references, editable, onChange, command, onBusyChange }: {
  workspace: Workspace; taskId: string; references: TaskReference[]; editable: boolean;
  onChange: (references: TaskReference[]) => void;
  command: (type: string, payload: Record<string, unknown>) => Promise<boolean>;
  onBusyChange: (busy: boolean) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTargetId = useRef('');
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const files = workspace.attachments.filter(file => file.taskId === taskId);
  const task = workspace.tasks.find(task => task.id === taskId);
  const canUpload = editable && !!task && [task.primaryId, ...task.supportIds].includes(workspace.currentUser.id);
  const displayedReferences: TaskReference[] = references.length ? references : editable ? [{ id: `ref-${taskId}-initial`, type: 'law', title: '', content: '' }] : [];
  const change = (id: string, patch: Partial<TaskReference>) => onChange(displayedReferences.map(reference => reference.id === id ? { ...reference, ...patch } : reference));
  const chooseFile = (referenceId: string) => { uploadTargetId.current = referenceId; fileInput.current?.click(); };

  async function allowTestFile(attachmentId: string) {
    setUploading(true); onBusyChange(true); setError(''); setNotice('');
    try {
      if (await command('attachment.allowTest', { attachmentId, reason: '프로토타입 첨부 출처 확인' })) setNotice('테스트 파일을 허용했습니다. 다운로드 버튼으로 파일을 확인할 수 있습니다.');
      else setError('테스트 파일을 허용하지 못했습니다. 다시 시도해 주세요.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '테스트 파일을 허용하지 못했습니다.'); }
    finally { setUploading(false); onBusyChange(false); }
  }

  async function upload(file: File, referenceId: string) {
    if (!canUpload) return;
    const target = displayedReferences.find(reference => reference.id === referenceId);
    if (!target) return;
    if (!file.size || file.size > 10 * 1024 * 1024) { setError('비어 있지 않은 10MB 이하 파일을 선택해 주세요.'); return; }
    setUploading(true); onBusyChange(true); setError(''); setNotice('');
    try {
      const result = await uploadAttachment(file, taskId);
      const attachment = result.attachments.find(item => item.taskId === taskId && !files.some(existing => existing.id === item.id) && item.name === file.name);
      if (!attachment) throw new Error('첨부파일 정보를 확인하지 못했습니다. 다시 열어 확인해 주세요.');
      let content = ''; let extractionNotice = '';
      try {
        if (/\.pdf$/i.test(file.name)) {
          const form = new FormData(); form.append('file', file); form.append('taskId', taskId);
          const extracted = await fetch('/api/procedure-extract', attachment.storageProvider === 'neon'
            ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, attachmentId: attachment.id }) }
            : { method: 'POST', body: form });
          const body = await extracted.json() as { text?: string; error?: string };
          if (!extracted.ok) throw new Error(body.error || 'PDF 본문을 추출하지 못했습니다.');
          content = body.text || '';
        } else if (/\.(txt|csv)$/i.test(file.name)) content = await file.text();
        else extractionNotice = 'AI 분석에 사용할 주요 내용을 직접 입력해 주세요.';
      } catch (cause) { extractionNotice = cause instanceof Error ? cause.message : '본문을 직접 입력해 주세요.'; }
      if (content.length > contentLimit) extractionNotice = '앞부분 10,000자를 가져왔습니다. 분석할 조항과 내용을 확인해 주세요.';
      change(referenceId, { title: target.title.trim() ? target.title : file.name.slice(0, 300), content: target.content.trim() ? target.content : content.slice(0, contentLimit), attachmentId: attachment.id });
      const refreshed = await command('workspace.refresh', {});
      if (!refreshed) { setError('파일은 업로드되었으나 최신 첨부 목록을 불러오지 못했습니다. 입력한 내용은 유지됩니다. 연결 상태를 확인한 뒤 다시 저장해 주세요.'); return; }
      setNotice(`파일을 등록했습니다. ${extractionNotice || '본문을 가져왔습니다.'} 근거 연결은 변경사항 저장을 눌러 반영하세요.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '파일을 등록하지 못했습니다.'); }
    finally { setUploading(false); onBusyChange(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  return <div className="form-stack">
    <div className="pw-section-intro"><div><h3>관련 근거와 생산 문서</h3><p>근거를 한 개씩 입력하고 필요한 만큼 추가하세요. 각 근거에 관련 파일을 첨부할 수 있습니다.</p></div>{editable && <Button type="button" variant="secondary" disabled={uploading || displayedReferences.length >= 100} onClick={() => onChange([...displayedReferences, { id: newId(), type: 'law', title: '', content: '' }])}><Plus size={15}/>근거 추가</Button>}</div>
    {canUpload && <input ref={fileInput} hidden type="file" accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp,.txt,.csv,.hwp,.hwpx" aria-label="관련 근거 파일 선택" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file, uploadTargetId.current); }}/>}
    {error && <p className="pw-form-error" role="alert">{error}</p>}{notice && <p className="pw-form-note" role="status">{notice}</p>}
    <div className="pw-reference-list">{displayedReferences.map((reference, index) => {
      const file = files.find(file => file.id === reference.attachmentId);
      return <section className="pw-reference-card" key={reference.id}><div className="pw-reference-heading"><Badge tone="outline">{referenceNames[reference.type]}</Badge><span>근거 {String(index + 1).padStart(2, '0')}</span>{editable && (displayedReferences.length > 1 || hasReferenceContent(reference)) && <button type="button" disabled={uploading} className="pw-icon-button" aria-label={`${index + 1}번 근거 연결 삭제`} onClick={() => onChange(displayedReferences.filter(item => item.id !== reference.id))}><Trash2 size={16}/></button>}</div><div className="form-grid">
        <Field label="근거 유형"><select disabled={!editable || uploading} value={reference.type} onChange={event => change(reference.id, { type: event.target.value as TaskReference['type'] })}>{Object.entries(referenceNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="제목"><input disabled={!editable || uploading} value={reference.title} maxLength={300} placeholder="법령명, 지침명 또는 생산 문서 제목" onChange={event => change(reference.id, { title: event.target.value })}/></Field>
        <Field label={reference.type === 'document' ? '문서 내용 · 생산 결과' : '내용 및 적용 조항'} span><textarea rows={5} disabled={!editable || uploading} value={reference.content} maxLength={contentLimit} placeholder="AI가 분석할 본문이나 적용 조항을 입력해 주세요. 파일만 보관할 때에는 비워둘 수 있습니다." onChange={event => change(reference.id, { content: event.target.value })}/></Field>
        <Field label="원문 링크 (선택)" span><input type="url" disabled={!editable || uploading} value={reference.url || ''} placeholder="https://" onChange={event => change(reference.id, { url: event.target.value })}/></Field>
        {files.length > 0 && <Field label="연결할 첨부파일 (선택)" span><select disabled={!editable || uploading} value={reference.attachmentId || ''} onChange={event => change(reference.id, { attachmentId: event.target.value || undefined })}><option value="">파일 연결 없음</option>{files.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}</select></Field>}
      </div>{canUpload && <div className="pw-reference-attachment"><Button type="button" variant="secondary" disabled={uploading} aria-label={`${index + 1}번 근거 파일 ${file ? '변경' : '첨부'}`} onClick={() => chooseFile(reference.id)}><Upload size={15}/>{uploading && uploadTargetId.current === reference.id ? '파일 처리 중…' : file ? '첨부파일 변경' : '파일 첨부 · 선택'}</Button><p>PDF·문서·이미지·TXT 등 최대 10MB. PDF·TXT·CSV의 본문을 가져옵니다.</p></div>}{file && <div className="pw-reference-file"><FileText size={17}/><span><strong>{file.name}</strong><small>{Math.ceil(file.size / 1024)} KB · {file.status === 'quarantined' ? '검사 대기' : '테스트 허용'}</small></span>{workspace.currentUser.role === 'admin' && file.status === 'quarantined' && <Button type="button" variant="secondary" disabled={uploading} onClick={() => void allowTestFile(file.id)}>테스트 파일 허용</Button>}{file.status === 'test_allowed' && <a href={`/api/attachments/${encodeURIComponent(file.id)}`} aria-label={`${file.name} 다운로드`}><Download size={17}/></a>}{editable && <button type="button" className="pw-icon-button" disabled={uploading} aria-label={`${file.name} 근거 연결 해제`} onClick={() => change(reference.id, { attachmentId: undefined })}><Trash2 size={16}/></button>}</div>}{reference.url && /^https?:\/\//i.test(reference.url) && <a className="pw-reference-link" href={reference.url} target="_blank" rel="noreferrer"><Link2 size={14}/>원문 열기</a>}</section>;
    })}</div>
    {!displayedReferences.length && <div className="pw-inline-empty"><Landmark size={25}/><p>등록된 관련 근거가 없습니다.</p><span>수정 화면에서 근거를 입력하고 필요하면 파일을 첨부할 수 있습니다.</span></div>}
    {files.some(file => !references.some(reference => reference.attachmentId === file.id)) && <details className="pw-reference-unlinked"><summary>연결하지 않은 첨부파일</summary>{files.filter(file => !references.some(reference => reference.attachmentId === file.id)).map(file => <div className="pw-reference-file" key={file.id}><FileText size={17}/><span><strong>{file.name}</strong><small>{Math.ceil(file.size / 1024)} KB · {file.status === 'quarantined' ? '검사 대기' : '테스트 허용'}</small></span>{workspace.currentUser.role === 'admin' && file.status === 'quarantined' && <Button type="button" variant="secondary" disabled={uploading} onClick={() => void allowTestFile(file.id)}>테스트 파일 허용</Button>}{file.status === 'test_allowed' && <a href={`/api/attachments/${encodeURIComponent(file.id)}`} aria-label={`${file.name} 다운로드`}><Download size={17}/></a>}{editable && <Button type="button" variant="secondary" disabled={uploading || references.filter(hasReferenceContent).length >= 100} onClick={() => onChange([...references.filter(hasReferenceContent), { id: newId(), type: 'document', title: file.name.slice(0, 300), content: '', attachmentId: file.id }])}>근거에 연결</Button>}</div>)}</details>}
  </div>;
}

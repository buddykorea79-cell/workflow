'use client';

import { useRef, useState } from 'react';
import { Download, FileText, Landmark, Link2, Plus, Trash2, Upload } from 'lucide-react';
import type { TaskReference, Workspace } from '@/lib/types';
import { hasReferenceContent, referenceWithFile } from '@/lib/task-references';
import { canActAsDeputy } from '@/lib/delegations';
import { uploadAttachment } from '@/lib/upload-attachment';
import { Badge, Button, Field, ReadField } from './ui';
import { LawReferencePicker } from './law-reference-picker';
import { sameDraft } from '@/lib/pending-draft';

const referenceNames: Record<TaskReference['type'], string> = { law: '법령', guideline: '지침·행정규칙', national_agenda: '국정과제', directive: '지시사항', document: '생산 문서', other: '기타 근거' };
const contentLimit = 200000;
const newId = () => `ref-${crypto.randomUUID().slice(0, 12)}`;

export function TaskReferences({ workspace, taskId, references, editable, documentsOnly = false, onChange, command, onBusyChange }: {
  workspace: Workspace; taskId: string; references: TaskReference[]; editable: boolean; documentsOnly?: boolean;
  onChange: (references: TaskReference[]) => void;
  command: (type: string, payload: Record<string, unknown>) => Promise<boolean>;
  onBusyChange: (busy: boolean) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadTargetId = useRef('');
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [extractionWarnings, setExtractionWarnings] = useState<string[]>([]);
  const [pendingFile, setPendingFile] = useState<{ reference: TaskReference; file: { id: string; name: string }; content: string } | null>(null);
  const [verifiedPreviousText, setVerifiedPreviousText] = useState(false);
  const fileChoiceVersion = useRef(0);
  const blocked = uploading || !!pendingFile;
  const mayEdit = (reference: TaskReference) => editable && (!documentsOnly || reference.type === 'document');
  const files = workspace.attachments.filter(file => file.taskId === taskId);
  const task = workspace.tasks.find(task => task.id === taskId);
  const canUpload = editable && !!task && (workspace.currentUser.role === 'admin' || [task.primaryId, ...task.supportIds].includes(workspace.currentUser.id) || canActAsDeputy(workspace, workspace.currentUser, task, 'attachment.upload', new Date(workspace.serverTime)));
  const displayedReferences: TaskReference[] = references.length ? references : editable ? [{ id: `ref-${taskId}-initial`, type: documentsOnly ? 'document' : 'law', title: '', content: '' }] : [];
  const latestReferences = useRef(displayedReferences); latestReferences.current = displayedReferences;
  const change = (id: string, patch: Partial<TaskReference>) => onChange(latestReferences.current.map(reference => reference.id === id ? { ...reference, ...patch } : reference));
  const chooseFile = (referenceId: string) => { uploadTargetId.current = referenceId; fileInput.current?.click(); };

  function selectFile(reference: TaskReference, file: { id: string; name: string }, content: string) {
    fileChoiceVersion.current++;
    if (reference.content.trim() || reference.attachmentId) {
      setPendingFile({ reference, file, content }); setVerifiedPreviousText(false); onBusyChange(true);
      return true;
    }
    change(reference.id, referenceWithFile(reference, file, content));
    return false;
  }
  function resolveFile(choice: 'new' | 'previous' | 'cancel') {
    if (!pendingFile || (choice === 'previous' && !verifiedPreviousText)) return;
    if (choice !== 'cancel') {
      const current = latestReferences.current.find(reference => reference.id === pendingFile.reference.id);
      if (!current) { setPendingFile(null); onBusyChange(false); setNotice('근거가 삭제되어 업로드한 파일은 연결하지 않았습니다.'); return; }
      if (!sameDraft(current, pendingFile.reference)) { setPendingFile({ ...pendingFile, reference: current }); setVerifiedPreviousText(false); setNotice('확인 중 근거가 변경되었습니다. 현재 본문을 다시 확인한 뒤 사용할 내용을 선택해 주세요.'); return; }
      change(current.id, referenceWithFile(current, pendingFile.file, pendingFile.content, choice === 'previous'));
      setNotice(choice === 'previous' ? '새 파일과 일치한다고 확인한 기존 본문을 사용합니다. 변경사항을 저장해 주세요.' : '선택한 파일의 본문으로 바꿨습니다. 비어 있는 본문은 직접 입력할 수 있습니다. 변경사항을 저장해 주세요.');
    } else setNotice('파일 연결 변경을 취소했습니다. 업로드한 파일은 연결하지 않은 첨부파일에서 확인할 수 있습니다.');
    setPendingFile(null); onBusyChange(false);
  }

  async function allowTestFile(attachmentId: string) {
    setUploading(true); onBusyChange(true); setError(''); setNotice('');
    try {
      if (await command('attachment.allowTest', { attachmentId, reason: '프로토타입 첨부 출처 확인' })) setNotice('테스트 파일을 허용했습니다. 다운로드 버튼으로 파일을 확인할 수 있습니다.');
      else setError('테스트 파일을 허용하지 못했습니다. 다시 시도해 주세요.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '테스트 파일을 허용하지 못했습니다.'); }
    finally { setUploading(false); onBusyChange(false); }
  }

  async function upload(file: File, referenceId: string) {
    if (!canUpload || blocked) return;
    const target = latestReferences.current.find(reference => reference.id === referenceId);
    const selectedAtStart = fileChoiceVersion.current;
    if (!target || !mayEdit(target)) return;
    if (!file.size || file.size > 10 * 1024 * 1024) { setError('비어 있지 않은 10MB 이하 파일을 선택해 주세요.'); return; }
    setUploading(true); onBusyChange(true); setError(''); setNotice(''); setExtractionWarnings([]);
    let waitingForChoice = false;
    try {
      const result = await uploadAttachment(file, taskId);
      const attachment = result.attachments.find(item => item.taskId === taskId && !files.some(existing => existing.id === item.id) && item.name === file.name);
      if (!attachment) throw new Error('첨부파일 정보를 확인하지 못했습니다. 다시 열어 확인해 주세요.');
      let content = ''; let extractionNotice = '';
      try {
        if (/\.(pdf|hwp|hwpx|docx|xlsx|xls|pptx|txt|csv)$/i.test(file.name)) {
          const extracted = await fetch('/api/procedure-extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, attachmentId: attachment.id }) });
          const body = await extracted.json() as { text?: string; error?: string; warnings?: string[] };
          if (!extracted.ok) throw new Error(body.error || '문서 본문을 읽지 못했습니다.');
          content = body.text || '';
          setExtractionWarnings((body.warnings || []).filter(warning => typeof warning === 'string'));
        } else extractionNotice = '이미지는 OCR 처리한 문서로 올리거나 주요 내용을 직접 입력해 주세요.';
      } catch (cause) { extractionNotice = cause instanceof Error ? cause.message : '본문을 직접 입력해 주세요.'; }
      if (content.length > contentLimit) throw new Error('추출 본문이 20만 자를 넘었습니다. 필요한 부분으로 나누어 주세요.');
      const current = latestReferences.current.find(reference => reference.id === referenceId);
      if (current && mayEdit(current) && fileChoiceVersion.current === selectedAtStart && current.attachmentId === target.attachmentId) waitingForChoice = selectFile(current, attachment, content);
      else extractionNotice = '근거가 변경되거나 삭제되어 파일은 연결하지 않았습니다. 연결하지 않은 첨부파일에서 확인할 수 있습니다.';
      const refreshed = await command('workspace.refresh', {});
      if (!refreshed) { setError('파일은 업로드되었으나 최신 첨부 목록을 불러오지 못했습니다. 입력한 내용은 유지됩니다. 연결 상태를 확인한 뒤 다시 저장해 주세요.'); return; }
      setNotice(`파일을 등록했습니다. ${extractionNotice || '문서 본문을 가져왔습니다. AI 분석에서도 첨부파일을 다시 읽어 함께 검토합니다.'} ${waitingForChoice ? '아래에서 사용할 본문을 확인해 주세요.' : '근거 연결은 변경사항 저장을 눌러 반영하세요.'}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '파일을 등록하지 못했습니다.'); }
    finally { setUploading(false); if (!waitingForChoice) onBusyChange(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  return <div className="form-stack">
    <div className="pw-section-intro"><div><h3>관련 근거와 생산 문서</h3><p>{documentsOnly ? '생산 문서를 추가하거나 정정할 수 있습니다. 법령·지침 등 업무 기준은 그대로 보존됩니다.' : '근거를 한 개씩 입력하고 필요한 만큼 추가하세요. 각 근거에 관련 파일을 첨부할 수 있습니다.'}</p></div>{editable && <Button data-task-action="true" type="button" variant="secondary" disabled={displayedReferences.length >= 100} onClick={() => onChange([...displayedReferences, { id: newId(), type: documentsOnly ? 'document' : 'law', title: '', content: '' }])}><Plus size={15}/>{documentsOnly ? '생산 문서 추가' : '근거 추가'}</Button>}</div>
    {editable && !documentsOnly && <LawReferencePicker taskId={taskId} references={references} disabled={!editable} onChange={onChange}/>}
    {canUpload && <input ref={fileInput} hidden type="file" accept=".pdf,.docx,.xlsx,.xls,.pptx,.png,.jpg,.jpeg,.webp,.txt,.csv,.hwp,.hwpx" aria-label="관련 근거 파일 선택" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file, uploadTargetId.current); }}/>}
    {error && <p className="pw-form-error" role="alert">{error}</p>}{notice && <p className="pw-form-note" role="status">{notice}</p>}
    {extractionWarnings.length > 0 && <div className="pw-reference-warning" role="status"><strong>본문 추출 시 확인할 내용</strong><ul>{extractionWarnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
    {pendingFile && <section className="pw-reference-replacement" aria-label="첨부파일 본문 확인"><h4>새 파일과 사용할 본문을 확인해 주세요.</h4><p><strong>{pendingFile.file.name}</strong> 파일을 연결합니다. 기존 본문을 자동으로 이어 쓰지 않습니다.</p><div className="pw-reference-compare"><div><strong>기존 본문</strong><pre>{pendingFile.reference.content || '기존 본문 없음'}</pre></div><div><strong>새 파일에서 가져온 본문</strong><pre>{pendingFile.content || '가져온 본문이 없습니다. 새 파일을 연결한 뒤 주요 내용을 직접 입력해 주세요.'}</pre></div></div>{!!pendingFile.reference.content.trim() && <label className="pw-reference-verify"><input type="checkbox" checked={verifiedPreviousText} onChange={event => setVerifiedPreviousText(event.target.checked)}/><span>기존 본문이 새 파일의 내용과 일치하는지 확인했습니다.</span></label>}<div className="pw-reference-choice-actions"><Button data-task-action="true" type="button" onClick={() => resolveFile('new')}>{pendingFile.content ? '새 본문으로 교체' : '본문을 비우고 파일 연결'}</Button>{!!pendingFile.reference.content.trim() && <Button data-task-action="true" type="button" variant="secondary" disabled={!verifiedPreviousText} onClick={() => resolveFile('previous')}>확인한 기존 본문 사용</Button>}<Button type="button" variant="secondary" onClick={() => resolveFile('cancel')}>파일 연결 변경 취소</Button></div></section>}
    <div className="pw-reference-list">{displayedReferences.map((reference, index) => {
      const file = files.find(file => file.id === reference.attachmentId);
      const referenceEditable = mayEdit(reference);
      return <section className="pw-reference-card" key={reference.id}><div className="pw-reference-heading"><Badge tone="outline">{referenceNames[reference.type]}</Badge><span>근거 {String(index + 1).padStart(2, '0')}</span>{referenceEditable && (displayedReferences.length > 1 || hasReferenceContent(reference)) && <button type="button" className="pw-icon-button" aria-label={`${index + 1}번 근거 연결 삭제`} onClick={() => onChange(displayedReferences.filter(item => item.id !== reference.id))}><Trash2 size={16}/></button>}</div><div className="form-grid">
        {referenceEditable && !documentsOnly ? <Field label="근거 유형"><select disabled={!referenceEditable || documentsOnly} value={reference.type} onChange={event => change(reference.id, { type: event.target.value as TaskReference['type'] })}>{Object.entries(referenceNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field> : <ReadField label="근거 유형" value={referenceNames[reference.type]} />}
        {referenceEditable ? <Field label="제목"><input disabled={!referenceEditable} value={reference.title} maxLength={300} placeholder="법령명, 지침명 또는 생산 문서 제목" onChange={event => change(reference.id, { title: event.target.value })}/></Field> : <ReadField label="제목" value={reference.title} />}
        {referenceEditable ? <Field label={reference.type === 'document' ? '문서 내용 · 생산 결과' : '내용 및 적용 조항'} span><textarea rows={5} disabled={!referenceEditable} value={reference.content} maxLength={contentLimit} placeholder="AI가 분석할 본문이나 적용 조항을 입력해 주세요. 파일만 보관할 때에는 비워둘 수 있습니다." onChange={event => change(reference.id, { content: event.target.value })}/></Field> : <ReadField label={reference.type === 'document' ? '문서 내용 · 생산 결과' : '내용 및 적용 조항'} value={reference.content} span />}
        {referenceEditable ? <Field label="원문 링크 (선택)" span><input type="url" disabled={!referenceEditable} value={reference.url || ''} placeholder="https://" onChange={event => change(reference.id, { url: event.target.value })}/></Field> : <ReadField label="원문 링크 (선택)" value={reference.url} span />}
        {files.length > 0 && (referenceEditable ? <Field label="연결할 첨부파일 (선택)" span><select disabled={!referenceEditable} value={reference.attachmentId || ''} onChange={event => { const selected = files.find(file => file.id === event.target.value); if (!selected) change(reference.id, { attachmentId: undefined }); else if (selected.id !== reference.attachmentId) { setExtractionWarnings([]); setNotice('보관 중인 파일을 연결합니다. 본문은 다시 추출하지 않았으므로 직접 입력하거나 일치 여부를 확인해 주세요.'); selectFile(reference, selected, ''); } }}><option value="">파일 연결 없음</option>{files.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}</select></Field> : <ReadField label="연결할 첨부파일 (선택)" value={file?.name || (reference.attachmentId ? '연결된 파일을 조회할 수 없습니다.' : undefined)} span />)}
      </div>{canUpload && referenceEditable && <div className="pw-reference-attachment"><Button data-task-action="true" type="button" variant="secondary" disabled={blocked} aria-label={`${index + 1}번 근거 파일 ${file ? '변경' : '첨부'}`} onClick={() => chooseFile(reference.id)}><Upload size={15}/>{uploading && uploadTargetId.current === reference.id ? '파일 처리 중…' : file ? '첨부파일 변경' : '파일 첨부 · 선택'}</Button><p>최대 10MB. PDF·한글·Word·Excel·PowerPoint는 Kordoc으로 읽고, TXT·CSV도 본문을 가져옵니다.</p></div>}{file && <div className="pw-reference-file"><FileText size={17}/><span><strong>{file.name}</strong><small>{Math.ceil(file.size / 1024)} KB · {file.status === 'quarantined' ? '검사 대기' : '테스트 허용'}</small></span>{workspace.currentUser.role === 'admin' && file.status === 'quarantined' && <Button type="button" variant="secondary" disabled={blocked} onClick={() => void allowTestFile(file.id)}>테스트 파일 허용</Button>}{file.status === 'test_allowed' && <a href={`/api/attachments/${encodeURIComponent(file.id)}`} aria-label={`${file.name} 다운로드`}><Download size={17}/></a>}{referenceEditable && <button type="button" className="pw-icon-button" disabled={blocked} aria-label={`${file.name} 근거 연결 해제`} onClick={() => change(reference.id, { attachmentId: undefined })}><Trash2 size={16}/></button>}</div>}{reference.url && /^https?:\/\//i.test(reference.url) && <a className="pw-reference-link" href={reference.url} target="_blank" rel="noreferrer"><Link2 size={14}/>원문 열기</a>}</section>;
    })}</div>
    {!displayedReferences.length && <div className="pw-inline-empty"><Landmark size={25}/><p>등록된 관련 근거가 없습니다.</p><span>수정 화면에서 근거를 입력하고 필요하면 파일을 첨부할 수 있습니다.</span></div>}
    {files.some(file => !references.some(reference => reference.attachmentId === file.id)) && <details className="pw-reference-unlinked"><summary>연결하지 않은 첨부파일</summary>{files.filter(file => !references.some(reference => reference.attachmentId === file.id)).map(file => <div className="pw-reference-file" key={file.id}><FileText size={17}/><span><strong>{file.name}</strong><small>{Math.ceil(file.size / 1024)} KB · {file.status === 'quarantined' ? '검사 대기' : '테스트 허용'}</small></span>{workspace.currentUser.role === 'admin' && file.status === 'quarantined' && <Button type="button" variant="secondary" disabled={blocked} onClick={() => void allowTestFile(file.id)}>테스트 파일 허용</Button>}{file.status === 'test_allowed' && <a href={`/api/attachments/${encodeURIComponent(file.id)}`} aria-label={`${file.name} 다운로드`}><Download size={17}/></a>}{editable && <Button data-task-action="true" type="button" variant="secondary" disabled={blocked || references.filter(hasReferenceContent).length >= 100} onClick={() => onChange([...references.filter(hasReferenceContent), { id: newId(), type: 'document', title: file.name.slice(0, 300), content: '', attachmentId: file.id }])}>{documentsOnly ? '생산 문서로 연결' : '근거에 연결'}</Button>}</div>)}</details>}
  </div>;
}

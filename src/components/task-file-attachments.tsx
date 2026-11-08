'use client';

import { useId, useRef, useState } from 'react';
import { Download, FileText, LoaderCircle, Paperclip, Plus, X } from 'lucide-react';
import type { Attachment, Workspace } from '@/lib/types';
import { canActAsDeputy } from '@/lib/delegations';
import { uploadAttachment } from '@/lib/upload-attachment';
import { getUnitEvaluation, getUnitScorePlan } from '@/lib/unit-evaluation';
import { Button, type CommandFn } from './ui';
import './task-file-attachments.css';

interface Props {
  workspace: Workspace;
  taskId: string;
  performanceId?: string;
  attachmentIds: string[];
  onChange?: (ids: string[]) => void;
  command?: CommandFn;
  onWorkspace?: (workspace: Workspace) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export function TaskFileAttachments({ workspace, taskId, performanceId, attachmentIds, onChange, command, onWorkspace, onBusyChange, disabled = false, label = '참고 파일' }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const [localFiles, setLocalFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const latestIds = useRef(attachmentIds); latestIds.current = attachmentIds;
  const changeRef = useRef(onChange); changeRef.current = onChange;
  const files = [...workspace.attachments, ...localFiles.filter(file => !workspace.attachments.some(item => item.id === file.id))].filter(file => file.taskId === taskId && (!file.performanceId || file.performanceId === performanceId));
  const task = workspace.tasks.find(item => item.id === taskId);
  const user = workspace.currentUser;
  const performance = performanceId ? workspace.performances.find(item => item.id === performanceId && item.taskId === taskId) : undefined;
  const ownPerformance = !!performance && performance.authorId === user.id && !!performance.period && ['draft', 'changes_requested'].includes(performance.status) && !getUnitScorePlan(workspace, user.id, performance.period)?.submittedAt && !getUnitEvaluation(workspace, user.id, performance.period);
  const canUpload = !!onChange && (performanceId ? ownPerformance : !!task && !task.deletedAt && task.status !== 'archived' && (user.role === 'admin' || [task.primaryId, ...task.supportIds].includes(user.id) || workspace.runs.some(run => run.taskId === taskId && run.status !== 'completed' && [run.primaryId, ...run.supportIds].includes(user.id)) || canActAsDeputy(workspace, user, task, 'attachment.upload', new Date(workspace.serverTime))));
  const selected = attachmentIds.map(id => ({ id, file: files.find(file => file.id === id) }));
  const available = files.filter(file => !attachmentIds.includes(file.id));
  const blocked = disabled || busy;
  const change = (ids: string[]) => { latestIds.current = ids; setNotice('변경사항을 저장하면 파일이 연결됩니다.'); changeRef.current?.(ids); };

  async function upload(chosen: FileList | null) {
    if (!chosen?.length || !canUpload || blocked) return;
    if (attachmentIds.length + chosen.length > 30) { setError('파일은 최대 30개까지 첨부할 수 있습니다.'); return; }
    setBusy(true); onBusyChange?.(true); setError(''); setNotice('');
    const known = new Set(files.map(file => file.id));
    const failures: string[] = [];
    let updatedWorkspace: Workspace | undefined;
    try {
      for (const file of Array.from(chosen)) {
        try {
          const updated = await uploadAttachment(file, taskId, performanceId);
          updatedWorkspace = updated;
          const attachment = updated.attachments.filter(item => item.taskId === taskId && item.uploadedBy === user.id && item.name === file.name && item.size === file.size && !known.has(item.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
          if (!attachment) throw new Error('저장된 파일 정보를 확인하지 못했습니다.');
          known.add(attachment.id);
          setLocalFiles(updated.attachments.filter(item => item.taskId === taskId));
          if (latestIds.current.length < 30 || latestIds.current.includes(attachment.id)) {
            const ids = [...new Set([...latestIds.current, attachment.id])];
            latestIds.current = ids; changeRef.current?.(ids);
          } else failures.push(`${file.name}: 파일은 올렸지만 연결은 최대 30개까지 가능합니다. 기존 파일에서 다시 선택해 주세요.`);
        } catch (cause) { failures.push(`${file.name}: ${cause instanceof Error ? cause.message : '업로드하지 못했습니다.'}`); }
      }
      if (updatedWorkspace) {
        if (onWorkspace) onWorkspace(updatedWorkspace);
        else if (command && !await command('workspace.refresh', {})) failures.push('최신 파일 목록을 불러오지 못했습니다. 연결 상태를 확인한 뒤 다시 저장해 주세요.');
        setNotice('파일을 올렸습니다. 변경사항을 저장하면 연결이 완료됩니다.');
      }
      setError(failures.join('\n'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '파일 목록을 갱신하지 못했습니다.'); }
    finally { setBusy(false); onBusyChange?.(false); if (input.current) input.current.value = ''; }
  }

  if (!onChange && !selected.length) return null;
  return <section className="task-files" aria-labelledby={headingId} aria-busy={busy} data-read-label={label} data-read-value={selected.map(({ file }) => file?.name || '현재 열람 권한으로 확인할 수 없는 첨부파일').join('\n')}>
    <header><div><h4 id={headingId}><Paperclip size={16}/>{label}<span>{attachmentIds.length ? `${attachmentIds.length}개` : '선택'}</span></h4>{onChange && !disabled && <p>보고서, 서식, 사진 등 필요한 파일을 첨부하세요.</p>}</div>{canUpload && !disabled && <Button data-task-action="true" type="button" variant="secondary" disabled={blocked || attachmentIds.length >= 30} onClick={() => input.current?.click()}><Plus size={15}/>파일 추가</Button>}</header>
    {canUpload && <input ref={input} type="file" multiple hidden disabled={blocked} aria-label={`${label} 추가`} accept=".pdf,.docx,.xlsx,.xls,.pptx,.png,.jpg,.jpeg,.webp,.txt,.csv,.hwp,.hwpx" onChange={event => void upload(event.target.files)}/>}
    {!!selected.length && <ul className="task-files-list">{selected.map(({ id, file }) => <li key={id}><FileText size={18}/><div><strong>{file?.name || '첨부파일'}</strong><small>{file ? `${Math.max(1, Math.ceil(file.size / 1024)).toLocaleString('ko-KR')} KB${file.status === 'quarantined' ? ' · 다운로드 승인 대기' : ''}` : '현재 열람 권한으로 파일 정보를 확인할 수 없습니다.'}</small></div>{file?.status === 'test_allowed' && <a href={`/api/attachments/${encodeURIComponent(id)}`} className="task-files-download" aria-label={`${file.name} 다운로드`}><Download size={16}/><span>다운로드</span></a>}{file?.status === 'quarantined' && user.role === 'admin' && command && !disabled && <Button type="button" variant="ghost" disabled={blocked} onClick={async () => { setBusy(true); onBusyChange?.(true); setError(''); try { if (!await command('attachment.allowTest', { attachmentId: id, reason: '프로토타입 첨부 출처 확인' })) setError('파일 다운로드를 허용하지 못했습니다.'); } catch (cause) { setError(cause instanceof Error ? cause.message : '파일 다운로드를 허용하지 못했습니다.'); } finally { setBusy(false); onBusyChange?.(false); } }}>파일 허용</Button>}{onChange && !disabled && <button type="button" className="icon-btn" aria-label={`${file?.name || '파일'} 첨부 해제`} onClick={() => change(latestIds.current.filter(item => item !== id))}><X size={16}/></button>}</li>)}</ul>}
    {onChange && !selected.length && <p className="task-files-empty">첨부한 파일이 없습니다.</p>}
    {onChange && !disabled && available.length > 0 && <details className="task-files-existing"><summary>이 업무에 올린 파일에서 선택</summary><select aria-label={`${label} 기존 파일 선택`} disabled={attachmentIds.length >= 30} value="" onChange={event => { if (event.target.value) change([...new Set([...latestIds.current, event.target.value])]); }}><option value="">연결할 파일 선택</option>{available.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}</select></details>}
    {canUpload && !disabled && <small className="task-files-hint">파일당 10MB · 최대 30개 · PDF, 한글, Office, 이미지, 텍스트</small>}
    {busy && <p className="task-files-notice" role="status"><LoaderCircle size={15} className="spin"/>파일 처리 중…</p>}
    {!busy && notice && <p className="task-files-notice" role="status">{notice}</p>}
    {error && <p className="form-error task-files-error" role="alert">{error}</p>}
  </section>;
}

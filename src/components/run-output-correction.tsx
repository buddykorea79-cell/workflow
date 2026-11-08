'use client';

import { useState } from 'react';
import type { Run, StepExecution, Task, Workspace } from '@/lib/types';
import { formatDateTimeFull } from '@/lib/date-format';
import { Button, Field, type CommandFn } from './ui';
import { useRevisionCommand } from './command-revision';
import { useUnsavedChanges, useUnsavedNavigation } from './unsaved-changes';

export function RunOutputCorrectionForm(props: { workspace: Workspace; task: Task; run: Run; step: StepExecution; command: CommandFn; disabled: boolean }) {
  const [editing, setEditing] = useState(false);
  const { workspace: w, run, step } = props;
  const user = w.currentUser;
  const allowed = step.role === 'reviewer' ? user.id === run.reviewerId || user.role === 'admin' || user.role === 'head' && user.departmentId === run.departmentId : [run.primaryId, ...run.supportIds].includes(user.id);
  if (!allowed) return null;
  return editing ? <CorrectionEditor {...props} onClose={() => setEditing(false)}/> : <Button variant="secondary" disabled={props.disabled} onClick={() => setEditing(true)}>수행 결과 정정</Button>;
}

function CorrectionEditor({ workspace, run, step, command, disabled, onClose }: Parameters<typeof RunOutputCorrectionForm>[0] & { onClose: () => void }) {
  const [previousOutput] = useState(step.output ?? '');
  const [output, setOutput] = useState(previousOutput);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRevisionCommand(workspace, command, { kind: 'run', id: run.id });
  const { requestNavigation } = useUnsavedNavigation();
  useUnsavedChanges(output !== previousOutput || !!reason.trim(), '수행 결과 정정');
  return <section className="wc-output-correction" aria-label={`${step.title} 수행 결과 정정`}>
    <p>다음 회차를 시작하기 전까지 결과를 정정할 수 있습니다. 기존 결과와 정정 사유는 이력에 남고, 연결된 검토가 이미 완료되었다면 다시 검토를 요청합니다.</p>
    <Field label="정정할 수행 결과"><textarea rows={3} maxLength={5000} disabled={disabled || busy} value={output} onChange={event => setOutput(event.target.value)}/></Field>
    <Field label="정정 사유"><textarea rows={2} maxLength={1000} disabled={disabled || busy} value={reason} onChange={event => setReason(event.target.value)}/></Field>
    {revision.conflict}{error && <p role="alert">{error}</p>}
    <div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => requestNavigation(onClose)}>취소</Button><Button disabled={disabled || busy || revision.conflicted || !output.trim() || !reason.trim() || output.trim() === previousOutput} onClick={async () => {
      setBusy(true); setError('');
      try { if (await revision.command('run.correctOutput', { runId: run.id, stepId: step.stepId, previousOutput, output: output.trim(), reason: reason.trim() })) onClose(); else setError('정정을 저장하지 못했습니다. 최신 결과와 안내를 확인해 주세요.'); }
      catch { setError('정정을 저장하지 못했습니다. 입력한 내용은 유지됩니다.'); }
      finally { setBusy(false); }
    }}>{busy ? '정정 저장 중…' : '정정 저장'}</Button></div>
  </section>;
}

export function RunOutputCorrectionHistory({ workspace, run }: { workspace: Workspace; run: Run }) {
  if (!run.outputCorrections?.length) return null;
  const name = (id: string) => workspace.users.find(user => user.id === id)?.name ?? workspace.identities?.find(user => user.id === id)?.name ?? '기록된 담당자';
  return <details className="wc-correction-history"><summary>수행 결과 정정 이력 · {run.outputCorrections.length}건</summary>{run.outputCorrections.map(change => <article key={change.id}>
    <strong>{change.stepTitle}</strong><small>{name(change.correctedBy)} · {formatDateTimeFull(change.correctedAt)}</small>
    <dl><dt>정정 전</dt><dd>{change.previousOutput || '기록 없음'}</dd><dt>정정 후</dt><dd>{change.output}</dd><dt>사유</dt><dd>{change.reason}</dd></dl>
    {change.previousRunCompletedAt && <p>정정 전 회차 완료: {formatDateTimeFull(change.previousRunCompletedAt)}</p>}
    {!!change.reopenedReviews.length && <details><summary>다시 요청한 검토 · {change.reopenedReviews.map(review => review.title).join(', ')}</summary>{change.reopenedReviews.map(review => <p key={review.stepId}>{review.title}: {review.output || '기록 없음'} · {name(review.completedBy ?? '')} · {formatDateTimeFull(review.completedAt)}</p>)}</details>}
  </article>)}</details>;
}

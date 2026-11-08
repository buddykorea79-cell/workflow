'use client';

import { useEffect, useRef, useState } from 'react';
import { targetEntity, targetRevision, type CommandExpectation, type CommandTarget } from '@/lib/command-targets';
import { revisionKey } from '@/lib/command-revisions';
import { formatDateFull } from '@/lib/date-format';
import type { Workspace } from '@/lib/types';
import type { BudgetCatalog } from '@/lib/budget-types';
import { Button, type CommandFn } from './ui';

type RevisionWorkspace = Workspace & { budgetCatalog?: BudgetCatalog };

function latestContent(workspace: RevisionWorkspace, target: CommandTarget) {
  const value = targetEntity(workspace, target);
  const records = Array.isArray(value) ? value : value ? [value] : [];
  const labels: Record<string, string> = { title: '이름', name: '이름', description: '내용', summary: '요약', dueDate: '업무 또는 회차 마감', startDate: '회차 시작', scheduleDetails: '일정 메모', period: '기간', reason: '사유', comment: '평가 의견', score: '점수', instructedOn: '지시일', projectName: '사업명', confirmedAmountWon: '확정 예산', team: '팀', email: '이메일', phone: '전화번호' };
  const rows: { label: string; content: string }[] = [];
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const item = record as Record<string, unknown>;
    for (const [key, label] of Object.entries(labels)) {
      if (typeof item[key] === 'string' || typeof item[key] === 'number') rows.push({ label, content: ['dueDate', 'startDate', 'instructedOn'].includes(key) ? formatDateFull(String(item[key])) : String(item[key]) || '미입력' });
    }
    if (Array.isArray(item.workflowSnapshot || item.workflow)) {
      const workflow = (item.workflowSnapshot || item.workflow) as { title: string; description?: string; startDate?: string; dueDate?: string; scheduleDetails?: string }[];
      rows.push({ label: '절차와 일정', content: workflow.map((step, index) => `${index + 1}. ${step.title}\n${step.description || ''}\n${[step.startDate, step.dueDate].filter(Boolean).map(value => formatDateFull(value)).join(' ~ ')}\n${step.scheduleDetails || ''}`).join('\n\n') });
    }
    if (Array.isArray(item.allocations)) rows.push({ label: '단위업무별 비중', content: (item.allocations as { unitId: string; maxScore: number }[]).map(allocation => `${workspace.units.find(unit => unit.id === allocation.unitId)?.title || '단위업무'}: ${allocation.maxScore}`).join('\n') });
    if (Array.isArray(item.attachmentIds)) rows.push({ label: '참고 파일', content: (item.attachmentIds as string[]).map(id => workspace.attachments.find(file => file.id === id)?.name || '첨부 파일').join('\n') || '없음' });
    if (Array.isArray(item.descriptionAttachmentIds)) rows.push({ label: '업무 설명 파일', content: (item.descriptionAttachmentIds as string[]).map(id => workspace.attachments.find(file => file.id === id)?.name || '첨부 파일').join('\n') || '없음' });
    if (Array.isArray(item.expenses)) rows.push({ label: '집행 내역', content: (item.expenses as { date: string; description: string; vendor?: string; amount: number }[]).map(expense => `${formatDateFull(expense.date)} · ${expense.description} · ${expense.vendor || ''} · ${expense.amount.toLocaleString('ko-KR')}원`).join('\n') || '없음' });
    if (Array.isArray(item.references)) rows.push({ label: '참고자료', content: (item.references as { title: string; content: string; url?: string; attachmentId?: string }[]).map(reference => `${reference.title}\n${reference.content}\n${reference.url || ''}${reference.attachmentId ? `\n${workspace.attachments.find(file => file.id === reference.attachmentId)?.name || '첨부 파일'}` : ''}`).join('\n\n') || '없음' });
    if (Array.isArray(item.requiredSteps)) rows.push({ label: '필수 절차', content: item.requiredSteps.join('\n') || '없음' });
    if (Array.isArray(item.departmentIds)) rows.push({ label: '대상 부서', content: (item.departmentIds as string[]).map(id => workspace.departments.find(department => department.id === id)?.name || '부서 정보 확인 필요').join('\n') || '없음' });
    if (typeof item.departmentId === 'string') rows.push({ label: '소속 부서', content: workspace.departments.find(department => department.id === item.departmentId)?.name || '부서 정보 확인 필요' });
    if (typeof item.role === 'string') rows.push({ label: '역할', content: ({ admin: '관리자', head: '부서장', manager: '부서 담당자', lead: '팀장', member: '업무 담당자' } as Record<string, string>)[item.role] || '역할 확인 필요' });
    if (typeof item.active === 'boolean') rows.push({ label: '사용 상태', content: item.active ? '사용' : '중지' });
    if (typeof item.directiveIssuer === 'string') rows.push({ label: '지시자', content: ({ minister: '장관', vice_minister: '차관', office_head: '실장', bureau_head: '국장' } as Record<string, string>)[item.directiveIssuer] || '지시자 확인 필요' });
    if (Array.isArray(item.distributions)) {
      for (const distribution of item.distributions as { departmentId: string; monthlyReports?: { month: string; achievements: string; nextPlan: string; issues?: string }[] }[]) {
        for (const report of distribution.monthlyReports || []) rows.push({ label: `${workspace.departments.find(department => department.id === distribution.departmentId)?.name || '부서'} · ${report.month} 실적`, content: `성과: ${report.achievements}\n다음 계획: ${report.nextPlan || '없음'}\n현안: ${report.issues || '없음'}` });
      }
    }
    if (target.kind === 'budgetCatalog' && Array.isArray(item.items)) rows.push({ label: '최신 원장', content: `예산 ${item.items.length}건 · 변경 버전 ${item.rev || 0}` });
  }
  return { exists: records.length > 0, rows };
}

/** A form owns its initial revision until a successful save or explicit conflict review. */
export function useRevisionCommand(workspace: RevisionWorkspace, command: CommandFn, target: CommandTarget | null) {
  const key = target ? revisionKey(target) : '';
  const draft = useRef<{ key: string; expected: CommandExpectation | null; conflict: Workspace | null; generation: number }>({ key, expected: target ? { ...target, rev: targetRevision(workspace, target) } : null, conflict: null, generation: 0 });
  if (draft.current.key !== key) draft.current = { key, expected: target ? { ...target, rev: targetRevision(workspace, target) } : null, conflict: null, generation: draft.current.generation + 1 };
  const [, render] = useState(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const guardedCommand: CommandFn = async (type, payload, options) => {
    const owner = draft.current;
    if (owner.conflict) return false;
    return command(type, payload, {
      ...options,
      expected: options?.expected === undefined ? owner.expected : options.expected,
      onSaved: updated => {
        if (!mounted.current || draft.current !== owner) return;
        if (owner.expected) {
          const savedTarget = updated.commandChanges?.find(change => revisionKey(change) === revisionKey(owner.expected!));
          owner.expected = { ...owner.expected, rev: savedTarget?.toRev ?? owner.expected.rev };
        }
        owner.conflict = null; render(value => value + 1);
        options?.onSaved?.(updated);
      },
      onConflict: updated => {
        if (!mounted.current || draft.current !== owner) return;
        owner.conflict = updated; render(value => value + 1);
        options?.onConflict?.(updated);
      },
    });
  };
  const latest = draft.current.conflict;
  const content = latest && target ? latestContent(latest, target) : null;
  const conflict = latest && target && content ? <section className="form-error" role="alert" aria-label="최신 내용과 다른 부분">
    <strong>다른 사용자가 먼저 수정했습니다. 작성 중인 내용은 유지했습니다.</strong>
    <p>서버의 최신 내용과 입력창의 내 변경 내용을 비교해 주세요. 확인한 뒤 저장하면 내 변경 내용이 반영됩니다.</p>
    <details><summary>서버 최신 내용 보기</summary>{content.exists ? <dl>{content.rows.length ? content.rows.map((row, index) => <div key={index}><dt>{row.label}</dt><dd style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.content}</dd></div>) : <p>상태 또는 관련 기록이 변경되었습니다. 최신 목록을 확인해 주세요.</p>}</dl> : <p>이 항목을 더 이상 조회할 수 없습니다. 창을 닫고 목록에서 상태와 권한을 확인해 주세요.</p>}</details>
    <Button variant="secondary" disabled={!content.exists} onClick={() => {
      const current = draft.current;
      if (!current.conflict || !current.expected) return;
      current.expected = { ...current.expected, rev: targetRevision(current.conflict, current.expected) };
      current.conflict = null; render(value => value + 1);
    }}>최신 내용 확인 · 내 변경 유지</Button>
  </section> : null;
  return { command: guardedCommand, conflict, conflicted: !!latest };
}

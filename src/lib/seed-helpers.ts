import { dueDateForPeriod } from './schedule';
import { shiftCycleDate } from './work-cycles';
import type { Card, Task, TaskVersion, WorkflowStep, Run } from './types';

export function koreaDate(date = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
export function offsetDate(days: number, date = new Date()) { const d = new Date(`${koreaDate(date)}T12:00:00+09:00`); d.setUTCDate(d.getUTCDate() + days); return koreaDate(d); }
export function defaultCard(purpose = ''): Card { return { purpose, stakeholders: '기획재정담당관실 · 데이터정보화담당관실 · 혁신행정담당관실', evidence: '연결된 업무 매뉴얼의 해당 절차를 확인합니다.', responsibility: '정담당 수행 · 부담당 지원 · 총괄 검토', procedure: '자료 준비 → 내용 검증 → 내부 검토 → 최종 제출', finance: '해당 없음', documents: '검토 자료, 결과 보고서', issues: '자료 누락 시 담당 부서에 보완을 요청합니다.', handover: '현재 회차의 미완료 단계와 다음 마감일을 확인합니다.' }; }
export function defaultWorkflow(): WorkflowStep[] { return [
  { id: 's1', title: '자료 준비', role: 'support', description: '필요한 기초 자료와 제출 양식을 수집합니다.', output: '기초 자료 목록', required: true, dependsOn: [], checklist: ['대상 기간과 제출 양식 확인', '필수 자료 수집'] },
  { id: 's2', title: '내용 검증', role: 'primary', description: '누락과 오류를 점검하고 증빙을 대조합니다.', output: '검증 결과', required: true, dependsOn: ['s1'], checklist: ['자료 간 수치 및 내용 대조', '누락·오류 확인'] },
  { id: 's3', title: '내부 검토', role: 'reviewer', description: '총괄 담당자가 완료 기준과 결과를 검토합니다.', output: '검토 의견', required: true, dependsOn: ['s2'], checklist: ['기준 준수 여부 검토', '보완 사항 해소 확인'] },
  { id: 's4', title: '최종 제출', role: 'primary', description: '확인된 최종본을 제출하고 다음 회차의 유의사항을 남깁니다.', output: '최종 결과 보고서', required: true, dependsOn: ['s3'], checklist: ['최종 결과물 확인', '제출 및 접수 확인'] },
]; }
export function commonWorkflow(requiredSteps: string[]): WorkflowStep[] {
  const workflow: WorkflowStep[] = requiredSteps.map((title, index) => ({
    id: `s${index + 1}`, title, role: /검토|승인/.test(title) ? 'reviewer' : index === 0 ? 'support' : 'primary',
    description: `${title}의 공통 필수 기준을 확인하고 처리합니다.`, output: `${title} 결과`, required: true,
    dependsOn: index > 0 ? [`s${index}`] : [], checklist: [`${title} 완료 조건 확인`],
  }));
  if (!workflow.some(step => step.role === 'reviewer')) workflow.push({ id: `s${workflow.length + 1}`, title: '결과 검토', role: 'reviewer', description: '공통업무의 모든 필수 결과를 검토합니다.', output: '검토 의견', required: true, dependsOn: workflow.length ? [workflow.at(-1)!.id] : [], checklist: ['공통 필수 기준 준수 확인'] });
  return workflow;
}
export function snapshot(task: Task, confirmedBy?: string, now = new Date().toISOString()): TaskVersion { return { version: task.version, title: task.title, description: task.description, ...(task.descriptionAttachmentIds ? { descriptionAttachmentIds: [...task.descriptionAttachmentIds] } : {}), completionCriteria: task.completionCriteria, card: structuredClone(task.card), workflow: structuredClone(task.workflow), sourceIds: [...task.sourceIds], primaryId: task.primaryId, supportIds: [...task.supportIds], reviewerId: task.reviewerId, departmentId: task.departmentId, unitId: task.unitId, frequency: task.frequency, dueDate: task.dueDate, confirmedAt: now, confirmedBy, budget: task.budget, budgetMode: task.budgetMode, budgetAllocation: task.budgetAllocation ? structuredClone(task.budgetAllocation) : undefined, expenses: structuredClone(task.expenses ?? []), references: structuredClone(task.references ?? []) }; }
export function createRun(task: Task, period: string, now = new Date().toISOString()): Run {
  const active = task.versions.at(-1);
  const templateDueDate = active?.dueDate ?? task.dueDate;
  const dueDate = dueDateForPeriod(active?.frequency ?? task.frequency, period, templateDueDate);
  const delta = (Date.parse(dueDate) - Date.parse(templateDueDate)) / 86_400_000;
  const workflow = structuredClone(active?.workflow ?? task.workflow).map(({ done: _done, ...step }) => ({ ...step, startDate: shiftCycleDate(step.startDate, delta), dueDate: shiftCycleDate(step.dueDate, delta), done: false }));
  return { id: `run-${task.id}-${period}`, taskId: task.id, title: `${active?.title ?? task.title} · ${period}`, period, definitionVersion: active?.version ?? task.version, departmentId: active?.departmentId ?? task.departmentId, primaryId: active?.primaryId ?? task.primaryId, supportIds: [...(active?.supportIds ?? task.supportIds)], reviewerId: active?.reviewerId ?? task.reviewerId, status: 'in_progress', dueDate, startedAt: now, workflowSnapshot: workflow, steps: workflow.map((step, i) => ({ id: `exec-${step.id}`, stepId: step.id, title: step.title, role: step.role, status: i === 0 ? 'in_progress' : 'pending', checklist: step.checklist.map((title, j) => ({ id: `${step.id}-c${j + 1}`, title, done: false })) })), notes: [] };
}

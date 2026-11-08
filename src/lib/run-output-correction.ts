import { randomUUID } from 'node:crypto';
import { DomainError } from './domain-error';
import type { Run, WorkflowStep } from './types';

/** Correct a result without losing the original or treating an earlier approval as approval of the new text. */
export function correctRunOutput(run: Run, workflow: WorkflowStep[], stepId: string, output: string, reason: string, actorId: string, now: Date) {
  const step = run.steps.find(item => item.stepId === stepId);
  if (!step || step.status !== 'completed') throw new DomainError(409, 'CORRECTION_NOT_COMPLETED', '완료된 절차의 수행 결과만 정정할 수 있습니다.');
  if (step.output === output) throw new DomainError(422, 'CORRECTION_UNCHANGED', '기존 수행 결과와 다른 내용을 입력해 주세요.');
  const affected = new Set([stepId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of workflow) if (!affected.has(node.id) && node.dependsOn.some(id => affected.has(id))) { affected.add(node.id); changed = true; }
  }
  const reviews = run.steps.filter(item => item.stepId !== stepId && affected.has(item.stepId) && item.role === 'reviewer' && item.status === 'completed');
  run.outputCorrections = [...(run.outputCorrections ?? []), {
    id: `correction-${randomUUID()}`, stepId, stepTitle: step.title, previousOutput: step.output ?? '', output, reason,
    correctedBy: actorId, correctedAt: now.toISOString(), reopenedReviews: structuredClone(reviews),
    previousRunStatus: run.status, previousRunCompletedAt: run.completedAt,
  }];
  step.output = output;
  for (const review of reviews) {
    review.status = 'pending'; review.output = undefined; review.completedAt = undefined; review.completedBy = undefined;
    review.checklist = review.checklist.map(item => ({ id: item.id, title: item.title, done: false }));
  }
  if (reviews.length) { run.status = 'review'; run.completedAt = undefined; }
  run.updatedAt = now.toISOString();
  return reviews.map(item => item.stepId);
}

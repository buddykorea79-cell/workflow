import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { procedureScheduleConflicts } from '../src/lib/procedure-schedule';
import { appendProcedureStep } from '../src/lib/procedure-order';
import { DomainError, executeCommand } from '../src/lib/domain';
import { createSeed } from '../src/lib/seed';
import type { WorkflowStep } from '../src/lib/types';

const now = new Date('2026-11-07T03:00:00Z');
const workflow = (): WorkflowStep[] => ['a', 'b', 'c', 'review'].map((id, index) => ({ id, title: id, role: id === 'review' ? 'reviewer' : 'primary', description: '수행 방법', output: '', required: true, checklist: [], dependsOn: index ? [['a', 'b', 'c'][index - 1]] : [] }));
const schedules = () => [{ stepId: 'a', dueDate: '2026-11-10' }, { stepId: 'b' }, { stepId: 'c', startDate: '2026-11-05' }, { stepId: 'review', dueDate: '2026-11-20' }];

test('schedule checks follow every prerequisite across undated intermediate procedures', () => {
  assert.deepEqual(procedureScheduleConflicts(workflow(), schedules()), [{ stepId: 'c', prerequisiteId: 'a' }]);
  assert.deepEqual(procedureScheduleConflicts(workflow(), schedules().map(step => step.stepId === 'c' ? { ...step, startDate: '2026-11-10' } : step)), []);
  const parallel = workflow().map(step => step.id === 'c' ? { ...step, dependsOn: [] } : step);
  assert.deepEqual(procedureScheduleConflicts(parallel, schedules()), []);
  const cycle = [{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }];
  assert.doesNotThrow(() => procedureScheduleConflicts(cycle, [{ stepId: 'a', startDate: '2026-11-01' }]));
});

test('adding a manual step preserves parallel dates and completed history', () => {
  const steps = workflow().map(step => ({ ...step, ...schedules().find(item => item.stepId === step.id), dependsOn: [] as string[], scheduleDetails: `${step.id} 일정 메모` }));
  steps[0].done = true;
  const change = appendProcedureStep(steps, { ...workflow()[0], id: 'followup', title: '후속' });
  assert.deepEqual(change.clearedScheduleIds, []);
  assert.deepEqual(change.workflow[0], steps[0]);
  assert.equal(change.workflow.find(step => step.id === 'c')!.startDate, '2026-11-05');
  assert.equal(change.workflow.find(step => step.id === 'c')!.scheduleDetails, 'c 일정 메모');
  assert.equal(change.workflow.find(step => step.id === 'review')!.dueDate, '2026-11-20');
  assert.deepEqual(change.workflow.slice(0, 4).map(step => step.dependsOn), [[], [], [], []]);
});

test('the server rejects a transitive schedule conflict without changing an occurrence', () => {
  const state = createSeed(now);
  const send = (type: string, payload: Record<string, unknown>) => executeCommand(state, 'u-seoyeon', { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, now);
  send('task.create', { title: '선행 일정 검증', description: '간접 선행 날짜 확인', unitId: 'unit-record', primaryId: 'u-seoyeon', supportIds: [], dueDate: '2026-11-30', frequency: 'monthly', workflow: workflow() });
  const input = { taskId: state.tasks[0].id, startDate: '2026-11-05', dueDate: '2026-11-20', steps: schedules() };
  const before = structuredClone(state);
  assert.throws(() => send('run.schedule', input), error => error instanceof DomainError && error.code === 'CYCLE_DEPENDENCY_DATE');
  assert.deepEqual(state, before);
  send('run.schedule', { ...input, steps: schedules().map(step => step.stepId === 'c' ? { ...step, startDate: '2026-11-10' } : step) });
  assert.ok(state.runs.some(run => run.taskId === input.taskId));
});

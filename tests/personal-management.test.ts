import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace, reconcileDueHandovers } from '../src/lib/domain';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-10-31T03:00:00Z');
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>, requestId = randomUUID()) {
  const candidate = structuredClone(state);
  executeCommand(candidate, actor, { type, payload, expectedRevision: state.revision, requestId }, now);
  Object.assign(state, candidate);
}
function rejects(code: string, action: () => void) { assert.throws(action, e => e instanceof DomainError && e.code === code); }
function makeUnit(state: WorkspaceData, title = '내 단위업무') {
  dispatch(state, 'u-jiho', 'unit.create', { title, description: '개인이 관리하는 상위 업무' }); return state.units.at(-1)!;
}
function makeTask(state: WorkspaceData, unitId: string) {
  dispatch(state, 'u-jiho', 'task.create', { title: '내 세부업무', description: '단위업무 아래에 등록하는 하위 업무', unitId, primaryId: 'u-jiho', reviewerId: 'u-head', dueDate: '2026-11-30', frequency: 'once', budget: 100000 }); return state.tasks[0];
}

test('personal management: only a unit owner or admin can rename, delete, and restore it', () => {
  const state = createSeed(now); const unit = makeUnit(state);
  for (const actor of ['u-seoyeon', 'u-minseo']) rejects('UNIT_ACCESS_DENIED', () => dispatch(state, actor, 'unit.update', { unitId: unit.id, title: '타인 변경', description: '권한 없음' }));
  rejects('HEAD_DEFINITION_DENIED', () => dispatch(state, 'u-head', 'unit.update', { unitId: unit.id, title: '타인 변경', description: '부서장도 직접 정의를 변경하지 않음' }));
  dispatch(state, 'u-jiho', 'unit.update', { unitId: unit.id, title: '개선한 단위업무', description: '범위와 목적 보완' });
  assert.equal(state.units.find(u => u.id === unit.id)!.title, '개선한 단위업무');
  rejects('UNIT_ACCESS_DENIED', () => dispatch(state, 'u-minseo', 'unit.delete', { unitId: unit.id }));
  dispatch(state, 'u-admin', 'unit.delete', { unitId: unit.id });
  assert.ok(state.units.find(u => u.id === unit.id)!.deletedAt);
  rejects('UNIT_ACCESS_DENIED', () => dispatch(state, 'u-seoyeon', 'unit.restore', { unitId: unit.id }));
  dispatch(state, 'u-jiho', 'unit.restore', { unitId: unit.id });
  assert.equal(state.units.find(u => u.id === unit.id)!.deletedAt, undefined);
  assert.ok(state.audit.some(event => event.action === 'unit.restore' && event.targetId === unit.id));
});

test('personal management: unit names are unique among one owner’s active units and safe on restore', () => {
  const state = createSeed(now); const first = makeUnit(state, '월간 관리'); const second = makeUnit(state, '주간 관리');
  rejects('DUPLICATE_UNIT', () => dispatch(state, 'u-jiho', 'unit.update', { unitId: second.id, title: first.title, description: '중복' }));
  dispatch(state, 'u-seoyeon', 'unit.create', { title: first.title, description: '다른 개인은 동일한 이름을 쓸 수 있습니다.' });
  dispatch(state, 'u-jiho', 'unit.delete', { unitId: first.id });
  const replacement = makeUnit(state, first.title);
  rejects('DUPLICATE_UNIT', () => dispatch(state, 'u-jiho', 'unit.restore', { unitId: first.id }));
  dispatch(state, 'u-jiho', 'unit.update', { unitId: replacement.id, title: '새 월간 관리', description: '중복 이름 해소' });
  dispatch(state, 'u-jiho', 'unit.restore', { unitId: first.id });
  assert.equal(state.units.find(u => u.id === first.id)!.deletedAt, undefined);
});

test('personal management: moving active detail enables safe parent deletion and preserves old snapshots', () => {
  const state = createSeed(now); const original = makeUnit(state); const target = makeUnit(state, '이동 대상'); const task = makeTask(state, original.id);
  rejects('UNIT_NOT_EMPTY', () => dispatch(state, 'u-jiho', 'unit.delete', { unitId: original.id }));
  dispatch(state, 'u-jiho', 'task.configure', { taskId: task.id, unitId: target.id });
  const saved = state.tasks.find(t => t.id === task.id)!;
  assert.equal(saved.unitId, target.id); assert.equal(saved.versions[0].unitId, original.id); assert.equal(saved.versions.at(-1)!.unitId, target.id);
  dispatch(state, 'u-jiho', 'unit.delete', { unitId: original.id });
  assert.ok(getWorkspace(state, 'u-jiho', now).units.find(u => u.id === original.id)!.deletedAt);
  rejects('UNIT_DELETED', () => makeTask(state, original.id));
  rejects('UNIT_DELETED', () => dispatch(state, 'u-jiho', 'task.configure', { taskId: task.id, unitId: original.id }));
});

test('personal management: personal creation and parent changes cannot target someone else’s unit', () => {
  const state = createSeed(now); const unit = makeUnit(state); const task = makeTask(state, unit.id);
  rejects('UNIT_OWNER_REQUIRED', () => makeTask(state, 'unit-budget'));
  rejects('UNIT_OWNER_REQUIRED', () => dispatch(state, 'u-jiho', 'task.configure', { taskId: task.id, unitId: 'unit-budget' }));
  rejects('UNIT_OWNER_REQUIRED', () => dispatch(state, 'u-jiho', 'task.update', { taskId: task.id, unitId: 'unit-budget' }));
  rejects('TASK_OWNER_REQUIRED', () => dispatch(state, 'u-minseo', 'task.configure', { taskId: task.id, unitId: 'unit-budget' }));
  dispatch(state, 'u-admin', 'task.configure', { taskId: task.id, unitId: 'unit-budget' });
  assert.equal(state.tasks.find(t => t.id === task.id)!.unitId, 'unit-budget');
});

test('personal management: legacy shared-unit assignments remain readable and move to an owned unit', () => {
  const state = createSeed(now); const unit = makeUnit(state);
  const original = state.tasks.find(t => t.id === 'task-contract')!; assert.equal(original.primaryId, 'u-jiho'); assert.equal(original.unitId, 'unit-budget');
  dispatch(state, 'u-jiho', 'task.configure', { taskId: original.id, unitId: unit.id });
  assert.equal(state.tasks.find(t => t.id === original.id)!.unitId, unit.id);
  assert.equal(state.tasks.find(t => t.id === original.id)!.versions[0].unitId, 'unit-budget');
  assert.ok(getWorkspace(state, 'u-jiho', now).tasks.some(t => t.id === original.id));
});

test('personal management: soft delete preserves execution, evidence, performance, and trash visibility', () => {
  const state = createSeed(now); const original = state.tasks.find(t => t.id === 'task-contract')!;
  const runId = state.runs.find(r => r.taskId === original.id)!.id;
  dispatch(state, 'u-jiho', 'performance.submitHalf', { taskId: original.id, period: '2026-H2', title: '계약 관리 성과', description: '이행 사항 확인', evidence: '계약 검토 기록' });
  const preserved = JSON.stringify({ runs: state.runs, performances: state.performances, sources: state.sources, attachments: state.attachments, workflow: original.workflow, versions: original.versions });
  dispatch(state, 'u-jiho', 'task.delete', { taskId: original.id });
  const deleted = state.tasks.find(t => t.id === original.id)!; assert.ok(deleted.deletedAt); assert.equal(deleted.status, 'archived'); assert.equal(deleted.deletedFromStatus, 'confirmed');
  assert.equal(JSON.stringify({ runs: state.runs, performances: state.performances, sources: state.sources, attachments: state.attachments, workflow: deleted.workflow, versions: deleted.versions }), preserved);
  assert.ok(getWorkspace(state, 'u-jiho', now).tasks.find(t => t.id === original.id)!.deletedAt);
  assert.equal(getWorkspace(state, 'u-doyun', now).tasks.some(t => t.id === original.id), false);
  rejects('TASK_DELETED', () => dispatch(state, 'u-jiho', 'run.note', { runId, body: '삭제된 업무에 기록 우회' }));
  rejects('TASK_DELETED', () => dispatch(state, 'u-head', 'performance.evaluate', { performanceId: state.performances[0].id, score: 90, comment: '삭제 상태 평가 우회', decision: 'confirmed' }));
  dispatch(state, 'u-jiho', 'task.restore', { taskId: original.id });
  assert.equal(state.tasks.find(t => t.id === original.id)!.status, 'confirmed');
  assert.equal(state.tasks.find(t => t.id === original.id)!.unitId, 'unit-budget');
  dispatch(state, 'u-jiho', 'performance.saveHalf', { taskId: original.id, period: '2026-H2', title: '계약 관리 성과', description: '복원 후 성과 보완', evidence: '계약 검토 기록' });
  assert.equal(state.performances[0].description, '복원 후 성과 보완');
});

test('personal management: deleted details reject every ordinary write path and require explicit restore', () => {
  const state = createSeed(now); const unit = makeUnit(state); const task = makeTask(state, unit.id);
  dispatch(state, 'u-jiho', 'task.delete', { taskId: task.id });
  const commands: [string, Record<string, unknown>][] = [
    ['task.configure', { description: '변경' }], ['task.update', { title: '변경' }], ['task.submit', {}], ['task.archive', {}],
    ['task.setProgress', { stepId: 's1', done: true }], ['run.create', {}],
    ['performance.submitHalf', { period: '2026-H2', title: '성과', description: '설명', evidence: '증빙' }],
    ['delegation.create', { toId: 'u-seoyeon', startsAt: now.toISOString(), endsAt: '2027-01-01T00:00:00Z', actions: ['run.note'] }],
  ];
  for (const [type, payload] of commands) rejects('TASK_DELETED', () => dispatch(state, 'u-jiho', type, { taskId: task.id, ...payload }));
  rejects('TASK_DELETED', () => dispatch(state, 'u-jiho', 'handover.create', { taskIds: [task.id], runIds: [], toId: 'u-seoyeon', effectiveAt: now.toISOString(), summary: '삭제된 업무 인계', pendingItems: '없음', nextAction: '없음' }));
  rejects('TASK_OWNER_REQUIRED', () => dispatch(state, 'u-minseo', 'task.restore', { taskId: task.id }));
  dispatch(state, 'u-admin', 'task.restore', { taskId: task.id });
  assert.equal(state.tasks.find(t => t.id === task.id)!.status, 'draft');
});

test('personal management: restoring into a new owned parent handles a deleted original parent safely', () => {
  const state = createSeed(now); const original = makeUnit(state); const target = makeUnit(state, '복원 대상'); const task = makeTask(state, original.id);
  dispatch(state, 'u-jiho', 'task.delete', { taskId: task.id }); dispatch(state, 'u-jiho', 'unit.delete', { unitId: original.id });
  rejects('UNIT_DELETED', () => dispatch(state, 'u-jiho', 'task.restore', { taskId: task.id }));
  rejects('UNIT_OWNER_REQUIRED', () => dispatch(state, 'u-jiho', 'task.restore', { taskId: task.id, unitId: 'unit-budget' }));
  dispatch(state, 'u-jiho', 'task.restore', { taskId: task.id, unitId: target.id });
  const restored = state.tasks.find(t => t.id === task.id)!;
  assert.equal(restored.unitId, target.id); assert.equal(restored.status, 'draft'); assert.equal(restored.deletedAt, undefined); assert.equal(restored.deletedFromStatus, undefined);
  assert.equal(restored.versions.length, 0); assert.equal(restored.version, task.version);
  assert.ok(state.audit.some(event => event.action === 'task.restore' && event.detail.includes(`${original.title} → ${target.title}`)));
});

test('personal management: restoring a revised task into another parent preserves the current execution definition', () => {
  const state = createSeed(now); const unit = makeUnit(state, '복원 후 계약 관리'); const taskId = 'task-contract';
  const originalRun = structuredClone(state.runs.find(run => run.taskId === taskId)!);
  dispatch(state, 'u-admin', 'task.revise', { taskId, reason: '차기 절차 초안 작성' });
  const workflow = structuredClone(state.tasks.find(task => task.id === taskId)!.workflow);
  workflow[1].id = 'replacement-step'; workflow[2].dependsOn = ['replacement-step'];
  dispatch(state, 'u-jiho', 'task.update', { taskId, workflow });
  const versions = structuredClone(state.tasks.find(task => task.id === taskId)!.versions);
  dispatch(state, 'u-jiho', 'task.delete', { taskId }); dispatch(state, 'u-jiho', 'task.restore', { taskId, unitId: unit.id });
  const restored = state.tasks.find(task => task.id === taskId)!;
  assert.equal(restored.status, 'revision'); assert.deepEqual(restored.versions, versions);
  assert.deepEqual(state.runs.find(run => run.id === originalRun.id), originalRun);
  const step = originalRun.steps.find(item => item.stepId === 's2')!;
  dispatch(state, 'u-jiho', 'run.check', { runId: originalRun.id, stepId: step.id, checkId: step.checklist[0].id, done: true });
  dispatch(state, 'u-jiho', 'run.create', { taskId, period: '2026-12' });
  assert.equal(state.runs[0].definitionVersion, versions.at(-1)!.version);
  assert.ok(state.runs[0].steps.some(item => item.stepId === 's2'));
  assert.equal(state.runs[0].steps.some(item => item.stepId === 'replacement-step'), false);
});

test('personal management: previously archived records restore to archived and archived-only parents may be deleted', () => {
  const state = createSeed(now); const unit = makeUnit(state); const task = makeTask(state, unit.id);
  dispatch(state, 'u-admin', 'task.archive', { taskId: task.id });
  dispatch(state, 'u-jiho', 'task.delete', { taskId: task.id });
  dispatch(state, 'u-jiho', 'task.restore', { taskId: task.id });
  assert.equal(state.tasks.find(t => t.id === task.id)!.status, 'archived');
  dispatch(state, 'u-jiho', 'unit.delete', { unitId: unit.id });
  assert.ok(state.units.find(u => u.id === unit.id)!.deletedAt);
  rejects('UNIT_DELETED', () => dispatch(state, 'u-jiho', 'task.update', { taskId: task.id, title: '삭제된 부모에서 수정' }));
});

test('personal management: common detail cannot be deleted but registered detail can move to its own active parent', () => {
  const state = createSeed(now);
  for (const actor of ['u-minseo', 'u-admin']) rejects('COMMON_TASK_DELETE_DENIED', () => dispatch(state, actor, 'task.delete', { taskId: 'task-budget' }));
  dispatch(state, 'u-minseo', 'unit.create', { title: '공통업무 관리', description: '내 공통 세부업무 분류' }); const unitId = state.units.at(-1)!.id;
  dispatch(state, 'u-minseo', 'task.configure', { taskId: 'task-budget', unitId });
  assert.equal(state.tasks.find(t => t.id === 'task-budget')!.unitId, unitId);
  assert.equal(state.commonTasks.find(c => c.id === 'common-budget')!.distributions[0].taskId, 'task-budget');
  rejects('COMMON_STANDARD_LOCKED', () => dispatch(state, 'u-minseo', 'task.configure', { taskId: 'task-budget', title: '중앙 기준 변경' }));
});

test('personal management: common registration excludes another owner’s unit and deleted units', () => {
  const state = createSeed(now); const ref = { commonId: 'common-security', distributionId: 'dist-security-support' };
  rejects('UNIT_OWNER_REQUIRED', () => dispatch(state, 'u-support-member', 'common.register', { ...ref, unitId: 'unit-support' }));
  dispatch(state, 'u-support-member', 'unit.create', { title: '보안 점검', description: '점검 업무 관리' }); const unitId = state.units.at(-1)!.id;
  dispatch(state, 'u-support-member', 'unit.delete', { unitId });
  rejects('UNIT_DELETED', () => dispatch(state, 'u-support-member', 'common.register', { ...ref, unitId }));
  dispatch(state, 'u-support-member', 'unit.restore', { unitId });
  dispatch(state, 'u-support-member', 'common.register', { ...ref, unitId });
  assert.equal(state.tasks[0].unitId, unitId);
});

test('personal management: active handovers block deletion and deleted parents cannot be bypassed by scheduled application', () => {
  const state = createSeed(now);
  rejects('PENDING_HANDOVER', () => dispatch(state, 'u-jiho', 'task.delete', { taskId: 'task-meeting' }));
  // A stale external record must also be rejected by the scheduled reconciler.
  state.units.find(u => u.id === 'unit-strategy')!.deletedAt = now.toISOString();
  const handover = state.handovers.find(h => h.id === 'handover-plan')!; handover.effectiveAt = now.toISOString();
  reconcileDueHandovers(state, now);
  assert.equal(state.tasks.find(t => t.id === 'task-plan')!.primaryId, 'u-minseo');
  assert.equal(state.handovers.find(h => h.id === handover.id)!.status, 'scheduled');
  assert.match(state.handovers.find(h => h.id === handover.id)!.feedback!, /단위업무/);
  rejects('UNIT_DELETED', () => dispatch(state, 'u-head', 'handover.apply', { handoverId: handover.id }));
});

test('personal management: delete commands retain optimistic revisions and idempotency', () => {
  const state = createSeed(now); const unit = makeUnit(state); const task = makeTask(state, unit.id); const requestId = randomUUID(); const revision = state.revision;
  dispatch(state, 'u-jiho', 'task.delete', { taskId: task.id }, requestId); assert.equal(state.revision, revision + 1);
  dispatch(state, 'u-jiho', 'task.delete', { taskId: task.id }, requestId); assert.equal(state.revision, revision + 1);
  assert.equal(state.audit.filter(event => event.action === 'task.delete' && event.targetId === task.id).length, 1);
  rejects('TARGET_CONFLICT', () => executeCommand(state, 'u-jiho', { type: 'task.restore', payload: { taskId: task.id }, expectedRevision: revision, expected: { kind: 'task', id: task.id, rev: task.rev ?? 0 }, requestId: randomUUID() }, now));
  assert.ok(state.tasks.find(t => t.id === task.id)!.deletedAt);
});

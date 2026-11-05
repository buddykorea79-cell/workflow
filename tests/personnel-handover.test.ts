import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed, createRun } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-05T03:00:00Z');
const sourceId = 'u-support-member';
const managerId = 'u-doyun';
const headId = 'u-support-head';
const newId = 'u-new-colleague';
const departmentId = 'dept-support';

function fixture() {
  const state = createSeed(now);
  state.handovers = [];
  state.users.push({ ...state.users.find(user => user.id === sourceId)!, id: newId, name: '새담당', initials: '새', team: '데이터팀' });
  return state;
}
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>, requestId = randomUUID()) {
  const candidate = structuredClone(state);
  executeCommand(candidate, actor, { type, payload, expectedRevision: state.revision, requestId }, now);
  Object.assign(state, candidate);
}
function denied(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>, status?: number) {
  const before = structuredClone(state);
  assert.throws(() => dispatch(state, actor, type, payload), error => error instanceof DomainError && (!status || error.status === status));
  assert.deepEqual(state, before);
}
const ownTasks = (state: WorkspaceData, owner = sourceId) => state.tasks.filter(task => task.departmentId === departmentId && task.primaryId === owner && !task.deletedAt && task.status !== 'archived');
const ownUnits = (state: WorkspaceData, owner = sourceId) => state.units.filter(unit => unit.departmentId === departmentId && unit.ownerId === owner && !unit.deletedAt);
const latest = (state: WorkspaceData) => state.workTransfers![0];
const request = (overrides: Record<string, unknown> = {}) => ({ departmentId, fromId: sourceId, toId: newId, unitIds: [], taskIds: ['task-data'], reason: '인사이동으로 신규 부서원에게 업무 인계', ...overrides });
const emergency = (overrides: Record<string, unknown> = {}) => ({ departmentId, fromId: sourceId, toId: managerId, reason: '갑작스러운 인사발령으로 후임 지정 전 부서 보관', ...overrides });

test('personnel handover: old stores read an empty transfer collection without mutation', () => {
  const state = fixture(); delete state.workTransfers;
  const before = structuredClone(state);
  assert.deepEqual(getWorkspace(state, sourceId, now).workTransfers, []);
  assert.deepEqual(state, before);
});

test('personnel handover: request waits for the same department head, then applies to a new colleague', () => {
  const state = fixture();
  const originalTask = structuredClone(state.tasks.find(task => task.id === 'task-data')!);
  const originalUnit = structuredClone(state.units.find(unit => unit.id === originalTask.unitId)!);
  dispatch(state, sourceId, 'transfer.request', request());
  const transferId = latest(state).id;
  assert.equal(latest(state).status, 'pending');
  assert.deepEqual(state.tasks.find(task => task.id === originalTask.id), originalTask);
  assert.deepEqual(state.units.find(unit => unit.id === originalUnit.id), originalUnit);
  for (const actor of [sourceId, newId, managerId, 'u-support-admin', 'u-head']) denied(state, actor, 'transfer.approve', { transferId }, 403);
  dispatch(state, headId, 'transfer.approve', { transferId });
  const task = state.tasks.find(item => item.id === originalTask.id)!;
  assert.equal(task.primaryId, newId);
  assert.equal(latest(state).status, 'completed');
  assert.equal(state.units.find(unit => unit.id === task.unitId)!.ownerId, newId);
  assert.equal(state.units.find(unit => unit.id === originalUnit.id)!.ownerId, sourceId);
  assert.deepEqual(task.versions.slice(0, originalTask.versions.length), originalTask.versions);
  assert.ok(state.audit.some(event => event.action === 'transfer.request'));
  assert.ok(state.audit.some(event => event.action === 'transfer.approve'));
  denied(state, headId, 'transfer.approve', { transferId }, 409);
});

test('personnel handover: full unit selection includes its source-owned details and empty units', () => {
  const state = fixture();
  state.units.push({ ...state.units.find(unit => unit.id === 'unit-data')!, id: 'empty-unit', title: '신규 업무 준비' });
  dispatch(state, sourceId, 'transfer.request', request({ unitIds: ['unit-data', 'empty-unit'], taskIds: [] }));
  assert.ok(latest(state).taskIds.includes('task-data'));
  dispatch(state, headId, 'transfer.approve', { transferId: latest(state).id });
  assert.equal(state.units.find(unit => unit.id === 'unit-data')!.ownerId, newId);
  assert.equal(state.units.find(unit => unit.id === 'empty-unit')!.ownerId, newId);
  assert.equal(state.tasks.find(task => task.id === 'task-data')!.unitId, 'unit-data');
});

test('personnel handover: full shared unit does not transfer unrelated colleagues tasks', () => {
  const state = fixture();
  const sharedTask = state.tasks.find(task => task.id === 'task-assets')!;
  sharedTask.unitId = 'unit-data';
  const before = structuredClone(sharedTask);
  dispatch(state, sourceId, 'transfer.request', request({ unitIds: ['unit-data'], taskIds: [] }));
  assert.ok(!latest(state).taskIds.includes(sharedTask.id));
  dispatch(state, headId, 'transfer.approve', { transferId: latest(state).id });
  assert.deepEqual(state.tasks.find(task => task.id === sharedTask.id), before);
});

test('personnel handover: emergency custody moves all current work even after source leaves', () => {
  const state = fixture();
  const units = ownUnits(state).map(unit => unit.id), tasks = ownTasks(state).map(task => task.id);
  const past = structuredClone(state.runs.find(run => run.taskId === 'task-data')!);
  past.id = 'historical-completed-run'; past.status = 'completed'; past.completedAt = '2026-11-01T00:00:00Z';
  state.runs.push(past);
  const history = structuredClone(state.performances);
  const source = state.users.find(user => user.id === sourceId)!; source.active = false; source.departmentId = 'dept-plan';
  dispatch(state, managerId, 'transfer.emergency', emergency());
  assert.equal(latest(state).kind, 'emergency'); assert.equal(latest(state).status, 'completed');
  for (const id of units) assert.equal(state.units.find(unit => unit.id === id)!.ownerId, managerId);
  for (const id of tasks) assert.equal(state.tasks.find(task => task.id === id)!.primaryId, managerId);
  assert.ok(state.runs.filter(run => tasks.includes(run.taskId) && run.status !== 'completed').every(run => run.primaryId === managerId));
  assert.deepEqual(state.runs.find(run => run.id === past.id), past);
  assert.deepEqual(state.performances, history);
  assert.ok(state.audit.some(event => event.action === 'transfer.emergency'));
});

test('personnel handover: emergency and head-approved reassignment preserve confirmed division snapshot', () => {
  const state = fixture();
  dispatch(state, headId, 'department.confirm', {});
  const plan = structuredClone(state.departmentWorkPlans);
  dispatch(state, managerId, 'transfer.emergency', emergency());
  const remaining = ownTasks(state, managerId).filter(task => task.id !== 'task-data').map(task => task.id);
  dispatch(state, managerId, 'transfer.request', request({ fromId: managerId, kind: 'reassignment' }));
  assert.equal(state.tasks.find(task => task.id === 'task-data')!.primaryId, managerId);
  dispatch(state, headId, 'transfer.approve', { transferId: latest(state).id });
  assert.equal(state.tasks.find(task => task.id === 'task-data')!.primaryId, newId);
  for (const id of remaining) assert.equal(state.tasks.find(task => task.id === id)!.primaryId, managerId);
  assert.deepEqual(state.departmentWorkPlans, plan);
});

test('personnel handover: emergency privileges and custodian are scoped to department manager', () => {
  const state = fixture();
  for (const actor of [sourceId, newId, headId, 'u-minseo']) denied(state, actor, 'transfer.emergency', emergency(), 403);
  denied(state, managerId, 'transfer.emergency', emergency({ toId: newId }));
  denied(state, managerId, 'transfer.emergency', emergency({ toId: 'u-minseo' }));
  denied(state, managerId, 'transfer.emergency', emergency({ reason: ' ' }), 422);
});

test('personnel handover: requests reject unrelated work, same owner and out-of-department recipients', () => {
  const state = fixture();
  denied(state, newId, 'transfer.request', request(), 403);
  denied(state, sourceId, 'transfer.request', request({ toId: sourceId }));
  denied(state, sourceId, 'transfer.request', request({ toId: 'u-jiho' }));
  denied(state, sourceId, 'transfer.request', request({ taskIds: ['task-assets'] }));
  denied(state, sourceId, 'transfer.request', request({ unitIds: ['unit-support'], taskIds: [] }));
  denied(state, sourceId, 'transfer.request', request({ unitIds: [], taskIds: [] }), 422);
  denied(state, sourceId, 'transfer.request', request({ reason: '' }), 422);
});

test('personnel handover: pending work cannot be requested twice; rejection/cancellation preserve ownership', () => {
  const state = fixture();
  dispatch(state, sourceId, 'transfer.request', request());
  const transferId = latest(state).id;
  denied(state, managerId, 'transfer.request', request(), 409);
  denied(state, managerId, 'transfer.reject', { transferId, reason: '부서장 아님' }, 403);
  denied(state, headId, 'transfer.reject', { transferId, reason: ' ' }, 422);
  dispatch(state, headId, 'transfer.reject', { transferId, reason: '담당 범위 조정 후 재요청' });
  assert.equal(latest(state).status, 'rejected');
  assert.equal(state.tasks.find(task => task.id === 'task-data')!.primaryId, sourceId);
  dispatch(state, sourceId, 'transfer.request', request());
  const nextId = latest(state).id;
  denied(state, newId, 'transfer.cancel', { transferId: nextId }, 403);
  dispatch(state, sourceId, 'transfer.cancel', { transferId: nextId });
  assert.equal(latest(state).status, 'cancelled');
  assert.equal(state.tasks.find(task => task.id === 'task-data')!.primaryId, sourceId);
});

test('personnel handover: approval rechecks recipient membership, activity and task ownership', () => {
  for (const mutation of [
    (state: WorkspaceData) => { state.users.find(user => user.id === newId)!.departmentId = 'dept-plan'; },
    (state: WorkspaceData) => { state.users.find(user => user.id === newId)!.active = false; },
    (state: WorkspaceData) => { state.tasks.find(task => task.id === 'task-data')!.primaryId = managerId; },
    (state: WorkspaceData) => { state.tasks.find(task => task.id === 'task-data')!.deletedAt = now.toISOString(); },
  ]) {
    const state = fixture(); dispatch(state, sourceId, 'transfer.request', request()); mutation(state);
    denied(state, headId, 'transfer.approve', { transferId: latest(state).id });
  }
});

test('personnel handover: active run content and completed step authors survive reassignment', () => {
  const state = fixture(); const before = structuredClone(state.runs.find(run => run.taskId === 'task-data')!);
  dispatch(state, sourceId, 'transfer.request', request());
  dispatch(state, headId, 'transfer.approve', { transferId: latest(state).id });
  const run = state.runs.find(item => item.id === before.id)!;
  assert.equal(run.primaryId, newId); assert.equal(run.status, before.status);
  assert.deepEqual(run.steps, before.steps); assert.deepEqual(run.notes, before.notes);
  assert.equal(run.dueDate, before.dueDate); assert.deepEqual(run.workflowSnapshot, before.workflowSnapshot);
});

test('personnel handover: transfer history is scoped and remains available to both participants', () => {
  const state = fixture(); dispatch(state, sourceId, 'transfer.request', request());
  dispatch(state, headId, 'transfer.approve', { transferId: latest(state).id });
  const transferId = latest(state).id;
  for (const actor of [sourceId, newId, managerId, headId, 'u-support-admin']) assert.ok(getWorkspace(state, actor, now).workTransfers?.some(transfer => transfer.id === transferId));
  for (const actor of ['u-support-lead', 'u-jiho', 'u-head']) assert.ok(!getWorkspace(state, actor, now).workTransfers?.some(transfer => transfer.id === transferId));
});

test('personnel handover: emergency invalidates pending transfers before custody is applied', () => {
  const state = fixture(); dispatch(state, sourceId, 'transfer.request', request());
  const pendingId = latest(state).id;
  dispatch(state, managerId, 'transfer.emergency', emergency());
  assert.equal(state.workTransfers!.find(transfer => transfer.id === pendingId)!.status, 'cancelled');
  denied(state, headId, 'transfer.approve', { transferId: pendingId }, 409);
});

test('personnel handover: retrying the same request is idempotent', () => {
  const state = fixture(); const requestId = randomUUID();
  dispatch(state, sourceId, 'transfer.request', request(), requestId);
  const before = structuredClone(state);
  dispatch(state, sourceId, 'transfer.request', request(), requestId);
  assert.deepEqual(state, before);
});

test('personnel handover: full unit approval rejects changes in its selected scope', () => {
  for (const mutation of [
    (state: WorkspaceData) => { state.units.find(unit => unit.id === 'unit-data')!.ownerId = managerId; },
    (state: WorkspaceData) => { state.tasks.push({ ...structuredClone(state.tasks.find(task => task.id === 'task-data')!), id: 'new-unreviewed-child', code: 'NEW' }); },
    (state: WorkspaceData) => { state.tasks.find(task => task.id === 'task-data')!.version += 1; },
  ]) {
    const state = fixture(); dispatch(state, sourceId, 'transfer.request', request({ unitIds: ['unit-data'], taskIds: [] }));
    mutation(state); denied(state, headId, 'transfer.approve', { transferId: latest(state).id }, 409);
  }
});

test('personnel handover: new confirmed occurrences use the approved recipient while drafts stay drafts', () => {
  const state = fixture();
  dispatch(state, sourceId, 'transfer.request', request());
  dispatch(state, headId, 'transfer.approve', { transferId: latest(state).id });
  const confirmed = state.tasks.find(task => task.id === 'task-data')!;
  assert.equal(createRun(confirmed, '2027-Q1', now.toISOString()).primaryId, newId);
  const draft = { ...structuredClone(confirmed), id: 'draft-transfer', status: 'draft' as const, versions: [], unitId: 'unit-data', primaryId: sourceId };
  state.tasks.push(draft);
  dispatch(state, sourceId, 'transfer.request', request({ taskIds: [draft.id] }));
  dispatch(state, headId, 'transfer.approve', { transferId: latest(state).id });
  const transferred = state.tasks.find(task => task.id === draft.id)!;
  assert.equal(transferred.status, 'draft'); assert.equal(transferred.versions.length, 0);
});

test('personnel handover: common distribution points to the successor without losing reports or workflow', () => {
  const state = fixture();
  const common = state.commonTasks.find(common => common.distributions.some(distribution => distribution.taskId && ownTasks(state).some(task => task.id === distribution.taskId)))!;
  assert.ok(common);
  const distribution = common.distributions.find(distribution => distribution.taskId && ownTasks(state).some(task => task.id === distribution.taskId))!;
  const taskId = distribution.taskId!;
  distribution.monthlyReports = [{ id: 'report-before-handover', month: '2026-10', achievements: '이전 담당자 실적', authorId: sourceId, createdAt: now.toISOString(), updatedAt: now.toISOString() }];
  const reports = structuredClone(distribution.monthlyReports);
  const task = structuredClone(state.tasks.find(task => task.id === taskId)!);
  dispatch(state, sourceId, 'transfer.request', request({ taskIds: [taskId] }));
  dispatch(state, headId, 'transfer.approve', { transferId: latest(state).id });
  const read = getWorkspace(state, managerId, now).commonTasks.find(item => item.id === common.id)!.distributions.find(item => item.id === distribution.id)!;
  assert.equal(read.assigneeId, newId); assert.equal(read.currentAssigneeId, newId); assert.equal(read.taskOwnerId, newId);
  assert.deepEqual(read.monthlyReports, reports);
  assert.deepEqual(state.tasks.find(item => item.id === taskId)!.workflow, task.workflow);
});

test('personnel handover: moved employee with only an empty unit remains identifiable to manager', () => {
  const state = fixture();
  const moved = { ...state.users.find(user => user.id === sourceId)!, id: 'u-moved-empty', name: '이전부서원', active: false, departmentId: 'dept-plan' };
  state.users.push(moved);
  state.units.push({ ...state.units.find(unit => unit.id === 'unit-data')!, id: 'moved-empty-unit', ownerId: moved.id, title: '인계할 빈 단위업무' });
  const workspace = getWorkspace(state, managerId, now);
  assert.ok(workspace.identities?.some(user => user.id === moved.id && user.name === moved.name));
  dispatch(state, managerId, 'transfer.emergency', emergency({ fromId: moved.id }));
  assert.equal(state.units.find(unit => unit.id === 'moved-empty-unit')!.ownerId, managerId);
});

test('personnel handover: completed transfer names are durable after renaming work and people', () => {
  const state = fixture(); dispatch(state, sourceId, 'transfer.request', request({ unitIds: ['unit-data'], taskIds: [] }));
  dispatch(state, headId, 'transfer.approve', { transferId: latest(state).id });
  const history = structuredClone(latest(state));
  state.tasks.find(task => task.id === 'task-data')!.title = '변경된 업무 제목';
  state.units.find(unit => unit.id === 'unit-data')!.title = '변경된 단위업무';
  state.users.find(user => user.id === sourceId)!.name = '변경된 인계자 이름';
  assert.deepEqual(getWorkspace(state, newId, now).workTransfers!.find(transfer => transfer.id === history.id), history);
});

test('personnel handover: confirmed reviewer cannot become assignee through draft reviewer changes', () => {
  const state = fixture(); const task = state.tasks.find(task => task.id === 'task-data')!;
  task.status = 'revision'; task.reviewerId = headId; task.versions.at(-1)!.reviewerId = newId;
  denied(state, sourceId, 'transfer.request', request(), 409);
  task.versions.at(-1)!.reviewerId = managerId;
  dispatch(state, managerId, 'transfer.emergency', emergency());
  const after = state.tasks.find(item => item.id === task.id)!;
  assert.equal(after.versions.at(-1)!.primaryId, managerId);
  assert.equal(after.versions.at(-1)!.reviewerId, headId);
  assert.ok(latest(state).reviewerChanges?.some(change => change.taskId === task.id));
});

test('personnel handover: emergency run-only custody can be approved for a successor', () => {
  const state = fixture();
  const task = state.tasks.find(task => task.id === 'task-data')!;
  const run = state.runs.find(run => run.taskId === task.id)!;
  task.primaryId = newId;
  const ownerBefore = task.primaryId;
  dispatch(state, managerId, 'transfer.emergency', emergency());
  assert.equal(state.runs.find(item => item.id === run.id)!.primaryId, managerId);
  assert.equal(state.tasks.find(item => item.id === task.id)!.primaryId, ownerBefore);
  assert.ok(latest(state).executionOnly?.some(item => item.runId === run.id));
  dispatch(state, managerId, 'transfer.request', request({ fromId: managerId, taskIds: [], runIds: [run.id] }));
  assert.equal(state.runs.find(item => item.id === run.id)!.primaryId, managerId);
  dispatch(state, headId, 'transfer.approve', { transferId: latest(state).id });
  assert.equal(state.runs.find(item => item.id === run.id)!.primaryId, newId);
  assert.equal(state.tasks.find(item => item.id === task.id)!.primaryId, ownerBefore);
});

test('personnel handover: legacy transfer overlap blocks direct requests and is cancelled by emergency', () => {
  const state = fixture();
  const legacy = structuredClone(createSeed(now).handovers[0]);
  legacy.id = 'old-data-handover'; legacy.taskIds = ['task-data']; legacy.runIds = [];
  legacy.fromId = sourceId; legacy.toId = newId; legacy.departmentId = departmentId; legacy.targetDepartmentId = departmentId; legacy.status = 'approval';
  state.handovers.push(legacy);
  denied(state, sourceId, 'transfer.request', request(), 409);
  dispatch(state, managerId, 'transfer.emergency', emergency());
  assert.equal(state.handovers.find(item => item.id === legacy.id)!.status, 'cancelled');
  assert.ok(state.audit.some(event => event.action === 'handover.cancel' && event.targetId === legacy.id));
});

test('personnel handover: partial transfer pins legacy performance to its original unit', () => {
  const state = fixture();
  const task = state.tasks.find(task => task.id === 'task-data')!;
  const performance = { ...state.performances[0], id: 'old-performance', taskId: task.id, authorId: sourceId, departmentId, unitId: undefined };
  state.performances.push(performance);
  const before = structuredClone(performance);
  dispatch(state, sourceId, 'transfer.request', request());
  dispatch(state, headId, 'transfer.approve', { transferId: latest(state).id });
  assert.deepEqual(state.performances.find(item => item.id === performance.id), { ...before, unitId: task.unitId });
});

test('personnel handover: run-only requests reject duplicates and stale approval targets', () => {
  for (const change of ['owner', 'reviewer', 'definition', 'completed'] as const) {
    const state = fixture();
    const task = state.tasks.find(task => task.id === 'task-data')!; task.primaryId = newId;
    const run = state.runs.find(run => run.taskId === task.id)!;
    const payload = request({ taskIds: [], runIds: [run.id] });
    dispatch(state, sourceId, 'transfer.request', payload);
    denied(state, managerId, 'transfer.request', payload, 409);
    const current = state.runs.find(item => item.id === run.id)!;
    if (change === 'owner') current.primaryId = managerId;
    if (change === 'reviewer') current.reviewerId = newId;
    if (change === 'definition') current.definitionVersion += 1;
    if (change === 'completed') current.status = 'completed';
    denied(state, headId, 'transfer.approve', { transferId: latest(state).id }, 409);
  }
});

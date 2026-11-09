import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalWorkImport, validateWorkImport, WORK_IMPORT_LIMITS, workImportNeutralCard, type WorkImportInput } from '../src/lib/work-import';
import { commandTarget } from '../src/lib/command-targets';
import { createSeed } from '../src/lib/seed';
import { defaultCard, defaultWorkflow } from '../src/lib/seed-helpers';
import { DomainError, executeCommand } from '../src/lib/domain';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-08T03:00:00Z');
const draft = (units = 2, tasks = 2): WorkImportInput => ({ importId: randomUUID(), units: Array.from({ length: units }, (_, u) => ({ title: `새 단위 ${u + 1}`, description: `새 단위 ${u + 1}의 업무 범위`, tasks: Array.from({ length: tasks }, (_, t) => ({ title: `새 업무 ${u + 1}-${t + 1}`, description: `담당자가 확인한 업무 ${u + 1}-${t + 1}의 내용`, dueDate: '2026-11-30', frequency: 'once', priority: 'medium' })) })) });
const execute = (state: WorkspaceData, payload: unknown, actor = 'u-jiho', extra: Record<string, unknown> = {}) => executeCommand(state, actor, { type: 'work.import', payload, expectedRevision: state.revision, requestId: randomUUID(), ...extra }, now);
function unchangedFailure(state: WorkspaceData, payload: unknown, code: string, actor = 'u-jiho') {
  const before = structuredClone(state);
  assert.throws(() => execute(state, payload, actor), (error: unknown) => error instanceof DomainError && error.code === code);
  assert.deepEqual(state, before, 'failed direct domain call must not publish any partial state');
}

function completedLegacyImport(units = 10, actor = 'u-jiho') {
  const state = createSeed(now); const input = draft(units, 3);
  // Simulate the durable receipt written by the former 10-unit version.
  state.processedRequests.push({ id: `work.import:${input.importId}`, actorId: actor, fingerprint: createHash('sha256').update(`work.import\n${canonicalWorkImport(input)}`).digest('hex') });
  return { state, input };
}

test('work import normalizes text, UUID case, defaults and JSON property order for retry identity', () => {
  const input = draft(1, 1); const task = input.units[0].tasks[0];
  const value = { units: [{ tasks: [{ description: ` ${task.description}\n`, dueDate: task.dueDate, title: ` ${task.title} ` }], description: input.units[0].description, title: input.units[0].title }], importId: input.importId.toUpperCase() };
  const result = validateWorkImport(value); assert.ok(result.success);
  assert.equal(canonicalWorkImport(result.data), canonicalWorkImport(input));
});

test('work import validation points to every missing deadline and rejects nonexistent dates', () => {
  const input = draft(1, 2); input.units[0].tasks[0].dueDate = ''; input.units[0].tasks[1].dueDate = '2026-02-30';
  const result = validateWorkImport(input); assert.equal(result.success, false);
  if (!result.success) assert.deepEqual(result.issues.map(issue => issue.path), ['units.0.tasks.0.dueDate', 'units.0.tasks.1.dueDate']);
  input.units[0].tasks[0].dueDate = '2028-02-29'; input.units[0].tasks[1].dueDate = '2024-01-01';
  assert.equal(validateWorkImport(input).success, true, 'manual past dates remain permitted');
});

test('work import strict DTO rejects hidden assignment, file, budget and workflow fields', () => {
  for (const [level, key] of [['root', 'departmentId'], ['unit', 'ownerId'], ['unit', 'id'], ['task', 'primaryId'], ['task', 'supportIds'], ['task', 'reviewerId'], ['task', 'descriptionAttachmentIds'], ['task', 'sourceIds'], ['task', 'budget'], ['task', 'workflow'], ['task', 'status']] as const) {
    const input = draft(1, 1);
    const target = level === 'root' ? input : level === 'unit' ? input.units[0] : input.units[0].tasks[0];
    Object.assign(target, { [key]: 'not accepted' });
    assert.equal(validateWorkImport(input).success, false, key);
    unchangedFailure(createSeed(now), input, 'VALIDATION_ERROR', 'u-admin');
  }
});

test('work import enforces unit/task and total text limits without silently truncating', () => {
  assert.equal(validateWorkImport(draft(5, 6)).success, true);
  const overLimit = draft(6, 1);
  const overLimitResult = validateWorkImport(overLimit);
  assert.equal(overLimitResult.success, false);
  if (!overLimitResult.success) assert.ok(overLimitResult.issues.some(issue => issue.path === 'units' && issue.message.includes('5개')));
  unchangedFailure(createSeed(now), overLimit, 'VALIDATION_ERROR');
  assert.equal(validateWorkImport(draft(2, 16)).success, false);
  const empty = draft(1, 0); assert.equal(validateWorkImport(empty).success, false);
  const input = draft(3, 4); input.units.forEach(unit => unit.tasks.forEach(task => { task.description = '가'.repeat(WORK_IMPORT_LIMITS.description); }));
  assert.equal(validateWorkImport(input).success, false, '60,000 description characters plus titles and unit scope exceeds the total');
  input.units[0].tasks[0].description = '가'.repeat(WORK_IMPORT_LIMITS.description + 1);
  const result = validateWorkImport(input); assert.equal(result.success, false);
  if (!result.success) assert.ok(result.issues.some(issue => issue.path === 'units.0.tasks.0.description'));
});

test('work import rejects malformed containers, unsafe enums and invalid import identity', () => {
  for (const value of [null, [], {}, { importId: 'missing', units: [] }, { ...draft(), units: {} }]) assert.equal(validateWorkImport(value).success, false);
  const input = draft(1, 1); Object.assign(input.units[0].tasks[0], { frequency: 'hourly', priority: true });
  const result = validateWorkImport(input); assert.equal(result.success, false);
  if (!result.success) assert.deepEqual(result.issues.map(issue => issue.path), ['units.0.tasks.0.frequency', 'units.0.tasks.0.priority']);
});

test('work import creates all reviewed units/tasks with one revision and audit, preserving unrelated collections', () => {
  const state = createSeed(now); const before = structuredClone(state); const input = draft();
  const receipts = execute(state, input);
  assert.equal(commandTarget('work.import', input), null);
  assert.equal(state.revision, before.revision + 1);
  assert.equal(state.units.length, before.units.length + 2); assert.equal(state.tasks.length, before.tasks.length + 4);
  assert.equal(state.audit.length, before.audit.length + 1); assert.equal(state.audit[0].action, 'work.import');
  assert.equal(state.audit[0].targetId, input.importId);
  const detail = JSON.parse(state.audit[0].detail);
  assert.equal(detail.unitCount, 2); assert.equal(detail.taskCount, 4); assert.equal(detail.created.length, 2);
  assert.equal(receipts.length, 6); assert.ok(receipts.every(receipt => receipt.fromRev === 0 && receipt.toRev === 1 && ['unit', 'task'].includes(receipt.kind)));
  for (const key of ['runs', 'attachments', 'sources', 'notifications', 'delegations', 'handovers', 'commonTasks', 'performances'] as const) assert.deepEqual(state[key], before[key], key);
  for (const unit of state.units.slice(before.units.length)) { assert.equal(unit.ownerId, 'u-jiho'); assert.equal(unit.departmentId, 'dept-plan'); assert.equal(unit.rev, 1); }
  for (const task of state.tasks.slice(0, 4)) {
    assert.equal(task.primaryId, 'u-jiho'); assert.equal(task.reviewerId, 'u-head'); assert.deepEqual(task.supportIds, []);
    assert.equal(task.status, 'draft'); assert.equal(task.rev, 1); assert.deepEqual(task.versions, []); assert.deepEqual(task.sourceIds, []);
    assert.equal(task.completionCriteria, '필수 절차 수행 및 검토 완료');
    assert.equal(task.budgetMode, 'manual'); assert.equal(task.budget, 0); assert.equal(task.dueDate, '2026-11-30');
    assert.deepEqual(task.workflow, defaultWorkflow().map(step => ({ ...step, done: false })));
    assert.ok(task.workflow.every(step => !step.startDate && !step.dueDate && !step.output && step.checklist.length === 0));
    assert.deepEqual(task.card, workImportNeutralCard(task.description));
    assert.doesNotMatch(JSON.stringify(task.card), /기획재정담당관실|데이터정보화담당관실|혁신행정담당관실|연결된 업무 매뉴얼/);
  }
  assert.equal(new Set(state.tasks.slice(0, 4).map(task => task.code)).size, 4);
});

test('a duplicate final unit rolls back earlier staged units and tasks on a direct command call', () => {
  const state = createSeed(now); const input = draft(); input.units[1].title = input.units[0].title;
  unchangedFailure(state, input, 'DUPLICATE_UNIT');
  input.units[1].title = state.units.find(unit => unit.ownerId === 'u-jiho')!.title;
  unchangedFailure(state, input, 'DUPLICATE_UNIT');
});

test('a malformed final task cannot partially register earlier valid work', () => {
  const input = draft(); input.units[1].tasks[1].description = '   ';
  unchangedFailure(createSeed(now), input, 'VALIDATION_ERROR');
});

test('head, inactive account, locked department and missing active reviewer are rejected atomically', () => {
  unchangedFailure(createSeed(now), draft(), 'HEAD_DEFINITION_DENIED', 'u-head');
  const inactive = createSeed(now); inactive.users.find(user => user.id === 'u-jiho')!.active = false;
  unchangedFailure(inactive, draft(), 'ACCOUNT_INACTIVE');
  const locked = createSeed(now); locked.departmentWorkPlans = [{ departmentId: 'dept-plan', status: 'confirmed', version: 1 }];
  unchangedFailure(locked, draft(), 'DEPARTMENT_CONFIRMED');
  const missing = createSeed(now); missing.users.find(user => user.id === 'u-head')!.endsAt = '2026-11-07T00:00:00Z';
  unchangedFailure(missing, draft(), 'TASK_HEAD_REQUIRED');
});

test('reviewer, department and owner are resolved from the current account at commit time', () => {
  const state = createSeed(now); const input = draft(1, 1);
  const user = state.users.find(user => user.id === 'u-jiho')!; user.departmentId = 'dept-support';
  execute(state, input);
  assert.equal(state.tasks[0].departmentId, 'dept-support'); assert.equal(state.tasks[0].reviewerId, 'u-support-head');
  assert.equal(state.units.at(-1)!.ownerId, user.id); assert.equal(state.units.at(-1)!.departmentId, 'dept-support');
  const admin = createSeed(now); execute(admin, draft(1, 1), 'u-admin');
  assert.equal(admin.tasks[0].primaryId, 'u-admin'); assert.equal(admin.tasks[0].departmentId, 'dept-plan');
});

test('a response-loss retry with a different transport ID is a no-op even after department confirmation', () => {
  const state = createSeed(now); const input = draft(1, 1);
  execute(state, input, 'u-jiho', { requestId: 'first-transport', expectedRevision: 0 });
  state.departmentWorkPlans = [{ departmentId: 'dept-plan', status: 'confirmed', version: 1 }];
  const before = structuredClone(state);
  const reordered = { units: input.units.map(unit => ({ tasks: unit.tasks.map(task => ({ priority: task.priority, frequency: task.frequency, dueDate: task.dueDate, description: ` ${task.description} `, title: task.title })), description: unit.description, title: unit.title })), importId: input.importId.toUpperCase() };
  assert.deepEqual(execute(state, reordered, 'u-jiho', { requestId: 'new-transport', expectedRevision: 0 }), []);
  assert.deepEqual(state, before);
  assert.ok(state.processedRequests.some(request => request.id === `work.import:${input.importId}` && request.actorId === 'u-jiho'));
});

test('completed legacy batches replay across the five-unit rollout with old normalization and no writes', () => {
  for (const count of [6, 10]) {
    const { state, input } = completedLegacyImport(count);
    state.departmentWorkPlans = [{ departmentId: 'dept-plan', status: 'confirmed', version: 1 }];
    const before = structuredClone(state);
    const reordered = {
      units: input.units.map(unit => ({ tasks: unit.tasks.map(task => ({ dueDate: ` ${task.dueDate} `, description: ` ${task.description}\n`, title: task.title })), description: unit.description, title: unit.title })),
      importId: ` ${input.importId.toUpperCase()} `,
    };
    assert.deepEqual(execute(state, reordered, 'u-jiho', { requestId: 'after-deployment', expectedRevision: 0 }), []);
    assert.deepEqual(state, before, 'An acknowledged old receipt must not create, remove or revise any work.');
    assert.equal(validateWorkImport(input).success, false, 'New registrations still use the five-unit policy.');
  }
});

test('legacy replay hashes every unit and rejects changed content rather than truncating to five', () => {
  const { state, input } = completedLegacyImport();
  input.units[9].tasks[2].description += ' 변경';
  unchangedFailure(state, input, 'IDEMPOTENCY_CONFLICT');
});

test('legacy replay allowance requires the same actor and a completed import identity', () => {
  const { state, input } = completedLegacyImport(6);
  unchangedFailure(state, input, 'VALIDATION_ERROR', 'u-seoyeon');
  unchangedFailure(state, { ...input, importId: randomUUID() }, 'VALIDATION_ERROR');
  unchangedFailure(createSeed(now), input, 'VALIDATION_ERROR');
});

test('inactive accounts, including administrators, cannot replay a completed legacy import', () => {
  for (const actor of ['u-jiho', 'u-admin']) {
    const { state, input } = completedLegacyImport(6, actor);
    state.users.find(user => user.id === actor)!.active = false;
    unchangedFailure(state, input, 'ACCOUNT_INACTIVE', actor);
  }
});

test('legacy receipt replay still strictly validates hidden fields, deadlines and the former bounds', () => {
  for (const change of ['hidden', 'missing-date', 'invalid-date', 'units', 'tasks'] as const) {
    const { state, input } = completedLegacyImport();
    const task = input.units[9].tasks[2];
    if (change === 'hidden') Object.assign(task, { primaryId: 'u-admin' });
    if (change === 'missing-date') task.dueDate = '';
    if (change === 'invalid-date') task.dueDate = '2026-02-30';
    if (change === 'units') input.units.push(structuredClone(input.units[0]));
    if (change === 'tasks') input.units[9].tasks.push(structuredClone(task));
    unchangedFailure(state, input, 'VALIDATION_ERROR');
  }
});

test('the same import identity cannot commit a changed payload, but identities are actor scoped', () => {
  const state = createSeed(now); const input = draft(1, 1); execute(state, input);
  const changed = structuredClone(input); changed.units[0].tasks[0].title += ' 수정';
  unchangedFailure(state, changed, 'IDEMPOTENCY_CONFLICT');
  execute(state, input, 'u-seoyeon');
  assert.equal(state.units.filter(unit => unit.title === input.units[0].title).length, 2);
  assert.deepEqual(new Set(state.units.filter(unit => unit.title === input.units[0].title).map(unit => unit.ownerId)), new Set(['u-jiho', 'u-seoyeon']));
});

test('a rejected first attempt can be corrected with the same import ID without trimming request history', () => {
  const state = createSeed(now); const input = draft(1, 1); input.units[0].tasks[0].dueDate = '';
  state.processedRequests.push(...Array.from({ length: 1005 }, (_, index) => ({ id: `old-${index}`, actorId: 'u-jiho', fingerprint: String(index) })));
  const history = structuredClone(state.processedRequests);
  unchangedFailure(state, input, 'VALIDATION_ERROR'); input.units[0].tasks[0].dueDate = '2026-12-01'; execute(state, input);
  assert.deepEqual(state.processedRequests.slice(0, history.length), history); assert.equal(state.processedRequests.length, history.length + 1);
});

test('maximum reviewed batch retains all 30 tasks in five units despite a stale global revision', () => {
  const state = createSeed(now); const before = structuredClone(state); const input = draft(5, 6);
  state.revision = 51;
  const receipts = execute(state, input, 'u-jiho', { expectedRevision: 1 });
  assert.equal(receipts.length, 35); assert.equal(state.revision, 52);
  assert.equal(state.units.length, before.units.length + 5);
  assert.equal(state.tasks.length, before.tasks.length + 30);
  for (const unitDraft of input.units) {
    const unit = state.units.find(item => item.title === unitDraft.title)!;
    assert.deepEqual(state.tasks.filter(task => task.unitId === unit.id).map(task => task.title).sort(), unitDraft.tasks.map(task => task.title).sort());
  }
});

test('registration preserves annual defaults and each reviewed schedule including later owner edits', () => {
  const state = createSeed(now); const input = draft(1, 2);
  Object.assign(input.units[0].tasks[0], { dueDate: '2026-12-31', frequency: 'yearly' });
  Object.assign(input.units[0].tasks[1], { dueDate: '2027-03-15', frequency: 'quarterly' });
  execute(state, input);
  for (const reviewed of input.units[0].tasks) {
    const task = state.tasks.find(item => item.title === reviewed.title)!;
    assert.equal(task.dueDate, reviewed.dueDate); assert.equal(task.frequency, reviewed.frequency);
  }
  const annual = state.tasks.find(item => item.title === input.units[0].tasks[0].title)!;
  executeCommand(state, 'u-jiho', { type: 'task.configure', payload: { taskId: annual.id, dueDate: '2027-06-20', frequency: 'monthly' }, expectedRevision: state.revision, expected: { kind: 'task', id: annual.id, rev: annual.rev }, requestId: randomUUID() }, now);
  assert.equal(annual.dueDate, '2027-06-20'); assert.equal(annual.frequency, 'monthly');
});

test('existing individual creation retains its default card, caller card, validation and idempotency behavior', () => {
  const state = createSeed(now);
  executeCommand(state, 'u-jiho', { type: 'unit.create', payload: { title: '개별 등록', description: '기존 동작' }, expectedRevision: state.revision, requestId: 'unit-original' }, now);
  const payload = { title: '개별 세부업무', description: '기존 개별 설명', unitId: state.units.at(-1)!.id, primaryId: 'u-jiho', dueDate: '2026-12-01', frequency: 'monthly' };
  const command = { type: 'task.create', payload, expectedRevision: state.revision, requestId: 'task-original' };
  executeCommand(state, 'u-jiho', command, now);
  assert.deepEqual(state.tasks[0].card, defaultCard(payload.description));
  assert.equal(state.tasks[0].completionCriteria, '필수 체크와 결과물 확인 및 총괄 검토 완료');
  const before = structuredClone(state); assert.deepEqual(executeCommand(state, 'u-jiho', command, now), []); assert.deepEqual(state, before);
  const card = { ...defaultCard('직접 입력 목적'), evidence: '직접 확인한 자료' };
  executeCommand(state, 'u-jiho', { ...command, payload: { ...payload, title: '직접 카드', card }, requestId: 'task-with-card' }, now);
  assert.deepEqual(state.tasks[0].card, card);
});

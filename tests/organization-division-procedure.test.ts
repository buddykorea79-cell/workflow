import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { createSeed } from '../src/lib/seed';
import { canReadTask, getWorkspace } from '../src/lib/domain';
import { sessionCookie, signSession } from '../src/lib/auth';
import { taskProcedureParticipants } from '../src/lib/procedure-participants';
import { organizationDivisionProcedureForUser } from '../src/lib/organization-division-procedure';
import { GET } from '../src/app/api/organization-division/procedure/route';
import { GET as attachmentGet } from '../src/app/api/attachments/[id]/route';
import type { Task } from '../src/lib/types';

const now = new Date('2026-11-09T03:00:00Z');
const roles = ['member', 'lead', 'manager', 'head', 'admin'] as const;

function fixture() {
  const state = createSeed(now);
  const task = state.tasks.find(item => item.id === 'task-data')!;
  const unit = state.units.find(item => item.id === task.unitId)!;
  task.description = 'PRIVATE-task-body'; task.code = 'PRIVATE-task-code'; task.completionCriteria = 'PRIVATE-completion-criteria';
  task.card.purpose = 'PRIVATE-card'; task.references = [{ id: 'PRIVATE-reference', type: 'document', title: 'PRIVATE-reference-title', content: 'PRIVATE-reference-body', attachmentId: 'PRIVATE-attachment' }];
  unit.description = 'PRIVATE-unit-body';
  task.workflow = [
    { id: 'prepare', title: '자료 준비', role: 'primary', description: 'PRIVATE-step-body', output: 'PRIVATE-step-output', required: true, dependsOn: [], checklist: ['PRIVATE-checklist'], done: true, startDate: '2026-11-01', dueDate: '2026-11-30', scheduleDetails: 'PRIVATE-schedule', attachmentIds: ['PRIVATE-attachment'] },
    { id: 'support', title: '관계 부서 협조', role: 'support', description: 'PRIVATE-support-body', output: 'PRIVATE-support-output', required: false, dependsOn: ['prepare', 'missing-step', 'prepare', 'support'], checklist: [], done: true },
    { id: 'review', title: '최종 검토', role: 'reviewer', description: 'PRIVATE-review-body', output: '', required: true, dependsOn: ['support'], checklist: [], done: true },
  ];
  task.supportIds = ['u-doyun']; task.cooperationDepartmentIds = ['dept-plan'];
  state.users.forEach(user => { user.email = 'PRIVATE-email'; user.phone = 'PRIVATE-phone'; });
  const run = state.runs.find(item => item.taskId === task.id)!;
  run.workflowSnapshot = [{ ...task.workflow[0], title: 'PRIVATE-past-cycle-title' }];
  run.notes = [{ id: 'PRIVATE-note', authorId: task.primaryId, body: 'PRIVATE-run-note', createdAt: now.toISOString() }];
  state.attachments.push({ id: 'PRIVATE-attachment', taskId: task.id, name: 'PRIVATE-file-name.txt', size: 10, mime: 'text/plain', sha256: 'PRIVATE-sha', storageKey: 'PRIVATE-storage', status: 'test_allowed', uploadedBy: task.primaryId, createdAt: now.toISOString() });
  return { state, task, unit };
}

test('every role sees current directory flow and assignee labels without private fields or execution state', () => {
  const { state, task, unit } = fixture();
  const before = structuredClone(state);
  for (const role of roles) {
    const user = state.users.find(item => item.departmentId === 'dept-plan' && item.role === role)!;
    const result = organizationDivisionProcedureForUser(state, user, task.id, now);
    assert.deepEqual(Object.keys(result).sort(), ['departmentName', 'participants', 'taskId', 'taskTitle', 'unitTitle', 'workflow']);
    assert.equal(result.taskTitle, task.title); assert.equal(result.unitTitle, unit.title);
    assert.equal(result.departmentName, state.departments.find(item => item.id === task.departmentId)!.name);
    assert.deepEqual(result.participants, taskProcedureParticipants({ users: state.users, departments: state.departments }, task));
    assert.deepEqual(result.workflow.map(step => step.dependsOn), [[], ['prepare'], ['support']]);
    for (const step of result.workflow) assert.deepEqual(Object.keys(step).sort(), ['dependsOn', 'id', 'role', 'title']);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE-|2026-11-|description|checklist|attachment|done|schedule|completedAt/);
    if (role !== 'admin') {
      assert.equal(canReadTask(state, user, task, now), false);
      const workspace = getWorkspace(state, user.id, now);
      assert.equal(workspace.tasks.some(item => item.id === task.id), false);
      assert.equal(workspace.attachments.some(item => item.taskId === task.id), false);
    }
  }
  assert.deepEqual(state, before);
});

test('procedure visibility follows directory membership for hidden units and common-work registration states', () => {
  const { state, task } = fixture();
  const user = state.users.find(item => item.id === 'u-jiho')!;
  const hiddenChanges: [string, (copy: typeof state, hidden: Task) => void][] = [
    ['deleted task', (_, hidden) => { hidden.deletedAt = now.toISOString(); }],
    ['archived task', (_, hidden) => { hidden.status = 'archived'; }],
    ['missing unit', (_, hidden) => { hidden.unitId = 'missing-unit'; }],
    ['deleted unit', (copy, hidden) => { copy.units.find(unit => unit.id === hidden.unitId)!.deletedAt = now.toISOString(); }],
    ['mismatched unit department', (copy, hidden) => { copy.units.find(unit => unit.id === hidden.unitId)!.departmentId = 'dept-plan'; }],
    ['missing common work', (_, hidden) => { hidden.commonId = 'missing-common'; }],
  ];
  for (const [label, change] of hiddenChanges) {
    const copy = structuredClone(state); change(copy, copy.tasks.find(item => item.id === task.id)!);
    assert.throws(() => organizationDivisionProcedureForUser(copy, user, task.id, now), { status: 404, code: 'DIVISION_PROCEDURE_NOT_FOUND' }, label);
  }
  for (const status of ['pending', 'team_assigned', 'person_assigned', 'registered', 'assigned', 'submitted'] as const) {
    const copy = structuredClone(state), shared = structuredClone(copy.commonTasks[0]);
    const subject = copy.tasks.find(item => item.id === task.id)!;
    shared.id = 'procedure-common'; shared.publicationStatus = 'approved';
    shared.distributions = [{ id: 'procedure-distribution', departmentId: subject.departmentId, taskId: subject.id, status, distributedAt: now.toISOString() }];
    subject.commonId = shared.id; copy.commonTasks.push(shared);
    if (['registered', 'assigned', 'submitted'].includes(status)) {
      assert.equal(organizationDivisionProcedureForUser(copy, user, task.id, now).taskId, task.id);
      shared.publicationStatus = 'pending';
    }
    assert.throws(() => organizationDivisionProcedureForUser(copy, user, task.id, now), { status: 404, code: 'DIVISION_PROCEDURE_NOT_FOUND' }, status);
  }
});

test('empty procedures and legacy cyclic dependencies remain read-only display data', () => {
  const { state, task } = fixture(), user = state.users.find(item => item.id === 'u-jiho')!;
  task.workflow[0].dependsOn = ['review'];
  assert.deepEqual(organizationDivisionProcedureForUser(state, user, task.id, now).workflow.map(step => step.dependsOn), [['review'], ['prepare'], ['support']]);
  task.workflow = [];
  assert.deepEqual(organizationDivisionProcedureForUser(state, user, task.id, now).workflow, []);
});

test('authenticated procedure GET reads the committed snapshot across departments while preserving detail access and writer lock', async () => {
  const qaRoot = path.resolve(process.cwd(), '.qa-data'); await mkdir(qaRoot, { recursive: true });
  const directory = await mkdtemp(path.join(qaRoot, 'organization-procedure-test-'));
  const keys = ['DATABASE_URL', 'NEON_AUTH_BASE_URL', 'VERCEL', 'IEUM_DATA_DIR', 'IEUM_SESSION_SECRET', 'IEUM_STORE', 'IEUM_PROTOTYPE_MODE'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, { IEUM_DATA_DIR: directory, IEUM_SESSION_SECRET: 'isolated-organization-procedure-test-secret', IEUM_STORE: 'local' });
    const { state, task, unit } = fixture();
    state.users.push({ ...state.users[0], id: 'inactive-viewer', active: false }, { ...state.users[0], id: 'expired-viewer', active: true, endsAt: '2020-01-01T00:00:00Z' });
    state.units.push({ ...unit, id: 'deleted-unit', deletedAt: now.toISOString() });
    state.tasks.push(
      { ...task, id: 'deleted-task', deletedAt: now.toISOString() }, { ...task, id: 'archived-task', status: 'archived' },
      { ...task, id: 'deleted-unit-task', unitId: 'deleted-unit' }, { ...task, id: 'missing-unit-task', unitId: 'missing-unit' },
      { ...task, id: 'missing-common-task', commonId: 'missing-common' }, { ...task, id: 'empty-procedure', workflow: [] },
    );
    const stateFile = path.join(directory, 'workspace.json'), lockFile = path.join(directory, '.workspace.lock');
    const stored = JSON.stringify(state), lock = 'active writer must be preserved';
    await writeFile(stateFile, stored); await writeFile(lockFile, lock, { flag: 'wx' });
    const entries = (await readdir(directory)).sort();
    const endpoint = 'http://127.0.0.1:3001/api/organization-division/procedure';
    const request = (query: string, userId?: string) => new NextRequest(`${endpoint}${query}`, { headers: userId ? { Cookie: `${sessionCookie}=${signSession(userId)}` } : {} });
    assert.equal((await GET(request(`?taskId=${task.id}`))).status, 401);
    for (const id of ['inactive-viewer', 'expired-viewer', 'unknown-viewer']) {
      const response = await GET(request(`?taskId=${task.id}`, id));
      assert.equal(response.status, 401); assert.equal((await response.json()).code, 'ACCOUNT_INACTIVE');
    }
    for (const query of ['', '?taskId=', '?taskId=%20', `?taskId=${'x'.repeat(151)}`, `?taskId=${task.id}&taskId=another`]) assert.equal((await GET(request(query, task.primaryId))).status, 422);
    for (const role of roles) {
      const user = state.users.find(item => item.departmentId === 'dept-plan' && item.role === role)!;
      const response = await GET(request(`?taskId=${task.id}`, user.id));
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store, private');
      assert.deepEqual(await response.json(), organizationDivisionProcedureForUser(state, user, task.id, now));
      for (const hidden of ['unknown-task', 'deleted-task', 'archived-task', 'deleted-unit-task', 'missing-unit-task', 'missing-common-task']) {
        const denied = await GET(request(`?taskId=${hidden}`, user.id));
        assert.equal(denied.status, 404); assert.equal((await denied.json()).code, 'DIVISION_PROCEDURE_NOT_FOUND');
      }
      assert.deepEqual((await (await GET(request('?taskId=empty-procedure', user.id))).json()).workflow, []);
      if (role !== 'admin') {
        const attachment = await attachmentGet(new NextRequest('http://127.0.0.1:3001/api/attachments/PRIVATE-attachment', { headers: { Cookie: `${sessionCookie}=${signSession(user.id)}` } }), { params: Promise.resolve({ id: 'PRIVATE-attachment' }) });
        assert.equal(attachment.status, 403); assert.equal((await attachment.json()).code, 'DOWNLOAD_DENIED');
        assert.equal(canReadTask(state, user, task, now), false);
      }
    }
    assert.equal(await readFile(stateFile, 'utf8'), stored);
    assert.equal(await readFile(lockFile, 'utf8'), lock);
    assert.deepEqual((await readdir(directory)).sort(), entries);
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.equal(path.dirname(path.resolve(directory)), qaRoot);
    assert.ok(path.basename(directory).startsWith('organization-procedure-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Use a separate server with IEUM_DATA_DIR=.qa-data/personal-management on port 3001.
const base = process.argv[2] || 'http://127.0.0.1:3001';
const origin = new URL(base);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname));
assert.equal(origin.port, '3001', 'Never run mutation QA against the user workspace.');
const marker = `CRUD-${randomUUID().slice(0, 8)}`;
const cookies = new Map();
let checks = 0;
function check(name, assertion) { assertion(); checks++; console.log(`PASS ${name}`); }
async function request(path, { user, method = 'GET', body, status = 200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method, headers: { Origin: origin.origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(user ? { Cookie: cookies.get(user) } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data).slice(0, 400)}`);
  return { data, response };
}
async function login(user) {
  const { data, response } = await request('/api/session', { method: 'POST', body: { userId: user } });
  cookies.set(user, response.headers.get('set-cookie').split(';')[0]);
  return data;
}
async function workspace(user) { return (await request('/api/workspace', { user })).data; }
async function command(user, type, payload, status = 200, overrides = {}) {
  const current = await workspace(user);
  return (await request('/api/commands', { user, method: 'POST', status, body: { type, payload, expectedRevision: current.revision, requestId: randomUUID(), ...overrides } })).data;
}

const { data: directory } = await request('/api/session');
const members = directory.users.filter(u => u.role === 'member' && u.departmentId === 'dept-plan');
const owner = members[0].id, peer = members[1].id;
const head = directory.users.find(u => u.role === 'head' && u.departmentId === 'dept-plan').id;
await login(owner); await login(peer);

let state = await command(owner, 'unit.create', { title: `${marker} 단위 A`, description: '예산 관련 세부업무를 모아 관리합니다.' });
const unitA = state.units.find(u => u.title === `${marker} 단위 A`).id;
state = await command(owner, 'unit.update', { unitId: unitA, title: `${marker} 예산 관리`, description: '요구자료 작성부터 집행까지 관리합니다.' });
check('Owner can create and rename a unit', () => assert.equal(state.units.find(u => u.id === unitA).title, `${marker} 예산 관리`));
await command(peer, 'unit.update', { unitId: unitA, title: '권한 없는 변경', description: '다른 구성원 변경' }, 403);
await command(peer, 'unit.delete', { unitId: unitA }, 403);
check('Another member cannot edit or delete the unit', () => assert.equal(state.units.find(u => u.id === unitA).ownerId, owner));

state = await command(owner, 'unit.create', { title: `${marker} 단위 B`, description: '세부업무 이동 대상입니다.' });
const unitB = state.units.find(u => u.title === `${marker} 단위 B`).id;
state = await command(peer, 'unit.create', { title: `${marker} 타인 단위`, description: '소유권 검증 대상입니다.' });
const peerUnit = state.units.find(u => u.title === `${marker} 타인 단위`).id;
const detail = { title: `${marker} 요구자료 작성`, description: '부서별 예산 요구자료를 작성합니다.', unitId: unitA, primaryId: owner, supportIds: [], reviewerId: head, dueDate: '2027-03-31', frequency: 'once', priority: 'medium', budget: 1000000 };
await command(owner, 'task.create', { ...detail, unitId: peerUnit }, 403);
state = await command(owner, 'task.create', detail);
const taskId = state.tasks.find(t => t.title === detail.title).id;
check('Detail creation is limited to an owned unit', () => assert.equal(state.tasks.find(t => t.id === taskId).unitId, unitA));
const blockedUnit = await command(owner, 'unit.delete', { unitId: unitA }, 409);
check('A unit with active details cannot be removed', () => assert.equal(blockedUnit.code, 'UNIT_NOT_EMPTY'));

state = await command(owner, 'task.configure', { taskId, title: `${marker} 요구자료 보완`, description: '검토 의견을 반영합니다.', unitId: unitB, budget: 1500000, expenses: [{ id: `${marker}-expense`, date: '2026-10-31', description: '자료 인쇄', amount: 100000 }] });
check('Detail editing moves the task while preserving financial records', () => {
  const task = state.tasks.find(t => t.id === taskId);
  assert.equal(task.unitId, unitB); assert.equal(task.budget, 1500000); assert.equal(task.expenses[0].amount, 100000);
  assert.ok(task.versions.some(v => v.unitId === unitA));
});
await command(owner, 'task.configure', { taskId, unitId: peerUnit }, 403);
await command(peer, 'task.delete', { taskId }, 403);
check('Task relocation and deletion reject unauthorized owners', () => assert.ok(true));

state = await command(owner, 'unit.delete', { unitId: unitA });
check('Empty units enter the trash', () => assert.ok(state.units.find(u => u.id === unitA).deletedAt));
await command(owner, 'task.configure', { taskId, unitId: unitA }, 409);
state = await command(owner, 'unit.restore', { unitId: unitA });
check('A unit can be restored', () => assert.ok(!state.units.find(u => u.id === unitA).deletedAt));

const before = state.tasks.find(t => t.id === taskId);
const requestId = randomUUID();
const revision = state.revision;
state = await command(owner, 'task.delete', { taskId }, 200, { requestId, expectedRevision: revision });
check('Detail deletion is recoverable and retains expenses and versions', () => {
  const deleted = state.tasks.find(t => t.id === taskId);
  assert.ok(deleted.deletedAt); assert.equal(deleted.status, 'archived');
  assert.deepEqual(deleted.expenses, before.expenses); assert.deepEqual(deleted.versions, before.versions);
});
const deleteRevision = state.revision;
state = await command(owner, 'task.delete', { taskId }, 200, { requestId, expectedRevision: revision });
check('Deletion retries do not duplicate the mutation', () => assert.equal(state.revision, deleteRevision));
await command(owner, 'task.configure', { taskId, description: '삭제된 업무 수정 시도' }, 409);
const upload = new FormData();
upload.set('taskId', taskId); upload.set('file', new Blob(['deleted task upload must fail'], { type: 'text/plain' }), 'blocked.txt');
const uploadResponse = await fetch(`${base}/api/attachments`, { method: 'POST', headers: { Origin: origin.origin, Cookie: cookies.get(owner) }, body: upload });
const uploadError = await uploadResponse.json();
check('Deleted detail rejects attachment writes', () => { assert.equal(uploadResponse.status, 409); assert.equal(uploadError.code, 'TASK_DELETED'); });
await command(peer, 'task.restore', { taskId }, 403);
state = await command(owner, 'unit.delete', { unitId: unitB });
await command(owner, 'task.restore', { taskId }, 409);
state = await command(owner, 'task.restore', { taskId, unitId: unitA });
check('Restoring a detail can select another active owned unit', () => {
  const restored = state.tasks.find(t => t.id === taskId);
  assert.ok(!restored.deletedAt); assert.equal(restored.status, before.status); assert.equal(restored.unitId, unitA);
  assert.deepEqual(restored.expenses, before.expenses);
});
await request('/api/session', { user: owner, method: 'DELETE' });
state = await login(owner);
check('All changes survive logout and a fresh session', () => {
  assert.equal(state.tasks.find(t => t.id === taskId).unitId, unitA);
  assert.ok(state.units.find(u => u.id === unitB).deletedAt);
  assert.ok(state.audit.some(a => a.action === 'task.restore' && a.targetId === taskId));
});
console.log(JSON.stringify({ success: true, checks, marker, owner, unitA, unitB, taskId }));

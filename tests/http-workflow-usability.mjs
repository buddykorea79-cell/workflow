import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { recentHalves } from './helpers/http-period.mjs';

// This script intentionally accepts only the isolated local QA server.
const target = new URL(process.argv[2] || 'http://127.0.0.1:3001');
assert.equal(target.protocol, 'http:');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
assert.equal(target.port, '3001', 'Only the isolated QA server on port 3001 is allowed.');
assert.equal(target.pathname, '/');
assert.equal(target.username + target.password + target.search + target.hash, '');
const base = target.origin;
const employee = 'u-seoyeon', successor = 'u-jiho', manager = 'u-minseo', head = 'u-head', foreign = 'u-support-member';
const departmentId = 'dept-plan';
const cookies = new Map();
const suffix = randomUUID().slice(0, 8);
let checks = 0;
const pass = name => { checks++; console.log(`PASS ${name}`); };
function assertLocal(state) {
  assert.equal(state.mode, 'local', 'Connected workspace data must never be modified by this test.');
  assert.equal(state.integrations.database, '로컬 파일 저장');
  assert.equal(state.integrations.storage, '로컬 격리 저장', 'Remote file storage must never be used by this test.');
}
async function request(path, { user, method = 'GET', body, expected = 200 } = {}) {
  assert.ok(path.startsWith('/api/') && !path.startsWith('//'));
  const multipart = body instanceof FormData;
  const response = await fetch(base + path, {
    method, redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { Origin: base, ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}), ...(user ? { Cookie: cookies.get(user) || '' } : {}) },
    body: multipart ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (expected !== null) assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data).slice(0, 900)}`);
  if (data?.currentUser) assertLocal(data);
  return { data, response };
}
async function login(userId) {
  const result = await request('/api/session', { method: 'POST', body: { userId } });
  assertLocal(result.data);
  const cookie = result.response.headers.get('set-cookie'); assert.ok(cookie);
  cookies.set(userId, cookie.split(';')[0]);
  return result.data;
}
async function workspace(user = employee) { return (await request('/api/workspace', { user })).data; }
async function command(user, type, payload, expected = 200, code) {
  const requestId = randomUUID();
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await workspace(user);
    const result = await request('/api/commands', { user, method: 'POST', expected: null, body: { type, payload, requestId, expectedRevision: state.revision } });
    if (result.response.status === 409 && result.data.code === 'VERSION_CONFLICT' && attempt < 3) continue;
    assert.equal(result.response.status, expected, `${type}: ${JSON.stringify(result.data).slice(0, 900)}`);
    if (code) assert.equal(result.data.code, code);
    return result.data;
  }
  throw new Error('Workspace changed too often for a stable test.');
}
const taskIn = (state, id) => state.tasks.find(task => task.id === id);
const runIn = (state, taskId) => state.runs.find(run => run.taskId === taskId);
const recordIn = (state, id) => state.performances.find(record => record.id === id);
const steps = [
  { id: `a-${suffix}`, title: '자료 작성', role: 'primary', description: '합성 자료를 작성합니다.', output: '', required: true, checklist: [], dependsOn: [] },
  { id: `b-${suffix}`, title: '중간 확인', role: 'primary', description: '일정 미정인 중간 절차입니다.', output: '', required: true, checklist: [], dependsOn: [`a-${suffix}`] },
  { id: `c-${suffix}`, title: '최종 검토', role: 'reviewer', description: '앞선 절차가 끝난 뒤 검토합니다.', output: '', required: true, checklist: [], dependsOn: [`b-${suffix}`] },
];

// Login is checked before any command or upload. Never touch a connected store.
await login(employee);
for (const user of [successor, manager, head, foreign]) await login(user);
pass('Local-only database and local-only storage guards passed');

const unitTitle = `QA 사용성 회귀 ${suffix}`;
let state = await command(employee, 'unit.create', { title: unitTitle, description: '격리 저장소의 합성 검증 자료' });
const unitId = state.units.find(unit => unit.title === unitTitle).id;
async function createTask(label, workflow) {
  const title = `QA ${label} ${suffix}`;
  const next = await command(employee, 'task.create', { title, description: '실제 업무와 분리한 HTTP 회귀 점검', unitId, primaryId: employee, supportIds: [], dueDate: '2026-11-30', frequency: 'monthly', ...(workflow ? { workflow } : {}) });
  return next.tasks.find(task => task.title === title).id;
}
const taskId = await createTask('일정·수행', steps);
const evidenceTaskId = await createTask('인계 후 성과');
state = await workspace();
assert.ok(taskIn(state, evidenceTaskId).workflow.every(step => step.role !== 'support' && !step.output && !step.checklist.length));
pass('New default procedures contain assigned people and no hidden output/checklist requirements');

const originalTask = structuredClone(taskIn(state, taskId));
const auditBefore = state.audit.length, revisionBefore = state.revision;
state = await command(employee, 'task.configure', { taskId, title: originalTask.title, description: originalTask.description, frequency: originalTask.frequency, budget: originalTask.budget ?? 0, references: [], expenses: [], descriptionAttachmentIds: [], workflow: originalTask.workflow.map(step => ({ ...step, attachmentIds: [] })) });
assert.equal(state.revision, revisionBefore, 'Run this test without concurrent UI saves during the no-op check.');
assert.equal(state.audit.length, auditBefore);
assert.deepEqual(taskIn(state, taskId), originalTask);
await login(employee); state = await workspace();
assert.deepEqual(taskIn(state, taskId), originalTask);
pass('Unchanged save preserves the task version, revision and history across login');

const schedule = { taskId, startDate: '2026-11-05', dueDate: '2026-11-20', steps: [{ stepId: steps[0].id, dueDate: '2026-11-10' }, { stepId: steps[1].id }, { stepId: steps[2].id, startDate: '2026-11-05' }] };
await command(employee, 'run.schedule', schedule, 422, 'CYCLE_DEPENDENCY_DATE');
assert.equal(runIn(await workspace(), taskId), undefined);
state = await command(employee, 'run.schedule', { ...schedule, steps: schedule.steps.map(step => step.stepId === steps[2].id ? { ...step, startDate: '2026-11-11' } : step) });
const runId = runIn(state, taskId).id;
assert.equal(runIn(state, taskId).workflowSnapshot[1].startDate, undefined);
pass('Indirect predecessor date reversal is rejected; valid partial schedules are saved');

for (const step of steps) await command(step.role === 'reviewer' ? head : employee, 'run.completeStep', { runId, stepId: step.id, output: `${step.title} 완료 원본` });
state = await workspace(); const completed = structuredClone(runIn(state, taskId));
assert.equal(completed.status, 'completed');
await command(employee, 'run.completeStep', { runId, stepId: steps[0].id, output: '원본을 덮어쓰려는 시도' }, 409);
await command(foreign, 'run.note', { runId, stepId: steps[0].id, body: '권한 없는 메모' }, 403);
state = await command(employee, 'run.note', { runId, stepId: steps[0].id, body: `완료 후 보완 ${suffix}` });
const supplemented = runIn(state, taskId);
assert.deepEqual(supplemented.steps, completed.steps);
assert.equal(supplemented.completedAt, completed.completedAt);
assert.equal(supplemented.status, 'completed');
assert.ok(supplemented.notes.some(note => note.stepId === steps[0].id && note.body === `완료 후 보완 ${suffix}` && note.authorId === employee));
await login(employee); assert.deepEqual(runIn(await workspace(), taskId).steps, completed.steps);
pass('Completed results remain immutable while an authorized supplemental note persists');

const transferInput = { departmentId, fromId: employee, toId: successor, unitIds: [], taskIds: [evidenceTaskId], runIds: [], reason: `합성 인수인계 ${suffix}` };
state = await command(employee, 'transfer.request', transferInput);
const cancelledId = state.workTransfers.find(transfer => transfer.reason === transferInput.reason && transfer.status === 'pending').id;
await command(foreign, 'transfer.cancel', { transferId: cancelledId }, 403);
state = await command(manager, 'transfer.cancel', { transferId: cancelledId });
assert.equal(state.workTransfers.find(transfer => transfer.id === cancelledId).status, 'cancelled');
assert.equal(state.workTransfers.find(transfer => transfer.id === cancelledId).requestedBy, employee);
pass('A department manager can cancel another employee’s request; outsiders cannot');

state = await workspace();
const usedPeriods = new Set([...state.performances.filter(record => record.authorId === employee).map(record => record.period), ...state.unitScorePlans.filter(plan => plan.personId === employee).map(plan => plan.period)]);
const period = recentHalves(state.serverTime).find(value => !usedPeriods.has(value));
assert.ok(period, 'Use a fresh isolated QA store after exhausting the synthetic periods.');
state = await command(employee, 'performance.saveHalf', { taskId: evidenceTaskId, period, description: '인수인계 전 작성한 본인 성과' });
const performanceId = state.performances.find(record => record.taskId === evidenceTaskId && record.period === period && record.authorId === employee).id;
state = await command(employee, 'transfer.request', { ...transferInput, reason: `합성 실제 인계 ${suffix}` });
const transferId = state.workTransfers.find(transfer => transfer.taskIds.includes(evidenceTaskId) && transfer.status === 'pending').id;
await command(head, 'transfer.approve', { transferId });
await login(employee); state = await workspace();
assert.equal(taskIn(state, evidenceTaskId), undefined);
assert.ok(recordIn(state, performanceId));
assert.equal(taskIn(await workspace(successor), evidenceTaskId).primaryId, successor);
pass('Real transfer removes former task access but preserves the author’s historical performance');

const evidenceBytes = Buffer.from(`합성 성과 증빙 ${suffix}`);
const descriptor = { taskId: evidenceTaskId, performanceId, name: `qa-performance-${suffix}.txt`, size: evidenceBytes.length, mime: 'text/plain', sha256: createHash('sha256').update(evidenceBytes).digest('hex') };
const prepared = await request('/api/attachments/upload', { user: employee, method: 'POST', body: { action: 'prepare', file: descriptor } });
assert.equal(prepared.data.provider, 'local');
await request('/api/attachments/upload', { user: successor, method: 'POST', body: { action: 'prepare', file: descriptor }, expected: 403 });
const { performanceId: _scope, ...unscoped } = descriptor;
await request('/api/attachments/upload', { user: employee, method: 'POST', body: { action: 'prepare', file: unscoped }, expected: 403 });
const form = new FormData(); form.set('taskId', evidenceTaskId); form.set('performanceId', performanceId); form.set('file', new Blob([evidenceBytes], { type: 'text/plain' }), descriptor.name);
state = (await request('/api/attachments', { user: employee, method: 'POST', body: form })).data;
const attachment = state.attachments.find(file => file.name === descriptor.name && file.performanceId === performanceId);
assert.ok(attachment);
assert.ok(!(await workspace(successor)).attachments.some(file => file.id === attachment.id));
await request(`/api/attachments/${encodeURIComponent(attachment.id)}`, { user: successor, expected: 403 });
await request('/api/procedure-extract', { user: successor, method: 'POST', body: { taskId: evidenceTaskId, attachmentId: attachment.id }, expected: 403 });
await command(successor, 'performance.saveHalf', { taskId: evidenceTaskId, period, description: '다른 사람의 성과 파일 재사용', attachmentIds: [attachment.id] }, 422, 'PERFORMANCE_ATTACHMENT_INVALID');
await command(successor, 'task.configure', { taskId: evidenceTaskId, descriptionAttachmentIds: [attachment.id] }, 422, 'DESCRIPTION_ATTACHMENT_INVALID');
state = await command(employee, 'performance.saveHalf', { taskId: evidenceTaskId, period, description: '인계 후 보완한 성과', attachmentIds: [attachment.id] });
await login(employee); state = await workspace();
assert.deepEqual(recordIn(state, performanceId).attachmentIds, [attachment.id]);
assert.equal(state.attachments.find(file => file.id === attachment.id).performanceId, performanceId);
assert.ok(!(await workspace(successor)).attachments.some(file => file.id === attachment.id));
pass('Historical scoped upload/link survives login and never grants successor file access or reuse');

const allocations = state.units.filter(unit => !unit.deletedAt && unit.ownerId === employee && unit.departmentId === departmentId).map(unit => ({ unitId: unit.id, maxScore: unit.id === unitId ? 50 : 0 }));
assert.ok(allocations.some(unit => unit.maxScore === 50));
state = await command(employee, 'performance.setWeights', { period, allocations });
const planVersion = state.unitScorePlans.find(plan => plan.personId === employee && plan.period === period).version;
await command(employee, 'performance.submitPerson', { period, planVersion });
const submissionNotice = (await workspace(head)).notifications.find(notice => notice.destination?.view === 'performance' && notice.destination.personId === employee && notice.destination.period === period);
assert.ok(submissionNotice);
await request('/api/attachments/upload', { user: employee, method: 'POST', body: { action: 'prepare', file: descriptor }, expected: 409 });
await command(employee, 'performance.withdrawSubmission', { period });
assert.equal((await request('/api/attachments/upload', { user: employee, method: 'POST', body: { action: 'prepare', file: descriptor } })).data.provider, 'local');
await command(employee, 'performance.submitPerson', { period, planVersion });
await command(head, 'performance.evaluatePerson', { personId: employee, period, planVersion, scores: allocations.map(unit => ({ unitId: unit.unitId, score: unit.maxScore })), comment: '합성 HTTP 검증 평가' });
state = await workspace();
assert.equal(recordIn(state, performanceId).status, 'confirmed');
assert.ok(state.notifications.some(notice => notice.destination?.view === 'performance' && notice.destination.personId === employee && notice.destination.period === period));
await request('/api/attachments/upload', { user: employee, method: 'POST', body: { action: 'prepare', file: descriptor }, expected: 409 });
assert.ok(!(await workspace(successor)).attachments.some(file => file.id === attachment.id));
pass('Submission/evaluation lock further uploads and notifications point to the correct person and half-year');

console.log(JSON.stringify({ success: true, checks, localOnly: true, unitId, taskId, evidenceTaskId, runId, performanceId, attachmentId: attachment.id, transferId, period }));

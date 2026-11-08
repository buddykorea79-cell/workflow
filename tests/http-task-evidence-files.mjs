import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { currentHalf } from './helpers/http-period.mjs';

// Start an isolated local server with IEUM_DATA_DIR=.data/qa-simple-task,
// DATABASE_URL='' and local storage on port 3001 before running this script.
const base = process.argv[2] || 'http://127.0.0.1:3001';
const origin = new URL(base);
assert.equal(origin.protocol, 'http:');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname));
assert.equal(origin.port, '3001', 'Only use the isolated QA server on port 3001.');
assert.equal(origin.pathname, '/');
assert.equal(origin.search + origin.hash + origin.username + origin.password, '');
const owner = 'u-support-member';
const cookies = new Map();
const marker = randomUUID().slice(0, 8);
let checks = 0;
function pass(name) { checks++; console.log(`PASS ${name}`); }
async function request(route, { user = owner, method = 'GET', body, expected = 200 } = {}) {
  const multipart = body instanceof FormData;
  const response = await fetch(origin.origin + route, {
    method,
    headers: { Origin: origin.origin, ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}), ...(cookies.has(user) ? { Cookie: cookies.get(user) } : {}) },
    body: multipart ? body : body ? JSON.stringify(body) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(data).slice(0, 1000)}`);
  return { data, response };
}
async function login(userId = owner) {
  const { data, response } = await request('/api/session', { user: userId, method: 'POST', body: { userId } });
  cookies.set(userId, response.headers.get('set-cookie').split(';')[0]);
  assert.equal(data.mode, 'local', 'Do not run mutation QA against a connected database.');
  assert.equal(data.integrations.storage, '로컬 격리 저장', 'Only local isolated attachment storage is supported.');
  return data;
}
async function workspace() { return (await request('/api/workspace')).data; }
async function command(type, payload, expected = 200) {
  const current = await workspace();
  return (await request('/api/commands', { method: 'POST', expected, body: { type, payload, expectedRevision: current.revision, requestId: randomUUID() } })).data;
}

let state = await login();
assert.notEqual(state.departmentWorkPlans.find(plan => plan.departmentId === state.currentUser.departmentId)?.status, 'confirmed', 'Use a fresh isolated QA store with editable department definitions.');
pass('The target is the isolated local workspace and local attachment store');

const unitTitle = `QA 절차 파일 ${marker}`;
state = await command('unit.create', { title: unitTitle, description: '절차·일정·성과 파일 연결을 확인하는 합성 검증 업무입니다.' });
const unitId = state.units.find(unit => unit.title === unitTitle).id;
const taskTitle = `QA 간편 세부업무 ${marker}`;
const workflow = [
  { id: `prepare-${marker}`, title: '자료 취합', role: 'primary', description: '필요한 자료를 모아 목록을 작성합니다.', output: '', required: true, dependsOn: [], checklist: [] },
  { id: `support-${marker}`, title: '추가 자료 확인', role: 'primary', description: '추가 자료가 있으면 확인합니다.', output: '', required: false, dependsOn: [], checklist: [] },
  { id: `review-${marker}`, title: '결과 검토', role: 'reviewer', description: '취합한 결과를 확인합니다.', output: '', required: true, dependsOn: [`prepare-${marker}`], checklist: [] },
];
state = await command('task.create', { title: taskTitle, description: '실제 업무나 개인정보를 포함하지 않는 HTTP 검증용 세부업무입니다.', unitId, primaryId: owner, supportIds: [], dueDate: '2026-11-30', frequency: 'once', workflow });
const taskId = state.tasks.find(task => task.title === taskTitle).id;
const taskIn = current => current.tasks.find(task => task.id === taskId);
const runIn = current => current.runs.find(run => run.taskId === taskId);
pass('A detailed task is created with three saved procedures');

const content = '합성 참고자료\n담당자는 자료를 취합하고 검토자는 결과를 확인한다.\n';
const fileName = `qa-evidence-${marker}.txt`;
const form = new FormData();
form.set('taskId', taskId);
form.set('file', new Blob([content], { type: 'text/plain' }), fileName);
state = (await request('/api/attachments', { method: 'POST', body: form })).data;
const file = state.attachments.find(item => item.taskId === taskId && item.name === fileName);
assert.ok(file);
assert.equal(file.status, 'quarantined');
assert.equal(file.size, Buffer.byteLength(content));
pass('A synthetic text file uploads and remains quarantined');

state = await command('task.configure', { taskId, workflow: workflow.map((step, index) => ({ ...step, attachmentIds: index === 0 ? [file.id] : [] })) });
state = await workspace();
assert.deepEqual(taskIn(state).workflow[0].attachmentIds, [file.id]);
assert.deepEqual(taskIn(state).workflow[1].attachmentIds, []);
assert.deepEqual(taskIn(state).versions.at(-1).workflow[0].attachmentIds, [file.id]);
pass('Per-procedure file links persist in the task and saved definition after reopening');

const stepSchedules = [
  { stepId: workflow[0].id, startDate: '2026-11-10', dueDate: '2026-11-11' },
  { stepId: workflow[1].id },
  { stepId: workflow[2].id, dueDate: '2026-11-12' },
];
const dates = stepSchedules.flatMap(step => [step.startDate, step.dueDate]).filter(Boolean).sort();
const definitionVersion = taskIn(state).version;
state = await command('run.schedule', { taskId, startDate: dates[0], dueDate: dates.at(-1), steps: stepSchedules });
const runId = runIn(state).id;
assert.equal(runIn(state).startDate, '2026-11-10');
assert.equal(runIn(state).dueDate, '2026-11-12');
assert.equal(taskIn(state).dueDate, '2026-11-30');
assert.equal(taskIn(state).cycleStartDate, '2026-11-10');
assert.equal(taskIn(state).cycleDueDate, '2026-11-12');
assert.equal(taskIn(state).version, definitionVersion);
assert.equal(taskIn(state).workflow[1].startDate, undefined);
assert.equal(taskIn(state).workflow[1].dueDate, undefined);
assert.equal(taskIn(state).workflow[2].startDate, undefined);
assert.equal(taskIn(state).workflow[2].dueDate, '2026-11-12');
assert.deepEqual(runIn(state).workflowSnapshot[0].attachmentIds, [file.id]);
pass('Procedure dates define the cycle range while the task deadline, undated procedures and file links are preserved');

const period = currentHalf(state.serverTime);
const description = '부서별 자료를 취합하고 누락 항목을 확인하여 검토 시간을 줄였습니다.';
state = await command('performance.saveHalf', { taskId, period, description, attachmentIds: [file.id] });
const performanceIn = current => current.performances.find(item => item.taskId === taskId && item.period === period);
const performanceId = performanceIn(state).id;
assert.equal(performanceIn(state).description, description);
assert.equal(performanceIn(state).title, taskTitle);
assert.equal(performanceIn(state).evidence, '');
assert.deepEqual(performanceIn(state).attachmentIds, [file.id]);
assert.equal(performanceIn(state).status, 'draft');
pass('Performance content and a reference file save without title or evidence fields');

const boundaryDescription = '가'.repeat(500);
state = await command('performance.saveHalf', { taskId, period, description: boundaryDescription, attachmentIds: [file.id] });
assert.equal(performanceIn(state).id, performanceId);
assert.equal(performanceIn(state).description.length, 500);
assert.equal(state.performances.filter(item => item.taskId === taskId && item.period === period).length, 1);
pass('Exactly 500 characters update the same performance record');

const beforeRejected = structuredClone(performanceIn(state));
const rejected = await command('performance.saveHalf', { taskId, period, description: '가'.repeat(501), attachmentIds: [file.id] }, 422);
assert.equal(rejected.code, 'VALIDATION_ERROR');
state = await workspace();
assert.deepEqual(performanceIn(state), beforeRejected);
pass('501 characters are rejected without modifying the saved performance');

await request('/api/session', { method: 'DELETE' });
cookies.delete(owner);
state = await login();
assert.deepEqual(taskIn(state).workflow[0].attachmentIds, [file.id]);
assert.equal(taskIn(state).workflow[0].startDate, '2026-11-10');
assert.equal(taskIn(state).workflow[1].dueDate, undefined);
assert.equal(runIn(state).id, runId);
assert.deepEqual(performanceIn(state), beforeRejected);
assert.equal(state.attachments.find(item => item.id === file.id).status, 'quarantined');
pass('Procedure files, partial schedules and performance files survive logout and re-login');

const download = await request(`/api/attachments/${encodeURIComponent(file.id)}`, { expected: 409 });
assert.equal(download.data.code, 'FILE_QUARANTINED');
state = await workspace();
assert.equal(state.attachments.find(item => item.id === file.id).status, 'quarantined');
pass('Download stays blocked pending the existing administrator quarantine check');

console.log(JSON.stringify({ success: true, checks, base: origin.origin, taskId, runId, performanceId, attachmentId: file.id, unitId }));

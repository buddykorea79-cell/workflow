import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// This scenario creates synthetic business records only in the isolated local
// QA server. It never invokes extraction, AI, attachment storage or a database.
const address = new URL(process.argv[2] || 'http://127.0.0.1:3001');
assert.equal(address.protocol, 'http:');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname));
assert.equal(address.port, '3001', 'Use the isolated QA server on port 3001 only.');
assert.equal(address.pathname, '/'); assert.equal(address.search, ''); assert.equal(address.hash, '');
assert.equal(address.username, ''); assert.equal(address.password, '');
const base = address.origin;
const owner = 'u-seoyeon', head = 'u-head', foreign = 'u-support-member';
const cookies = new Map();
const suffix = randomUUID().slice(0, 8);
let checks = 0, lastCommand;
const pass = name => { checks++; console.log(`PASS ${name}`); };
const assertLocal = state => assert.equal(state.mode, 'local', 'Refusing to change a workspace connected to a real database.');

async function request(route, { user, method = 'GET', body, expected = 200 } = {}) {
  assert.ok(['/api/session', '/api/workspace', '/api/commands'].includes(route));
  const response = await fetch(base + route, { method, headers: { Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(user ? { Cookie: cookies.get(user) || '' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify({ status: response.status, code: data.code, error: data.error }));
  return { data, response };
}
async function login(userId) {
  const { data, response } = await request('/api/session', { method: 'POST', body: { userId } });
  assertLocal(data);
  const cookie = response.headers.get('set-cookie'); assert.ok(cookie);
  cookies.set(userId, cookie.split(';')[0]);
  return data;
}
async function workspace(user = owner) { const { data } = await request('/api/workspace', { user }); assertLocal(data); return data; }
async function command(user, type, payload, requestId = randomUUID()) {
  const current = await workspace(user);
  const target = ['task.configure', 'task.procedure.replace'].includes(type) || type === 'run.schedule' && !payload.runId
    ? { kind: 'task', id: payload.taskId, entity: current.tasks.find(item => item.id === payload.taskId) }
    : type === 'run.completeStep' || type === 'run.schedule'
      ? { kind: 'run', id: payload.runId, entity: current.runs.find(item => item.id === payload.runId) } : null;
  const envelope = { type, payload, expectedRevision: current.revision, requestId, ...(target ? { expected: { kind: target.kind, id: target.id, rev: target.entity?.rev ?? 0 } } : {}) };
  // A target conflict requires the user to review the draft. Never retry it
  // against a newly fetched revision and silently overwrite another change.
  const { data } = await request('/api/commands', { user, method: 'POST', body: envelope });
  assertLocal(data); lastCommand = envelope; return data;
}

let state = await login(owner); await login(head); await login(foreign);
assert.ok(!state.departmentWorkPlans.some(plan => plan.departmentId === 'dept-plan' && plan.status === 'confirmed'), 'Start this test with an editable isolated department; do not reopen another scenario.');
pass('All sessions explicitly report local mode before any mutation');

const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(state.serverTime));
const dueDate = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
const unitTitle = `QA 최종 절차 ${suffix}`, taskTitle = `QA 절차 교체 검증 ${suffix}`;
state = await command(owner, 'unit.create', { title: unitTitle, description: '격리 HTTP 검증용 단위업무' });
const unitId = state.units.find(unit => unit.title === unitTitle)?.id; assert.ok(unitId);
const oldWorkflow = [
  { id: `old-${suffix}-prepare`, title: '이전 자료 작성', role: 'primary', description: '가상 자료를 작성합니다.', output: '이전 자료', required: true, dependsOn: [], checklist: ['이전 자료 확인'] },
  { id: `old-${suffix}-review`, title: '이전 자료 검토', role: 'reviewer', description: '가상 자료를 검토합니다.', output: '이전 검토 의견', required: true, dependsOn: [`old-${suffix}-prepare`], checklist: ['이전 검토 완료'] },
  { id: `old-${suffix}-report`, title: '이전 결과 보고', role: 'primary', description: '가상 결과를 보고합니다.', output: '이전 보고서', required: true, dependsOn: [`old-${suffix}-review`], checklist: ['이전 보고 완료'] },
];
state = await command(owner, 'task.create', { title: taskTitle, description: '실제 AI 호출 없이 결정론적 절차 초안을 적용하는 가상 업무입니다.', unitId, primaryId: owner, supportIds: [], frequency: 'monthly', dueDate, workflow: oldWorkflow });
const taskId = state.tasks.find(task => task.title === taskTitle)?.id; assert.ok(taskId);
const taskIn = snapshot => { const task = snapshot.tasks.find(item => item.id === taskId); assert.ok(task); return task; };
const runIn = snapshot => { const runs = snapshot.runs.filter(run => run.taskId === taskId); assert.equal(runs.length, 1); return runs[0]; };
const business = snapshot => ({ task: taskIn(snapshot), runs: snapshot.runs.filter(run => run.taskId === taskId) });
state = await command(owner, 'run.schedule', { taskId, title: `QA 원래 회차 ${suffix}`, startDate: today, dueDate, scheduleDetails: '절차 교체 후에도 유지되어야 하는 회차 일정', steps: oldWorkflow.map(step => ({ stepId: step.id })) });
const runId = runIn(state).id;
state = await command(owner, 'run.note', { runId, body: `교체 이전 수행 메모 ${suffix}` });
for (const check of runIn(state).steps[0].checklist) state = await command(owner, 'run.check', { runId, stepId: oldWorkflow[0].id, checkId: check.id, done: true });
state = await command(owner, 'run.completeStep', { runId, stepId: oldWorkflow[0].id, output: `이전 단계의 실제 수행 결과 ${suffix}` });
const originalRun = structuredClone(runIn(state)), originalTask = structuredClone(taskIn(state));
assert.equal(originalRun.steps[0].status, 'completed'); assert.equal(originalRun.steps[0].completedBy, owner); assert.ok(originalRun.steps[0].output);
pass('Synthetic task has one scheduled cycle with a completed step, checklist, output and note');

const draft = [
  { id: `final-${suffix}-prepare`, title: '최종 근거 자료 작성', role: 'primary', description: '검토한 가상 근거에 따라 자료를 작성합니다.', output: '최종 자료', required: true, dependsOn: [], checklist: ['최종 자료 확인'], done: true },
  { id: `final-${suffix}-review`, title: '최종 근거 자료 검토', role: 'reviewer', description: '가상 결과를 부서장이 검토합니다.', output: '최종 검토 결과', required: true, dependsOn: [`final-${suffix}-prepare`], checklist: ['최종 검토 완료'], done: true },
];
const references = [{ id: `source-${suffix}`, type: 'guideline', title: '가상 최종 업무 지침', content: '담당자는 근거 자료를 작성하고 부서장은 작성한 결과를 검토한다.' }];
const payload = { taskId, workflow: draft, references, reason: 'HTTP 검증에서 편집한 단일 최종 절차 적용' };
state = await command(owner, 'task.procedure.replace', payload);
const appliedEnvelope = structuredClone(lastCommand);
const appliedTask = taskIn(state), appliedRun = runIn(state);
assert.equal(appliedTask.workflow.length, draft.length);
assert.deepEqual(appliedTask.workflow.map(step => step.id), draft.map(step => step.id));
assert.ok(appliedTask.workflow.every(step => !step.done && !oldWorkflow.some(old => old.id === step.id)));
assert.deepEqual(appliedTask.references, references); assert.equal(appliedTask.version, originalTask.version + 1);
assert.equal(appliedRun.id, runId);
for (const key of ['title', 'startDate', 'dueDate', 'scheduleDetails', 'period']) assert.equal(appliedRun[key], originalRun[key]);
assert.deepEqual(appliedRun.notes, originalRun.notes);
assert.deepEqual(appliedRun.steps.map(step => step.stepId), draft.map(step => step.id));
assert.ok(appliedRun.steps.every(step => step.status === 'pending' && !step.output && !step.completedAt && !step.completedBy && step.checklist.every(check => !check.done)));
assert.equal(appliedRun.procedureHistory.length, 1);
const savedHistory = structuredClone(appliedRun.procedureHistory[0]);
assert.equal(savedHistory.replacedBy, owner); assert.equal(savedHistory.reason, payload.reason);
assert.deepEqual(savedHistory.steps, originalRun.steps); assert.deepEqual(savedHistory.notes, originalRun.notes);
assert.deepEqual(savedHistory.workflowSnapshot.map(step => ({ id: step.id, done: !!step.done })), originalRun.steps.map(step => ({ id: step.stepId, done: step.status === 'completed' })));
pass('Apply replaces three old steps with two fresh steps and archives execution on the same cycle');

const replay = (await request('/api/commands', { user: owner, method: 'POST', body: appliedEnvelope })).data;
assertLocal(replay); assert.deepEqual(business(replay), business(state));
pass('Replaying the exact apply request cannot duplicate steps or procedure history');

await login(owner); state = await workspace();
assert.equal(runIn(state).id, runId); assert.deepEqual(taskIn(state).workflow.map(step => step.id), draft.map(step => step.id));
assert.deepEqual(runIn(state).procedureHistory[0], savedHistory);
const staleRevision = state.revision, staleExpected = { kind: 'task', id: taskId, rev: taskIn(state).rev ?? 0 };
const edited = structuredClone(taskIn(state).workflow);
edited[0].title = '사용자가 수정한 최종 자료 작성';
edited[0].description = '사용자가 실제 수행에 맞게 수정한 가상 설명';
edited[0].output = '수정한 결과물'; edited[0].checklist = ['수정한 확인 항목'];
state = await command(owner, 'task.configure', { taskId, workflow: edited });
await login(owner); state = await workspace();
assert.deepEqual(taskIn(state).workflow, edited); assert.equal(runIn(state).steps[0].title, edited[0].title);
assert.deepEqual(runIn(state).workflowSnapshot, edited); assert.deepEqual(runIn(state).procedureHistory[0], savedHistory);
pass('Relogin preserves the single final procedure and later manual editing saves its current steps');

async function rejected(actor, body, expected, code) {
  const before = business(await workspace());
  const { data } = await request('/api/commands', { user: actor, method: 'POST', body, expected });
  assert.equal(data.code, code);
  assert.deepEqual(business(await workspace()), before, `${code} must not partially change task, steps or execution history`);
}
async function denied(actor, replacement, expected, code) {
  const current = await workspace();
  await rejected(actor, { type: 'task.procedure.replace', payload: replacement, expectedRevision: current.revision, requestId: randomUUID() }, expected, code);
}
await rejected(owner, { type: 'task.procedure.replace', payload, expectedRevision: staleRevision, expected: staleExpected, requestId: randomUUID() }, 409, 'TARGET_CONFLICT');
await rejected(owner, { ...appliedEnvelope, payload: { ...payload, reason: '재사용 요청 내용 변경' } }, 409, 'IDEMPOTENCY_CONFLICT');
pass('Stale saves and reused request IDs with different content fail atomically');

await denied(owner, { ...payload, workflow: draft.map((step, index) => ({ ...step, dependsOn: [draft[1 - index].id] })) }, 422, 'WORKFLOW_CYCLE');
await denied(owner, { ...payload, workflow: [draft[0]] }, 422, 'REVIEW_REQUIRED');
await denied(owner, { ...payload, references: [{ ...references[0], content: '', attachmentId: 'nonexistent-other-task-file' }] }, 422, 'REFERENCE_ATTACHMENT_INVALID');
pass('Cycles, missing required review and invalid file ownership leave the saved final procedure intact');
await denied(foreign, payload, 403, 'TASK_ACCESS_DENIED');
await denied(head, payload, 403, 'HEAD_DEFINITION_DENIED');
await denied(undefined, payload, 401, 'SIGN_IN_REQUIRED');
pass('Foreign department, read-only head and unsigned callers cannot replace the procedure');

state = await workspace();
for (const check of runIn(state).steps[0].checklist) state = await command(owner, 'run.check', { runId, stepId: edited[0].id, checkId: check.id, done: true });
state = await command(owner, 'run.completeStep', { runId, stepId: edited[0].id, output: '수정된 최종 절차의 수행 결과' });
assert.equal(runIn(state).steps[0].completedBy, owner);
assert.deepEqual(runIn(state).procedureHistory[0], savedHistory);
assert.equal(runIn(state).id, runId); assert.equal(taskIn(state).workflow.length, 2);
pass('The newly edited procedure can execute without changing archived completion records');
console.log(JSON.stringify({ success: true, checks, taskId, runId, unitId, taskTitle, finalSteps: taskIn(state).workflow.length, procedureHistories: runIn(state).procedureHistory.length, mode: state.mode }));

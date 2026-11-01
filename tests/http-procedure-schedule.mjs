import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.argv[2] || 'http://127.0.0.1:3001';
const origin = new URL(base);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname));
assert.equal(origin.port, '3001', 'Use the isolated QA store on port 3001 only.');
const employee = 'u-support-member', head = 'u-support-head', foreign = 'u-jiho';
const cookies = new Map();
let checks = 0;
const pass = name => { checks++; console.log(`PASS ${name}`); };
async function request(path, { user, method = 'GET', body, expected = 200 } = {}) {
  const multipart = body instanceof FormData;
  const response = await fetch(base + path, { method, headers: { Origin: origin.origin, ...(body && !multipart ? { 'Content-Type': 'application/json' } : {}), ...(user ? { Cookie: cookies.get(user) || '' } : {}) }, body: multipart ? body : body ? JSON.stringify(body) : undefined });
  const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data).slice(0, 1000));
  return { data, response };
}
async function login(userId) { const result = await request('/api/session', { method: 'POST', body: { userId } }); cookies.set(userId, result.response.headers.get('set-cookie').split(';')[0]); return result.data; }
async function workspace(user = employee) { return (await request('/api/workspace', { user })).data; }
async function command(user, type, payload, expected = 200) { const state = await workspace(user); return (await request('/api/commands', { user, method: 'POST', expected, body: { type, payload, expectedRevision: state.revision, requestId: randomUUID() } })).data; }
const suffix = randomUUID().slice(0, 8);
const unitTitle = `QA 근거·일정 ${suffix}`;
const taskTitle = `QA 근거 기반 업무 사이클 ${suffix}`;
await Promise.all([employee, head, foreign].map(login));
let state = await command(employee, 'unit.create', { title: unitTitle, description: '격리 저장소에서만 사용하는 합성 검증 업무' });
const unitId = state.units.find(unit => unit.title === unitTitle).id;
const workflow = [
  { id: 'qa-prepare', title: '근거 자료 준비', role: 'primary', description: '합성 지침과 결과 문서를 확인합니다.', output: '자료 목록', required: true, dependsOn: [], checklist: ['자료 확인'] },
  { id: 'qa-review', title: '근거와 결과 검토', role: 'reviewer', description: '근거에 따라 검토합니다.', output: '검토 의견', required: true, dependsOn: ['qa-prepare'], checklist: ['검토 완료'] },
  { id: 'qa-submit', title: '완료 보고서 제출', role: 'primary', description: '검토한 결과물을 제출합니다.', output: '완료 보고서', required: true, dependsOn: ['qa-review'], checklist: ['제출 확인'] },
];
state = await command(employee, 'task.create', { title: taskTitle, description: '법령·지침과 생산 문서를 근거로 절차를 수행하는 합성 검증 업무입니다.', unitId, primaryId: employee, supportIds: [], reviewerId: head, dueDate: '2026-11-30', frequency: 'monthly', workflow });
const taskId = state.tasks.find(task => task.title === taskTitle).id;
const taskIn = state => state.tasks.find(task => task.id === taskId);
const latest = state => state.runs.filter(run => run.taskId === taskId).map((run, index) => ({ run, index })).sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt) || a.index - b.index)[0]?.run;
pass('A synthetic unit and procedure are created independently of existing tasks');

const form = new FormData(); form.set('taskId', taskId); form.set('file', new Blob(['합성 결과 보고서\n업무 자료 확인과 검토를 완료하고 최종 결과를 제출한다.'], { type: 'text/plain' }), 'qa-produced-document.txt');
state = (await request('/api/attachments', { user: employee, method: 'POST', body: form })).data;
const attachment = state.attachments.find(item => item.taskId === taskId);
assert.ok(attachment); assert.equal(attachment.name, 'qa-produced-document.txt'); assert.equal(attachment.status, 'quarantined');
state = await command(employee, 'task.configure', { taskId, references: [
  { id: 'qa-guideline', type: 'guideline', title: '합성 업무 처리 지침', content: '제1조 담당자는 자료를 준비한다.\n제2조 검토자는 근거와 결과를 검토한다.\n제3조 담당자는 완료 보고서를 제출한다.', url: 'https://example.com/qa-guideline' },
  { id: 'qa-document', type: 'document', title: '생산한 완료 보고서', content: '', attachmentId: attachment.id },
] });
await login(employee); state = await workspace();
assert.equal(taskIn(state).references[1].attachmentId, attachment.id); assert.equal(taskIn(state).references[1].type, 'document');
pass('Uploaded production document and text guideline references persist across login');

const schedule = { taskId, title: '11월 합성 업무 사이클', startDate: '2026-11-01', dueDate: '2026-11-30', scheduleDetails: '관련 근거 확인 후 검토와 제출까지 수행합니다.', steps: workflow.map((step, index) => ({ stepId: step.id, startDate: `2026-11-0${index * 2 + 1}`, dueDate: `2026-11-0${index * 2 + 2}`, scheduleDetails: `${step.title}의 필요한 자료와 세부 계획` })) };
state = await command(employee, 'run.schedule', schedule);
const currentId = latest(state).id; const definitionVersion = taskIn(state).version;
state = await workspace();
assert.equal(latest(state).scheduleDetails, schedule.scheduleDetails); assert.equal(taskIn(state).workflow[1].scheduleDetails, schedule.steps[1].scheduleDetails);
assert.equal(latest(state).workflowSnapshot[0].startDate, schedule.steps[0].startDate); assert.equal(taskIn(state).version, definitionVersion);
pass('Current schedule dates and detailed plans persist without a definition revision');
await command(head, 'run.schedule', { ...schedule, runId: currentId }, 403);
await command(foreign, 'run.schedule', { ...schedule, runId: currentId }, 403);
await command(employee, 'run.schedule', { ...schedule, runId: 'outdated' }, 409);
await command(employee, 'run.completeCycle', { taskId, runId: currentId }, 409);
pass('Current run identity, owner permission and unfinished-cycle protection apply');

for (const step of workflow) {
  state = await workspace(); const run = latest(state); const execution = run.steps.find(item => item.stepId === step.id); const actor = step.role === 'reviewer' ? head : employee;
  for (const check of execution.checklist) await command(actor, 'run.check', { runId: run.id, stepId: step.id, checkId: check.id, done: true });
  await command(actor, 'run.completeStep', { runId: run.id, stepId: step.id, output: `${step.title} 검증 결과` });
}
state = await command(employee, 'run.completeCycle', { taskId, runId: currentId });
const completed = structuredClone(latest(state));
assert.equal(completed.status, 'completed'); assert.ok(completed.steps.every(step => step.status === 'completed' && step.output && step.completedBy));
await command(employee, 'run.schedule', { ...schedule, runId: currentId }, 409);
pass('Checklist and reviewer execution complete the cycle and freeze its schedule');

const nextSchedule = { ...schedule, previousRunId: currentId, title: '12월 합성 업무 사이클', startDate: '2026-12-01', dueDate: '2026-12-31', scheduleDetails: '다음 회차의 새 상세 계획', steps: schedule.steps.map(step => ({ ...step, startDate: step.startDate.replace('-11-', '-12-'), dueDate: step.dueDate.replace('-11-', '-12-'), scheduleDetails: '12월 새 절차 세부 내용' })) };
state = await command(employee, 'run.nextCycle', nextSchedule);
assert.notEqual(latest(state).id, currentId); assert.equal(latest(state).previousRunId, currentId);
assert.equal(latest(state).scheduleDetails, nextSchedule.scheduleDetails); assert.ok(latest(state).steps.every(step => step.status !== 'completed' && !step.output && step.checklist.every(check => !check.done)));
assert.deepEqual(state.runs.find(run => run.id === currentId), completed);
await command(employee, 'run.nextCycle', nextSchedule, 409);
pass('New cycle gets fresh dates/details and progress while complete history stays unchanged');
await login(employee); state = await workspace();
assert.equal(taskIn(state).workflow[0].scheduleDetails, '12월 새 절차 세부 내용'); assert.deepEqual(state.runs.find(run => run.id === currentId), completed);
assert.equal((await workspace(foreign)).runs.some(run => run.taskId === taskId), false);
pass('New and historical cycle schedules survive reload and preserve task access controls');
console.log(JSON.stringify({ success: true, checks, taskId, taskTitle, unitTitle, currentRunId: latest(state).id, attachmentId: attachment.id }));

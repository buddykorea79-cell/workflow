import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.argv[2] || 'http://127.0.0.1:3001';
const origin = new URL(base);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname));
assert.equal(origin.port, '3001', 'Cycle mutations require the isolated QA store.');
const taskId = process.argv[3] || 'budget-demo-task-data-platform';
const employee = 'u-support-member', head = 'u-support-head', peer = 'u-doyun', foreign = 'u-jiho';
const cookies = new Map();
let checks = 0;
const pass = name => { checks++; console.log(`PASS ${name}`); };
async function request(path, { user, method = 'GET', body, expected = 200 } = {}) {
  const response = await fetch(base + path, { method, headers: { Origin: origin.origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(user ? { Cookie: cookies.get(user) || '' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data).slice(0, 800));
  return { data, response };
}
async function login(userId) { const result = await request('/api/session', { method: 'POST', body: { userId } }); cookies.set(userId, result.response.headers.get('set-cookie').split(';')[0]); }
async function workspace(user) { return (await request('/api/workspace', { user })).data; }
async function command(user, type, payload, expected = 200) {
  const state = await workspace(user);
  return (await request('/api/commands', { user, method: 'POST', expected, body: { type, payload, expectedRevision: state.revision, requestId: randomUUID() } })).data;
}
const latest = state => state.runs.filter(run => run.taskId === taskId).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
const taskIn = state => state.tasks.find(task => task.id === taskId);
await Promise.all([employee, head, peer, foreign].map(login));
let state = await workspace(employee);
assert.ok(taskIn(state));
const taskDeadline = taskIn(state).dueDate;
function nextPayload(state) {
  return { taskId, previousRunId: latest(state)?.id, title: '12월 업무 수행', startDate: '2026-12-01', dueDate: '2026-12-10', steps: taskIn(state).workflow.map((step, index) => ({ stepId: step.id, startDate: `2026-12-${String(index + 1).padStart(2, '0')}`, dueDate: `2026-12-${String(index + 1).padStart(2, '0')}` })) };
}
await command(employee, 'run.nextCycle', nextPayload(state), 409);
pass('An unfinished cycle cannot be restarted');
for (let attempt = 0; attempt < 50 && taskIn(state).workflow.some(step => !step.done); attempt++) {
  const task = taskIn(state);
  const step = task.workflow.find(step => !step.done && step.dependsOn.every(id => task.workflow.find(candidate => candidate.id === id)?.done));
  assert.ok(step, 'The next unfinished procedure must be reachable.');
  state = await command(step.role === 'reviewer' ? head : employee, 'task.setProgress', { taskId, stepId: step.id, done: true });
}
state = await workspace(employee);
assert.ok(taskIn(state).workflow.every(step => step.done));
assert.equal(latest(state).status, 'completed');
pass('The full procedure including the reviewer step completes');
const previous = structuredClone(latest(state));
const payload = nextPayload(state);
for (const actor of [head, peer, foreign]) await command(actor, 'run.nextCycle', payload, 403);
pass('Only the authorized task owner or administrator can start the next cycle');
await command(employee, 'run.nextCycle', { ...payload, dueDate: '2026-11-30' }, 422);
await command(employee, 'run.nextCycle', { ...payload, steps: payload.steps.map((step, index) => ({ ...step, dueDate: index === 0 ? '2026-02-30' : step.dueDate })) }, 422);
pass('Reversed and impossible schedule dates are rejected');
if (process.env.QA_LEAVE_CYCLE_READY === '1') {
  console.log(JSON.stringify({ success: true, checks, readyForBrowserCycle: true, taskId }));
} else {
  state = await command(employee, 'run.nextCycle', payload);
  const current = latest(state);
  assert.notEqual(current.id, previous.id);
  assert.equal(current.previousRunId, previous.id);
  assert.ok(current.steps.every(step => step.status !== 'completed' && step.checklist.every(item => !item.done)));
  assert.ok(taskIn(state).workflow.every(step => !step.done));
  pass('A distinct next cycle starts with fresh unchecked procedure state');
  const archived = state.runs.find(run => run.id === previous.id);
  for (const key of ['steps', 'notes', 'dueDate', 'completedAt', 'startedAt']) assert.deepEqual(archived[key], previous[key]);
  assert.ok(archived.workflowSnapshot?.length);
  pass('Completed dates, outputs, checklists and procedure history are preserved');
  assert.equal(taskIn(state).dueDate, taskDeadline);
  assert.equal(taskIn(state).cycleStartDate, payload.startDate);
  assert.equal(taskIn(state).cycleDueDate, payload.dueDate);
  assert.equal(current.dueDate, payload.dueDate);
  assert.equal(taskIn(state).workflow[0].startDate, payload.steps[0].startDate);
  assert.equal(taskIn(state).workflow[0].dueDate, payload.steps[0].dueDate);
  pass('The new cycle and procedure dates change while the task deadline stays fixed');
  await command(employee, 'run.nextCycle', payload, 409);
  pass('A duplicate or stale next-cycle request is rejected');
  await login(employee);
  state = await workspace(employee);
  assert.equal(latest(state).id, current.id);
  assert.ok(state.runs.some(run => run.id === previous.id && run.status === 'completed'));
  assert.ok((await workspace(head)).runs.some(run => run.id === previous.id));
  assert.equal((await workspace(foreign)).runs.some(run => run.taskId === taskId), false);
  pass('New and past cycles persist across sessions with department access controls');
  console.log(JSON.stringify({ success: true, checks, taskId, currentRunId: current.id }));
}

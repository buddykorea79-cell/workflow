import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Isolated instance only: IEUM_DATA_DIR=.qa-data/common-management-20261031.
const base = process.argv[2] || 'http://127.0.0.1:3001';
const origin = new URL(base);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname));
assert.equal(origin.port, '3001', 'Run only against the isolated QA server.');
const marker = `FLOW-${randomUUID().slice(0, 8)}`;
const cookies = new Map();
const checks = [];
function check(name, assertion) { assertion(); checks.push(name); console.log(`PASS ${name}`); }
async function request(path, { user, method = 'GET', body, expected = 200 } = {}) {
  const response = await fetch(base + path, { method, headers: { Origin: origin.origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(user ? { Cookie: cookies.get(user) || '' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data).slice(0, 600));
  return { data, response };
}
async function login(id) {
  const { data, response } = await request('/api/session', { method: 'POST', body: { userId: id } });
  cookies.set(id, response.headers.get('set-cookie').split(';')[0]);
  return data;
}
async function workspace(id) { return (await request('/api/workspace', { user: id })).data; }
async function command(user, type, payload, expected = 200) {
  if (!cookies.has(user)) await login(user);
  const state = await workspace(user);
  return (await request('/api/commands', { user, method: 'POST', body: { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, expected })).data;
}
const { data: directory } = await request('/api/session');
const owner = directory.users.find(u => u.role === 'member' && u.active);
assert.ok(owner);
const sourceHead = directory.users.find(u => u.departmentId === owner.departmentId && u.role === 'head' && u.active);
assert.ok(sourceHead);
const target = directory.departments.find(d => d.id !== owner.departmentId);
const manager = directory.users.find(u => u.departmentId === target.id && u.role === 'manager');
const lead = directory.users.find(u => u.departmentId === target.id && u.role === 'lead');
const member = directory.users.find(u => u.departmentId === target.id && u.role === 'member' && u.team === lead.team);
const head = directory.users.find(u => u.departmentId === target.id && u.role === 'head');
const initial = await login(owner.id);
const yesterday = new Date(initial.serverTime); yesterday.setUTCDate(yesterday.getUTCDate() - 1);
let state = await command(owner.id, 'common.create', { title: `${marker} 배정·진행 현황`, description: '격리된 현황 집계 검증', projectName: marker, frequency: 'once', dueDate: yesterday.toISOString().slice(0, 10), requiredSteps: ['자료 준비', '내용 검증', '결과 검토', '최종 제출'], departmentIds: directory.departments.map(d => d.id), distributionMode: 'all', kind: 'common' });
const commonId = state.commonTasks.find(c => c.title.startsWith(marker)).id;
const commonOf = w => w.commonTasks.find(c => c.id === commonId);
const distOf = w => commonOf(w).distributions.find(d => d.departmentId === target.id);
check('An ordinary staff author requests approval before any department receives work', () => {
  const c = commonOf(state); assert.equal(c.publicationStatus, 'pending'); assert.equal(c.distributions.length, 0);
});
const approval = commonOf(state).approvalRequests.find(request => request.status === 'pending');
assert.ok(approval && approval.departmentId === owner.departmentId);
await command(sourceHead.id, 'common.approve', { commonId, requestId: approval.id });
state = await workspace(owner.id);
const distributionId = distOf(state).id;
check('Owner sees all departments and the initial assignment backlog', () => {
  const c = commonOf(state);
  assert.equal(c.summary.totalDepartments, 3);
  assert.equal(c.summary.teamPending, 3);
  assert.equal(c.summary.averageProgress, 0);
  assert.ok(c.distributions.every(d => d.stage === 'team_pending' && d.progress === 0));
});
check('Unassigned overdue work identifies the department manager', () => {
  const d = distOf(state); assert.equal(d.overdue, true); assert.ok(d.nextActorIds.includes(manager.id)); assert.ok(d.nextAction);
});
state = await login(member.id);
check('Non-owner summaries count only visible department distributions', () => {
  const c = commonOf(state); assert.equal(c.distributions.length, 1); assert.equal(c.summary.totalDepartments, 1); assert.equal(c.summary.teamPending, 1);
});
await command(member.id, 'common.assignTeam', { commonId, distributionId, leadId: lead.id, team: lead.team }, 403);
check('A personal assignee cannot skip department assignment authority', () => assert.ok(true));
state = await command(manager.id, 'common.assignTeam', { commonId, distributionId, leadId: lead.id, team: lead.team });
check('Team assignment records its timestamp and the next team lead', () => {
  const d = distOf(state); assert.equal(d.stage, 'person_pending'); assert.ok(d.teamAssignedAt); assert.ok(d.nextActorIds.includes(lead.id)); assert.equal(d.team, lead.team);
});
state = await command(lead.id, 'common.assignPerson', { commonId, distributionId, assigneeId: member.id });
check('Personal assignment remains registration-pending with zero execution progress', () => {
  const d = distOf(state); assert.equal(d.stage, 'registration_pending'); assert.ok(d.personAssignedAt); assert.ok(d.nextActorIds.includes(member.id)); assert.equal(d.progress, 0);
});
state = await command(member.id, 'unit.create', { title: `${marker} 수행 단위`, description: '공통업무 등록 검증' });
const unitId = state.units.find(u => u.title === `${marker} 수행 단위`).id;
state = await command(member.id, 'common.register', { commonId, distributionId, unitId });
const taskId = distOf(state).taskId;
const task = state.tasks.find(t => t.id === taskId);
check('Registration connects the personal unit without implying task completion', () => {
  const d = distOf(state); assert.equal(d.stage, 'in_progress'); assert.ok(d.registeredAt); assert.equal(d.unitTitle, `${marker} 수행 단위`); assert.equal(d.progress, 0); assert.equal(d.totalSteps, 4);
});
state = await workspace(owner.id);
check('Owner receives cross-department status without private detail content', () => {
  assert.equal(distOf(state).unitTitle, `${marker} 수행 단위`);
  assert.ok(!state.tasks.some(t => t.id === taskId)); assert.ok(!state.runs.some(r => r.taskId === taskId));
});
await command(member.id, 'task.setProgress', { taskId, stepId: task.workflow[0].id, done: true });
state = await workspace(owner.id);
check('Fresh owner workspace reflects completed procedures and averages including unregistered departments', () => {
  const d = distOf(state), c = commonOf(state); assert.equal(d.progress, 25); assert.equal(d.completedSteps, 1); assert.equal(d.totalSteps, 4); assert.equal(c.summary.averageProgress, 8); assert.equal(c.summary.inProgress, 1); assert.equal(c.summary.teamPending, 2);
});
for (const step of task.workflow.slice(1)) await command(step.role === 'reviewer' ? head.id : member.id, 'task.setProgress', { taskId, stepId: step.id, done: true });
state = await workspace(owner.id);
check('Completion is reflected in the stage, counts and overdue exclusion', () => {
  const d = distOf(state), c = commonOf(state); assert.equal(d.stage, 'completed'); assert.equal(d.progress, 100); assert.equal(d.overdue, false); assert.equal(c.summary.completed, 1); assert.equal(c.summary.overdue, 2); assert.equal(c.summary.averageProgress, 33);
});
state = await command(member.id, 'task.setProgress', { taskId, stepId: task.workflow.at(-1).id, done: false });
check('Reopening execution returns the distribution to in-progress', () => { const d = distOf(state); assert.equal(d.stage, 'in_progress'); assert.equal(d.progress, 75); assert.equal(d.overdue, true); });
await login(owner.id);
state = await workspace(owner.id);
check('A fresh owner session preserves current stage and audit-derived activity time', () => { const d = distOf(state); assert.equal(d.progress, 75); assert.ok(d.updatedAt); assert.ok(!d.nextActorIds.includes(owner.id)); });
console.log(JSON.stringify({ success: true, assertions: checks.length, marker, commonId, taskId, checks }, null, 2));

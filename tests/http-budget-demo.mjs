import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Run after setup-budget-demo.ts against a copied store on isolated port 3001.
const base = process.argv[2] || 'http://127.0.0.1:3001';
const origin = new URL(base);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname));
assert.equal(origin.port, '3001', 'Do not run mutation checks against the user workspace.');
const cookies = new Map();
const checks = [];
function check(name, action) { action(); checks.push(name); console.log(`PASS ${name}`); }
async function request(path, { user, method = 'GET', body, expected = 200 } = {}) {
  const response = await fetch(base + path, { method, headers: { Origin: origin.origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(user ? { Cookie: cookies.get(user) || '' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data).slice(0, 500));
  return { data, response };
}
async function login(id) {
  const { data, response } = await request('/api/session', { method: 'POST', body: { userId: id } });
  cookies.set(id, response.headers.get('set-cookie').split(';')[0]);
  return data;
}
async function command(user, type, payload, expected = 200) {
  if (!cookies.has(user)) await login(user);
  const { data: state } = await request('/api/workspace', { user });
  return (await request('/api/commands', { user, method: 'POST', expected, body: { type, payload, expectedRevision: state.revision, requestId: randomUUID() } })).data;
}
const { data: directory } = await request('/api/session');
const budgetUser = directory.users.find(user => user.id === 'u-jiho');
check('Budget common owner remains an ordinary planning-department staff account', () => {
  assert.equal(budgetUser.departmentId, 'dept-plan'); assert.equal(budgetUser.role, 'member'); assert.equal(Object.hasOwn(budgetUser, 'commonTaskPermission'), false); assert.match(budgetUser.title, /예산/);
});
check('Data department supplies all ordinary demonstration roles', () => {
  for (const role of ['member', 'lead', 'manager', 'head', 'admin']) assert.ok(directory.users.some(user => user.departmentId === 'dept-support' && user.role === role && user.active));
});
const state = await login(budgetUser.id);
const ownUnits = state.units.filter(unit => unit.ownerId === budgetUser.id && !unit.deletedAt);
const ownBudgetTasks = state.tasks.filter(task => task.primaryId === budgetUser.id && !task.deletedAt && task.tags.includes('예산'));
check('Budget staff has structured unit and detail examples with usable procedures', () => {
  assert.ok(ownUnits.length >= 3); assert.ok(ownBudgetTasks.length >= 6);
  for (const task of ownBudgetTasks) { assert.ok(state.units.some(unit => unit.id === task.unitId)); assert.ok(task.description); assert.ok(task.workflow.length); }
});
check('Examples include fictional amounts and task context', () => {
  assert.ok(ownBudgetTasks.some(task => task.budget > 0));
  assert.ok(ownBudgetTasks.some(task => task.expenses?.length));
  assert.ok(ownBudgetTasks.some(task => task.references?.length));
  assert.ok(ownBudgetTasks.some(task => task.workflow.some(step => step.dueDate)));
});
const ownedCommon = state.commonTasks.filter(common => common.managerId === budgetUser.id);
check('Budget staff manages cross-department common examples', () => {
  assert.ok(ownedCommon.length >= 2);
  assert.ok(ownedCommon.some(common => common.distributions.some(d => d.departmentId === 'dept-support')));
  assert.ok(ownedCommon.every(common => common.summary.totalDepartments === common.distributions.length));
});
const created = await command(budgetUser.id, 'common.create', { title: `예산총괄 검증 ${randomUUID().slice(0, 8)}`, description: '격리된 시연 계정 권한 검증용 업무', dueDate: ownedCommon[0].dueDate, frequency: 'once', requiredSteps: ['요구자료 작성', '결과 검토'], departmentIds: ['dept-support'], distributionMode: 'selected', kind: 'common' });
const requestedCommon = created.commonTasks[0];
check('Ordinary budget staff can request common work without a special permission', () => {
  assert.equal(requestedCommon.managerId, budgetUser.id); assert.equal(requestedCommon.publicationStatus, 'pending'); assert.equal(requestedCommon.distributions.length, 0);
});
const sourceHead = directory.users.find(user => user.departmentId === budgetUser.departmentId && user.role === 'head' && user.active);
const approval = requestedCommon.approvalRequests.find(request => request.status === 'pending');
assert.ok(sourceHead && approval);
await command(sourceHead.id, 'common.approve', { commonId: requestedCommon.id, requestId: approval.id });
const { data: approved } = await request('/api/workspace', { user: budgetUser.id });
const deniedCommon = approved.commonTasks.find(common => common.id === requestedCommon.id);
check('Source department-head approval publishes the requested recipient department', () => {
  assert.equal(deniedCommon.publicationStatus, 'approved'); assert.equal(deniedCommon.distributions.length, 1); assert.equal(deniedCommon.distributions[0].departmentId, 'dept-support');
});
const distribution = deniedCommon.distributions[0];
const lead = directory.users.find(user => user.departmentId === 'dept-support' && user.role === 'lead');
const denied = await command(budgetUser.id, 'common.assignTeam', { commonId: deniedCommon.id, distributionId: distribution.id, leadId: lead.id, team: lead.team }, 403);
check('Common management does not grant another department team-assignment powers', () => assert.equal(denied.code, 'DEPARTMENT_ASSIGNMENT_DENIED'));
const memberState = await login('u-support-member');
const memberTasks = memberState.tasks.filter(task => task.primaryId === 'u-support-member' && task.tags.includes('예산'));
check('Default data-department staff also has budget-related personal examples', () => {
  assert.ok(memberTasks.length >= 2); assert.ok(memberTasks.every(task => task.departmentId === 'dept-support'));
});
console.log(JSON.stringify({ success: true, assertions: checks.length, budgetUser: budgetUser.id, budgetTasks: ownBudgetTasks.length, ownedCommon: ownedCommon.length, dataBudgetTasks: memberTasks.length, checks }, null, 2));

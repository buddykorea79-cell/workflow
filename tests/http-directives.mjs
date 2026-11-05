import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Mutates synthetic records only on a separate IEUM_DATA_DIR instance.
const base = process.argv[2] || 'http://127.0.0.1:3001';
const origin = new URL(base);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname));
assert.equal(origin.port, '3001', 'Directive checks require an isolated QA store on port 3001.');
const marker = `DIRECTIVE-${randomUUID().slice(0, 8)}`;
const cookies = new Map();
let checks = 0;
function pass(name) { checks++; console.log(`PASS ${name}`); }
async function request(path, { user, method = 'GET', body, expected = 200 } = {}) {
  const response = await fetch(base + path, { method, headers: { Origin: origin.origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(user ? { Cookie: cookies.get(user) || '' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status), `${method} ${path}: ${response.status} ${JSON.stringify(data).slice(0, 800)}`);
  return { data, response };
}
async function login(userId) {
  const result = await request('/api/session', { method: 'POST', body: { userId } });
  cookies.set(userId, result.response.headers.get('set-cookie').split(';')[0]);
  return result.data;
}
async function workspace(userId) { return (await request('/api/workspace', { user: userId })).data; }
async function command(userId, type, payload, expected = 200) {
  if (!cookies.has(userId)) await login(userId);
  const state = await workspace(userId);
  return (await request('/api/commands', { user: userId, method: 'POST', body: { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, expected })).data;
}
async function approveCommon(authorId, commonId) {
  const common = (await workspace(authorId)).commonTasks.find(item => item.id === commonId);
  const approval = common?.approvalRequests?.find(item => item.status === 'pending');
  assert.ok(approval, 'A pending request must exist before source department-head approval.');
  const sourceHead = directory.users.find(user => user.departmentId === approval.departmentId && user.role === 'head' && user.active);
  assert.ok(sourceHead, 'The original author department must have an active head.');
  await command(sourceHead.id, 'common.approve', { commonId, requestId: approval.id });
  return workspace(authorId);
}

const { data: directory } = await request('/api/session');
const planning = directory.departments.find(item => item.name === '기획재정담당관실');
const support = directory.departments.find(item => item.name === '데이터정보화담당관실');
const innovation = directory.departments.find(item => item.name === '혁신행정담당관실');
assert.ok(planning && support && innovation, 'The three fictional QA departments must exist.');
const owner = directory.users.find(user => user.departmentId === support.id && user.role === 'manager');
const member = directory.users.find(user => user.departmentId === support.id && user.role === 'member');
const lead = directory.users.find(user => user.departmentId === support.id && user.role === 'lead' && user.team === member?.team);
const head = directory.users.find(user => user.departmentId === support.id && user.role === 'head');
const coordinator = directory.users.find(user => user.departmentId === planning.id && user.team === '기획팀' && user.role === 'lead');
const coordinatorMember = directory.users.find(user => user.departmentId === planning.id && user.team === '기획팀' && user.role === 'member');
const outsider = directory.users.find(user => user.departmentId === innovation.id && user.role === 'member');
assert.ok(owner && member && lead && head && coordinator && coordinatorMember && outsider, 'Expected role fixtures are present.');
await Promise.all([owner, member, lead, head, coordinator, coordinatorMember, outsider].map(user => login(user.id)));
let state = await workspace(owner.id);
assert.equal(state.currentUser.role, 'manager', 'The authenticated author uses an ordinary organizational role.');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(state.serverTime));
const month = today.slice(0, 7);
function shiftedMonth(delta) { const [year, number] = month.split('-').map(Number); return new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7); }
const priorMonth = shiftedMonth(-1), instructedOn = `${priorMonth}-01`, dueDate = `${shiftedMonth(1)}-28`;
const create = { title: `${marker} 장관 지시사항`, description: '격리 저장소의 지시사항 월별 실적·총괄 권한 검증', projectName: marker, kind: 'directive', directiveIssuer: 'minister', instructedOn, dueDate, frequency: 'once', requiredSteps: ['자료 준비', '성과 점검', '결과 검토', '최종 제출'], departmentIds: [support.id, innovation.id], distributionMode: 'selected' };

await command(owner.id, 'common.create', { ...create, directiveIssuer: undefined }, 422);
await command(owner.id, 'common.create', { ...create, instructedOn: undefined }, 422);
await command(owner.id, 'common.create', { ...create, directiveIssuer: 'other' }, 422);
await command(owner.id, 'common.create', { ...create, instructedOn: '2026-02-30' }, 422);
pass('New directives require a supported issuer and a real instruction date');
state = await command(owner.id, 'common.create', create);
const commonId = state.commonTasks.find(item => item.title === create.title).id;
const commonOf = w => w.commonTasks.find(item => item.id === commonId);
const distributionOf = w => commonOf(w)?.distributions.find(item => item.departmentId === support.id);
assert.equal(commonOf(state).publicationStatus, 'pending');
assert.equal(commonOf(state).distributions.length, 0);
assert.equal(state.tasks.some(item => item.commonId === commonId), false);
assert.equal((await workspace(coordinator.id)).commonTasks.some(item => item.id === commonId), false);
pass('Unapproved directives create neither recipient work nor central visibility');
state = await approveCommon(owner.id, commonId);
const distributionId = distributionOf(state).id, taskId = distributionOf(state).taskId;
assert.equal(commonOf(state).directiveIssuer, 'minister');
assert.equal(commonOf(state).instructedOn, instructedOn);
assert.ok(taskId);
pass('Source department-head approval preserves directive metadata and creates department tasks');

for (const user of [coordinator, coordinatorMember]) {
  const central = await workspace(user.id);
  assert.equal(commonOf(central).distributions.length, 2);
  assert.equal(commonOf(central).managerId, owner.id);
  assert.equal(central.tasks.some(item => item.id === taskId), false);
  assert.ok(central.departmentDirectory.some(item => item.id === innovation.id));
}
pass('Planning team members see all minister directives without private foreign task access');
state = await workspace(outsider.id);
assert.equal(commonOf(state).distributions.length, 1);
assert.equal(commonOf(state).distributions[0].departmentId, innovation.id);
await command(outsider.id, 'common.distribute', { commonId, departmentIds: [planning.id] }, 403);
await command(outsider.id, 'directive.updateMetadata', { commonId, directiveIssuer: 'minister', instructedOn }, 403);
pass('Receiving departments remain scoped and cannot manage another author’s directive');

state = await command(owner.id, 'common.create', { ...create, title: `${marker} 국장 지시사항`, directiveIssuer: 'bureau_head', departmentIds: [support.id] });
const localId = state.commonTasks.find(item => item.title === `${marker} 국장 지시사항`).id;
state = await approveCommon(owner.id, localId);
assert.equal((await workspace(coordinator.id)).commonTasks.some(item => item.id === localId), false);
state = await command(coordinatorMember.id, 'common.create', { ...create, title: `${marker} 일반업무 작성 검사`, kind: 'common', directiveIssuer: undefined, instructedOn: undefined });
const ordinaryCommon = state.commonTasks.find(item => item.title === `${marker} 일반업무 작성 검사`);
assert.equal(ordinaryCommon.publicationStatus, 'pending');
assert.equal(ordinaryCommon.distributions.length, 0);
await approveCommon(coordinatorMember.id, ordinaryCommon.id);
state = await command(coordinatorMember.id, 'common.create', { ...create, title: `${marker} 차관 지시사항`, directiveIssuer: 'vice_minister', departmentIds: [innovation.id] });
const viceDirective = state.commonTasks.find(item => item.title === `${marker} 차관 지시사항`);
state = await approveCommon(coordinatorMember.id, viceDirective.id);
assert.equal(state.commonTasks.find(item => item.id === viceDirective.id).publicationStatus, 'approved');
pass('Ordinary planning staff can request common work while central oversight remains limited to minister directives');

state = await command(coordinator.id, 'directive.updateMetadata', { commonId, directiveIssuer: 'minister', instructedOn });
assert.equal(commonOf(state).instructedOn, instructedOn);
await command(coordinator.id, 'directive.updateMetadata', { commonId, directiveIssuer: 'bureau_head', instructedOn }, 403);
state = await command(coordinatorMember.id, 'common.distribute', { commonId, departmentIds: [planning.id] });
assert.equal(commonOf(state).distributions.length, 2);
state = await workspace(owner.id);
const additionalApproval = commonOf(state).approvalRequests.find(item => item.status === 'pending');
assert.ok(additionalApproval && additionalApproval.departmentId === owner.departmentId && additionalApproval.requestedBy === coordinatorMember.id);
state = await approveCommon(owner.id, commonId);
assert.equal(commonOf(state).distributions.length, 3);
pass('Planning metadata rules are enforced and added recipients require the original author department-head approval');

const report = { commonId, distributionId, month, achievements: '합성 검증: 자료를 수집하고 첫 실행 결과를 점검했습니다.', nextPlan: '다음 달 결과 검토', issues: '검증용 특이사항 없음' };
await command(member.id, 'directive.saveMonthlyReport', report, [403, 409]);
await command(coordinator.id, 'common.assignTeam', { commonId, distributionId, team: lead.team, leadId: lead.id }, 403);
await command(owner.id, 'common.assignTeam', { commonId, distributionId, team: lead.team, leadId: lead.id });
await command(lead.id, 'common.assignPerson', { commonId, distributionId, assigneeId: member.id });
await command(member.id, 'directive.saveMonthlyReport', report, [403, 409]);
state = await command(member.id, 'unit.create', { title: `${marker} 월별 실적 수행`, description: '격리된 월별 지시 실적 검증' });
const unitId = state.units.find(item => item.title === `${marker} 월별 실적 수행`).id;
state = await command(member.id, 'common.register', { commonId, distributionId, unitId });
assert.equal(distributionOf(state).currentAssigneeId, member.id);
pass('Monthly reporting follows department/team/person assignment and personal registration');

await command(owner.id, 'directive.saveMonthlyReport', report, 403);
await command(coordinator.id, 'directive.saveMonthlyReport', report, 403);
await command(outsider.id, 'directive.saveMonthlyReport', report, 403);
await command(member.id, 'directive.saveMonthlyReport', { ...report, month: '2026-13' }, 422);
await command(member.id, 'directive.saveMonthlyReport', { ...report, month: shiftedMonth(1) }, 422);
await command(member.id, 'directive.saveMonthlyReport', { ...report, month: shiftedMonth(-2) }, 422);
await command(member.id, 'directive.saveMonthlyReport', { ...report, achievements: ' ' }, 422);
pass('Only the current performer writes valid reporting months and nonempty results');

state = await command(member.id, 'directive.saveMonthlyReport', { ...report, month: priorMonth });
state = await command(member.id, 'directive.saveMonthlyReport', report);
const firstCurrent = distributionOf(state).monthlyReports.find(item => item.month === month);
assert.equal(firstCurrent.authorId, member.id);
state = await command(member.id, 'directive.saveMonthlyReport', { ...report, achievements: '같은 달 수정: 검토 대상을 추가 확인했습니다.' });
const reports = distributionOf(state).monthlyReports;
assert.equal(reports.length, 2);
assert.equal(reports.find(item => item.month === month).id, firstCurrent.id);
assert.match(reports.find(item => item.month === month).achievements, /같은 달 수정/);
assert.equal(reports.find(item => item.month === priorMonth).achievements, report.achievements);
pass('Each month has one editable report while previous months remain preserved');

await login(coordinator.id);
state = await workspace(coordinator.id);
assert.equal(distributionOf(state).monthlyReports.length, 2);
assert.equal(state.tasks.some(item => item.id === taskId), false);
assert.ok(state.identities.some(item => item.id === member.id));
assert.equal(commonOf(await workspace(outsider.id)).distributions.some(item => item.id === distributionId), false);
pass('Central monthly history survives login and remains separate from private task details');

await command(head.id, 'department.confirm', {});
state = await command(member.id, 'directive.saveMonthlyReport', { ...report, achievements: '업무분장 확정 후에도 월별 실적을 저장했습니다.' });
assert.match(distributionOf(state).monthlyReports.find(item => item.month === month).achievements, /업무분장 확정/);
pass('Confirmed department definitions do not block ongoing monthly reporting');

const task = state.tasks.find(item => item.id === taskId);
for (const step of task.workflow) await command(step.role === 'reviewer' ? head.id : member.id, 'task.setProgress', { taskId, stepId: step.id, done: true });
state = await workspace(member.id);
assert.equal(distributionOf(state).executionStatus, 'completed');
const completedReports = structuredClone(distributionOf(state).monthlyReports);
await command(member.id, 'directive.saveMonthlyReport', { ...report, achievements: '완료 후 변경 시도' }, 409);
state = await workspace(coordinator.id);
assert.equal(distributionOf(state).executionStatus, 'completed');
assert.deepEqual(distributionOf(state).monthlyReports, completedReports);
pass('Completed directives retain monthly history and reject new or changed reports');

console.log(JSON.stringify({ success: true, checks, marker, commonId, taskId, distributionId, month, coordinatorId: coordinator.id }));

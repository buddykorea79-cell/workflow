import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { currentHalf, previousHalf } from './helpers/http-period.mjs';

// Run against a separate local instance, with IEUM_DATA_DIR set to .qa-data.
// Example: node tests/http-workflow.mjs http://127.0.0.1:3001
const base = process.argv[2] || 'http://127.0.0.1:3001';
const origin = new URL(base);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname), 'HTTP QA must target a loopback server.');
assert.equal(origin.port, '3001', 'HTTP QA is isolated to port 3001 to avoid modifying the user demo on port 3000.');
const marker = `QA-${randomUUID().slice(0, 8)}`;
const cookies = new Map();
let assertions = 0;
const checks = [];
function check(name, assertion) { assertion(); assertions++; checks.push(name); console.log(`PASS ${name}`); }

async function request(path, { user, method = 'GET', body, expected = 200, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Origin: origin.origin, ...(user ? { Cookie: cookies.get(user) || '' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data;
  try { data = await response.json(); } catch { throw new Error(`${method} ${path}: non-JSON ${response.status}`); }
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data).slice(0, 500)}`);
  return { data, response };
}
async function login(userId) {
  const { data, response } = await request('/api/session', { method: 'POST', body: { userId } });
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('ieum_demo_session='), 'Login must set the signed session cookie.');
  cookies.set(userId, cookie);
  return data;
}
async function workspace(user) { return (await request('/api/workspace', { user })).data; }
async function command(user, type, payload, expected = 200, overrides = {}) {
  if (!cookies.has(user)) await login(user);
  const state = await workspace(user);
  return (await request('/api/commands', { user, method: 'POST', expected, body: { type, payload, expectedRevision: state.revision, requestId: randomUUID(), ...overrides } })).data;
}
function userFor(dept, role, directory, predicate = () => true) {
  const found = directory.users.find(u => u.departmentId === dept && u.role === role && u.active && predicate(u));
  assert.ok(found, `Missing ${role} in ${dept}`); return found;
}
async function approveCommon(authorId, commonId) {
  const common = (await workspace(authorId)).commonTasks.find(item => item.id === commonId);
  const approval = common?.approvalRequests?.find(item => item.status === 'pending');
  assert.ok(approval, 'A pending request must exist before source department-head approval.');
  const head = userFor(approval.departmentId, 'head', directory);
  await command(head.id, 'common.approve', { commonId, requestId: approval.id });
  return workspace(authorId);
}

const unauth = await request('/api/workspace', { expected: 401 });
check('A login is required before workspace data is returned', () => assert.equal(unauth.data.code, 'SIGN_IN_REQUIRED'));
const { data: directory } = await request('/api/session');
check('All three requested departments exist', () => assert.deepEqual(new Set(directory.departments.map(d => d.name)), new Set(['기획재정담당관실', '데이터정보화담당관실', '혁신행정담당관실'])));
check('The public demo directory includes role selection data without contact details', () => {
  assert.ok(directory.users.length >= 15 && directory.users.every(u => u.id && u.name && u.departmentId && u.role));
  assert.ok(directory.users.every(u => !Object.hasOwn(u, 'email') && !Object.hasOwn(u, 'phone') && !Object.hasOwn(u, 'commonTaskPermission')));
});

const creator = directory.users.find(u => u.role === 'member' && u.active);
assert.ok(creator);
const targetDept = directory.departments.find(d => d.id !== creator.departmentId);
const otherDept = directory.departments.find(d => d.id !== creator.departmentId && d.id !== targetDept.id);
const targetManager = userFor(targetDept.id, 'manager', directory);
const targetLead = userFor(targetDept.id, 'lead', directory);
const targetMember = userFor(targetDept.id, 'member', directory, u => u.team === targetLead.team);
const targetHead = userFor(targetDept.id, 'head', directory);
const otherHead = userFor(otherDept.id, 'head', directory);
const admin = directory.users.find(u => u.role === 'admin');
assert.ok(admin);
// Other isolated HTTP checks may have confirmed these fixture departments.
// Reopen only the departments where this scenario assigns and edits work.
for (const head of [targetHead, otherHead]) {
  const existing = await login(head.id);
  if (existing.departmentWorkPlans?.some(plan => plan.departmentId === head.departmentId && plan.status === 'confirmed')) {
    await command(head.id, 'department.reopen', { departmentId: head.departmentId, reason: `${marker} 격리 HTTP 시나리오의 배정·수정 준비` });
  }
}
await login(creator.id);
const now = (await workspace(creator.id)).serverTime;
const date = new Date(now); date.setUTCDate(date.getUTCDate() + 20);
const dueDate = date.toISOString().slice(0, 10);
const period = currentHalf(now);
const commonPayload = { title: `${marker} 공통업무`, description: '격리된 HTTP 검증용 공통업무입니다.', projectName: `${marker} 사업`, dueDate, frequency: 'half_yearly', requiredSteps: ['자료 준비', '결과 검토', '최종 제출'], departmentIds: [targetDept.id], distributionMode: 'selected', kind: 'common' };
let state = await command(creator.id, 'common.create', commonPayload);
let common = state.commonTasks.find(c => c.title === commonPayload.title);
assert.ok(common);
const commonId = common.id;
check('An ordinary staff member can request common work without a special permission', () => {
  assert.equal(common.managerId, creator.id); assert.equal(common.publicationStatus, 'pending'); assert.equal(common.distributions.length, 0);
});
const approval = common.approvalRequests.find(item => item.status === 'pending');
await command(targetHead.id, 'common.approve', { commonId, requestId: approval.id }, 403);
await command(admin.id, 'common.approve', { commonId, requestId: approval.id }, 403);
state = await approveCommon(creator.id, commonId);
common = state.commonTasks.find(c => c.id === commonId);
const distributionId = common.distributions[0].id;
check('Only source department-head approval publishes work to the selected department', () => assert.ok(common.publicationStatus === 'approved' && common.managerId === creator.id && common.distributions.length === 1 && common.distributions[0].departmentId === targetDept.id && common.distributions[0].status === 'pending'));

const deniedTeam = await command(creator.id, 'common.assignTeam', { commonId, distributionId, team: targetLead.team, leadId: targetLead.id }, 403);
check('A common manager cannot perform another department’s team assignment', () => assert.equal(deniedTeam.code, 'DEPARTMENT_ASSIGNMENT_DENIED'));
await command(targetLead.id, 'common.assignPerson', { commonId, distributionId, assigneeId: targetMember.id }, 403);
state = await command(targetManager.id, 'common.assignTeam', { commonId, distributionId, team: targetLead.team, leadId: targetLead.id });
check('Department manager assigns the team and its lead', () => assert.equal(state.commonTasks.find(c => c.id === commonId).distributions[0].status, 'team_assigned'));
await command(targetLead.id, 'common.assignPerson', { commonId, distributionId, assigneeId: creator.id }, 422);
state = await command(targetLead.id, 'common.assignPerson', { commonId, distributionId, assigneeId: targetMember.id });
check('The assigned lead can assign only a matching team member', () => assert.equal(state.commonTasks.find(c => c.id === commonId).distributions[0].assigneeId, targetMember.id));
state = await command(targetMember.id, 'unit.create', { title: `${marker} 개인 단위업무`, description: 'HTTP 업무 흐름 검증을 위한 단위업무', ownerId: targetMember.id });
const unit = state.units.find(u => u.title === `${marker} 개인 단위업무`);
assert.ok(unit);
await command(admin.id, 'common.register', { commonId, distributionId, unitId: unit.id }, 403);
state = await command(targetMember.id, 'common.register', { commonId, distributionId, unitId: unit.id });
const task = state.tasks.find(t => t.commonId === commonId);
assert.ok(task);
check('Only the assignee registers a common task under a personal unit', () => assert.ok(task.primaryId === targetMember.id && task.unitId === unit.id && state.commonTasks.find(c => c.id === commonId).distributions[0].status === 'registered'));
state = await workspace(creator.id);
check('The common owner sees cross-department progress without unrelated task contents', () => assert.ok(state.commonTasks.find(c => c.id === commonId).distributions[0].progress === 0 && !state.tasks.some(t => t.id === task.id)));

const startDate = new Date(now).toISOString().slice(0, 10);
const workflow = task.workflow.map(step => ({ ...step, startDate, dueDate }));
state = await command(targetMember.id, 'task.configure', { taskId: task.id, description: '설명과 사업 예산, 집행 및 업무 근거를 입력했습니다.', budget: 150000000, expenses: [{ id: `${marker}-expense`, date: startDate, description: '사업비 집행', amount: 12000000 }], references: [{ id: `${marker}-law`, type: 'law', title: '가상 법령', content: '법령 연결 입력 검증', url: 'https://example.com/law' }, { id: `${marker}-guideline`, type: 'guideline', title: '가상 지침', content: '지침 항목 입력' }, { id: `${marker}-agenda`, type: 'national_agenda', title: '가상 국정과제', content: '과제 연계 입력' }], workflow });
check('Budget, spending, multiple references and procedure dates persist', () => {
  const t = state.tasks.find(t => t.id === task.id); assert.equal(t.budget, 150000000); assert.equal(t.expenses[0].amount, 12000000); assert.equal(t.references.length, 3); assert.ok(t.workflow.every(s => s.startDate === startDate && s.dueDate === dueDate));
});
await command(targetMember.id, 'task.setProgress', { taskId: task.id, stepId: workflow[2].id, done: true }, 409);
await command(targetMember.id, 'task.setProgress', { taskId: task.id, stepId: workflow[0].id, done: true });
await command(targetMember.id, 'task.setProgress', { taskId: task.id, stepId: workflow[1].id, done: true }, 403);
await command(targetHead.id, 'task.setProgress', { taskId: task.id, stepId: workflow[1].id, done: true });
await command(targetMember.id, 'task.setProgress', { taskId: task.id, stepId: workflow[2].id, done: true });
state = await workspace(creator.id);
check('Procedure completion requires dependencies and reviewer authority, and reaches the owner summary', () => {
  const d = state.commonTasks.find(c => c.id === commonId).distributions[0]; assert.equal(d.progress, 100); assert.equal(d.status, 'submitted');
});

const performancePayload = { taskId: task.id, period, title: `${marker} 반기 성과`, description: '공통업무를 완료하고 집행·법령 기록을 연결했습니다.', evidence: '완료된 업무 절차와 결과 보고서', metricName: '완료 절차', value: 3, unit: '단계' };
state = await command(targetMember.id, 'performance.saveHalf', performancePayload);
const performance = state.performances.find(p => p.taskId === task.id && p.period === period);
assert.ok(performance);
const performanceId = performance.id;
state = await command(targetMember.id, 'performance.saveHalf', { ...performancePayload, description: '산출 기준을 보완했습니다.', evidence: '3개 절차 완료 결과 및 산출 기준' });
check('Each task has one editable draft per half-year before person submission', () => {
  const records = state.performances.filter(p => p.taskId === task.id && p.period === period); assert.equal(records.length, 1); assert.equal(records[0].id, performanceId); assert.equal(records[0].status, 'draft'); assert.equal(records[0].description, '산출 기준을 보완했습니다.');
});
await command(otherHead.id, 'performance.evaluate', { performanceId, score: 90, comment: '다른 부서 평가 차단', decision: 'confirmed' }, 403);
await command(targetMember.id, 'performance.evaluate', { performanceId, score: 100, comment: '자기 평가 차단', decision: 'confirmed' }, 403);
const legacyDenied = await command(targetHead.id, 'performance.evaluate', { performanceId, score: 90, comment: '기존 평가 경로 우회 차단', decision: 'confirmed' }, 409);
check('Legacy per-task evaluation cannot bypass explicit person submission', () => assert.equal(legacyDenied.code, 'UNIT_EVALUATION_REQUIRED'));
const allocations = state.units.filter(item => item.ownerId === targetMember.id && item.departmentId === targetDept.id && !item.deletedAt).map(item => ({ unitId: item.id, maxScore: item.id === unit.id ? 50 : 0 }));
state = await command(targetMember.id, 'performance.setWeights', { period, allocations });
const plan = state.unitScorePlans.find(item => item.personId === targetMember.id && item.period === period);
assert.ok(plan);
const evaluationPayload = { personId: targetMember.id, period, planVersion: plan.version, scores: allocations.map(item => ({ unitId: item.unitId, score: item.maxScore ? 44 : 0, comment: item.maxScore ? '근거와 개선 효과를 확인했습니다.' : '' })), comment: '다음 반기에는 처리 시간을 지표로 추가하세요.' };
const notSubmitted = await command(targetHead.id, 'performance.evaluatePerson', evaluationPayload, 409);
check('Saving 50-point weights alone does not start department-head evaluation', () => assert.equal(notSubmitted.code, 'PERFORMANCE_NOT_SUBMITTED'));
state = await command(targetMember.id, 'performance.submitPerson', { period, planVersion: plan.version });
check('Explicit submission sends the saved task performance to department-head review', () => assert.ok(state.unitScorePlans.find(item => item.id === plan.id).submittedAt && state.performances.find(item => item.id === performanceId).status === 'review'));
const managerStatus = await workspace(targetManager.id);
check('Department manager sees submission status without another employee’s performance contents', () => {
  assert.equal(managerStatus.performanceSubmissionStatuses.find(item => item.personId === targetMember.id && item.period === period).status, 'submitted');
  assert.ok(!managerStatus.performances.some(item => item.id === performanceId));
});
await command(targetMember.id, 'performance.saveHalf', performancePayload, 409);
await command(targetMember.id, 'performance.setWeights', { period, allocations }, 409);
await command(otherHead.id, 'performance.evaluatePerson', evaluationPayload, 403);
await command(targetManager.id, 'performance.evaluatePerson', evaluationPayload, 403);
await command(targetHead.id, 'performance.evaluatePerson', { ...evaluationPayload, scores: allocations.map(item => ({ unitId: item.unitId, score: item.maxScore ? 50.01 : 0 })) }, 422);
state = await command(targetHead.id, 'performance.evaluatePerson', evaluationPayload);
check('A final unit evaluation persists the 50-point total and department-head feedback', () => {
  const record = state.performances.find(item => item.id === performanceId), evaluation = state.unitEvaluations.find(item => item.personId === targetMember.id && item.period === period);
  assert.equal(record.status, 'confirmed'); assert.equal(record.approvedBy, targetHead.id); assert.equal(evaluation.totalScore, 44); assert.equal(evaluation.comment, evaluationPayload.comment); assert.ok(evaluation.performanceIds.includes(performanceId));
});
await command(targetMember.id, 'performance.saveHalf', { ...performancePayload, period: previousHalf(period), title: `${marker} 다른 반기 성과` });

state = await command(creator.id, 'common.create', { ...commonPayload, title: `${marker} 전체 부서 공통업무`, distributionMode: 'all' });
state = await approveCommon(creator.id, state.commonTasks.find(c => c.title === `${marker} 전체 부서 공통업무`).id);
check('Approved all-department distribution expands to all three departments', () => assert.equal(state.commonTasks.find(c => c.title === `${marker} 전체 부서 공통업무`).distributions.length, 3));
state = await command(creator.id, 'common.create', { ...commonPayload, title: `${marker} 지시사항`, kind: 'directive', directiveIssuer: 'minister', instructedOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(state.serverTime)), departmentIds: [otherDept.id] });
state = await approveCommon(creator.id, state.commonTasks.find(c => c.title === `${marker} 지시사항`).id);
const directive = state.commonTasks.find(c => c.title === `${marker} 지시사항`);
assert.ok(directive?.distributions[0].taskId);
const directiveTaskId = directive.distributions[0].taskId;
const directiveDistributionId = directive.distributions[0].id;
const otherManager = userFor(otherDept.id, 'manager', directory);
const otherLead = userFor(otherDept.id, 'lead', directory);
const otherMember = userFor(otherDept.id, 'member', directory, u => u.team === otherLead.team);
state = await login(otherManager.id);
check('An approved directive creates the target department’s detail task', () => assert.ok(state.tasks.some(t => t.id === directiveTaskId && t.references.some(r => r.type === 'directive'))));
await command(otherManager.id, 'task.configure', { taskId: directiveTaskId, description: '등록 전에 변경 시도' }, 409);
await command(otherManager.id, 'performance.saveHalf', { ...performancePayload, taskId: directiveTaskId }, 409);
await command(otherManager.id, 'common.assignTeam', { commonId: directive.id, distributionId: directiveDistributionId, team: otherLead.team, leadId: otherLead.id });
await command(otherLead.id, 'common.assignPerson', { commonId: directive.id, distributionId: directiveDistributionId, assigneeId: otherMember.id });
state = await command(otherMember.id, 'unit.create', { title: `${marker} 지시사항 개인 단위`, description: '지시사항 등록 검증', ownerId: otherMember.id });
const otherUnit = state.units.find(u => u.title === `${marker} 지시사항 개인 단위`);
state = await command(otherMember.id, 'common.register', { commonId: directive.id, distributionId: directiveDistributionId, unitId: otherUnit.id });
check('Directive allocation reuses the automatically created task and transfers ownership', () => assert.ok(state.tasks.filter(t => t.commonId === directive.id).length === 1 && state.tasks.some(t => t.id === directiveTaskId && t.primaryId === otherMember.id && t.unitId === otherUnit.id)));

await command(targetMember.id, 'admin.release', { version: '0.3.0', title: '권한 없음', notes: '일반 구성원 작성 차단' }, 403);
await command(admin.id, 'admin.release', { version: 'invalid', title: '잘못된 버전', notes: '잘못된 버전 형식 차단' }, 422);
await command(admin.id, 'admin.release', { version: '0.2.0', title: '중복 버전', notes: '중복 버전 차단' }, 409);
const releaseVersion = `0.2.${Date.now()}`;
state = await command(admin.id, 'admin.release', { version: releaseVersion, title: `${marker} 검증 이력`, notes: '공통업무 배정, 지시사항 자동 생성, 성과 평가 HTTP 검증' });
check('Only administrators can save unique semantic version records', () => assert.equal(state.releases[0].version, releaseVersion));

const idempotencyId = randomUUID();
state = await workspace(targetMember.id);
const originalRevision = state.revision;
const samePayload = { title: `${marker} 재시도 단위`, description: '중복 저장 방지 확인' };
await command(targetMember.id, 'unit.create', samePayload, 200, { requestId: idempotencyId, expectedRevision: originalRevision });
state = await command(targetMember.id, 'unit.create', samePayload, 200, { requestId: idempotencyId, expectedRevision: originalRevision });
check('Identical retry requests remain idempotent despite stale revisions', () => assert.equal(state.units.filter(u => u.title === samePayload.title).length, 1));
const independentTitle = `${marker} 이전 전역 버전의 새 단위`;
state = await command(targetMember.id, 'unit.create', { ...samePayload, title: independentTitle }, 200, { expectedRevision: originalRevision });
const conflictUnit = state.units.find(unit => unit.title === independentTitle);
check('Independent creation succeeds despite an older global revision', () => assert.ok(conflictUnit));
const expectedUnit = { kind: 'unit', id: conflictUnit.id, rev: conflictUnit.rev ?? 0 };
const latestUnitTitle = `${marker} 대상 버전 갱신`;
state = await command(targetMember.id, 'unit.update', { unitId: conflictUnit.id, title: latestUnitTitle, description: samePayload.description }, 200, { expected: expectedUnit });
const staleTarget = await command(targetMember.id, 'unit.update', { unitId: conflictUnit.id, title: `${marker} 오래된 대상 덮어쓰기`, description: samePayload.description }, 409, { expected: expectedUnit });
check('A stale revision of the same unit is rejected without replacing its latest content', () => {
  assert.equal(staleTarget.code, 'TARGET_CONFLICT');
  assert.ok(state.units.find(unit => unit.id === conflictUnit.id).rev > expectedUnit.rev);
});
state = await workspace(targetMember.id);
assert.equal(state.units.find(unit => unit.id === conflictUnit.id).title, latestUnitTitle);
await request('/api/session', { method: 'POST', body: { userId: admin.id }, expected: 403, headers: { Origin: 'https://outside.example' } });
check('Cross-origin session mutations are rejected', () => assert.ok(true));
const logout = await request('/api/session', { method: 'DELETE', user: targetMember.id });
cookies.delete(targetMember.id);
check('Logout clears the session cookie', () => assert.ok(logout.response.headers.get('set-cookie')?.includes('Max-Age=0')));
await request('/api/workspace', { user: targetMember.id, expected: 401 });
await login(targetMember.id);
state = await workspace(targetMember.id);
check('Saved task and evaluated performance survive logout and a fresh session', () => assert.ok(state.tasks.some(t => t.id === task.id && t.budget === 150000000) && state.performances.some(p => p.id === performanceId && p.status === 'confirmed') && state.unitEvaluations.some(evaluation => evaluation.personId === targetMember.id && evaluation.period === period && evaluation.totalScore === 44)));

console.log(JSON.stringify({ success: true, assertions, marker, taskId: task.id, performanceId, checks }, null, 2));

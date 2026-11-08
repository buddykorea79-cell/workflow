import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { currentHalf } from './helpers/http-period.mjs';

const base = process.argv[2] || 'http://127.0.0.1:3001';
const origin = new URL(base);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname));
assert.equal(origin.port, '3001', 'Mutation checks require the isolated QA store on port 3001.');
const cookies = new Map();
let checks = 0;
const pass = name => { checks++; console.log(`PASS ${name}`); };
async function request(path, { user, method = 'GET', body, expected = 200 } = {}) {
  const response = await fetch(base + path, { method, headers: { Origin: origin.origin, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(user ? { Cookie: cookies.get(user) || '' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data).slice(0, 800));
  return { data, response };
}
async function login(userId) { const result = await request('/api/session', { method: 'POST', body: { userId } }); cookies.set(userId, result.response.headers.get('set-cookie').split(';')[0]); return result.data; }
async function workspace(user) { return (await request('/api/workspace', { user })).data; }
async function command(user, type, payload, expected = 200) {
  const state = await workspace(user);
  return (await request('/api/commands', { user, method: 'POST', expected, body: { type, payload, expectedRevision: state.revision, requestId: randomUUID() } })).data;
}
const employee = 'u-support-member', head = 'u-support-head', colleague = 'u-doyun', admin = 'u-support-admin', foreignHead = 'u-head';
await Promise.all([employee, head, colleague, admin, foreignHead].map(login));
let state = await workspace(employee);
const period = process.argv[3] || currentHalf(state.serverTime);
const units = state.units.filter(unit => unit.ownerId === employee && !unit.deletedAt);
assert.ok(units.length >= 3, 'QA requires the seeded employee with multiple unit assignments.');
const equalShare = Math.floor(50 / units.length);
const allocations = units.map((unit, index) => ({ unitId: unit.id, maxScore: index === units.length - 1 ? 50 - equalShare * index : equalShare }));
await command(employee, 'performance.setWeights', { period, allocations: allocations.map((item, index) => ({ ...item, maxScore: item.maxScore - (index === 0 ? 1 : 0) })) }, 422);
pass('Incomplete 50-point allocation is rejected by the server');
state = await command(employee, 'performance.setWeights', { period, allocations });
let plan = state.unitScorePlans.find(item => item.personId === employee && item.period === period);
assert.equal(plan.allocations.reduce((sum, item) => sum + item.maxScore, 0), 50);
pass('Employee saves all unit allocations totaling 50 points');
assert.equal((await workspace(colleague)).unitScorePlans.some(item => item.personId === employee), false);
assert.equal((await workspace(foreignHead)).unitScorePlans.some(item => item.personId === employee), false);
assert.equal((await workspace(head)).unitScorePlans.some(item => item.personId === employee), true);
assert.equal((await workspace(admin)).unitScorePlans.some(item => item.personId === employee), true);
pass('Allocation visibility is restricted to self, own department head and administrators');
const tasks = state.tasks.filter(task => task.primaryId === employee && !task.deletedAt && task.status !== 'archived');
for (let index = 0; index < tasks.length; index++) {
  const task = tasks[index];
  state = await command(employee, 'performance.saveHalf', { taskId: task.id, period, title: `${task.title} 추진 실적`, description: `관련 자료 점검과 담당자 확인을 마쳤습니다. ${index + 1}차 결과보고서에 개선 내용과 후속 조치를 기록했습니다.`, evidence: `결과보고서 QA-${index + 1} · 격리된 검증 자료`, metricName: '점검 완료', value: index + 2, unit: '건' });
}
assert.ok(state.performances.filter(item => item.authorId === employee && item.period === period).every(item => item.status === 'draft'));
pass('Per-task performance saves as an editable draft and retains unit membership');
const scores = allocations.map(item => ({ unitId: item.unitId, score: Math.max(0, item.maxScore - 2), comment: '제출 실적과 근거를 확인했습니다. 후속 개선 계획을 계속 관리해 주세요.' }));
const expectedTotal = scores.reduce((sum, item) => sum + item.score, 0);
const payload = { personId: employee, period, planVersion: plan.version, scores, comment: '단위업무별 목표 달성과 실적 근거를 종합하여 평가했습니다.' };
await command(colleague, 'performance.evaluatePerson', payload, 403);
await command(foreignHead, 'performance.evaluatePerson', payload, 403);
await command(employee, 'performance.evaluatePerson', payload, 403);
pass('Colleagues, foreign heads and the employee cannot evaluate this employee');
await command(head, 'performance.evaluatePerson', payload, 409);
assert.equal((await workspace(colleague)).performanceSubmissionStatuses.find(item => item.personId === employee && item.period === period)?.status, 'not_submitted');
state = await command(employee, 'performance.submitPerson', { period, planVersion: plan.version });
plan = state.unitScorePlans.find(item => item.personId === employee && item.period === period);
assert.ok(plan.submittedAt);
assert.equal((await workspace(colleague)).performanceSubmissionStatuses.find(item => item.personId === employee && item.period === period)?.status, 'submitted');
await command(employee, 'performance.setWeights', { period, allocations }, 409);
await command(employee, 'performance.saveHalf', { taskId: tasks[0].id, period, title: '제출 후 변경', description: '변경 불가', evidence: '변경 불가' }, 409);
pass('Explicit person submission starts evaluation, freezes drafts and exposes manager submission status');
await command(head, 'performance.evaluatePerson', { ...payload, scores: scores.map((item, index) => ({ ...item, score: index === 0 ? allocations[0].maxScore + 1 : item.score })) }, 422);
pass('Head scores cannot exceed individual unit allocations');
await command(head, 'performance.evaluatePerson', { ...payload, planVersion: plan.version + 1 }, 409);
pass('Stale allocation versions cannot be evaluated');
if (process.env.QA_LEAVE_EVALUATION_OPEN === '1') {
  console.log(JSON.stringify({ success: true, checks, readyForBrowserEvaluation: true, personId: employee, period }));
} else {
  state = await command(head, 'performance.evaluatePerson', payload);
  const evaluation = state.unitEvaluations.find(item => item.personId === employee && item.period === period);
  assert.equal(evaluation.totalScore, expectedTotal);
  assert.equal(evaluation.scores.length, units.length);
  assert.equal(evaluation.planVersion, plan.version);
  pass(`Head confirms a durable result of ${expectedTotal} out of 50 across every assigned unit`);
  await command(employee, 'performance.setWeights', { period, allocations }, 409);
  await command(head, 'performance.evaluatePerson', payload, 409);
  pass('Final evaluation and its weights are protected against overwriting');
  const own = await workspace(employee);
  assert.equal(own.unitEvaluations.find(item => item.id === evaluation.id).totalScore, expectedTotal);
  assert.equal((await workspace(colleague)).unitEvaluations.some(item => item.id === evaluation.id), false);
  assert.equal((await workspace(foreignHead)).unitEvaluations.some(item => item.id === evaluation.id), false);
  assert.equal((await workspace(colleague)).performanceSubmissionStatuses.find(item => item.personId === employee && item.period === period)?.status, 'evaluated');
  pass('Final results are readable by the employee and protected from peers and foreign departments');
  console.log(JSON.stringify({ success: true, checks }));
}

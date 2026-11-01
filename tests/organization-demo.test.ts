import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOrganizationDemo, ORGANIZATION_DEMO_MARKER } from '../src/lib/organization-demo';
import { createSeed } from '../src/lib/seed';
import { commonDistributionStatus } from '../src/lib/common-status';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-01T03:00:00Z');
const originalIds = ['u-minseo', 'u-jiho', 'u-seoyeon', 'u-head', 'u-admin', 'u-doyun', 'u-support-head', 'u-plan-lead', 'u-support-lead', 'u-support-member', 'u-support-admin', 'u-innovation-manager', 'u-innovation-head', 'u-innovation-lead', 'u-innovation-member', 'u-innovation-admin'];
const expectedTeams: Record<string, string[]> = {
  'dept-plan': ['기획팀', '예산팀', '국회팀'],
  'dept-support': ['정보기획팀', '데이터팀', '정보자원팀'],
  'dept-innovation': ['혁신팀', '청년팀', '행정지원팀'],
};

function legacyWorkspace(): WorkspaceData {
  const state = createSeed(now);
  state.users = state.users.filter(user => originalIds.includes(user.id));
  for (const user of state.users) {
    if (user.id === 'u-jiho') user.team = '기획팀';
    if (user.role === 'head') user.team = user.departmentId === 'dept-plan' ? '기획팀' : user.departmentId === 'dept-support' ? '데이터팀' : '혁신팀';
    if (user.role === 'admin') user.team = '시스템운영팀';
  }
  for (const common of state.commonTasks) for (const distribution of common.distributions) if (distribution.assigneeId === 'u-jiho') {
    distribution.team = '기획팀'; distribution.leadId = 'u-plan-lead';
  }
  state.audit = state.audit.filter(event => !event.action.startsWith('demo.organization') && event.targetId !== ORGANIZATION_DEMO_MARKER);
  state.revision = 17;
  return state;
}

test('organization demo: each department has the requested teams with one lead and two staff', () => {
  const state = createSeed(now);
  assert.equal(state.users.length, 33);
  assert.equal(new Set(state.users.map(user => user.id)).size, state.users.length);
  assert.equal(new Set(state.users.map(user => user.email)).size, state.users.length);
  assert.equal(new Set(state.users.map(user => user.phone)).size, state.users.length);
  for (const [departmentId, teams] of Object.entries(expectedTeams)) {
    const departmentUsers = state.users.filter(user => user.departmentId === departmentId);
    const employees = departmentUsers.filter(user => !['head', 'admin'].includes(user.role));
    assert.deepEqual(new Set(employees.map(user => user.team)), new Set(teams));
    for (const team of teams) {
      const members = employees.filter(user => user.team === team);
      assert.equal(members.filter(user => user.role === 'lead').length, 1, `${team} lead`);
      assert.equal(members.filter(user => ['member', 'manager'].includes(user.role)).length, 2, `${team} staff`);
      assert.ok(members.every(user => user.active && user.title && user.email?.endsWith('@ieum.example') && /^02-0000-\d{4}$/.test(user.phone || '')));
    }
    assert.ok(departmentUsers.filter(user => ['head', 'admin'].includes(user.role)).every(user => user.team === '부서 직속'));
  }
  assert.equal(state.users.find(user => user.id === 'u-jiho')!.team, '예산팀');
});

test('organization demo: legacy IDs, permissions and work histories survive the roster update', () => {
  const state = legacyWorkspace();
  const before = structuredClone(state);
  const result = applyOrganizationDemo(state, now);
  assert.equal(result.changed, true);
  assert.equal(result.addedUsers, 17);
  assert.equal(state.revision, before.revision + 1);
  for (const key of ['units', 'tasks', 'runs', 'handovers', 'sources', 'performances', 'delegations', 'notifications', 'attachments', 'processedRequests', 'departmentWorkPlans', 'unitScorePlans', 'unitEvaluations', 'releases'] as const) {
    assert.deepEqual(state[key], before[key], `${key} changed during roster update`);
  }
  for (const previous of before.users) {
    const current = state.users.find(user => user.id === previous.id)!;
    assert.ok(current);
    for (const key of ['name', 'role', 'departmentId', 'email', 'phone', 'active', 'commonTaskPermission'] as const) assert.equal(current[key], previous[key], `${previous.id}.${key}`);
  }
  for (const event of before.audit) assert.deepEqual(state.audit.find(item => item.id === event.id), event);
  assert.equal(state.audit.filter(event => event.targetId === ORGANIZATION_DEMO_MARKER).length, 1);
  assert.ok(state.users.filter(user => !originalIds.includes(user.id)).every(user => !user.commonTaskPermission));
});

test('organization demo: replay leaves both the migration result and subsequent user edits untouched', () => {
  const state = legacyWorkspace(); applyOrganizationDemo(state, now);
  const first = JSON.stringify(state);
  assert.equal(applyOrganizationDemo(state, new Date('2026-12-01T03:00:00Z')).changed, false);
  assert.equal(JSON.stringify(state), first);
  const budgetOfficer = state.users.find(user => user.id === 'u-jiho')!;
  budgetOfficer.title = '직접 변경한 직위'; budgetOfficer.team = '직접 변경한 팀'; budgetOfficer.commonTaskPermission = false;
  const budgetLead = state.users.find(user => user.id === 'u-budget-lead')!; budgetLead.active = false;
  state.tasks[0].description = '사용자가 보완한 업무';
  const edited = JSON.stringify(state);
  assert.equal(applyOrganizationDemo(state, now).changed, false);
  assert.equal(JSON.stringify(state), edited);
});

test('organization demo: unexpected existing roles, expired accounts and identity collisions fail before mutation', () => {
  const invalidCases: ((state: WorkspaceData) => void)[] = [
    state => { state.users.find(user => user.id === 'u-jiho')!.role = 'manager'; },
    state => { state.users.find(user => user.id === 'u-jiho')!.endsAt = '2026-10-31T00:00:00Z'; },
    state => { state.users.push({ ...state.users[0], id: 'u-budget-lead', email: 'custom@ieum.example', phone: '02-0000-9999' }); },
    state => { state.users[0].email = 'budget-lead@ieum.example'; },
    state => { state.users[0].phone = '02-0000-1101'; },
  ];
  for (const invalidate of invalidCases) {
    const state = legacyWorkspace(); invalidate(state);
    const original = JSON.stringify(state);
    assert.throws(() => applyOrganizationDemo(state, now), /기존 정보는 변경하지 않았습니다/);
    assert.equal(JSON.stringify(state), original);
  }
});

test('organization demo: ongoing budget assignments follow the new team while completion history remains intact', () => {
  const state = legacyWorkspace();
  const ongoing = state.commonTasks.find(common => common.id === 'budget-demo-common-demand')!;
  const distribution = ongoing.distributions.find(item => item.assigneeId === 'u-jiho')!;
  assert.notEqual(commonDistributionStatus(state, ongoing, distribution, now).executionStatus, 'completed');
  distribution.monthlyReports = [{ id: 'historical-report', month: '2026-10', achievements: '기존 월별 실적', authorId: 'u-jiho', createdAt: now.toISOString(), updatedAt: now.toISOString() }];
  const completed = structuredClone(ongoing); completed.id = 'historical-completed-common';
  const completedTask = structuredClone(state.tasks.find(task => task.id === 'budget-demo-task-plan-settlement')!);
  const completedRun = structuredClone(state.runs.find(run => run.taskId === completedTask.id)!);
  completedTask.id = 'historical-completed-task'; completedTask.commonId = completed.id;
  completedRun.id = 'historical-completed-run'; completedRun.taskId = completedTask.id;
  state.tasks.push(completedTask); state.runs.push(completedRun);
  completed.distributions = [{ ...structuredClone(distribution), id: 'historical-distribution', status: 'registered', taskId: completedTask.id }];
  assert.equal(commonDistributionStatus(state, completed, completed.distributions[0], now).executionStatus, 'completed');
  const previousRecord = structuredClone(completed);
  state.commonTasks.push(completed);
  const previousReports = structuredClone(distribution.monthlyReports);
  const result = applyOrganizationDemo(state, now);
  assert.ok(result.updatedDistributions > 0);
  assert.equal(distribution.team, '예산팀');
  assert.equal(distribution.leadId, 'u-budget-lead');
  assert.equal(state.users.find(user => user.id === distribution.leadId)!.team, distribution.team);
  assert.deepEqual(distribution.monthlyReports, previousReports);
  assert.deepEqual(state.commonTasks.find(common => common.id === completed.id), previousRecord);
  assert.ok(state.audit.some(event => event.detail.includes('기획팀') && event.detail.includes('예산팀')));
});

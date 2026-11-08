import assert from 'node:assert/strict';
import test from 'node:test';
import { dashboardTaskSummary } from '../src/lib/dashboard-summary';
import { createRun, createSeed } from '../src/lib/seed';
import type { Run, Task, WorkspaceTask } from '../src/lib/types';

const now = new Date('2026-11-08T03:00:00Z');
type SummaryWorkspace = Parameters<typeof dashboardTaskSummary>[0];
function fixture() {
  const seed = createSeed(now), user = seed.users.find(item => item.id === 'u-jiho')!;
  const base: Task = { ...seed.tasks[0], commonId: undefined, unitId: 'unit-meeting', departmentId: user.departmentId, primaryId: user.id, status: 'draft', frequency: 'once', dueDate: '2026-11-08', version: 1, versions: [], workflow: [
    { id: 'one', title: '준비', role: 'primary', description: '', output: '', required: true, dependsOn: [], checklist: [] },
    { id: 'two', title: '제출', role: 'primary', description: '', output: '', required: true, dependsOn: ['one'], checklist: [] },
  ] };
  const workspace: SummaryWorkspace = { currentUser: user, tasks: [], runs: [], units: seed.units, commonTasks: [], serverTime: now.toISOString() };
  const task = (id: string, changes: Partial<WorkspaceTask> = {}) => {
    const result = { ...structuredClone(base), id, ...changes };
    workspace.tasks.push(result);
    return result;
  };
  const run = (task: Task, status: Run['status'], done = 0) => {
    const result = createRun(task, '회차', now.toISOString());
    result.status = status;
    result.steps.forEach((step, index) => { step.status = index < done ? 'completed' : 'pending'; });
    workspace.runs.push(result);
    return result;
  };
  return { workspace, seed, task, run };
}
const ids = (tasks: readonly Task[]) => tasks.map(task => task.id);

test('dashboard scope is all authorized tasks for admins, the current department for heads, and own tasks for other roles', () => {
  const { workspace, task } = fixture();
  task('own');
  task('peer', { primaryId: 'someone-else' });
  task('foreign', { primaryId: 'foreign-owner', departmentId: 'dept-support', unitId: 'unit-data' });
  const user = workspace.currentUser;
  for (const role of ['member', 'manager', 'lead'] as const) {
    workspace.currentUser = { ...user, role };
    assert.deepEqual(ids(dashboardTaskSummary(workspace).tasks), ['own']);
  }
  workspace.currentUser = { ...user, role: 'head' };
  assert.deepEqual(ids(dashboardTaskSummary(workspace).tasks), ['own', 'peer']);
  workspace.currentUser = { ...user, role: 'admin' };
  assert.deepEqual(ids(dashboardTaskSummary(workspace).tasks), ['own', 'peer', 'foreign']);
  workspace.tasks = workspace.tasks.filter(item => item.id !== 'foreign');
  assert.deepEqual(ids(dashboardTaskSummary(workspace).tasks), ['own', 'peer'], 'even admins cannot expand the supplied authorized workspace');
});

test('deleted and archived work, inactive or missing units, and unregistered common assignments are excluded from every count', () => {
  const { workspace, seed, task } = fixture();
  task('active');
  task('deleted', { deletedAt: now.toISOString() });
  task('archived', { status: 'archived' });
  task('deleted-unit', { unitId: 'deleted-unit' });
  task('missing-unit', { unitId: 'missing-unit' });
  workspace.units.push({ ...workspace.units[0], id: 'deleted-unit', deletedAt: now.toISOString() });
  const common = { ...seed.commonTasks[0], id: 'common', distributions: [] as typeof seed.commonTasks[0]['distributions'] };
  workspace.commonTasks = [common];
  for (const status of ['pending', 'team_assigned', 'person_assigned', 'registered', 'assigned', 'submitted'] as const) {
    task(status, { commonId: common.id });
    common.distributions.push({ ...seed.commonTasks[0].distributions[0], id: status, taskId: status, status });
  }
  task('missing-distribution', { commonId: common.id });
  task('missing-common', { commonId: 'absent' });
  const summary = dashboardTaskSummary(workspace);
  assert.deepEqual(ids(summary.tasks), ['active', 'registered', 'assigned', 'submitted']);
  assert.deepEqual(ids(summary.dueSoon), ids(summary.tasks));
  assert.equal(summary.notStarted, 4);
  assert.equal(summary.inProgress.length, 0);
});

test('execution counts follow M4 progress and run states rather than definition review or incomplete percentages', () => {
  const { workspace, task, run } = fixture();
  task('draft');
  task('definition-review', { status: 'review' });
  run(task('scheduled'), 'scheduled');
  run(task('running'), 'in_progress');
  run(task('review'), 'review', 1);
  run(task('complete'), 'completed', 2);
  run(task('paused'), 'paused', 2);
  const summary = dashboardTaskSummary(workspace);
  assert.equal(summary.tasks.length, 7);
  assert.deepEqual(ids(summary.inProgress), ['running', 'review']);
  assert.equal(summary.notStarted, 3);
  assert.equal(summary.completed, 1);
  assert.deepEqual(ids(summary.dueSoon), ['draft', 'definition-review', 'scheduled', 'running', 'review']);
});

test('due soon includes today and day seven, excludes overdue and day eight, and always uses the task deadline', () => {
  const { workspace, task, run } = fixture();
  task('overdue', { dueDate: '2026-11-07', cycleDueDate: '2026-11-15' });
  task('today', { dueDate: '2026-11-08' });
  task('day-seven', { dueDate: '2026-11-15' });
  task('day-eight', { dueDate: '2026-11-16' });
  task('missing', { dueDate: '' });
  task('invalid', { dueDate: '2026-11-31' });
  const cycle = run(task('fixed-task-deadline', { dueDate: '2026-11-09', cycleDueDate: '2027-01-01' }), 'in_progress');
  cycle.dueDate = '2027-01-01'; cycle.cycleManaged = true;
  assert.deepEqual(ids(dashboardTaskSummary(workspace).dueSoon), ['today', 'day-seven', 'fixed-task-deadline']);
  workspace.serverTime = '2026-02-25T03:00:00Z';
  task('impossible-within-window', { dueDate: '2026-02-30' });
  task('valid-month-end', { dueDate: '2026-02-28' });
  assert.deepEqual(ids(dashboardTaskSummary(workspace).dueSoon), ['valid-month-end']);
});

test('seven-day windows roll at Korean midnight across month and year boundaries', () => {
  const { workspace, task } = fixture();
  task('today-before-midnight', { dueDate: '2026-12-31' });
  task('day-seven-before-midnight', { dueDate: '2027-01-07' });
  task('day-eight-before-midnight', { dueDate: '2027-01-08' });
  workspace.serverTime = '2026-12-31T14:59:59.999Z';
  assert.deepEqual(ids(dashboardTaskSummary(workspace).dueSoon), ['today-before-midnight', 'day-seven-before-midnight']);
  workspace.serverTime = '2026-12-31T15:00:00.000Z';
  assert.deepEqual(ids(dashboardTaskSummary(workspace).dueSoon), ['day-seven-before-midnight', 'day-eight-before-midnight']);
});

test('new occurrences supersede completed history and dashboard calculation never mutates its workspace', () => {
  const { workspace, task, run } = fixture();
  const recurring = task('recurring');
  const previous = run(recurring, 'completed', 2);
  previous.startedAt = '2026-11-07T00:00:00Z';
  run(recurring, 'scheduled');
  const before = structuredClone(workspace);
  const summary = dashboardTaskSummary(workspace);
  assert.equal(summary.completed, 0);
  assert.equal(summary.notStarted, 1);
  assert.deepEqual(ids(summary.dueSoon), ['recurring']);
  assert.deepEqual(workspace, before);
});

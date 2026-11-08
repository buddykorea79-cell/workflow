import assert from 'node:assert/strict';
import test from 'node:test';
import { formatHash, parseHash, type HashRoute, type TaskTab, type View } from '../src/lib/hash-route';

const views: View[] = ['dashboard', 'personal', 'department', 'budgets', 'allocation', 'division', 'delegation', 'common', 'schedule', 'performance', 'handover', 'organization', 'admin'];
const tabs: TaskTab[] = ['overview', 'workflow', 'schedule', 'performance', 'references', 'budget', 'monthly'];

test('every existing menu fragment remains compatible and empty or unknown menus reset safely', () => {
  for (const view of views) {
    assert.deepEqual(parseHash(`#${view}`), { view });
    assert.deepEqual(parseHash(view), { view });
    assert.equal(formatHash({ view }), `#${view}`);
  }
  for (const hash of ['', '#', '#unknown', '#unknown/task/task-a/workflow?focus=common-a', '#Personal/task/task-a', '#__proto__/task/task-a', '#https://example.com']) assert.deepEqual(parseHash(hash), { view: 'dashboard' });
});

test('all task tabs round trip with real prefix/UUID and ASCII identifier shapes without changing their route', () => {
  for (const view of views) for (const tab of tabs) for (const taskId of ['task-12345678-1234-1234-1234-123456789abc', 'task_AZ09-test']) {
    const route: HashRoute = { view, taskId, tab }, before = { ...route };
    assert.deepEqual(parseHash(formatHash(route)), route);
    assert.deepEqual(route, before);
  }
});

test('missing and unknown task tabs normalize to the explicit overview tab', () => {
  for (const hash of ['#personal/task/task-a', '#personal/task/task-a/', '#personal/task/task-a/unknown', '#personal/task/task-a/%ZZ']) {
    assert.deepEqual(parseHash(hash), { view: 'personal', taskId: 'task-a', tab: 'overview' });
    assert.equal(formatHash(parseHash(hash)), '#personal/task/task-a/overview');
  }
  assert.equal(formatHash({ view: 'personal', taskId: 'task-a' }), '#personal/task/task-a/overview');
  assert.equal(formatHash({ view: 'personal', tab: 'workflow' }), '#personal');
  assert.deepEqual(parseHash('#personal/task/task%2Da/work%66low'), { view: 'personal', taskId: 'task-a', tab: 'workflow' });
});

test('focus round trips only for supported destination menus and survives task detail navigation', () => {
  for (const view of ['common', 'allocation', 'handover', 'personal', 'organization', 'division'] as View[]) {
    for (const route of [{ view, focus: 'record-A_1' }, { view, taskId: 'task-a', tab: 'references' as const, focus: 'record-A_1' }]) {
      assert.deepEqual(parseHash(formatHash(route)), route);
    }
  }
  assert.deepEqual(parseHash('#common?ignored=value&focus=common%2Da'), { view: 'common', focus: 'common-a' });
  assert.deepEqual(parseHash('#dashboard?focus=task-a'), { view: 'dashboard' });
  assert.equal(formatHash({ view: 'schedule', focus: 'task-a' }), '#schedule');
});

test('unsafe or malformed task identifiers and extra path segments never open a detail', () => {
  for (const id of ['', '..', '.', '%2e%2e', '%2Fsecret', 'a%2Fb', 'a%5Cb', '%252Fsecret', '%00', '%1F', '%7f', '%', '%ZZ', '%E0%A4%A', 'task a', 'task+a', '한글', 'javascript:alert(1)', 'task%3Ffocus%3Dx']) {
    assert.deepEqual(parseHash(`#personal/task/${id}/workflow`), { view: 'personal' }, id);
  }
  for (const hash of ['#personal/task/../x', '#personal/task/task-a/workflow/extra', '#personal/task/task-a//', '#personal/other/task-a', '#personal//task/task-a']) assert.deepEqual(parseHash(hash), { view: 'personal' });
  assert.deepEqual(parseHash('#common/task/a%2Fb?focus=common-a'), { view: 'common', focus: 'common-a' });
});

test('malformed, repeated, and unsafe query targets are discarded rather than partially accepted', () => {
  for (const query of ['focus', 'focus=', 'focus=..', 'focus=a/b', 'focus=a%2Fb', 'focus=a%5Cb', 'focus=%', 'focus=%ZZ', 'focus=%00', 'focus=one+two', 'focus=a=b', 'focus=first&focus=second', 'focus=first&%66ocus=first']) {
    assert.deepEqual(parseHash(`#common?${query}`), { view: 'common' }, query);
  }
  assert.deepEqual(parseHash('#common/task/task-a/budget?focus=%ZZ'), { view: 'common', taskId: 'task-a', tab: 'budget' });
});

test('identifier length boundaries and raw controls are enforced even for encoded inputs', () => {
  const id = 'a'.repeat(150);
  assert.deepEqual(parseHash(`#personal/task/${id}?focus=${id}`), { view: 'personal', taskId: id, tab: 'overview', focus: id });
  assert.deepEqual(parseHash(`#personal/task/${'%61'.repeat(150)}?focus=${'%61'.repeat(150)}`), { view: 'personal', taskId: id, tab: 'overview', focus: id });
  assert.deepEqual(parseHash(`#personal/task/${id}a?focus=${id}a`), { view: 'personal' });
  assert.deepEqual(parseHash(`#personal/task/${'a'.repeat(1025)}`), { view: 'dashboard' });
  for (const control of ['\n', '\r', '\t', '\u0000', '\u007f']) assert.deepEqual(parseHash(`#personal/task/task-${control}a`), { view: 'dashboard' });
});

test('formatting also rejects unsafe runtime data and canonicalization remains stable', () => {
  for (const taskId of ['../secret', 'a/b', 'a\\b', 'task%2Fa', 'task a', 'a'.repeat(151)]) {
    assert.equal(formatHash({ view: 'common', taskId, tab: 'budget', focus: 'common-a' }), '#common?focus=common-a');
  }
  assert.equal(formatHash({ view: 'common', focus: 'a/b' }), '#common');
  assert.equal(formatHash({ view: 'unknown', taskId: 'task-a', focus: 'common-a' } as unknown as HashRoute), '#dashboard');
  for (const hash of ['#personal/task/task-a', '#common?focus=common%2Da', '#common/task/bad%2Fid?focus=common-a', '#unknown/task/task-a']) {
    const canonical = formatHash(parseHash(hash));
    assert.equal(formatHash(parseHash(canonical)), canonical);
  }
});

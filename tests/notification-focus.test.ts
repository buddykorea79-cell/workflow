import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';

const componentRequire = createRequire(path.resolve('tests/notification-focus.test.ts'));
const previousCssLoader = componentRequire.extensions['.css'];
componentRequire.extensions['.css'] = () => undefined;
const focus: typeof import('../src/components/notification-focus') = componentRequire('../src/components/notification-focus');
const focusModule = componentRequire.cache[componentRequire.resolve('../src/components/notification-focus')]!;
let prepared = false;
let target: string | undefined;
let common: typeof import('../src/components/common-work');
let allocation: typeof import('../src/components/allocation-review');
let handover: typeof import('../src/components/personnel-handover');
try {
  focusModule.exports = { ...focus, useNotificationFocus: (id: string | undefined, _token: number | undefined, prepare: (id: string) => string | undefined) => {
    // Run preparation once during server rendering so React renders the resulting filter state.
    if (id && !prepared) { prepared = true; target = prepare(id); }
    return (key: string) => ({ 'data-focus-key': key });
  } };
  common = componentRequire('../src/components/common-work');
  allocation = componentRequire('../src/components/allocation-review');
  handover = componentRequire('../src/components/personnel-handover');
} finally {
  focusModule.exports = focus;
  if (previousCssLoader) componentRequire.extensions['.css'] = previousCssLoader;
  else delete componentRequire.extensions['.css'];
}

function clock(reducedMotion = false) {
  let sequence = 0;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { callback: () => void; delay: number }>();
  return {
    frames, timers,
    nextFrame() { const next = frames.entries().next().value; assert.ok(next); frames.delete(next[0]); next[1](); },
    runtime: {
      requestFrame(callback: () => void) { const id = ++sequence; frames.set(id, callback); return id; },
      cancelFrame(id: number) { frames.delete(id); },
      setTimer(callback: () => void, delay: number) { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
      clearTimer(id: number) { timers.delete(id); }, reducedMotion,
    },
  };
}

test('notification focus waits for committed target, preserves keyboard position and ends after two seconds', () => {
  const scheduler = clock();
  const events: unknown[] = [];
  let element: { scrollIntoView: (options: unknown) => void; focus: (options: unknown) => void } | undefined;
  const cancel = focus.scheduleNotificationFocus(() => element, value => events.push(value), scheduler.runtime);
  scheduler.nextFrame(); assert.deepEqual([...events], []);
  element = { scrollIntoView: options => events.push(options), focus: options => events.push(options) };
  scheduler.nextFrame();
  assert.deepEqual(events, [{ behavior: 'smooth', block: 'start' }, { preventScroll: true }, true]);
  const timer = scheduler.timers.values().next().value!;
  assert.equal(timer.delay, 2000); timer.callback(); assert.equal(events.at(-1), false);
  cancel(); assert.equal(scheduler.timers.size, 0);
});

test('reduced motion, missing targets and cancelled focus never leave running highlight work', () => {
  const scheduler = clock(true), events: unknown[] = [];
  const cancel = focus.scheduleNotificationFocus(() => ({ scrollIntoView: options => events.push(options), focus: () => undefined }), value => events.push(value), scheduler.runtime);
  scheduler.nextFrame(); assert.deepEqual(events, [{ behavior: 'auto', block: 'start' }, true]);
  const lateTimer = scheduler.timers.values().next().value!.callback;
  cancel(); lateTimer(); assert.deepEqual(events, [{ behavior: 'auto', block: 'start' }, true]);
  const absent = clock(); focus.scheduleNotificationFocus(() => undefined, () => assert.fail('Missing target must not highlight'), absent.runtime);
  for (let index = 0; index < 10; index++) absent.nextFrame();
  assert.equal(absent.frames.size, 0); assert.equal(absent.timers.size, 0);
  const interrupted = clock();
  focus.scheduleNotificationFocus(() => undefined, () => undefined, interrupted.runtime)();
  assert.equal(interrupted.frames.size, 0);
});

function fixture(actor: string) {
  const now = new Date('2026-11-08T03:00:00Z');
  return getWorkspace(createSeed(now), actor, now);
}
function reset() { prepared = false; target = undefined; }
const command = async () => true;
const noop = () => undefined;

test('common focus exposes actionable assignments and keeps completed work visible', () => {
  const workspace = fixture('u-it-planning-lead');
  const distribution = workspace.commonTasks.find(item => item.id === 'common-budget')!.distributions[0];
  distribution.status = 'team_assigned'; distribution.leadId = workspace.currentUser.id; distribution.stage = 'person_pending';
  reset();
  const actionable = renderToStaticMarkup(createElement(common.CommonWork, { workspace, command, onOpenTask: noop, focusId: 'common-budget' }));
  assert.equal(target, 'common:common-budget');
  assert.match(actionable, /role="tab"[^>]*aria-selected="true"[^>]*>내 처리 대상/);
  assert.match(actionable, /data-focus-key="common:common-budget"/);
  distribution.status = 'submitted'; distribution.stage = 'completed'; distribution.executionStatus = 'completed'; distribution.nextActorIds = [];
  reset();
  const completed = renderToStaticMarkup(createElement(common.CommonWork, { workspace, command, onOpenTask: noop, focusId: 'common-budget' }));
  assert.match(completed, /role="tab"[^>]*aria-selected="true"[^>]*>전체 조회/);
  assert.match(completed, /data-focus-key="common:common-budget"/);
});

test('unpublished common notifications focus their approval card instead of an absent distribution', () => {
  const workspace = fixture('u-support-head');
  const item = workspace.commonTasks.find(item => item.id === 'statistics-demo-common-yearbook')!;
  reset();
  const html = renderToStaticMarkup(createElement(common.CommonWork, { workspace, command, onOpenTask: noop, focusId: item.id }));
  assert.equal(target, `approval:${item.approvalRequests![0].id}`);
  assert.ok(html.includes(`data-focus-key="${target}"`));
  reset(); renderToStaticMarkup(createElement(common.CommonWork, { workspace, command, onOpenTask: noop, focusId: 'not-readable' }));
  assert.equal(target, undefined);
});

test('allocation focus switches admin department and reveals already assigned rows', () => {
  const workspace = fixture('u-admin');
  const item = workspace.commonTasks.find(item => item.id === 'common-budget')!;
  item.distributions = item.distributions.filter(distribution => distribution.departmentId === 'dept-support');
  item.distributions[0].status = 'team_assigned'; item.distributions[0].stage = 'person_pending';
  reset();
  const html = renderToStaticMarkup(createElement(allocation.AllocationReview, { workspace, command, onOpenCommon: noop, onOpenHandover: noop, onOpenDivision: noop, focusId: item.id }));
  assert.equal(target, `distribution:${item.distributions[0].id}`);
  assert.match(html, /value="dept-support" selected=""/);
  assert.ok(html.includes(`data-focus-key="${target}"`));
  assert.match(html, /aria-pressed="true">전체 내역/);
});

test('handover focus exposes a completed legacy record read-only without opening a new form', () => {
  const workspace = fixture('u-admin');
  const item = workspace.handovers.find(item => item.id === 'handover-meeting')!;
  item.status = 'completed'; item.departmentId = 'dept-support';
  reset();
  const html = renderToStaticMarkup(createElement(handover.PersonnelHandover, { workspace, command, onOpenTask: noop, focusId: item.id }));
  assert.equal(target, `legacy:${item.id}`);
  assert.match(html, /class="handover-legacy" open=""/);
  assert.ok(html.includes(`data-focus-key="${target}"`));
  assert.doesNotMatch(html, />이전 요청 취소<\/button>/);
});

test('transfer focus selects pending or history and the actual target department', () => {
  const workspace = fixture('u-admin');
  workspace.workTransfers = [{
    id: 'focus-transfer', kind: 'direct', status: 'completed', departmentId: 'dept-support',
    fromId: 'u-support-member', fromName: '인계자', toId: 'u-it-planning-member-1', toName: '인수자',
    requestedBy: 'u-doyun', requestedByName: '요청자', reason: '합성 인수인계', createdAt: workspace.serverTime,
    unitIds: [], taskIds: [], runIds: [], units: [], tasks: [], events: [],
  }];
  reset();
  const history = renderToStaticMarkup(createElement(handover.PersonnelHandover, { workspace, command, onOpenTask: noop, focusId: 'focus-transfer' }));
  assert.equal(target, 'transfer:focus-transfer');
  assert.match(history, /value="dept-support" selected=""/);
  assert.match(history, /role="tab"[^>]*aria-selected="true"[^>]*>인수인계 이력/);
  assert.match(history, /data-focus-key="transfer:focus-transfer"/);
  workspace.workTransfers[0].status = 'pending';
  reset();
  const pending = renderToStaticMarkup(createElement(handover.PersonnelHandover, { workspace, command, onOpenTask: noop, focusId: 'focus-transfer' }));
  assert.match(pending, /role="tab"[^>]*aria-selected="true"[^>]*>승인 대기/);
  assert.match(pending, /data-focus-key="transfer:focus-transfer"/);
});

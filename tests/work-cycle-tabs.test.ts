import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, Fragment, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';
import { taskCycleState } from '../src/lib/work-cycles';

const componentRequire = createRequire(path.resolve('tests/work-cycle-tabs.test.ts'));
const previousCssLoader = componentRequire.extensions['.css'];
let cycles: typeof import('../src/components/work-cycles');
let evaluation: typeof import('../src/components/unit-evaluation');
try {
  componentRequire.extensions['.css'] = () => undefined;
  cycles = componentRequire('../src/components/work-cycles');
  evaluation = componentRequire('../src/components/unit-evaluation');
} finally {
  if (previousCssLoader) componentRequire.extensions['.css'] = previousCssLoader;
  else delete componentRequire.extensions['.css'];
}

const now = new Date('2026-11-08T03:00:00Z');
const owner = 'u-support-member';
const command = async () => { throw new Error('Rendering must not issue a command'); };

function fixture(history = false, at = now) {
  const state = createSeed(at);
  const task = state.tasks.find(item => item.id === 'task-data')!;
  const current = taskCycleState(state, task).latest!;
  current.notes = [{ id: 'current-note', authorId: owner, body: '현재 회차 메모만 표시', createdAt: at.toISOString() }];
  const past = structuredClone(current);
  past.id = 'tabs-past-run'; past.startedAt = '2026-01-01T03:00:00Z'; past.completedAt = '2026-03-31T03:00:00Z'; past.status = 'completed'; past.cycleNumber = 1;
  past.steps.forEach(step => { step.status = 'completed'; });
  past.notes = [{ id: 'past-note', authorId: owner, body: '지난 회차 메모만 표시', createdAt: past.completedAt }];
  if (history) { state.runs.push(past); current.cycleNumber = 2; }
  const workspace = getWorkspace(state, owner, at);
  return { workspace, task: workspace.tasks.find(item => item.id === task.id)!, past };
}

function workCycles(history = false, dirty = false) {
  const { workspace, task, past } = fixture(history);
  return { past, element: createElement(cycles.WorkCycles, { workspace, task, command, dirty }, createElement('p', null, '현재 회차 추가 콘텐츠')) };
}

function renderWithState(element: ReactNode, retained: (initial: unknown) => unknown) {
  const react = componentRequire('react') as typeof import('react');
  const original = react.useState;
  react.useState = ((initial: unknown) => original(retained(initial))) as typeof react.useState;
  try { return renderToStaticMarkup(element); }
  finally { react.useState = original; }
}

function elements(html: string, role: string) {
  return [...html.matchAll(new RegExp(`<[^>]+role="${role}"[^>]*>`, 'g'))].map(match => {
    const attributes = Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute => [attribute[1], attribute[2]]));
    return { markup: match[0], attributes };
  });
}

function linkedPanels(html: string) {
  const tabs = elements(html, 'tab'); const panels = elements(html, 'tabpanel');
  assert.equal(tabs.length, 2); assert.equal(panels.length, 2);
  for (const { attributes: tab } of tabs) {
    const panel = panels.find(item => item.attributes.id === tab['aria-controls']);
    assert.ok(panel, 'every tab, including an inactive or disabled tab, has an existing panel');
    assert.equal(panel.attributes['aria-labelledby'], tab.id);
    assert.equal(tab.tabindex, tab['aria-selected'] === 'true' ? '0' : '-1');
    assert.equal('hidden' in panel.attributes, tab['aria-selected'] !== 'true');
  }
  return tabs;
}

test('one available cycle still exposes two uniquely linked tabs and only the current panel', () => {
  const html = renderToStaticMarkup(workCycles().element);
  const tabs = linkedPanels(html);
  assert.match(html, /role="tablist"[^>]*aria-label="업무 회차"|aria-label="업무 회차"[^>]*role="tablist"/);
  assert.equal(tabs[0].attributes['aria-selected'], 'true');
  assert.equal('disabled' in tabs[0].attributes, false);
  assert.equal('disabled' in tabs[1].attributes, true);
  assert.doesNotMatch(tabs.map(tab => tab.markup).join(''), /aria-pressed/);
  assert.match(html, /현재 회차 메모만 표시/);
  assert.match(html, /현재 회차 추가 콘텐츠/);
});

test('dirty task state does not disable current/history navigation while its existing editing restriction remains', () => {
  const html = renderToStaticMarkup(workCycles(true, true).element);
  const tabs = linkedPanels(html);
  assert.ok(tabs.every(tab => !('disabled' in tab.attributes)));
  assert.match(html, /저장하지 않은 업무 변경사항/);
  assert.match(html, /현재 회차 메모만 표시/);
  assert.doesNotMatch(html, /지난 회차 메모만 표시/);
});

test('the selected historical cycle has a labelled active panel and does not mount current forms or children', () => {
  const { element, past } = workCycles(true);
  let changed = false;
  const html = renderWithState(element, initial => { if (!changed && initial === 'current') { changed = true; return past.id; } return initial; });
  const tabs = linkedPanels(html);
  assert.equal(tabs[1].attributes['aria-selected'], 'true');
  assert.match(html, /지난 회차 메모만 표시/);
  assert.doesNotMatch(html, /현재 회차 메모만 표시|현재 회차 추가 콘텐츠|wc-note-form/);
});

test('the schedule form stays in the current panel without disabling its available history tab', () => {
  const { element } = workCycles(true);
  let changed = false;
  const html = renderWithState(element, initial => { if (!changed && initial === null) { changed = true; return 'current'; } return initial; });
  const tabs = linkedPanels(html);
  assert.equal(tabs[0].attributes['aria-selected'], 'true');
  assert.equal('disabled' in tabs[1].attributes, false);
  assert.match(html, /wc-next-form/);
  assert.match(html, /현재 회차 추가 콘텐츠/);
  assert.doesNotMatch(html, /wc-note-form/);
});

test('multiple cycle controls have distinct tab and panel ids', () => {
  const first = workCycles(true).element; const second = workCycles().element;
  const html = renderToStaticMarkup(createElement(Fragment, null, first, second));
  const ids = [...elements(html, 'tab'), ...elements(html, 'tabpanel')].map(item => item.attributes.id);
  assert.equal(ids.length, 8); assert.equal(new Set(ids).size, 8);
});

test('half-year selectors remain pressed-state filters and preserve the future-half restriction', () => {
  const at = new Date('2026-05-08T03:00:00Z');
  const { workspace } = fixture(false, at);
  const html = renderToStaticMarkup(createElement(evaluation.PerformanceView, { workspace, command, onOpenTask() {} }));
  const group = html.match(/<div class="tabs" role="group" aria-label="성과 평가 반기">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(group);
  const buttons = [...group.matchAll(/<button[^>]*>/g)].map(match => match[0]);
  assert.equal(buttons.length, 2);
  assert.match(buttons[0], /type="button"/); assert.match(buttons[0], /aria-pressed="true"/);
  assert.match(buttons[1], /aria-pressed="false"/); assert.match(buttons[1], /disabled=""/);
  assert.doesNotMatch(group, /role="tab"|aria-selected|aria-controls/);
});

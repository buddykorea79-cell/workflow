import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderComponent } from './helpers/render-component';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';

const componentRequire = createRequire(path.resolve('tests/personal-routing.test.ts'));
const previousCssLoader = componentRequire.extensions['.css'];
componentRequire.extensions['.css'] = () => undefined;
const ui = componentRequire('../src/components/ui');
const uiModule = componentRequire.cache[componentRequire.resolve('../src/components/ui')]!;
const originalUi = uiModule.exports;
type ButtonProps = Record<string, unknown> & { children?: ReactNode; onClick?: () => unknown };
let buttons: ButtonProps[] = [];
let personal: typeof import('../src/components/personal-work');
const callbackUi = {
  ...ui,
  // Portals require a browser; render the same modal children for these callback checks.
  Modal: ({ title, children }: { title: string; children: ReactNode }) => createElement('section', { 'aria-label': title }, children),
  Button: ({ variant: _variant, ...props }: ButtonProps) => { buttons.push(props); return createElement('button', props, props.children); },
};
try {
  uiModule.exports = callbackUi;
  personal = componentRequire('../src/components/personal-work');
} finally {
  uiModule.exports = originalUi;
  if (previousCssLoader) componentRequire.extensions['.css'] = previousCssLoader;
  else delete componentRequire.extensions['.css'];
}

function textOf(value: ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(textOf).join('');
  return isValidElement<{ children?: ReactNode }>(value) ? textOf(value.props.children) : '';
}
function button(label: string) {
  const result = buttons.find(item => item['aria-label'] === label || textOf(item.children) === label);
  assert.ok(result, `Expected button: ${label}`);
  return result;
}
function fixture(actor = 'u-jiho') {
  const now = new Date('2026-11-08T03:00:00Z');
  return getWorkspace(createSeed(now), actor, now);
}
async function renderPanel(props: Partial<Parameters<typeof personal.TaskPanel>[0]> = {}) {
  buttons = [];
  const previousUi = uiModule.exports;
  const previousCss = componentRequire.extensions['.css'];
  uiModule.exports = callbackUi;
  componentRequire.extensions['.css'] = () => undefined;
  try {
    return await renderComponent(createElement(personal.TaskPanel, {
      workspace: fixture(), taskId: 'task-meeting', command: async () => true, onClose: () => undefined, initialMode: 'view', ...props,
    }));
  } finally {
    uiModule.exports = previousUi;
    if (previousCss) componentRequire.extensions['.css'] = previousCss;
    else delete componentRequire.extensions['.css'];
  }
}

test('personal task actions pass view and edit intent to the central detail opener', () => {
  buttons = [];
  const opened: unknown[] = [];
  const workspace = fixture();
  renderToStaticMarkup(createElement(personal.PersonalWork, { workspace, command: async () => true, onOpenTask: (id, options) => opened.push({ id, ...options }) }));
  const task = workspace.tasks.find(item => item.id === 'task-meeting')!;
  button(`${task.title} 보기`).onClick?.();
  button(`${task.title} 수정`).onClick?.();
  assert.deepEqual(opened, [{ id: task.id, mode: 'view' }, { id: task.id, mode: 'edit' }]);
});

test('routed procedure and record-entry actions update the central detail tab', async () => {
  const tabs: string[] = [];
  const workflow = await renderPanel({ routedTab: 'workflow', onTabChange: tab => tabs.push(tab) });
  assert.match(workflow, /aria-label="현재 적용된 업무 절차"/);
  await button('일정 등록').onClick?.();
  assert.deepEqual(tabs, ['schedule']);

  await renderPanel({ routedTab: 'overview', onTabChange: tab => tabs.push(tab) });
  button('수행 기록 입력').onClick?.();
  assert.deepEqual(tabs, ['schedule', 'references']);
});

test('organization and performance navigation use central destinations without also closing history', async () => {
  const destinations: string[] = [];
  let closes = 0;
  const workspace = fixture('u-admin');
  workspace.tasks.find(task => task.id === 'task-meeting')!.reviewerId = '';
  await renderPanel({ workspace, routedTab: 'workflow', onClose: () => { closes++; }, onNavigateView: view => destinations.push(view) });
  button('조직 · 구성원 확인').onClick?.();
  await renderPanel({ routedTab: 'performance', onClose: () => { closes++; }, onNavigateView: view => destinations.push(view) });
  button('성과 · 평가').onClick?.();
  assert.deepEqual(destinations, ['organization', 'performance']);
  assert.equal(closes, 0);
});

test('a monthly route on ordinary work falls back to overview and inaccessible tasks show the existing notice', async () => {
  const monthly = await renderPanel({ routedTab: 'monthly' });
  assert.match(monthly, /data-field-label="업무 설명"/);
  assert.doesNotMatch(monthly, />월별 실적<\/button>/);
  const unavailable = await renderPanel({ taskId: 'unavailable-task', routedTab: 'workflow' });
  assert.match(unavailable, /업무를 확인할 수 없습니다/);
  assert.match(unavailable, /접근 가능한 업무가 아닙니다/);
});

test('every personal detail tab names its panel and keeps keyboard selection available', async () => {
  for (const routedTab of ['overview', 'workflow', 'schedule', 'performance', 'references', 'budget'] as const) {
    const html = await renderPanel({ routedTab });
    assert.match(html, /role="tablist" aria-label="세부업무 상세"/);
    const detailTabs = [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>/g)].filter(([tag]) => tag.includes(`-${routedTab}"`) || tag.includes('aria-controls="'));
    const active = detailTabs.filter(([tag]) => tag.includes('aria-selected="true"'));
    // Nested cycle tabs are allowed; the six detail controls must all resolve to panels.
    const topTabs = detailTabs.slice(0, 6);
    assert.equal(topTabs.length, 6);
    assert.equal(topTabs.filter(([tag]) => tag.includes('aria-selected="true"')).length, 1);
    assert.ok(active.length >= 1);
    for (const [tag] of topTabs) {
      const control = tag.match(/aria-controls="([^"]+)"/)![1];
      const id = tag.match(/ id="([^"]+)"/)![1];
      assert.ok(html.includes(`id="${control}" role="tabpanel" aria-labelledby="${id}"`));
      assert.doesNotMatch(tag, /disabled=/);
      assert.ok(tag.includes(`tabindex="${tag.includes('aria-selected="true"') ? '0' : '-1'}"`));
    }
  }
});

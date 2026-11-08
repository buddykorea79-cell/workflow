import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';
import type { Expense, TaskReference } from '../src/lib/types';

const componentRequire = createRequire(path.resolve('tests/read-only-sections.test.ts'));
const cssLoader = componentRequire.extensions['.css'];
let budget: typeof import('../src/components/task-budget');
let referencesUi: typeof import('../src/components/task-references');
try {
  componentRequire.extensions['.css'] = () => undefined;
  budget = componentRequire('../src/components/task-budget');
  referencesUi = componentRequire('../src/components/task-references');
} finally {
  if (cssLoader) componentRequire.extensions['.css'] = cssLoader;
  else delete componentRequire.extensions['.css'];
}

const now = new Date('2026-11-08T03:00:00Z');
const noop = () => undefined;
const expense: Expense = { id: 'expense-local', date: '2026-11-08', projectName: '저장 전 사업명', vendor: undefined, description: '첫 줄\n두 번째 줄', amount: 0 };
type BudgetProps = Parameters<typeof budget.TaskBudgetSection>[0];
function budgetProps(changes: Partial<BudgetProps> = {}): BudgetProps {
  return {
    value: { mode: 'manual', amount: '0' }, onChange: noop, expenses: [expense], onExpensesChange: noop,
    previousExpenses: [], definitionEditable: false, expensesEditable: false, today: '2026-11-08', defaultProjectName: '기존 사업명', ...changes,
  };
}
const renderBudget = (changes: Partial<BudgetProps> = {}) => renderToStaticMarkup(createElement(budget.TaskBudgetSection, budgetProps(changes)));

test('budget view renders local draft text, full dates and zero values without disabled controls', () => {
  const html = renderBudget();
  assert.doesNotMatch(html, /<(?:input|select|textarea)\b/);
  assert.match(html, /data-read-label="사업 예산 \(원\)" data-read-value="0"/);
  assert.match(html, /data-read-label="집행 금액 \(원\)" data-read-value="0"/);
  assert.match(html, /2026\. 11\. 8\./);
  assert.match(html, /저장 전 사업명/);
  assert.match(html, /첫 줄\n두 번째 줄/);
  assert.match(html, /read-field-empty[^>]*>미입력/);
  assert.doesNotMatch(html, /집행 추가|집행 내역 삭제|확정 예산 검색/);
});

test('definition and expense permissions switch independently while editable fields keep the current draft', () => {
  const expensesOnly = renderBudget({ expensesEditable: true, value: { mode: 'manual', amount: '12000' } });
  assert.match(expensesOnly, /data-read-label="사업 예산 \(원\)" data-read-value="12,000"/);
  assert.match(expensesOnly, /aria-label="1번 집행일" type="date"/);
  assert.match(expensesOnly, /value="저장 전 사업명"/);
  assert.match(expensesOnly, /집행 추가/);
  assert.doesNotMatch(expensesOnly, /<input[^>]*disabled/);
  const definitionOnly = renderBudget({ definitionEditable: true });
  assert.match(definitionOnly, /type="checkbox"/);
  assert.match(definitionOnly, /type="number"[^>]*value="0"/);
  assert.match(definitionOnly, /data-read-label="집행일"/);
  assert.doesNotMatch(definitionOnly, /집행 추가|aria-label="1번 집행일"/);
});

test('catalog amounts and nonbudget records remain text while their original editing restrictions hold', () => {
  const allocation = { id: 'catalog-example', year: 2026, account: '일반회계', field: '분야', sector: '부문', program: '프로그램', projectName: '확정 사업', confirmedAmountWon: 12000, active: true } as NonNullable<BudgetProps['value']['allocation']>;
  const catalog = renderBudget({ definitionEditable: true, value: { mode: 'catalog', amount: '12000', allocation } });
  assert.match(catalog, /data-read-label="2026년도 확정 예산 \(원\)" data-read-value="12,000"/);
  assert.doesNotMatch(catalog, /type="number"/);
  assert.match(catalog, /확정 예산 검색|직접 입력으로 변경/);
  const nonbudget = renderBudget({ expensesEditable: true, value: { mode: 'none', amount: '0' } });
  assert.doesNotMatch(nonbudget, /<(?:input|select|textarea)\b|집행 추가/);
  assert.match(nonbudget, /data-read-label="예산 구분" data-read-value="비예산 사업"/);
  assert.match(nonbudget, /data-read-label="집행 내용·비고"/);
});

type ReferenceProps = Parameters<typeof referencesUi.TaskReferences>[0];
function referenceProps(changes: Partial<ReferenceProps> = {}): ReferenceProps {
  const workspace = getWorkspace(createSeed(now), 'u-jiho', now);
  const task = workspace.tasks.find(item => item.primaryId === workspace.currentUser.id)!;
  workspace.attachments = [{ id: 'attachment-test', taskId: task.id, name: '참고 원문.pdf', size: 1234, mime: 'application/pdf', sha256: '', storageKey: '', status: 'test_allowed', uploadedBy: workspace.currentUser.id, createdAt: now.toISOString() }];
  return {
    workspace, taskId: task.id, references: [{ id: 'ref-law', type: 'law', title: '저장 전 법령', content: '첫 조항\n다음 조항', url: 'https://example.test/law', attachmentId: 'attachment-test' }],
    editable: false, onChange: noop, command: async () => true, onBusyChange: noop, ...changes,
  };
}

test('reference view keeps long local text, safe links and downloads without input controls', () => {
  const props = referenceProps();
  props.references[0].content = `${'긴 설명'.repeat(600)}\n두 번째 줄 https://example.test/page`;
  const html = renderToStaticMarkup(createElement(referencesUi.TaskReferences, props));
  assert.doesNotMatch(html, /<(?:input|select|textarea)\b/);
  assert.match(html, /data-read-label="제목" data-read-value="저장 전 법령"/);
  assert.ok(html.includes('긴 설명'.repeat(600)));
  assert.match(html, /href="https:\/\/example\.test\/page" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /href="\/api\/attachments\/attachment-test"/);
  assert.match(html, /data-read-label="연결할 첨부파일 \(선택\)" data-read-value="참고 원문.pdf"/);
  props.references[0].url = 'javascript:alert(1)';
  const unsafe = renderToStaticMarkup(createElement(referencesUi.TaskReferences, props));
  assert.doesNotMatch(unsafe, /href="javascript:/);
});

test('document-only editing leaves legal references as text and keeps document content editing with a fixed type', () => {
  const props = referenceProps({ editable: true, documentsOnly: true });
  props.references.push({ id: 'ref-document', type: 'document', title: '저장 전 생산 문서', content: '수정 중인 결과' });
  const html = renderToStaticMarkup(createElement(referencesUi.TaskReferences, props));
  const cards = [...html.matchAll(/<section class="pw-reference-card"[^>]*>([\s\S]*?)<\/section>/g)].map(match => match[1]);
  assert.equal(cards.length, 2);
  assert.doesNotMatch(cards[0], /<(?:input|select|textarea)\b/);
  assert.match(cards[1], /data-read-label="근거 유형" data-read-value="생산 문서"/);
  assert.match(cards[1], /value="저장 전 생산 문서"/);
  assert.match(cards[1], /<textarea[^>]*>수정 중인 결과<\/textarea>/);
  assert.doesNotMatch(cards[1], /(?:input|textarea)[^>]*disabled/);
  assert.match(cards[1], /<select/);
});

type NodeProps = { children?: ReactNode; value?: unknown; onChange?: (event: { target: { value: string } }) => void; onClick?: () => void };
function* elementTree(node: ReactNode): Generator<ReactElement<NodeProps>> {
  if (Array.isArray(node)) { for (const child of node) yield* elementTree(child); return; }
  if (!isValidElement<NodeProps>(node)) return;
  yield node;
  yield* elementTree(node.props.children);
}

test('switching reference inputs to text retains the pending attachment choice and cancel callback', async () => {
  const slots: unknown[] = [], changes: TaskReference[][] = [], busy: boolean[] = [];
  const props = referenceProps({ editable: true, onChange: next => changes.push(next), onBusyChange: next => busy.push(next) });
  props.references[0].attachmentId = undefined;
  const react = componentRequire('react') as typeof import('react');
  function render() {
    const previous = { useState: react.useState, useRef: react.useRef, useEffect: react.useEffect }; let index = 0;
    react.useState = ((initial: unknown) => {
      const slot = index++; if (!(slot in slots)) slots[slot] = initial;
      return [slots[slot], (next: unknown) => { slots[slot] = typeof next === 'function' ? next(slots[slot]) : next; }];
    }) as typeof react.useState;
    react.useRef = ((initial: unknown) => { const slot = index++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot]; }) as typeof react.useRef;
    react.useEffect = (() => { index++; }) as typeof react.useEffect;
    try { return referencesUi.TaskReferences(props); }
    finally { Object.assign(react, previous); }
  }
  const initial = render();
  const attachmentSelect = [...elementTree(initial)].find(node => node.type === 'select' && node.props.value === '');
  assert.ok(attachmentSelect?.props.onChange);
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ text: '새 파일에서 읽은 본문' });
    attachmentSelect.props.onChange({ target: { value: 'attachment-test' } });
    assert.deepEqual(busy, [true]); assert.equal(changes.length, 0);
    await new Promise<void>(resolve => setImmediate(resolve));
  } finally { globalThis.fetch = originalFetch; }
  props.editable = false;
  const viewing = render(), html = renderToStaticMarkup(viewing);
  assert.match(html, /aria-label="첨부파일 본문 확인"/);
  assert.match(html, /참고 원문.pdf/);
  assert.match(html, /data-read-label="제목"/);
  const cancel = [...elementTree(viewing)].find(node => node.props.children === '파일 연결 변경 취소');
  assert.ok(cancel?.props.onClick); cancel.props.onClick();
  assert.deepEqual(busy, [true, true, false]); assert.equal(changes.length, 0);
  assert.doesNotMatch(renderToStaticMarkup(render()), /aria-label="첨부파일 본문 확인"/);
});

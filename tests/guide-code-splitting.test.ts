import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { guideRoleSummaries, type GuideRole, type GuideSection } from '../src/lib/guide-role-summaries';
import { guideRoles } from '../src/lib/usage-guide';

const requireComponent = createRequire(path.resolve('tests/guide-code-splitting.test.ts'));
const css = requireComponent.extensions['.css'];
let landing: typeof import('../src/components/landing-guide');
let dialog: typeof import('../src/components/usage-guide-dialog');
let guide: typeof import('../src/components/usage-guide');
let ui: typeof import('../src/components/ui');
try {
  requireComponent.extensions['.css'] = () => undefined;
  landing = requireComponent('../src/components/landing-guide');
  dialog = requireComponent('../src/components/usage-guide-dialog');
  guide = requireComponent('../src/components/usage-guide');
  ui = requireComponent('../src/components/ui');
} finally { if (css) requireComponent.extensions['.css'] = css; else delete requireComponent.extensions['.css']; }

type Props = { children?: ReactNode; className?: string; onClick?: () => void; onMouseEnter?: () => void; onFocusCapture?: () => void };
function* nodes(node: ReactNode): Generator<ReactElement<Props>> {
  if (Array.isArray(node)) { for (const child of node) yield* nodes(child); return; }
  if (!isValidElement<Props>(node)) return;
  yield node; yield* nodes(node.props.children);
}

test('landing guide preserves all five role summaries and only opens the requested role after activation', () => {
  assert.equal(guideRoleSummaries.length, 5);
  assert.deepEqual(guideRoles.map(({ id, title, summary }) => ({ id, title, summary })), guideRoleSummaries);
  const opened: [GuideSection, GuideRole | undefined][] = [];
  let preloaded = 0;
  const tree = landing.LandingGuide({ onOpen: (section, role) => opened.push([section, role]), onPreload: () => { preloaded++; } });
  const html = renderToStaticMarkup(tree);
  for (const role of guideRoleSummaries) { assert.ok(html.includes(role.title)); assert.ok(html.includes(role.summary)); }
  tree.props.onMouseEnter?.(); tree.props.onFocusCapture?.();
  assert.equal(preloaded, 2); assert.deepEqual(opened, []);
  const cards = [...nodes(tree)].filter(node => node.props.className === 'guide-role-card');
  for (const card of cards) card.props.onClick?.();
  assert.deepEqual(opened, guideRoleSummaries.map(role => ['roles', role.id]));
  const allGuide = [...nodes(tree)].find(node => node.type === ui.Button);
  assert.ok(allGuide?.props.onClick); allGuide.props.onClick();
  assert.deepEqual(opened.at(-1), ['start', undefined]);
});

test('guide dialog owns the immediate modal shell and close handler before lazy content resolves', () => {
  let closed = 0;
  const close = () => { closed++; };
  const tree = dialog.UsageGuide({ onClose: close, initialRole: 'head', initialSection: 'roles' });
  assert.equal(tree.type, ui.Modal);
  assert.equal(tree.props.title, '온이음 사용 안내');
  assert.equal(tree.props.wide, true);
  assert.equal(tree.props.onClose, close);
  const child = tree.props.children;
  assert.ok(isValidElement<{ onClose: () => void; initialRole: string; initialSection: string }>(child));
  assert.equal(child.props.initialRole, 'head'); assert.equal(child.props.initialSection, 'roles');
  assert.equal(child.props.onClose, close);
  tree.props.onClose(); assert.equal(closed, 1);
});

test('lazy guide content retains its initial section and role without adding a second modal', () => {
  for (const section of ['start', 'roles', 'task', 'faq'] as const) {
    const html = renderToStaticMarkup(createElement(guide.UsageGuideContent, { onClose: () => undefined, initialRole: 'head', initialSection: section }));
    assert.match(html, /class="usage-guide"/);
    assert.doesNotMatch(html, /role="dialog"/);
    assert.match(html, />안내 닫기</);
    if (section === 'roles') assert.ok(html.includes(guideRoles.find(role => role.id === 'head')!.summary));
  }
});

/** Check actual static runtime dependencies, ignoring erased types and dynamic imports. */
function staticDependencies(entry: string) {
  const seen = new Set<string>();
  function visit(file: string) {
    file = path.resolve(file); if (seen.has(file)) return; seen.add(file);
    const ast = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of ast.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.isTypeOnly || clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.every(item => item.isTypeOnly)) continue;
      } else if (statement.isTypeOnly) continue;
      const name = statement.moduleSpecifier.text;
      const base = name.startsWith('@/') ? path.resolve('src', name.slice(2)) : name.startsWith('.') ? path.resolve(path.dirname(file), name) : undefined;
      if (!base) continue;
      const target = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map(extension => base + extension).find(candidate => /\.(?:ts|tsx)$/.test(candidate) && existsSync(candidate));
      if (target) visit(target);
    }
  }
  visit(entry); return seen;
}

test('eager guide entry points and management exclude their detailed lazy modules from static imports', () => {
  for (const entry of ['src/components/landing-guide.tsx', 'src/components/usage-guide-dialog.tsx']) {
    const dependencies = staticDependencies(entry);
    assert.equal(dependencies.has(path.resolve('src/components/usage-guide.tsx')), false);
    assert.equal(dependencies.has(path.resolve('src/lib/usage-guide.ts')), false);
    assert.equal(dependencies.has(path.resolve('src/lib/guide-topics.ts')), false);
  }
  const management = staticDependencies('src/components/management.tsx');
  for (const file of ['admin-integrations.tsx', 'admin-budget-catalog.tsx', 'common-work.tsx', 'unit-evaluation.tsx']) {
    assert.equal(management.has(path.resolve('src/components', file)), false, file);
  }
});

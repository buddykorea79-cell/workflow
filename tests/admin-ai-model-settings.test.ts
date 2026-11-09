import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { isValidElement, type ReactNode } from 'react';
import type { AiModelSetting } from '../src/lib/ai-model-types';
import type { BizRouterModel } from '../src/lib/bizrouter-models';

const requireUi = createRequire(path.resolve('tests/admin-ai-model-settings.test.ts'));
const previousCss = requireUi.extensions['.css']; requireUi.extensions['.css'] = () => undefined;
let ui: typeof import('../src/components/admin-ai-model-settings');
let integrations: typeof import('../src/components/admin-integrations');
try { ui = requireUi('../src/components/admin-ai-model-settings'); integrations = requireUi('../src/components/admin-integrations'); }
finally { if (previousCss) requireUi.extensions['.css'] = previousCss; else delete requireUi.extensions['.css']; }

type Props = Record<string, any> & { children?: ReactNode };
function all(node: ReactNode, predicate: (props: Props, type: unknown) => boolean): Props[] {
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate));
  if (!isValidElement<Props>(node)) return [];
  return [...(predicate(node.props, node.type) ? [node.props] : []), ...all(node.props.children, predicate)];
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return isValidElement<Props>(node) ? text(node.props.children) : '';
}
function host(render: () => ReactNode) {
  const slots: any[] = []; let tree: ReactNode; let effects: (() => void)[] = [];
  return {
    render() {
      const react = requireUi('react') as typeof import('react');
      const saved = { useState: react.useState, useRef: react.useRef, useEffect: react.useEffect, useId: react.useId }; let index = 0;
      react.useState = ((initial?: unknown) => { const at = index++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], (update: any) => { slots[at] = typeof update === 'function' ? update(slots[at]) : update; }]; }) as typeof react.useState;
      react.useRef = ((initial: unknown) => { const at = index++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; }) as typeof react.useRef;
      react.useId = (() => `model-${index++}`) as typeof react.useId;
      react.useEffect = ((effect: () => unknown, deps: unknown[]) => { const at = index++; const previous = slots[at]; if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) { slots[at] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[at].cleanup = effect(); }); } }) as typeof react.useEffect;
      try { tree = render(); } finally { Object.assign(react, saved); }
      const pending = effects; effects = []; pending.forEach(effect => effect()); return text(tree);
    },
    all(predicate: (props: Props, type: unknown) => boolean) { return all(tree, predicate); },
    one(predicate: (props: Props, type: unknown) => boolean) { const found = all(tree, predicate); assert.equal(found.length, 1); return found[0]; },
    button(label: string) { return this.one(props => !!props.onClick && text(props.children).trim() === label); },
    select() { return this.one((_props, type) => type === 'select'); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const initial: AiModelSetting = { modelId: null, effectiveModel: 'openai/gpt-6.1-sol', environmentModel: 'openai/gpt-6.1-sol', source: 'environment', revision: 3 };
const selected = 'anthropic/claude-sonnet-5.5';
const models: BizRouterModel[] = [{ id: initial.effectiveModel!, name: 'Sol', structuredOutput: true }, { id: selected, name: 'Sonnet', structuredOutput: true }, { id: 'anthropic/claude-opus-5.5', name: 'Opus', structuredOutput: false }, { id: 'provider/another', name: 'Another', structuredOutput: true }];
const catalog = () => Response.json({ models, checkedAt: '2026-11-09T12:00:00Z' });

test('only actual catalog entries supporting structured output are selectable, including recommended and other models', () => {
  const options = ui.aiModelOptions(models, initial, 'ready');
  assert.equal(options.filter(option => option.recommended).length, 4);
  assert.equal(options.find(option => option.id === selected)?.available, true);
  assert.equal(options.find(option => option.id === 'provider/another')?.available, true);
  assert.match(options.find(option => option.id === 'anthropic/claude-opus-5.5')!.reason, /JSON 구조화 응답 미지원/);
  assert.match(options.find(option => option.id === 'google/gemini-4-argon')!.reason, /허용 목록에 없음/);
  assert.ok(ui.aiModelOptions(models, initial, 'failed').every(option => !option.available));
});

test('catalog failure preserves the current model but does not pretend saved or recommended models are selectable', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async url => String(url).endsWith('ai-models') ? Response.json({ error: '목록 접근 권한을 확인해 주세요.' }, { status: 503 }) : Response.json(initial);
  const view = host(() => ui.AdminAiModelSettings({}));
  try {
    view.render(); await tick(); const output = view.render();
    assert.ok(output.includes(initial.effectiveModel!)); assert.match(output, /서버 기본값 사용/); assert.match(output, /목록 접근 권한/);
    assert.equal(view.select().disabled, true); assert.equal(view.button('모델 저장').disabled, true);
    assert.ok(view.all((_props, type) => type === 'option').every(option => option.disabled));
  } finally { view.dispose(); globalThis.fetch = previous; }
});

test('save blocks duplicate requests, sends the known revision, and reports the server-confirmed next-request model', async () => {
  const previous = globalThis.fetch; const bodies: any[] = [], busy: boolean[] = [], saved: AiModelSetting[] = []; let finish!: (response: Response) => void;
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'PUT') { bodies.push(JSON.parse(String(init.body))); return new Promise(resolve => { finish = resolve; }); }
    return String(url).endsWith('ai-models') ? catalog() : Response.json(initial);
  };
  const view = host(() => ui.AdminAiModelSettings({ onBusyChange: value => busy.push(value), onSaved: value => saved.push(value) }));
  try {
    view.render(); await tick(); view.render(); view.select().onChange({ target: { value: selected } });
    assert.match(view.render(), /아직 저장되지 않았습니다/);
    const button = view.button('모델 저장'); button.onClick(); button.onClick(); view.render();
    assert.equal(bodies.length, 1); assert.equal(bodies[0].modelId, selected); assert.equal(bodies[0].expectedRevision, 3); assert.equal(typeof bodies[0].requestId, 'string');
    assert.equal(view.select().disabled, true); assert.equal(view.button('서버 기본값 복구').disabled, true);
    finish(Response.json({ ...initial, modelId: selected, effectiveModel: selected, source: 'workspace', revision: 4 })); await tick();
    assert.match(view.render(), /다음 AI 요청부터 anthropic\/claude-sonnet-5.5/);
    assert.deepEqual(busy, [true, false]); assert.equal(saved[0].effectiveModel, selected); assert.equal(view.button('모델 저장').disabled, true);
  } finally { view.dispose(); globalThis.fetch = previous; }
});

test('a conflict reloads current metadata and preserves the draft until an explicit second save', async () => {
  const previous = globalThis.fetch; const bodies: any[] = []; let reads = 0;
  const external: AiModelSetting = { ...initial, modelId: 'provider/another', effectiveModel: 'provider/another', source: 'workspace', revision: 4 };
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'PUT') { bodies.push(JSON.parse(String(init.body))); return bodies.length === 1 ? Response.json({ code: 'AI_MODEL_SETTING_CONFLICT', error: '충돌' }, { status: 409 }) : Response.json({ ...external, modelId: selected, effectiveModel: selected, revision: 5 }); }
    if (String(url).endsWith('ai-models')) return catalog();
    return Response.json(reads++ === 0 ? initial : external);
  };
  const view = host(() => ui.AdminAiModelSettings({}));
  try {
    view.render(); await tick(); view.render(); view.select().onChange({ target: { value: selected } }); view.render(); view.button('모델 저장').onClick(); await tick(); await tick();
    const output = view.render(); assert.match(output, /다른 관리자가/); assert.ok(output.includes(external.effectiveModel!));
    assert.equal(view.select().value, selected); assert.equal(bodies.length, 1);
    view.button('모델 저장').onClick(); await tick(); view.render();
    assert.equal(bodies[1].expectedRevision, 4); assert.notEqual(bodies[1].requestId, bodies[0].requestId);
  } finally { view.dispose(); globalThis.fetch = previous; }
});

test('server-default recovery remains available after catalog failure and sends null rather than a guessed model', async () => {
  const previous = globalThis.fetch; const bodies: any[] = [];
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'PUT') { bodies.push(JSON.parse(String(init.body))); return Response.json({ ...initial, revision: 5 }); }
    return String(url).endsWith('ai-models') ? Response.json({ error: '일시 목록 오류' }, { status: 503 }) : Response.json({ ...initial, modelId: selected, effectiveModel: selected, source: 'workspace', revision: 4 });
  };
  const view = host(() => ui.AdminAiModelSettings({}));
  try { view.render(); await tick(); view.render(); assert.equal(view.button('서버 기본값 복구').disabled, false); view.button('서버 기본값 복구').onClick(); await tick(); assert.match(view.render(), /서버 기본값으로 복구했습니다/); assert.equal(bodies[0].modelId, null); }
  finally { view.dispose(); globalThis.fetch = previous; }
});

test('closing during a save aborts its request and ignores a late success', async () => {
  const previous = globalThis.fetch; const busy: boolean[] = [], saved: AiModelSetting[] = []; let signal: AbortSignal | null | undefined, finish!: (response: Response) => void;
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'PUT') { signal = init.signal; return new Promise(resolve => { finish = resolve; }); }
    return String(url).endsWith('ai-models') ? catalog() : Response.json(initial);
  };
  const view = host(() => ui.AdminAiModelSettings({ onBusyChange: value => busy.push(value), onSaved: value => saved.push(value) }));
  try {
    view.render(); await tick(); view.render(); view.select().onChange({ target: { value: selected } }); view.render(); view.button('모델 저장').onClick();
    view.dispose(); assert.equal(signal?.aborted, true); finish(Response.json({ ...initial, modelId: selected, effectiveModel: selected, revision: 4 })); await tick();
    assert.deepEqual(saved, []); assert.deepEqual(busy, [true, false]);
  } finally { globalThis.fetch = previous; }
});

test('metadata refresh keeps a matching save notice but removes it after another administrator changes the setting', async () => {
  const previous = globalThis.fetch; let refreshVersion = 0, current = { ...initial };
  globalThis.fetch = async (url, init) => {
    if (init?.method === 'PUT') { current = { ...initial, modelId: selected, effectiveModel: selected, source: 'workspace', revision: 4 }; return Response.json(current); }
    return String(url).endsWith('ai-models') ? catalog() : Response.json(current);
  };
  const view = host(() => ui.AdminAiModelSettings({ refreshVersion }));
  try {
    view.render(); await tick(); view.render(); view.select().onChange({ target: { value: selected } }); view.render(); view.button('모델 저장').onClick(); await tick();
    assert.match(view.render(), /다음 AI 요청부터 anthropic\/claude-sonnet-5.5/);
    refreshVersion++; view.render(); await tick(); assert.match(view.render(), /다음 AI 요청부터 anthropic\/claude-sonnet-5.5/);
    current = { ...current, modelId: 'provider/another', effectiveModel: 'provider/another', revision: 5 };
    refreshVersion++; view.render(); await tick();
    const output = view.render(); assert.ok(output.includes('provider/another')); assert.doesNotMatch(output, /다음 AI 요청부터 anthropic\/claude-sonnet-5.5/);
  } finally { view.dispose(); globalThis.fetch = previous; }
});

test('integration panel locks connection tests during model changes and clears previous AI results after saving', async () => {
  const previous = globalThis.fetch;
  const status = { checkedAt: '2026-11-09T12:00:00Z', ai: { configured: true, variables: [] }, database: { configured: false, mode: 'local', variables: [] }, storage: { configured: false, mode: 'local', variables: [] } };
  globalThis.fetch = async (_url, init) => init?.method === 'POST' ? Response.json({ service: 'ai', ok: true, checkedAt: status.checkedAt, durationMs: 1, message: '이전 모델 연결 성공', checks: [] }) : Response.json(status);
  const view = host(() => integrations.AdminIntegrations());
  try {
    view.render(); await tick(); view.render(); view.button('AI 연결·응답 테스트').onClick(); await tick(); view.render();
    assert.equal(view.all(props => props.result?.service === 'ai').length, 1);
    let model = view.one((_props, type) => type === ui.AdminAiModelSettings);
    model.onBusyChange(true); view.render(); assert.equal(view.button('AI 연결·응답 테스트').disabled, true);
    model = view.one((_props, type) => type === ui.AdminAiModelSettings); assert.equal(model.disabled, true);
    model.onSaved(initial); model.onBusyChange(false); await tick(); view.render();
    assert.equal(view.all(props => props.result?.service === 'ai').length, 0); assert.equal(view.button('AI 연결·응답 테스트').disabled, false);
  } finally { view.dispose(); globalThis.fetch = previous; }
});

test('only a successful integration refresh clears the old AI test result', async () => {
  const previous = globalThis.fetch; let failRefresh = false;
  const status = { checkedAt: '2026-11-09T12:00:00Z', ai: { configured: true, variables: [] }, database: { configured: false, mode: 'local', variables: [] }, storage: { configured: false, mode: 'local', variables: [] } };
  globalThis.fetch = async (_url, init) => init?.method === 'POST' ? Response.json({ service: 'ai', ok: true, checkedAt: status.checkedAt, durationMs: 1, message: '이전 모델 연결 성공', checks: [] }) : failRefresh ? Response.json({ error: '일시 설정 조회 오류' }, { status: 503 }) : Response.json(status);
  const view = host(() => integrations.AdminIntegrations());
  try {
    view.render(); await tick(); view.render(); view.button('AI 연결·응답 테스트').onClick(); await tick(); view.render();
    assert.equal(view.all(props => props.result?.service === 'ai').length, 1);
    failRefresh = true; view.button('설정 새로고침').onClick(); await tick(); assert.match(view.render(), /일시 설정 조회 오류/);
    assert.equal(view.all(props => props.result?.service === 'ai').length, 1);
    failRefresh = false; view.button('설정 새로고침').onClick(); await tick(); view.render();
    assert.equal(view.all(props => props.result?.service === 'ai').length, 0);
  } finally { view.dispose(); globalThis.fetch = previous; }
});

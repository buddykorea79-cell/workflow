'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import type { AiModelSetting, AiModelSettingInput } from '@/lib/ai-model-types';
import type { BizRouterModel } from '@/lib/bizrouter-models';
import { formatDateTimeFull } from '@/lib/date-format';
import { Button } from './ui';

const SETTING_URL = '/api/admin/integrations/ai-model';
const CATALOG_URL = '/api/admin/integrations/ai-models';
const recommendedModels = ['openai/gpt-6.1-sol', 'anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-5.5', 'google/gemini-4-argon'];
const requestTimeout = 35_000;
interface Catalog { models: BizRouterModel[]; checkedAt: string }
interface ModelOption { id: string; name: string; recommended: boolean; available: boolean; reason: string }

export function aiModelOptions(models: readonly BizRouterModel[], setting: AiModelSetting | null, catalogState: 'loading' | 'failed' | 'ready'): ModelOption[] {
  const entries = new Map(models.map(model => [model.id, model]));
  const ids = [...new Set([...recommendedModels, ...models.map(model => model.id), setting?.modelId, setting?.environmentModel, setting?.effectiveModel].filter((id): id is string => !!id))];
  return ids.map(id => {
    const model = entries.get(id);
    const reason = catalogState === 'loading' ? '모델 목록 확인 중' : catalogState === 'failed' ? '모델 목록을 확인하지 못함' : !model ? '현재 계정의 허용 목록에 없음' : !model.structuredOutput ? 'JSON 구조화 응답 미지원' : '';
    return { id, name: model?.name || id, recommended: recommendedModels.includes(id), available: !reason, reason };
  });
}

class ModelRequestError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number) { super(message); }
}
async function request<T>(url: string, controller: AbortController, init?: RequestInit): Promise<T> {
  const timeout = setTimeout(() => controller.abort(), requestTimeout);
  try {
    const response = await fetch(url, { cache: 'no-store', ...init, signal: controller.signal });
    const body = await response.json();
    if (!response.ok) throw new ModelRequestError(body.error || '모델 설정 요청을 처리하지 못했습니다.', body.code, response.status);
    return body;
  } finally { clearTimeout(timeout); }
}

export function AdminAiModelSettings({ disabled = false, refreshVersion = 0, onBusyChange, onSaved }: { disabled?: boolean; refreshVersion?: number; onBusyChange?: (busy: boolean) => void; onSaved?: (setting: AiModelSetting) => void }) {
  const [setting, setSetting] = useState<AiModelSetting | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [draft, setDraft] = useState('');
  const [settingLoading, setSettingLoading] = useState(true), [catalogLoading, setCatalogLoading] = useState(true);
  const [settingError, setSettingError] = useState(''), [catalogError, setCatalogError] = useState(''), [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState<'save' | 'reset' | ''>(''), [notice, setNotice] = useState('');
  const alive = useRef(true), settingRequest = useRef<AbortController | null>(null), catalogRequest = useRef<AbortController | null>(null), saveRequest = useRef<AbortController | null>(null);
  const settingRef = useRef(setting), draftRef = useRef(draft), dirty = useRef(false);
  const saveIntent = useRef<AiModelSettingInput | null>(null);
  const callbacks = useRef({ onBusyChange, onSaved }); callbacks.current = { onBusyChange, onSaved };
  const selectId = useId();
  const baseline = setting?.modelId || setting?.effectiveModel || '';
  const options = aiModelOptions(catalog?.models || [], setting, catalogLoading ? 'loading' : catalogError || !catalog ? 'failed' : 'ready');
  const selected = options.find(option => option.id === draft);
  const changed = draft !== baseline;
  const blocked = disabled || !!saving;

  function applySetting(next: AiModelSetting, keepDraft: boolean) {
    settingRef.current = next; setSetting(next);
    if (!keepDraft) { const value = next.modelId || next.effectiveModel || ''; draftRef.current = value; setDraft(value); }
    dirty.current = draftRef.current !== (next.modelId || next.effectiveModel || '');
  }
  async function loadSetting(keepDraft = dirty.current) {
    settingRequest.current?.abort();
    const controller = new AbortController(); settingRequest.current = controller;
    setSettingLoading(true); setSettingError('');
    try {
      const next = await request<AiModelSetting>(SETTING_URL, controller);
      if (alive.current && settingRequest.current === controller) {
        const current = settingRef.current;
        if (current && (current.effectiveModel !== next.effectiveModel || current.source !== next.source || current.revision !== next.revision)) setNotice('');
        applySetting(next, keepDraft);
      }
    }
    catch (error) { if (alive.current && settingRequest.current === controller) setSettingError(error instanceof ModelRequestError ? error.message : '현재 모델 설정을 불러오지 못했습니다. 다시 확인해 주세요.'); }
    finally { if (alive.current && settingRequest.current === controller) { settingRequest.current = null; setSettingLoading(false); } }
  }
  async function loadCatalog() {
    catalogRequest.current?.abort();
    const controller = new AbortController(); catalogRequest.current = controller;
    setCatalogLoading(true); setCatalogError('');
    try { const next = await request<Catalog>(CATALOG_URL, controller); if (alive.current && catalogRequest.current === controller) setCatalog(next); }
    catch (error) { if (alive.current && catalogRequest.current === controller) setCatalogError(error instanceof ModelRequestError ? error.message : '모델 목록을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.'); }
    finally { if (alive.current && catalogRequest.current === controller) { catalogRequest.current = null; setCatalogLoading(false); } }
  }
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; settingRequest.current?.abort(); catalogRequest.current?.abort(); if (saveRequest.current) { saveRequest.current.abort(); callbacks.current.onBusyChange?.(false); } };
  }, []);
  useEffect(() => { void loadSetting(); void loadCatalog(); }, [refreshVersion]);

  async function save(modelId: string | null) {
    const current = settingRef.current;
    if (disabled || saveRequest.current || settingLoading || !current || (modelId !== null && (!options.find(option => option.id === modelId)?.available || modelId === (current.modelId || current.effectiveModel || '')))) return;
    if (modelId === null && current.modelId === null) return;
    settingRequest.current?.abort(); settingRequest.current = null;
    const controller = new AbortController(); saveRequest.current = controller;
    setSaving(modelId === null ? 'reset' : 'save'); setSaveError(''); setNotice(''); callbacks.current.onBusyChange?.(true);
    if (!saveIntent.current || saveIntent.current.modelId !== modelId || saveIntent.current.expectedRevision !== current.revision) saveIntent.current = { modelId, expectedRevision: current.revision, requestId: crypto.randomUUID() };
    try {
      const next = await request<AiModelSetting>(SETTING_URL, controller, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saveIntent.current) });
      if (!alive.current || saveRequest.current !== controller) return;
      applySetting(next, false); saveIntent.current = null;
      setNotice(next.effectiveModel ? `${modelId === null ? '서버 기본값으로 복구했습니다.' : '모델을 저장했습니다.'} 다음 AI 요청부터 ${next.effectiveModel} 모델을 사용합니다.` : '서버 기본값으로 복구했습니다. 서버의 기본 모델을 설정하면 AI 요청을 사용할 수 있습니다.');
      callbacks.current.onSaved?.(next);
    } catch (error) {
      if (!alive.current || saveRequest.current !== controller) return;
      if (error instanceof ModelRequestError && error.code === 'AI_MODEL_SETTING_CONFLICT') {
        saveIntent.current = null; await loadSetting(true);
        if (alive.current && saveRequest.current === controller) setSaveError('다른 관리자가 모델 설정을 변경했습니다. 현재 적용 모델과 선택한 모델을 확인한 뒤 다시 저장해 주세요.');
      } else setSaveError(error instanceof ModelRequestError ? error.message : '저장 결과를 확인하지 못했습니다. 현재 설정을 다시 확인한 뒤 재시도해 주세요.');
    } finally { if (alive.current && saveRequest.current === controller) { saveRequest.current = null; setSaving(''); callbacks.current.onBusyChange?.(false); } }
  }

  return <section className="ai-model-settings" aria-label="AI 모델 설정">
    <div className="ai-model-current"><span>현재 적용 모델</span><strong>{setting ? setting.effectiveModel || '미설정' : settingLoading ? '설정 확인 중' : '확인하지 못함'}</strong>{setting && <small>{setting.source === 'workspace' ? '관리자가 저장한 모델' : setting.source === 'environment' ? '서버 기본값 사용' : '모델 설정 필요'}</small>}</div>
    {settingError && <p className="ai-model-error" role="alert">{settingError} <button type="button" disabled={blocked || settingLoading} onClick={() => void loadSetting()}>현재 설정 다시 확인</button></p>}
    <label htmlFor={selectId}>AI 모델 선택</label>
    <select id={selectId} value={draft} disabled={blocked || settingLoading || catalogLoading || !!catalogError || !setting} onChange={event => { const value = event.target.value; draftRef.current = value; dirty.current = value !== baseline; saveIntent.current = null; setDraft(value); setNotice(''); setSaveError(''); }}>
      {!draft && <option value="">사용할 모델을 선택하세요</option>}
      <optgroup label="추천 모델">{options.filter(option => option.recommended).map(option => <option key={option.id} value={option.id} disabled={!option.available}>{option.name}{option.available ? '' : ` — ${option.reason}`}</option>)}</optgroup>
      {!!options.filter(option => !option.recommended).length && <optgroup label="그 밖의 모델">{options.filter(option => !option.recommended).map(option => <option key={option.id} value={option.id} disabled={!option.available}>{option.name}{option.available ? '' : ` — ${option.reason}`}</option>)}</optgroup>}
    </select>
    {selected && <p className={selected.available ? 'ai-model-choice' : 'ai-model-choice unavailable'}><code>{selected.id}</code>{!selected.available && <span>{selected.reason}</span>}</p>}
    {catalogError && <p className="ai-model-error" role="alert">{catalogError} 현재 적용 모델은 변경되지 않았습니다.</p>}
    <div className="ai-model-actions"><Button disabled={blocked || settingLoading || !changed || !selected?.available} onClick={() => void save(draft)}>{saving === 'save' && <LoaderCircle size={15} className="spin"/>}모델 저장</Button><Button variant="secondary" disabled={blocked || settingLoading || !setting?.modelId} onClick={() => void save(null)}>{saving === 'reset' && <LoaderCircle size={15} className="spin"/>}서버 기본값 복구</Button></div>
    <p className="ai-model-state" role="status">{saving ? '모델 설정 저장 중…' : notice || (changed ? '선택한 모델은 아직 저장되지 않았습니다.' : setting ? '현재 설정과 선택한 모델이 같습니다.' : '')}</p>
    {saveError && <p className="ai-model-error" role="alert">{saveError}{!settingError && <button type="button" disabled={blocked || settingLoading} onClick={() => { saveIntent.current = null; void loadSetting(); }}>현재 설정 다시 확인</button>}</p>}
    <p className="ai-model-default">서버 기본값: <code>{setting?.environmentModel || '미설정'}</code></p>
    <div className="ai-model-catalog-heading"><button type="button" disabled={blocked || catalogLoading} onClick={() => void loadCatalog()}><RefreshCw size={14} className={catalogLoading ? 'spin' : ''}/>{catalogLoading ? '모델 목록 확인 중' : '모델 목록 새로고침'}</button>{catalog && !catalogLoading && !catalogError && <small>{formatDateTimeFull(catalog.checkedAt)} 확인</small>}</div>
    <details className="ai-model-recommendations"><summary>추천 모델의 사용 가능 여부</summary><ul>{options.filter(option => option.recommended).map(option => <li key={option.id}><code>{option.id}</code><span className={option.available ? 'available' : ''}>{option.available ? '사용 가능 · JSON 구조화 응답 지원' : option.reason}</span></li>)}</ul></details>
    <small className="ai-test-note">실제 계정의 허용 목록과 JSON 구조화 응답 지원을 확인한 모델만 저장할 수 있습니다. 모델 설정은 다음 AI 요청부터 적용됩니다.</small>
  </section>;
}

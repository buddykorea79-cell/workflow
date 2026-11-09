import { z } from 'zod';
import { DomainError } from './domain-error';
import { aiAbortError, withAiSignal } from './ai-generation-operation';

export interface BizRouterModel { id: string; name: string; structuredOutput: boolean }
export interface BizRouterCatalogOptions { apiKey?: string; fetcher?: typeof fetch; signal?: AbortSignal }
const catalogSchema = z.object({ models: z.array(z.object({ id: z.string().min(1).max(200), name: z.string().nullish().catch(undefined), response_format_modes: z.array(z.string()).optional() })) });
const limit = 8 * 1024 * 1024;

/** The catalog is scoped to this service key. It never initiates a paid completion. */
export async function fetchBizRouterModels(options: BizRouterCatalogOptions = {}): Promise<BizRouterModel[]> {
  const apiKey = options.apiKey ?? process.env.BIZROUTER_API_KEY;
  if (!apiKey?.trim()) throw new DomainError(503, 'AI_NOT_CONFIGURED', '서버에 BIZROUTER_API_KEY를 설정해 주세요.');
  const timeout = AbortSignal.timeout(25_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    signal.throwIfAborted();
    const response = await withAiSignal(() => (options.fetcher ?? fetch)('https://api.bizrouter.ai/v1/models', { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, signal, redirect: 'error', cache: 'no-store' }), signal);
    if ([401, 403].includes(response.status)) throw new DomainError(503, 'AI_AUTH_FAILED', 'BizRouter API 키와 모델 접근 권한을 확인해 주세요.');
    if (response.status === 429) throw new DomainError(429, 'AI_RATE_LIMITED', 'BizRouter 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.');
    if (!response.ok) throw new DomainError(502, 'AI_UPSTREAM_FAILED', 'BizRouter 모델 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
    const reader = response.body?.getReader();
    if (!reader) throw new DomainError(502, 'AI_EMPTY_RESPONSE', 'BizRouter 응답을 읽지 못했습니다.');
    const decoder = new TextDecoder(); let text = ''; let size = 0;
    const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    try {
      while (true) {
        const chunk = await withAiSignal(() => reader.read(), signal);
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > limit) { cancel(); throw new DomainError(502, 'AI_CATALOG_TOO_LARGE', 'BizRouter 모델 목록이 처리 한도를 초과했습니다. 서비스 연동 설정을 확인해 주세요. 등록한 근거의 크기와는 관계가 없습니다.'); }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
    let raw: unknown;
    try { raw = JSON.parse(text); } catch { throw new DomainError(502, 'AI_INVALID_JSON', 'BizRouter 모델 목록 응답을 해석하지 못했습니다.'); }
    const parsed = catalogSchema.safeParse(raw);
    if (!parsed.success) throw new DomainError(502, 'AI_INVALID_CATALOG', 'BizRouter 모델 목록 형식을 확인하지 못했습니다.');
    return parsed.data.models.filter((model, index, models) => models.findIndex(item => item.id === model.id) === index).map(model => ({ id: model.id, name: model.name?.trim() || model.id, structuredOutput: model.response_format_modes?.includes('json_schema') === true }));
  } catch (error) {
    if (signal.aborted) throw aiAbortError(signal);
    if (error instanceof DomainError) throw error;
    throw new DomainError(502, 'AI_CONNECTION_FAILED', 'BizRouter 모델 목록에 연결하지 못했습니다. 연결 설정을 확인해 주세요.');
  }
}

export function assertBizRouterModel(models: readonly BizRouterModel[], modelId: string): void {
  if (!models.some(model => model.id === modelId && model.structuredOutput)) throw new DomainError(503, 'AI_MODEL_UNAVAILABLE', '선택한 모델의 접근 권한과 JSON 구조화 응답 지원을 확인해 주세요. 관리자 화면에서 사용 가능한 모델을 선택할 수 있습니다.');
}

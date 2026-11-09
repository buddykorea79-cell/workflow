import { DomainError } from './domain-error';
import { withAiSignal } from './ai-generation-operation';

/** Enforce the actual UTF-8 bytes, including requests with no Content-Length. */
export async function readBoundedJson(request: Request, limit: number, signal?: AbortSignal): Promise<unknown> {
  if (Number(request.headers.get('content-length') || 0) > limit) throw new DomainError(413, 'BODY_TOO_LARGE', '요청 데이터가 너무 큽니다.');
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError(422, 'INVALID_INPUT', '요청 내용을 확인해 주세요.');
  let bytes = 0;
  let source = '';
  const decoder = new TextDecoder();
  const cancel = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try {
    while (true) {
      const chunk = signal ? await withAiSignal(() => reader.read(), signal) : await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) { cancel(); throw new DomainError(413, 'BODY_TOO_LARGE', '요청 데이터가 너무 큽니다.'); }
      source += decoder.decode(chunk.value, { stream: true });
    }
    try { return JSON.parse(source + decoder.decode()); }
    catch { throw new DomainError(422, 'INVALID_INPUT', '요청 형식을 확인해 주세요.'); }
  } finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
}

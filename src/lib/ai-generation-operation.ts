import { DomainError } from './domain-error';
import { AI_GENERATION_TIMEOUT_MS } from './ai-generation-policy';

export function aiAbortError(signal: AbortSignal): DomainError {
  return signal.reason?.name === 'TimeoutError'
    ? new DomainError(504, 'AI_TIMEOUT', 'AI 분석 대기 시간이 초과되었습니다. 입력 자료는 유지됩니다. 잠시 후 다시 시도하거나 분석할 파일과 근거를 나누어 선택해 주세요.')
    : new DomainError(499, 'AI_CANCELLED', 'AI 분석 요청이 취소되었습니다. 입력 자료는 유지됩니다.');
}

/** Caller owns disposal; nested work must also receive this same signal. */
export function createAiDeadline(parent?: AbortSignal, timeoutMs = AI_GENERATION_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('AI generation deadline exceeded', 'TimeoutError')), timeoutMs);
  timer.unref?.();
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  return { signal, dispose: () => clearTimeout(timer) };
}

/** Stop waiting promptly, without starting work for a request already cancelled. */
export async function withAiSignal<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw aiAbortError(signal);
  return new Promise<T>((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(aiAbortError(signal)); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      operation().then(value => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) reject(aiAbortError(signal));
        else resolve(value);
      }, error => { signal.removeEventListener('abort', abort); reject(error); });
    } catch (error) { signal.removeEventListener('abort', abort); reject(error); }
  });
}

import { AI_GENERATION_CLIENT_TIMEOUT_MS } from './ai-generation-policy';

/** Browser-side ownership: an old response/finally must never finish a newer request. */
export class AiRequestLifecycle {
  private active: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  start(timeoutMs = AI_GENERATION_CLIENT_TIMEOUT_MS): AbortController | null {
    if (this.active) return null;
    const controller = new AbortController();
    this.active = controller;
    if (timeoutMs > 0) {
      this.timer = setTimeout(() => controller.abort(new DOMException('AI 응답 대기 시간이 지났습니다. 입력과 기존 초안은 유지됩니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.', 'TimeoutError')), timeoutMs);
      this.timer.unref?.();
    }
    return controller;
  }

  owns(controller: AbortController): boolean { return this.active === controller; }
  accepts(controller: AbortController): boolean { return this.owns(controller) && !controller.signal.aborted; }
  isRunning(): boolean { return this.active !== null; }

  finish(controller: AbortController): boolean {
    if (!this.owns(controller)) return false;
    clearTimeout(this.timer); this.timer = undefined; this.active = null;
    return true;
  }

  cancel(): boolean {
    const controller = this.active;
    if (!controller) return false;
    this.finish(controller);
    controller.abort();
    return true;
  }
}

export function aiRequestError(controller: AbortController, cause: unknown, fallback: string): string {
  if (controller.signal.aborted && controller.signal.reason?.name === 'TimeoutError') return controller.signal.reason.message;
  return cause instanceof Error ? cause.message : fallback;
}

export function aiElapsedTime(seconds: number): string {
  const elapsed = Math.max(0, Math.floor(seconds));
  return elapsed < 60 ? `${elapsed}초` : `${Math.floor(elapsed / 60)}분 ${elapsed % 60}초`;
}

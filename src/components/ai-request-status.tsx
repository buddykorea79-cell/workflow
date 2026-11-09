'use client';

import { useEffect, useRef, useState } from 'react';
import { AiRequestLifecycle, aiElapsedTime } from '@/lib/ai-request-lifecycle';
import { LoaderCircle } from 'lucide-react';
import './ai-request-status.css';

export function useAiRequest() {
  const lifecycle = useRef(new AiRequestLifecycle());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  useEffect(() => () => { lifecycle.current.cancel(); }, []);
  return {
    startedAt,
    start(timeoutMs?: number) { const request = lifecycle.current.start(timeoutMs); if (request) setStartedAt(Date.now()); return request; },
    owns: (request: AbortController) => lifecycle.current.owns(request),
    accepts: (request: AbortController) => lifecycle.current.accepts(request),
    isRunning: () => lifecycle.current.isRunning(),
    finish(request: AbortController) { const finished = lifecycle.current.finish(request); if (finished) setStartedAt(null); return finished; },
    cancel() { const cancelled = lifecycle.current.cancel(); if (cancelled) setStartedAt(null); return cancelled; },
  };
}

export function AiRequestStatus({ startedAt, onCancel }: { startedAt: number | null; onCancel: () => void }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  if (startedAt === null) return null;
  return <div className="ai-request-status">
    <div role="status" aria-live="polite"><strong><LoaderCircle size={16} className="spin"/>분석 중 · {aiElapsedTime((now - startedAt) / 1000)} 경과</strong><p>자료량과 모델 응답에 따라 최대 약 3분 걸릴 수 있습니다. 이 화면에서 기다려 주세요. 입력과 기존 초안은 유지되며, 결과를 검토한 뒤 적용할 수 있습니다.</p></div>
    <button type="button" className="btn btn-secondary" onClick={onCancel}>분석 취소</button>
  </div>;
}

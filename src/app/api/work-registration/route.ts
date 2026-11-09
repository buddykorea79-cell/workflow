import { NextRequest } from 'next/server';
import { assertSameOrigin, currentUserId } from '@/lib/auth';
import { apiError, json } from '@/lib/api';
import { DomainError } from '@/lib/domain-error';
import { readBoundedJson } from '@/lib/request-json';
import { processWorkRegistration, WORK_REGISTRATION_BODY_LIMIT } from '@/lib/work-registration-generation';
import { aiAbortError, createAiDeadline, withAiSignal } from '@/lib/ai-generation-operation';

export const runtime = 'nodejs';
// AI_GENERATION_ROUTE_MAX_DURATION_SECONDS; Next.js requires a static literal.
export const maxDuration = 200;

export async function POST(request: NextRequest) {
  const deadline = createAiDeadline(request.signal);
  const { signal } = deadline;
  try {
    assertSameOrigin(request);
    const userId = await withAiSignal(() => currentUserId(request), signal);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new DomainError(415, 'JSON_REQUIRED', '업무 분석 요청 형식을 확인해 주세요.');
    const value = await readBoundedJson(request, WORK_REGISTRATION_BODY_LIMIT, signal);
    return json(await processWorkRegistration(userId, value, signal));
  } catch (error) { return apiError(signal.aborted ? aiAbortError(signal) : error); }
  finally { deadline.dispose(); }
}

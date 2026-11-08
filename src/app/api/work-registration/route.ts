import { NextRequest } from 'next/server';
import { assertSameOrigin, currentUserId } from '@/lib/auth';
import { apiError, json } from '@/lib/api';
import { DomainError } from '@/lib/domain-error';
import { readBoundedJson } from '@/lib/request-json';
import { processWorkRegistration, WORK_REGISTRATION_BODY_LIMIT } from '@/lib/work-registration-generation';

export const runtime = 'nodejs';
export const maxDuration = 70;

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const userId = await currentUserId(request);
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new DomainError(415, 'JSON_REQUIRED', '업무 분석 요청 형식을 확인해 주세요.');
    const value = await readBoundedJson(request, WORK_REGISTRATION_BODY_LIMIT);
    return json(await processWorkRegistration(userId, value, request.signal));
  } catch (error) { return apiError(error); }
}

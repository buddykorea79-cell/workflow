import { NextRequest, NextResponse } from 'next/server';
import { accessCookie, accessDurationSeconds, assertSameOrigin, isDemoSession, isLocalDemo, matchesAccessCode, signAccess } from '@/lib/auth';
import { apiError } from '@/lib/api';
import { DomainError } from '@/lib/domain-error';
import { assertAccessAttemptLimit } from '@/lib/rate-limit';
import { isValidAccessCode } from '@/lib/access-code';

export const runtime = 'nodejs';

async function accessCode(request: NextRequest) {
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError(422, 'ACCESS_CODE_REQUIRED', '접근 코드는 숫자 8자리로 입력해 주세요.');
  let size = 0; let text = ''; const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new DomainError(413, 'REQUEST_TOO_LARGE', '접근 코드를 확인해 주세요.'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    let body: unknown;
    try { body = JSON.parse(text + decoder.decode()); } catch { throw new DomainError(422, 'ACCESS_CODE_REQUIRED', '접근 코드는 숫자 8자리로 입력해 주세요.'); }
    if (!body || typeof body !== 'object' || !('code' in body) || !isValidAccessCode(body.code)) throw new DomainError(422, 'ACCESS_CODE_REQUIRED', '접근 코드는 숫자 8자리로 입력해 주세요.');
    return body.code;
  } finally { reader.releaseLock(); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    if (!isDemoSession(request)) throw new DomainError(403, 'DEMO_DISABLED', '접근 코드는 프로토타입 모드에서 사용할 수 있습니다.');
    const response = NextResponse.json({ accessGranted: true }, { headers: { 'Cache-Control': 'no-store, private' } });
    if (isLocalDemo(request)) return response;
    assertAccessAttemptLimit(request);
    const code = await accessCode(request);
    if (!matchesAccessCode(code)) {
      await new Promise(resolve => setTimeout(resolve, 250));
      throw new DomainError(401, 'ACCESS_CODE_INVALID', '접근 코드가 올바르지 않습니다. 다시 확인해 주세요.');
    }
    response.cookies.set(accessCookie, signAccess(), { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: accessDurationSeconds });
    return response;
  } catch (error) { return apiError(error); }
}

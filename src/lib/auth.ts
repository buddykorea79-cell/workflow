import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { DomainError } from './domain';

export const sessionCookie = 'ieum_demo_session';
const localHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
export function isLocalDemo(request: NextRequest) { return !process.env.VERCEL && !process.env.NEON_AUTH_BASE_URL && localHosts.has(new URL(request.url).hostname); }
const secret = () => process.env.IEUM_SESSION_SECRET || 'ieum-local-demonstration-only-not-a-production-secret';
export function signSession(userId: string) { const body = `${userId}.${Date.now() + 12 * 60 * 60 * 1000}`; return `${body}.${createHmac('sha256', secret()).update(body).digest('hex')}`; }
export function verifySession(value: string) { const [userId, expiry, signature] = value.split('.'); if (!userId || !expiry || !signature || Number(expiry) < Date.now()) return null; const body = `${userId}.${expiry}`; const expected = createHmac('sha256', secret()).update(body).digest('hex'); if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null; return userId; }
export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin'); const requestUrl = new URL(request.url);
  // Next's development runtime can normalize request.url to localhost while
  // the browser uses 127.0.0.1. Host is browser-controlled only by navigation,
  // so compare the actual request authority after enforcing the local allowlist.
  const authority = request.headers.get('host') || requestUrl.host;
  let expected: URL; try { expected = new URL(process.env.IEUM_APP_ORIGIN || `${requestUrl.protocol}//${authority}`); } catch { throw new DomainError(403, 'INVALID_HOST', '요청 주소를 확인해 주세요.'); }
  if (!process.env.VERCEL && !process.env.NEON_AUTH_BASE_URL && !localHosts.has(expected.hostname)) throw new DomainError(403, 'INVALID_HOST', '로컬 데모는 이 기기의 주소에서만 사용할 수 있습니다.');
  if (origin && origin !== expected.origin) throw new DomainError(403, 'CROSS_ORIGIN_DENIED', '다른 사이트에서 전송한 변경 요청은 허용하지 않습니다.');
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new DomainError(403, 'CROSS_ORIGIN_DENIED', '동일 사이트에서 요청해 주세요.');
}
export async function currentUserId(request: NextRequest): Promise<string> {
  if (isLocalDemo(request)) { const cookie = request.cookies.get(sessionCookie)?.value; if (!cookie) throw new DomainError(401, 'SIGN_IN_REQUIRED', '시연할 계정을 선택하여 로그인해 주세요.'); const userId = verifySession(cookie); if (!userId) throw new DomainError(401, 'SESSION_EXPIRED', '데모 세션이 만료되었습니다. 계정을 다시 선택해 주세요.'); return userId; }
  const base = process.env.NEON_AUTH_BASE_URL; if (!base || !process.env.DATABASE_URL || !process.env.NEON_AUTH_USER_MAP) throw new DomainError(503, 'AUTH_NOT_CONFIGURED', '배포 환경의 Neon 인증·DB·허용 사용자 연결 설정이 필요합니다. 로컬 데모 계정은 배포 환경에서 사용할 수 없습니다.');
  const endpoint = new URL('get-session', base.endsWith('/') ? base : `${base}/`); if (endpoint.protocol !== 'https:') throw new DomainError(503, 'AUTH_URL_INVALID', '인증 서버는 HTTPS 주소여야 합니다.');
  let response: Response; try { response = await fetch(endpoint, { headers: { cookie: request.headers.get('cookie') || '' }, cache: 'no-store', signal: AbortSignal.timeout(8000) }); } catch { throw new DomainError(503, 'AUTH_UNAVAILABLE', '인증 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'); }
  if (!response.ok) throw new DomainError(401, 'SIGN_IN_REQUIRED', '인증된 사용자로 로그인해 주세요.');
  const session = await response.json() as { user?: { id?: string }; session?: { expiresAt?: string } }; if (!session.user?.id || !session.session || (session.session.expiresAt && new Date(session.session.expiresAt).getTime() <= Date.now())) throw new DomainError(401, 'SIGN_IN_REQUIRED', '로그인이 필요합니다.');
  const mapping = JSON.parse(process.env.NEON_AUTH_USER_MAP) as Record<string, string>; const userId = mapping[session.user.id]; if (!userId) throw new DomainError(403, 'INVITATION_REQUIRED', '기관의 허용 사용자로 등록되어 있지 않습니다.'); return userId;
}

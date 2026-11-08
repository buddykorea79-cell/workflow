import { NextRequest, NextResponse } from 'next/server';
import { accessCookie, assertPrototypeAccess, assertSameOrigin, isDemoSession, sessionCookie, signSession, verifySession, secureSessionCookie } from '@/lib/auth';
import { activeUser, DomainError, getWorkspace } from '@/lib/domain';
import { readState, transaction } from '@/lib/store';
import { apiError } from '@/lib/api';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    if (!isDemoSession(request)) throw new DomainError(403, 'DEMO_DISABLED', '역할 선택 로그인은 프로토타입 모드에서 사용할 수 있습니다. IEUM_PROTOTYPE_MODE 설정을 확인해 주세요.');
    assertPrototypeAccess(request);
    const state = await readState();
    const signedId = verifySession(request.cookies.get(sessionCookie)?.value || '');
    const signedUser = signedId ? activeUser(state, signedId) : undefined;
    const visible = state.users.filter(user => user.active && (request.nextUrl.searchParams.get('scope') === 'demo' || !signedUser || signedUser.role === 'admin' || user.departmentId === signedUser.departmentId));
    const directory = {
      users: visible.map(({ id, name, initials, departmentId, team, role, title, color, active, endsAt }) => ({ id, name, initials, departmentId, team, role, title, color, active, endsAt })),
      departments: state.departments.filter(department => request.nextUrl.searchParams.get('scope') === 'demo' || !signedUser || signedUser.role === 'admin' || department.id === signedUser.departmentId),
    };
    return NextResponse.json(directory, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: NextRequest) { try { assertSameOrigin(request); if (!isDemoSession(request)) throw new DomainError(403, 'DEMO_DISABLED', '역할 전환은 프로토타입 모드에서 사용할 수 있습니다.'); assertPrototypeAccess(request); const body = await request.json(); if (typeof body.userId !== 'string') throw new DomainError(422, 'USER_REQUIRED', '사용자를 선택해 주세요.'); const workspace = await transaction(state => { activeUser(state, body.userId); return getWorkspace(state, body.userId); }); const response = NextResponse.json(workspace, { headers: { 'Cache-Control': 'no-store' } }); response.cookies.set(sessionCookie, signSession(body.userId), { httpOnly: true, sameSite: 'strict', secure: secureSessionCookie(request), path: '/', maxAge: 43200 }); return response; } catch (error) { return apiError(error); } }
export async function DELETE(request: NextRequest) {
  try { assertSameOrigin(request); if (!isDemoSession(request)) throw new DomainError(403, 'DEMO_DISABLED', '기관 인증 서비스에서 로그아웃해 주세요.'); const response = NextResponse.json({ signedOut: true }); response.cookies.set(sessionCookie, '', { httpOnly: true, sameSite: 'strict', secure: secureSessionCookie(request), path: '/', maxAge: 0 }); response.cookies.set(accessCookie, '', { httpOnly: true, sameSite: 'lax', secure: secureSessionCookie(request), path: '/', maxAge: 0 }); return response; } catch (error) { return apiError(error); }
}

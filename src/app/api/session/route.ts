import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin, isLocalDemo, sessionCookie, signSession, verifySession } from '@/lib/auth';
import { activeUser, DomainError, getWorkspace } from '@/lib/domain';
import { transaction } from '@/lib/store';
import { apiError } from '@/lib/api';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    if (!isLocalDemo(request)) throw new DomainError(403, 'DEMO_DISABLED', '배포 환경에서는 데모 계정 목록을 제공하지 않습니다.');
    const directory = await transaction(state => {
      const signedId = verifySession(request.cookies.get(sessionCookie)?.value || '');
      const signedUser = signedId ? activeUser(state, signedId) : undefined;
      const visible = state.users.filter(user => user.active && (!signedUser || signedUser.role === 'admin' || user.departmentId === signedUser.departmentId));
      return {
        users: visible.map(({ id, name, initials, departmentId, team, role, title, color, active, endsAt, commonTaskPermission }) => ({ id, name, initials, departmentId, team, role, title, color, active, endsAt, commonTaskPermission: role === 'member' && departmentId === 'dept-plan' && !!commonTaskPermission })),
        departments: state.departments.filter(department => !signedUser || signedUser.role === 'admin' || department.id === signedUser.departmentId),
      };
    });
    return NextResponse.json(directory, { headers: { 'Cache-Control': 'no-store, private' } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: NextRequest) { try { assertSameOrigin(request); if (!isLocalDemo(request)) throw new DomainError(403, 'DEMO_DISABLED', '배포 환경에서는 데모 계정 전환을 사용할 수 없습니다.'); const body = await request.json(); if (typeof body.userId !== 'string') throw new DomainError(422, 'USER_REQUIRED', '사용자를 선택해 주세요.'); const workspace = await transaction(state => { activeUser(state, body.userId); return getWorkspace(state, body.userId); }); const response = NextResponse.json(workspace, { headers: { 'Cache-Control': 'no-store' } }); response.cookies.set(sessionCookie, signSession(body.userId), { httpOnly: true, sameSite: 'strict', secure: false, path: '/', maxAge: 43200 }); return response; } catch (error) { return apiError(error); } }
export async function DELETE(request: NextRequest) {
  try { assertSameOrigin(request); if (!isLocalDemo(request)) throw new DomainError(403, 'DEMO_DISABLED', '기관 인증 서비스에서 로그아웃해 주세요.'); const response = NextResponse.json({ signedOut: true }); response.cookies.set(sessionCookie, '', { httpOnly: true, sameSite: 'strict', secure: false, path: '/', maxAge: 0 }); return response; } catch (error) { return apiError(error); }
}

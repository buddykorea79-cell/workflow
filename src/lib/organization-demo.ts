import { commonDistributionStatus } from './common-status';
import type { User, WorkspaceData } from './types';

export const ORGANIZATION_DEMO_MARKER = 'organization-demo-20261101';
export const ORGANIZATION_DEMO_TEAMS: Record<string, readonly string[]> = {
  'dept-plan': ['기획팀', '예산팀', '국회팀'],
  'dept-support': ['정보기획팀', '데이터팀', '정보자원팀'],
  'dept-innovation': ['혁신팀', '청년팀', '행정지원팀'],
};

export interface OrganizationDemoResult { changed: boolean; addedUsers: number; updatedUsers: number; updatedDistributions: number; revision: number }

const existingRoles = [
  ['u-minseo', 'dept-plan', 'manager'], ['u-jiho', 'dept-plan', 'member'], ['u-seoyeon', 'dept-plan', 'member'], ['u-plan-lead', 'dept-plan', 'lead'], ['u-head', 'dept-plan', 'head'], ['u-admin', 'dept-plan', 'admin'],
  ['u-doyun', 'dept-support', 'manager'], ['u-support-lead', 'dept-support', 'lead'], ['u-support-member', 'dept-support', 'member'], ['u-support-head', 'dept-support', 'head'], ['u-support-admin', 'dept-support', 'admin'],
  ['u-innovation-manager', 'dept-innovation', 'manager'], ['u-innovation-lead', 'dept-innovation', 'lead'], ['u-innovation-member', 'dept-innovation', 'member'], ['u-innovation-head', 'dept-innovation', 'head'], ['u-innovation-admin', 'dept-innovation', 'admin'],
] as const;

const additions: [id: string, name: string, departmentId: string, team: string, role: 'lead' | 'member', title: string][] = [
  ['u-budget-lead', '최팀장', 'dept-plan', '예산팀', 'lead', '예산팀장'],
  ['u-budget-member', '한주무관', 'dept-plan', '예산팀', 'member', '결산 담당 주무관'],
  ['u-assembly-lead', '윤팀장', 'dept-plan', '국회팀', 'lead', '국회팀장'],
  ['u-assembly-member-1', '서주무관', 'dept-plan', '국회팀', 'member', '국회 협력 주무관'],
  ['u-assembly-member-2', '장주무관', 'dept-plan', '국회팀', 'member', '국정감사 담당 주무관'],
  ['u-it-planning-lead', '오팀장', 'dept-support', '정보기획팀', 'lead', '정보기획팀장'],
  ['u-it-planning-member-1', '조주무관', 'dept-support', '정보기획팀', 'member', '정보화 기획 주무관'],
  ['u-it-planning-member-2', '신주무관', 'dept-support', '정보기획팀', 'member', '정보화 사업 주무관'],
  ['u-it-resources-lead', '배팀장', 'dept-support', '정보자원팀', 'lead', '정보자원팀장'],
  ['u-it-resources-member-1', '문주무관', 'dept-support', '정보자원팀', 'member', '정보시스템 운영 주무관'],
  ['u-it-resources-member-2', '백주무관', 'dept-support', '정보자원팀', 'member', '정보보안 담당 주무관'],
  ['u-youth-lead', '정팀장', 'dept-innovation', '청년팀', 'lead', '청년팀장'],
  ['u-youth-member-1', '류주무관', 'dept-innovation', '청년팀', 'member', '청년정책 기획 주무관'],
  ['u-youth-member-2', '안주무관', 'dept-innovation', '청년팀', 'member', '청년정책 협력 주무관'],
  ['u-administration-lead', '홍팀장', 'dept-innovation', '행정지원팀', 'lead', '행정지원팀장'],
  ['u-administration-member-1', '유주무관', 'dept-innovation', '행정지원팀', 'member', '행정지원 담당 주무관'],
  ['u-administration-member-2', '전주무관', 'dept-innovation', '행정지원팀', 'member', '조직 운영 주무관'],
];

export function organizationDemoUsers(): User[] {
  return additions.map(([id, name, departmentId, team, role, title], index) => ({ id, name, initials: name.slice(0, 1), departmentId, team, role, title, color: 'stone', active: true, email: `${id.slice(2)}@ieum.example`, phone: `02-0000-${1101 + index}` }));
}

/** Explicit one-time roster setup. Call inside transaction() for persisted data.
 * Existing account IDs, permissions and all historical work records stay intact. */
export function applyOrganizationDemo(state: WorkspaceData, now = new Date()): OrganizationDemoResult {
  const result: OrganizationDemoResult = { changed: false, addedUsers: 0, updatedUsers: 0, updatedDistributions: 0, revision: state.revision };
  if (state.audit.some(event => event.action === 'demo.organization.setup' && event.targetId === ORGANIZATION_DEMO_MARKER)) return result;
  for (const departmentId of Object.keys(ORGANIZATION_DEMO_TEAMS)) if (!state.departments.some(department => department.id === departmentId)) throw new Error(`가상 조직의 기존 부서 ${departmentId}가 없습니다.`);
  for (const [id, departmentId, role] of existingRoles) {
    const user = state.users.find(item => item.id === id);
    if (!user || user.departmentId !== departmentId || user.role !== role || !user.active || user.endsAt && Date.parse(user.endsAt) <= now.getTime()) throw new Error(`기존 가상 계정 ${id}의 부서·역할·활성 상태를 확인해 주세요. 기존 정보는 변경하지 않았습니다.`);
  }
  const newUsers = organizationDemoUsers();
  for (const user of newUsers) {
    if (state.users.some(existing => existing.id === user.id || existing.email === user.email || existing.phone === user.phone)) throw new Error(`추가할 가상 계정 ${user.id}의 ID 또는 연락처가 기존 계정과 중복됩니다. 기존 정보는 변경하지 않았습니다.`);
  }

  const iso = now.toISOString();
  const changes: string[] = [];
  const changedTeamIds = new Set<string>();
  for (const [id] of existingRoles) {
    const user = state.users.find(item => item.id === id)!;
    const team = user.role === 'head' || user.role === 'admin' ? '부서 직속' : id === 'u-jiho' ? '예산팀' : user.departmentId === 'dept-plan' ? '기획팀' : user.departmentId === 'dept-support' ? '데이터팀' : '혁신팀';
    if (user.team !== team) {
      changes.push(`${user.id}: ${user.team} → ${team}`);
      changedTeamIds.add(user.id);
      user.team = team;
      result.updatedUsers++;
    }
  }
  state.users.push(...newUsers); result.addedUsers = newUsers.length;

  for (const common of state.commonTasks) for (const distribution of common.distributions) {
    const status = commonDistributionStatus(state, common, distribution, now);
    const assigneeId = status.currentAssigneeId || distribution.assigneeId;
    if (!assigneeId || !changedTeamIds.has(assigneeId) || ['completed', 'archived', 'deleted'].includes(status.executionStatus || '')) continue;
    const assignee = state.users.find(user => user.id === assigneeId && !['head', 'admin'].includes(user.role));
    if (!assignee || assignee.departmentId !== distribution.departmentId) continue;
    const lead = state.users.find(user => user.departmentId === assignee.departmentId && user.team === assignee.team && user.role === 'lead' && user.active);
    if (!lead || distribution.team === assignee.team && distribution.leadId === lead.id) continue;
    const before = { team: distribution.team, leadId: distribution.leadId };
    distribution.team = assignee.team; distribution.leadId = lead.id;
    result.updatedDistributions++;
    state.audit.unshift({ id: `audit-${ORGANIZATION_DEMO_MARKER}-${distribution.id}`, actorId: 'system', action: 'demo.organization.assignment', targetType: 'common', targetId: common.id, title: '가상 직원 소속에 따른 현재 배정 정리', detail: JSON.stringify({ distributionId: distribution.id, assigneeId, before, after: { team: distribution.team, leadId: distribution.leadId } }), departmentId: distribution.departmentId, createdAt: iso });
  }
  state.audit.unshift({ id: `audit-${ORGANIZATION_DEMO_MARKER}`, actorId: 'system', action: 'demo.organization.setup', targetType: 'workspace', targetId: ORGANIZATION_DEMO_MARKER, title: '부서별 3개 팀 가상 조직 구성', detail: `9개 팀에 팀장 1명과 팀원 2명씩 구성 · 신규 ${result.addedUsers}명 · 기존 소속 변경 ${result.updatedUsers}명 · 현재 배정 정리 ${result.updatedDistributions}건 · ${changes.join(' / ')} · 기존 업무·수행·성과·확정 이력 보존`, departmentId: 'dept-plan', createdAt: iso });
  result.changed = true; state.revision++; result.revision = state.revision;
  return result;
}

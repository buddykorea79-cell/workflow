import type { OrgRole, User } from './types';

/** Login choices for the presentation; member1/member2 are not new permissions. */
export type DemoRole = OrgRole | 'member1' | 'member2';

const preferredUsers: Record<DemoRole, string> = {
  member: 'u-support-member',
  member1: 'u-support-member',
  member2: 'u-innovation-member',
  lead: 'u-support-lead',
  manager: 'u-doyun',
  head: 'u-support-head',
  admin: 'u-support-admin',
};

export function demoDefaultDepartment(role: DemoRole): string {
  return role === 'member2' ? 'dept-innovation' : 'dept-support';
}

export function demoCandidates(users: User[], role: DemoRole, departmentId: string): User[] {
  const organizationRole = role === 'member1' || role === 'member2' ? 'member' : role;
  return users.filter(user => user.active && user.departmentId === departmentId && user.role === organizationRole);
}

export function selectDemoUser(candidates: User[], role: DemoRole, selectedId: string): User | undefined {
  return candidates.find(user => user.id === selectedId)
    || candidates.find(user => user.id === preferredUsers[role])
    || candidates[0];
}

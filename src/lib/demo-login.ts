import type { OrgRole, User } from './types';

export type DemoRole = OrgRole | 'common';

const preferredUsers: Record<DemoRole, string> = {
  member: 'u-support-member',
  lead: 'u-support-lead',
  manager: 'u-doyun',
  head: 'u-support-head',
  admin: 'u-support-admin',
  common: 'u-jiho',
};

export function demoDefaultDepartment(role: DemoRole): string {
  return role === 'common' ? 'dept-plan' : 'dept-support';
}

export function demoCandidates(users: User[], role: DemoRole, departmentId: string): User[] {
  const department = role === 'common' ? 'dept-plan' : departmentId;
  return users.filter(user => user.active && user.departmentId === department && (
    role === 'common'
      ? user.role === 'member' && user.commonTaskPermission === true
      : user.role === role
  ));
}

export function selectDemoUser(candidates: User[], role: DemoRole, selectedId: string): User | undefined {
  return candidates.find(user => user.id === selectedId)
    || candidates.find(user => user.id === preferredUsers[role])
    || candidates[0];
}

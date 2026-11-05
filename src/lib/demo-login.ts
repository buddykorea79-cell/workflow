import type { OrgRole, User } from './types';

export type DemoRole = OrgRole;

const preferredUsers: Record<DemoRole, string> = {
  member: 'u-support-member',
  lead: 'u-support-lead',
  manager: 'u-doyun',
  head: 'u-support-head',
  admin: 'u-support-admin',
};

export function demoDefaultDepartment(_role: DemoRole): string {
  return 'dept-support';
}

export function demoCandidates(users: User[], role: DemoRole, departmentId: string): User[] {
  return users.filter(user => user.active && user.departmentId === departmentId && user.role === role);
}

export function selectDemoUser(candidates: User[], role: DemoRole, selectedId: string): User | undefined {
  return candidates.find(user => user.id === selectedId)
    || candidates.find(user => user.id === preferredUsers[role])
    || candidates[0];
}

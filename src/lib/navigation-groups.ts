import type { View } from './hash-route';
import type { OrgRole } from './types';

export type NavigationGroupId = 'my' | 'collaboration' | 'department' | 'organization';
export type NavigationGroup = { id: NavigationGroupId; label: string; views: View[]; alwaysOpen: boolean };
export type NavigationBadges = Partial<Record<string, number>>;
export type GroupExpansion = Record<NavigationGroupId, boolean>;
export type GroupNavigationState = { activeView: View; badges: NavigationBadges; expanded: GroupExpansion };

/** Preserve existing menu permissions; division was already available in the top bar. */
export function navigationGroups(role: OrgRole): NavigationGroup[] {
  const isAdmin = role === 'admin';
  const isHead = role === 'head';
  const canAllocate = role === 'manager' || isAdmin;
  return [
    { id: 'my', label: '내 업무', views: ['dashboard', ...(!isHead ? ['personal' as const] : []), 'schedule', 'handover'], alwaysOpen: true },
    { id: 'collaboration', label: '협업', views: ['common', ...(canAllocate ? ['allocation' as const] : []), 'delegation'], alwaysOpen: false },
    { id: 'department', label: '부서 관리', views: [...(isHead || isAdmin ? ['department' as const] : []), 'division', ...(canAllocate || isHead ? ['budgets' as const] : []), 'performance'], alwaysOpen: false },
    { id: 'organization', label: '조직·시스템', views: ['organization', ...(isAdmin ? ['admin' as const] : [])], alwaysOpen: false },
  ];
}

export function groupPendingCount(group: NavigationGroup, badges: NavigationBadges): number {
  return group.views.reduce((total, view) => {
    const count = badges[view];
    return total + (typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0);
  }, 0);
}

export function initialGroupExpansion(groups: readonly NavigationGroup[], activeView: View, badges: NavigationBadges): GroupExpansion {
  const expanded: GroupExpansion = { my: true, collaboration: false, department: false, organization: false };
  for (const group of groups) {
    expanded[group.id] = group.alwaysOpen || group.views.includes(activeView) || group.id !== 'organization' && groupPendingCount(group, badges) > 0;
  }
  return expanded;
}

/** A manual collapse survives refreshes; entering a group or receiving more work opens it again. */
export function reconcileGroupExpansion(groups: readonly NavigationGroup[], previous: GroupNavigationState, activeView: View, badges: NavigationBadges): GroupExpansion {
  const expanded = { ...previous.expanded };
  for (const group of groups) {
    if (group.alwaysOpen || activeView !== previous.activeView && group.views.includes(activeView)
      || (group.id === 'collaboration' || group.id === 'department') && groupPendingCount(group, badges) > groupPendingCount(group, previous.badges)) {
      expanded[group.id] = true;
    }
  }
  return expanded;
}

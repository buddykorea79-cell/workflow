'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, CalendarDays, CheckCheck, ChevronDown, FolderOpen, GitBranch, LayoutDashboard, Settings2, ShieldCheck, UserRound, Users, Wallet } from 'lucide-react';
import type { View } from '@/lib/hash-route';
import type { Workspace } from '@/lib/types';
import { APP_VERSION } from '@/lib/app-version';
import { groupPendingCount, initialGroupExpansion, navigationGroups, reconcileGroupExpansion, type GroupNavigationState, type NavigationBadges, type NavigationGroup } from '@/lib/navigation-groups';
import './grouped-sidebar.css';

export type GroupedSidebarProps = {
  workspace: Pick<Workspace, 'currentUser'>;
  activeView: View;
  badges: NavigationBadges;
  titles: Record<View, string>;
  onNavigate: (view: View) => void;
  onPreload?: (view: View) => void;
};

const icons = { dashboard: LayoutDashboard, personal: FolderOpen, schedule: CalendarDays, common: GitBranch, allocation: ShieldCheck, delegation: UserRound, handover: ArrowLeftRight, department: Users, division: Users, budgets: Wallet, performance: CheckCheck, organization: Users, admin: Settings2 };

export function GroupedSidebar(props: GroupedSidebarProps) {
  // Reset both manual choices and the previous badge baseline on account/role changes.
  return <GroupedNavigation key={`${props.workspace.currentUser.id}:${props.workspace.currentUser.role}`} {...props}/>;
}

function GroupedNavigation({ workspace, activeView, badges, titles, onNavigate, onPreload }: GroupedSidebarProps) {
  const groups = useMemo(() => navigationGroups(workspace.currentUser.role), [workspace.currentUser.role]);
  const prefix = useId();
  const panels = useRef(new Map<string, HTMLDivElement>());
  const toggles = useRef(new Map<string, HTMLButtonElement>());
  const [state, setState] = useState<GroupNavigationState>(() => ({ activeView, badges: { ...badges }, expanded: initialGroupExpansion(groups, activeView, badges) }));
  const expanded = reconcileGroupExpansion(groups, state, activeView, badges);
  const countsKey = groups.map(group => groupPendingCount(group, badges)).join(':');
  useEffect(() => {
    setState(previous => ({ activeView, badges: { ...badges }, expanded: reconcileGroupExpansion(groups, previous, activeView, badges) }));
  }, [activeView, countsKey, groups]);

  const toggle = (group: NavigationGroup) => {
    if (group.alwaysOpen) return;
    if (expanded[group.id] && typeof document !== 'undefined' && panels.current.get(group.id)?.contains(document.activeElement)) {
      toggles.current.get(group.id)?.focus({ preventScroll: true });
    }
    setState({ activeView, badges: { ...badges }, expanded: { ...expanded, [group.id]: !expanded[group.id] } });
  };

  return <nav className="grouped-sidebar" aria-label="주 메뉴">
    {groups.map(group => {
      const open = expanded[group.id];
      const count = groupPendingCount(group, badges);
      const labelId = `${prefix}-group-${group.id}`;
      const panelId = `${prefix}-items-${group.id}`;
      return <section key={group.id} className="sidebar-nav-group" role="group" aria-labelledby={labelId}>
        {group.alwaysOpen ? <h2 className="nav-group-label" id={labelId}>{group.label}</h2>
          : <button ref={element => { if (element) toggles.current.set(group.id, element); else toggles.current.delete(group.id); }} type="button" id={labelId} className="nav-group-label nav-group-toggle" aria-expanded={open} aria-controls={panelId} aria-label={!open && count ? `${group.label}, 처리 대기 ${count}건` : group.label} onClick={() => toggle(group)}>
            <span>{group.label}</span>{!open && count > 0 && <b className="nav-count" aria-hidden="true">{count}</b>}<ChevronDown size={15} aria-hidden="true"/>
          </button>}
        <div id={panelId} className="sidebar-group-items" hidden={!open} ref={element => { if (element) panels.current.set(group.id, element); else panels.current.delete(group.id); }}>
          {group.views.map(view => {
            const Icon = icons[view];
            const value = badges[view];
            const pending = typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
            return <button key={view} type="button" className={`nav-item ${activeView === view ? 'active' : ''}`} aria-current={activeView === view ? 'page' : undefined} aria-label={pending ? `${titles[view]}, 처리 대기 ${pending}건` : titles[view]}
              onMouseEnter={() => onPreload?.(view)} onFocus={() => onPreload?.(view)} onClick={() => onNavigate(view)}>
              <Icon size={19} strokeWidth={1.65}/><span>{titles[view]}</span>{pending > 0 && <b className="nav-count" aria-hidden="true">{pending}</b>}{view === 'admin' && <span className="nav-version" aria-hidden="true">v{APP_VERSION}</span>}
            </button>;
          })}
        </div>
      </section>;
    })}
  </nav>;
}

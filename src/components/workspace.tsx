'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeftRight, ArrowRight, ArrowUpRight, Bell, Building2, CalendarDays, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, FileText, FolderOpen, GitBranch, LayoutDashboard, LoaderCircle, LogOut, Menu, Search, Settings2, ShieldCheck, Sparkles, UserRound, Users, Wallet, X } from 'lucide-react';
import type { Department, Notification, Task, User, Workspace as WorkspaceData } from '@/lib/types';
import { Badge, Brand, Button, EmptyState, Modal, Progress, TextLink, commandErrorTarget, showCommandError, formatDate, formatDateTimeFull, roleLabels, type CommandFn } from './ui';
import type { FieldIssue } from '@/lib/form-validation';
import { PersonalWork, ScheduleView, TaskPanel, taskProgress } from './personal-work';
import { DepartmentDashboard, DepartmentWork } from './department-work';
import { demoCandidates, demoDefaultDepartment, selectDemoUser, type DemoRole } from '@/lib/demo-login';
import { ACCESS_CODE_LENGTH, ACCESS_CODE_PATTERN, isValidAccessCode } from '@/lib/access-code';
import { navBadges } from '@/lib/nav-badges';
import { LandingGuide } from './landing-guide';
import { UsageGuide, preloadUsageGuide, type GuideSection } from './usage-guide-dialog';
import { createLazyScreen } from './lazy-screen';
import type { GuideRole } from '@/lib/usage-guide';
import { UnsavedChangesProvider, useUnsavedNavigation } from './unsaved-changes';
import { notificationDestination, type NotificationDestination } from '@/lib/notification-navigation';
import { createCommandQueue } from '@/lib/command-queue';
import { commandFailure, readCommandResponse, type CommandFailure } from '@/lib/command-response';
import { canApplyWorkspaceResponse } from '@/lib/workspace-response';
import { taskExecution } from '@/lib/common-status';
import { dashboardTaskSummary } from '@/lib/dashboard-summary';
import { deadlineState } from '@/lib/task-deadline';
import { commandExpectation, targetRevision } from '@/lib/command-targets';
import { createRevisionChain } from '@/lib/command-revisions';
import { createHashNavigation } from '@/lib/hash-navigation';
import type { HashRoute, TaskTab, View } from '@/lib/hash-route';
import { notificationRoute } from '@/lib/notification-route';
import { sortNotifications, notificationRelativeTime, notificationTimeTitle } from '@/lib/notification-presentation';
import { createNotificationReadQueue } from '@/lib/notification-read';
import { searchResultRoute, type SearchResult } from '@/lib/search';
import { WorkspaceSearch } from './workspace-search';
import { GroupedSidebar } from './grouped-sidebar';
import './workspace-directory.css';

const adminScreen = createLazyScreen(() => import('./management').then(module => module.AdminView), { label: '시스템 관리' });
const organizationScreen = createLazyScreen(() => import('./management').then(module => module.OrganizationView), { label: '조직·구성원' });
const commonScreen = createLazyScreen(() => import('./common-work').then(module => module.CommonWork), { label: '공통업무·지시사항' });
const allocationScreen = createLazyScreen(() => import('./allocation-review').then(module => module.AllocationReview), { label: '배정·승인 관리' });
const performanceScreen = createLazyScreen(() => import('./unit-evaluation').then(module => module.PerformanceView), { label: '성과·평가' });
const handoverScreen = createLazyScreen(() => import('./personnel-handover').then(module => module.PersonnelHandover), { label: '인수인계' });
const delegationScreen = createLazyScreen(() => import('./delegation-work').then(module => module.DelegationWork), { label: '업무대행' });
const divisionScreen = createLazyScreen(() => import('./organization-division').then(module => module.OrganizationDivision), { label: '업무분장표' });
const budgetScreen = createLazyScreen(() => import('./department-budget').then(module => module.DepartmentBudget), { label: '부서 예산 집계' });
const { Component: AdminView } = adminScreen;
const { Component: OrganizationView } = organizationScreen;
const { Component: CommonWork } = commonScreen;
const { Component: AllocationReview } = allocationScreen;
const { Component: PerformanceView } = performanceScreen;
const { Component: PersonnelHandover } = handoverScreen;
const { Component: DelegationWork } = delegationScreen;
const { Component: OrganizationDivision } = divisionScreen;
const { Component: DepartmentBudget } = budgetScreen;
const viewPreloads: Partial<Record<View, () => Promise<void>>> = {
  admin: adminScreen.preload, organization: organizationScreen.preload, common: commonScreen.preload,
  allocation: allocationScreen.preload, performance: performanceScreen.preload, handover: handoverScreen.preload,
  delegation: delegationScreen.preload, division: divisionScreen.preload, budgets: budgetScreen.preload,
};
const preloadView = (view: View) => { void viewPreloads[view]?.(); };

const titles: Record<View, string> = { dashboard: '업무 홈', personal: '개인업무', department: '부서 업무 관리', budgets: '부서 예산 집계', division: '업무분장표', delegation: '업무대행', allocation: '배정·승인 관리', common: '공통업무 · 지시사항', schedule: '업무 일정', performance: '성과 · 평가', handover: '인수인계', organization: '조직 · 구성원', admin: '관리자' };
const demoRoles = [{ id: 'member1', label: '업무 담당자 1', icon: UserRound }, { id: 'member2', label: '업무 담당자 2', icon: UserRound }, { id: 'lead', label: '팀장', icon: Users }, { id: 'manager', label: '부서 담당자', icon: Building2 }, { id: 'head', label: '부서장', icon: ShieldCheck }, { id: 'admin', label: '관리자', icon: Settings2 }];

function DemoLogin({ users, departments, busy, error, onLogin }: { users: User[]; departments: Department[]; busy: boolean; error: string; onLogin: (id: string) => void }) {
  const [role, setRole] = useState<DemoRole>('member1');
  const [departmentId, setDepartmentId] = useState(demoDefaultDepartment('member1'));
  const [selectedId, setSelectedId] = useState('');
  const availableDepartmentId = departments.some(department => department.id === departmentId) ? departmentId : departments[0]?.id || departmentId;
  const available = demoCandidates(users, role, availableDepartmentId);
  const selected = selectDemoUser(available, role, selectedId);
  const selectedDepartmentId = selected?.departmentId || availableDepartmentId;
  return <div className="login-card" id="login">
    <div className="login-card-intro"><span className="login-icon"><ArrowUpRight size={23}/></span><Badge>시연용 워크스페이스</Badge></div>
    <h2>온이음 시작하기.</h2><p className="login-description">{departments.length === 1 ? '현재 부서의 계정으로 역할을 바꾸며 업무 흐름을 확인하세요.' : '담당자 1은 데이터정보화담당관실에서 공통업무를 작성하고, 담당자 2는 혁신행정담당관실에서 배정받습니다.'}</p>
    <fieldset className="role-picker"><legend>어떤 역할로 시작할까요?</legend><div>{demoRoles.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={role === id ? 'role-option selected' : 'role-option'} aria-pressed={role === id} onClick={() => { const nextRole = id as DemoRole; const defaultDepartment = demoDefaultDepartment(nextRole); setRole(nextRole); setDepartmentId(departments.some(department => department.id === defaultDepartment) ? defaultDepartment : departments[0]?.id || defaultDepartment); setSelectedId(''); }}><Icon size={18} strokeWidth={1.65}/><span>{label}</span>{role === id && <Check size={13} className="role-check"/>}</button>)}</div></fieldset>
    <div className="login-selects"><label className="field"><span>부서</span><select aria-label="로그인 부서" value={selectedDepartmentId} onChange={e => { setDepartmentId(e.target.value); setSelectedId(''); }}>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label className="field"><span>시연 계정</span><select aria-label="시연 계정" value={selected?.id || ''} onChange={e => setSelectedId(e.target.value)}>{!available.length && <option value="">해당 역할의 계정이 없습니다</option>}{available.map(u => <option key={u.id} value={u.id}>{u.name} · {u.team} · {u.title}</option>)}</select></label></div>
    {selected && <div className="login-person"><span className="avatar">{selected.name.slice(0, 1)}</span><div><strong>{selected.name}</strong><span>{departments.find(d => d.id === selected.departmentId)?.name} · {selected.team}</span></div></div>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <Button className="login-submit" disabled={busy || !selected} onClick={() => selected && onLogin(selected.id)}>{busy ? <LoaderCircle className="spin" size={18}/> : <><span>{selected ? selected.name + ' 계정으로 시작하기' : '계정 불러오는 중'}</span><ArrowRight size={18}/></>}</Button>
    <p className="login-footnote">비밀번호 없이 체험할 수 있는 가상 계정입니다.</p>
  </div>;
}

function AccessCodeForm({ busy, error, onAccess }: { busy: boolean; error: string; onAccess: (code: string) => Promise<void> }) {
  const [code, setCode] = useState('');
  return <form className="login-card" id="login" onSubmit={event => { event.preventDefault(); if (!busy && isValidAccessCode(code)) void onAccess(code); }}>
    <div className="login-card-intro"><span className="login-icon"><ShieldCheck size={23}/></span><Badge>시연용 워크스페이스</Badge></div>
    <h2>접근 코드 확인</h2><p id="access-code-hint" className="login-description">안내받은 숫자 8자리 접근 코드를 입력하면 시연할 역할을 선택할 수 있습니다.</p>
    <label className="field"><span>접근 코드</span><input name="accessCode" type="password" inputMode="numeric" pattern={ACCESS_CODE_PATTERN} autoComplete="off" autoFocus required minLength={ACCESS_CODE_LENGTH} maxLength={ACCESS_CODE_LENGTH} placeholder="숫자 8자리" value={code} onChange={event => setCode(event.target.value)} aria-describedby={error ? 'access-code-hint access-code-error' : 'access-code-hint'}/></label>
    {error && <p id="access-code-error" role="alert" className="form-error">{error}</p>}
    <Button type="submit" className="login-submit" disabled={busy || !isValidAccessCode(code)}>{busy ? <><LoaderCircle className="spin" size={18}/><span>확인 중</span></> : <><span>접근 코드 확인</span><ArrowRight size={18}/></>}</Button>
    <p className="login-footnote">접근 권한은 12시간 유지됩니다. 로그아웃하면 다시 입력해야 합니다.</p>
  </form>;
}

function Landing(props: Parameters<typeof DemoLogin>[0] & { accessRequired: boolean; onAccess: (code: string) => Promise<void> }) {
  const [guide, setGuide] = useState<{ section: GuideSection; role?: GuideRole } | null>(null);
  return <div className="landing">
    <header className="landing-nav"><a href="/" aria-label="온이음 홈"><Brand/></a><span className="landing-nav-copy">일과 사람, 그 사이를 잇다.</span><div className="landing-nav-actions"><button type="button" className="btn btn-secondary landing-guide-button" onMouseEnter={() => void preloadUsageGuide()} onFocus={() => void preloadUsageGuide()} onClick={() => setGuide({ section: 'start' })}><CircleHelp size={16}/>온이음 사용 안내</button><a href="#login" className="btn btn-primary" onClick={event => { event.preventDefault(); document.getElementById('login')?.scrollIntoView({ behavior: 'smooth' }); }}>시작하기 <ArrowUpRight size={16}/></a></div></header>
    <main className="landing-main">
      <section className="landing-hero"><p className="hero-eyebrow"><span className="tiny-mark"/>공공업무를 위한 하나의 워크스페이스</p><h1>일은 명확하게.<br/>흐름은 자연스럽게.</h1><p className="hero-description">흩어진 업무를 정리하고, 함께하는 일을 연결합니다.<br className="desktop-break"/>계획부터 실행, 성과까지. 업무의 모든 순간을 온이음에서.</p>
        <div className="hero-flow"><div><span><FolderOpen size={24} strokeWidth={1.4}/></span><b>업무를 정리하고</b><small>단위업무 · 세부업무</small></div><i/><div><span><GitBranch size={24} strokeWidth={1.4}/></span><b>함께 실행하고</b><small>부서 · 팀 · 개인 연결</small></div><i/><div><span><CheckCheck size={24} strokeWidth={1.4}/></span><b>성과로 이어집니다</b><small>반기별 기록 · 평가</small></div></div>
      </section>
      {props.accessRequired ? <AccessCodeForm busy={props.busy} error={props.error} onAccess={props.onAccess}/> : <DemoLogin {...props}/>}
    </main>
    <LandingGuide onPreload={preloadUsageGuide} onOpen={(section, role) => setGuide({ section, role })}/>
    <footer className="landing-footer"><Brand inverse/><p>업무의 맥락이 쌓이고, 조직의 다음이 이어집니다.</p><span>온이음 워크스페이스 <i/> v0.7.0</span></footer>
    {guide && <UsageGuide initialSection={guide.section} initialRole={guide.role} onClose={() => setGuide(null)}/>}
  </div>;
}

export default function Workspace() { return <UnsavedChangesProvider><WorkspaceContent/></UnsavedChangesProvider>; }

function WorkspaceContent() {
  const { requestNavigation } = useUnsavedNavigation();
  const [notificationTarget, setNotificationTarget] = useState<NotificationDestination | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const busy = pendingCount > 0;
  const [loginError, setLoginError] = useState('');
  const [accessRequired, setAccessRequired] = useState(false);
  const [route, setRoute] = useState<HashRoute>({ view: 'dashboard' });
  const routeRef = useRef(route);
  const navigationRef = useRef<ReturnType<typeof createHashNavigation> | null>(null);
  const [taskMode, setTaskMode] = useState<'view' | 'edit'>('view');
  const view = route.view;
  const selectedTask = route.taskId;
  const [switching, setSwitching] = useState(false);
  const [help, setHelp] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [searchCloseSignal, setSearchCloseSignal] = useState(0);
  const [notifications, setNotifications] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const currentRef = useRef(workspace);
  const sessionGeneration = useRef(0);
  const revisionChain = useRef(createRevisionChain());
  const queueRef = useRef<ReturnType<typeof createCommandQueue<WorkspaceData | null>> | null>(null);
  if (!queueRef.current) queueRef.current = createCommandQueue(() => currentRef.current, setPendingCount);
  const queue = queueRef.current;
  const commandRef = useRef<CommandFn | null>(null);
  const readQueueRef = useRef<ReturnType<typeof createNotificationReadQueue> | null>(null);
  if (!readQueueRef.current) readQueueRef.current = createNotificationReadQueue(
    () => currentRef.current ? { actorId: currentRef.current.currentUser.id, generation: sessionGeneration.current } : null,
    payload => commandRef.current?.('notification.read', payload, { silent: true }) ?? Promise.resolve(false),
  );
  const notificationReads = readQueueRef.current;
  const applyRoute = useCallback((next: HashRoute) => {
    if (next.taskId !== routeRef.current.taskId) setTaskMode('view');
    routeRef.current = next; setRoute(next);
    setSearchCloseSignal(value => value + 1); setNotifications(false); setMobileMenu(false);
  }, []);

  const loadSession = useCallback(async () => {
    const generation = sessionGeneration.current;
    const response = await fetch('/api/session?scope=demo', { cache: 'no-store' });
    const result = await response.json();
    if (generation !== sessionGeneration.current) return;
    if (response.status === 401 && result.code === 'ACCESS_REQUIRED') { if (currentRef.current) sessionGeneration.current++; revisionChain.current.clear(); setAccessRequired(true); currentRef.current = null; setWorkspace(null); setUsers([]); setDepartments([]); return; }
    if (!response.ok) throw new Error(result.error || '계정을 불러올 수 없습니다.');
    setAccessRequired(false);
    setUsers(result.users || []); setDepartments(result.departments || []);
  }, []);

  const loadWorkspace = useCallback(async (beforeApply?: (workspace: WorkspaceData) => void) => {
    const generation = sessionGeneration.current;
    const response = await fetch('/api/workspace', { cache: 'no-store' });
    const body = await response.json();
    if (generation !== sessionGeneration.current) return;
    if (response.status === 401) { if (currentRef.current) sessionGeneration.current++; revisionChain.current.clear(); currentRef.current = null; setWorkspace(null); if (body.code === 'ACCESS_REQUIRED') { setAccessRequired(true); setUsers([]); setDepartments([]); } return; }
    if (!response.ok) throw new Error(body.error || '워크스페이스를 불러오지 못했습니다.');
    const current = currentRef.current;
    if (!canApplyWorkspaceResponse(current, body, generation, sessionGeneration.current)) return;
    beforeApply?.(body);
    currentRef.current = body; setWorkspace(body);
    void readQueueRef.current?.retry(body.notifications);
  }, []);

  useEffect(() => {
    Promise.allSettled([
      loadSession(),
      loadWorkspace(),
    ]).then(results => { for (const result of results) if (result.status === 'rejected') setLoginError(result.reason instanceof Error ? result.reason.message : '연결을 확인해 주세요.'); setLoading(false); });
    const navigation = createHashNavigation({
      read: () => ({ hash: window.location.hash, state: window.history.state }),
      push: (hash, state) => window.history.pushState(state, '', hash),
      replace: (hash, state) => window.history.replaceState(state, '', hash),
      go: delta => window.history.go(delta),
      apply: applyRoute,
      confirm: (accept, cancel) => requestNavigation(accept, cancel),
    });
    navigationRef.current = navigation;
    navigation.start();
    const onHash = () => navigation.receive();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setNotifications(false); setMobileMenu(false); } };
    window.addEventListener('hashchange', onHash); window.addEventListener('popstate', onHash); window.addEventListener('keydown', onKey);
    return () => { navigationRef.current = null; window.removeEventListener('hashchange', onHash); window.removeEventListener('popstate', onHash); window.removeEventListener('keydown', onKey); };
  }, [loadWorkspace, loadSession, requestNavigation, applyRoute]);

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), notice.error ? 10000 : 4500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const task = workspace?.tasks.find(item => item.id === route.taskId && !item.deletedAt);
    document.title = workspace ? `${task?.title || titles[route.view]} · 온이음` : '온이음 · 업무의 흐름을 잇다';
  }, [workspace, route]);

  const command: CommandFn = async (type, payload, options) => {
    const errorTarget = options?.silent ? null : commandErrorTarget();
    const actorId = currentRef.current?.currentUser.id;
    const generation = sessionGeneration.current;
    const submittedPayload = structuredClone(payload);
    const expected = options?.expected === undefined && currentRef.current ? commandExpectation(currentRef.current, type, submittedPayload) : options?.expected;
    const requestId = crypto.randomUUID();
    const reportError = (error: unknown, fallback: string) => {
      if (options?.silent) return;
      const message = error instanceof Error ? error.message : fallback;
      const fields = error instanceof Error && 'fields' in error && Array.isArray(error.fields) ? error.fields as FieldIssue[] : [];
      if (showCommandError(message, fields, errorTarget)) setNotice(null);
      else setNotice({ text: message, error: true });
    };
    const reportFailure = (failure: CommandFailure) => {
      // Consumer rendering errors must never turn a known outcome into another write.
      try { options?.onFailure?.(failure); } catch { /* preserve the command outcome */ }
      reportError(Object.assign(new Error(failure.message), { fields: failure.fields ?? [] }), failure.message);
    };
    return queue.enqueue(async current => {
      if (!current || current.currentUser.id !== actorId || generation !== sessionGeneration.current) {
        reportFailure({ outcome: 'not-sent', message: '로그인 상태가 변경되었습니다. 현재 계정을 확인한 뒤 다시 저장해 주세요.' });
        return false;
      }
      if (type === 'workspace.refresh') {
        try { await loadWorkspace(); return true; }
        catch (error) { reportError(error, '최신 정보를 불러오지 못했습니다.'); return false; }
      }
      if (!options?.silent) showCommandError('', [], errorTarget);
      let result: WorkspaceData;
      try {
      // Catalog data is fetched separately. Advance only through exact own receipts;
      // the server still rejects any intervening external change.
      const queuedExpected = expected ? revisionChain.current.advance(expected, expected.kind === 'budgetItem' || expected.kind === 'budgetCatalog' ? undefined : targetRevision(current, expected)) : undefined;
      const response = await fetch(type.startsWith('budget.') ? '/api/budgets' : '/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, payload: submittedPayload, expectedRevision: current.revision, expected: queuedExpected, requestId }) });
      result = await readCommandResponse(response, actorId);
      if (!currentRef.current || currentRef.current.currentUser.id !== actorId || generation !== sessionGeneration.current) return false;
      } catch (error) {
        if (generation !== sessionGeneration.current || currentRef.current?.currentUser.id !== actorId) return false;
        const failure = commandFailure(error);
        if (failure.status === 409) {
          try { await loadWorkspace(!options?.silent && failure.code === 'TARGET_CONFLICT' ? options?.onConflict : undefined); }
          catch { /* The original rejection is authoritative even if refresh fails. */ }
        }
        if (generation !== sessionGeneration.current || currentRef.current?.currentUser.id !== actorId) return false;
        reportFailure(failure);
        // A delayed background read must not unmount a form the user started editing after navigation.
        if (failure.status === 401 && !options?.silent) { sessionGeneration.current++; revisionChain.current.clear(); currentRef.current = null; setWorkspace(null); if (failure.code === 'ACCESS_REQUIRED') { setAccessRequired(true); setUsers([]); setDepartments([]); } }
        return false;
      }
      revisionChain.current.record(result.commandChanges || []);
      let callbackFailed = false;
      try { options?.onSaved?.(result); } catch { callbackFailed = true; }
      if (!currentRef.current || result.revision >= currentRef.current.revision) {
        currentRef.current = result; setWorkspace(result);
      }
      if (!options?.silent || callbackFailed) setNotice({ text: callbackFailed ? '변경은 저장했습니다. 화면 반영을 확인해 주세요.' : '변경 내용을 저장했습니다.', error: callbackFailed });
      if (type.startsWith('organization.user') || type === 'organization.departmentCreate') {
        setUsers([]); setDepartments([]);
        try { await loadSession(); }
        catch { if (!options?.silent) setNotice({ text: '변경은 저장했습니다. 시연 계정 목록을 새로 불러오려면 화면을 새로고침해 주세요.', error: true }); }
      }
      return true;
    }, { silent: options?.silent });
  };
  commandRef.current = command;

  const renderedSessionGeneration = sessionGeneration.current;
  const receiveUploadedWorkspace = (next: WorkspaceData) => {
    const current = currentRef.current;
    if (!current || !canApplyWorkspaceResponse(current, next, renderedSessionGeneration, sessionGeneration.current)) return;
    currentRef.current = next; setWorkspace(next);
  };

  const navigateNow = (next: View) => { navigationRef.current?.navigate({ view: next }); setNotificationTarget(null); window.scrollTo({ top: 0, behavior: 'instant' }); };
  const navigate = (next: View) => requestNavigation(() => navigateNow(next));
  const openTaskNow = (taskId: string, options?: { mode?: 'view' | 'edit' }) => {
    navigationRef.current?.openTask(taskId);
    setTaskMode(options?.mode || 'view'); setSearchCloseSignal(value => value + 1); setNotifications(false);
  };
  const openTask = (taskId: string, options?: { mode?: 'view' | 'edit' }) => {
    const open = () => openTaskNow(taskId, options);
    if (selectedTask && selectedTask !== taskId) requestNavigation(open); else open();
  };
  const selectSearchResult = (result: SearchResult) => {
    const current = currentRef.current;
    if (!current) return;
    const actorId = current.currentUser.id;
    const generation = sessionGeneration.current;
    const initial = searchResultRoute(current, result);
    const select = () => {
      const latest = currentRef.current;
      if (!latest || latest.currentUser.id !== actorId || generation !== sessionGeneration.current) return;
      // Confirmation can remain open while another response changes the result's visibility or owner.
      const target = searchResultRoute(latest, result);
      if (target.taskId) { openTaskNow(target.taskId); return; }
      navigationRef.current?.navigate(target);
      setNotificationTarget(null); setFocusToken(value => value + 1);
      setSearchCloseSignal(value => value + 1); setNotifications(false); setMobileMenu(false);
    };
    if (initial.taskId && (!selectedTask || selectedTask === initial.taskId)) select(); else requestNavigation(select);
  };
  const changeTaskTab = (tab: TaskTab) => navigationRef.current?.setTab(tab);
  const beginRoleSwitch = () => requestNavigation(() => {
    navigationRef.current?.reset({ view: routeRef.current.view });
    setLoginError(''); setSwitching(true);
  });
  const openNotification = (notification: Notification) => {
    if (!workspace) return;
    const target = notificationRoute(notification, workspace);
    const open = () => {
      if (target.taskId) openTaskNow(target.taskId);
      else {
        navigationRef.current?.navigate(target);
        setNotifications(false); setSearchCloseSignal(value => value + 1); setMobileMenu(false);
        setFocusToken(value => value + 1);
        const destination = notificationDestination(notification, workspace);
        setNotificationTarget(destination.view === target.view ? destination : null);
      }
      if (!notification.read) void notificationReads.request([notification.id]);
    };
    if (target.taskId && !selectedTask) open(); else requestNavigation(open);
  };
  const unlockAccess = async (code: string) => queue.enqueue(async () => {
    sessionGeneration.current++;
    revisionChain.current.clear();
    setLoginError('');
    try {
      const response = await fetch('/api/session/access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || '접근 코드를 확인하지 못했습니다.');
      sessionGeneration.current++;
      await loadSession(); await loadWorkspace();
    } catch (error) { setLoginError(error instanceof Error ? error.message : '접근 코드를 확인하지 못했습니다.'); }
  });
  const login = async (userId: string) => queue.enqueue(async () => {
    const changingRole = !!currentRef.current;
    sessionGeneration.current++;
    revisionChain.current.clear();
    setLoginError('');
    try {
      const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
      const result = await response.json(); if (!response.ok) { if (result.code === 'ACCESS_REQUIRED') { setAccessRequired(true); currentRef.current = null; setWorkspace(null); setUsers([]); setDepartments([]); } throw new Error(result.error || '로그인하지 못했습니다.'); }
      sessionGeneration.current++;
      setWorkspace(result); currentRef.current = result; setSwitching(false);
      if (changingRole) { navigationRef.current?.reset({ view: 'dashboard' }); setNotificationTarget(null); }
      setUsers([]); setDepartments([]); await loadSession();
    } catch (error) { setLoginError(error instanceof Error ? error.message : '로그인 오류'); }
  });
  const logout = async () => queue.enqueue(async () => {
    sessionGeneration.current++;
    revisionChain.current.clear();
    try { const response = await fetch('/api/session', { method: 'DELETE' }); if (!response.ok) throw new Error('로그아웃하지 못했습니다.'); sessionGeneration.current++; setWorkspace(null); currentRef.current = null; navigationRef.current?.reset({ view: 'dashboard' }); setNotificationTarget(null); setSearchCloseSignal(value => value + 1); setNotifications(false); setUsers([]); setDepartments([]); await loadSession(); }
    catch (error) { setNotice({ text: (error as Error).message, error: true }); }
  });

  if (loading) return <div className="boot-screen"><Brand/><span className="loading-line"/><p>업무의 흐름을 준비하고 있습니다.</p></div>;
  if (!workspace) return <Landing users={users} departments={departments} busy={busy} error={loginError} onLogin={login} accessRequired={accessRequired} onAccess={unlockAccess}/>;
  const user = workspace.currentUser;
  const department = workspace.departments.find(d => d.id === user.departmentId);
  const isAdmin = user.role === 'admin';
  const isHead = user.role === 'head';
  const canAllocate = user.role === 'manager' || isAdmin;
  const canViewBudgets = canAllocate || isHead;
  const safeView = view === 'admin' && !isAdmin || view === 'allocation' && !canAllocate || view === 'budgets' && !canViewBudgets ? 'dashboard' : isHead && view === 'personal' ? 'department' : view === 'department' && !isHead && !isAdmin ? 'division' : view;
  const badges = navBadges(workspace, new Date(workspace.serverTime));
  const pendingTotal = Object.values(badges).reduce<number>((sum, value) => sum + (value || 0), 0);
  const orderedNotifications = sortNotifications(workspace.notifications);
  return <div className="app-shell">
    {mobileMenu && <button className="sidebar-scrim" aria-label="메뉴 닫기" onClick={() => setMobileMenu(false)}/>}
    <aside className={'sidebar sidebar-grouped ' + (mobileMenu ? 'sidebar-open' : '')}>
      <button className="brand-button" onClick={() => navigate('dashboard')} aria-label="업무 홈"><Brand/></button>
      <button className="org-switch" onMouseEnter={() => preloadView('organization')} onFocus={() => preloadView('organization')} onClick={() => navigate('organization')}><span className="org-symbol"><Building2 size={19}/></span><span><b>우리의 워크스페이스</b><small>{user.role === 'admin' ? '전체 부서' : department?.name}</small></span><ChevronRight size={14}/></button>
      <GroupedSidebar key={`${user.id}:${user.role}`} workspace={workspace} activeView={safeView} badges={badges} titles={titles} onNavigate={navigate} onPreload={preloadView} />
      <div className="sidebar-tail"><button className="nav-item" onMouseEnter={() => void preloadUsageGuide()} onFocus={() => void preloadUsageGuide()} onClick={() => setHelp(true)}><CircleHelp size={19} strokeWidth={1.65}/><span>온이음 사용 안내</span></button>
        <div className="demo-note"><span/><div><strong>시연 워크스페이스</strong><small>역할을 바꾸며 흐름을 확인하세요.</small></div></div>
        <button className="profile-button" onClick={beginRoleSwitch}><span className="avatar">{user.name.slice(0, 1)}</span><span><b>{user.name}</b><small>{roleLabels[user.role]}</small></span><ChevronDown size={16}/></button>
      </div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-btn mobile-toggle" aria-label={pendingTotal ? `메뉴 열기, 처리 대기 ${pendingTotal}건` : '메뉴 열기'} onClick={() => setMobileMenu(true)}><Menu size={20}/>{pendingTotal > 0 && <i className="mobile-pending-dot" aria-hidden="true"/>}</button><span>워크스페이스</span><ChevronRight size={14}/><b>{titles[safeView]}</b></div><div className="topbar-actions"><WorkspaceSearch key={user.id} workspace={workspace} onSelect={selectSearchResult} onOpen={() => setNotifications(false)} closeSignal={searchCloseSignal}/>
      <button type="button" aria-label="업무분장표" className={"topbar-directory " + (safeView === "division" ? "active" : "")} onMouseEnter={() => preloadView("division")} onFocus={() => preloadView("division")} onClick={() => navigate("division")}><Users size={17}/><span>업무분장표</span></button>
      <button className="icon-btn bell-button" aria-label="알림" onClick={() => { setSearchCloseSignal(value => value + 1); setNotifications(!notifications); }}><Bell size={19}/>{workspace.notifications.some(n => !n.read) && <i/>}</button><span className="topbar-rule"/><button className="session-button" aria-label="역할 전환" onClick={beginRoleSwitch}><UserRound size={16}/><span>역할 전환</span></button><button className="icon-btn" aria-label="로그아웃" disabled={busy} onClick={() => requestNavigation(() => void logout())}><LogOut size={18}/></button></div>
      {notifications && <section className="notification-popover" aria-label="알림 목록">
        <div className="popover-heading"><b>알림</b><button className="text-link" disabled={!workspace.notifications.some(item => !item.read)} onClick={() => void notificationReads.request(workspace.notifications.filter(item => !item.read).map(item => item.id), true)}>모두 읽음</button></div>
        {orderedNotifications.length ? orderedNotifications.map(n => <button className="notification-row" key={n.id} aria-label={`${n.read ? '' : '읽지 않음 · '}${n.title}`} aria-describedby={`notification-description-${n.id}`} onClick={() => openNotification(n)}>
          <span className={'notification-dot ' + (n.read ? 'read' : '')} aria-hidden="true"/>
          <span><b>{n.title}</b><small id={`notification-description-${n.id}`}>{n.description}</small><span className="notification-time" title={notificationTimeTitle(n.createdAt)}>{notificationRelativeTime(n.createdAt, new Date())}</span></span>
        </button>) : <p className="search-empty">새로운 알림이 없습니다.</p>}
      </section>}
      </header>
      <main className="main-content" aria-busy={busy}>
        {safeView === 'dashboard' && (isHead ? <DepartmentDashboard key={user.id} workspace={workspace} command={command} onOpenTask={openTask} onRefresh={loadWorkspace} onManage={() => navigate('department')} onEvaluate={() => navigate('performance')}/> : <Dashboard workspace={workspace} navigate={navigate} onOpenTask={openTask}/>)}
        {safeView === 'personal' && <PersonalWork key={user.id} focusId={route.focus} focusToken={focusToken} workspace={workspace} command={command} onOpenTask={openTask} onWorkspace={receiveUploadedWorkspace}/>}
        {safeView === 'department' && <DepartmentWork key={user.id} workspace={workspace} command={command} onOpenTask={openTask} onRefresh={loadWorkspace}/>}
        {safeView === 'budgets' && <DepartmentBudget key={user.id} workspace={workspace}/>}
        {safeView === 'division' && <OrganizationDivision key={user.id} focusId={route.focus} focusToken={focusToken} workspace={workspace} onRefresh={loadWorkspace}/>}
        {safeView === 'delegation' && <DelegationWork key={user.id + (notificationTarget?.view === 'delegation' ? notificationTarget.delegationId || '' : '')} initialDelegationId={notificationTarget?.view === 'delegation' ? notificationTarget.delegationId : undefined} workspace={workspace} command={command} onOpenTask={openTask}/>}
        {safeView === 'allocation' && <AllocationReview key={user.id} focusId={route.focus} focusToken={focusToken} workspace={workspace} command={command} onOpenCommon={() => navigate('common')} onOpenHandover={() => navigate('handover')} onOpenDivision={() => navigate('division')}/>}
        {safeView === 'common' && <CommonWork key={user.id} focusId={route.focus} focusToken={focusToken} workspace={workspace} command={command} onOpenTask={openTask} onRefresh={loadWorkspace} onGoPersonal={() => navigate('personal')}/>}
        {safeView === 'schedule' && <ScheduleView key={user.id} workspace={workspace} command={command} onOpenTask={openTask}/>}
        {safeView === 'performance' && <PerformanceView key={user.id + (notificationTarget?.view === 'performance' ? `${notificationTarget.personId}-${notificationTarget.period}` : '')} initialSelection={notificationTarget?.view === 'performance' ? notificationTarget : undefined} workspace={workspace} command={command} onOpenTask={openTask}/>}
        {safeView === 'handover' && <PersonnelHandover key={user.id} focusId={route.focus} focusToken={focusToken} workspace={workspace} command={command} busy={busy} onOpenTask={openTask}/>}
        {safeView === 'organization' && <OrganizationView key={user.id} focusId={route.focus} focusToken={focusToken} workspace={workspace} command={command}/>}
        {safeView === 'admin' && <AdminView workspace={workspace} command={command}/>}
      </main>
      <footer className="workspace-footer"><span>온이음 · 업무의 흐름을 잇다.</span><span>{workspace.mode === 'local' ? '로컬에 안전하게 저장 중' : '연결된 데이터베이스'}<i/>v0.7.0</span></footer>
    </div>
    {busy && <div className="saving-indicator" role="status"><LoaderCircle size={15} className="spin"/>{pendingCount >= 3 ? '저장을 순서대로 처리하고 있습니다.' : '저장 중'}</div>}
    {notice && <div className={'toast ' + (notice.error ? 'toast-error' : '')} role={notice.error ? 'alert' : 'status'}><span>{notice.error ? '요청을 확인해 주세요' : <Check size={17}/>}</span><p>{notice.text}</p><button className="icon-btn" aria-label="메시지 닫기" onClick={() => setNotice(null)}><X size={16}/></button></div>}
    {selectedTask && <TaskPanel key={selectedTask + user.id} workspace={workspace} taskId={selectedTask} initialMode={taskMode} routedTab={route.tab} onTabChange={changeTaskTab} onNavigateView={navigateNow} command={command} onWorkspace={receiveUploadedWorkspace} onClose={() => navigationRef.current?.closeTask()}/>}
    {switching && <Modal title="다른 역할로 둘러보기" description="업무 담당자 1·2 또는 부서별 승인·배정 역할로 바로 전환하세요." onClose={() => setSwitching(false)}><DemoLogin users={users} departments={departments} busy={busy} error={loginError} onLogin={login}/></Modal>}
    {help && <UsageGuide initialRole={user.role} initialSection="roles" onClose={() => setHelp(false)}/> }
  </div>;
}

function Dashboard({ workspace: w, navigate, onOpenTask }: { workspace: WorkspaceData; navigate: (view: View) => void; onOpenTask: (id: string) => void }) {
  const user = w.currentUser;
  const today = new Date(w.serverTime).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const isOverdue = (task: Task) => {
    const execution = taskExecution(w, task);
    return deadlineState({ taskDueDate: task.dueDate, progress: execution.progress, runStatus: execution.run?.status, taskStatus: task.status, deletedAt: task.deletedAt }, today).overdue;
  };
  const isReviewer = user.role === 'head' || user.role === 'admin';
  const { tasks, inProgress, completed, notStarted, dueSoon } = dashboardTaskSummary(w);
  const pendingEvaluations = navBadges(w).performance || 0;
  const recent = [...tasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5);
  const scheduled = tasks.flatMap(task => task.workflow.filter(s => s.dueDate && s.dueDate >= today && !s.done).map(step => ({ task, step }))).sort((a, b) => (a.step.dueDate || '').localeCompare(b.step.dueDate || '')).slice(0, 4);
  const distributions = w.commonTasks.flatMap(c => c.distributions.map(d => ({ common: c, dist: d })));
  const needsAction = distributions.filter(({ dist: d }) => d.departmentId === user.departmentId && (user.role === 'manager' ? d.status === 'pending' : user.role === 'lead' ? d.leadId === user.id && d.status === 'team_assigned' : d.assigneeId === user.id && d.status === 'person_assigned')).length;
  const stats = [{ label: user.role === 'admin' ? '전체 세부업무' : isReviewer ? '부서 세부업무' : '나의 세부업무', value: tasks.length, detail: user.role === 'admin' ? '전체 부서의 활성 세부업무' : isReviewer ? '우리 부서의 활성 세부업무' : '단위업무에 연결된 실행 과제', accent: 'brand', icon: FolderOpen, view: 'personal' }, { label: '진행 중인 업무', value: inProgress.length, detail: `시작 전 ${notStarted}건 · 완료 ${completed}건`, accent: 'blue', icon: GitBranch, view: 'personal' }, { label: '7일 이내 마감', value: dueSoon.length, detail: '앞으로 7일 이내 마감 업무', accent: 'coral', icon: CalendarDays, view: 'schedule' }, { label: isReviewer ? '평가 대기' : '배정받은 공통업무', value: isReviewer ? pendingEvaluations : needsAction, detail: isReviewer ? '제출된 개인별 반기 성과를 평가해 주세요' : '다음 단계로 연결해 주세요', accent: 'neutral', icon: isReviewer ? ShieldCheck : CheckCheck, view: isReviewer ? 'performance' : user.role === 'manager' ? 'allocation' : 'common' }];
  return <>
    <div className="page-heading dashboard-heading"><div><p className="eyebrow">한눈에 보는 나의 워크스페이스</p><h1>{user.name}님, 반갑습니다.</h1><p>오늘의 일을 차분히 살펴보고, 다음 단계를 이어가세요.</p></div><div className="date-pill"><CalendarDays size={16}/>{new Date(w.serverTime).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' })}</div></div>
    <section className="stats-grid" aria-label="업무 요약">{stats.map(({ label, value, detail, icon: Icon, view, accent }) => <button className="stat-card" data-accent={accent} key={label} onClick={() => navigate(view as View)}><div><span>{label}</span><Icon size={19} strokeWidth={1.5}/></div><strong>{value}<small>건</small></strong><p>{detail}<ArrowUpRight size={14}/></p></button>)}</section>
    <div className="dashboard-grid"><section className="panel task-overview"><div className="panel-header"><div><p className="eyebrow">차근차근, 하나씩</p><h2>{user.role === 'admin' ? '전체 업무 살펴보기' : isReviewer ? '부서 업무 살펴보기' : '이어갈 업무'}</h2></div><TextLink onClick={() => navigate('personal')}>전체 보기</TextLink></div>
      <div className="dashboard-task-list">{recent.length ? recent.map(task => <button className="dashboard-task" data-kind={task.commonId ? "common" : "personal"} key={task.id} onClick={() => onOpenTask(task.id)}><span className="task-square"><FileText size={20} strokeWidth={1.45}/></span><div className="dashboard-task-info"><span>{task.commonId ? '공통업무' : '개인업무'}<i/>{w.units.find(u => u.id === task.unitId)?.title}</span><h3>{task.title}</h3><div><Progress value={taskProgress(task, w)}/><small>{taskProgress(task, w)}%</small></div></div><div className="dashboard-task-date"><Badge tone={isOverdue(task) ? 'warning' : taskProgress(task, w) === 100 ? 'success' : 'soft'}>{isOverdue(task) ? '기한 경과' : formatDate(task.dueDate, { today: w.serverTime }) + ' 마감'}</Badge><ChevronRight size={16}/></div></button>) : <EmptyState title="새로운 업무의 시작." description="단위업무를 만들고 첫 세부업무를 등록해 보세요." action={<Button onClick={() => navigate('personal')}>개인업무로 이동 <ArrowRight size={16}/></Button>}/>}</div>
    </section><section className="panel upcoming-panel"><div className="panel-header"><div><p className="eyebrow">다가오는 일정</p><h2>다음 할 일</h2></div><button className="icon-btn" aria-label="전체 일정 보기" onClick={() => navigate('schedule')}><ArrowUpRight size={19}/></button></div>{scheduled.length ? <div className="upcoming-list">{scheduled.map(({ task, step }, i) => <button key={task.id + step.id} className="upcoming-item" onClick={() => onOpenTask(task.id)}><div className="timeline-point"><span className={i === 0 ? 'current' : ''}/>{i < scheduled.length - 1 && <i/>}</div><div><span className="upcoming-date">{formatDate(step.dueDate, { today: w.serverTime })}<i/>업무 절차</span><h3>{step.title}</h3><p>{task.title}</p></div></button>)}</div> : <EmptyState title="여유롭게 계획해 보세요." description="세부업무에 절차별 일정을 등록하면 이곳에서 확인할 수 있어요."/>}<button className="calendar-link" onClick={() => navigate('schedule')}><CalendarDays size={17}/>일정에서 한눈에 보기<ArrowRight size={16}/></button></section></div>
    <div className="dashboard-bottom"><section className="flow-callout"><span className="flow-callout-icon"><GitBranch size={31} strokeWidth={1.3}/></span><div><p className="eyebrow">함께하는 일도, 매끄럽게.</p><h2>공통업무의 흐름을 이어보세요.</h2><p>업무 담당자가 작성하고 부서장이 승인하면, 대상 부서에서 팀과 담당자를 배정합니다.</p><div className="flow-chips"><span>업무 담당자 작성</span><ArrowRight size={13}/><span>부서장 승인</span><ArrowRight size={13}/><span>대상 부서</span><ArrowRight size={13}/><span>팀</span><ArrowRight size={13}/><span>개인</span></div></div><Button variant="secondary" onClick={() => navigate('common')}>공통업무 보기 <ArrowUpRight size={16}/></Button></section></div>
    <section className="activity-section"><div className="section-title"><h2>최근의 기록</h2><span className="muted">업무의 변화가 차곡차곡 쌓입니다.</span></div><div className="activity-list">{w.audit.slice(0, 3).map(event => <div className="activity-row" key={event.id}><span className="activity-icon"><Clock3 size={16}/></span><p><b>{event.title}</b><span>{event.detail}</span></p><time>{formatDateTimeFull(event.createdAt)}</time></div>)}{!w.audit.length && <p className="muted">{tasks.length ? '아직 기록된 활동이 없습니다. 업무를 수정하거나 절차를 진행하면 이곳에 표시됩니다.' : '첫 업무를 등록하면 이곳에 활동 기록이 표시됩니다.'}</p>}</div></section>
  </>;
}

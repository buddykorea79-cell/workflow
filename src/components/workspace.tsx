'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeftRight, ArrowRight, ArrowUpRight, Bell, Building2, CalendarDays, Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, FileText, FolderOpen, GitBranch, LayoutDashboard, LoaderCircle, LogOut, Menu, Search, Settings2, ShieldCheck, Sparkles, UserRound, Users, X } from 'lucide-react';
import type { Department, Task, User, Workspace as WorkspaceData } from '@/lib/types';
import { Badge, Brand, Button, EmptyState, Modal, Progress, TextLink, formatDate, roleLabels, type CommandFn } from './ui';
import { PersonalWork, ScheduleView, TaskPanel, taskProgress } from './personal-work';
import { AdminView, CommonWork, OrganizationView, PerformanceView } from './management';
import { DepartmentDashboard, DepartmentWork } from './department-work';
import { AllocationReview } from './allocation-review';
import { demoCandidates, demoDefaultDepartment, selectDemoUser, type DemoRole } from '@/lib/demo-login';
import { canReviewCommon } from '@/lib/common-approval';
import { LandingGuide, UsageGuide, type GuideSection } from './usage-guide';
import type { GuideRole } from '@/lib/usage-guide';
import { PersonnelHandover } from './personnel-handover';
import { DelegationWork } from './delegation-work';
import { OrganizationDivision } from './organization-division';
import './workspace-directory.css';

type View = 'dashboard' | 'personal' | 'department' | 'allocation' | 'division' | 'delegation' | 'common' | 'schedule' | 'performance' | 'handover' | 'organization' | 'admin';
const titles: Record<View, string> = { dashboard: '업무 홈', personal: '개인업무', department: '부서 업무 관리', division: '전 부서 업무분장표', delegation: '업무대행', allocation: '배부·승인 관리', common: '공통업무 · 지시사항', schedule: '업무 일정', performance: '성과 · 평가', handover: '인수인계', organization: '조직 · 구성원', admin: '관리자' };
const navItems = [{ id: 'dashboard', icon: LayoutDashboard }, { id: 'personal', icon: FolderOpen }, { id: 'department', icon: Users }, { id: 'common', icon: GitBranch }, { id: 'schedule', icon: CalendarDays }, { id: 'performance', icon: CheckCheck }, { id: 'handover', icon: ArrowLeftRight }, { id: 'delegation', icon: UserRound }] as const;
const demoRoles = [{ id: 'member', label: '업무 담당자', icon: UserRound }, { id: 'lead', label: '팀장', icon: Users }, { id: 'manager', label: '부서 담당자', icon: Building2 }, { id: 'head', label: '부서장', icon: ShieldCheck }, { id: 'admin', label: '관리자', icon: Settings2 }];

function DemoLogin({ users, departments, busy, error, onLogin }: { users: User[]; departments: Department[]; busy: boolean; error: string; onLogin: (id: string) => void }) {
  const [role, setRole] = useState<DemoRole>('member');
  const [departmentId, setDepartmentId] = useState(demoDefaultDepartment('member'));
  const [selectedId, setSelectedId] = useState('');
  const availableDepartmentId = departments.some(department => department.id === departmentId) ? departmentId : departments[0]?.id || departmentId;
  const available = demoCandidates(users, role, availableDepartmentId);
  const selected = selectDemoUser(available, role, selectedId);
  const selectedDepartmentId = selected?.departmentId || availableDepartmentId;
  return <div className="login-card" id="login">
    <div className="login-card-intro"><span className="login-icon"><ArrowUpRight size={23}/></span><Badge>시연용 워크스페이스</Badge></div>
    <h2>온이음 시작하기.</h2><p className="login-description">{departments.length === 1 ? '현재 부서의 계정으로 역할을 바꾸며 업무 흐름을 확인하세요.' : '데이터정보화담당관실 직원 중심의 시연입니다. 다른 부서도 선택할 수 있습니다.'}</p>
    <fieldset className="role-picker"><legend>어떤 역할로 시작할까요?</legend><div>{demoRoles.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={role === id ? 'role-option selected' : 'role-option'} aria-pressed={role === id} onClick={() => { const nextRole = id as DemoRole; const defaultDepartment = demoDefaultDepartment(nextRole); setRole(nextRole); setDepartmentId(departments.some(department => department.id === defaultDepartment) ? defaultDepartment : departments[0]?.id || defaultDepartment); setSelectedId(''); }}><Icon size={18} strokeWidth={1.65}/><span>{label}</span>{role === id && <Check size={13} className="role-check"/>}</button>)}</div></fieldset>
    <div className="login-selects"><label className="field"><span>부서</span><select aria-label="로그인 부서" value={selectedDepartmentId} onChange={e => { setDepartmentId(e.target.value); setSelectedId(''); }}>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label className="field"><span>시연 계정</span><select aria-label="시연 계정" value={selected?.id || ''} onChange={e => setSelectedId(e.target.value)}>{!available.length && <option value="">해당 역할의 계정이 없습니다</option>}{available.map(u => <option key={u.id} value={u.id}>{u.name} · {u.team} · {u.title}</option>)}</select></label></div>
    {selected && <div className="login-person"><span className="avatar">{selected.name.slice(0, 1)}</span><div><strong>{selected.name}</strong><span>{departments.find(d => d.id === selected.departmentId)?.name} · {selected.team}</span></div><span className="person-id">{selected.id}</span></div>}
    {error && <p role="alert" className="form-error">{error}</p>}
    <Button className="login-submit" disabled={busy || !selected} onClick={() => selected && onLogin(selected.id)}>{busy ? <LoaderCircle className="spin" size={18}/> : <><span>{selected ? selected.name + ' 계정으로 시작하기' : '계정 불러오는 중'}</span><ArrowRight size={18}/></>}</Button>
    <p className="login-footnote">비밀번호 없이 체험할 수 있는 가상 계정입니다.</p>
  </div>;
}

function Landing(props: Parameters<typeof DemoLogin>[0]) {
  const [guide, setGuide] = useState<{ section: GuideSection; role?: GuideRole } | null>(null);
  return <div className="landing">
    <header className="landing-nav"><a href="/" aria-label="온이음 홈"><Brand/></a><span className="landing-nav-copy">일과 사람, 그 사이를 잇다.</span><div className="landing-nav-actions"><button type="button" className="btn btn-secondary landing-guide-button" onClick={() => setGuide({ section: 'start' })}><CircleHelp size={16}/>온이음 사용 안내</button><a href="#login" className="btn btn-primary">시작하기 <ArrowUpRight size={16}/></a></div></header>
    <main className="landing-main">
      <section className="landing-hero"><p className="hero-eyebrow"><span className="tiny-mark"/>공공업무를 위한 하나의 워크스페이스</p><h1>일은 명확하게.<br/>흐름은 자연스럽게.</h1><p className="hero-description">흩어진 업무를 정리하고, 함께하는 일을 연결합니다.<br className="desktop-break"/>계획부터 실행, 성과까지. 업무의 모든 순간을 온이음에서.</p>
        <div className="hero-flow"><div><span><FolderOpen size={24} strokeWidth={1.4}/></span><b>업무를 정리하고</b><small>단위업무 · 세부업무</small></div><i/><div><span><GitBranch size={24} strokeWidth={1.4}/></span><b>함께 실행하고</b><small>부서 · 팀 · 개인 연결</small></div><i/><div><span><CheckCheck size={24} strokeWidth={1.4}/></span><b>성과로 이어집니다</b><small>반기별 기록 · 평가</small></div></div>
      </section>
      <DemoLogin {...props}/>
    </main>
    <LandingGuide onOpen={(section, role) => setGuide({ section, role })}/>
    <footer className="landing-footer"><Brand inverse/><p>업무의 맥락이 쌓이고, 조직의 다음이 이어집니다.</p><span>온이음 워크스페이스 <i/> v0.7.0</span></footer>
    {guide && <UsageGuide initialSection={guide.section} initialRole={guide.role} onClose={() => setGuide(null)}/>}
  </div>;
}

export default function Workspace() {
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [view, setView] = useState<View>('dashboard');
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [help, setHelp] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const currentRef = useRef(workspace); currentRef.current = workspace;
  const locked = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const loadSession = useCallback(async () => {
    const response = await fetch('/api/session', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '계정을 불러올 수 없습니다.');
    setUsers(result.users || []); setDepartments(result.departments || []);
  }, []);

  const loadWorkspace = useCallback(async () => {
    const response = await fetch('/api/workspace', { cache: 'no-store' });
    if (response.status === 401) { setWorkspace(null); return; }
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || '워크스페이스를 불러오지 못했습니다.');
    setWorkspace(body);
  }, []);

  useEffect(() => {
    Promise.allSettled([
      loadSession(),
      loadWorkspace(),
    ]).then(results => { for (const result of results) if (result.status === 'rejected') setLoginError(result.reason instanceof Error ? result.reason.message : '연결을 확인해 주세요.'); setLoading(false); });
    const onHash = () => { const hash = location.hash.slice(1) as View; if (titles[hash]) setView(hash); };
    onHash();
    const onKey = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'k') { event.preventDefault(); searchRef.current?.focus(); setSearchOpen(true); } if (event.key === 'Escape') { setSearchOpen(false); setNotifications(false); setMobileMenu(false); } };
    window.addEventListener('hashchange', onHash); window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('keydown', onKey); };
  }, [loadWorkspace, loadSession]);

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), notice.error ? 10000 : 4500); return () => clearTimeout(timer); }, [notice]);

  const command: CommandFn = async (type, payload) => {
    if (type === 'workspace.refresh') {
      try { await loadWorkspace(); return true; }
      catch (error) { setNotice({ text: error instanceof Error ? error.message : '최신 정보를 불러오지 못했습니다.', error: true }); return false; }
    }
    if (!currentRef.current || locked.current) return false;
    locked.current = true; setBusy(true);
    try {
      const response = await fetch('/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, payload, expectedRevision: currentRef.current.revision, requestId: crypto.randomUUID() }) });
      const result = await response.json();
      if (!response.ok) { if (response.status === 409) await loadWorkspace(); if (response.status === 401) setWorkspace(null); throw new Error(result.error || '요청을 처리하지 못했습니다.'); }
      currentRef.current = result; setWorkspace(result); setNotice({ text: '변경 내용을 저장했습니다.' });
      if (type.startsWith('organization.user') || type === 'organization.departmentCreate') {
        setUsers([]); setDepartments([]);
        try { await loadSession(); }
        catch { setNotice({ text: '변경은 저장했습니다. 시연 계정 목록을 새로 불러오려면 화면을 새로고침해 주세요.', error: true }); }
      }
      return true;
    } catch (error) { setNotice({ text: error instanceof Error ? error.message : '저장하지 못했습니다.', error: true }); return false; }
    finally { locked.current = false; setBusy(false); }
  };

  const navigate = (next: View) => { setView(next); window.location.hash = next; setMobileMenu(false); setSearchOpen(false); setNotifications(false); window.scrollTo({ top: 0, behavior: 'instant' }); };
  const openTask = (taskId: string) => { setSelectedTask(taskId); setSearchOpen(false); };
  const login = async (userId: string) => {
    if (locked.current) return; locked.current = true; setBusy(true); setLoginError('');
    try {
      const response = await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || '로그인하지 못했습니다.');
      setWorkspace(result); currentRef.current = result; setSwitching(false); setSelectedTask(null); navigate('dashboard');
      setUsers([]); setDepartments([]); await loadSession();
    } catch (error) { setLoginError(error instanceof Error ? error.message : '로그인 오류'); }
    finally { locked.current = false; setBusy(false); }
  };
  const logout = async () => {
    if (locked.current) return; setBusy(true);
    try { const response = await fetch('/api/session', { method: 'DELETE' }); if (!response.ok) throw new Error('로그아웃하지 못했습니다.'); setWorkspace(null); currentRef.current = null; setSelectedTask(null); setSearch(''); setSearchOpen(false); setNotifications(false); setUsers([]); setDepartments([]); location.hash = ''; await loadSession(); }
    catch (error) { setNotice({ text: (error as Error).message, error: true }); } finally { setBusy(false); }
  };

  if (loading) return <div className="boot-screen"><Brand/><span className="loading-line"/><p>업무의 흐름을 준비하고 있습니다.</p></div>;
  if (!workspace) return <Landing users={users} departments={departments} busy={busy} error={loginError} onLogin={login}/>;
  const user = workspace.currentUser;
  const department = workspace.departments.find(d => d.id === user.departmentId);
  const isAdmin = user.role === 'admin';
  const isHead = user.role === 'head';
  const canAllocate = user.role === 'manager' || isAdmin;
  const safeView = view === 'admin' && !isAdmin || view === 'allocation' && !canAllocate ? 'dashboard' : isHead && view === 'personal' ? 'department' : view === 'department' && !isHead && !isAdmin ? 'division' : view;
  const visibleNav = navItems.filter(item => (!isHead || item.id !== 'personal') && (item.id !== 'department' || isHead || isAdmin)).flatMap<{ id: View; icon: typeof FolderOpen }>(item => item.id === 'common' && canAllocate ? [item, { id: 'allocation', icon: ShieldCheck }] : [item]);
  const pending = isHead ? workspace.commonTasks.flatMap(common => (common.approvalRequests || []).filter(request => canReviewCommon(workspace, user, common, request, new Date(workspace.serverTime)))).length : workspace.commonTasks.flatMap(c => c.distributions).filter(d => d.status !== 'submitted' && (canAllocate ? d.departmentId === user.departmentId && d.status === 'pending' : user.role === 'lead' ? d.leadId === user.id && d.status === 'team_assigned' : d.assigneeId === user.id && d.status === 'person_assigned')).length;
  const results = workspace.tasks.filter(t => !t.deletedAt && (t.title + ' ' + t.description + ' ' + t.code).toLowerCase().includes(search.toLowerCase())).slice(0, 7);
  return <div className="app-shell">
    {mobileMenu && <button className="sidebar-scrim" aria-label="메뉴 닫기" onClick={() => setMobileMenu(false)}/>}
    <aside className={'sidebar ' + (mobileMenu ? 'sidebar-open' : '')}>
      <button className="brand-button" onClick={() => navigate('dashboard')} aria-label="업무 홈"><Brand/></button>
      <button className="org-switch" onClick={() => navigate('organization')}><span className="org-symbol"><Building2 size={19}/></span><span><b>우리의 워크스페이스</b><small>{department?.name}</small></span><ChevronRight size={14}/></button>
      <p className="nav-group-label">워크스페이스</p><nav aria-label="주 메뉴">{visibleNav.map(({ id, icon: Icon }) => <button key={id} className={'nav-item ' + (safeView === id ? 'active' : '')} aria-current={safeView === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={19} strokeWidth={1.65}/><span>{titles[id]}</span>{id === (canAllocate ? 'allocation' : 'common') && pending > 0 && <b className="nav-count">{pending}</b>}</button>)}</nav>
      <div className="sidebar-tail"><button className={'nav-item ' + (safeView === 'organization' ? 'active' : '')} onClick={() => navigate('organization')}><Users size={19} strokeWidth={1.65}/><span>조직 · 구성원</span></button>{isAdmin && <button className={'nav-item ' + (safeView === 'admin' ? 'active' : '')} onClick={() => navigate('admin')}><Settings2 size={19} strokeWidth={1.65}/><span>관리자</span><span className="nav-version">v0.7</span></button>}<button className="nav-item" onClick={() => setHelp(true)}><CircleHelp size={19} strokeWidth={1.65}/><span>온이음 사용 안내</span></button>
        <div className="demo-note"><span/><div><strong>시연 워크스페이스</strong><small>역할을 바꾸며 흐름을 확인하세요.</small></div></div>
        <button className="profile-button" onClick={() => { setLoginError(''); setSwitching(true); }}><span className="avatar">{user.name.slice(0, 1)}</span><span><b>{user.name}</b><small>{roleLabels[user.role]}</small></span><ChevronDown size={16}/></button>
      </div>
    </aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-btn mobile-toggle" aria-label="메뉴 열기" onClick={() => setMobileMenu(true)}><Menu size={20}/></button><span>워크스페이스</span><ChevronRight size={14}/><b>{titles[safeView]}</b></div><div className="topbar-actions"><div className="search-box"><Search size={17}/><input ref={searchRef} aria-label="업무 검색" placeholder="업무를 검색하세요" value={search} onFocus={() => setSearchOpen(true)} onChange={e => { setSearch(e.target.value); setSearchOpen(true); }}/><kbd>Ctrl K</kbd>
      {searchOpen && <><button className="popover-dismiss" aria-label="검색 닫기" onClick={() => setSearchOpen(false)}/><div className="search-popover"><div className="popover-heading"><b>{search ? '검색 결과' : '최근 업무'}</b><button className="icon-btn" aria-label="검색 닫기" onClick={() => setSearchOpen(false)}><X size={16}/></button></div>{results.map(task => <button className="search-result" key={task.id} onClick={() => openTask(task.id)}><FileText size={18}/><span><strong>{task.title}</strong><small>{task.code} · {workspace.units.find(u => u.id === task.unitId)?.title}</small></span><ArrowUpRight size={15}/></button>)}{!results.length && <p className="search-empty">일치하는 업무가 없습니다.</p>}</div></>}</div>
      <button type="button" className={"topbar-directory " + (safeView === "division" ? "active" : "")} onClick={() => navigate("division")}><Users size={17}/><span>업무분장표</span></button>
      <button className="icon-btn bell-button" aria-label="알림" onClick={() => setNotifications(!notifications)}><Bell size={19}/>{workspace.notifications.some(n => !n.read) && <i/>}</button><span className="topbar-rule"/><button className="session-button" aria-label="역할 전환" onClick={() => { setLoginError(''); setSwitching(true); }}><UserRound size={16}/><span>역할 전환</span></button><button className="icon-btn" aria-label="로그아웃" disabled={busy} onClick={logout}><LogOut size={18}/></button></div>
      {notifications && <div className="notification-popover"><div className="popover-heading"><b>알림</b><button className="text-link" onClick={() => command('notification.read', { all: true })}>모두 읽음</button></div>{workspace.notifications.length ? workspace.notifications.map(n => <button className="notification-row" key={n.id} onClick={async () => { await command('notification.read', { notificationId: n.id }); setNotifications(false); if (n.type === 'handover') navigate('handover'); else if (workspace.tasks.some(t => t.id === n.targetId)) openTask(n.targetId); else navigate('common'); }}><span className={'notification-dot ' + (n.read ? 'read' : '')}/><span><b>{n.title}</b><small>{n.description}</small></span></button>) : <p className="search-empty">새로운 알림이 없습니다.</p>}</div>}
      </header>
      <main className="main-content" aria-busy={busy}>
        {safeView === 'dashboard' && (isHead ? <DepartmentDashboard key={user.id} workspace={workspace} command={command} onOpenTask={openTask} onRefresh={loadWorkspace} onManage={() => navigate('department')} onEvaluate={() => navigate('performance')}/> : <Dashboard workspace={workspace} navigate={navigate} onOpenTask={openTask}/>)}
        {safeView === 'personal' && <PersonalWork key={user.id} workspace={workspace} command={command} onOpenTask={openTask} onWorkspace={setWorkspace}/>}
        {safeView === 'department' && <DepartmentWork key={user.id} workspace={workspace} command={command} onOpenTask={openTask} onRefresh={loadWorkspace}/>}
        {safeView === 'division' && <OrganizationDivision key={user.id} workspace={workspace} onRefresh={loadWorkspace}/>}
        {safeView === 'delegation' && <DelegationWork key={user.id} workspace={workspace} command={command} onOpenTask={openTask}/>}
        {safeView === 'allocation' && <AllocationReview key={user.id} workspace={workspace} command={command} onOpenCommon={() => navigate('common')} onOpenHandover={() => navigate('handover')} onOpenDivision={() => navigate('division')}/>}
        {safeView === 'common' && <CommonWork key={user.id} workspace={workspace} command={command} onOpenTask={openTask} onRefresh={loadWorkspace} onGoPersonal={() => navigate('personal')}/>}
        {safeView === 'schedule' && <ScheduleView key={user.id} workspace={workspace} command={command} onOpenTask={openTask}/>}
        {safeView === 'performance' && <PerformanceView key={user.id} workspace={workspace} command={command} onOpenTask={openTask}/>}
        {safeView === 'handover' && <PersonnelHandover key={user.id} workspace={workspace} command={command} busy={busy} onOpenTask={openTask}/>}
        {safeView === 'organization' && <OrganizationView key={user.id} workspace={workspace} command={command}/>}
        {safeView === 'admin' && <AdminView workspace={workspace} command={command}/>}
      </main>
      <footer className="workspace-footer"><span>온이음 · 업무의 흐름을 잇다.</span><span>{workspace.mode === 'local' ? '로컬에 안전하게 저장 중' : '연결된 데이터베이스'}<i/>v0.7.0</span></footer>
    </div>
    {busy && <div className="saving-indicator"><LoaderCircle size={15} className="spin"/>저장 중</div>}
    {notice && <div className={'toast ' + (notice.error ? 'toast-error' : '')} role={notice.error ? 'alert' : 'status'}><span>{notice.error ? '요청을 확인해 주세요' : <Check size={17}/>}</span><p>{notice.text}</p><button className="icon-btn" aria-label="메시지 닫기" onClick={() => setNotice(null)}><X size={16}/></button></div>}
    {selectedTask && <TaskPanel key={selectedTask + user.id} workspace={workspace} taskId={selectedTask} initialMode="view" command={command} onWorkspace={setWorkspace} onClose={() => setSelectedTask(null)}/>}
    {switching && <Modal title="다른 역할로 둘러보기" description="다른 부서 시연은 로그아웃 후 첫 화면에서 선택하세요." onClose={() => setSwitching(false)}><DemoLogin users={users} departments={departments} busy={busy} error={loginError} onLogin={login}/></Modal>}
    {help && <UsageGuide initialRole={user.role} initialSection="roles" onClose={() => setHelp(false)}/> }
  </div>;
}

function Dashboard({ workspace: w, navigate, onOpenTask }: { workspace: WorkspaceData; navigate: (view: View) => void; onOpenTask: (id: string) => void }) {
  const user = w.currentUser;
  const registered = (task: Task) => {
    const distribution = w.commonTasks.find(c => c.id === task.commonId)?.distributions.find(d => d.taskId === task.id);
    return !distribution || ['registered', 'assigned', 'submitted'].includes(distribution.status);
  };
  const own = w.tasks.filter(t => t.primaryId === user.id && t.status !== 'archived' && registered(t));
  const today = new Date(w.serverTime).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const isReviewer = user.role === 'head' || user.role === 'admin';
  const tasks = isReviewer ? w.tasks.filter(t => t.status !== 'archived' && registered(t)) : own;
  const inProgress = tasks.filter(t => taskProgress(t, w) < 100);
  const completed = tasks.length - inProgress.length;
  const dueSoon = inProgress.filter(t => t.dueDate >= today && (new Date(t.dueDate).getTime() - new Date(today).getTime()) / 86400000 <= 7);
  const pendingEvaluations = (w.unitScorePlans || []).filter(plan => plan.submittedAt && (user.role === 'admin' || plan.departmentId === user.departmentId) && !(w.unitEvaluations || []).some(evaluation => evaluation.personId === plan.personId && evaluation.period === plan.period)).length;
  const recent = [...tasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 5);
  const scheduled = tasks.flatMap(task => task.workflow.filter(s => s.dueDate && s.dueDate >= today && !s.done).map(step => ({ task, step }))).sort((a, b) => (a.step.dueDate || '').localeCompare(b.step.dueDate || '')).slice(0, 4);
  const distributions = w.commonTasks.flatMap(c => c.distributions.map(d => ({ common: c, dist: d })));
  const needsAction = distributions.filter(({ dist: d }) => d.departmentId === user.departmentId && (user.role === 'manager' ? d.status === 'pending' : user.role === 'lead' ? d.leadId === user.id && d.status === 'team_assigned' : d.assigneeId === user.id && d.status === 'person_assigned')).length;
  const stats = [{ label: isReviewer ? '부서 세부업무' : '나의 세부업무', value: tasks.length, detail: '단위업무에 연결된 실행 과제', accent: 'brand', icon: FolderOpen, view: 'personal' }, { label: '진행 중인 업무', value: inProgress.length, detail: completed + '개 업무를 완료했어요', accent: 'blue', icon: GitBranch, view: 'personal' }, { label: '이번 주 마감', value: dueSoon.length, detail: '앞으로 7일 이내 마감 업무', accent: 'coral', icon: CalendarDays, view: 'schedule' }, { label: isReviewer ? '평가 대기' : '배정받은 공통업무', value: isReviewer ? pendingEvaluations : needsAction, detail: isReviewer ? '제출된 개인별 반기 성과를 평가해 주세요' : '다음 단계로 연결해 주세요', accent: 'neutral', icon: isReviewer ? ShieldCheck : CheckCheck, view: isReviewer ? 'performance' : user.role === 'manager' ? 'allocation' : 'common' }];
  return <>
    <div className="page-heading dashboard-heading"><div><p className="eyebrow">한눈에 보는 나의 워크스페이스</p><h1>{user.name}님, 반갑습니다.</h1><p>오늘의 일을 차분히 살펴보고, 다음 단계를 이어가세요.</p></div><div className="date-pill"><CalendarDays size={16}/>{new Date(w.serverTime).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' })}</div></div>
    <section className="stats-grid" aria-label="업무 요약">{stats.map(({ label, value, detail, icon: Icon, view, accent }) => <button className="stat-card" data-accent={accent} key={label} onClick={() => navigate(view as View)}><div><span>{label}</span><Icon size={19} strokeWidth={1.5}/></div><strong>{String(value).padStart(2, '0')}<small>건</small></strong><p>{detail}<ArrowUpRight size={14}/></p></button>)}</section>
    <div className="dashboard-grid"><section className="panel task-overview"><div className="panel-header"><div><p className="eyebrow">차근차근, 하나씩</p><h2>{isReviewer ? '부서 업무 살펴보기' : '이어갈 업무'}</h2></div><TextLink onClick={() => navigate('personal')}>전체 보기</TextLink></div>
      <div className="dashboard-task-list">{recent.length ? recent.map(task => <button className="dashboard-task" data-kind={task.commonId ? "common" : "personal"} key={task.id} onClick={() => onOpenTask(task.id)}><span className="task-square"><FileText size={20} strokeWidth={1.45}/></span><div className="dashboard-task-info"><span>{task.commonId ? '공통업무' : '개인업무'}<i/>{w.units.find(u => u.id === task.unitId)?.title}</span><h3>{task.title}</h3><div><Progress value={taskProgress(task, w)}/><small>{taskProgress(task, w)}%</small></div></div><div className="dashboard-task-date"><Badge tone={task.dueDate < today && taskProgress(task, w) < 100 ? 'warning' : taskProgress(task, w) === 100 ? 'success' : 'soft'}>{task.dueDate < today && taskProgress(task, w) < 100 ? '기한 경과' : formatDate(task.dueDate) + ' 마감'}</Badge><ChevronRight size={16}/></div></button>) : <EmptyState title="새로운 업무의 시작." description="단위업무를 만들고 첫 세부업무를 등록해 보세요." action={<Button onClick={() => navigate('personal')}>개인업무로 이동 <ArrowRight size={16}/></Button>}/>}</div>
    </section><section className="panel upcoming-panel"><div className="panel-header"><div><p className="eyebrow">다가오는 일정</p><h2>다음 할 일</h2></div><button className="icon-btn" aria-label="전체 일정 보기" onClick={() => navigate('schedule')}><ArrowUpRight size={19}/></button></div>{scheduled.length ? <div className="upcoming-list">{scheduled.map(({ task, step }, i) => <button key={task.id + step.id} className="upcoming-item" onClick={() => onOpenTask(task.id)}><div className="timeline-point"><span className={i === 0 ? 'current' : ''}/>{i < scheduled.length - 1 && <i/>}</div><div><span className="upcoming-date">{formatDate(step.dueDate!)}<i/>업무 절차</span><h3>{step.title}</h3><p>{task.title}</p></div></button>)}</div> : <EmptyState title="여유롭게 계획해 보세요." description="세부업무에 절차별 일정을 등록하면 이곳에서 확인할 수 있어요."/>}<button className="calendar-link" onClick={() => navigate('schedule')}><CalendarDays size={17}/>일정에서 한눈에 보기<ArrowRight size={16}/></button></section></div>
    <div className="dashboard-bottom"><section className="flow-callout"><span className="flow-callout-icon"><GitBranch size={31} strokeWidth={1.3}/></span><div><p className="eyebrow">함께하는 일도, 매끄럽게.</p><h2>공통업무의 흐름을 이어보세요.</h2><p>업무 담당자가 작성하고 부서장이 승인하면, 대상 부서에서 팀과 담당자를 배정합니다.</p><div className="flow-chips"><span>업무 담당자 작성</span><ArrowRight size={13}/><span>부서장 승인</span><ArrowRight size={13}/><span>대상 부서</span><ArrowRight size={13}/><span>팀</span><ArrowRight size={13}/><span>개인</span></div></div><Button variant="secondary" onClick={() => navigate('common')}>공통업무 보기 <ArrowUpRight size={16}/></Button></section></div>
    <section className="activity-section"><div className="section-title"><h2>최근의 기록</h2><span className="muted">업무의 변화가 차곡차곡 쌓입니다.</span></div><div className="activity-list">{w.audit.slice(0, 3).map(event => <div className="activity-row" key={event.id}><span className="activity-icon"><Clock3 size={16}/></span><p><b>{event.title}</b><span>{event.detail}</span></p><time>{formatDate(event.createdAt)}</time></div>)}{!w.audit.length && <p className="muted">첫 업무를 등록하면 이곳에 활동 기록이 표시됩니다.</p>}</div></section>
  </>;
}

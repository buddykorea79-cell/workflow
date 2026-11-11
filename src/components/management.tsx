'use client';
import { formatDateFull as day, formatDateTimeFull } from '@/lib/date-format';
import { auditDetailText } from '@/lib/audit-format';

import { createLazyScreen } from './lazy-screen';

import { useState } from 'react';
import { ArrowRight, ArrowUpRight, Building2, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronRight, ClipboardCheck, FileText, GitBranch, Layers3, ListChecks, Plus, Search, Send, ShieldCheck, Users } from 'lucide-react';
import type { CommonTask, CommonDistribution, Performance, User, Workspace } from '@/lib/types';
import { Badge, Button, EmptyState, Field, Modal, Progress, Tabs, useTabs, type CommandFn } from './ui';
import './management.css';
import { OrganizationEditor } from './organization-editor';
import { DefaultDeputyEditor, defaultDeputyLabel, defaultDeputyNotice } from './default-deputy-editor';
import { useNotificationFocus } from './notification-focus';
import { useUnsavedNavigation } from './unsaved-changes';
import { isOrganizationUserActive } from '@/lib/organization-management';
import { APP_VERSION } from '@/lib/app-version';

const integrationsScreen = createLazyScreen(() => import('./admin-integrations').then(module => module.AdminIntegrations), { label: '연결·테스트', kind: 'section' });
const budgetScreen = createLazyScreen(() => import('./admin-budget-catalog').then(module => module.AdminBudgetCatalog), { label: '예산 관리', kind: 'section' });
const AdminIntegrations = integrationsScreen.Component;
const AdminBudgetCatalog = budgetScreen.Component;
AdminIntegrations.displayName = 'AdminIntegrations';
AdminBudgetCatalog.displayName = 'AdminBudgetCatalog';

type Props = { workspace: Workspace; command: CommandFn };
type TaskProps = Props & { onOpenTask: (id: string) => void };

const roleNames: Record<User['role'], string> = { admin: '시스템 관리자', head: '부서장', manager: '부서 담당자', lead: '팀장', member: '업무 담당자' };
const stages: Record<CommonDistribution['status'], string> = { pending: '부서 접수', team_assigned: '팀 배정 완료', person_assigned: '개인 등록 대기', registered: '수행 중', assigned: '수행 중', submitted: '완료' };
const stageIndex: Record<CommonDistribution['status'], number> = { pending: 0, team_assigned: 1, person_assigned: 2, registered: 3, assigned: 3, submitted: 4 };
const deptName = (w: Workspace, id: string) => w.departments.find(d => d.id === id)?.name || '부서';
const userName = (w: Workspace, id?: string) => w.users.find(user => user.id === id)?.name || '미배정';



export function OrganizationView({ workspace: w, command, focusId, focusToken }: Props & { focusId?: string; focusToken?: number }) {
  const isAdmin = w.currentUser.role === 'admin';
  const [departmentId, setDepartmentId] = useState(isAdmin ? 'all' : w.currentUser.departmentId);
  const [role, setRole] = useState('all');
  const [query, setQuery] = useState('');
  const [profile, setProfile] = useState<User | null>(null);
  const [editor, setEditor] = useState<'department' | 'user' | User | null>(null);
  const [deputyEditor, setDeputyEditor] = useState<User | null>(null);
  const departments = w.departments.filter(department => isAdmin || department.id === w.currentUser.departmentId);
  const scopedUsers = w.users.filter(user => isAdmin || user.departmentId === w.currentUser.departmentId);
  const focusProps = useNotificationFocus(focusId, focusToken, id => {
    const user = scopedUsers.find(item => item.id === id);
    if (!user) return;
    setDepartmentId(user.departmentId); setRole('all'); setQuery('');
    setProfile(null); setEditor(null); setDeputyEditor(null);
    return `person:${user.id}`;
  });
  const selectedDepartment = isAdmin ? departmentId : w.currentUser.departmentId;
  const users = scopedUsers.filter(user => (selectedDepartment === 'all' || user.departmentId === selectedDepartment) && (role === 'all' || user.role === role) && `${user.name} ${user.id} ${user.email || ''} ${user.team} ${deptName(w, user.departmentId)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const visibleProfile = profile && scopedUsers.find(user => user.id === profile.id);
  const isTeamStaff = (user: User) => user.role !== 'head' && user.role !== 'admin';
  const teamOrder: Record<string, string[]> = { 'dept-plan': ['기획팀', '예산팀', '국회팀'], 'dept-support': ['정보기획팀', '데이터팀', '정보자원팀'], 'dept-innovation': ['혁신팀', '청년팀', '행정지원팀'] };
  const memberOrder: Record<User['role'], number> = { lead: 0, manager: 1, member: 2, head: 3, admin: 4 };
  return <div className="management-view"><div className="page-heading"><div><p className="eyebrow">조직과 구성원</p><h1>{isAdmin ? '부서별 조직과 구성원' : '우리 부서의 구성원'}</h1><p className="muted">{isAdmin ? '전체 부서의 구성원, 역할과 연락처를 부서별로 확인합니다.' : `${deptName(w, w.currentUser.departmentId)}의 구성원, 역할과 연락처를 확인합니다.`}</p></div><div className="organization-heading-actions"><Badge tone="outline"><Users size={14} />{isAdmin ? '전체 조직' : '내 부서'} · {scopedUsers.length}명</Badge>{isAdmin && <><Button variant="secondary" onClick={() => setEditor('department')}><Building2 size={16} />부서 등록</Button><Button onClick={() => setEditor('user')}><Plus size={16} />구성원 등록</Button></>}</div></div>
    {isAdmin ? <div className="management-department-cards">{departments.map((department, index) => <button className={selectedDepartment === department.id ? 'selected' : ''} key={department.id} onClick={() => setDepartmentId(selectedDepartment === department.id ? 'all' : department.id)}><div><span className="management-dept-number">{String(index + 1).padStart(2, '0')}</span><Building2 size={21} /></div><h2>{department.name}</h2><p>{scopedUsers.filter(user => user.departmentId === department.id && isOrganizationUserActive(user, new Date(w.serverTime))).length}명의 활성 구성원<span>{new Set(scopedUsers.filter(user => user.departmentId === department.id && isOrganizationUserActive(user, new Date(w.serverTime)) && isTeamStaff(user)).map(user => user.team)).size}개 팀</span></p><ArrowUpRight size={20} className="management-dept-arrow" /></button>)}</div> : <div className="management-org-scope"><Building2 size={21} /><div><strong>{deptName(w, w.currentUser.departmentId)}</strong><span>우리 부서의 구성원과 권한만 표시됩니다. 전체 조직 조회는 관리자에게 제공됩니다.</span></div><Badge tone="info">내 부서</Badge></div>}
    <div className="management-toolbar"><div className="management-filter-row">{isAdmin && <select aria-label="조직 부서 필터" value={selectedDepartment} onChange={event => setDepartmentId(event.target.value)}><option value="all">전체 부서</option>{departments.map(department => <option value={department.id} key={department.id}>{department.name}</option>)}</select>}<select aria-label="조직 권한 필터" value={role} onChange={event => setRole(event.target.value)}><option value="all">모든 권한</option>{Object.entries(roleNames).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select><span className="muted">{users.length}명 표시</span></div><label className="management-search"><Search size={17} /><input aria-label="구성원 검색" value={query} onChange={event => setQuery(event.target.value)} placeholder="이름·ID·이메일 검색" /></label></div>
    <div className="management-org-groups">{departments.filter(department => users.some(user => user.departmentId === department.id)).map(department => {
      const members = users.filter(user => user.departmentId === department.id);
      const teams = [...new Set(members.filter(isTeamStaff).map(user => user.team))].sort((a, b) => {
        const order = teamOrder[department.id] || [];
        const aIndex = order.indexOf(a); const bIndex = order.indexOf(b);
        return (aIndex < 0 ? order.length : aIndex) - (bIndex < 0 ? order.length : bIndex) || a.localeCompare(b, 'ko');
      });
      const groups = teams.map(team => ({ key: `team-${team}`, title: team || '팀 미지정', members: members.filter(user => isTeamStaff(user) && user.team === team) }));
      const officers = members.filter(user => !isTeamStaff(user));
      if (officers.length) groups.push({ key: 'officers', title: '부서장·시스템 관리', members: officers });
      return <section className="management-directory management-org-group panel" key={department.id}>
        <header><div><Building2 size={18} /><h2>{department.name}</h2></div><span>{members.length}명 표시</span></header>
        {groups.map(group => <section className="management-team-group" key={group.key} aria-label={`${department.name} ${group.title}`}>
          <header><h3>{group.title}</h3><span>{group.members.length}명</span></header>
          <div className="table-wrap"><table className="data-table"><thead><tr><th>구성원 / ID</th><th>팀 / 직위</th><th>권한</th><th>이메일 / 전화번호</th><th>기본 대행자</th><th>상태</th></tr></thead><tbody>{[...group.members].sort((a, b) => memberOrder[a.role] - memberOrder[b.role] || a.name.localeCompare(b.name, 'ko')).map(user => <tr key={user.id} {...focusProps(`person:${user.id}`)}><td><button className="management-user-link" onClick={() => setProfile(user)}><span className="management-person-avatar">{user.name.slice(0, 1)}</span><span><strong>{user.name}</strong><small>{user.id}</small></span></button></td><td>{user.team}<small>{user.title}</small></td><td><span>{roleNames[user.role]}</span></td><td><span>{user.email || '미등록'}</span><small>{user.phone || '미등록'}</small></td><td>{defaultDeputyLabel(w, user)}</td><td><Badge tone={isOrganizationUserActive(user, new Date(w.serverTime)) ? 'success' : 'outline'}>{isOrganizationUserActive(user, new Date(w.serverTime)) ? '활성' : '비활성'}</Badge></td></tr>)}</tbody></table></div>
        </section>)}
      </section>;
    })}</div>
    {!users.length && <EmptyState title="검색 결과가 없습니다." description="이름이나 필터를 바꿔 다시 찾아보세요." />}<p className="management-caption"><ShieldCheck size={15} />이름, 연락처, 부서와 권한은 시연을 위한 가상 데이터입니다.</p>
    {visibleProfile && <Modal title="구성원 정보" onClose={() => setProfile(null)}><div className="management-profile"><div className="management-profile-identity"><span className="management-person-avatar">{visibleProfile.name.slice(0, 1)}</span><div><h2>{visibleProfile.name}</h2><p>{visibleProfile.title}</p></div><Badge>{roleNames[visibleProfile.role]}</Badge></div><dl><div><dt>ID</dt><dd>{visibleProfile.id}</dd></div><div><dt>부서</dt><dd>{deptName(w, visibleProfile.departmentId)}</dd></div><div><dt>팀</dt><dd>{visibleProfile.team}</dd></div><div><dt>이메일</dt><dd>{visibleProfile.email || '미등록'}</dd></div><div><dt>전화번호</dt><dd>{visibleProfile.phone || '미등록'}</dd></div><div><dt>기본 대행자</dt><dd>{defaultDeputyLabel(w, visibleProfile)}</dd></div></dl><p className="muted">{defaultDeputyNotice}</p></div><div className="form-actions">{isAdmin && <><Button variant="secondary" disabled={!isOrganizationUserActive(visibleProfile, new Date(w.serverTime))} title="활성 구성원의 기본 대행자를 변경합니다." onClick={() => { setDeputyEditor(visibleProfile); setProfile(null); }}>기본 대행자 변경</Button><Button onClick={() => { setEditor(visibleProfile); setProfile(null); }}>인사정보 변경</Button></>}<Button variant="secondary" onClick={() => setProfile(null)}>닫기</Button></div></Modal>}
    {deputyEditor && <DefaultDeputyEditor key={deputyEditor.id} workspace={w} command={command} person={deputyEditor} onClose={() => { setProfile(deputyEditor); setDeputyEditor(null); }} />}
    {editor && <OrganizationEditor key={typeof editor === 'object' ? editor.id : editor} workspace={w} command={command} mode={editor} onClose={() => setEditor(null)} />}
  </div>;
}

const implemented = [
  ['권한별 시연 로그인', '시스템 관리자, 부서장, 부서 담당자, 팀장, 업무 담당자의 역할에 따라 메뉴와 작업 권한을 적용합니다.'],
  ['단위업무와 세부업무', '관련 일을 단위업무로 묶고 실제 수행할 과제를 세부업무로 등록합니다. 본인 업무의 추가·수정·이동과 삭제·휴지통 복원을 지원하며, 배정받은 공통업무의 삭제는 제한합니다.'],
  ['AI 업무등록과 절차 작성', '설명·인수인계 자료로 단위·세부업무 초안을 만들고, 저장한 업무 개요·첨부·관련 근거로 설명과 절차를 작성합니다. BizRouter 연결이 필요하며, 생성한 초안은 검토·수정한 뒤 적용합니다.'],
  ['업무 근거와 공식 법령 검색', '본문·링크·파일을 업무 근거로 연결합니다. 법령 API가 설정된 환경에서는 국가법령정보센터의 법령·행정규칙을 검색하고 필요한 조문을 선택해 가져옵니다.'],
  ['업무 절차·일정과 회차 이력', '절차별 일정과 수행 결과를 기록하고 달력에서 확인합니다. 한 회차를 마치면 새 일정으로 다음 회차를 시작하며, 지난 회차의 절차·날짜·완료자·결과는 보존합니다.'],
  ['공통업무 승인과 단계별 배정', '작성 → 작성 부서장 승인 → 대상 부서 접수 → 팀·개인 배정 → 내 업무 등록 → 수행으로 이어집니다. 총괄자는 대상 부서별 배정 단계와 진행 현황을 확인합니다.'],
  ['지시사항과 월별 실적', '지시자·지시일자를 기록하고 현재 담당자가 월별 실적·다음 달 계획·특이사항을 작성합니다. 기획재정담당관실 기획팀은 장·차관 지시사항의 부서별 현황을 통합 조회합니다.'],
  ['예산 연결·집행과 부서 집계', '세부업무에 예산 원장 항목을 연결하거나 예산을 직접 입력하고 집행 내역을 기록합니다. 부서 집계를 CSV로 내려받을 수 있으며, 관리자는 예산 원장을 관리합니다.'],
  ['부서 업무분장 확정', '부서장이 직원별 업무분장을 검토하고 일괄 확정합니다. 확정 후 업무 기준은 잠기고 일정·수행·성과 기록은 계속할 수 있으며, 사유를 남겨 재작성을 허용합니다.'],
  ['업무분장표와 문서 내려받기', '부서·팀·담당자로 업무분장표를 찾고 세부업무의 절차도를 확인합니다. 현재 조회 조건으로 Excel·PDF를 내려받고 기본 대행자와 승인된 업무대행자를 구분합니다.'],
  ['인수인계와 긴급 업무 보관', '인계할 업무와 후임을 선택해 부서장 승인을 받고 진행 중인 일정·수행 기록을 이어갑니다. 지원·검토·총괄 역할도 정리하며, 부서 담당자·관리자는 긴급 업무를 부서에 보관할 수 있습니다.'],
  ['기간제 업무대행', '전체 또는 선택한 업무에 대행자·기간을 정해 부서장 승인을 요청합니다. 대행자는 승인된 기간에 원본 업무를 수행하며, 업무 소유권과 반기 성과 제출·평가 권한은 이전되지 않습니다.'],
  ['반기 성과 제출과 평가', '500자 이내 성과와 참고 파일을 저장하고, 대상 단위업무마다 최소 1점씩 정수로 업무 비중을 배분해 합계 50점으로 제출합니다. 부서장은 제출된 성과를 각 비중 이내에서 평가합니다.'],
  ['조직 관리와 기본 대행자', '직원은 자기 부서의 구성원·연락처·권한을 확인합니다. 관리자는 전체 조직의 인사정보와 기본 대행자를 관리하며, 기본 대행자 지정만으로 수행 권한이 부여되지는 않습니다.'],
  ['검색과 앱 내 알림', '통합 검색으로 접근 가능한 단위·세부·공통업무와 구성원을 찾고, 승인·인수인계·평가 등의 알림에서 해당 화면으로 이동합니다. 읽음 상태는 사용자별로 관리합니다.'],
  ['연결 테스트와 변경 이력', '관리자가 AI 모델과 DB·파일 저장 연결을 시험하고 업무 변경 기록·릴리스 이력을 확인합니다. 버전 기록 추가는 코드 배포나 이전 버전 복원을 실행하지 않습니다.'],
  ['로컬 저장과 Neon 연결', '로컬 파일로 업무·첨부를 저장하거나 설정에 따라 Neon DB·Object Storage를 사용합니다. 기존 로컬 데이터의 이관 검사·이관 명령과 파일 업로드·다운로드를 지원합니다.'],
  ['역할별 사용 안내', '초기화면과 로그인 후 메뉴에서 권한별 역할, 업무 처리 순서와 세부업무 작성 방법을 확인합니다.'],
];
const planned = [
  ['스캔 문서 본문 인식', '텍스트가 없는 이미지·스캔 PDF의 OCR을 검토합니다. 현재는 읽을 수 있는 문서 본문을 사용하거나 필요한 내용을 직접 입력합니다.', '후속 검토'],
  ['공식 자료의 연계 범위 확대', '현재 법령·행정규칙 검색에 더해 기관별 지침·국정과제 자료의 연결과 원문 갱신 이력 관리를 검토합니다.', '연계 확장'],
  ['외부 알림과 캘린더 연결', '현재 앱 내 알림과 업무 일정에 더해 이메일·기관 알림 전송과 외부 캘린더 연동을 검토합니다.', '후속 검토'],
];

export function AdminView({ workspace: w, command }: Props) {
  const [tab, setTab] = useState('connections');
  const [releaseOpen, setReleaseOpen] = useState(false);
  const { requestNavigation } = useUnsavedNavigation();
  const tabs = useTabs({ value: tab, onChange: value => requestNavigation(() => setTab(value)), items: [
    { value: 'connections', label: '연결·테스트' }, { value: 'budgets', label: '예산 관리' },
    { value: 'status', label: '구현 현황' },
    { value: 'releases', label: <>버전 이력<span className="management-tab-count">{(w.releases || []).length}</span></> },
    { value: 'audit', label: '변경 기록' },
  ] });
  if (w.currentUser.role !== 'admin') return <EmptyState title="관리자 전용 화면입니다." description="시스템 관리자 계정으로 로그인하면 구현 현황과 버전 이력을 관리할 수 있습니다." />;
  const preloadTab = (target: EventTarget | null) => {
    const id = target instanceof Element ? target.closest('[role="tab"]')?.id : undefined;
    if (id === tabs.tabId('connections')) void integrationsScreen.preload();
    if (id === tabs.tabId('budgets')) void budgetScreen.preload();
  };
  const releases = w.releases || [];
  const latest = releases[0];
  return <div className="management-view" onMouseOver={event => preloadTab(event.target)} onFocusCapture={event => preloadTab(event.target)}><div className="page-heading"><div><p className="eyebrow">시스템 관리</p><h1>조금씩, 더 나은 온이음.</h1><p className="muted">AI·DB·파일 연결을 시험하고 구현 현황과 변경 이력을 확인합니다.</p></div><Button onClick={() => setReleaseOpen(true)}><Plus size={17} />버전 기록 추가</Button></div>
    <div className="management-release-banner"><div className="management-release-icon"><GitBranch size={28} /></div><div><span>현재 실행 버전</span><h2>v{APP_VERSION}</h2><p>업무의 흐름을 잇는 온이음 워크스페이스</p></div><div className="management-release-environment"><Badge tone="outline">{w.mode === 'local' ? '로컬 시연 환경' : '연결 환경'}</Badge><span>{latest ? `최근 기록 v${latest.version} · ${day(latest.date)}` : '아직 기록된 버전이 없습니다.'}</span></div></div>
    <Tabs tabs={tabs} label="시스템 관리 구분" className="management-admin-tabs tabs" />
    <div className="management-tab-panel" {...tabs.panelAttrs(tab)}>
    {tab === 'connections' && <AdminIntegrations/>}
    {tab === 'budgets' && <AdminBudgetCatalog workspace={w} command={command}/>}
    {tab === 'status' && <><div className="management-roadmap-heading"><h2>지금 사용할 수 있는 기능</h2><Badge>{implemented.length}개 영역</Badge></div><div className="management-feature-grid">{implemented.map(([title, description], index) => <article key={title}><span className="management-feature-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{title}</h3><p>{description}</p></div><CheckCircle2 size={18} /></article>)}</div><div className="management-roadmap-heading"><h2>다음으로 구현할 기능</h2><span className="muted">프로토타입 기능 확장</span></div><div className="management-planned-list">{planned.map(([title, description, label]) => <article key={title}><span className="management-planned-icon"><ArrowRight size={18} /></span><div><h3>{title}</h3><p>{description}</p></div><Badge tone="outline">{label}</Badge></article>)}</div><div className="management-info"><ShieldCheck size={18} /><p>가상 조직과 역할 선택으로 업무 흐름을 확인하는 프로토타입입니다. 아래에서 DB·첨부파일·AI 연결 설정을 확인할 수 있습니다.</p></div><div className="management-integration-grid">{[['데이터 저장', w.integrations.database], ['인증', w.integrations.auth], ['첨부파일', w.integrations.storage], ['AI 분석', w.integrations.bizrouter], ['법령 연계', w.integrations.law]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></>}
    {tab === 'releases' && <div className="management-release-list">{releases.map((release, i) => <article key={release.id}><div className="management-release-rail"><span /><i /></div><div className="management-release-entry"><div><h2>v{release.version}</h2>{i === 0 && <Badge tone="dark">최신 기록</Badge>}<span>{day(release.date)}</span></div><h3>{release.title}</h3><p>{release.notes}</p></div></article>)}{!releases.length && <EmptyState title="아직 기록된 버전이 없습니다." description="버전과 변경 내용을 기록해 개발 이력을 남겨 주세요." />}</div>}
    {tab === 'audit' && <div className="panel management-audit"><div className="panel-header"><h2>최근 변경 기록</h2><span className="muted">{w.audit.length}건</span></div>{w.audit.slice(0, 100).map(a => <article key={a.id}><span className="management-audit-icon"><ListChecks size={17} /></span><div><strong>{a.title}</strong><p>{auditDetailText(a, w)}</p><small>{userName(w, a.actorId)} · {deptName(w, a.departmentId)}</small></div><time>{formatDateTimeFull(a.createdAt)}</time></article>)}{!w.audit.length && <EmptyState title="변경 기록이 없습니다." description="업무를 만들고 수정하면 관련 기록이 쌓입니다." />}</div>}
    </div>
    {tabs.items.filter(item => item.value !== tab).map(item => <div key={item.value} {...tabs.panelAttrs(item.value)} />)}
    {releaseOpen && <CreateRelease command={command} onClose={() => setReleaseOpen(false)} />}
  </div>;
}

function CreateRelease({ command, onClose }: { command: CommandFn; onClose: () => void }) {
  const [version, setVersion] = useState(APP_VERSION); const [title, setTitle] = useState(''); const [notes, setNotes] = useState(''); const [saving, setSaving] = useState(false);
  return <Modal title="버전 기록 추가" description="완료한 변경 내용을 버전과 함께 기록합니다." onClose={onClose}><form className="form-stack" onSubmit={async e => { e.preventDefault(); setSaving(true); const saved = await command('admin.release', { version, title, notes }); setSaving(false); if (saved) onClose(); }}><Field label="버전"><input required pattern="[0-9]+\.[0-9]+\.[0-9]+" value={version} onChange={e => setVersion(e.target.value)} placeholder={`예: ${APP_VERSION}`} title={`${APP_VERSION}과 같이 숫자 세 자리 형식으로 입력해 주세요.`} /></Field><Field label="변경 제목"><input required maxLength={150} value={title} onChange={e => setTitle(e.target.value)} placeholder="이번 버전의 주요 변경" /></Field><Field label="변경 내용"><textarea required rows={6} maxLength={5000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="추가·개선·수정한 내용을 기록하세요." /></Field><div className="management-info"><GitBranch size={17} /><p>버전 기록은 개발 이력 관리용입니다. 앱 코드의 배포나 이전 버전으로의 복원은 실행하지 않습니다.</p></div><div className="form-actions"><Button type="button" variant="secondary" onClick={onClose}>취소</Button><Button type="submit" disabled={saving}>{saving ? '저장 중…' : '버전 기록 저장'}</Button></div></form></Modal>;
}

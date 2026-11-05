'use client';

import { useId, useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Building2, CircleHelp, GitBranch, Lightbulb, ListChecks, Settings2, ShieldCheck, UserRound, Users } from 'lucide-react';
import { guideRoles, type GuideRole } from '@/lib/usage-guide';
import { Button, Modal } from './ui';
import './usage-guide.css';

export type GuideSection = 'start' | 'roles' | 'task' | 'faq';
const roleIcons = { member: UserRound, lead: Users, manager: Building2, common: GitBranch, head: ShieldCheck, admin: Settings2 };
const sections = [
  { id: 'start', label: '처음 시작하기', icon: BookOpen },
  { id: 'roles', label: '권한별 역할·메뉴', icon: Users },
  { id: 'task', label: '세부업무 따라하기', icon: ListChecks },
  { id: 'faq', label: '자주 묻는 질문', icon: CircleHelp },
] as const;

const taskTabs = [
  { title: '업무 개요', intro: '어떤 일을 누가, 어떤 기준으로 수행하는지 정합니다.', steps: [
    { title: '단위업무 아래 세부업무 만들기', description: '개인업무에서 단위업무를 만든 뒤 세부업무 추가를 선택합니다. 이미 배정받은 공통업무라면 새로 만들지 말고 내 단위업무에 등록합니다.' },
    { title: '이름·설명·담당자 확인', description: '세부업무를 열어 수정하기를 누릅니다. 소속 단위업무, 업무 이름, 설명, 마감일과 반복 주기를 확인합니다. 화면에 표시된 담당자·검토자와 완료 기준도 함께 확인하세요.' },
    { title: '변경사항 저장', description: '업무 기준을 수정한 뒤 변경사항 저장을 누릅니다. 조회만 가능한 업무나 업무분장이 확정된 부서는 기준을 직접 수정할 수 없습니다.' },
  ], tip: '단위업무는 업무 묶음, 세부업무는 실제 수행 과제입니다. 예: 예산 관리 → 월별 집행 현황 보고.' },
  { title: '관련 근거', intro: '법령·지침·생산 문서를 모아 절차를 설계할 근거를 준비합니다.', steps: [
    { title: '근거 입력과 추가', description: '기본 입력란에서 법령, 지침, 국정과제, 지시사항, 생산 문서 또는 기타 근거를 선택하고 제목·내용·적용 조항을 입력합니다. 여러 자료는 근거 추가로 늘리고 원문 링크와 기존 첨부파일도 연결할 수 있습니다.' },
    { title: '파일 첨부 · 선택', description: '각 근거 아래 파일 첨부 · 선택을 눌러 10MB 이하 파일을 연결합니다. PDF·TXT·CSV는 본문 앞 10,000자를 가져오므로 분석에 필요한 내용을 확인하고 보완하세요. DOCX·HWP 등 다른 형식은 파일을 보관하고 분석할 본문을 직접 입력합니다.' },
    { title: '저장 후 분석 준비', description: '변경사항 저장을 누른 뒤 절차 탭으로 이동합니다. 파일만 보관할 수도 있지만 AI 분석에는 읽을 수 있는 본문이 필요합니다. 생산 문서에는 결과보고서·검토 의견 등 업무에서 만든 자료를 입력하세요.' },
  ], tip: '스캔 PDF는 본문을 직접 입력해야 합니다. 첨부파일의 검사 대기 상태와 다운로드 가능 여부는 파일 옆에 표시됩니다.' },
  { title: '절차', intro: '저장한 근거를 분석해 업무 프로세스와 역할별 절차도를 만듭니다.', steps: [
    { title: 'AI로 절차·절차도 만들기', description: '업무 개요와 관련 근거를 먼저 저장하고 AI로 절차·절차도 만들기를 선택합니다. 본문이 있는 근거를 최대 20개, 합계 60,000자까지 선택할 수 있습니다.' },
    { title: '초안 검토·수정', description: 'AI가 제시한 수행 순서, 담당자·지원·검토 역할, 선행 관계, 체크리스트, 결과물과 원문 인용을 확인합니다. 절차도에서 연결 관계를 확인하고 실제 업무에 맞게 수정하세요.' },
    { title: '적용하고 저장하기', description: '근거와 절차를 검토했다는 항목을 확인한 뒤 초안을 적용하고 변경사항 저장을 누릅니다. 기존 절차에 추가하거나, 교체가 허용되는 미완료 개인업무는 전체 교체할 수 있습니다.' },
  ], tip: 'AI 분석은 BizRouter 연결이 필요하며 선택한 근거 본문과 업무 제목·설명을 전송합니다. 연결되지 않은 경우 직접 절차를 추가하거나 규칙 기반 초안을 사용할 수 있습니다. 생성 결과는 담당자가 검토해야 합니다.' },
  { title: '일정 등록', intro: '저장한 절차에 이번 회차의 날짜와 세부 내용을 연결합니다.', steps: [
    { title: '회차와 절차별 일정 저장', description: '일정 등록을 눌러 회차 이름, 시작일·마감일, 이번 회차의 세부 내용을 작성합니다. 각 절차의 시작일·종료일과 준비 자료·회의 장소·제출 방법 등을 입력하고 일정 저장을 누릅니다.' },
    { title: '절차 수행과 결과 기록', description: '선행 절차부터 체크리스트를 확인하고 수행 결과를 입력한 뒤 절차 완료를 누릅니다. 검토·승인 단계는 지정된 검토자 또는 부서장 등 권한이 있는 사용자가 처리합니다.' },
    { title: '완료 후 새 일정 등록', description: '모든 절차와 검토를 마치면 회차가 완료됩니다. 기존 일정 미등록 완료 기록은 업무 사이클 완료로 보존합니다. 새 일정 등록을 눌러 다음 회차를 시작하면 진행률은 0%부터 다시 계산됩니다.' },
    { title: '업무 일정과 지난 회차 확인', description: '업무 일정 메뉴에서 현재 회차의 날짜를 달력으로 확인합니다. 세부업무의 지난 회차에서는 이전 일정·세부 내용·체크리스트·완료자·수행 결과를 확인할 수 있습니다.' },
  ], tip: '업무 기준의 변경사항 저장과 일정 저장은 별개입니다. 미완료 회차가 있으면 다음 회차를 시작할 수 없으며, 완료된 회차 기록은 보존됩니다.' },
  { title: '예산·집행', intro: '사업 예산과 지출 내역을 세부업무에 기록합니다.', steps: [
    { title: '사업 예산 입력', description: '사업 예산을 원 단위로 입력합니다. 예산이 없는 업무는 0원으로 둘 수 있습니다.' },
    { title: '집행 내역 추가', description: '집행 추가에서 집행일, 집행 내용, 금액을 입력합니다. 집행 합계와 남은 예산 또는 초과 집행 금액을 함께 확인합니다.' },
    { title: '변경사항 저장', description: '입력 내용을 확인하고 변경사항 저장을 누릅니다. 관련 보고서나 집행 증빙 설명은 관련 근거의 생산 문서에도 연결할 수 있습니다.' },
  ], tip: '예산·집행은 업무 기록입니다. 실제 지출 결재나 금융기관 송금을 실행하는 기능은 아닙니다.' },
  { title: '업무 성과', intro: '세부업무의 성과를 저장하고 반기별로 모아 제출합니다.', steps: [
    { title: '평가 기간과 성과 입력', description: '세부업무 마지막 업무 성과 탭에서 연도와 상·하반기를 선택합니다. 성과 제목·내용·근거를 작성하고, 필요한 경우 지표·달성 수치·단위를 입력한 뒤 성과 저장을 누릅니다.' },
    { title: '단위업무별 업무 비중 설정', description: '성과 · 평가 메뉴에서 같은 연도와 반기를 선택합니다. 단위업무별로 모인 성과를 확인하고 업무 비중 설정에서 합계를 50점으로 맞춥니다.' },
    { title: '제출하기', description: '각 단위업무의 성과와 업무 비중을 확인한 뒤 제출하기를 누릅니다. 성과 저장만으로는 제출이 완료되지 않습니다. 제출 후에는 평가 전 제출 회수로 수정할 수 있습니다.' },
    { title: '부서장 평가 확인', description: '부서장은 제출된 직원의 성과를 검토하고 단위업무별 업무 비중 이내에서 점수와 의견을 입력해 평가를 확정합니다. 평가가 확정되면 당시 성과와 업무 비중이 함께 보존됩니다.' },
  ], tip: '업무 사이클 완료와 반기 성과 제출은 별도입니다. 완료된 업무도 평가 기간에 맞춰 성과를 저장하고 제출해야 합니다.' },
];

const questions = [
  { title: '같은 화면인데 버튼이 보이지 않거나 비활성화되어 있어요.', answer: '로그인한 역할, 해당 업무의 담당 여부, 현재 배정 단계와 업무분장 확정 여부에 따라 가능한 작업이 달라집니다. 보기 모드라면 수정하기를 확인하세요. 팀장이라는 이유만으로 모든 팀원의 업무를 수정하거나 성과를 평가할 수 있는 것은 아닙니다.' },
  { title: '업무분장이 확정되면 어떤 일을 계속할 수 있나요?', answer: '일반 업무 기준과 배정은 잠기지만 승인된 절차의 일정 등록, 수행 체크, 결과 기록, 성과 입력은 계속할 수 있습니다. 단위·세부업무의 추가·수정·삭제·복원이나 근거·절차 기준을 바꾸려면 부서장의 재작성 허용이 필요합니다. 인사이동에 따른 담당자 변경은 인수인계 메뉴에서 처리할 수 있으며 이전 업무분장 확정본은 보존됩니다.' },
  { title: '갑작스러운 인사이동으로 인계자가 직접 처리할 수 없어요.', answer: '부서 담당자 또는 관리자가 인수인계 → 긴급 인사이동에서 인계자와 업무를 보관할 부서 담당자를 선택하고 사유를 작성합니다. 해당 직원의 활성 단위업무와 세부업무 전체가 즉시 부서 담당자에게 이관됩니다. 이후 부서 보관 업무에서 새 담당자에게 전부 또는 일부 배정을 요청하고 부서장 승인을 받습니다.' },
  { title: '새로 온 부서원에게 업무 일부만 넘길 수 있나요?', answer: '인수인계 요청에서 같은 부서에 등록된 활성 개인 담당자·팀장·부서 담당자 중 인수자를 선택합니다. 단위업무를 선택하면 그 안에서 인계자가 담당하는 세부업무가 함께 선택됩니다. 일부만 넘기려면 필요한 세부업무만 선택합니다. 부서장이 승인하여 배정을 누르면 선택한 업무와 진행 중인 회차를 새 담당자가 이어받습니다.' },
  { title: '인수인계를 요청했는데 담당자가 바뀌지 않았어요.', answer: '승인 대기 중에는 기존 담당자를 유지합니다. 해당 부서장이 승인하여 배정을 처리해야 담당자가 변경되며 관리자나 부서 담당자가 부서장 승인을 대신할 수는 없습니다. 반려되었다면 상세 보기의 사유를 확인하고 새 요청을 작성하세요. 승인 후 별도의 인수 수락 단계는 없습니다.' },
  { title: '업무 기준은 다른 직원에게 넘어갔는데 진행 회차가 제게 남아 있어요.', answer: '인수인계 요청의 이전 배정에서 남은 진행 회차에서 해당 회차를 선택하세요. 부서장 승인 후 선택한 회차의 수행 담당자만 변경되며 세부업무 소유자와 다음 회차의 담당 기준은 유지됩니다. 긴급 인사이동 때에는 이런 미완료 회차도 부서 담당자가 보관한 뒤 새 담당자에게 승인받아 재배정할 수 있습니다.' },
  { title: '인수인계 후 이전 업무 기록과 승인 이력은 어디에서 보나요?', answer: '인수인계 이력의 상세 보기에서 인계자·인수자, 요청자, 대상 단위·세부업무, 사유, 승인·반려·취소와 실제 적용 시각을 확인합니다. 완료된 회차, 기존 수행자의 체크·결과 기록, 성과 작성자와 이전 업무분장 확정본은 남아 있습니다. 업무를 일부 넘기면 선택하지 않은 업무는 기존 담당자에게 남습니다.' },
  { title: '배정받은 공통업무가 개인업무에 바로 나타나지 않아요.', answer: '공통업무는 부서 접수·팀 배정 → 팀장의 개인 배정 → 담당자의 내 단위업무 등록 순서로 이어집니다. 공통업무 · 지시사항에서 현재 단계와 다음 처리자를 확인하세요. 개인 배정까지 끝났다면 내 단위업무에 등록합니다. 선택할 단위업무가 없으면 개인업무에서 먼저 만드세요.' },
  { title: '공통업무 담당은 별도의 직급인가요?', answer: '공통업무 관리 권한은 조직 역할에 추가되는 권한입니다. 개인 담당자도 이 권한을 받으면 공통업무를 만들고 배포할 수 있습니다. 배포한 다른 부서의 배정·진행 요약은 조회하지만 해당 부서의 일반 업무 내용까지 자동으로 열람하게 되는 것은 아닙니다.' },
  { title: '장·차관 지시사항과 일반 공통업무는 어떻게 다른가요?', answer: '장·차관 지시사항 통합 관리는 기획재정담당관실 기획팀의 별도 총괄 역할에 제공됩니다. 권한이 있는 사용자가 통합 관리 화면에서 지시사항과 부서별 진행·월별 실적을 확인합니다. 배정받은 현재 담당자는 업무가 완료될 때까지 월별 실적을 기록할 수 있습니다.' },
  { title: 'AI 분석이 실행되지 않거나 원하는 절차가 나오지 않아요.', answer: '업무 개요·관련 근거의 변경사항을 먼저 저장하고 본문이 있는 근거를 선택하세요. 파일 이름이나 링크만으로는 분석할 수 없습니다. 연결 오류는 관리자에게 BizRouter 연결 상태를 확인하고, 당장 작성해야 할 절차는 직접 입력하거나 규칙 기반 초안을 이용하세요. AI 초안의 원문 인용과 담당 역할은 실제 업무에 맞게 검토해야 합니다.' },
  { title: '절차 완료나 새 일정 등록이 되지 않아요.', answer: '선행 절차, 필수 체크리스트, 수행 결과 입력과 검토자 권한을 확인하세요. 저장하지 않은 업무 변경이 있으면 먼저 저장합니다. 새 회차는 모든 절차와 검토가 끝난 뒤 담당자 또는 관리자가 시작하며, 새 날짜는 회차 범위와 선행 절차 순서에 맞아야 합니다.' },
  { title: '성과를 저장했는데 부서장에게 제출되지 않았어요.', answer: '성과 저장과 제출은 별도입니다. 성과 · 평가에서 같은 연도·반기를 선택하고 단위업무별 성과를 확인한 뒤, 업무 비중 합계가 50점인지 확인하고 제출하기를 누르세요. 제출 완료 · 평가 대기 상태가 되어야 부서장이 평가할 수 있습니다.' },
  { title: '제출한 성과나 삭제한 업무를 다시 수정할 수 있나요?', answer: '성과는 평가 확정 전 제출 회수를 통해 다시 수정하고 제출할 수 있습니다. 확정된 평가는 당시 기록을 보존합니다. 삭제한 개인 단위·세부업무는 개인업무의 휴지통에서 복원합니다. 단위업무도 삭제되어 있다면 먼저 복원하거나 다른 활성 단위업무를 선택하세요. 업무분장 확정 상태에서는 복원도 제한됩니다.' },
  { title: '시연 계정을 바꾸거나 다른 역할을 확인하려면 어떻게 하나요?', answer: '첫 화면에서 역할·부서·시연 계정을 선택해 시작합니다. 로그인 후에는 왼쪽 아래 프로필 또는 상단 역할 전환을 이용하세요. 원하는 부서나 계정이 선택 목록에 없으면 로그아웃 후 첫 화면에서 다시 선택합니다. 시연 계정의 이름과 조직은 가상 데이터입니다.' },
];

function Steps({ items }: { items: { title: string; description: string }[] }) {
  return <ol className="guide-steps">{items.map((step, index) => <li key={step.title}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><strong>{step.title}</strong><p>{step.description}</p></div></li>)}</ol>;
}

export function LandingGuide({ onOpen }: { onOpen: (section: GuideSection, role?: GuideRole) => void }) {
  return <section className="guide-landing" aria-labelledby="landing-guide-title"><header className="guide-landing-heading"><div><p className="guide-kicker"><BookOpen size={16}/>온이음 사용 안내</p><h2 id="landing-guide-title">내 역할에 맞는 시작을 찾아보세요.</h2><p>로그인 전에도 역할별 메뉴와 업무 처리 순서를 확인할 수 있습니다.</p></div><Button variant="secondary" onClick={() => onOpen('start')}>전체 사용 안내<ArrowRight size={16}/></Button></header><div className="guide-role-cards">{guideRoles.map(role => { const Icon = roleIcons[role.id]; return <button key={role.id} type="button" className="guide-role-card" aria-label={`${role.title} 역할과 메뉴 안내`} onClick={() => onOpen('roles', role.id)}><Icon size={23}/><span><strong>{role.title}</strong><small>{role.summary}</small></span><ArrowUpRight size={17}/></button>; })}</div></section>;
}

export function UsageGuide({ onClose, initialRole = 'member', initialSection = 'start' }: { onClose: () => void; initialRole?: GuideRole; initialSection?: GuideSection }) {
  const [section, setSection] = useState<GuideSection>(initialSection);
  const [roleId, setRoleId] = useState<GuideRole>(initialRole);
  const [taskTab, setTaskTab] = useState(0);
  const contentId = useId();
  const role = guideRoles.find(role => role.id === roleId) || guideRoles[0];
  const detail = taskTabs[taskTab];
  return <Modal title="온이음 사용 안내" description="처음 시작하는 방법부터 권한별 메뉴, 업무 수행과 성과 제출까지 확인하세요." onClose={onClose} wide><div className="usage-guide">
    <nav className="guide-nav" aria-label="사용 안내 항목">{sections.map(item => { const Icon = item.icon; return <button key={item.id} type="button" aria-pressed={section === item.id} aria-controls={contentId} onClick={() => setSection(item.id)}><Icon size={16}/>{item.label}</button>; })}</nav>
    <div id={contentId}>
      {section === 'start' && <section className="guide-section"><header><h3>업무를 정리하고, 실행하고, 성과로 남깁니다.</h3><p>온이음은 업무의 기준과 실제 수행 기록을 함께 관리하는 공간입니다. 먼저 세 가지 개념을 익히고 내 역할의 메뉴를 확인하세요.</p></header><div className="guide-term-grid">{[
        ['단위업무', '서로 관련된 세부업무를 모으는 업무 묶음입니다.', '예: 예산 관리'],
        ['세부업무', '담당자·근거·절차·완료 기준을 가진 실행 과제입니다.', '예: 월별 집행 현황 보고'],
        ['업무 회차', '같은 절차를 특정 일정에 따라 수행하는 한 번의 사이클입니다.', '예: 11월 보고 → 12월 보고'],
      ].map(([title, description, example]) => <article key={title}><h4>{title}</h4><p>{description}</p><small>{example}</small></article>)}</div>
        <Steps items={[
          { title: '역할과 계정 선택', description: '초기화면에서 개인 담당자·팀장·부서 담당자·공통업무 담당·부서장·관리자 중 체험할 역할을 고르고 부서와 시연 계정을 확인합니다. 로그인 전 역할별 카드를 눌러 사용할 메뉴를 확인할 수 있습니다.' },
          { title: '업무 홈에서 다음 할 일 확인', description: '로그인하면 업무 홈이 열립니다. 내 업무·마감·배정 현황을 확인하고 개인업무 또는 공통업무 · 지시사항으로 이동합니다. 부서장은 부서 업무 현황과 업무분장을 중심으로 확인합니다.' },
          { title: '업무 기준 작성 후 수행', description: '담당자는 업무 개요와 관련 근거를 저장하고 절차·절차도를 만듭니다. 일정 등록에서 회차별 계획을 저장한 뒤 체크리스트와 수행 결과를 기록합니다.' },
          { title: '완료 기록과 성과 연결', description: '절차와 검토가 끝나면 다음 회차의 새 일정을 등록합니다. 업무 성과를 따로 저장하고 성과 · 평가에서 업무 비중을 설정해 반기 성과를 제출합니다.' },
          { title: '인사이동 시 업무 이어주기', description: '인수인계 메뉴에서 단위업무 전체 또는 일부 세부업무를 새 담당자에게 넘기도록 요청합니다. 갑작스러운 이동은 부서 담당자가 업무를 먼저 보관하고, 새 담당자 배정은 부서장 승인을 거칩니다.' },
        ]}/>
        <div className="guide-callout"><GitBranch size={22}/><div><strong>여러 부서가 함께하는 업무의 흐름</strong><p>공통업무의 원본과 각 부서의 수행 기록이 연결됩니다. 현재 단계에 표시된 다음 처리자가 업무를 이어받습니다.</p></div></div><ol className="guide-flow">{[['공통업무 담당', '만들기·배포'], ['부서 담당자', '팀 배정'], ['팀장', '개인 배정'], ['개인 담당자', '내 단위업무 등록'], ['담당자·검토자', '수행·검토·완료']].map(([owner, action]) => <li key={owner}><small>{owner}</small><strong>{action}</strong></li>)}</ol>
        <Button variant="secondary" onClick={() => setSection('roles')}>권한별 역할·메뉴 보기<ArrowRight size={16}/></Button>
      </section>}
      {section === 'roles' && <section className="guide-section"><header><h3>역할에 따라 메뉴와 처리 범위가 달라집니다.</h3><p>같은 메뉴에서도 내가 담당하는 업무와 배정 단계에 따라 실행할 수 있는 작업이 다릅니다. 역할 선택은 안내 내용을 바꾸며 로그인 권한은 변경하지 않습니다.</p></header><nav className="guide-role-picker" aria-label="안내할 역할 선택">{guideRoles.map(item => { const Icon = roleIcons[item.id]; return <button key={item.id} type="button" aria-pressed={roleId === item.id} onClick={() => setRoleId(item.id)}><Icon size={18}/><span>{item.title}</span></button>; })}</nav><div className="guide-role-summary"><small>선택한 역할</small><h3>{role.title}</h3><p>{role.summary}</p></div><div className="guide-scope"><strong>업무 범위</strong><p>{role.scope}</p></div><div className="guide-columns"><section><h4><BookOpen size={17}/>메뉴별 사용 방법</h4><dl className="guide-menu-list">{role.menus.map(menu => <div key={menu.name}><dt>{menu.name}</dt><dd>{menu.description}</dd></div>)}</dl></section><section><h4><ListChecks size={17}/>이 순서로 처리하세요</h4><Steps items={role.steps}/></section></div><aside className="guide-tip"><strong>역할과 권한 확인</strong><ul className="guide-notes">{role.notes.map(note => <li key={note}>{note}</li>)}</ul></aside></section>}
      {section === 'task' && <section className="guide-section"><header><h3>세부업무의 탭 순서대로 따라 해보세요.</h3><p>개인업무에서 세부업무를 열면 아래 탭을 순서대로 사용할 수 있습니다. 업무 기준, 회차 일정, 업무 성과는 각각 저장합니다. 지시사항 업무에는 예산·집행 다음에 월별 실적 탭이 추가되며, 현재 담당자가 완료 전까지 매월 실적과 다음 계획을 기록합니다.</p></header><nav className="guide-detail-tabs" aria-label="세부업무 탭별 안내">{taskTabs.map((item, index) => <button key={item.title} type="button" aria-pressed={taskTab === index} onClick={() => setTaskTab(index)}><span>{index + 1}</span>{item.title}</button>)}</nav><article className="guide-detail-content"><h4>{detail.title}</h4><p>{detail.intro}</p><Steps items={detail.steps}/><aside className="guide-tip"><Lightbulb size={18}/><p>{detail.tip}</p></aside></article></section>}
      {section === 'faq' && <section className="guide-section"><header><h3>막히는 단계에서 확인하세요.</h3><p>질문을 펼치면 필요한 확인 사항과 다음 행동을 볼 수 있습니다.</p></header>{questions.map(question => <details className="guide-faq" key={question.title}><summary tabIndex={0}>{question.title}</summary><p>{question.answer}</p></details>)}</section>}
    </div>
    <footer className="guide-footer"><p><BookOpen size={15}/>초기화면과 로그인 후 왼쪽 메뉴에서 언제든 다시 열 수 있습니다.</p><Button variant="secondary" onClick={onClose}>안내 닫기</Button></footer>
  </div></Modal>;
}

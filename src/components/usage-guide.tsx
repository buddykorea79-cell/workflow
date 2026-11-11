'use client';

import { useId, useState } from 'react';
import { ArrowRight, BookOpen, Building2, CircleHelp, GitBranch, Lightbulb, ListChecks, Search, Settings2, ShieldCheck, UserRound, Users, X } from 'lucide-react';
import { guideRoles, type GuideRole } from '@/lib/usage-guide';
import { filterGuideQuestions, questionCategories, taskTabs, type QuestionCategory } from '@/lib/guide-topics';
import { Button } from './ui';
import type { GuideSection } from '@/lib/guide-role-summaries';
import './usage-guide.css';

export type { GuideSection } from '@/lib/guide-role-summaries';
const roleIcons = { member: UserRound, lead: Users, manager: Building2, head: ShieldCheck, admin: Settings2 };
const sections = [
  { id: 'start', label: '처음 시작하기', icon: BookOpen },
  { id: 'roles', label: '역할·메뉴 안내', icon: Users },
  { id: 'task', label: '세부업무 따라하기', icon: ListChecks },
  { id: 'faq', label: '자주 묻는 질문', icon: CircleHelp },
] as const;

function Steps({ items }: { items: { title: string; description: string }[] }) {
  return <ol className="guide-steps">{items.map((step, index) => <li key={step.title}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><div><strong>{step.title}</strong><p>{step.description}</p></div></li>)}</ol>;
}

export function UsageGuideContent({ onClose, initialRole = 'member', initialSection = 'start' }: { onClose: () => void; initialRole?: GuideRole; initialSection?: GuideSection }) {
  const [section, setSection] = useState<GuideSection>(initialSection);
  const [roleId, setRoleId] = useState<GuideRole>(initialRole);
  const [taskTab, setTaskTab] = useState(0);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<QuestionCategory | 'all'>('all');
  const contentId = useId();
  const searchId = useId();
  const role = guideRoles.find(role => role.id === roleId) || guideRoles[0];
  const detail = taskTabs[taskTab];
  const matchingQuestions = filterGuideQuestions(query, category);

  return <div className="usage-guide">
    <nav className="guide-nav" aria-label="사용 안내 항목">{sections.map(item => { const Icon = item.icon; return <button key={item.id} type="button" aria-pressed={section === item.id} aria-controls={contentId} onClick={() => setSection(item.id)}><Icon size={16} aria-hidden="true"/>{item.label}</button>; })}</nav>
    <div id={contentId}>
      {section === 'start' && <section className="guide-section">
        <header className="guide-welcome"><span className="guide-eyebrow">처음 만나는 온이음</span><h3>내 업무 하나부터 시작해 보세요.</h3><p>온이음은 업무의 기준, 실제 수행 기록, 반기 성과를 한곳에서 이어주는 공간입니다. 기존 예시 업무를 열어보면 전체 흐름을 익힐 수 있습니다.</p></header>
        <Steps items={[
          { title: '업무 담당자 1로 시작하기', description: '접근 코드 화면이 보이면 안내받은 숫자 8자리를 입력하세요. 업무 담당자 1 → 데이터정보화담당관실 → 송주무관을 선택합니다. 업무 담당자 1·2는 같은 권한의 서로 다른 시연 계정입니다.' },
          { title: '개인업무에서 세부업무 하나 열기', description: '로그인하면 업무 홈이 열립니다. 왼쪽 개인업무에서 단위업무를 펼치고 기존 세부업무를 선택하세요. 업무 개요에서 담당자와 업무 설명을 먼저 확인합니다.' },
          { title: '절차와 일정·수행 살펴보기', description: '절차에서 누가, 무엇을, 어떻게 하는지 확인하고 일정·수행에서 날짜와 진행 상태를 살펴보세요. 직접 시작할 때는 단위업무 → 세부업무 → 절차 → 일정 순으로 작성·저장합니다.' },
        ]}/>
        <div className="guide-shortcuts" aria-label="다음으로 볼 안내">
          <button type="button" onClick={() => setSection('task')}><ListChecks size={20}/><span><strong>직접 업무 작성하기</strong><small>탭별 입력과 저장 방법</small></span><ArrowRight size={17}/></button>
          <button type="button" onClick={() => setSection('roles')}><Users size={20}/><span><strong>내 역할에서 할 일</strong><small>메뉴와 승인·처리 순서</small></span><ArrowRight size={17}/></button>
          <button type="button" onClick={() => setSection('faq')}><CircleHelp size={20}/><span><strong>막히는 부분 찾기</strong><small>질문 검색과 주제별 안내</small></span><ArrowRight size={17}/></button>
        </div>
        <h4>이 세 가지만 알면 쉬워집니다</h4>
        <div className="guide-term-grid">{[
          ['단위업무', '관련된 일을 모아 놓은 업무 묶음', '예산 관리'],
          ['세부업무', '실제로 수행하는 하나의 과제', '월별 집행 현황 보고'],
          ['업무 회차', '같은 업무를 한 번 수행하는 일정과 기록', '11월 보고 → 12월 보고'],
        ].map(([title, description, example]) => <article key={title}><h4>{title}</h4><p>{description}</p><small>예: {example}</small></article>)}</div>
        <aside className="guide-tip"><strong>저장과 제출은 따로 진행합니다</strong><p>업무 기준, 생산 문서·집행내역, 일정, 성과는 각각 저장합니다. 성과를 저장한 뒤에는 성과 · 평가에서 업무 비중을 정하고 제출하기를 눌러야 부서장이 평가할 수 있습니다.</p></aside>
        <details className="guide-more"><summary><GitBranch size={18} aria-hidden="true"/>여러 부서가 함께하는 업무는 어떻게 이어지나요?</summary><p>공통업무 · 지시사항에서 작성한 업무는 작성 부서장의 승인 후 대상 부서에 접수됩니다. 현재 단계의 담당자가 다음 사람에게 이어줍니다.</p><ol className="guide-flow">{[['작성자', '공통 세부업무 작성'], ['작성 부서장', '내용·대상 부서 승인'], ['대상 부서 담당자', '팀 배정'], ['팀장', '업무 담당자 배정'], ['업무 담당자', '내 단위업무 등록'], ['담당자·검토자', '수행·검토·완료']].map(([owner, action]) => <li key={owner}><small>{owner}</small><strong>{action}</strong></li>)}</ol></details>
      </section>}
      {section === 'roles' && <section className="guide-section">
        <header><h3>내 역할에서 할 수 있는 일을 확인하세요.</h3><p>5가지 역할의 메뉴와 처리 순서를 안내합니다. 아래 선택은 도움말만 바꾸며 로그인한 계정은 그대로 유지됩니다.</p></header>
        <nav className="guide-role-picker" aria-label="안내할 역할 선택">{guideRoles.map(item => { const Icon = roleIcons[item.id]; return <button key={item.id} type="button" aria-pressed={roleId === item.id} onClick={() => setRoleId(item.id)}><Icon size={18} aria-hidden="true"/><span>{item.title}</span></button>; })}</nav>
        <div className="guide-role-summary"><small>선택한 역할</small><h3>{role.title}</h3><p>{role.summary}</p></div>
        <div className="guide-scope"><strong>업무 범위</strong><p>{role.scope}</p></div>
        <div className="guide-columns"><section><h4><BookOpen size={17}/>메뉴별 사용 방법</h4><dl className="guide-menu-list">{role.menus.map(menu => <div key={menu.name}><dt>{menu.name}</dt><dd>{menu.description}</dd></div>)}</dl></section><section><h4><ListChecks size={17}/>이 순서로 처리하세요</h4><Steps items={role.steps}/></section></div>
        <aside className="guide-tip"><strong>역할과 권한 확인</strong><ul className="guide-notes">{role.notes.map(note => <li key={note}>{note}</li>)}</ul></aside>
      </section>}
      {section === 'task' && <section className="guide-section">
        <header><h3>세부업무를 열고, 필요한 탭을 선택하세요.</h3><p>개인업무에서 세부업무 이름을 누르면 아래 탭을 볼 수 있습니다. 월별 실적은 지시사항에만 표시됩니다. 각 안내의 마지막 저장 단계까지 확인하세요.</p></header>
        <nav className="guide-detail-tabs" aria-label="세부업무 탭별 안내">{taskTabs.map((item, index) => <button key={item.title} type="button" aria-pressed={taskTab === index} aria-controls={`${contentId}-task`} onClick={() => setTaskTab(index)}><span aria-hidden="true">{index + 1}</span>{item.title}</button>)}</nav>
        <article id={`${contentId}-task`} className="guide-detail-content"><span className="guide-eyebrow">{taskTab + 1} / {taskTabs.length} · 탭별 안내</span><h4>{detail.title}</h4><p>{detail.intro}</p><Steps items={detail.steps}/><aside className="guide-tip"><Lightbulb size={18}/><p>{detail.tip}</p></aside></article>
      </section>}
      {section === 'faq' && <section className="guide-section">
        <header><h3>궁금한 내용을 빠르게 찾아보세요.</h3><p>주제를 고르거나 질문과 답변에 들어 있는 단어로 검색하세요. 예: 기본 대행자, 성과 제출, 법령</p></header>
        <div className="guide-search-field"><label htmlFor={searchId}>도움말 검색</label><div className="guide-search"><Search size={19} aria-hidden="true"/><input id={searchId} type="search" value={query} placeholder="어떤 도움이 필요하세요?" onChange={event => setQuery(event.target.value)} aria-controls={`${contentId}-questions`}/>{query && <button type="button" aria-label="검색어 지우기" onClick={() => setQuery('')}><X size={17}/></button>}</div></div>
        <nav className="guide-categories" aria-label="질문 주제"><button type="button" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>전체</button>{questionCategories.map(item => <button type="button" key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</nav>
        <p className="guide-result-count" role="status" aria-live="polite">{category === 'all' ? '전체 주제' : category} · 질문 {matchingQuestions.length}개{query.trim() && ` · “${query.trim()}” 검색 결과`}</p>
        <div id={`${contentId}-questions`}>{matchingQuestions.length ? matchingQuestions.map(question => <details className="guide-faq" key={question.title}><summary><span>{question.category}</span>{question.title}</summary><p>{question.answer}</p></details>) : <div className="guide-empty"><CircleHelp size={28} aria-hidden="true"/><h4>일치하는 질문이 없습니다.</h4><p>검색어를 줄이거나 다른 주제를 선택해 보세요.</p><Button variant="secondary" onClick={() => { setQuery(''); setCategory('all'); }}>전체 질문 보기</Button></div>}</div>
      </section>}
    </div>
    <footer className="guide-footer"><p><BookOpen size={15}/>첫 화면과 왼쪽 메뉴에서 언제든 다시 열 수 있습니다.</p><Button variant="secondary" onClick={onClose}>안내 닫기</Button></footer>
  </div>;
}

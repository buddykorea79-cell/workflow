'use client';

import { ArrowRight, ArrowUpRight, BookOpen, Building2, Settings2, ShieldCheck, UserRound, Users } from 'lucide-react';
import { guideRoleSummaries, type GuideRole, type GuideSection } from '@/lib/guide-role-summaries';
import { Button } from './ui';
import './usage-guide.css';

const roleIcons = { member: UserRound, lead: Users, manager: Building2, head: ShieldCheck, admin: Settings2 };

export function LandingGuide({ onOpen, onPreload }: { onOpen: (section: GuideSection, role?: GuideRole) => void; onPreload?: () => void }) {
  return <section onMouseEnter={onPreload} onFocusCapture={onPreload} className="guide-landing" aria-labelledby="landing-guide-title">
    <header className="guide-landing-heading"><div><p className="guide-kicker"><BookOpen size={16}/>온이음 사용 안내</p><h2 id="landing-guide-title">처음이라면, 내 업무 하나부터.</h2><p>로그인 전에도 시작 방법과 내 역할에서 할 일을 확인할 수 있습니다.</p></div><Button variant="secondary" onClick={() => onOpen('start')}>처음 시작하기<ArrowRight size={16}/></Button></header>
    <ol className="guide-landing-path" aria-label="처음 사용하는 순서">
      <li><span>01</span><div><strong>계정 선택</strong><p>업무 담당자 1로 시작해 보세요.</p></div></li>
      <li><span>02</span><div><strong>개인업무 열기</strong><p>업무 묶음에서 세부업무를 선택하세요.</p></div></li>
      <li><span>03</span><div><strong>절차와 일정 확인</strong><p>누가, 무엇을, 언제 하는지 살펴보세요.</p></div></li>
    </ol>
    <div className="guide-landing-label"><h3>역할별로 알아보기</h3><span>업무 담당자 1·2는 같은 권한입니다.</span></div>
    <div className="guide-role-cards">{guideRoleSummaries.map(role => { const Icon = roleIcons[role.id]; return <button key={role.id} type="button" className="guide-role-card" aria-label={`${role.title} 역할과 메뉴 안내`} onClick={() => onOpen('roles', role.id)}><Icon size={23}/><span><strong>{role.title}</strong><small>{role.summary}</small></span><ArrowUpRight size={17}/></button>; })}</div>
  </section>;
}

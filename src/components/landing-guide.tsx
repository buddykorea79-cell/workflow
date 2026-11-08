'use client';

import { ArrowRight, ArrowUpRight, BookOpen, Building2, Settings2, ShieldCheck, UserRound, Users } from 'lucide-react';
import { guideRoleSummaries, type GuideRole, type GuideSection } from '@/lib/guide-role-summaries';
import { Button } from './ui';
import './usage-guide.css';

const roleIcons = { member: UserRound, lead: Users, manager: Building2, head: ShieldCheck, admin: Settings2 };

export function LandingGuide({ onOpen, onPreload }: { onOpen: (section: GuideSection, role?: GuideRole) => void; onPreload?: () => void }) {
  return <section onMouseEnter={onPreload} onFocusCapture={onPreload} className="guide-landing" aria-labelledby="landing-guide-title"><header className="guide-landing-heading"><div><p className="guide-kicker"><BookOpen size={16}/>온이음 사용 안내</p><h2 id="landing-guide-title">내 역할에 맞는 시작을 찾아보세요.</h2><p>로그인 전에도 역할별 메뉴와 업무 처리 순서를 확인할 수 있습니다.</p></div><Button variant="secondary" onClick={() => onOpen('start')}>전체 사용 안내<ArrowRight size={16}/></Button></header><div className="guide-role-cards">{guideRoleSummaries.map(role => { const Icon = roleIcons[role.id]; return <button key={role.id} type="button" className="guide-role-card" aria-label={`${role.title} 역할과 메뉴 안내`} onClick={() => onOpen('roles', role.id)}><Icon size={23}/><span><strong>{role.title}</strong><small>{role.summary}</small></span><ArrowUpRight size={17}/></button>; })}</div></section>;
}

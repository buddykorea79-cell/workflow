'use client';

import type { GuideRole, GuideSection } from '@/lib/guide-role-summaries';
import { createLazyScreen } from './lazy-screen';
import { Modal } from './ui';
import './usage-guide.css';

const guide = createLazyScreen(() => import('./usage-guide').then(module => module.UsageGuideContent), { label: '사용 안내', kind: 'section' });
const GuideContent = guide.Component;
export const preloadUsageGuide = guide.preload;
export type { GuideRole, GuideSection } from '@/lib/guide-role-summaries';

/** Keep the dialog, focus trap and close action mounted while its content loads or retries. */
export function UsageGuide(props: { onClose: () => void; initialRole?: GuideRole; initialSection?: GuideSection }) {
  return <Modal title="온이음 사용 안내" description="처음 시작하는 방법부터 권한별 메뉴, 업무 수행과 성과 제출까지 확인하세요." onClose={props.onClose} wide><GuideContent {...props} /></Modal>;
}

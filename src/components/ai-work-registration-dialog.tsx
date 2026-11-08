'use client';

import type { Workspace } from '@/lib/types';
import { Modal, type CommandFn } from './ui';
import { createLazyScreen } from './lazy-screen';
import { useUnsavedNavigation } from './unsaved-changes';

export type AiWorkRegistrationProps = { workspace: Workspace; command: CommandFn; onClose: () => void; onWorkspace?: (workspace: Workspace) => void };
const { Component: Registration, preload } = createLazyScreen(() => import('./ai-work-registration').then(module => module.AiWorkRegistration), { label: 'AI 업무 등록', kind: 'section' });
export const preloadAiWorkRegistration = preload;

export function AiWorkRegistrationDialog({ onClose, ...props }: AiWorkRegistrationProps) {
  const { requestNavigation } = useUnsavedNavigation();
  const close = () => requestNavigation(onClose);
  return <Modal title="AI로 업무 등록" description="업무 설명을 분석하고, 단위업무와 세부업무를 직접 검토한 뒤 등록합니다." wide className="ai-work-registration-dialog" onClose={close}>
    <Registration {...props} onClose={close}/>
  </Modal>;
}

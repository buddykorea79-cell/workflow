'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Modal } from './ui';

type Navigation = () => void;
type UnsavedContext = {
  register: (id: string, dirty: boolean, label: string) => void;
  draftIds: () => string[];
  requestNavigation: (action: Navigation, onCancel?: Navigation, preservedIds?: readonly string[]) => void;
};
const Context = createContext<UnsavedContext>({ register: () => undefined, draftIds: () => [], requestNavigation: action => action() });
const PreservedContext = createContext<readonly string[]>([]);

/** Keep drafts in their mounted forms until the user explicitly chooses to leave. */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, string>());
  const [pending, setPending] = useState<{ action: Navigation; onCancel?: Navigation; labels: string[] } | null>(null);
  const register = useCallback((id: string, dirty: boolean, label: string) => {
    if (dirty) entries.current.set(id, label); else entries.current.delete(id);
  }, []);
  const requestNavigation = useCallback((action: Navigation, onCancel?: Navigation, preservedIds: readonly string[] = []) => {
    const labels = [...entries.current].filter(([id]) => !preservedIds.includes(id)).map(([, label]) => label);
    if (!labels.length) { action(); return; }
    setPending({ action, onCancel, labels: [...new Set(labels)] });
  }, []);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (!entries.current.size) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, []);
  const value = useMemo(() => ({ register, requestNavigation, draftIds: () => [...entries.current.keys()] }), [register, requestNavigation]);
  const keepWriting = () => { const cancel = pending?.onCancel; setPending(null); cancel?.(); };
  return <Context.Provider value={value}>{children}{pending && <Modal title="저장하지 않은 내용이 있습니다" description="이동하면 작성 중인 내용이 사라질 수 있습니다. 저장하려면 계속 작성한 뒤 저장 버튼을 눌러 주세요." onClose={keepWriting}>
    <div className="form-stack"><p>{pending.labels.join(' · ')}</p><div className="form-actions"><Button variant="secondary" onClick={() => { const action = pending.action; setPending(null); action(); }}>저장하지 않고 이동</Button><Button onClick={keepWriting}>계속 작성</Button></div></div>
  </Modal>}</Context.Provider>;
}

/** Opening task details keeps the page behind the dialog mounted and its drafts intact. */
export function UnsavedChangesBoundary({ children }: { children: ReactNode }) {
  const { draftIds } = useContext(Context);
  const [preservedIds] = useState(draftIds);
  return <PreservedContext.Provider value={preservedIds}>{children}</PreservedContext.Provider>;
}

export function useUnsavedChanges(dirty: boolean, label = '작성 중인 내용') {
  const id = useId();
  const { register } = useContext(Context);
  useEffect(() => { register(id, dirty, label); return () => register(id, false, label); }, [id, dirty, label, register]);
  return id;
}

export function useUnsavedNavigation() {
  const { requestNavigation } = useContext(Context);
  const inheritedIds = useContext(PreservedContext);
  const requestScopedNavigation = useCallback((action: Navigation, onCancel?: Navigation, preservedIds: readonly string[] = []) => requestNavigation(action, onCancel, [...inheritedIds, ...preservedIds]), [inheritedIds, requestNavigation]);
  return { requestNavigation: requestScopedNavigation, requestWorkspaceNavigation: requestNavigation };
}

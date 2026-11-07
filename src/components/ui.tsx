'use client';

import { useEffect, useId, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ArrowUpRight, FolderOpen, X } from 'lucide-react';
import './task-detail-actions.css';

export type CommandFn = (type: string, payload: Record<string, unknown>) => Promise<boolean>;

let openModalCount = 0;
let pageOverflowBeforeModals = '';

export function Button({ variant = 'primary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'accent' }) {
  return <button type={type} className={`btn btn-${variant} ${className}`} {...props} />;
}

export function Modal({ title, description, onClose, children, wide = false, className = '' }: { title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const headingId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (openModalCount === 0) pageOverflowBeforeModals = document.body.style.overflow;
    openModalCount++;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const key = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (event.defaultPrevented || dialogs.item(dialogs.length - 1) !== ref.current) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []).filter(el => el.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { openModalCount--; if (openModalCount === 0) document.body.style.overflow = pageOverflowBeforeModals; document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} className={`modal ${wide ? 'modal-wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1}>
    <header className="modal-heading"><div><h2 id={headingId}>{title}</h2>{description && <p>{description}</p>}</div><button type="button" className="icon-btn" aria-label="닫기" onClick={onClose}><X size={21}/></button></header>
    <div className="modal-content">{children}</div>
  </div></div>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><FolderOpen size={25} strokeWidth={1.5}/></span><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}

export function Badge({ children, tone = 'soft' }: { children: ReactNode; tone?: 'dark' | 'soft' | 'outline' | 'success' | 'info' | 'warning' }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
export function Progress({ value }: { value: number }) { const safe = Math.max(0, Math.min(100, value || 0)); return <div className="progress-track" role="progressbar" aria-label="진행률" aria-valuenow={safe} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${safe}%` }}/></div>; }
export function Field({ label, children, span = false }: { label: string; children: ReactNode; span?: boolean }) { return <label className={`field ${span ? 'field-span' : ''}`}><span>{label}</span>{children}</label>; }
export function Brand({ inverse = false }: { inverse?: boolean }) { return <span className={`brand ${inverse ? 'brand-inverse' : ''}`}><span className="brand-mark" aria-hidden="true"><i/><i/></span><span>온이음<span className="brand-period">.</span></span></span>; }
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button className="text-link" type="button" onClick={onClick}>{children}<ArrowUpRight size={15}/></button>; }
export const roleLabels: Record<string, string> = { admin: '관리자', head: '부서장', manager: '부서 담당자', lead: '팀장', member: '업무 담당자' };
export const formatDate = (value: string) => value ? new Date(value.includes('T') ? value : `${value}T12:00:00+09:00`).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }) : '미지정';

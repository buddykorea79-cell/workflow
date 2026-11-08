'use client';

import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, ChevronDown, ChevronUp, CircleHelp, FolderOpen, X } from 'lucide-react';
import { matchFieldPath, requiredTextIssues, requireText, type FieldIssue } from '@/lib/form-validation';
import './task-detail-actions.css';
import './help-callout.css';
import './read-field.css';
import { helpStorageKey, readHelpPreference, writeHelpPreference, type HelpPreference } from '@/lib/help-preferences';
import { readFieldParts } from '@/lib/read-field-text';
import { formatDateFull } from '@/lib/date-format';
import type { Workspace } from '@/lib/types';
import type { CommandExpectation } from '@/lib/command-targets';
import type { CommandFailure } from '@/lib/command-response';
export type { CommandFailure } from '@/lib/command-response';

export { requireText } from '@/lib/form-validation';
export { Tabs, useTabs, type TabItem, type TabPanelAttrs, type TabsControls } from './accessible-tabs';

export type CommandOptions = { expected?: CommandExpectation | null; silent?: boolean; onSaved?: (workspace: Workspace) => void; onConflict?: (workspace: Workspace) => void; onFailure?: (failure: CommandFailure) => void };
export type CommandFn = (type: string, payload: Record<string, unknown>, options?: CommandOptions) => Promise<boolean>;

export type HelpControls = { userId: string; reopenToken: number; triggerRef: RefObject<HTMLButtonElement | null>; reopen: () => void };

export function useHelpControls(userId: string): HelpControls {
  const [request, setRequest] = useState({ userId, token: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  return {
    userId, reopenToken: request.userId === userId ? request.token : 0, triggerRef,
    reopen: () => setRequest(previous => ({ userId, token: previous.userId === userId ? previous.token + 1 : 1 })),
  };
}

export function HelpButton({ controls, label = '도움말 다시 보기' }: { controls: HelpControls; label?: string }) {
  return <button type="button" className="help-button" ref={controls.triggerRef} aria-label={label} title={label} onClick={controls.reopen}><CircleHelp size={17} aria-hidden="true"/><span>도움말</span></button>;
}

const helpStorage = () => typeof window === 'undefined' ? undefined : window.localStorage;

export function HelpCallout({ controls, id, summary, children, className = '', persistentSummary = false }: { controls: HelpControls; id: string; summary: ReactNode; children?: ReactNode; className?: string; persistentSummary?: boolean }) {
  const key = helpStorageKey(controls.userId, id);
  const [preference, setPreference] = useState<{ key: string; value: HelpPreference }>({ key, value: 'expanded' });
  const lastRequest = useRef({ key, token: controls.reopenToken });
  const bodyId = useId();
  const summaryId = useId();
  const value = preference.key === key ? preference.value : 'expanded';
  useEffect(() => {
    setPreference({ key, value: readHelpPreference(key, helpStorage) });
  }, [key]);
  useEffect(() => {
    const previous = lastRequest.current;
    lastRequest.current = { key, token: controls.reopenToken };
    // A newly mounted conditional callout reads its preference, not an old page request.
    if (previous.key !== key || previous.token === controls.reopenToken) return;
    setPreference({ key, value: 'expanded' });
    writeHelpPreference(key, 'expanded', helpStorage);
  }, [key, controls.reopenToken]);
  const change = (next: HelpPreference) => {
    setPreference({ key, value: next });
    writeHelpPreference(key, next, helpStorage);
    if (next === 'dismissed') controls.triggerRef.current?.focus({ preventScroll: true });
  };
  if (value === 'dismissed' && !persistentSummary) return null;
  const expanded = value === 'expanded';
  return <section className={`help-callout ${persistentSummary ? 'help-callout-legend' : ''} ${className}`} data-help-id={id} data-help-state={value} aria-labelledby={summaryId}>
    <div className="help-callout-heading"><p id={summaryId} className="help-callout-summary">{summary}</p><button type="button" className="help-callout-toggle" aria-expanded={expanded} aria-controls={bodyId} onClick={() => change(expanded ? 'collapsed' : 'expanded')}>{expanded ? '접기' : persistentSummary ? '자세히' : '펼치기'}{expanded ? <ChevronUp size={14} aria-hidden="true"/> : <ChevronDown size={14} aria-hidden="true"/>}</button></div>
    <div id={bodyId} className="help-callout-body" hidden={!expanded}>{children && <div className="help-callout-copy">{children}</div>}<button type="button" className="help-callout-dismiss" onClick={() => change('dismissed')}>다시 보지 않기</button></div>
  </section>;
}

const openModals = new Set<HTMLElement>();
const dialogSelector = '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';
let pageOverflowBeforeModals = '';
const feedbackEvent = 'ieum:form-feedback';
type FormFeedback = { message: string; fields: FieldIssue[] };
const FieldErrors = createContext<FieldIssue[]>([]);

/** DOM order also covers a confirmation portaled above an existing modal. */
function topmostDialog() {
  return Array.from(document.querySelectorAll<HTMLElement>(dialogSelector)).filter(dialog => openModals.has(dialog)).at(-1);
}

/** Keep an asynchronous response attached to the dialog which submitted it. */
export function commandErrorTarget(): HTMLElement | null {
  return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).at(-1) ?? null;
}

export function showCommandError(message: string, fields: FieldIssue[] = [], target = commandErrorTarget()) {
  if (!target?.isConnected) return false;
  target.dispatchEvent(new CustomEvent<FormFeedback>(feedbackEvent, { detail: { message, fields } }));
  return true;
}

export function validateTextFields(fields: { path: string; value: string; label: string }[]) {
  const issues = requiredTextIssues(fields);
  if (!issues.length) return true;
  const target = commandErrorTarget();
  // A details tab may need to mount before its invalid input can receive focus.
  requestAnimationFrame(() => showCommandError('', issues, target));
  return false;
}

function controlsWithin(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')).filter(control => !control.matches(':disabled') && control.type !== 'hidden');
}

function controlIdentity(control: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement) {
  const field = control.closest<HTMLElement>('[data-field-path]');
  return { path: field?.dataset.fieldPath || control.name || control.id, label: field?.dataset.fieldLabel || control.getAttribute('aria-label') || '입력값' };
}

function requiredControlIssues(container: HTMLElement) {
  return controlsWithin(container).flatMap(control => {
    if (!control.required || ['checkbox', 'radio', 'file'].includes(control.type)) return [];
    const { path, label } = controlIdentity(control), message = requireText(control.value, label);
    return message ? [{ path, message }] : [];
  });
}

function invalidControlIssues(container: HTMLElement) {
  return controlsWithin(container).flatMap(control => {
    const { path, label } = controlIdentity(control);
    const requiredMessage = control.required && !['checkbox', 'radio', 'file'].includes(control.type) ? requireText(control.value, label) : '';
    const message = requiredMessage || (!control.validity.valid ? `${label} 입력값을 확인해 주세요.` : '');
    return message ? [{ path, message }] : [];
  });
}

export function Button({ variant = 'primary', className = '', type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'accent' }) {
  return <button type={type} className={`btn btn-${variant} ${className}`} {...props} />;
}

export function Modal({ title, description, onClose, children, wide = false, className = '', dirty = false, role = 'dialog', initialFocusSelector }: { title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean; className?: string; dirty?: boolean; role?: 'dialog' | 'alertdialog'; initialFocusSelector?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const requestClose = () => { if (dirty) setConfirmClose(true); else onClose(); };
  const closeRef = useRef(requestClose); closeRef.current = requestClose;
  const headingId = useId();
  const descriptionId = useId();
  const [feedback, setFeedback] = useState<FormFeedback>({ message: '', fields: [] });
  const [errorHost, setErrorHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const receive = (event: Event) => {
      const incoming = (event as CustomEvent<FormFeedback>).detail;
      const visibleFields = Array.from(dialog.querySelectorAll<HTMLElement>('[data-field-path]')).filter(field => field.closest(dialogSelector) === dialog);
      const paths = visibleFields.map(field => field.dataset.fieldPath!);
      const mapped: FieldIssue[] = [], unmapped: string[] = [];
      for (const issue of incoming.fields.slice(0, 5)) {
        const path = matchFieldPath(issue.path, paths);
        if (path) mapped.push({ path, message: issue.message }); else unmapped.push(issue.message);
      }
      if (incoming.fields.length > 5) unmapped.push(`외 ${incoming.fields.length - 5}건`);
      setFeedback({ fields: mapped, message: incoming.fields.length ? unmapped.join('\n') : incoming.message });
      requestAnimationFrame(() => {
        if (topmostDialog() !== dialog) return;
        const first = visibleFields.find(field => mapped.some(issue => issue.path === field.dataset.fieldPath));
        first?.querySelector<HTMLElement>('input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')?.focus();
        if (!first && (incoming.message || unmapped.length)) dialog.querySelector<HTMLElement>('.modal-error')?.focus();
      });
    };
    dialog.addEventListener(feedbackEvent, receive);
    return () => dialog.removeEventListener(feedbackEvent, receive);
  }, []);
  useLayoutEffect(() => {
    if (!feedback.message || !ref.current) { setErrorHost(null); return; }
    const dialog = ref.current;
    const actions = Array.from(dialog.querySelectorAll<HTMLElement>('.form-actions, .handover-form-actions, .handover-detail-actions, .pw-detail-footer, .pw-detail-actions')).filter(element => element.closest(dialogSelector) === dialog).at(-1);
    if (!actions?.parentElement) { setErrorHost(null); return; }
    const host = document.createElement('div');
    actions.before(host); setErrorHost(host);
    return () => host.remove();
  }, [feedback.message, children]);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    previousFocus.current ??= document.activeElement as HTMLElement | null;
    const previous = previousFocus.current;
    if (!openModals.size) pageOverflowBeforeModals = document.body.style.overflow;
    openModals.add(dialog);
    document.body.style.overflow = 'hidden';
    const initialFocus = initialFocusSelector ? dialog.querySelector<HTMLElement>(initialFocusSelector) : null;
    if (topmostDialog() === dialog) (initialFocus || dialog).focus();
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || topmostDialog() !== dialog) return;
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')).filter(el => el.getClientRects().length && el.closest(dialogSelector) === dialog);
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); return; }
      const outside = !dialog.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog || outside)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog || outside)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => {
      openModals.delete(dialog);
      if (!openModals.size) document.body.style.overflow = pageOverflowBeforeModals;
      document.removeEventListener('keydown', key);
      requestAnimationFrame(() => {
        const top = topmostDialog();
        if (previous?.isConnected && (!top || top.contains(previous))) previous.focus();
      });
    };
  }, []);
  const errorMessage = feedback.message && <div className="modal-error" role="alert" tabIndex={-1}>{feedback.message}</div>;
  return <><div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && topmostDialog() === ref.current) requestClose(); }}><div ref={ref} className={`modal ${wide ? 'modal-wide' : ''} ${className}`} role={role} aria-modal="true" aria-labelledby={headingId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1}
    onSubmitCapture={event => {
      if (!(event.target instanceof HTMLFormElement) || event.target.closest(dialogSelector) !== ref.current) return;
      const issues = requiredControlIssues(event.target);
      if (issues.length) { event.preventDefault(); event.stopPropagation(); showCommandError('', issues, ref.current); }
    }}
    onInvalidCapture={event => {
      const control = event.target as HTMLInputElement;
      if (control.closest(dialogSelector) !== ref.current) return;
      event.preventDefault();
      const issues = invalidControlIssues(control.form || ref.current!);
      if (!issues.length) {
        const { path, label } = controlIdentity(control);
        issues.push({ path, message: `${label} 입력값을 확인해 주세요.` });
      }
      showCommandError('', issues, ref.current);
    }}
    onChange={event => {
      const control = event.target as HTMLElement;
      if (control.closest(dialogSelector) !== ref.current) return;
      const path = control.closest<HTMLElement>('[data-field-path]')?.dataset.fieldPath;
      // Clear errors after the control has accepted its value. Updating context
      // during input capture can restore the old controlled value before onChange.
      if (path) setFeedback(current => current.fields.some(issue => issue.path === path)
        ? { ...current, fields: current.fields.filter(issue => issue.path !== path) }
        : current);
    }}>
    <header className="modal-heading"><div><h2 id={headingId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div><button type="button" className="icon-btn" aria-label={role === 'alertdialog' ? '확인창 닫고 계속 작성' : '닫기'} onClick={requestClose}><X size={21}/></button></header>
    <div className="modal-content"><FieldErrors.Provider value={feedback.fields}>{children}</FieldErrors.Provider>{errorHost ? createPortal(errorMessage, errorHost) : errorMessage}</div>
  </div></div>{confirmClose && <ConfirmDialog onCancel={() => setConfirmClose(false)} onConfirm={() => { setConfirmClose(false); onClose(); }} />}</>;
}

export function ConfirmDialog({ onCancel, onConfirm, children, title = '저장하지 않은 변경 내용이 있습니다', description = '닫으면 입력한 내용이 사라집니다.', cancelLabel = '계속 작성', confirmLabel = '저장하지 않고 닫기', destructive = true }: { onCancel: () => void; onConfirm: () => void; children?: ReactNode; title?: string; description?: string; cancelLabel?: string; confirmLabel?: string; destructive?: boolean }) {
  if (typeof document === 'undefined') return null;
  return createPortal(<Modal title={title} description={description} role="alertdialog" initialFocusSelector="[data-confirm-continue]" onClose={onCancel}>
    <div className="form-stack">{children}<div className="form-actions"><Button data-confirm-continue onClick={onCancel}>{cancelLabel}</Button><Button variant="secondary" style={destructive ? { color: '#b42318', backgroundColor: '#fff5f5', borderColor: '#f3c5c5' } : undefined} onClick={onConfirm}>{confirmLabel}</Button></div></div>
  </Modal>, document.body);
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon"><FolderOpen size={25} strokeWidth={1.5}/></span><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}

export function Badge({ children, tone = 'soft' }: { children: ReactNode; tone?: 'dark' | 'soft' | 'outline' | 'success' | 'info' | 'warning' }) { return <span className={`badge badge-${tone}`}>{children}</span>; }
export function Progress({ value }: { value: number }) { const safe = Math.max(0, Math.min(100, value || 0)); return <div className="progress-track" role="progressbar" aria-label="진행률" aria-valuenow={safe} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${safe}%` }}/></div>; }
export function ReadField({ label, value, span = false, date = false }: { label: string; value: string | number | null | undefined; span?: boolean; date?: boolean }) {
  const raw = value == null ? '' : String(value);
  const empty = !raw.trim();
  const displayed = empty ? '미입력' : date ? formatDateFull(raw) : raw;
  return <div className={`field read-field ${span ? 'field-span' : ''}`} data-field-label={label} data-read-label={label} data-read-value={raw}>
    <span className="read-field-label">{label}</span>
    <div className={`read-field-value ${empty ? 'read-field-empty' : ''}`}>{readFieldParts(displayed).map((part, index) => part.href ? <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a> : part.text)}</div>
  </div>;
}

export function FieldError({ id, children }: { id: string; children: ReactNode }) { return <small id={id} className="field-error" role="alert">{children}</small>; }

export function Field({ label, children, span = false, name, error, validationLabel }: { label: string; children: ReactNode; span?: boolean; name?: string; error?: string; validationLabel?: string }) {
  const id = useId(), path = name || id;
  const errors = useContext(FieldErrors);
  const message = error || errors.find(issue => issue.path === path)?.message;
  const errorId = `${id}-error`;
  const decorate = (nodes: ReactNode): ReactNode => Children.map(nodes, node => {
    if (!isValidElement(node) || typeof node.type !== 'string') return node;
    const child = node as ReactElement<Record<string, unknown>>;
    if (['input', 'textarea', 'select'].includes(node.type)) return cloneElement(child, {
      'aria-invalid': message ? true : child.props['aria-invalid'],
      'aria-describedby': [child.props['aria-describedby'], message ? errorId : undefined].filter(Boolean).join(' ') || undefined,
    });
    return child.props.children ? cloneElement(child, {}, decorate(child.props.children as ReactNode)) : child;
  });
  return <label className={`field ${span ? 'field-span' : ''}`} data-field-path={path} data-field-label={validationLabel || label.split(' · ')[0]}><span>{label}</span>{decorate(children)}{message && <FieldError id={errorId}>{message}</FieldError>}</label>;
}
export function Brand({ inverse = false }: { inverse?: boolean }) { return <span className={`brand ${inverse ? 'brand-inverse' : ''}`}><span className="brand-mark" aria-hidden="true"><i/><i/></span><span>온이음<span className="brand-period">.</span></span></span>; }
export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button className="text-link" type="button" onClick={onClick}>{children}<ArrowUpRight size={15}/></button>; }
export const roleLabels: Record<string, string> = { admin: '관리자', head: '부서장', manager: '부서 담당자', lead: '팀장', member: '업무 담당자' };
export { formatDate, formatDateFull, formatDateTimeFull } from '@/lib/date-format';

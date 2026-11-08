'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUpRight, FileText, FolderOpen, GitBranch, Search, UserRound, X } from 'lucide-react';
import type { Workspace } from '@/lib/types';
import { flattenSearchResults, searchWorkspace, type SearchResult } from '@/lib/search';
import './workspace-search.css';

type Props = {
  workspace: Workspace;
  onSelect: (result: SearchResult) => void;
  onOpen: () => void;
  closeSignal: number;
};

const groups = [
  { kind: 'task', label: '세부업무', icon: FileText },
  { kind: 'unit', label: '단위업무', icon: FolderOpen },
  { kind: 'common', label: '공통업무', icon: GitBranch },
  { kind: 'person', label: '사람', icon: UserRound },
] as const;
const resultKey = (result: SearchResult) => `${result.kind}:${result.id}`;
const modalIsOpen = () => !!document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]');

export function WorkspaceSearch({ workspace, onSelect, onOpen, closeSignal }: Props) {
  const id = useId();
  const listId = `${id}-results`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef(open); openRef.current = open;
  const suppressFocus = useRef(false);
  const callbacks = useRef({ onOpen, onSelect }); callbacks.current = { onOpen, onSelect };
  const matches = useMemo(() => searchWorkspace(workspace, query), [workspace, query]);
  const results = useMemo(() => flattenSearchResults(workspace, matches), [workspace, matches]);
  const activeIndex = Math.max(0, results.findIndex(result => resultKey(result) === activeKey));
  const activeResult = results[activeIndex];
  const searching = !!query.trim();

  const openSearch = useCallback(() => {
    if (modalIsOpen()) return;
    if (!openRef.current) callbacks.current.onOpen();
    openRef.current = true; setOpen(true);
    requestAnimationFrame(() => {
      if (openRef.current && !modalIsOpen()) inputRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const dismiss = useCallback((restoreFocus = false) => {
    openRef.current = false; setOpen(false);
    if (!restoreFocus) return;
    if (window.matchMedia('(max-width: 760px)').matches) triggerRef.current?.focus({ preventScroll: true });
    else {
      suppressFocus.current = true;
      inputRef.current?.focus({ preventScroll: true });
      suppressFocus.current = false;
    }
  }, []);

  useEffect(() => { dismiss(); }, [closeSignal, dismiss]);
  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || modalIsOpen()) return;
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault(); openSearch();
      } else if (event.key === 'Escape' && openRef.current) {
        event.preventDefault(); dismiss(true);
      }
    };
    const pointerdown = (event: PointerEvent) => {
      if (openRef.current && !modalIsOpen() && event.target instanceof Node && !rootRef.current?.contains(event.target)) dismiss();
    };
    const focusin = (event: FocusEvent) => {
      if (openRef.current && !modalIsOpen() && event.target instanceof Node && !rootRef.current?.contains(event.target)) dismiss();
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('pointerdown', pointerdown);
    document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('pointerdown', pointerdown);
      document.removeEventListener('focusin', focusin);
    };
  }, [dismiss, openSearch]);
  useEffect(() => {
    if (!open || !activeResult) return;
    document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }, [open, activeIndex, activeResult, id]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); dismiss(true); return;
    }
    if (event.key === 'Enter') {
      if (open && activeResult) { event.preventDefault(); callbacks.current.onSelect(activeResult); }
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if ((event.key === 'Home' || event.key === 'End') && !open) return;
    event.preventDefault();
    let next = activeIndex;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = results.length - 1;
    else if (!open) next = event.key === 'ArrowUp' ? results.length - 1 : 0;
    else if (results.length) next = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
    setActiveKey(results[next] ? resultKey(results[next]) : null);
    openSearch();
  };

  return <div ref={rootRef} className="ws-search" data-open={open || undefined}>
    <button ref={triggerRef} type="button" className="ws-search-trigger" aria-label="통합 검색 열기" aria-expanded={open} aria-controls={`${id}-panel`} onClick={openSearch}><Search size={19} aria-hidden="true"/></button>
    <div id={`${id}-panel`} className="ws-search-panel">
      <div className="ws-search-field">
        <Search size={17} aria-hidden="true"/>
        <input ref={inputRef} type="search" role="combobox" aria-label="통합 검색" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} aria-activedescendant={open && activeResult ? `${id}-option-${activeIndex}` : undefined} aria-describedby={open ? `${id}-hint` : undefined} autoComplete="off" placeholder="업무·사람 검색" value={query}
          onFocus={() => { if (!suppressFocus.current) openSearch(); }}
          onChange={event => { setQuery(event.target.value); setActiveKey(null); openSearch(); }} onKeyDown={onKeyDown}/>
        <kbd aria-hidden="true">Ctrl K</kbd>
        <button type="button" className="ws-search-mobile-close" aria-label="검색 닫기" onClick={() => dismiss(true)}><X size={18} aria-hidden="true"/></button>
      </div>
      {open && <div className="ws-search-results">
        <div className="ws-search-heading"><strong>{searching ? '검색 결과' : '최근 업무'} <span>{results.length}건</span></strong><button type="button" className="ws-search-close" aria-label="검색 닫기" onClick={() => dismiss(true)}><X size={17} aria-hidden="true"/></button></div>
        <div id={listId} role="listbox" aria-label={searching ? '통합 검색 결과' : '최근 업무'}>
          {groups.map(({ kind, label, icon: Icon }) => {
            const items = results.map((result, index) => ({ result, index })).filter(item => item.result.kind === kind);
            if (!items.length) return null;
            return <div role="group" aria-labelledby={`${id}-group-${kind}`} key={kind}>
              <div id={`${id}-group-${kind}`} className="ws-search-group">{label}<span>{items.length}건</span></div>
              {items.map(({ result, index }) => <div id={`${id}-option-${index}`} role="option" aria-selected={index === activeIndex} className="ws-search-option" key={resultKey(result)}
                onMouseDown={event => event.preventDefault()} onMouseMove={() => setActiveKey(resultKey(result))} onClick={() => callbacks.current.onSelect(result)}>
                <Icon size={18} aria-hidden="true"/><span><strong>{result.title}</strong>{result.description && <small>{result.description}</small>}</span><ArrowUpRight size={15} aria-hidden="true"/>
              </div>)}
            </div>;
          })}
        </div>
        {!results.length && <p className="ws-search-empty" role="status">{searching ? '일치하는 업무나 사람이 없습니다.' : '최근 업무가 없습니다.'}</p>}
        <p id={`${id}-hint`} className="ws-search-hint">↑↓ 선택 · Enter 이동 · Esc 닫기</p>
      </div>}
    </div>
  </div>;
}

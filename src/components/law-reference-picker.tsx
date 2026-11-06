'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Landmark, LoaderCircle, Search, X } from 'lucide-react';
import type { LawDetail, LawKind, LawSearchItem, LawSearchResult, LawSearchScope } from '@/lib/law-api-types';
import type { TaskReference } from '@/lib/types';
import { importLawArticles, lawArticleLabel } from '@/lib/law-reference-import';
import { Button, Field } from './ui';
import './law-reference-picker.css';

type LookupError = { message: string; code?: string };
const displayDate = (value: string) => value || '미제공';

export function LawReferencePicker({ taskId, references, disabled = false, onChange }: {
  taskId: string; references: TaskReference[]; disabled?: boolean; onChange: (references: TaskReference[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LawKind>('law');
  const [scope, setScope] = useState<LawSearchScope>('title');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LawSearchResult | null>(null);
  const [detail, setDetail] = useState<LawDetail | null>(null);
  const [articleQuery, setArticleQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busy, setBusy] = useState<'search' | 'detail' | ''>('');
  const [error, setError] = useState<LookupError | null>(null);
  const [notice, setNotice] = useState('');
  const request = useRef<AbortController | null>(null);
  const locked = disabled || !!busy;
  const normalizedQuery = articleQuery.trim().toLocaleLowerCase('ko-KR');
  const visibleArticles = detail?.articles.filter(article => !normalizedQuery || `${article.number} ${article.title} ${article.content}`.toLocaleLowerCase('ko-KR').includes(normalizedQuery)) || [];
  const lastPage = results ? Math.max(1, Math.ceil(results.total / results.pageSize)) : 1;
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { request.current?.abort(); setBusy(''); setOpen(false); setResults(null); setDetail(null); setError(null); setNotice(''); setSelectedIds([]); }, [taskId]);
  useEffect(() => { if (disabled) { request.current?.abort(); setBusy(''); } }, [disabled]);

  function close() { request.current?.abort(); setBusy(''); setOpen(false); }
  function changeKind(value: LawKind) { setKind(value); setResults(null); setDetail(null); setSelectedIds([]); setError(null); setNotice(''); }

  async function search(page = 1, current = { kind, scope, query: query.trim() }) {
    if (disabled || !current.query || current.query.length > 100) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy('search'); setError(null); setNotice(''); setDetail(null); setSelectedIds([]);
    try {
      const params = new URLSearchParams({ taskId, action: 'search', ...current, page: String(page) });
      const response = await fetch(`/api/law?${params}`, { signal: controller.signal, cache: 'no-store' });
      const body = await response.json() as LawSearchResult & { error?: string; code?: string };
      if (!response.ok) { if (!controller.signal.aborted) setError({ message: body.error || '법령정보센터 검색을 완료하지 못했습니다.', code: body.code }); return; }
      if (!Array.isArray(body.items)) throw new Error('검색 결과의 형식을 확인하지 못했습니다. 다시 검색해 주세요.');
      if (!controller.signal.aborted) setResults(body);
    } catch (cause) { if (!controller.signal.aborted) setError({ message: cause instanceof Error ? cause.message : '검색을 완료하지 못했습니다. 다시 시도해 주세요.' }); }
    finally { if (request.current === controller) { setBusy(''); request.current = null; } }
  }

  async function loadDetail(item: LawSearchItem) {
    if (locked) return;
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setBusy('detail'); setError(null); setNotice(''); setDetail(null); setSelectedIds([]); setArticleQuery('');
    try {
      const params = new URLSearchParams({ taskId, action: 'detail', kind: item.kind, id: item.id });
      const response = await fetch(`/api/law?${params}`, { signal: controller.signal, cache: 'no-store' });
      const body = await response.json() as LawDetail & { error?: string; code?: string };
      if (!response.ok) { if (!controller.signal.aborted) setError({ message: body.error || '조문을 불러오지 못했습니다.', code: body.code }); return; }
      if (!Array.isArray(body.articles)) throw new Error('조문 본문의 형식을 확인하지 못했습니다. 다시 조회해 주세요.');
      if (!controller.signal.aborted) setDetail(body);
    } catch (cause) { if (!controller.signal.aborted) setError({ message: cause instanceof Error ? cause.message : '조문을 불러오지 못했습니다. 다시 시도해 주세요.' }); }
    finally { if (request.current === controller) { setBusy(''); request.current = null; } }
  }

  function addSelected() {
    if (!detail || locked) return;
    setError(null); setNotice('');
    try {
      const imported = importLawArticles(references, detail, selectedIds);
      if (imported.addedCount) onChange(imported.references);
      setSelectedIds([]);
      setNotice(imported.addedCount ? `${imported.addedCount}개 조문을 아래 관련 근거에 추가했습니다.${imported.duplicateCount ? ` 이미 있는 ${imported.duplicateCount}개 조문은 제외했습니다.` : ''} 변경사항 저장을 눌러 반영해 주세요.` : '선택한 조문은 이미 관련 근거에 있습니다. 중복으로 추가하지 않았습니다.');
    } catch (cause) { setError({ message: cause instanceof Error ? cause.message : '조문을 추가하지 못했습니다.' }); }
  }

  return <section className="law-lookup" aria-label="법령정보센터 검색">
    <div className="law-lookup-intro"><div><Landmark size={20}/><div><h4>법령·행정규칙에서 근거 찾기</h4><p>키워드로 검색하고 필요한 조문을 선택하면 원문 내용과 출처를 가져옵니다.</p></div></div><Button variant="secondary" disabled={disabled} onClick={() => open ? close() : setOpen(true)}>{open ? <X size={16}/> : <Search size={16}/>} {open ? '검색 닫기' : '법령·행정규칙 검색'}</Button></div>
    {open && <div className="law-lookup-content">
      <div className="law-search-controls">
        <Field label="자료 종류"><select value={kind} disabled={locked} onChange={event => changeKind(event.target.value as LawKind)}><option value="law">법령</option><option value="admrul">행정규칙</option></select></Field>
        <Field label="검색 범위"><select value={scope} disabled={locked} onChange={event => setScope(event.target.value as LawSearchScope)}><option value="title">제목</option><option value="content">본문</option></select></Field>
        <Field label="검색 키워드"><input value={query} disabled={locked} maxLength={100} placeholder="예: 통계, 개인정보 보호, 기록물 관리" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (!locked) void search(); } }}/></Field>
        <Button disabled={locked || !query.trim()} onClick={() => void search()}>{busy === 'search' ? <LoaderCircle size={16} className="spin"/> : <Search size={16}/>} 검색</Button>
      </div>
      <p className="law-lookup-note">국가법령정보센터에서 조회한 자료입니다. 시행일과 적용 범위를 확인한 뒤 업무의 근거로 선택해 주세요.</p>
      {error && <div className="law-lookup-error" role="alert"><p>{error.message}</p>{error.code === 'LAW_NOT_CONFIGURED' && <p>관리자는 국가법령정보 공동활용에서 발급한 인증값을 서버 환경변수 <code>LAW_API_OC</code>에 설정해야 합니다. Vercel에서는 저장 후 재배포해 주세요. <a href="https://open.law.go.kr/LSO/openApi/guideList.do" target="_blank" rel="noreferrer">공식 API 안내 <ExternalLink size={13}/></a></p>}</div>}
      {notice && <p className="law-lookup-notice" role="status">{notice}</p>}
      {busy === 'detail' && <p className="law-lookup-loading" role="status"><LoaderCircle size={17} className="spin"/>조문을 불러오고 있습니다.</p>}
      {results && !detail && <section className="law-search-results" aria-label="법령 검색 결과"><div className="law-results-heading"><strong>“{results.query}” 검색 결과 · {results.total.toLocaleString('ko-KR')}건</strong><span>{results.page} / {lastPage}쪽</span></div>
        {!results.items.length ? <p className="law-lookup-empty">검색 결과가 없습니다. 다른 키워드나 검색 범위로 찾아보세요.</p> : <ul>{results.items.map(item => <li key={`${item.kind}-${item.id}`}><div><strong>{item.title}</strong><p>{[item.category, item.ministry].filter(Boolean).join(' · ') || '소관기관 정보 미제공'}</p><small>시행 {displayDate(item.effectiveDate)} · 공포·발령 {displayDate(item.promulgationDate)}</small></div><Button variant="secondary" disabled={locked} onClick={() => void loadDetail(item)} aria-label={`${item.title} 조문 보기`}>조문 보기<ChevronRight size={15}/></Button></li>)}</ul>}
        {lastPage > 1 && <nav className="law-results-pagination" aria-label="법령 검색 페이지"><Button variant="ghost" disabled={locked || results.page <= 1} onClick={() => void search(results.page - 1, { kind: results.kind, scope: results.scope, query: results.query })}><ChevronLeft size={16}/>이전</Button><span>{results.page} / {lastPage}</span><Button variant="ghost" disabled={locked || results.page >= lastPage} onClick={() => void search(results.page + 1, { kind: results.kind, scope: results.scope, query: results.query })}>다음<ChevronRight size={16}/></Button></nav>}
      </section>}
      {detail && <section className="law-article-picker" aria-label="가져올 조문 선택"><header><div><h4>{detail.title}</h4><p>{[detail.category, detail.ministry].filter(Boolean).join(' · ')} · 시행 {displayDate(detail.effectiveDate)}</p><a href={detail.sourceUrl} target="_blank" rel="noreferrer">국가법령정보센터 원문 <ExternalLink size={13}/></a></div><Button variant="ghost" disabled={locked} onClick={() => { setDetail(null); setSelectedIds([]); setError(null); }}>검색 결과로</Button></header>
        {detail.warnings.length > 0 && <ul className="law-detail-warnings">{detail.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
        <Field label="이 법령·규칙 안에서 조문 찾기"><input value={articleQuery} disabled={locked} placeholder="조문 번호·제목·본문의 키워드" maxLength={100} onChange={event => setArticleQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }}/></Field>
        <div className="law-selection-heading"><span>표시 {visibleArticles.length}개 · 선택 {selectedIds.length}개</span><Button variant="ghost" disabled={locked || !visibleArticles.length} onClick={() => setSelectedIds(current => visibleArticles.every(article => current.includes(article.id)) ? current.filter(id => !visibleArticles.some(article => article.id === id)) : [...new Set([...current, ...visibleArticles.map(article => article.id)])])}>{visibleArticles.length > 0 && visibleArticles.every(article => selectedIds.includes(article.id)) ? '표시된 조문 선택 해제' : '표시된 조문 전체 선택'}</Button></div>
        <div className="law-article-list">{visibleArticles.length ? visibleArticles.map(article => <article key={article.id}><label className="law-article-select"><input type="checkbox" checked={selectedIds.includes(article.id)} disabled={locked} onChange={event => setSelectedIds(current => event.target.checked ? [...current, article.id] : current.filter(id => id !== article.id))}/><strong>{lawArticleLabel(article) || '본문'}</strong></label><details><summary>조문 본문 보기</summary><pre>{article.content}</pre></details></article>) : <p className="law-lookup-empty">일치하는 조문이 없습니다. 검색어를 지우거나 원문을 확인해 주세요.</p>}</div>
        <div className="law-import-action"><p>선택한 조문은 각각 새 근거로 추가됩니다. 기존 근거와 첨부파일은 유지됩니다.</p><Button disabled={locked || !selectedIds.length} onClick={addSelected}>선택한 {selectedIds.length}개 조문을 근거에 추가</Button></div>
      </section>}
    </div>}
  </section>;
}

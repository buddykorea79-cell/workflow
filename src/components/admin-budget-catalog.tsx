'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileJson, Pencil, Plus, Search, Upload, Wallet } from 'lucide-react';
import type { Workspace } from '@/lib/types';
import type { BudgetCatalog, BudgetCatalogItem } from '@/lib/budget-types';
import type { CommandTarget } from '@/lib/command-targets';
import { Badge, Button, EmptyState, Field, Modal, type CommandFn } from './ui';
import { useRevisionCommand } from './command-revision';
import { useUnsavedChanges, useUnsavedNavigation } from './unsaved-changes';
import './admin-budget-catalog.css';

type Props = { workspace: Workspace; command: CommandFn };
type CatalogPage = { items: BudgetCatalogItem[]; total: number; page: number; pageSize: number; years: number[]; source?: { fileName?: string }; revision: number; catalogRev?: number };
type ImportPreview = { id: string; fileName: string; catalog: unknown; count: number; year: number; duplicates: number; baseline: BudgetCatalog };
type CatalogWorkspace = Workspace & { budgetCatalog?: BudgetCatalog };
const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;

function itemCatalog(item: BudgetCatalogItem, rev = 0): BudgetCatalog {
  return { schemaVersion: 1, year: item.year, source: { fileName: '예산 원장' }, rev, items: [item] };
}

async function fetchCatalog(): Promise<BudgetCatalog> {
  const response = await fetch('/api/budgets?export=true', { cache: 'no-store' });
  const catalog = await response.json();
  if (!response.ok) throw new Error(catalog.error || '최신 예산 원장을 불러오지 못했습니다.');
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.items)) throw new Error('예산 원장 응답을 확인하지 못했습니다. 다시 조회해 주세요.');
  return catalog;
}

/** The normal workspace deliberately omits this admin-only catalog. */
function useBudgetRevision(workspace: Workspace, command: CommandFn, baseline: BudgetCatalog, target: CommandTarget) {
  const [catalog, setCatalog] = useState(baseline);
  const catalogRef = useRef(catalog); catalogRef.current = catalog;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [loadingConflict, setLoadingConflict] = useState(false);
  const [conflictCatalogReady, setConflictCatalogReady] = useState(false);
  const [conflictError, setConflictError] = useState('');
  const conflictRequest = useRef<{ workspace: Workspace; callback?: (value: Workspace) => void } | null>(null);
  const fetchGeneration = useRef(0);
  async function loadConflict() {
    const request = conflictRequest.current;
    if (!request) return;
    const generation = ++fetchGeneration.current;
    setLoadingConflict(true); setConflictCatalogReady(false); setConflictError('');
    try {
      const latest = await fetchCatalog();
      if (!mounted.current || generation !== fetchGeneration.current) return;
      catalogRef.current = latest; setCatalog(latest); setConflictCatalogReady(true);
      const hydrated: CatalogWorkspace = { ...request.workspace, budgetCatalog: latest };
      request.callback?.(hydrated);
    } catch (cause) { if (mounted.current && generation === fetchGeneration.current) setConflictError(cause instanceof Error ? cause.message : '최신 원장을 조회하지 못했습니다.'); }
    finally { if (mounted.current && generation === fetchGeneration.current) setLoadingConflict(false); }
  }
  const withCatalog: CommandFn = async (type, payload, options) => {
    let conflictFetch: Promise<void> | undefined;
    const saved = await command(type, payload, { ...options,
      onSaved: updated => {
        if (!mounted.current) return;
        const previous = catalogRef.current;
        let items = previous.items;
        if (type === 'budget.upsert') {
          const submitted = payload.item as BudgetCatalogItem;
          items = items.some(item => item.id === submitted.id) ? items.map(item => item.id === submitted.id ? { ...submitted, rev: item.rev } : item) : [...items, { ...submitted, rev: 0 }];
        } else if (type === 'budget.setActive') items = items.map(item => item.id === payload.id ? { ...item, active: payload.active as boolean } : item);
        else if (type === 'budget.import') {
          const imported = payload.catalog as BudgetCatalog;
          const incoming = new Map(imported.items.map(item => [item.id, item]));
          items = [...items.map(item => incoming.has(item.id) ? { ...incoming.get(item.id)!, rev: item.rev } : item), ...imported.items.filter(item => !items.some(current => current.id === item.id)).map(item => ({ ...item, rev: 0 }))];
        }
        // Only this command's receipts advance the snapshot; a later full read may include someone else's edit.
        const changes = updated.commandChanges || [];
        const next: BudgetCatalog = { ...previous, rev: changes.find(change => change.kind === 'budgetCatalog' && change.id === 'catalog')?.toRev ?? previous.rev, items: items.map(item => ({ ...item, rev: changes.find(change => change.kind === 'budgetItem' && change.id === item.id)?.toRev ?? item.rev })) };
        catalogRef.current = next; setCatalog(next);
        const hydrated: CatalogWorkspace = { ...updated, budgetCatalog: next };
        options?.onSaved?.(hydrated);
      },
      onConflict: latest => {
        if (!mounted.current) return;
        conflictRequest.current = { workspace: latest, callback: options?.onConflict };
        // Block another save immediately, even if the separate catalog fetch fails.
        const blocked: CatalogWorkspace = { ...latest, budgetCatalog: undefined };
        options?.onConflict?.(blocked);
        conflictFetch = loadConflict();
      },
    });
    await conflictFetch;
    return saved;
  };
  const revision = useRevisionCommand({ ...workspace, budgetCatalog: catalog }, withCatalog, target);
  const feedback = <>{loadingConflict && <p role="status">최신 예산 원장을 확인하고 있습니다.</p>}{conflictError && <div className="form-error" role="alert"><p>{conflictError}</p><Button variant="secondary" disabled={loadingConflict} onClick={() => void loadConflict()}>최신 원장 다시 조회</Button></div>}</>;
  return { ...revision, feedback, loadingConflict, catalog, conflictCatalogReady };
}

export function AdminBudgetCatalog({ workspace, command }: Props) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [year, setYear] = useState('2026');
  const [page, setPage] = useState(1);
  const [includeInactive, setIncludeInactive] = useState(true);
  const [data, setData] = useState<CatalogPage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<BudgetCatalogItem | 'new' | null>(null);
  const [importing, setImporting] = useState<ImportPreview | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importRead = useRef(0);
  useEffect(() => () => { importRead.current += 1; }, []);
  const { requestNavigation } = useUnsavedNavigation();

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    const params = new URLSearchParams({ query: search, year, page: String(page), includeInactive: String(includeInactive) });
    void (async () => {
      try {
        const response = await fetch(`/api/budgets?${params}`, { signal: controller.signal, cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '예산 목록을 불러오지 못했습니다.');
        if (!controller.signal.aborted) setData(result);
      } catch (issue) {
        if (!controller.signal.aborted) setError(issue instanceof Error ? issue.message : '예산 목록을 확인해 주세요.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [search, year, page, includeInactive, workspace.revision]);

  async function prepareImport(file?: File) {
    if (!file) return;
    const reading = ++importRead.current;
    setError('');
    try {
      if (file.size > 2_800_000) throw new Error('JSON 파일은 2.8MB 이하로 선택해 주세요.');
      const catalog = JSON.parse(await file.text());
      if (!catalog || catalog.schemaVersion !== 1 || !Number.isInteger(catalog.year) || !Array.isArray(catalog.items) || !catalog.items.length) throw new Error('schemaVersion, year, source, items를 포함한 예산 원장 JSON을 선택해 주세요.');
      const ids = catalog.items.map((item: { id?: unknown }) => item?.id);
      const duplicates = ids.length - new Set(ids).size;
      const baseline = await fetchCatalog();
      if (reading !== importRead.current) return;
      requestNavigation(() => setImporting({ id: crypto.randomUUID(), fileName: file.name, catalog, count: ids.length, year: catalog.year, duplicates, baseline }));
    } catch (issue) { if (reading === importRead.current) setError(issue instanceof SyntaxError ? 'JSON 문법을 확인해 주세요.' : issue instanceof Error ? issue.message : '파일을 읽지 못했습니다.'); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  }

  return <section className="admin-budget" aria-label="예산 원장 관리">
    <header className="ab-heading"><div><p className="ab-eyebrow"><Wallet size={17}/> 예산 원장</p><h2>사업별 확정 예산을 관리하세요</h2><p>세부업무에서 검색해 연결할 예산의 분류와 확정액을 관리합니다.</p></div><div className="ab-actions">
      <a className="btn btn-secondary" href="/api/budgets?export=true" download="온이음-예산원장.json"><Download size={16}/>JSON 다운로드</a>
      <Button variant="secondary" onClick={() => fileInput.current?.click()}><Upload size={16}/>JSON 가져오기</Button>
      <Button onClick={() => setEditing('new')}><Plus size={16}/>예산 추가</Button>
      <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="예산 원장 JSON 파일" onChange={event => void prepareImport(event.target.files?.[0])}/>
    </div></header>
    <div className="ab-source"><FileJson size={21}/><div><strong>{data?.source?.fileName || '2026년 예산 개요.pdf'}</strong><p>원문 백만원 금액을 원 단위로 변환해 제공합니다. 수정한 원장과 이미 업무에 연결한 예산은 별도로 보관됩니다.</p></div></div>
    <form className="ab-search" onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setPage(1); }}>
      <Field label="회계연도"><select value={year} onChange={event => { setYear(event.target.value); setPage(1); }}>{[...new Set([2026, Number(year), ...(data?.years || [])])].sort((a, b) => b - a).map(value => <option key={value} value={value}>{value}년</option>)}</select></Field>
      <Field label="예산 검색"><input value={query} maxLength={100} onChange={event => setQuery(event.target.value)} placeholder="분야, 부문, 프로그램, 세부사업명 또는 코드"/></Field>
      <Button type="submit" variant="secondary" disabled={loading}><Search size={17}/>검색</Button>
      <label className="ab-check"><input type="checkbox" checked={includeInactive} onChange={event => { setIncludeInactive(event.target.checked); setPage(1); }}/>검색 제외 항목 포함</label>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="ab-results-heading"><strong>{year}년 예산 <span>{data?.total.toLocaleString('ko-KR') ?? '—'}건</span></strong><span>{loading ? '목록을 불러오는 중…' : '금액 단위: 원'}</span></div>
    {!loading && !error && data?.total === 0 ? <EmptyState title="조건에 맞는 예산이 없습니다." description="키워드를 바꾸거나 새로운 예산 항목을 등록하세요."/> : <div className="ab-table-wrap" aria-busy={loading}><table className="ab-table"><thead><tr><th>분야 · 부문</th><th>프로그램 · 단위사업</th><th>세부사업명</th><th>확정 예산</th><th>관리</th></tr></thead><tbody>{data?.items.map(item => <tr key={item.id} className={item.active === false ? 'ab-inactive' : ''}>
      <td><strong>{item.field}</strong><span>{item.sector}</span><small>{item.account}</small></td>
      <td><strong>{item.program}</strong>{item.unitProject && <span>{item.unitProject}</span>}</td>
      <td><strong>{item.projectName}</strong><div className="ab-row-badges">{item.projectCode && <small>{item.projectCode}</small>}{item.active === false && <Badge tone="outline">검색 제외</Badge>}{item.updatedAt && <Badge tone="soft">관리자 반영</Badge>}</div>{item.sourcePage && <small>PDF {item.sourcePage}쪽{item.sourcePrintedPage !== undefined ? ` · 인쇄 ${item.sourcePrintedPage}쪽` : ''}</small>}</td>
      <td className="ab-amount">{won(item.confirmedAmountWon)}</td>
      <td><div className="ab-row-actions"><Button variant="secondary" onClick={() => setEditing(item)} aria-label={`${item.projectName} 예산 수정`}><Pencil size={14}/>수정</Button><BudgetStatusButton workspace={workspace} command={command} item={item} catalogRev={data?.catalogRev} /></div></td>
    </tr>)}</tbody></table></div>}
    <div className="ab-pagination"><Button variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16}/>이전</Button><span>{page} / {Math.max(1, Math.ceil((data?.total || 0) / (data?.pageSize || 20)))}</span><Button variant="secondary" disabled={loading || !data || page * data.pageSize >= data.total} onClick={() => setPage(value => value + 1)}>다음<ChevronRight size={16}/></Button></div>
    <p className="ab-note">검색에서 제외한 항목도 원장과 기존 업무에는 남습니다. 기존 업무의 확정 예산을 바꾸려면 해당 업무에서 예산을 다시 선택·저장하세요.</p>
    {editing && <BudgetItemForm key={editing === 'new' ? 'new' : editing.id} workspace={workspace} item={editing === 'new' ? undefined : editing} catalogRev={data?.catalogRev} year={Number(year)} command={command} onClose={() => setEditing(null)}/>}
    {importing && <BudgetImportForm key={importing.id} workspace={workspace} command={command} preview={importing} onClose={() => setImporting(null)} onImported={() => { setYear(String(importing.year)); setPage(1); setImporting(null); }} />}
  </section>;
}

function BudgetStatusButton({ workspace, command, item, catalogRev }: Props & { item: BudgetCatalogItem; catalogRev?: number }) {
  const revision = useBudgetRevision(workspace, command, itemCatalog(item, catalogRev), { kind: 'budgetItem', id: item.id });
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [pendingActive, setPendingActive] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function change(active: boolean) {
    if (saving || revision.conflicted) return;
    setPendingActive(active); setSaving(true); setError('');
    try {
      const saved = await revision.command('budget.setActive', { id: item.id, active }, { ...(!reviewing ? { expected: { kind: 'budgetItem' as const, id: item.id, rev: item.rev ?? 0 } } : {}), onConflict: () => { if (mounted.current) setReviewing(true); } });
      if (!mounted.current) return;
      if (saved) { setReviewing(false); setPendingActive(null); }
      else { setError('검색 표시 상태를 변경하지 못했습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.'); setReviewing(true); }
    } catch (cause) { if (mounted.current) { setError(cause instanceof Error ? cause.message : '검색 표시 상태를 변경하지 못했습니다.'); setReviewing(true); } }
    finally { if (mounted.current) setSaving(false); }
  }
  return <><Button variant="ghost" disabled={saving} onClick={() => { if (revision.conflicted) setReviewing(true); else void change(item.active === false); }}>{saving ? '저장 중…' : revision.conflicted ? '변경 내용 확인' : item.active === false ? '검색에 포함' : '검색 제외'}</Button>{reviewing && <Modal title="예산 검색 표시 변경" description={item.projectName} onClose={() => setReviewing(false)}><div className="form-stack"><p>요청한 변경: {pendingActive ? '세부업무 예산 검색에 포함' : '세부업무 예산 검색에서 제외'}</p>{revision.conflict}{revision.feedback}{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><Button variant="secondary" onClick={() => setReviewing(false)}>닫기</Button><Button disabled={saving || revision.conflicted || revision.loadingConflict || pendingActive === null} onClick={() => { if (pendingActive !== null) void change(pendingActive); }}>{saving ? '저장 중…' : '확인한 변경 저장'}</Button></div></div></Modal>}</>;
}

function BudgetImportForm({ workspace, command, preview, onClose, onImported }: Props & { preview: ImportPreview; onClose: () => void; onImported: () => void }) {
  const revision = useBudgetRevision(workspace, command, preview.baseline, { kind: 'budgetCatalog', id: 'catalog' });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const draftId = useUnsavedChanges(!saved, '가져올 예산 원장');
  const { requestNavigation, clearDraft } = useUnsavedNavigation();
  const closeImport = () => requestNavigation(() => { clearDraft(draftId); onClose(); });
  async function submit() {
    if (saving || saved || preview.duplicates || revision.conflicted || revision.loadingConflict) return;
    setSaving(true); setError('');
    try {
      const imported = await revision.command('budget.import', { catalog: preview.catalog }, { onSaved: () => {
        if (!mounted.current) return;
        setSaved(true); clearDraft(draftId);
      } });
      if (!mounted.current) return;
      if (imported) onImported();
      else setError('예산 원장을 가져오지 못했습니다. 미리보기는 유지했습니다. 안내 내용을 확인해 주세요.');
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '예산 원장을 가져오지 못했습니다.'); }
    finally { if (mounted.current) setSaving(false); }
  }
  return <Modal title="예산 원장 가져오기" description="항목 ID가 같으면 갱신하고, 새로운 ID는 추가합니다. 파일에 없는 기존 항목은 유지됩니다." onClose={closeImport}><div className="form-stack"><div className="ab-import-preview"><FileJson size={28}/><strong>{preview.fileName}</strong><p>{preview.year}년 · {preview.count.toLocaleString()}개 항목</p></div>{preview.duplicates > 0 && <p className="form-error" role="alert">중복 ID가 {preview.duplicates}개 있습니다. 파일을 정리한 뒤 다시 선택하세요.</p>}<p className="ab-note">분류·금액·중복 여부를 서버에서 확인한 후 한 번에 반영합니다. 기존 업무에 연결된 예산과 집행 기록은 유지됩니다.</p>{revision.conflicted && revision.conflictCatalogReady && <BudgetImportComparison incoming={preview.catalog} latest={revision.catalog} />}{revision.conflict}{revision.feedback}{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><Button variant="secondary" onClick={closeImport}>닫기</Button><Button disabled={saving || saved || preview.duplicates > 0 || revision.conflicted || revision.loadingConflict} onClick={() => void submit()}>{saving ? '가져오는 중…' : `${preview.count.toLocaleString()}건 가져오기`}</Button></div></div></Modal>;
}

function BudgetImportComparison({ incoming, latest }: { incoming: unknown; latest: BudgetCatalog }) {
  const items = ((incoming as { items?: unknown[] })?.items || []).filter((item): item is BudgetCatalogItem => !!item && typeof item === 'object');
  const current = new Map(latest.items.map(item => [item.id, item]));
  const summary = (item?: BudgetCatalogItem) => item ? `${[item.year, item.account, item.field, item.sector, item.program, item.unitProject, item.projectName, item.projectCode].filter(Boolean).join(' · ')}\n확정 예산: ${typeof item.confirmedAmountWon === 'number' ? won(item.confirmedAmountWon) : '금액 확인 필요'} · ${item.active === false ? '검색 제외' : '검색 포함'}${item.sourcePage ? ` · PDF ${item.sourcePage}쪽` : ''}` : '기존 항목 없음 · 새로 추가';
  const differences = items.filter(item => summary(item) !== summary(current.get(item.id)));
  return <details open><summary>가져올 값과 최신 원장 비교 · {differences.length.toLocaleString()}건 차이</summary>{differences.length ? <div className="ab-table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}><table className="ab-table"><thead><tr><th>서버 최신 값</th><th>가져올 파일의 값</th></tr></thead><tbody>{differences.slice(0, 50).map((item, index) => <tr key={`${item.id}-${index}`}><td style={{ whiteSpace: 'pre-wrap' }}>{summary(current.get(item.id))}</td><td style={{ whiteSpace: 'pre-wrap' }}>{summary(item)}</td></tr>)}</tbody></table></div> : <p>가져올 항목의 분류·금액·검색 상태는 최신 원장과 같습니다. 파일에 없는 항목은 유지됩니다.</p>}{differences.length > 50 && <p>앞의 50건을 표시했습니다. 전체 비교가 필요하면 <a href="/api/budgets?export=true" download="온이음-최신예산원장.json">최신 원장 전체 다운로드</a>를 이용해 주세요.</p>}</details>;
}

function BudgetItemForm({ workspace, item, year, catalogRev, command, onClose }: Props & { item?: BudgetCatalogItem; year: number; catalogRev?: number; onClose: () => void }) {
  const [draft, setDraft] = useState<BudgetCatalogItem>(() => item ? structuredClone(item) : { id: `budget-manual-${crypto.randomUUID()}`, year, account: '', field: '', sector: '', program: '', projectName: '', confirmedAmountWon: 0, active: true });
  const [amount, setAmount] = useState(String(draft.confirmedAmountWon));
  const [sourcePage, setSourcePage] = useState(String(draft.sourcePage ?? ''));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [persisted, setPersisted] = useState(!!item);
  const [savedNotice, setSavedNotice] = useState('');
  const revision = useBudgetRevision(workspace, command, itemCatalog(item || { ...draft, rev: 0 }, catalogRev), { kind: 'budgetItem', id: draft.id });
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const draftSnapshot = JSON.stringify({ draft, amount, sourcePage });
  const draftRef = useRef(draftSnapshot); draftRef.current = draftSnapshot;
  const [savedSnapshot, setSavedSnapshot] = useState(draftSnapshot);
  const draftId = useUnsavedChanges(draftSnapshot !== savedSnapshot, '예산 항목');
  const { requestNavigation, clearDraft } = useUnsavedNavigation();
  const closeEditor = () => requestNavigation(() => { clearDraft(draftId); onClose(); });
  return <Modal title={persisted ? '예산 항목 수정' : '예산 항목 추가'} description="확정 예산은 원 단위로 입력합니다. 기존 업무에 연결된 예산은 자동으로 변경되지 않습니다." onClose={closeEditor} wide><form className="form-stack" onSubmit={async event => {
    event.preventDefault(); if (saving || revision.conflicted || revision.loadingConflict) return; setError('');
    const value = Number(amount); const page = sourcePage ? Number(sourcePage) : undefined;
    if (!amount.trim() || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000_000) { setError('확정 예산은 0 이상인 원 단위 정수로 입력해 주세요.'); return; }
    if (page !== undefined && (!Number.isInteger(page) || page < 1)) { setError('PDF 페이지는 1 이상의 정수로 입력해 주세요.'); return; }
    const submittedDraft = draftSnapshot;
    let closeAfterSave = false;
    setSaving(true); setSavedNotice('');
    try {
      const saved = await revision.command('budget.upsert', { item: { ...draft, confirmedAmountWon: value, sourcePage: page, active: draft.active !== false } }, { onSaved: () => {
        if (!mounted.current) return;
        closeAfterSave = draftRef.current === submittedDraft;
        setSavedSnapshot(submittedDraft); setPersisted(true);
        setSavedNotice('요청한 예산을 저장했습니다. 이후 작성한 내용은 한 번 더 저장해 주세요.');
      } });
      if (!mounted.current) return;
      if (saved && closeAfterSave) { clearDraft(draftId); onClose(); }
      else if (!saved) setError('예산을 저장하지 못했습니다. 입력값은 유지했으니 안내 내용을 확인해 주세요.');
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : '예산을 저장하지 못했습니다.'); }
    finally { if (mounted.current) setSaving(false); }
  }}><div className="form-grid">
    <Field label="회계연도"><input required type="number" min={2000} max={2100} value={draft.year} onChange={event => setDraft(current => ({ ...current, year: Number(event.target.value) }))}/></Field>
    {([['account', '회계'], ['field', '분야'], ['sector', '부문'], ['program', '프로그램'], ['unitProject', '단위사업'], ['projectName', '세부사업명'], ['projectCode', '세부사업 코드']] as const).map(([key, label]) => <Field key={key} label={label} span={key === 'projectName'}><input required={!['unitProject', 'projectCode'].includes(key)} maxLength={300} value={draft[key] ?? ''} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))}/></Field>)}
    <Field label="확정 예산 (원)"><input type="number" min={0} step={1} required value={amount} onChange={event => setAmount(event.target.value)}/><small>{Number.isFinite(Number(amount)) ? won(Number(amount)) : '금액을 확인해 주세요.'}</small></Field>
    <Field label="출처 PDF 페이지 · 선택"><input type="number" min={1} step={1} value={sourcePage} onChange={event => setSourcePage(event.target.value)}/></Field>
  </div><label className="ab-check"><input type="checkbox" checked={draft.active !== false} onChange={event => setDraft(current => ({ ...current, active: event.target.checked }))}/>세부업무 예산 검색에 표시</label>{revision.conflict}{revision.feedback}{error && <p className="form-error" role="alert">{error}</p>}{savedNotice && <p role="status">{savedNotice}</p>}<div className="form-actions"><Button variant="secondary" onClick={closeEditor}>닫기</Button><Button type="submit" disabled={saving || revision.conflicted || revision.loadingConflict}>{saving ? '저장 중…' : '예산 저장'}</Button></div></form></Modal>;
}

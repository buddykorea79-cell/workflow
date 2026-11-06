'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileJson, Pencil, Plus, Search, Upload, Wallet } from 'lucide-react';
import type { Workspace } from '@/lib/types';
import type { BudgetCatalogItem } from '@/lib/budget-types';
import { Badge, Button, EmptyState, Field, Modal } from './ui';
import './admin-budget-catalog.css';

type Props = { workspace: Workspace; command: (type: string, payload: Record<string, unknown>) => Promise<boolean> };
type CatalogPage = { items: BudgetCatalogItem[]; total: number; page: number; pageSize: number; years: number[]; source?: { fileName?: string }; revision: number };
type ImportPreview = { fileName: string; catalog: unknown; count: number; year: number; duplicates: number };
const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;

export function AdminBudgetCatalog({ workspace, command }: Props) {
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [year, setYear] = useState('2026');
  const [page, setPage] = useState(1);
  const [includeInactive, setIncludeInactive] = useState(true);
  const [data, setData] = useState<CatalogPage>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<BudgetCatalogItem | 'new' | null>(null);
  const [importing, setImporting] = useState<ImportPreview | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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
    setError('');
    try {
      if (file.size > 2_800_000) throw new Error('JSON 파일은 2.8MB 이하로 선택해 주세요.');
      const catalog = JSON.parse(await file.text());
      if (!catalog || catalog.schemaVersion !== 1 || !Number.isInteger(catalog.year) || !Array.isArray(catalog.items) || !catalog.items.length) throw new Error('schemaVersion, year, source, items를 포함한 예산 원장 JSON을 선택해 주세요.');
      const ids = catalog.items.map((item: { id?: unknown }) => item?.id);
      const duplicates = ids.length - new Set(ids).size;
      setImporting({ fileName: file.name, catalog, count: ids.length, year: catalog.year, duplicates });
    } catch (issue) { setError(issue instanceof SyntaxError ? 'JSON 문법을 확인해 주세요.' : issue instanceof Error ? issue.message : '파일을 읽지 못했습니다.'); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  }

  return <section className="admin-budget" aria-label="예산 원장 관리">
    <header className="ab-heading"><div><p className="ab-eyebrow"><Wallet size={17}/> 예산 원장</p><h2>사업별 확정 예산을 관리하세요</h2><p>세부업무에서 검색해 연결할 예산의 분류와 확정액을 관리합니다.</p></div><div className="ab-actions">
      <a className="btn btn-secondary" href="/api/budgets?export=true" download="온이음-예산원장.json"><Download size={16}/>JSON 다운로드</a>
      <Button variant="secondary" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={16}/>JSON 가져오기</Button>
      <Button disabled={busy} onClick={() => setEditing('new')}><Plus size={16}/>예산 추가</Button>
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
      <td><div className="ab-row-actions"><Button variant="secondary" disabled={busy} onClick={() => setEditing(item)} aria-label={`${item.projectName} 예산 수정`}><Pencil size={14}/>수정</Button><Button variant="ghost" disabled={busy} onClick={async () => { setBusy(true); try { await command('budget.setActive', { id: item.id, active: item.active === false }); } finally { setBusy(false); } }}>{item.active === false ? '검색에 포함' : '검색 제외'}</Button></div></td>
    </tr>)}</tbody></table></div>}
    <div className="ab-pagination"><Button variant="secondary" disabled={page <= 1 || loading} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16}/>이전</Button><span>{page} / {Math.max(1, Math.ceil((data?.total || 0) / (data?.pageSize || 20)))}</span><Button variant="secondary" disabled={loading || !data || page * data.pageSize >= data.total} onClick={() => setPage(value => value + 1)}>다음<ChevronRight size={16}/></Button></div>
    <p className="ab-note">검색에서 제외한 항목도 원장과 기존 업무에는 남습니다. 기존 업무의 확정 예산을 바꾸려면 해당 업무에서 예산을 다시 선택·저장하세요.</p>
    {editing && <BudgetItemForm item={editing === 'new' ? undefined : editing} year={Number(year)} command={command} onClose={() => setEditing(null)}/>}
    {importing && <Modal title="예산 원장 가져오기" description="항목 ID가 같으면 갱신하고, 새로운 ID는 추가합니다. 파일에 없는 기존 항목은 유지됩니다." onClose={() => { if (!busy) setImporting(null); }}><div className="form-stack"><div className="ab-import-preview"><FileJson size={28}/><strong>{importing.fileName}</strong><p>{importing.year}년 · {importing.count.toLocaleString()}개 항목</p></div>{importing.duplicates > 0 && <p className="form-error" role="alert">중복 ID가 {importing.duplicates}개 있습니다. 파일을 정리한 뒤 다시 선택하세요.</p>}<p className="ab-note">분류·금액·중복 여부를 서버에서 확인한 후 한 번에 반영합니다. 기존 업무에 연결된 예산과 집행 기록은 유지됩니다.</p><div className="form-actions"><Button variant="secondary" disabled={busy} onClick={() => setImporting(null)}>취소</Button><Button disabled={busy || importing.duplicates > 0} onClick={async () => { setBusy(true); try { if (await command('budget.import', { catalog: importing.catalog })) { setYear(String(importing.year)); setPage(1); setImporting(null); } } finally { setBusy(false); } }}>{busy ? '가져오는 중…' : `${importing.count.toLocaleString()}건 가져오기`}</Button></div></div></Modal>}
  </section>;
}

function BudgetItemForm({ item, year, command, onClose }: { item?: BudgetCatalogItem; year: number; command: Props['command']; onClose: () => void }) {
  const [draft, setDraft] = useState<BudgetCatalogItem>(() => item ? structuredClone(item) : { id: `budget-manual-${crypto.randomUUID()}`, year, account: '', field: '', sector: '', program: '', projectName: '', confirmedAmountWon: 0, active: true });
  const [amount, setAmount] = useState(String(draft.confirmedAmountWon));
  const [sourcePage, setSourcePage] = useState(String(draft.sourcePage ?? ''));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  return <Modal title={item ? '예산 항목 수정' : '예산 항목 추가'} description="확정 예산은 원 단위로 입력합니다. 기존 업무에 연결된 예산은 자동으로 변경되지 않습니다." onClose={() => { if (!saving) onClose(); }} wide><form className="form-stack" onSubmit={async event => {
    event.preventDefault(); setError('');
    const value = Number(amount); const page = sourcePage ? Number(sourcePage) : undefined;
    if (!amount.trim() || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000_000) { setError('확정 예산은 0 이상인 원 단위 정수로 입력해 주세요.'); return; }
    if (page !== undefined && (!Number.isInteger(page) || page < 1)) { setError('PDF 페이지는 1 이상의 정수로 입력해 주세요.'); return; }
    setSaving(true);
    try { if (await command('budget.upsert', { item: { ...draft, confirmedAmountWon: value, sourcePage: page, active: draft.active !== false } })) onClose(); }
    finally { setSaving(false); }
  }}><div className="form-grid">
    <Field label="회계연도"><input required type="number" min={2000} max={2100} value={draft.year} onChange={event => setDraft(current => ({ ...current, year: Number(event.target.value) }))}/></Field>
    {([['account', '회계'], ['field', '분야'], ['sector', '부문'], ['program', '프로그램'], ['unitProject', '단위사업'], ['projectName', '세부사업명'], ['projectCode', '세부사업 코드']] as const).map(([key, label]) => <Field key={key} label={label} span={key === 'projectName'}><input required={!['unitProject', 'projectCode'].includes(key)} maxLength={300} value={draft[key] ?? ''} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))}/></Field>)}
    <Field label="확정 예산 (원)"><input type="number" min={0} step={1} required value={amount} onChange={event => setAmount(event.target.value)}/><small>{Number.isFinite(Number(amount)) ? won(Number(amount)) : '금액을 확인해 주세요.'}</small></Field>
    <Field label="출처 PDF 페이지 · 선택"><input type="number" min={1} step={1} value={sourcePage} onChange={event => setSourcePage(event.target.value)}/></Field>
  </div><label className="ab-check"><input type="checkbox" checked={draft.active !== false} onChange={event => setDraft(current => ({ ...current, active: event.target.checked }))}/>세부업무 예산 검색에 표시</label>{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><Button variant="secondary" disabled={saving} onClick={onClose}>취소</Button><Button type="submit" disabled={saving}>{saving ? '저장 중…' : '예산 저장'}</Button></div></form></Modal>;
}

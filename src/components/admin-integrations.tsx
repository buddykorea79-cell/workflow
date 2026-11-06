'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, CloudUpload, Database, Download, ExternalLink, FileCheck2, LoaderCircle, PlugZap, RefreshCw, Sparkles } from 'lucide-react';
import type { DiagnosticCheck, DiagnosticResult, IntegrationService, IntegrationStatus, IntegrationVariable, PreparedStorageProbe } from '@/lib/admin-integration-types';
import { Badge, Button } from './ui';
import './admin-integrations.css';

const names = { ai: 'AI · BizRouter', database: 'DB · Neon', storage: '파일 저장소' };
async function api<T>(action?: string, payload: object = {}): Promise<T> {
  const response = await fetch('/api/admin/integrations', action ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) } : { cache: 'no-store' });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || '연결 확인 요청을 처리하지 못했습니다.'); return body;
}
async function digest(bytes: ArrayBuffer) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join(''); }
function Variables({ items }: { items: IntegrationVariable[] }) {
  return <details className="ai-vars"><summary>연결 변수와 설정 여부</summary><dl>{items.map(item => <div key={item.name}><dt>{item.name}<small>{item.purpose}</small></dt><dd className={item.configured ? 'configured' : item.required ? 'missing' : ''}>{item.configured ? '설정됨' : item.required ? '설정 필요' : '기본값 사용'}</dd></div>)}</dl></details>;
}
function Result({ result }: { result?: DiagnosticResult }) {
  if (!result) return <p className="ai-no-result">시험을 실행하면 단계별 결과가 여기에 표시됩니다.</p>;
  return <div className={'ai-result ' + (result.ok ? 'passed' : 'failed')} role="status"><div><strong>{result.ok ? <CheckCircle2 size={18}/> : <CircleAlert size={18}/>} {result.message}</strong><small>{new Date(result.checkedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} · {(result.durationMs / 1000).toFixed(1)}초</small></div><ul>{result.checks.map((check, index) => <li key={index} className={check.ok ? 'passed' : 'failed'}><span>{check.ok ? '완료' : '확인 필요'}</span><div><b>{check.label}</b>{check.detail && <p>{check.detail}</p>}</div></li>)}</ul></div>;
}

export function AdminIntegrations() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [busy, setBusy] = useState(''); const [results, setResults] = useState<Partial<Record<IntegrationService, DiagnosticResult>>>({}); const [browserResult, setBrowserResult] = useState<DiagnosticResult>();
  const [selectedFile, setSelectedFile] = useState<File | null>(null); const [download, setDownload] = useState<{ url: string; name: string }>(); const [cleanupToken, setCleanupToken] = useState('');
  const fileInput = useRef<HTMLInputElement>(null); const alive = useRef(true);
  async function refresh() { setLoading(true); setError(''); try { const result = await api<IntegrationStatus>(); if (alive.current) setStatus(result); } catch (error) { if (alive.current) setError(error instanceof Error ? error.message : '설정 상태를 불러오지 못했습니다.'); } finally { if (alive.current) setLoading(false); } }
  useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; }; }, []);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);
  async function run(service: IntegrationService) {
    const started = Date.now(); setBusy(service); setError('');
    try { const result = await api<DiagnosticResult>(service); setResults(current => ({ ...current, [service]: result })); }
    catch (error) { setResults(current => ({ ...current, [service]: { service, ok: false, checkedAt: new Date().toISOString(), durationMs: Date.now() - started, message: `${names[service]} 시험 요청에 실패했습니다.`, checks: [{ label: '시험 요청', ok: false, detail: error instanceof Error ? error.message : '연결 상태를 확인해 주세요.' }] } })); }
    finally { setBusy(''); }
  }
  async function runBrowserFile() {
    const started = Date.now(); const checks: DiagnosticCheck[] = []; let token = ''; let stage = '시험 파일 준비'; let success = false;
    setBusy('browser'); setBrowserResult(undefined); setError(''); setDownload(undefined);
    try {
      const file = selectedFile || new File([`온이음 브라우저 파일 연결 시험\n${crypto.randomUUID()}\n`], '온이음-연결시험.txt', { type: 'text/plain' });
      if (!file.size || file.size > 1024 * 1024) throw new Error('시험 파일은 비어 있지 않은 1MB 이하 파일을 선택해 주세요.');
      const sha256 = await digest(await file.arrayBuffer()); checks.push({ label: stage, ok: true, detail: `${file.name} · ${file.size.toLocaleString()}바이트` });
      stage = '업로드 주소 발급'; const prepared = await api<PreparedStorageProbe>('storage.prepare', { file: { name: file.name, size: file.size, mime: file.type, sha256 } }); token = prepared.token; setCleanupToken(token); checks.push({ label: stage, ok: true });
      stage = prepared.provider === 'neon' ? '브라우저 직접 업로드·CORS' : '브라우저 파일 업로드';
      let uploaded: Response;
      try { uploaded = await fetch(prepared.uploadUrl, { method: 'PUT', headers: { 'Content-Type': prepared.contentType }, body: file, credentials: prepared.provider === 'neon' ? 'omit' : 'same-origin', signal: AbortSignal.timeout(45_000) }); }
      catch { throw new Error('업로드에 연결하지 못했습니다. Neon CORS의 현재 앱 주소·PUT·Content-Type 허용을 확인해 주세요.'); }
      if (!uploaded.ok) throw new Error('파일 업로드가 거절되었습니다. 저장소 권한과 파일 크기를 확인해 주세요.'); checks.push({ label: stage, ok: true });
      stage = '저장된 파일 확인'; const completed = await api<{ downloadUrl: string }>('storage.complete', { token }); checks.push({ label: stage, ok: true, detail: '서버에서 크기·SHA256 일치 확인' });
      stage = '브라우저 다운로드·내용 비교'; let downloaded: Response;
      try { downloaded = await fetch(completed.downloadUrl, { credentials: prepared.provider === 'neon' ? 'omit' : 'same-origin', signal: AbortSignal.timeout(45_000) }); }
      catch { throw new Error('다운로드에 연결하지 못했습니다. Neon CORS의 현재 앱 주소와 GET 허용을 확인해 주세요.'); }
      if (!downloaded.ok) throw new Error('시험 파일을 내려받지 못했습니다. 파일 읽기 권한을 확인해 주세요.');
      const bytes = await downloaded.arrayBuffer(); if (bytes.byteLength !== file.size || await digest(bytes) !== sha256) throw new Error('다운로드한 파일이 업로드 원본과 다릅니다.');
      checks.push({ label: stage, ok: true, detail: '브라우저에서 원본 크기·SHA256 일치 확인' }); setDownload({ url: URL.createObjectURL(new Blob([bytes], { type: file.type || 'application/octet-stream' })), name: file.name }); success = true;
    } catch (error) { checks.push({ label: stage, ok: false, detail: error instanceof Error ? error.message : '파일 시험에 실패했습니다.' }); }
    finally {
      if (token) { try { await api('storage.cleanup', { token }); checks.push({ label: '임시 시험 파일 정리', ok: true }); setCleanupToken(''); } catch { checks.push({ label: '임시 시험 파일 정리', ok: false, detail: '정리 재시도를 눌러 이번 시험 파일만 삭제해 주세요.' }); } }
      setBrowserResult({ service: 'storage', ok: success && checks.every(check => check.ok), checkedAt: new Date().toISOString(), durationMs: Date.now() - started, checks, message: success ? '실제 브라우저 업로드·다운로드와 내용 일치를 확인했습니다.' : '브라우저 파일 시험을 완료하지 못했습니다.' }); setBusy('');
    }
  }
  return <section className="admin-integrations" aria-label="서비스 연결과 테스트"><header className="ai-heading"><div><p><PlugZap size={17}/> 서비스 연결</p><h2>연결 상태와 실제 동작을 확인하세요</h2><span>Vercel 또는 로컬 환경변수에 연결값을 저장한 뒤, 아래에서 각 서비스를 시험합니다.</span></div><Button variant="secondary" disabled={loading || !!busy} onClick={() => void refresh()}><RefreshCw size={16} className={loading ? 'spin' : ''}/>설정 새로고침</Button></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading && !status && <p className="ai-loading"><LoaderCircle className="spin" size={18}/>연결 설정 확인 중</p>}
    {status && <div className="ai-service-grid">{(['ai', 'database', 'storage'] as const).map(service => {
      const Icon = service === 'ai' ? Sparkles : service === 'database' ? Database : CloudUpload; const current = status[service];
      return <article className="ai-service" key={service}><div className="ai-service-title"><span><Icon size={22}/></span><h3>{names[service]}</h3><Badge tone={current.configured ? 'success' : 'outline'}>{current.configured ? '연결값 설정됨' : service !== 'ai' && status[service].mode === 'local' ? '로컬 저장' : '설정 필요'}</Badge></div><p>{service === 'ai' ? '모델 접근 권한과 짧은 시험 문장의 실제 AI 응답을 확인합니다.' : service === 'database' ? '연결·업무 데이터 조회·쓰기 권한을 시험하고 트랜잭션을 롤백합니다.' : '새 임시 파일을 저장하고 다시 읽어 비교한 뒤 시험 파일만 정리합니다.'}</p><Button variant="secondary" disabled={!!busy} onClick={() => void run(service)}>{busy === service ? <LoaderCircle size={16} className="spin"/> : <PlugZap size={16}/>} {service === 'ai' ? 'AI 연결·응답 테스트' : service === 'database' ? 'DB 연결·읽기·쓰기 테스트' : '파일 저장소 연결 테스트'}</Button>{service === 'ai' && <small className="ai-test-note">고정된 시험 문장만 전송합니다. 소량의 API 사용량이 발생합니다.</small>}<Variables items={current.variables}/><Result result={results[service]}/></article>;
    })}</div>}
    <article className="ai-browser-test"><div><FileCheck2 size={23}/><div><h3>파일을 직접 올리고 내려받기</h3><p>실제 브라우저 업로드·다운로드와 CORS를 확인합니다. 선택한 파일은 시험 후 저장소에서 정리됩니다.</p></div></div><div className="ai-browser-controls"><input ref={fileInput} type="file" aria-label="연결 시험 파일" disabled={!!busy || !!cleanupToken} onChange={event => { setSelectedFile(event.target.files?.[0] || null); setDownload(undefined); }}/><span>{selectedFile ? `${selectedFile.name} · 최대 1MB` : '파일을 선택하지 않으면 작은 시험용 텍스트를 자동 생성합니다.'}</span><Button disabled={!!busy || !!cleanupToken} onClick={() => void runBrowserFile()}>{busy === 'browser' ? <LoaderCircle className="spin" size={17}/> : <CloudUpload size={17}/>}업로드·다운로드 테스트</Button>{download && <a className="btn btn-secondary" href={download.url} download={download.name}><Download size={16}/>확인한 파일 내려받기</a>}{cleanupToken && !busy && <Button variant="secondary" onClick={async () => { setBusy('cleanup'); setError(''); try { await api('storage.cleanup', { token: cleanupToken }); setCleanupToken(''); setBrowserResult(current => current ? { ...current, ok: current.checks.filter(check => check.label !== '임시 시험 파일 정리').every(check => check.ok), checkedAt: new Date().toISOString(), checks: [...current.checks.filter(check => check.label !== '임시 시험 파일 정리'), { label: '임시 시험 파일 정리', ok: true }] } : current); } catch (error) { setError(error instanceof Error ? error.message : '임시 파일 정리에 실패했습니다.'); } finally { setBusy(''); } }}>임시 파일 정리 재시도</Button>}</div><Result result={browserResult}/></article>
    <p className="ai-test-note">시험 중 새로고침하거나 화면을 닫으면 작은 임시 파일이 남을 수 있습니다. 정리 완료를 확인한 뒤 이동해 주세요.</p>
    <details className="ai-setup"><summary>연결값을 어디에서 확인하고 설정하나요?</summary><div className="ai-setup-grid"><section><h4>1. 저장할 위치</h4><p><b>Vercel</b> → 프로젝트 → Settings → Environment Variables에 위 변수 이름으로 저장하고 Redeploy합니다. Production 환경이 선택되어 있는지 확인하세요.</p><p><b>로컬</b>은 프로젝트의 <code>.env.local</code>에 저장한 뒤 개발 서버를 다시 실행합니다. Vercel 값은 로컬 파일로 자동 복사되지 않습니다.</p></section><section><h4>2. DB와 파일 저장소</h4><p><b>Neon</b> → 프로젝트 → Connect에서 <code>DATABASE_URL</code>을 복사합니다. Storage → Parameters only에서 <code>AWS_*</code> 연결값을 확인합니다.</p><p><code>IEUM_STORAGE_PROVIDER=neon</code>, 버킷은 기본 <code>ieum-attachments</code>입니다. Storage의 CORS에는 현재 앱 주소와 <code>PUT, GET, HEAD</code>, 요청 헤더 <code>Content-Type</code>을 허용하세요.</p><a href="https://console.neon.tech" target="_blank" rel="noreferrer">Neon 콘솔 열기<ExternalLink size={13}/></a></section><section><h4>3. AI · BizRouter</h4><p>BizRouter 관리 화면에서 API 키와 사용 가능한 모델 ID를 확인해 <code>BIZROUTER_API_KEY</code>, <code>BIZROUTER_MODEL</code>로 저장합니다. 모델은 JSON 구조화 응답을 지원해야 합니다.</p><p>이 화면은 비밀값을 보여주거나 저장하지 않고 설정 여부와 실제 시험 결과를 표시합니다.</p></section></div></details>
  </section>;
}

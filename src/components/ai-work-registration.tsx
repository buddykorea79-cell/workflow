'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Copy, FileText, Plus, Sparkles, Trash2, Upload } from 'lucide-react';
import { uploadAttachment } from '@/lib/upload-attachment';
import { canEditDepartmentDefinitions } from '@/lib/work-division';
import { isPastDate } from '@/lib/date-format';
import { WORK_IMPORT_LIMITS, validateWorkImport, type WorkImportInput } from '@/lib/work-import';
import { failedRegistration, registrationAttempt, registrationPayload, registrationPreview, registrationSnapshot, registrationText, type AnalysisUnit, type RegistrationAttempt, type RegistrationSnapshot, type RegistrationSource, type RegistrationUnit } from '@/lib/work-registration-draft';
import { Button, ConfirmDialog, Field, commandErrorTarget, showCommandError, type CommandFailure } from './ui';
import { useUnsavedChanges, useUnsavedNavigation } from './unsaved-changes';
import { AiRequestStatus, useAiRequest } from './ai-request-status';
import { aiRequestError } from '@/lib/ai-request-lifecycle';
import { AI_GENERATION_CLIENT_TIMEOUT_MS } from '@/lib/ai-generation-policy';
import { WORK_REGISTRATION_UNIT_LIMIT } from '@/lib/work-registration-policy';
import type { AiWorkRegistrationProps } from './ai-work-registration-dialog';
import './ai-work-registration.css';

const frequencies = { once: '한 번', monthly: '매월', quarterly: '분기별', half_yearly: '반기별', yearly: '연(매년)' };
const priorities = { low: '낮음', medium: '보통', high: '높음' };
const emptyUnit = (serverTime: string) => registrationPreview([{ title: '', description: '', tasks: [{ title: '', description: '' }] }], serverTime)[0];

async function analyzeRequest<T>(payload: unknown, signal: AbortSignal, extractionTimeoutMs?: number): Promise<T> {
  const timeout = new AbortController();
  const timer = extractionTimeoutMs ? setTimeout(() => timeout.abort(), extractionTimeoutMs) : undefined;
  try {
    const response = await fetch('/api/work-registration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: extractionTimeoutMs ? AbortSignal.any([signal, timeout.signal]) : signal });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body) throw new Error(body?.error || '분석 결과를 받지 못했습니다. 입력 내용을 유지했으니 다시 시도해 주세요.');
    return body as T;
  } catch (cause) {
    if (timeout.signal.aborted && !signal.aborted) throw new Error('이 파일의 본문 읽기 대기 시간이 지났습니다. 다른 파일과 작성 내용은 유지됩니다. 파일을 다시 선택하거나 설명에 본문을 입력해 주세요.');
    throw cause;
  } finally { clearTimeout(timer); }
}

export function AiWorkRegistration({ workspace: w, command, onClose, onWorkspace }: AiWorkRegistrationProps) {
  const [owner] = useState(() => ({ id: w.currentUser.id, departmentId: w.currentUser.departmentId }));
  const [description, setDescription] = useState('');
  const [documents, setDocuments] = useState<RegistrationSource[]>([]);
  const [units, setUnits] = useState<RegistrationUnit[]>([]);
  const [reading, setReading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingPreview, setPendingPreview] = useState<RegistrationUnit[] | null>(null);
  const [replacementPreview, setReplacementPreview] = useState<RegistrationUnit[] | null>(null);
  const [attempt, setAttempt] = useState<RegistrationAttempt | null>(null);
  const [completed, setCompleted] = useState<WorkImportInput | null>(null);
  const [copyText, setCopyText] = useState('');
  const current = { description, documents, units };
  const snapshot = registrationSnapshot(current);
  const latest = useRef<RegistrationSnapshot>(current); latest.current = current;
  const attemptRef = useRef(attempt); attemptRef.current = attempt;
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const aiRequest = useAiRequest();
  const executing = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const now = new Date(w.serverTime);
  const head = w.users.find(person => person.departmentId === owner.departmentId && person.role === 'head' && person.active && (!person.endsAt || new Date(person.endsAt) > now) && person.id !== owner.id);
  const allowed = w.currentUser.id === owner.id && w.currentUser.departmentId === owner.departmentId && w.currentUser.active && (!w.currentUser.endsAt || new Date(w.currentUser.endsAt) > now) && canEditDepartmentDefinitions(w, w.currentUser, owner.departmentId) && !!head;
  const permission = useRef(allowed); permission.current = allowed;
  const sameActor = w.currentUser.id === owner.id;
  const actorMatches = useRef(sameActor); actorMatches.current = sameActor;
  const canVerify = !!attempt?.everUnknown && sameActor;
  const dirty = snapshot !== savedSnapshot || !!pendingPreview || reading || analyzing || saving || !!attempt?.everUnknown && !completed;
  const draftId = useUnsavedChanges(dirty, attempt?.everUnknown && !completed ? 'AI 업무 등록 결과 미확인 · 닫기 전에 등록 여부를 확인해 주세요' : saving ? 'AI 업무 등록 처리 중 · 결과를 확인한 뒤 닫아 주세요' : 'AI 업무 등록 초안');
  const { clearDraft } = useUnsavedNavigation();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  const taskCount = units.reduce((count, unit) => count + unit.tasks.length, 0);
  const textCount = description.length + documents.reduce((count, document) => count + document.text.length, 0);
  const busy = reading || analyzing || saving;
  const updateUnit = (key: string, update: Partial<RegistrationUnit>) => setUnits(previous => previous.map(unit => unit.key === key ? { ...unit, ...update } : unit));
  const updateTask = (unitKey: string, taskKey: string, update: Partial<RegistrationUnit['tasks'][number]>) => setUnits(previous => previous.map(unit => unit.key === unitKey ? { ...unit, tasks: unit.tasks.map(task => task.key === taskKey ? { ...task, ...update } : task) } : unit));

  async function readFiles(files: File[]) {
    if (executing.current || busy || !permission.current || completed) return;
    if (documents.length + files.length > 10) { setError('분석 파일은 10개까지 선택할 수 있습니다.'); return; }
    if (files.some(file => !file.size || file.size > 10 * 1024 * 1024 || !/\.(pdf|hwp|hwpx|docx|xlsx|xls|pptx|txt|csv)$/i.test(file.name))) { setError('PDF·한글·Word·Excel·PowerPoint·TXT·CSV 파일을 선택해 주세요. 각 파일은 10MB 이하여야 합니다.'); return; }
    const selected = files.map(file => ({ file, document: { key: crypto.randomUUID(), name: file.name, text: '', loading: true } as RegistrationSource }));
    executing.current = true;
    setDocuments(previous => [...previous, ...selected.map(item => item.document)]); setReading(true); setError('');
    const controller = new AbortController(); request.current = controller;
    try {
      for (const item of selected) {
        if (!mounted.current || !permission.current || controller.signal.aborted) break;
        try {
          const draftTaskId = `draft:${owner.id}:${crypto.randomUUID()}`;
          const updated = await uploadAttachment(item.file, draftTaskId);
          if (!mounted.current || !permission.current || controller.signal.aborted || updated.currentUser.id !== owner.id) break;
          onWorkspace?.(updated);
          const attachment = updated.attachments.find(file => file.taskId === draftTaskId);
          if (!attachment) throw new Error('올린 파일을 확인하지 못했습니다. 다시 선택해 주세요.');
          const result = await analyzeRequest<{ document: { text: string; warnings?: string[] } }>({ action: 'extract', attachmentId: attachment.id }, controller.signal, AI_GENERATION_CLIENT_TIMEOUT_MS);
          if (!mounted.current || !permission.current || controller.signal.aborted || request.current !== controller) break;
          setDocuments(previous => previous.map(document => document.key === item.document.key ? { ...document, attachmentId: attachment.id, text: result.document.text, warnings: result.document.warnings || [], loading: false } : document));
        } catch (cause) {
          if (!mounted.current || controller.signal.aborted) break;
          setDocuments(previous => previous.map(document => document.key === item.document.key ? { ...document, loading: false, error: cause instanceof Error ? cause.message : '파일을 읽지 못했습니다. 다시 선택해 주세요.' } : document));
        }
      }
    } finally {
      if (request.current === controller) {
        request.current = null; executing.current = false;
        if (mounted.current) { setReading(false); setDocuments(previous => previous.map(document => document.loading ? { ...document, loading: false, error: '파일 읽기가 중단되었습니다. 다시 선택해 주세요.' } : document)); }
      }
    }
  }

  async function analyze() {
    if (executing.current || busy || !permission.current || completed) return;
    const submitted = structuredClone(latest.current); const basis = registrationSnapshot(submitted);
    const ready = submitted.documents.filter(document => document.attachmentId && document.text.trim());
    if (!submitted.description.trim() && !ready.length) { setError('업무 설명을 입력하거나 읽을 수 있는 파일을 선택해 주세요.'); return; }
    if (textCount > WORK_IMPORT_LIMITS.totalText) { setError('업무 설명과 분석 자료의 본문을 합쳐 6만 자 이내로 줄여 주세요.'); return; }
    const controller = aiRequest.start(); if (!controller) return;
    executing.current = true; setAnalyzing(true); setError(''); setNotice('');
    try {
      const result = await analyzeRequest<{ preview: { units: AnalysisUnit[] } }>({ action: 'generate', description: submitted.description, documents: ready.map(document => ({ attachmentId: document.attachmentId, text: document.text })) }, controller.signal);
      if (!mounted.current || !permission.current || !aiRequest.accepts(controller)) return;
      const preview = registrationPreview(result.preview.units, w.serverTime);
      if (registrationSnapshot(latest.current) !== basis || submitted.units.length) { setPendingPreview(preview); setNotice('현재 작성 내용은 유지했습니다. 새 분석 결과를 확인한 뒤 적용할 수 있습니다.'); }
      else { setUnits(preview); setPendingPreview(null); setNotice('초안을 만들었습니다. 내용과 업무 구분을 확인하고 기본 마감일과 반복 주기를 업무에 맞게 수정해 주세요.'); }
    } catch (cause) { if (mounted.current && aiRequest.owns(controller)) setError(aiRequestError(controller, cause, '분석하지 못했습니다. 입력은 유지됩니다.')); }
    finally { if (aiRequest.finish(controller)) { executing.current = false; if (mounted.current) setAnalyzing(false); } }
  }

  async function save() {
    if (executing.current || busy || !actorMatches.current || completed || !attemptRef.current?.everUnknown && !permission.current) return;
    let submitted = attemptRef.current;
    if (!submitted?.everUnknown) {
      const input = { importId: submitted?.input.importId || crypto.randomUUID(), units: registrationPayload(latest.current.units) };
      const parsed = validateWorkImport(input);
      if (!parsed.success) { const message = '미리보기의 필수 항목과 마감일을 확인해 주세요.'; setError(message); showCommandError(message, parsed.issues); return; }
      submitted = registrationAttempt(submitted, parsed.data, registrationSnapshot(latest.current));
    }
    executing.current = true; attemptRef.current = submitted; setAttempt(submitted); setSaving(true); setError(''); setNotice('');
    let failure: CommandFailure | undefined;
    const target = commandErrorTarget();
    try {
      const result = await command('work.import', submitted.input as unknown as Record<string, unknown>, { silent: true, onFailure: value => { failure = value; } });
      if (!mounted.current) return;
      if (result) {
        setCompleted(submitted.input); setSavedSnapshot(submitted.snapshot); setAttempt({ ...submitted, everUnknown: false });
        if (registrationSnapshot(latest.current) === submitted.snapshot && !pendingPreview) { clearDraft(draftId); setNotice('등록을 완료했습니다. 개인업무 목록에서 생성한 업무를 확인할 수 있습니다.'); }
        else setNotice('요청 당시의 내용으로 등록했습니다. 저장 중 추가한 내용은 아래에 유지했으며 등록되지 않았습니다. 필요한 내용을 복사해 생성된 업무에서 수정해 주세요.');
      } else {
        const next = failedRegistration(submitted, failure); attemptRef.current = next; setAttempt(next);
        const message = failure?.message || '등록 결과를 확인하지 못했습니다. 같은 요청으로 결과를 다시 확인해 주세요.';
        setError(message); if (failure?.fields?.length && registrationSnapshot(latest.current) === submitted.snapshot) showCommandError(message, failure.fields, target);
      }
    } catch (cause) {
      if (mounted.current) { const next = failedRegistration(submitted); attemptRef.current = next; setAttempt(next); setError(cause instanceof Error ? cause.message : '등록 결과를 확인하지 못했습니다.'); }
    } finally { executing.current = false; if (mounted.current) setSaving(false); }
  }

  async function copyDraft() {
    const value = registrationText(latest.current); setCopyText(value);
    try { await navigator.clipboard.writeText(value); if (mounted.current) setNotice('현재 작성 내용을 복사했습니다.'); }
    catch { if (mounted.current) setNotice('아래 내용을 선택해 직접 복사해 주세요.'); }
  }

  return <div className="ai-registration">
    <div className="air-context"><strong>{w.currentUser.name}님의 업무로 등록</strong><span>{w.departments.find(department => department.id === owner.departmentId)?.name || '소속 부서'} · 검토자 {head?.name || '활성 부서장 없음'}</span><p>자료 준비 → 내용 검증 → 내부 검토 → 최종 제출의 기본 4단계가 만들어집니다. 등록 후 업무별로 수정할 수 있습니다.</p></div>
    {!allowed && <p className="air-error" role="alert">현재 계정·부서 또는 업무분장 상태로는 등록할 수 없습니다. 활성 부서장과 업무분장 확정 여부를 확인해 주세요. 작성 내용은 유지됩니다.</p>}
    <section className="air-source"><h3>1. 업무 설명과 참고 파일</h3><Field name="description" label="담당 업무 설명"><textarea rows={5} maxLength={60000} value={description} onChange={event => setDescription(event.target.value)} placeholder="맡고 있는 업무의 목적, 주요 내용과 업무별 구분을 적어 주세요."/></Field>
      <div className="air-file-actions"><Button variant="secondary" disabled={busy || !allowed || !!completed || documents.length >= 10} onClick={() => fileInput.current?.click()}><Upload size={16}/>인수인계·참고 파일 선택</Button><small>최대 10개 · 파일당 10MB</small><input ref={fileInput} hidden type="file" multiple accept=".pdf,.hwp,.hwpx,.docx,.xlsx,.xls,.pptx,.txt,.csv" aria-label="AI 업무 분석 파일" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void readFiles(files); }}/></div>
      <p className="air-hint">파일은 분석용으로 보관되며 세부업무에 자동 첨부되지 않습니다. 읽은 본문을 확인한 뒤 분석해 주세요.</p>
      {reading && <div className="air-analysis-actions"><p role="status">파일을 차례로 읽고 있습니다. 완료된 본문은 유지됩니다.</p><Button variant="secondary" onClick={() => { const controller = request.current; if (!controller) return; request.current = null; controller.abort(); executing.current = false; setReading(false); setDocuments(previous => previous.map(document => document.loading ? { ...document, loading: false, error: '파일 읽기를 중단했습니다. 필요한 파일만 다시 선택해 주세요.' } : document)); setNotice('파일 읽기를 중단했습니다. 이미 읽은 본문과 작성 내용은 유지됩니다.'); }}>파일 읽기 중단</Button></div>}
      {documents.map(document => <details className="air-document" key={document.key} open={!!document.error}><summary><FileText size={16}/><span>{document.name}</span><small>{document.loading ? '읽는 중…' : document.error ? '읽기 실패' : `${document.text.length.toLocaleString('ko-KR')}자`}</small></summary><Button variant="ghost" aria-label={`${document.name} 분석 목록에서 제거`} onClick={() => setDocuments(previous => previous.filter(item => item.key !== document.key))}><Trash2 size={15}/>목록에서 제거</Button>{document.error && <p className="air-error" role="alert">{document.error}</p>}{document.warnings?.map((warning, index) => <p className="air-hint" key={index}>{warning}</p>)}{document.attachmentId && <Field label={`${document.name} 분석 본문`}><textarea rows={5} value={document.text} onChange={event => setDocuments(previous => previous.map(item => item.key === document.key ? { ...item, text: event.target.value } : item))}/></Field>}</details>)}
      <p className="air-hint">입력한 설명과 선택한 문서 본문을 BizRouter로 보내 분석합니다.</p>
      {textCount > 60000 && <p className="air-error" role="alert">설명과 자료 본문을 합쳐 6만 자 이내로 줄여야 분석할 수 있습니다.</p>}
      <div className="air-analysis-actions"><span>{textCount.toLocaleString('ko-KR')} / 60,000자</span><Button disabled={busy || !allowed || !!completed || textCount > 60000} onClick={() => void analyze()}><Sparkles size={16}/>{reading ? '파일 읽는 중…' : analyzing ? '업무 분석 중…' : 'AI로 업무 초안 만들기'}</Button></div>
      <AiRequestStatus startedAt={aiRequest.startedAt} onCancel={() => { if (aiRequest.cancel()) { executing.current = false; setAnalyzing(false); setNotice('AI 분석을 취소했습니다. 입력과 기존 초안은 유지됩니다. 다시 시도할 때 이전 요청이 처리 중이면 잠시 기다려 주세요.'); } }}/>
    </section>
    {pendingPreview && <section className="air-pending" role="status"><strong>새 분석 결과 · 단위업무 {pendingPreview.length}개 · 세부업무 {pendingPreview.reduce((sum, unit) => sum + unit.tasks.length, 0)}개</strong><p>적용하면 아래 미리보기를 새 결과로 바꿉니다. 입력한 업무 설명과 자료 본문은 유지됩니다.</p><details><summary>새 분석 결과 먼저 확인</summary>{pendingPreview.map(unit => <article key={unit.key}><h4>{unit.title}</h4><p>{unit.description}</p>{unit.tasks.map(task => <div key={task.key}><strong>{task.title}</strong><p>{task.description}</p></div>)}</article>)}</details><Button variant="secondary" disabled={busy || !!completed} onClick={() => setReplacementPreview(structuredClone(pendingPreview))}>새 분석 결과 적용</Button></section>}
    <section className="air-preview"><div className="air-section-heading"><h3>2. 업무 내용 검토</h3><span>단위업무 {units.length}/{WORK_REGISTRATION_UNIT_LIMIT} · 세부업무 {taskCount}/{WORK_IMPORT_LIMITS.maxTasks}</span></div><p className="air-hint">목적·범위·수행 내용이 유사한 업무를 묶어 단위업무는 최대 {WORK_REGISTRATION_UNIT_LIMIT}개까지 등록합니다. 마감일은 등록연도 12월 31일, 반복 주기는 연(매년)으로 기본 설정됩니다. 담당자가 업무 구분·내용·마감일·반복 주기를 자유롭게 수정한 뒤 등록하세요.</p>
      {units.map((unit, unitIndex) => <article className="air-unit" key={unit.key}><header><strong>단위업무 {unitIndex + 1}</strong><Button variant="ghost" aria-label={`${unitIndex + 1}번 단위업무 제거`} onClick={() => setUnits(previous => previous.filter(item => item.key !== unit.key))}><Trash2 size={15}/>제거</Button></header><Field name={`units.${unitIndex}.title`} label="단위업무 이름"><input required maxLength={100} value={unit.title} onChange={event => updateUnit(unit.key, { title: event.target.value })}/></Field><Field name={`units.${unitIndex}.description`} label="단위업무 주요 내용"><textarea required rows={2} maxLength={5000} value={unit.description} onChange={event => updateUnit(unit.key, { description: event.target.value })}/></Field>
        {unit.tasks.map((task, taskIndex) => <div className="air-task" key={task.key}><header><strong>세부업무 {unitIndex + 1}-{taskIndex + 1}</strong><Button variant="ghost" aria-label={`${unitIndex + 1}-${taskIndex + 1} 세부업무 제거`} onClick={() => setUnits(previous => previous.map(item => item.key === unit.key ? { ...item, tasks: item.tasks.filter(value => value.key !== task.key) } : item))}><Trash2 size={15}/>제거</Button></header><Field name={`units.${unitIndex}.tasks.${taskIndex}.title`} label="세부업무 이름"><input required maxLength={150} value={task.title} onChange={event => updateTask(unit.key, task.key, { title: event.target.value })}/></Field><Field name={`units.${unitIndex}.tasks.${taskIndex}.description`} label="세부업무 주요 내용"><textarea required rows={3} maxLength={5000} value={task.description} onChange={event => updateTask(unit.key, task.key, { description: event.target.value })}/></Field><div className="form-grid"><Field name={`units.${unitIndex}.tasks.${taskIndex}.dueDate`} label="업무 마감일"><input type="date" required value={task.dueDate} onChange={event => updateTask(unit.key, task.key, { dueDate: event.target.value })}/>{isPastDate(task.dueDate, w.serverTime) && <small>오늘 이전 날짜입니다. 지난 업무를 기록하는 경우에만 사용해 주세요.</small>}</Field><Field name={`units.${unitIndex}.tasks.${taskIndex}.frequency`} label="반복 주기"><select value={task.frequency} onChange={event => updateTask(unit.key, task.key, { frequency: event.target.value as typeof task.frequency })}>{Object.entries(frequencies).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field name={`units.${unitIndex}.tasks.${taskIndex}.priority`} label="중요도"><select value={task.priority} onChange={event => updateTask(unit.key, task.key, { priority: event.target.value as typeof task.priority })}>{Object.entries(priorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div></div>)}
        <Button variant="secondary" disabled={taskCount >= WORK_IMPORT_LIMITS.maxTasks} onClick={() => setUnits(previous => previous.reduce((count, item) => count + item.tasks.length, 0) >= WORK_IMPORT_LIMITS.maxTasks ? previous : previous.map(item => item.key === unit.key ? { ...item, tasks: [...item.tasks, emptyUnit(w.serverTime).tasks[0]] } : item))}><Plus size={15}/>세부업무 추가</Button>
      </article>)}
      <Button variant="secondary" disabled={units.length >= WORK_REGISTRATION_UNIT_LIMIT || taskCount >= WORK_IMPORT_LIMITS.maxTasks} onClick={() => setUnits(previous => previous.length >= WORK_REGISTRATION_UNIT_LIMIT || previous.reduce((count, item) => count + item.tasks.length, 0) >= WORK_IMPORT_LIMITS.maxTasks ? previous : [...previous, emptyUnit(w.serverTime)])}><Plus size={16}/>단위업무 직접 추가</Button>
    </section>
    {attempt?.everUnknown && !completed && <p className="air-error" role="alert">등록 결과가 아직 확인되지 않았습니다. 아래 버튼은 처음 보낸 내용으로 같은 요청을 다시 확인합니다. 이후 수정한 내용은 재시도에 포함되지 않으며 중복으로 새 업무를 만들지 않습니다.</p>}
    {completed && <section className="air-success" role="status"><CheckCircle2 size={20}/><div><strong>단위업무 {completed.units.length}개 · 세부업무 {completed.units.reduce((sum, unit) => sum + unit.tasks.length, 0)}개 등록 완료</strong><p>이 묶음은 다시 등록되지 않습니다. 추가 수정은 개인업무에서 생성된 업무를 열어 반영해 주세요.</p></div></section>}
    {error && <p className="air-error" role="alert">{error}</p>}{notice && <p className="air-notice" role="status">{notice}</p>}
    {copyText && <Field label="복사할 작성 내용"><textarea readOnly rows={7} value={copyText} onFocus={event => event.currentTarget.select()}/></Field>}
    <div className="air-footer"><Button variant="secondary" onClick={onClose}>닫기</Button><Button variant="secondary" onClick={() => void copyDraft()}><Copy size={15}/>작성 내용 복사</Button>{!completed && <Button variant="accent" disabled={busy || !allowed && !canVerify || !units.length && !attempt?.everUnknown} onClick={() => void save()}>{saving ? '등록 확인 중…' : attempt?.everUnknown ? '같은 요청으로 등록 결과 확인' : '검토한 업무 등록'}</Button>}</div>
    {replacementPreview && <ConfirmDialog title="새 분석 결과로 바꿀까요?" description="현재 미리보기에서 수정한 업무 내용은 새 결과로 바뀝니다. 입력한 업무 설명과 자료 본문은 유지됩니다." confirmLabel="새 결과로 바꾸기" cancelLabel="기존 내용 유지" destructive={false} onCancel={() => setReplacementPreview(null)} onConfirm={() => {
      const selected = replacementPreview;
      setUnits(selected);
      setPendingPreview(current => JSON.stringify(current) === JSON.stringify(selected) ? null : current);
      setReplacementPreview(null);
    }}/>}
  </div>;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { applyProcedureDraft, generateProcedureDraft, pdfEnvelopeError, procedureErrors, PROCEDURE_PDF_LIMIT, PROCEDURE_TEXT_LIMIT, replaceProcedureDraft, validSourceUrl } from '../src/lib/procedure-draft';
import type { WorkflowStep } from '../src/lib/types';

const step = (id: string, patch: Partial<WorkflowStep> = {}): WorkflowStep => ({ id, title: id, role: 'primary', description: '업무 절차', output: '결과물', required: true, dependsOn: [], checklist: ['확인'], done: false, ...patch });
const source = { title: '예산 집행 지침', type: 'guideline' as const, text: '1. 담당자는 요구자료를 작성한다.\n2. 지원자는 관련 자료를 취합한다.\n3. 부서장은 결과를 검토하고 승인한다.', url: 'https://example.org/manual' };

test('numbered source produces editable ordered steps, role lanes and source references', () => {
  const draft = generateProcedureDraft(source, 'draft', { hasSupport: true });
  assert.equal(draft.steps.length, 3);
  assert.deepEqual(draft.steps.map(item => item.role), ['primary', 'support', 'reviewer']);
  assert.deepEqual(draft.steps.map(item => item.dependsOn), [[], ['draft-1'], ['draft-2']]);
  assert.ok(draft.steps.every(item => !item.done));
  assert.equal(draft.steps[0].description, '담당자는 요구자료를 작성한다.');
  assert.deepEqual(draft.evidence['draft-1'], { sourceTitle: source.title, locator: '문단 1', excerpt: '1. 담당자는 요구자료를 작성한다.' });
  assert.ok(draft.steps.every(item => item.output === '' && item.checklist.length === 0));
  assert.equal(draft.evidence['draft-3'].excerpt, '3. 부서장은 결과를 검토하고 승인한다.');
  assert.equal(draft.references[0].url, source.url);
  assert.match(draft.warnings[0], /규칙 기반/);
  assert.deepEqual(procedureErrors(draft.steps), []);
});

test('PDF evidence keeps physical pages and original paragraph numbering even after filtering', () => {
  const draft = generateProcedureDraft({ ...source, pages: [{ page: 2, text: '1. 적용 범위는 해당 기관이다.\n2. 신청서를 접수한다.\n서류의 누락 여부를 확인한다.' }, { page: 5, text: '제4조(승인) 부서장은 결과를 승인한다.' }] }, 'pdf');
  assert.equal(draft.steps.length, 2);
  assert.equal(draft.evidence['pdf-1'].locator, '2쪽 · 문단 2');
  assert.match(draft.evidence['pdf-1'].excerpt, /접수한다. 서류의 누락/);
  assert.equal(draft.evidence['pdf-2'].locator, '5쪽 · 문단 1');
  assert.match(draft.references[0].content, /\[5쪽\]/);
});

test('missing reviewer is explicitly marked as a synthetic review step with no source evidence', () => {
  const draft = generateProcedureDraft({ ...source, text: '1. 신청 자료를 작성한다.\n2. 결과를 제출한다.' }, 'review');
  assert.equal(draft.steps.at(-1)?.role, 'reviewer');
  assert.equal(draft.steps.at(-1)?.required, true);
  assert.match(draft.steps.at(-1)!.description, /직접 추출한 단계가 아닙니다/);
  assert.match(draft.evidence[draft.steps.at(-1)!.id].locator, /직접 근거 없음/);
});

test('plain text paragraphs and sentences are accepted but non-procedural prose is rejected', () => {
  const draft = generateProcedureDraft({ ...source, text: '신청서를 접수한다. 담당자는 내용을 검토한다.' }, 'plain');
  assert.equal(draft.steps.length, 2);
  assert.equal(draft.evidence['plain-2'].locator, '문단 2');
  assert.throws(() => generateProcedureDraft({ ...source, text: '이 문서는 기관 소개입니다.' }, 'empty'), /절차로 추출할 문장/);
});

test('input limits, source URL schemes and truncation are visible', () => {
  assert.equal(validSourceUrl(''), true);
  assert.equal(validSourceUrl('https://example.org/legal?q=1'), true);
  for (const url of ['javascript:alert(1)', 'file:///etc/hosts', 'data:text/plain,abc', 'not a URL']) assert.equal(validSourceUrl(url), false);
  assert.throws(() => generateProcedureDraft({ ...source, url: 'file:///law' }, 'invalid'), /HTTP/);
  assert.throws(() => generateProcedureDraft({ ...source, text: '가'.repeat(PROCEDURE_TEXT_LIMIT + 1) }, 'large'), /20만/);
  assert.throws(() => generateProcedureDraft({ ...source, pages: [{ page: 1, text: '가'.repeat(PROCEDURE_TEXT_LIMIT + 1) }] }, 'large'), /20만/);
  const draft = generateProcedureDraft({ ...source, text: Array.from({ length: 25 }, (_, index) => `${index + 1}. 검토한다. ${'상세 '.repeat(160)}`).join('\n') }, 'truncated');
  assert.equal(draft.steps.length, 20);
  assert.ok(draft.warnings.some(item => /앞의 20개/.test(item)));
  assert.ok(draft.warnings.some(item => /9,800자/.test(item)));
});

test('append preserves all completed/common steps and connects draft roots to every existing branch end', () => {
  const current = [step('start', { done: true }), step('required-common', { dependsOn: ['start'], role: 'reviewer', done: true }), step('parallel', { dependsOn: ['start'] })];
  const before = structuredClone(current);
  const draft = [step('draft-a'), step('draft-b'), step('draft-review', { role: 'reviewer', dependsOn: ['draft-a', 'draft-b'] })];
  const merged = applyProcedureDraft(current, draft, 'append');
  assert.deepEqual(merged.slice(0, 3), before);
  assert.deepEqual(merged[3].dependsOn, ['required-common', 'parallel']);
  assert.deepEqual(merged[4].dependsOn, ['required-common', 'parallel']);
  assert.deepEqual(merged[5].dependsOn, ['draft-a', 'draft-b']);
  merged[0].title = '변경'; assert.deepEqual(current, before);
});

test('append resolves IDs without losing dependency links or existing execution flags', () => {
  const current = [step('draft-1', { role: 'reviewer', done: true })];
  const draft = [step('draft-1', { done: true }), step('draft-review', { role: 'reviewer', dependsOn: ['draft-1'] })];
  const merged = applyProcedureDraft(current, draft, 'append');
  assert.equal(merged[0].done, true);
  assert.equal(merged[1].id, 'draft-1-2');
  assert.equal(merged[1].done, false);
  assert.deepEqual(merged[1].dependsOn, ['draft-1']);
  assert.deepEqual(merged[2].dependsOn, ['draft-1-2']);
});

test('replacement requires explicit permission and cannot replace completed steps', () => {
  const draft = [step('new', { role: 'reviewer', done: true })];
  assert.throws(() => applyProcedureDraft([], draft, 'replace'), /전체 교체/);
  assert.throws(() => applyProcedureDraft([step('old', { done: true })], draft, 'replace', true), /전체 교체/);
  assert.deepEqual(applyProcedureDraft([step('old')], draft, 'replace', true), [{ ...draft[0], done: false }]);
});

test('validation blocks cycles, dangling edges, missing required review and workflow overflow', () => {
  assert.ok(procedureErrors([step('a', { dependsOn: ['b'] }), step('b', { dependsOn: ['a'], role: 'reviewer' })]).some(item => /순환/.test(item)));
  assert.ok(procedureErrors([step('a', { role: 'reviewer', dependsOn: ['missing'] })]).some(item => /선행/.test(item)));
  assert.ok(procedureErrors([step('a')]).some(item => /필수 검토/.test(item)));
  assert.ok(procedureErrors([step('a', { role: 'reviewer' }), step('a')]).some(item => /중복/.test(item)));
  assert.throws(() => applyProcedureDraft(Array.from({ length: 50 }, (_, index) => step(`old-${index}`, { role: 'reviewer' })), [step('new', { role: 'reviewer' })], 'append'), /50개/);
});

test('PDF envelope requires correct size, file extension, declared MIME and actual signature', () => {
  const bytes = new TextEncoder().encode('%PDF-1.4\nfixture');
  assert.equal(pdfEnvelopeError('guide.PDF', 'application/pdf', bytes), undefined);
  assert.equal(pdfEnvelopeError('guide.pdf', 'application/x-pdf', bytes), undefined);
  assert.match(pdfEnvelopeError('guide.exe', 'application/pdf', bytes)!, /PDF 형식/);
  assert.match(pdfEnvelopeError('guide.pdf', 'text/plain', bytes)!, /PDF 형식/);
  assert.match(pdfEnvelopeError('guide.pdf', 'application/pdf', new TextEncoder().encode('not-pdf'))!, /형식/);
  assert.match(pdfEnvelopeError('guide.pdf', 'application/pdf', new Uint8Array(PROCEDURE_PDF_LIMIT + 1))!, /10MB/);
});

test('evaluation metadata and scoring tables do not become procedures merely because they contain action words', () => {
  const metadata = ['평가 개요: 정책 추진 수준', '평가 대상: 중앙행정기관', '평가 기간: 연간', '평가 방식: 서면 지표', '평가 배점: 총점 100점', '평가 등급: 우수, 보통, 미흡', '분석사례 지표 정의: 정책 활용 사례', '데이터 등록 지표 정의: 보유 목록', '제출자료 명칭: 실적표', '평가 인정 범위: 당해 연도', '교육 실적 평가 배점: 10점', '평가 산식: 이수 인원 비율', '평가 증빙 유형: 수료증', '평가 제외 대상: 중복 실적', '평가 참고사항: 단위 환산', '평가 용어 정의: 고가치 공유데이터'];
  assert.throws(() => generateProcedureDraft({ ...source, text: metadata.map((text, index) => `${index + 1}. ${text}`).join('\n') }, 'metadata'), /절차로 추출할 문장/);
  assert.throws(() => generateProcedureDraft({ ...source, text: Array.from({ length: 24 }, (_, index) => `${index + 1}. 평가 지표 ${index + 1}: 배점 5점, 대상 전체 기관`).join('\n') }, 'scores'), /절차로 추출할 문장/);
  assert.throws(() => generateProcedureDraft({ ...source, text: '평가 목적은 기관의 실적을 확인하는 것이다.\n\n데이터를 분석하는 능력 평가' }, 'descriptive'), /절차로 추출할 문장/);
});

test('mixed manuals retain real action sentences and concise task headings without assigning evaluation keywords to reviewers', () => {
  const draft = generateProcedureDraft({ ...source, text: [
    '1. 평가 배점: 10점',
    '2. AI·데이터 문해력 교육 이수 실적 관리',
    '3. 담당자는 평가 실적표를 작성한다.',
    '4. 데이터 분석사례 등록 및 증빙 정리',
    '5. 검토 보고서 작성',
    '6. 부서장은 실적과 증빙을 검토한다.',
    '7. 평가 결과를 제출한다.',
  ].join('\n') }, 'mixed');
  assert.equal(draft.steps.length, 6);
  assert.deepEqual(draft.steps.map(step => step.role), ['primary', 'primary', 'primary', 'primary', 'reviewer', 'primary']);
  assert.equal(draft.evidence['mixed-1'].locator, '문단 2');
  assert.equal(draft.evidence['mixed-6'].locator, '문단 7');
});

test('optional review policy generates and validates owner-only procedures while keeping graph validation', () => {
  const draft = generateProcedureDraft({ ...source, text: '1. 자료를 작성한다.\n2. 결과를 제출한다.' }, 'owner', { reviewRequired: false });
  assert.equal(draft.steps.length, 2);
  assert.ok(draft.steps.every(step => step.role === 'primary'));
  assert.deepEqual(procedureErrors(draft.steps, { reviewRequired: false }), []);
  assert.ok(procedureErrors(draft.steps).some(error => /필수 검토/.test(error)));
  assert.equal(replaceProcedureDraft(draft.steps, { reviewRequired: false }).length, 2);
  assert.equal(applyProcedureDraft([], draft.steps, 'replace', true, { reviewRequired: false }).length, 2);
  assert.ok(procedureErrors([step('a', { dependsOn: ['b'] }), step('b', { dependsOn: ['a'] })], { reviewRequired: false }).some(error => /순환/.test(error)));
});

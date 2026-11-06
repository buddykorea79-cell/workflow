import test from 'node:test';
import assert from 'node:assert/strict';
import { getLawDetail, lawPlainText, searchLaw } from '../src/lib/law-api';
import { DomainError } from '../src/lib/domain';

// Synthetic fixtures follow the field names in the official eflaw/admrul guides.
// They are parser tests, not live authentication or legal-content validation.
const errorCode = (code: string) => (error: unknown) => error instanceof DomainError && error.code === code;
const law = { 법령ID: '001234', 법령일련번호: '299999', 법령명한글: '시연법', 법령구분명: '법률', 소관부처명: '시연부', 공포일자: '20260101', 시행일자: '20260701', 법령상세링크: '/DRF/lawService.do?OC=NEVER_EXPOSE&target=law' };
const rule = { 행정규칙일련번호: '2100000000123', 행정규칙ID: '12345', 행정규칙명: '시연 업무 지침', 행정규칙종류: '지침', 소관부처명: '시연부', 발령일자: '20260102', 시행일자: '20260103' };
const options = (value: unknown) => ({ oc: 'private-test-oc', fetcher: async () => Response.json(value) });

test('law search uses current effective laws, supports content keywords and returns safe public metadata', async () => {
  const result = await searchLaw({ kind: 'law', query: ' 통계 & 기록 ', scope: 'content', page: 2 }, { oc: 'private-test-oc', fetcher: async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, 'https://www.law.go.kr'); assert.equal(url.pathname, '/DRF/lawSearch.do');
    assert.equal(url.searchParams.get('OC'), 'private-test-oc'); assert.equal(url.searchParams.get('query'), '통계 & 기록'); assert.equal(url.searchParams.get('target'), 'eflaw'); assert.equal(url.searchParams.get('nw'), '3'); assert.equal(url.searchParams.get('search'), '2'); assert.equal(url.searchParams.get('page'), '2'); assert.equal(url.searchParams.get('display'), '20'); assert.equal(url.searchParams.get('type'), 'JSON'); assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
    return Response.json({ LawSearch: { totalCnt: '21', page: '2', law } });
  } });
  assert.equal(result.total, 21); assert.equal(result.items.length, 1); assert.equal(result.items[0].id, '001234'); assert.equal(result.items[0].effectiveDate, '2026-07-01');
  assert.equal(result.items[0].sourceUrl, `https://www.law.go.kr/법령/${encodeURIComponent('시연법')}`);
  assert.equal(JSON.stringify(result).includes('OC='), false); assert.equal(JSON.stringify(result).includes('private-test-oc'), false);
});

test('administrative rule search uses serial identity and current-rule query; empty lists are valid', async () => {
  const result = await searchLaw({ kind: 'admrul', query: '업무' }, { oc: 'private-test-oc', fetcher: async input => {
    const url = new URL(String(input)); assert.equal(url.searchParams.get('target'), 'admrul'); assert.equal(url.searchParams.get('nw'), '1'); assert.equal(url.searchParams.get('search'), '1');
    return Response.json({ AdmRulSearch: { totalCnt: 1, admrul: [rule] } });
  } });
  assert.equal(result.items[0].id, rule.행정규칙일련번호); assert.equal(result.items[0].category, '지침'); assert.equal(result.items[0].promulgationDate, '2026-01-02');
  assert.match(result.items[0].sourceUrl, /admRulSeq=2100000000123$/);
  assert.deepEqual((await searchLaw({ kind: 'law', query: '없는자료' }, options({ LawSearch: { totalCnt: '0' } }))).items, []);
});

test('law detail keeps complete paragraphs, subparagraphs and items with branch article labels', async () => {
  const raw = { 법령: { 기본정보: { ...law, 법령ID: 1234, 법령명_한글: '시연법', 법령명한글: undefined, 소관부처: { content: '시연부', 소관부처코드: '1' }, 소관부처명: undefined }, 조문: { 조문단위: [
    { 조문번호: '1', 조문여부: '전문', 조문내용: '제1장 총칙' },
    { 조문번호: '10', 조문가지번호: '2', 조문제목: '자료의 검토', 조문내용: '제10조의2(자료의 검토)', 항: [{ 항번호: '1', 항내용: '① 담당자는 자료를 검토한다.', 호: [{ 호번호: '1.', 호내용: '1. 출처를 확인한다.', 목: [{ 목번호: '가.', 목내용: '가. 작성일자를 확인한다.' }, { 목번호: '나.', 목내용: '나. 변경 이력을 확인한다.' }] }] }, { 항번호: '2', 항내용: '② 검토 결과를 기록한다.' }] },
  ] }, 별표: { 별표단위: { 별표제목: '별도 서식' } } } };
  const detail = await getLawDetail({ kind: 'law', id: '001234' }, { oc: 'private-test-oc', fetcher: async input => { const url = new URL(String(input)); assert.equal(url.searchParams.get('ID'), '001234'); assert.equal(url.searchParams.get('target'), 'eflaw'); assert.equal(url.searchParams.has('MST'), false); return Response.json(raw); } });
  assert.equal(detail.articles.length, 1); assert.equal(detail.id, '001234'); assert.equal(detail.ministry, '시연부'); assert.equal(detail.articles[0].number, '제10조의2');
  assert.equal(detail.articles[0].content, '제10조의2(자료의 검토)\n① 담당자는 자료를 검토한다.\n1. 출처를 확인한다.\n가. 작성일자를 확인한다.\n나. 변경 이력을 확인한다.\n② 검토 결과를 기록한다.');
  assert.ok(detail.warnings.some(warning => warning.includes('별표')));
});

test('administrative rules support article-less HTML content and singleton article objects', async () => {
  const detail = await getLawDetail({ kind: 'admrul', id: rule.행정규칙일련번호 }, options({ AdmRulService: { ...rule, 조문내용: ['<p>1. 자료를 수집한다.</p><p>2. 검토 &amp; 보관한다.</p>', '<div>별도의 본문이다.</div>'] } }));
  assert.equal(detail.articles.length, 2); assert.equal(detail.articles[0].content, '1. 자료를 수집한다.\n2. 검토 & 보관한다.'); assert.ok(detail.warnings.some(warning => warning.includes('조문 번호')));
  const structured = await getLawDetail({ kind: 'admrul', id: rule.행정규칙일련번호 }, options({ 행정규칙: { ...rule, 조문: { 조문단위: { 조문번호: '2', 조문제목: '검토', 조문내용: '제2조 검토한다.', 항: { 항내용: '① 내용을 확인한다.' } } } } }));
  assert.equal(structured.articles[0].number, '제2조'); assert.match(structured.articles[0].content, /① 내용을 확인한다/);
});

test('upstream HTML and entities remain safe plain text without dropping encoded comparison characters', () => {
  assert.equal(lawPlainText('<script>alert(1)</script><p>조건 &lt; 5<br/>A&nbsp;&amp;&nbsp;B &#x2460; &#9313;</p>'), '조건 < 5\nA & B ① ②');
  assert.equal(lawPlainText('&lt;img src=x onerror=alert(1)&gt;'), '<img src=x onerror=alert(1)>'); // text only; never interpreted as HTML
});

test('legal amendment annotations and mathematical comparison signs survive HTML cleanup', () => {
  const original = '<p>제2조 <개정 2026. 1. 1.><br/>① <신설 2025. 12. 1.> 금액이 2 < 5 > 1인 경우를 확인한다.</p><span class="note">② <삭제 2024. 1. 1.></span>';
  assert.equal(lawPlainText(original), '제2조 <개정 2026. 1. 1.>\n① <신설 2025. 12. 1.> 금액이 2 < 5 > 1인 경우를 확인한다.\n② <삭제 2024. 1. 1.>');
});

test('missing configuration and invalid inputs never contact upstream', async () => {
  let calls = 0; const fetcher = async () => { calls++; throw new Error('must not fetch'); };
  await assert.rejects(searchLaw({ kind: 'law', query: '자료' }, { oc: '', fetcher }), errorCode('LAW_NOT_CONFIGURED'));
  await assert.rejects(searchLaw({ kind: 'law', query: '' }, { oc: 'test', fetcher }), errorCode('LAW_INVALID_INPUT'));
  await assert.rejects(searchLaw({ kind: 'law', query: '자료', page: 0 }, { oc: 'test', fetcher }), errorCode('LAW_INVALID_INPUT'));
  await assert.rejects(getLawDetail({ kind: 'law', id: 'https://other.test' }, { oc: 'test', fetcher }), errorCode('LAW_INVALID_INPUT'));
  assert.equal(calls, 0);
});

test('OC configuration follows the official form and rejects copied assignments, quotes and URLs before requesting', async () => {
  let calls = 0; const fetcher = async () => { calls++; return Response.json({ LawSearch: { totalCnt: 0 } }); };
  for (const oc of ['LAW_API_OC=approved-key', '"approved-key"', "'approved-key'", 'https://example.test/key', 'member@example.test', 'key with space', 'key\nline', '-key', 'key.', 'two__marks', 'x'.repeat(51)]) {
    await assert.rejects(searchLaw({ kind: 'law', query: '자료' }, { oc, fetcher }), error => {
      assert.ok(error instanceof DomainError); assert.equal(error.code, 'LAW_INVALID_CONFIGURATION'); assert.equal(error.status, 503); assert.match(error.message, /Value에는 승인된 키값만/); assert.equal(error.message.includes(oc), false); return true;
    });
  }
  assert.equal(calls, 0);
  await searchLaw({ kind: 'law', query: '자료' }, { oc: '  Approved-2026.key_1  ', fetcher: async input => { calls++; assert.equal(new URL(String(input)).searchParams.get('OC'), 'Approved-2026.key_1'); return Response.json({ LawSearch: { totalCnt: 0 } }); } });
  assert.equal(calls, 1);
});

test('HTTP-200 authentication failures and rejected HTTP responses expose safe actionable errors', async () => {
  await assert.rejects(searchLaw({ kind: 'law', query: '자료' }, options({ result: '사용자 정보 검증에 실패하였습니다.', msg: 'OC=private-test-oc 정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요.' })), error => errorCode('LAW_AUTH_FAILED')(error) && !(error as Error).message.includes('private-test-oc'));
  for (const [status, code] of [[403, 'LAW_AUTH_FAILED'], [429, 'LAW_RATE_LIMITED'], [503, 'LAW_UPSTREAM_FAILED']] as const) await assert.rejects(searchLaw({ kind: 'law', query: '자료' }, { oc: 'test', fetcher: async () => new Response('secret upstream error', { status }) }), errorCode(code));
  await assert.rejects(searchLaw({ kind: 'law', query: '자료' }, { oc: 'test', fetcher: async () => new Response('<html>유관기관 등록된 사용자만 사용 가능합니다. OC=secret</html>') }), errorCode('LAW_AUTH_FAILED'));
});

test('failed provider status diagnostics retain Korean guidance while redacting OC, encoded OC, URLs and key patterns', async () => {
  const oc = 'private-test.oc_2026';
  const message = `요청 처리 실패: 현재 검색 서비스 점검 중입니다. ${oc} ${encodeURIComponent(oc)} https://www.law.go.kr/DRF/lawSearch.do?OC=${encodeURIComponent(oc)} API_KEY=unexpected-secret <p>잠시 후 다시 호출해 주세요.</p>`;
  await assert.rejects(searchLaw({ kind: 'law', query: '자료' }, { oc, fetcher: async () => Response.json({ result: 'error', msg: message, debug: 'RAW_BODY_MUST_NOT_APPEAR' }) }), error => {
    assert.ok(error instanceof DomainError); assert.equal(error.code, 'LAW_UPSTREAM_FAILED');
    assert.match(error.message, /제공기관 안내:.*현재 검색 서비스 점검 중입니다/);
    assert.match(error.message, /잠시 후 다시 호출해 주세요/);
    for (const secret of [oc, encodeURIComponent(oc), 'unexpected-secret', 'https://', 'lawSearch.do', 'RAW_BODY_MUST_NOT_APPEAR']) assert.equal(error.message.includes(secret), false);
    return true;
  });
  await assert.rejects(searchLaw({ kind: 'law', query: '자료' }, options({ result: '오류', msg: '필수 요청변수 형식이 맞지 않습니다. ' + '안내 '.repeat(300) })), error => {
    assert.ok(error instanceof DomainError); assert.match(error.message, /검색 조건과 신청한 API 종류/);
    assert.ok(error.message.split('제공기관 안내: ')[1].length <= 240); return true;
  });
  await assert.rejects(searchLaw({ kind: 'law', query: '자료' }, options({ result: '실패', msg: '등록한 계정의 조회 횟수 초과입니다.' })), errorCode('LAW_RATE_LIMITED'));
});

test('malformed, inconsistent and missing-body responses are rejected without silently substituting content', async () => {
  await assert.rejects(searchLaw({ kind: 'law', query: '자료' }, options({ unexpected: [] })), errorCode('LAW_INVALID_RESPONSE'));
  await assert.rejects(searchLaw({ kind: 'law', query: '자료' }, options({ LawSearch: { totalCnt: 1 } })), errorCode('LAW_INVALID_RESPONSE'));
  await assert.rejects(getLawDetail({ kind: 'law', id: '001234' }, options({ 법령: { 기본정보: law, 조문: {} } })), errorCode('LAW_BODY_UNAVAILABLE'));
  await assert.rejects(getLawDetail({ kind: 'law', id: '001234' }, options({ 법령: { 기본정보: { ...law, 법령ID: '9' }, 조문내용: '다른 법령의 본문' } })), errorCode('LAW_INVALID_RESPONSE'));
  await assert.rejects(searchLaw({ kind: 'law', query: '자료' }, { oc: 'test', fetcher: async () => new Response('<html>Temporary failure</html>') }), errorCode('LAW_INVALID_RESPONSE'));
});

test('oversized bodies are cancelled and network errors never disclose credential-bearing request URLs', async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1_600_000)); }, cancel() { cancelled = true; } });
  await assert.rejects(searchLaw({ kind: 'law', query: '자료' }, { oc: 'private-test-oc', fetcher: async () => new Response(stream) }), errorCode('LAW_RESPONSE_TOO_LARGE')); assert.equal(cancelled, true);
  await assert.rejects(searchLaw({ kind: 'law', query: '자료' }, { oc: 'private-test-oc', fetcher: async input => { throw new Error(String(input)); } }), error => errorCode('LAW_CONNECTION_FAILED')(error) && !(error as Error).message.includes('private-test-oc'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(searchLaw({ kind: 'law', query: '자료' }, { oc: 'test', signal: controller.signal, fetcher: async () => { throw new Error('abort'); } }), errorCode('LAW_TIMEOUT'));
});

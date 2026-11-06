import { DomainError } from './domain';
import type { LawArticle, LawDetail, LawKind, LawSearchItem, LawSearchResult, LawSearchScope } from './law-api-types';

// Official contracts: open.law.go.kr/LSO/openApi/guideResult.do?htmlName=
// lsEfYdListGuide / lsEfYdInfoGuide / admrulListGuide / admrulInfoGuide.
const origin = 'https://www.law.go.kr';
const numericId = /^\d{1,30}$/;
// Official registration form (open.law.go.kr/LSO/usrJoin.do): validateOc + maxlength="50".
const validOc = /^[0-9a-zA-Z]([-_.]?[0-9a-zA-Z])*$/;
const pageSize = 20;
type RecordValue = Record<string, unknown>;
export interface LawApiOptions { oc?: string; fetcher?: typeof fetch; signal?: AbortSignal }
export interface LawSearchInput { kind: LawKind; query: string; scope?: LawSearchScope; page?: number }

const record = (value: unknown): RecordValue | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined;
const array = (value: unknown): unknown[] => value == null || value === '' ? [] : Array.isArray(value) ? value : [value];
function scalar(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  const object = record(value); if (!object) return '';
  for (const key of ['#text', 'content', '_', 'value', 'text']) if (typeof object[key] === 'string' || typeof object[key] === 'number') return String(object[key]);
  return '';
}

/** Render upstream markup as text; callers always display the result through React text nodes. */
export function lawPlainText(value: unknown): string {
  const source = Array.isArray(value) ? value.map(scalar).join('\n') : scalar(value);
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', ndash: '–', mdash: '—' };
  return source.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<\s*br\b[^>]*>|<\/(?:p|div|li|tr|h[1-6])\s*>/gi, '\n')
    // Korean amendment annotations such as <개정 ...> are part of the legal text, not HTML.
    .replace(/<\/?[a-z][a-z0-9:-]*(?:\s[^<>]*?)?\s*\/?>/gi, '')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? match;
      const point = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '';
    }).replace(/\r\n?/g, '\n').replace(/[\t ]+\n/g, '\n').replace(/\n[\t ]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function pick(source: RecordValue, ...keys: string[]): string {
  for (const key of keys) { const value = lawPlainText(source[key]); if (value) return value; }
  return '';
}
function date(value: string) { const digits = value.replace(/\D/g, ''); return /^\d{8}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}` : value; }
function badResponse(): never { throw new DomainError(502, 'LAW_INVALID_RESPONSE', '국가법령정보센터의 응답 형식을 확인하지 못했습니다. 잠시 후 다시 검색해 주세요.'); }
function assertKind(kind: LawKind) { if (kind !== 'law' && kind !== 'admrul') throw new DomainError(422, 'LAW_INVALID_INPUT', '법령 또는 행정규칙을 선택해 주세요.'); }

/** The public links never reuse authenticated DRF links or upstream-controlled URLs. */
function publicUrl(kind: LawKind, id: string, title: string) {
  if (kind === 'admrul') return `${origin}/LSW/admRulLsInfoP.do?admRulSeq=${encodeURIComponent(id)}`;
  return `${origin}/법령/${encodeURIComponent(title)}`;
}
function metadata(source: RecordValue, kind: LawKind, fallbackId = ''): LawSearchItem {
  const id = pick(source, kind === 'law' ? '법령ID' : '행정규칙일련번호') || fallbackId;
  const title = pick(source, kind === 'law' ? '법령명한글' : '행정규칙명', '법령명_한글');
  if (!numericId.test(id) || !title) badResponse();
  return { id, kind, title, category: pick(source, '법령구분명', '법종구분', '행정규칙종류'), ministry: pick(source, '소관부처명', '소관부처'), promulgationDate: date(pick(source, '공포일자', '발령일자')), effectiveDate: date(pick(source, '시행일자')), sourceUrl: publicUrl(kind, id, title) };
}
function findObject(value: unknown, predicate: (item: RecordValue) => boolean, depth = 0): RecordValue | undefined {
  if (depth > 5) return undefined;
  const object = record(value); if (!object) return undefined;
  if (predicate(object)) return object;
  for (const child of Object.values(object)) { const found = findObject(child, predicate, depth + 1); if (found) return found; }
  return undefined;
}

/** Only a failed provider's explicit status fields may become a diagnostic, never a response body or URL. */
function safeProviderDiagnostic(message: string, oc: string): string {
  let plain = lawPlainText(message);
  for (const secret of new Set([oc.trim(), encodeURIComponent(oc.trim()), encodeURI(oc.trim())])) {
    if (secret) plain = plain.replace(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[가림]');
  }
  plain = plain.replace(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"']+/gi, '[주소 생략]')
    .replace(/\b(?:OC|api[_ -]?key|service[_ -]?key|access[_ -]?token|token|authorization|password|secret)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, '[인증값 가림]')
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.length > 240 ? `${plain.slice(0, 239)}…` : plain;
}

async function fetchJson(path: 'lawSearch.do' | 'lawService.do', params: Record<string, string>, options: LawApiOptions): Promise<unknown> {
  const oc = options.oc ?? process.env.LAW_API_OC;
  if (!oc?.trim()) throw new DomainError(503, 'LAW_NOT_CONFIGURED', '국가법령정보센터 연결값 LAW_API_OC가 설정되지 않았습니다. 관리자에게 설정을 요청해 주세요.');
  if (oc.trim().length > 50 || !validOc.test(oc.trim())) throw new DomainError(503, 'LAW_INVALID_CONFIGURATION', 'LAW_API_OC 형식이 올바르지 않습니다. 환경변수 Value에는 승인된 키값만 넣어 주세요. LAW_API_OC=, 따옴표, 공백, 이메일 주소 또는 URL을 포함하지 마세요.');
  const url = new URL(`/DRF/${path}`, origin);
  url.search = new URLSearchParams({ OC: oc.trim(), type: 'JSON', ...params }).toString();
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
  try {
    const response = await (options.fetcher ?? fetch)(url, { headers: { Accept: 'application/json' }, cache: 'no-store', redirect: 'error', signal });
    if ([401, 403].includes(response.status)) throw new DomainError(503, 'LAW_AUTH_FAILED', '법령 API 인증을 확인해 주세요. 승인된 OC와 등록한 서버 IP·도메인, 법령·행정규칙 이용 권한이 필요합니다.');
    if (response.status === 429) throw new DomainError(429, 'LAW_RATE_LIMITED', '국가법령정보센터의 요청 한도에 도달했습니다. 잠시 후 다시 검색해 주세요.');
    if (!response.ok) throw new DomainError(502, 'LAW_UPSTREAM_FAILED', '국가법령정보센터에 연결하지 못했습니다. 잠시 후 다시 검색해 주세요.');
    const limit = path === 'lawSearch.do' ? 1_500_000 : 8_000_000;
    if (Number(response.headers.get('content-length') || 0) > limit) { await response.body?.cancel(); throw new DomainError(502, 'LAW_RESPONSE_TOO_LARGE', '법령 응답이 너무 큽니다. 국가법령정보센터 원문에서 필요한 조문을 확인해 주세요.'); }
    const reader = response.body?.getReader(); if (!reader) badResponse();
    const decoder = new TextDecoder(); let bytes = 0; let text = '';
    try {
      while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > limit) { await reader.cancel(); throw new DomainError(502, 'LAW_RESPONSE_TOO_LARGE', '법령 응답이 너무 큽니다. 국가법령정보센터 원문에서 필요한 조문을 확인해 주세요.'); } text += decoder.decode(part.value, { stream: true }); }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    let result: unknown;
    try { result = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { if (/사용자\s*(정보|검증)|인증|등록된\s*사용자|유관기관/.test(text.slice(0, 5000))) throw new DomainError(503, 'LAW_AUTH_FAILED', '법령 API 인증에 실패했습니다. LAW_API_OC와 법제처에 등록한 서버 IP·도메인 및 이용 권한을 확인해 주세요.'); badResponse(); }
    const root = record(result);
    if (root && (root.result !== undefined || root.msg !== undefined || root.error !== undefined)) {
      const message = ['result', 'msg', 'error'].map(key => scalar(root[key])).join(' ');
      if (/rate.?limit|too many|(?:요청|호출|조회).*(?:한도|횟수.*초과|제한)/i.test(message)) throw new DomainError(429, 'LAW_RATE_LIMITED', '국가법령정보센터의 요청 한도에 도달했습니다. 잠시 후 다시 검색해 주세요.');
      if (/사용자|인증|권한|등록|IP주소|도메인/.test(message)) throw new DomainError(503, 'LAW_AUTH_FAILED', '법령 API 인증에 실패했습니다. LAW_API_OC와 법제처에 등록한 서버 IP·도메인 및 이용 권한을 확인해 주세요.');
      if (/오류|실패|error|fail/i.test(message)) {
        const diagnostic = safeProviderDiagnostic(message, oc);
        const guidance = /필수|파라미터|요청\s*변수|매개변수|잘못된\s*요청|지원하지\s*않/i.test(message)
          ? '국가법령정보센터가 검색 조건을 처리하지 못했습니다. 검색 조건과 신청한 API 종류를 확인해 주세요.'
          : '국가법령정보센터가 요청을 처리하지 못했습니다. 잠시 후 다시 검색해 주세요.';
        throw new DomainError(502, 'LAW_UPSTREAM_FAILED', `${guidance}${diagnostic ? ` 제공기관 안내: ${diagnostic}` : ''}`);
      }
    }
    return result;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (signal.aborted) throw new DomainError(504, 'LAW_TIMEOUT', '법령 조회 시간이 초과되었거나 요청이 취소되었습니다. 다시 검색해 주세요.');
    throw new DomainError(502, 'LAW_CONNECTION_FAILED', '국가법령정보센터에 연결하지 못했습니다. 연결 상태를 확인해 주세요.');
  }
}

export async function searchLaw(input: LawSearchInput, options: LawApiOptions = {}): Promise<LawSearchResult> {
  assertKind(input.kind); const query = input.query.trim(); const scope = input.scope ?? 'title'; const page = input.page ?? 1;
  if (!query || query.length > 100 || !['title', 'content'].includes(scope) || !Number.isInteger(page) || page < 1 || page > 1000) throw new DomainError(422, 'LAW_INVALID_INPUT', '검색어는 1~100자로 입력하고 검색 범위와 페이지를 확인해 주세요.');
  const raw = await fetchJson('lawSearch.do', { target: input.kind === 'law' ? 'eflaw' : 'admrul', nw: input.kind === 'law' ? '3' : '1', search: scope === 'content' ? '2' : '1', query, display: String(pageSize), page: String(page), sort: 'lasc' }, options);
  const root = findObject(raw, item => item.totalCnt !== undefined);
  if (!root) badResponse();
  const total = Number(scalar(root.totalCnt)); if (!Number.isInteger(total) || total < 0) badResponse();
  const entries = array(root[input.kind === 'law' ? 'law' : 'admrul']);
  if (entries.length > 100 || entries.some(item => !record(item))) badResponse();
  if (!entries.length && total > 0 && (page - 1) * pageSize < total) badResponse();
  return { kind: input.kind, query, scope, page, total, pageSize, items: entries.map(item => metadata(item as RecordValue, input.kind)) };
}

function nestedText(value: unknown, depth = 0): string[] {
  if (depth > 8) badResponse();
  if (typeof value === 'string' || typeof value === 'number') { const text = lawPlainText(value); return text ? [text] : []; }
  if (Array.isArray(value)) return value.flatMap(item => nestedText(item, depth + 1));
  const object = record(value); if (!object) return [];
  const lines: string[] = [];
  // Traverse only content and structural child fields, never metadata, amendment history or hyperlinks.
  for (const key of ['조문내용', '항내용', '호내용', '목내용', '내용', '항', '호', '목']) if (object[key] !== undefined) lines.push(...nestedText(object[key], depth + 1));
  if (!lines.length) { const text = lawPlainText(object); if (text) lines.push(text); }
  return lines;
}
function articleNumber(unit: RecordValue) {
  const number = pick(unit, '조문번호'); const branch = pick(unit, '조문가지번호');
  if (!number) return '';
  return /^\d+$/.test(number) ? `제${Number(number)}조${branch && Number(branch) ? `의${Number(branch)}` : ''}` : number;
}
function articlesFrom(value: unknown, kind: LawKind): LawArticle[] {
  const section = record(value);
  const units = array(section?.조문단위 ?? section?.조문 ?? value);
  const articles: LawArticle[] = [];
  for (const [index, raw] of units.entries()) {
    const unit = record(raw);
    if (unit && pick(unit, '조문여부') === '전문') continue;
    const content = nestedText(raw).join('\n').trim(); if (!content) continue;
    const number = unit ? articleNumber(unit) : '';
    const title = unit ? pick(unit, '조문제목') : '';
    articles.push({ id: `${kind}-article-${index + 1}`, number, title: title || number || `본문 ${index + 1}`, content });
  }
  return articles;
}

export async function getLawDetail(input: { kind: LawKind; id: string }, options: LawApiOptions = {}): Promise<LawDetail> {
  assertKind(input.kind); if (!numericId.test(input.id)) throw new DomainError(422, 'LAW_INVALID_INPUT', '검색 결과에서 법령 또는 행정규칙을 다시 선택해 주세요.');
  const raw = await fetchJson('lawService.do', { target: input.kind === 'law' ? 'eflaw' : 'admrul', ID: input.id }, options);
  const root = findObject(raw, item => item.기본정보 !== undefined || item.행정규칙명 !== undefined || item.법령명_한글 !== undefined);
  if (!root) badResponse();
  const basic = record(root.기본정보) ?? root;
  const meta = metadata(basic, input.kind, input.id);
  // Numeric JSON values can drop leading zeroes from statutory IDs.
  if (meta.id.replace(/^0+/, '') !== input.id.replace(/^0+/, '')) badResponse();
  const section = root.조문 ?? root.조문단위 ?? root.조문내용;
  const articles = articlesFrom(section, input.kind);
  if (!articles.length) throw new DomainError(404, 'LAW_BODY_UNAVAILABLE', '선택한 자료에서 가져올 조문 본문을 찾지 못했습니다. 국가법령정보센터 원문 또는 첨부파일을 확인해 주세요.');
  if (articles.length > 4000) throw new DomainError(502, 'LAW_RESPONSE_TOO_LARGE', '조문이 너무 많아 가져오지 못했습니다. 국가법령정보센터에서 필요한 조문을 확인해 주세요.');
  const warnings = ['조회 시점의 현행 자료입니다. 실제 업무에 적용할 시행일과 부칙·별표를 원문에서 함께 확인해 주세요.'];
  if (input.kind === 'admrul' && articles.some(article => !article.number)) warnings.push('조문 번호가 없는 행정규칙 본문은 제공된 본문 단위로 표시합니다.');
  if (root.별표 || root.첨부파일) warnings.push('별표·서식과 별도 첨부파일은 이 조문 목록에 포함되지 않습니다. 원문에서 확인해 주세요.');
  return { ...meta, id: input.id, articles, warnings };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import type { LawDetail } from '../src/lib/law-api-types';
import type { TaskReference } from '../src/lib/types';
import { importLawArticles, lawArticleLabel } from '../src/lib/law-reference-import';

const detail: LawDetail = {
  id: '012345', kind: 'law', title: '시연 통계법', category: '법률', ministry: '시연기관', promulgationDate: '2026-01-01', effectiveDate: '2026-07-01', sourceUrl: 'https://www.law.go.kr/법령/시연통계법', warnings: [],
  articles: [
    { id: 'article-1', number: '제1조', title: '(목적)', content: '제1조(목적) 이 법은 시연 자료의 관리에 관한 사항을 정한다.\n① 담당자는 자료를 작성한다.\n1. 자료를 분류한다.\n가. 원자료를 보관한다.' },
    { id: 'article-2', number: '제2조', title: '제2조(검토)', content: '제2조(검토) 부서장은 작성된 자료를 검토한다.' },
  ],
};
const existing: TaskReference = { id: 'existing', type: 'document', title: '내 생산 문서', content: '기존에 작성한 결과', attachmentId: 'file-1' };

test('import preserves complete nested article text, dates and source while retaining existing records', () => {
  const before = structuredClone(existing); let counter = 0;
  const imported = importLawArticles([existing, { id: 'placeholder', type: 'law', title: '', content: '' }], detail, ['article-1', 'article-2'], () => `new-${++counter}`);
  assert.equal(imported.addedCount, 2); assert.equal(imported.duplicateCount, 0);
  assert.equal(imported.references.length, 3); assert.deepEqual(imported.references[0], before); assert.deepEqual(existing, before);
  const first = imported.references[1];
  assert.equal(first.type, 'law'); assert.equal(first.url, detail.sourceUrl); assert.equal(first.title, '시연 통계법 · 제1조 (목적)');
  assert.ok(first.content.endsWith(detail.articles[0].content));
  for (const value of [detail.title, detail.category, detail.ministry, detail.effectiveDate, detail.promulgationDate]) assert.ok(first.content.includes(value));
  assert.equal(imported.references[2].title, '시연 통계법 · 제2조(검토)');
  assert.equal(lawArticleLabel(detail.articles[1]), '제2조(검토)');
});

test('administrative rules import as guidelines and duplicate imports do not append or create IDs', () => {
  const rule = { ...detail, kind: 'admrul' as const, title: '시연 통계 작성 지침', category: '훈령', sourceUrl: 'https://www.law.go.kr/행정규칙/시연통계작성지침' };
  const first = importLawArticles([], rule, ['article-1'], () => 'new-rule');
  assert.equal(first.references[0].type, 'guideline'); assert.match(first.references[0].content, /행정규칙: 시연 통계 작성 지침/);
  const second = importLawArticles(first.references, rule, ['article-1'], () => { throw new Error('Duplicate must not allocate another reference'); });
  assert.equal(second.addedCount, 0); assert.equal(second.duplicateCount, 1); assert.deepEqual(second.references, first.references);
});

test('imports reject invalid selections, excessive counts or content atomically without truncation', () => {
  for (const ids of [[], ['missing'], ['article-1', 'article-1']]) assert.throws(() => importLawArticles([existing], detail, ids));
  const many = Array.from({ length: 100 }, (_, index) => ({ ...existing, id: `existing-${index}` }));
  assert.throws(() => importLawArticles(many, detail, ['article-1']), /최대 100개/); assert.equal(many.length, 100);
  const large = { ...detail, articles: [{ ...detail.articles[0], content: '본문'.repeat(100_001) }] };
  assert.throws(() => importLawArticles([existing], large, ['article-1']), /20만 자/); assert.equal(large.articles[0].content.length, 200_002);
  assert.throws(() => importLawArticles([], { ...detail, articles: [{ ...detail.articles[0], content: ' ' }] }, ['article-1']), /비어/);
});

test('imported source links must be public HTTPS law URLs without credentials or API authentication', () => {
  for (const sourceUrl of ['javascript:alert(1)', 'https://other.example/article', 'http://www.law.go.kr/article', 'https://secret@www.law.go.kr/article', 'https://www.law.go.kr/DRF/lawService.do?OC=secret']) {
    assert.throws(() => importLawArticles([], { ...detail, sourceUrl }, ['article-1']), /원문 주소/);
  }
});

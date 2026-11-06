import type { LawArticle, LawDetail } from './law-api-types';
import type { TaskReference } from './types';
import { hasReferenceContent } from './task-references';

const contentLimit = 200_000;
const referenceLimit = 100;

export function lawArticleLabel(article: LawArticle): string {
  const number = article.number.trim(); const title = article.title.trim();
  return title.startsWith(number) ? title || number : [number, title].filter(Boolean).join(' ');
}

/** Add reviewed, complete article text to the local form; the caller saves the task separately. */
export function importLawArticles(current: TaskReference[], detail: LawDetail, articleIds: string[], createId = () => `ref-${crypto.randomUUID().slice(0, 12)}`) {
  if (!articleIds.length) throw new Error('추가할 조문을 선택해 주세요.');
  if (new Set(articleIds).size !== articleIds.length) throw new Error('선택한 조문이 중복되었습니다.');
  let source: URL;
  try { source = new URL(detail.sourceUrl); } catch { throw new Error('법령 원문 주소를 확인하지 못했습니다. 다시 조회해 주세요.'); }
  if (source.protocol !== 'https:' || !['www.law.go.kr', 'law.go.kr'].includes(source.hostname) || source.username || source.password || [...source.searchParams.keys()].some(key => key.toLowerCase() === 'oc')) throw new Error('법령 원문 주소를 확인하지 못했습니다. 다시 조회해 주세요.');
  const articles = articleIds.map(id => detail.articles.find(article => article.id === id));
  if (articles.some(article => !article)) throw new Error('선택한 조문을 찾지 못했습니다. 다시 조회해 주세요.');
  const references = current.filter(hasReferenceContent);
  const additions: TaskReference[] = [];
  let duplicateCount = 0;
  for (const article of articles as LawArticle[]) {
    const label = lawArticleLabel(article);
    if (!article.content.trim()) throw new Error(`${label || '선택한 조문'}의 본문이 비어 있습니다. 원문을 확인해 주세요.`);
    const title = `${detail.title} · ${label || '본문'}`;
    if (title.length > 300) throw new Error('법령명과 조문 제목이 너무 깁니다. 원문에서 필요한 조문을 확인해 직접 등록해 주세요.');
    const content = [
      '[국가법령정보센터에서 가져온 조문]',
      `${detail.kind === 'law' ? '법령' : '행정규칙'}: ${detail.title}`,
      detail.category ? `구분: ${detail.category}` : '',
      detail.ministry ? `소관기관: ${detail.ministry}` : '',
      detail.effectiveDate ? `시행일: ${detail.effectiveDate}` : '',
      detail.promulgationDate ? `공포·발령일: ${detail.promulgationDate}` : '',
      label ? `조문: ${label}` : '',
    ].filter(Boolean).join('\n') + `\n\n${article.content}`;
    if (content.length > contentLimit) throw new Error(`${label || '선택한 조문'}의 본문이 근거 1건의 한도인 20만 자를 넘었습니다. 원문에서 필요한 범위를 확인해 직접 등록해 주세요.`);
    if ([...references, ...additions].some(reference => reference.url === detail.sourceUrl && reference.content === content)) { duplicateCount++; continue; }
    additions.push({ id: createId(), type: detail.kind === 'law' ? 'law' : 'guideline', title, content, url: detail.sourceUrl });
  }
  if (references.length + additions.length > referenceLimit) throw new Error(`근거는 최대 ${referenceLimit}개까지 등록할 수 있습니다. 선택한 조문 수를 줄이거나 기존 근거를 정리해 주세요.`);
  return { references: [...references, ...additions], addedCount: additions.length, duplicateCount };
}

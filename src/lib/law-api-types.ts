export type LawKind = 'law' | 'admrul';
export type LawSearchScope = 'title' | 'content';

/** Plain-text public metadata only. API credentials and authenticated DRF URLs never leave the server. */
export interface LawSearchItem {
  id: string;
  kind: LawKind;
  title: string;
  category: string;
  ministry: string;
  promulgationDate: string;
  effectiveDate: string;
  sourceUrl: string;
}

export interface LawSearchResult {
  kind: LawKind;
  query: string;
  scope: LawSearchScope;
  page: number;
  total: number;
  pageSize: number;
  items: LawSearchItem[];
}

export interface LawArticle {
  id: string;
  number: string;
  title: string;
  /** Full text, including nested paragraphs, subparagraphs and items; never silently truncated. */
  content: string;
}

export interface LawDetail extends LawSearchItem {
  articles: LawArticle[];
  warnings: string[];
}

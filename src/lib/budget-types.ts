export type BudgetMode = 'manual' | 'catalog' | 'none';

/** Amounts in this catalog are integer Korean won, independently of the PDF's display unit. */
export interface BudgetCatalogItem {
  rev?: number;
  id: string;
  year: number;
  account: string;
  field: string;
  sector: string;
  program: string;
  unitProject?: string;
  projectName: string;
  accountCode?: string;
  fieldCode?: string;
  sectorCode?: string;
  programCode?: string;
  unitProjectCode?: string;
  projectCode?: string;
  confirmedAmountWon: number;
  sourceAmount?: string | number;
  sourceUnit?: string;
  sourcePage?: number;
  sourcePrintedPage?: string | number;
  sourceFileName?: string;
  sourceSha256?: string;
  active?: boolean;
  updatedAt?: string;
  updatedBy?: string;
  [key: string]: unknown;
}

export interface BudgetCatalogSource {
  fileName: string;
  sha256?: string;
  [key: string]: unknown;
}

export interface BudgetCatalog {
  rev?: number;
  schemaVersion: 1;
  year: number;
  source: BudgetCatalogSource;
  items: BudgetCatalogItem[];
  [key: string]: unknown;
}

export interface BudgetSearchResult {
  items: BudgetCatalogItem[];
  total: number;
  page: number;
  pageSize: number;
  source: BudgetCatalogSource;
  years: number[];
  revision: number;
  catalogRev?: number;
}

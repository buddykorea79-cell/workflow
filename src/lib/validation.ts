import { z } from 'zod';
import { DomainError } from './domain-error';
import { requireText, summarizeIssues, withParticle, type FieldIssue } from './form-validation';

z.config(z.locales.ko());

export type ValidationLabels = Record<string, string>;
const labels: ValidationLabels = {
  title: '이름', description: '설명', name: '이름', shortName: '줄임 이름',
  dueDate: '마감일', startDate: '시작일', startsAt: '시작 시각', endsAt: '종료 시각',
  unitId: '단위업무', unitIds: '단위업무', taskId: '세부업무', taskIds: '세부업무',
  primaryId: '담당자', supportIds: '지원 담당자', reviewerId: '검토 담당자',
  departmentId: '부서', departmentIds: '대상 부서', ownerId: '담당자', fromId: '인계자', toId: '새 담당자', userId: '구성원', deputyId: '기본 대행자',
  reason: '사유', comment: '의견', content: '내용', evidence: '근거', url: '주소',
  period: '평가 기간', month: '실적 월', frequency: '반복 주기', priority: '우선순위', importance: '중요도',
  workflow: '절차', steps: '절차 일정', requiredSteps: '공통 필수 절차', role: '역할', roleIds: '변경할 역할',
  output: '결과물', checklist: '확인 항목', dependsOn: '선행 절차', required: '필수 여부',
  scheduleDetails: '일정 내용', completionCriteria: '완료 기준', attachmentIds: '첨부파일',
  descriptionAttachmentIds: '업무 설명 참고 파일', attachmentId: '첨부파일', sourceIds: '근거 자료',
  budget: '예산액', budgetMode: '예산 구분', budgetItemId: '예산 사업', expenses: '집행 내역',
  references: '근거 자료', documents: '생산 문서', amount: '집행 금액', date: '일자', time: '시각', vendor: '지급처',
  projectName: '사업명', year: '연도', account: '회계', field: '분야', sector: '부문', program: '프로그램',
  unitProject: '단위사업', confirmedAmountWon: '확정 예산액', sourceAmount: '원본 금액', sourceUnit: '금액 단위',
  sourcePage: '자료 쪽수', sourcePrintedPage: '인쇄 쪽수', sourceFileName: '자료 파일명', fileName: '파일명',
  schemaVersion: '자료 형식', items: '예산 항목', catalog: '예산 자료', source: '출처',
  allocations: '업무 비중', maxScore: '업무 비중', scores: '평가 점수', score: '점수',
  metricName: '지표명', value: '실적 값', unit: '단위', achievements: '실적 내용', nextPlan: '다음 계획',
  team: '팀', email: '이메일', phone: '전화번호', active: '활성 여부', done: '완료 여부',
  directiveIssuer: '지시자', instructedOn: '지시일자', kind: '업무 구분', distributionMode: '배포 방식',
  actions: '대행 범위', id: '항목', type: '요청 종류', payload: '입력 내용',
  expectedRevision: '변경 기준', requestId: '요청 정보', transferId: '인수인계 요청',
};
const collections: ValidationLabels = { workflow: '절차', steps: '절차', expenses: '집행', references: '근거', documents: '문서', items: '예산 항목', allocations: '업무', scores: '평가' };

export function validationLabel(path: PropertyKey[], overrides: ValidationLabels = {}) {
  const key = path.map(String).join('.');
  if (overrides[key]) return overrides[key];
  const wildcard = path.map(part => typeof part === 'number' ? '*' : String(part)).join('.');
  if (overrides[wildcard]) return overrides[wildcard];
  const last = String(path.at(-1) ?? '');
  const indexed = path.findIndex(part => typeof part === 'number');
  if (indexed > 0) {
    const collection = String(path[indexed - 1]), ordinal = Number(path[indexed]) + 1;
    if (collection === 'allocations' && last === 'maxScore') return '업무 비중';
    const detail = collection === 'steps' && last === 'dueDate' ? '종료일'
      : ['references', 'documents'].includes(collection) && last === 'title' ? '제목'
      : collection === 'expenses' && last === 'amount' ? '금액' : labels[last];
    if (collections[collection] && detail) return `${ordinal}번째 ${collections[collection]} ${detail}`;
    if (labels[collection]) return `${ordinal}번째 ${labels[collection]}`;
  }
  return labels[last] || '입력값';
}

function issueMessage(issue: z.core.$ZodIssue, label: string): string {
  const object = withParticle(label, '을', '를'), topic = withParticle(label, '은', '는');
  switch (issue.code) {
    case 'too_small':
      if (issue.origin === 'string') return issue.minimum === 1 ? requireText('', label) : `${object} ${issue.minimum}자 ${issue.inclusive ? '이상' : '초과'} 입력해 주세요.`;
      if (issue.origin === 'array' || issue.origin === 'set') return `${object} ${issue.minimum}개 ${issue.inclusive ? '이상' : '초과'} 선택해 주세요.`;
      return `${topic} ${issue.minimum} ${issue.inclusive ? '이상' : '초과'}이어야 합니다.`;
    case 'too_big':
      if (issue.origin === 'string') return `${topic} ${issue.maximum}자 이내로 입력해 주세요.`;
      if (issue.origin === 'array' || issue.origin === 'set') return `${topic} ${issue.maximum}개까지 선택할 수 있습니다.`;
      return `${topic} ${issue.maximum} ${issue.inclusive ? '이하여야' : '미만이어야'} 합니다.`;
    case 'invalid_type':
      if (issue.expected === 'string') return requireText('', label);
      if (issue.expected === 'number' || issue.expected === 'int') return `${object} ${issue.expected === 'int' ? '정수' : '숫자'}로 입력해 주세요.`;
      if (issue.expected === 'boolean') return `${object} 선택해 주세요.`;
      return `${object} 올바르게 입력해 주세요.`;
    case 'invalid_value': return `${object} 목록에서 선택해 주세요.`;
    case 'invalid_format':
      // Keep deliberate Korean date/refine guidance, but never expose regexes or format identifiers.
      if (/[가-힣]/.test(issue.message) && !issue.message.startsWith('잘못된')) return issue.message.replace('HTTP(S)', '웹');
      return `${label} 형식을 확인해 주세요.`;
    case 'custom': return /[가-힣]/.test(issue.message) ? issue.message.replace('HTTP(S)', '웹') : `${object} 확인해 주세요.`;
    case 'not_multiple_of': return `${topic} ${issue.divisor}의 배수로 입력해 주세요.`;
    case 'unrecognized_keys': return '입력 항목을 확인해 주세요.';
    default: return `${object} 올바르게 입력해 주세요.`;
  }
}

export function formatIssues(issues: readonly z.core.$ZodIssue[], overrides: ValidationLabels = {}) {
  const fields: FieldIssue[] = issues.map(issue => ({ path: issue.path.map(String).join('.'), message: issueMessage(issue, validationLabel(issue.path, overrides)) }));
  return { message: summarizeIssues(fields.map(field => field.message)), fields };
}

export function parseInput<T>(schema: z.ZodType<T>, input: unknown, options: { labels?: ValidationLabels; code?: string; path?: string } = {}): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = options.path ? result.error.issues.map(issue => ({ ...issue, path: [options.path!, ...issue.path] })) : result.error.issues;
  const { message, fields } = formatIssues(issues, options.labels);
  throw new DomainError(422, options.code || 'VALIDATION_ERROR', message, fields);
}

export function commandValidationLabels(type: string): ValidationLabels {
  if (type.startsWith('task.') || type.startsWith('common.')) return { title: '세부업무 이름', description: '업무 설명', reason: type.endsWith('.reject') ? '반려 사유' : '사유' };
  if (type.startsWith('unit.')) return { title: '단위업무 이름', description: '업무 범위' };
  if (type.startsWith('performance.')) return { description: '성과 내용' };
  return {};
}

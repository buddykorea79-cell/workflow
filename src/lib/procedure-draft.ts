import type { TaskReference, WorkflowStep } from './types';

export const PROCEDURE_TEXT_LIMIT = 200_000;
export const PROCEDURE_STEP_LIMIT = 20;
export const PROCEDURE_PDF_LIMIT = 10 * 1024 * 1024;
export interface ProcedurePage { page: number; text: string }
export interface ProcedureSource { title: string; text: string; type: TaskReference['type']; url?: string; pages?: ProcedurePage[] }
export interface ProcedureEvidence { sourceTitle: string; locator: string; excerpt: string }
export interface ProcedureDraft { steps: WorkflowStep[]; references: TaskReference[]; evidence: Record<string, ProcedureEvidence>; warnings: string[] }

const numbered = /^(?:제\s*\d+\s*조(?:의\s*\d+)?(?:\([^)]*\))?|\d{1,3}[.)]\s*|[가-하][.)]\s*|[①-⑳]\s*|[-•○]\s*)/;
const actions = /접수|신청|제출|검토|승인|심사|확인|작성|통보|배정|등록|취합|협의|지급|정산|보고|분석|처리|평가|결정|수집/;
export function validSourceUrl(value: string): boolean {
  if (!value.trim()) return true;
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

/** Only plain text is considered; source contents never become executable code. */
function paragraphs(text: string): string[] {
  const result: string[] = []; let current = '';
  const flush = () => { if (current.trim()) result.push(current.trim()); current = ''; };
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    const line = raw.replace(/\u0000/g, '').trim();
    if (!line) { flush(); continue; }
    if (numbered.test(line)) flush();
    current += (current ? ' ' : '') + line;
  }
  flush();
  // A pasted single paragraph can still contain separate procedural sentences.
  return result.length === 1 && !numbered.test(result[0]) ? result[0].split(/(?<=[.!?。])\s+/).filter(Boolean) : result;
}

export function generateProcedureDraft(source: ProcedureSource, idPrefix: string): ProcedureDraft {
  if (!source.title.trim()) throw new Error('자료 제목을 입력해 주세요.');
  if (!validSourceUrl(source.url || '')) throw new Error('원문 주소는 HTTP 또는 HTTPS 주소로 입력해 주세요.');
  if (!source.text.trim() && !source.pages?.some(page => page.text.trim())) throw new Error('절차를 만들 본문을 입력해 주세요.');
  const pageTextLength = source.pages?.reduce((sum, page) => sum + page.text.length, 0) ?? 0;
  if (source.text.length > PROCEDURE_TEXT_LIMIT || pageTextLength > PROCEDURE_TEXT_LIMIT) throw new Error('본문은 20만 자 이하로 입력해 주세요.');
  const groups = source.pages?.length ? source.pages : [{ page: 0, text: source.text }];
  const candidates = groups.flatMap(group => paragraphs(group.text).map((text, index) => ({ text, locator: `${group.page ? `${group.page}쪽 · ` : ''}문단 ${index + 1}` }))).filter(item => actions.test(item.text));
  const warnings = ['번호·문단 순서로 연결한 규칙 기반 초안입니다. 실제 담당 역할, 선행 조건과 원문 근거를 검토해 주세요.'];
  if (!candidates.length) throw new Error('절차로 추출할 문장을 찾지 못했습니다. 신청·검토·제출 등 수행 내용이 있는 본문을 붙여 넣어 주세요.');
  if (candidates.length > PROCEDURE_STEP_LIMIT) warnings.push(`후보 ${candidates.length}개 중 앞의 ${PROCEDURE_STEP_LIMIT}개를 가져왔습니다. 나머지 본문은 별도로 검토해 주세요.`);
  const evidence: Record<string, ProcedureEvidence> = {};
  const steps = candidates.slice(0, PROCEDURE_STEP_LIMIT).map((item, index): WorkflowStep => {
    const id = `${idPrefix}-${index + 1}`;
    const title = item.text.replace(numbered, '').trim().slice(0, 90) || `절차 ${index + 1}`;
    const role = /검토|승인|심사|평가|결정/.test(title) ? 'reviewer' : /취합|수집|지원|협조/.test(title) ? 'support' : 'primary';
    evidence[id] = { sourceTitle: source.title.trim(), locator: item.locator, excerpt: item.text };
    return { id, title, role, description: `[근거: ${source.title.trim()} · ${item.locator}]\n${item.text.slice(0, 4300)}\n\n역할·완료 조건은 검토 후 확정해 주세요.`, output: '결과물 확인 필요', required: true, dependsOn: index ? [`${idPrefix}-${index}`] : [], checklist: ['처리 결과와 근거 확인'], done: false };
  });
  if (!steps.some(step => step.role === 'reviewer')) {
    const id = `${idPrefix}-review`;
    steps.push({ id, title: '절차 및 결과 검토', role: 'reviewer', description: '원문에서 직접 추출한 단계가 아닙니다. 업무 확정에 필요한 필수 검토 단계로 추가했습니다. 실제 검토자와 완료 조건을 확인해 주세요.', output: '검토 의견', required: true, dependsOn: [steps.at(-1)!.id], checklist: ['원문과 업무 절차의 일치 확인'], done: false });
    evidence[id] = { sourceTitle: source.title.trim(), locator: '검토용 추가 단계 · 직접 근거 없음', excerpt: '' };
    warnings.push('원문에서 검토 역할을 찾지 못해 검토용 단계를 추가했습니다. 실제 절차에 맞게 수정해 주세요.');
  }
  const referenceText = groups.map(group => `${group.page ? `[${group.page}쪽]\n` : ''}${group.text}`).join('\n\n');
  if (referenceText.length > 9800) warnings.push('자료 근거에는 본문 앞부분 9,800자만 보관합니다. 단계별 발췌와 원문 주소를 함께 확인해 주세요.');
  return { steps, evidence, warnings, references: [{ id: `${idPrefix}-source`, type: source.type, title: source.title.trim().slice(0, 300), content: `절차 초안에 사용한 자료 · 원문 적용 여부 검토 필요\n${referenceText.slice(0, 9800)}`, ...(source.url?.trim() ? { url: source.url.trim() } : {}) }] };
}

export function procedureErrors(steps: WorkflowStep[]): string[] {
  const errors: string[] = []; const ids = new Set(steps.map(step => step.id));
  if (!steps.length || steps.length > 50) errors.push('절차는 1개 이상 50개 이하로 구성해 주세요.');
  if (ids.size !== steps.length) errors.push('절차 ID가 중복되었습니다.');
  if (steps.some(step => !step.title.trim() || step.title.length > 150)) errors.push('각 절차의 이름은 1~150자로 입력해 주세요.');
  if (steps.some(step => step.description.length > 5000)) errors.push('절차 설명은 5,000자 이하로 입력해 주세요.');
  if (steps.some(step => step.output.length > 1000 || step.checklist.length > 50 || step.checklist.some(item => !item.trim() || item.length > 5000))) errors.push('결과물과 확인 항목의 길이를 확인해 주세요.');
  if (!steps.some(step => step.role === 'reviewer' && step.required)) errors.push('필수 검토·승인 절차를 하나 이상 지정해 주세요.');
  if (steps.some(step => step.dependsOn.some(id => id === step.id || !ids.has(id)) || new Set(step.dependsOn).size !== step.dependsOn.length)) errors.push('선행 절차가 없거나 자기 자신·중복 항목을 참조합니다.');
  const visited = new Set<string>(); const visiting = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if (steps.find(step => step.id === id)?.dependsOn.some(visit)) return true;
    visiting.delete(id); visited.add(id); return false;
  };
  if (steps.some(step => visit(step.id))) errors.push('순환 연결이 있습니다. 선행 절차를 다시 선택해 주세요.');
  return errors;
}

/** Merge by identity, preserving every existing step and its completed state. */
export function applyProcedureDraft(current: WorkflowStep[], draft: WorkflowStep[], mode: 'append' | 'replace', canReplace = false): WorkflowStep[] {
  if (mode === 'replace' && (!canReplace || current.some(step => step.done))) throw new Error('완료한 절차가 없는 개인업무만 전체 교체할 수 있습니다.');
  if (mode === 'replace') {
    const errors = procedureErrors(draft); if (errors.length) throw new Error(errors[0]);
    return structuredClone(draft).map(step => ({ ...step, done: false }));
  }
  const taken = new Set(current.map(step => step.id)); const mapping = new Map<string, string>();
  for (const step of draft) { let id = step.id; let suffix = 2; while (taken.has(id)) id = `${step.id}-${suffix++}`; mapping.set(step.id, id); taken.add(id); }
  const terminals = current.filter(step => !current.some(other => other.dependsOn.includes(step.id))).map(step => step.id);
  const appended = draft.map(step => ({ ...structuredClone(step), id: mapping.get(step.id)!, done: false, dependsOn: step.dependsOn.length ? step.dependsOn.map(id => mapping.get(id) || id) : terminals }));
  const merged = [...structuredClone(current), ...appended]; const errors = procedureErrors(merged);
  if (errors.length) throw new Error(errors[0]);
  return merged;
}

export function pdfEnvelopeError(name: string, mime: string, bytes: Uint8Array): string | undefined {
  if (!bytes.length || bytes.length > PROCEDURE_PDF_LIMIT) return 'PDF는 비어 있지 않은 10MB 이하 파일이어야 합니다.';
  if (!/\.pdf$/i.test(name) || !['application/pdf', 'application/x-pdf'].includes(mime.toLowerCase())) return 'PDF 형식의 파일을 선택해 주세요.';
  if (new TextDecoder('ascii').decode(bytes.slice(0, 5)) !== '%PDF-') return 'PDF 파일의 형식을 확인할 수 없습니다.';
}

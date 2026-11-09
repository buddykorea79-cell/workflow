import { withParticle, type FieldIssue } from './form-validation';
import type { Card, Frequency } from './types';
import { WORK_REGISTRATION_UNIT_LIMIT } from './work-registration-policy';

/** Shared with the preview UI. Keep this module free of server and AI dependencies. */
export const WORK_IMPORT_LIMITS = { maxUnits: WORK_REGISTRATION_UNIT_LIMIT, maxTasks: 30, unitTitle: 100, taskTitle: 150, description: 5000, totalText: 60_000, bodyBytes: 256_000 } as const;
export const WORK_IMPORT_FREQUENCIES = ['once', 'monthly', 'quarterly', 'half_yearly', 'yearly'] as const;
export const WORK_IMPORT_PRIORITIES = ['low', 'medium', 'high'] as const;
export type WorkImportTask = { title: string; description: string; dueDate: string; frequency: Frequency; priority: 'low' | 'medium' | 'high' };
export type WorkImportUnit = { title: string; description: string; tasks: WorkImportTask[] };
export type WorkImportInput = { importId: string; units: WorkImportUnit[] };
export type WorkImportValidation = { success: true; data: WorkImportInput } | { success: false; issues: FieldIssue[] };

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

/** Normalize user-reviewed text and reject hidden assignment, attachment, or state fields. */
export function validateWorkImport(value: unknown): WorkImportValidation {
  return validateWorkImportWithUnitLimit(value, WORK_IMPORT_LIMITS.maxUnits);
}

/** Only verify a matching actor's already-completed receipt; never use this to create new work. */
export function validateCompletedWorkImportReplay(value: unknown): WorkImportValidation {
  return validateWorkImportWithUnitLimit(value, 10);
}

function validateWorkImportWithUnitLimit(value: unknown, maxUnits: number): WorkImportValidation {
  const issues: FieldIssue[] = [];
  const issue = (path: string, message: string) => { issues.push({ path, message }); };
  const strictObject = (input: unknown, keys: readonly string[], path: string): Record<string, unknown> => {
    if (!object(input)) { issue(path, '등록할 업무의 입력 형식을 확인해 주세요.'); return {}; }
    if (Object.keys(input).some(key => !keys.includes(key))) issue(path, '허용되지 않은 입력 항목이 있습니다. 담당자와 부서는 현재 계정으로 지정됩니다.');
    return input;
  };
  let textLength = 0;
  const text = (input: unknown, path: string, label: string, max: number) => {
    const normalized = typeof input === 'string' ? input.trim() : '';
    textLength += normalized.length;
    if (!normalized) issue(path, `${withParticle(label, '을', '를')} 입력해 주세요.`);
    else if (normalized.length > max) issue(path, `${withParticle(label, '은', '는')} ${max.toLocaleString('ko-KR')}자 이내로 입력해 주세요.`);
    return normalized;
  };
  const input = strictObject(value, ['importId', 'units'], '');
  const importId = typeof input.importId === 'string' ? input.importId.trim().toLowerCase() : '';
  if (!uuid.test(importId)) issue('importId', '등록 요청 정보를 다시 준비해 주세요.');
  const rawUnits = Array.isArray(input.units) ? input.units : [];
  if (!rawUnits.length || rawUnits.length > maxUnits) issue('units', `단위업무는 1개 이상 ${maxUnits}개 이하로 등록해 주세요. 유사한 업무는 같은 단위업무로 묶어 주세요.`);
  let taskCount = 0;
  const units = rawUnits.slice(0, maxUnits).map((rawUnit, unitIndex): WorkImportUnit => {
    const path = `units.${unitIndex}`;
    const unit = strictObject(rawUnit, ['title', 'description', 'tasks'], path);
    const title = text(unit.title, `${path}.title`, '단위업무 이름', WORK_IMPORT_LIMITS.unitTitle);
    const description = text(unit.description, `${path}.description`, '단위업무 범위', WORK_IMPORT_LIMITS.description);
    const rawTasks = Array.isArray(unit.tasks) ? unit.tasks : [];
    taskCount += rawTasks.length;
    if (!rawTasks.length || rawTasks.length > WORK_IMPORT_LIMITS.maxTasks) issue(`${path}.tasks`, '각 단위업무에 세부업무를 1개 이상 넣고, 전체 30개 이내로 등록해 주세요.');
    const tasks = rawTasks.slice(0, WORK_IMPORT_LIMITS.maxTasks).map((rawTask, taskIndex): WorkImportTask => {
      const taskPath = `${path}.tasks.${taskIndex}`;
      const task = strictObject(rawTask, ['title', 'description', 'dueDate', 'frequency', 'priority'], taskPath);
      const taskTitle = text(task.title, `${taskPath}.title`, '세부업무 이름', WORK_IMPORT_LIMITS.taskTitle);
      const taskDescription = text(task.description, `${taskPath}.description`, '업무 설명', WORK_IMPORT_LIMITS.description);
      const dueDate = typeof task.dueDate === 'string' ? task.dueDate.trim() : '';
      if (!dueDate) issue(`${taskPath}.dueDate`, '업무 마감일을 입력해 주세요.');
      else if (!validDate(dueDate)) issue(`${taskPath}.dueDate`, '실제 존재하는 마감일을 연-월-일 형식으로 입력해 주세요.');
      const frequency = task.frequency === undefined ? 'once' : task.frequency;
      const priority = task.priority === undefined ? 'medium' : task.priority;
      if (!WORK_IMPORT_FREQUENCIES.includes(frequency as Frequency)) issue(`${taskPath}.frequency`, '반복 주기를 목록에서 선택해 주세요.');
      if (!WORK_IMPORT_PRIORITIES.includes(priority as WorkImportTask['priority'])) issue(`${taskPath}.priority`, '우선순위를 목록에서 선택해 주세요.');
      return { title: taskTitle, description: taskDescription, dueDate, frequency: frequency as Frequency, priority: priority as WorkImportTask['priority'] };
    });
    return { title, description, tasks };
  });
  if (taskCount > WORK_IMPORT_LIMITS.maxTasks) issue('units', '세부업무는 전체 30개까지 등록할 수 있습니다.');
  if (textLength > WORK_IMPORT_LIMITS.totalText) issue('units', '업무 이름과 설명은 합계 6만 자 이내로 입력해 주세요.');
  const data = { importId, units };
  if (!issues.length && new TextEncoder().encode(canonicalWorkImport(data)).length > WORK_IMPORT_LIMITS.bodyBytes) issue('units', '등록 내용이 너무 큽니다. 설명을 줄이거나 나누어 등록해 주세요.');
  return issues.length ? { success: false, issues } : { success: true, data };
}

/** Explicit property order keeps retries stable across JSON property ordering. */
export function canonicalWorkImport(input: WorkImportInput): string {
  return JSON.stringify({ importId: input.importId, units: input.units.map(unit => ({ title: unit.title, description: unit.description, tasks: unit.tasks.map(task => ({ title: task.title, description: task.description, dueDate: task.dueDate, frequency: task.frequency, priority: task.priority })) })) });
}

/** An import must never inherit demo departments or pretend unverified evidence exists. */
export function workImportNeutralCard(description: string): Card {
  return { purpose: description, stakeholders: '관련 대상은 담당자가 확인합니다.', evidence: '근거 자료는 확인 후 연결합니다.', responsibility: '정담당 수행 · 소유 부서장 검토', procedure: '자료 준비 → 내용 검증 → 내부 검토 → 최종 제출', finance: '예산 여부와 금액은 담당자가 확인합니다.', documents: '필요한 생산 문서는 담당자가 확인합니다.', issues: '주의사항은 확인 후 보완합니다.', handover: '인수인계 시 진행 상황과 미완료 내용을 정리합니다.' };
}

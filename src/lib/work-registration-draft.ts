import type { CommandFailure } from './command-response';
import type { WorkImportInput, WorkImportTask, WorkImportUnit } from './work-import';

export type RegistrationTask = WorkImportTask & { key: string };
export type RegistrationUnit = Omit<WorkImportUnit, 'tasks'> & { key: string; tasks: RegistrationTask[] };
export type RegistrationSource = { key: string; name: string; text: string; attachmentId?: string; loading?: boolean; error?: string; warnings?: string[] };
export type RegistrationSnapshot = { description: string; documents: RegistrationSource[]; units: RegistrationUnit[] };
export type RegistrationAttempt = { input: WorkImportInput; snapshot: string; everUnknown: boolean };
export type AnalysisUnit = { title: string; description: string; tasks: { title: string; description: string }[] };

export function registrationPreview(units: AnalysisUnit[], key = () => crypto.randomUUID()): RegistrationUnit[] {
  return units.map(unit => ({ key: key(), title: unit.title, description: unit.description, tasks: unit.tasks.map(task => ({ key: key(), title: task.title, description: task.description, dueDate: '', frequency: 'once', priority: 'medium' })) }));
}

export function registrationPayload(units: readonly RegistrationUnit[]): WorkImportUnit[] {
  return units.map(unit => ({ title: unit.title, description: unit.description, tasks: unit.tasks.map(({ title, description, dueDate, frequency, priority }) => ({ title, description, dueDate, frequency, priority })) }));
}

export function registrationSnapshot(value: RegistrationSnapshot): string {
  return JSON.stringify({ description: value.description, documents: value.documents.map(({ key, name, text }) => ({ key, name, text })), units: value.units });
}

/** An uncertain write must always retry the exact same request, even after later edits/rejections. */
export function registrationAttempt(previous: RegistrationAttempt | null, input: WorkImportInput, snapshot: string): RegistrationAttempt {
  return previous?.everUnknown ? previous : { input: { ...structuredClone(input), importId: previous?.input.importId || input.importId }, snapshot, everUnknown: false };
}

export function failedRegistration(attempt: RegistrationAttempt, failure?: Pick<CommandFailure, 'outcome'>): RegistrationAttempt {
  return { ...attempt, everUnknown: attempt.everUnknown || !failure || failure.outcome === 'unknown' };
}

export function registrationText(value: RegistrationSnapshot): string {
  const frequencies = { once: '한 번', monthly: '매월', quarterly: '분기별', half_yearly: '반기별', yearly: '매년' };
  const priorities = { low: '낮음', medium: '보통', high: '높음' };
  return [value.description && `업무 설명\n${value.description}`, ...value.documents.map(document => `분석 자료: ${document.name}\n${document.text}`), ...value.units.map((unit, index) => `${index + 1}. ${unit.title}\n${unit.description}\n${unit.tasks.map((task, taskIndex) => `  ${index + 1}-${taskIndex + 1}. ${task.title}\n${task.description}\n마감: ${task.dueDate || '미입력'} · 주기: ${frequencies[task.frequency]} · 중요도: ${priorities[task.priority]}`).join('\n\n')}`)].filter(Boolean).join('\n\n');
}

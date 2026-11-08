import type { CommandExpectation, CommandTarget, CommandTargetKind, Delegation, RevisionedEntity, User, WorkspaceData } from './types';
export type { CommandExpectation, CommandTarget, CommandTargetKind, TargetRevisionChange } from './types';

/** Shared by browser and server. No storage access or server-only imports. */
export const COMMAND_TARGET_RULES = {
  'budget.upsert': 'budgetItem', 'budget.setActive': 'budgetItem', 'budget.import': 'budgetCatalog',
  'transfer.emergency': null, 'transfer.request': null, 'transfer.rolesRequest': null,
  'transfer.approve': 'transfer', 'transfer.reject': 'transfer', 'transfer.cancel': 'transfer',
  'department.confirm': 'departmentPlan', 'department.reopen': 'departmentPlan',
  'unit.create': null, 'unit.update': 'unit', 'unit.delete': 'unit', 'unit.restore': 'unit', 'work.import': null,
  'organization.departmentCreate': null, 'organization.userCreate': null, 'organization.userUpdate': 'user',
  'common.create': null, 'common.resubmit': 'common', 'common.approve': 'common', 'common.reject': 'common',
  'task.create': null, 'task.delete': 'task', 'task.restore': 'task', 'task.record': 'task',
  'task.procedure.replace': 'task', 'task.configure': 'task', 'task.setProgress': null,
  'task.update': 'task', 'task.submit': 'task', 'task.confirm': 'task', 'task.revise': 'task', 'task.archive': 'task',
  'run.schedule': 'runOrTask', 'run.completeCycle': 'runOrTask', 'run.nextCycle': 'task', 'run.create': 'task',
  'run.correctOutput': 'run', 'run.check': null, 'run.completeStep': 'run', 'run.note': null,
  'handover.create': null, 'handover.approve': 'handover', 'handover.check': null, 'handover.accept': 'handover',
  'handover.requestChanges': 'handover', 'handover.cancel': 'handover', 'handover.apply': 'handover', 'handover.update': 'handover',
  'common.assignTeam': 'common', 'common.assignPerson': 'common', 'common.register': 'common', 'common.assign': 'common', 'common.distribute': 'common',
  'directive.updateMetadata': 'common', 'directive.saveMonthlyReport': 'common',
  'performance.setWeights': 'plan', 'performance.submitPerson': 'plan', 'performance.withdrawSubmission': 'plan', 'performance.evaluatePerson': 'plan',
  'performance.saveHalf': 'halfPerformance', 'performance.submitHalf': 'halfPerformance',
  'performance.evaluate': 'performance', 'admin.release': null, 'performance.create': null,
  'performance.resubmit': 'performance', 'performance.approve': 'performance', 'performance.requestChanges': 'performance',
  'source.create': null, 'source.verify': 'source', 'source.revise': 'source',
  'delegation.requestBatch': null, 'delegation.request': null, 'delegation.create': null,
  'delegation.approve': 'delegation', 'delegation.reject': 'delegation', 'delegation.cancel': 'delegation', 'delegation.revoke': 'delegation',
  'attachment.allowTest': 'attachment', 'notification.read': null, 'reconcile': null,
} as const;

export type TargetState = Partial<Pick<WorkspaceData, 'users' | 'departments' | 'units' | 'tasks' | 'runs' | 'handovers' | 'workTransfers' | 'commonTasks' | 'sources' | 'performances' | 'delegations' | 'attachments' | 'departmentWorkPlans' | 'unitScorePlans' | 'unitEvaluations' | 'budgetCatalog' | 'notifications' | 'releases'>> & { currentUser?: User };
export type CommandTargetContext = { actorId?: string; departmentId?: string; delegations?: readonly Pick<Delegation, 'id' | 'batchId'>[] };
const string = (value: unknown) => typeof value === 'string' ? value.trim() : '';
export const planTargetId = (personId: string, period: string) => JSON.stringify([personId, period]);
export const halfPerformanceTargetId = (personId: string, taskId: string, period: string) => JSON.stringify([personId, taskId, period]);
export const commandTargetKey = (target: CommandTarget) => JSON.stringify([target.kind, target.id]);
export const entityRevision = (entity?: RevisionedEntity) => Number.isSafeInteger(entity?.rev) && entity!.rev! >= 0 ? entity!.rev! : 0;

export function commandTarget(type: string, payload: Record<string, unknown>, context: CommandTargetContext = {}): CommandTarget | null {
  const rule = COMMAND_TARGET_RULES[type as keyof typeof COMMAND_TARGET_RULES];
  if (!rule) return null;
  const target = (kind: CommandTargetKind, id: unknown): CommandTarget | null => string(id) ? { kind, id: string(id) } : null;
  if (rule === 'runOrTask') return string(payload.runId) ? target('run', payload.runId) : target('task', payload.taskId);
  if (rule === 'departmentPlan') return target(rule, payload.departmentId ?? context.departmentId);
  if (rule === 'plan') {
    const person = type === 'performance.evaluatePerson' ? string(payload.personId) : context.actorId;
    return person && string(payload.period) ? target(rule, planTargetId(person, string(payload.period))) : null;
  }
  if (rule === 'halfPerformance') return context.actorId && string(payload.taskId) && string(payload.period) ? target(rule, halfPerformanceTargetId(context.actorId, string(payload.taskId), string(payload.period))) : null;
  if (rule === 'budgetCatalog') return target(rule, 'catalog');
  if (rule === 'budgetItem') return target(rule, type === 'budget.upsert' ? (payload.item as { id?: unknown } | undefined)?.id : payload.id);
  if (rule === 'delegation') {
    const batchId = string(payload.batchId) || context.delegations?.find(item => item.id === payload.delegationId)?.batchId;
    return batchId ? target('delegationBatch', batchId) : target(rule, payload.delegationId);
  }
  const fields = { task: 'taskId', run: 'runId', unit: 'unitId', common: 'commonId', handover: 'handoverId', transfer: 'transferId', performance: 'performanceId', user: 'userId', source: 'sourceId', attachment: 'attachmentId' };
  return target(rule, payload[fields[rule]]);
}

const collections = {
  task: 'tasks', run: 'runs', unit: 'units', common: 'commonTasks', handover: 'handovers', transfer: 'workTransfers',
  performance: 'performances', evaluation: 'unitEvaluations', user: 'users', department: 'departments', source: 'sources',
  delegation: 'delegations', attachment: 'attachments', notification: 'notifications', release: 'releases',
} as const;

/** Physical records only: embedded histories remain immutable snapshots of the old records. */
export function revisionEntities(state: TargetState): { target: CommandTarget; entity: RevisionedEntity }[] {
  const entries: { target: CommandTarget; entity: RevisionedEntity }[] = [];
  for (const kind of Object.keys(collections) as (keyof typeof collections)[]) for (const entity of state[collections[kind]] ?? []) {
    entries.push({ target: { kind, id: entity.id }, entity });
  }
  for (const entity of state.departmentWorkPlans ?? []) entries.push({ target: { kind: 'departmentPlan', id: entity.departmentId }, entity });
  for (const entity of state.unitScorePlans ?? []) entries.push({ target: { kind: 'plan', id: planTargetId(entity.personId, entity.period) }, entity });
  if (state.budgetCatalog) {
    entries.push({ target: { kind: 'budgetCatalog', id: 'catalog' }, entity: state.budgetCatalog });
    for (const entity of state.budgetCatalog.items) entries.push({ target: { kind: 'budgetItem', id: entity.id }, entity });
  }
  return entries;
}

function logicalMembers(state: TargetState, target: CommandTarget): RevisionedEntity[] | undefined {
  if (target.kind === 'delegationBatch') return (state.delegations ?? []).filter(item => item.batchId === target.id);
  if (target.kind === 'halfPerformance') return (state.performances ?? []).filter(item => !!item.period && halfPerformanceTargetId(item.authorId, item.taskId, item.period) === target.id);
}

export function targetEntity(state: TargetState, target: CommandTarget): unknown | undefined {
  const members = logicalMembers(state, target);
  if (target.kind === 'delegationBatch') return members?.length ? members : undefined;
  if (target.kind === 'halfPerformance') {
    const records = (members ?? []) as NonNullable<TargetState['performances']>;
    const superseded = new Set(records.map(item => item.previousId).filter(Boolean));
    return records.filter(item => !superseded.has(item.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  }
  return revisionEntities(state).find(entry => commandTargetKey(entry.target) === commandTargetKey(target))?.entity;
}

export function targetRevision(state: TargetState, target: CommandTarget): number {
  const members = logicalMembers(state, target);
  return members ? members.reduce((total, entity) => total + entityRevision(entity), 0) : entityRevision(targetEntity(state, target) as RevisionedEntity | undefined);
}

export function logicalTargets(state: TargetState): CommandTarget[] {
  const targets = new Map<string, CommandTarget>();
  for (const item of state.delegations ?? []) if (item.batchId) targets.set(`batch:${item.batchId}`, { kind: 'delegationBatch', id: item.batchId });
  for (const item of state.performances ?? []) if (item.period) {
    const id = halfPerformanceTargetId(item.authorId, item.taskId, item.period);
    targets.set(`half:${id}`, { kind: 'halfPerformance', id });
  }
  return [...targets.values()];
}

export function commandExpectation(state: TargetState, type: string, payload: Record<string, unknown>, actor?: Pick<User, 'id' | 'departmentId'> | string): CommandExpectation | null {
  const person = typeof actor === 'string' ? state.users?.find(user => user.id === actor) ?? (state.currentUser?.id === actor ? state.currentUser : undefined) : actor ?? state.currentUser;
  const target = commandTarget(type, payload, { actorId: typeof actor === 'string' ? actor : person?.id, departmentId: person?.departmentId, delegations: state.delegations });
  if (!target || (target.kind === 'budgetItem' || target.kind === 'budgetCatalog') && !state.budgetCatalog) return null;
  return { ...target, rev: targetRevision(state, target) };
}

export const targetLabels: Record<CommandTargetKind, string> = {
  task: '업무', run: '회차', unit: '단위업무', common: '공통업무', handover: '인수인계', transfer: '업무 이관',
  departmentPlan: '부서 업무분장', plan: '업무 비중과 성과 제출', halfPerformance: '성과', performance: '성과', evaluation: '평가',
  user: '구성원', department: '부서', source: '참고자료', delegation: '업무대행', delegationBatch: '업무대행 요청 묶음',
  attachment: '첨부파일', budgetItem: '예산 항목', budgetCatalog: '예산 원장', notification: '알림', release: '배포 기록',
};

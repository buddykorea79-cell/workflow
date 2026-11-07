import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Run, Task, Unit, User, WorkTransfer, WorkTransferEvent, WorkspaceData } from './types';
import { residualTransferRoles, transferRoleRecipientError } from './transfer-roles';
import { canCancelTransfer } from './transfer-permissions';

type Fail = (status: number, code: string, message: string) => never;
type Result = { targetId: string; departmentId: string; title: string; detail: string };
const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 12)}`;
const value = z.string().trim().min(1).max(150);
const reason = z.string().trim().min(1).max(5000);
const requestInput = z.object({ departmentId: value, fromId: value, toId: value, unitIds: z.array(value).max(500).default([]), taskIds: z.array(value).max(2000).default([]), runIds: z.array(value).max(2000).default([]), reason, kind: z.enum(['direct', 'reassignment']).optional() });
const emergencyInput = z.object({ departmentId: value, fromId: value, toId: value, reason });
const isActive = (user: User, now: Date) => user.active && (!user.endsAt || new Date(user.endsAt) > now);
const eligibleTask = (state: WorkspaceData, task: Task) => !task.deletedAt && task.status !== 'archived' && state.units.some(unit => unit.id === task.unitId && !unit.deletedAt);
const coordinator = (user: User, departmentId: string) => user.role === 'admin' || user.role === 'manager' && user.departmentId === departmentId;
const departmentHead = (user: User, departmentId: string) => user.role === 'head' && user.departmentId === departmentId;

/** Definition identity excludes execution progress and the separately recorded
 * expenses/produced documents. Draft edits may not increment task.version. */
function definitionFingerprint(task: Task): string {
  const definition = {
    title: task.title, description: task.description, descriptionAttachmentIds: task.descriptionAttachmentIds, departmentId: task.departmentId,
    unitId: task.unitId, primaryId: task.primaryId, supportIds: [...task.supportIds].sort(),
    reviewerId: task.reviewerId, status: task.status, priority: task.priority,
    frequency: task.frequency, dueDate: task.dueDate, tags: [...task.tags].sort(),
    completionCriteria: task.completionCriteria, card: task.card, sourceIds: [...task.sourceIds].sort(),
    commonId: task.commonId, budget: task.budget, budgetMode: task.budgetMode, budgetAllocation: task.budgetAllocation,
    workflow: task.workflow.map(step => ({
      id: step.id, title: step.title, role: step.role, description: step.description,
      output: step.output, required: step.required, dependsOn: step.dependsOn,
      checklist: step.checklist, startDate: step.startDate, dueDate: step.dueDate,
      scheduleDetails: step.scheduleDetails,
    })),
    references: (task.references ?? []).filter(reference => reference.type !== 'document').map(reference => ({
      id: reference.id, type: reference.type, title: reference.title, content: reference.content,
      url: reference.url, attachmentId: reference.attachmentId,
    })),
  };
  return createHash('sha256').update(JSON.stringify(definition)).digest('hex');
}

function parse<T>(schema: z.ZodType<T>, input: unknown, fail: Fail): T {
  const result = schema.safeParse(input);
  if (!result.success) return fail(422, 'VALIDATION_ERROR', result.error.issues.map(issue => `${issue.path.join('.') || '입력값'}: ${issue.message}`).join('\n'));
  return result.data;
}

function recipient(state: WorkspaceData, toId: string, departmentId: string, now: Date, emergency: boolean, fail: Fail) {
  const person = state.users.find(user => user.id === toId);
  if (!person || !isActive(person, now)) return fail(422, 'TRANSFER_RECIPIENT_INACTIVE', '현재 재직 중인 인수자를 선택해 주세요.');
  if (person.departmentId !== departmentId) return fail(422, 'TRANSFER_RECIPIENT_SCOPE', '업무 소속 부서의 구성원에게만 인수인계할 수 있습니다.');
  if (emergency ? person.role !== 'manager' : !['member', 'lead', 'manager'].includes(person.role)) return fail(422, 'TRANSFER_RECIPIENT_ROLE', emergency ? '긴급 이관을 받을 부서 담당자를 선택해 주세요.' : '업무 담당자·팀장·부서 담당자 중 인수자를 선택해 주세요.');
  return person;
}

function event(transfer: WorkTransfer, user: User, action: WorkTransferEvent['action'], note: string, now: Date) {
  transfer.events.push({ id: id('transfer-event'), action, actorId: user.id, actorName: user.name, at: now.toISOString(), note });
}

function notify(state: WorkspaceData, userIds: string[], transfer: WorkTransfer, title: string) {
  for (const userId of new Set(userIds)) state.notifications.unshift({ id: id('notification'), userId, title, description: transfer.kind === 'roles' ? `${transfer.fromName} → ${transfer.toName} · 남은 역할 ${transfer.roles?.length ?? 0}건` : `${transfer.fromName} → ${transfer.toName} · 단위 ${transfer.unitIds.length}개 / 세부 ${transfer.taskIds.length}건 / 진행 ${transfer.runIds.length}회차`, type: 'handover', targetId: transfer.id, read: false });
}

function audit(state: WorkspaceData, user: User, transfer: WorkTransfer, action: string, title: string, detail: string, now: Date) {
  state.audit.unshift({ id: id('audit'), actorId: user.id, action, targetType: 'transfer', targetId: transfer.id, title, detail, departmentId: transfer.departmentId, createdAt: now.toISOString() });
}

function overlaps(transfer: WorkTransfer, unitIds: string[], taskIds: string[], tasks: Task[], runIds: string[] = []) {
  return transfer.taskIds.some(taskId => taskIds.includes(taskId)) || transfer.unitIds.some(unitId => unitIds.includes(unitId)) || transfer.tasks.some(task => unitIds.includes(task.unitId)) || tasks.some(task => transfer.unitIds.includes(task.unitId)) || transfer.runIds.some(runId => runIds.includes(runId));
}

function selectedRuns(state: WorkspaceData, departmentId: string, fromId: string, runIds: string[], fail: Fail): Run[] {
  if (new Set(runIds).size !== runIds.length) fail(422, 'TRANSFER_DUPLICATE_SELECTION', '중복된 진행 회차 선택을 확인해 주세요.');
  return runIds.map(runId => {
    const run = state.runs.find(item => item.id === runId);
    const task = state.tasks.find(item => item.id === run?.taskId);
    if (!run || run.departmentId !== departmentId || run.primaryId !== fromId || run.status === 'completed' || !task || task.departmentId !== departmentId || !eligibleTask(state, task)) return fail(409, 'TRANSFER_RUN_CHANGED', '인계자가 담당하는 같은 부서의 진행 회차만 선택할 수 있습니다.');
    return run;
  });
}

function selectedWork(state: WorkspaceData, departmentId: string, fromId: string, unitIds: string[], taskIds: string[], fail: Fail, allowEmpty = false) {
  if (new Set(unitIds).size !== unitIds.length || new Set(taskIds).size !== taskIds.length) fail(422, 'TRANSFER_DUPLICATE_SELECTION', '중복된 업무 선택을 확인해 주세요.');
  const units = unitIds.map(unitId => {
    const unit = state.units.find(item => item.id === unitId);
    if (!unit || unit.deletedAt || unit.departmentId !== departmentId || unit.ownerId !== fromId) return fail(409, 'TRANSFER_UNIT_CHANGED', '인계자의 활성 단위업무만 선택할 수 있습니다. 최신 업무 목록을 확인해 주세요.');
    return unit;
  });
  const expandedIds = new Set([...taskIds, ...state.tasks.filter(task => unitIds.includes(task.unitId) && task.primaryId === fromId && task.departmentId === departmentId && eligibleTask(state, task)).map(task => task.id)]);
  const tasks = [...expandedIds].map(taskId => {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task || task.departmentId !== departmentId || task.primaryId !== fromId || !eligibleTask(state, task)) return fail(409, 'TRANSFER_TASK_CHANGED', '인계자가 담당하는 활성 세부업무만 선택할 수 있습니다. 최신 업무 목록을 확인해 주세요.');
    return task;
  });
  if (!allowEmpty && !units.length && !tasks.length) fail(422, 'TRANSFER_EMPTY', '인수인계할 단위업무 또는 세부업무를 선택해 주세요.');
  return { units, tasks };
}

function validateReviewers(state: WorkspaceData, tasks: Task[], fromId: string, toId: string, fail: Fail) {
  if (tasks.some(task => task.reviewerId === toId || task.versions.at(-1)?.reviewerId === toId) || state.runs.some(run => tasks.some(task => task.id === run.taskId) && run.primaryId === fromId && run.status !== 'completed' && run.reviewerId === toId)) fail(409, 'SELF_REVIEW', '인수자가 해당 업무 또는 진행 회차의 검토자입니다. 검토자와 다른 인수자를 선택해 주세요.');
}

function snapshotTransfer(state: WorkspaceData, user: User, input: z.infer<typeof emergencyInput>, units: Unit[], tasks: Task[], now: Date, emergency: boolean, explicitRuns: Run[] = []): WorkTransfer {
  const runs = state.runs.filter(run => (emergency ? run.departmentId === input.departmentId && state.tasks.some(task => task.id === run.taskId && eligibleTask(state, task)) : tasks.some(task => task.id === run.taskId) || explicitRuns.some(item => item.id === run.id)) && run.primaryId === input.fromId && run.status !== 'completed');
  const custody = (state.workTransfers ?? []).some(item => item.kind === 'emergency' && item.status === 'completed' && item.toId === input.fromId && (item.taskIds.some(taskId => tasks.some(task => task.id === taskId)) || item.unitIds.some(unitId => units.some(unit => unit.id === unitId)) || item.runIds.some(runId => runs.some(run => run.id === runId))));
  return {
    id: id('transfer'), kind: emergency ? 'emergency' : custody ? 'reassignment' : 'direct', status: 'pending', departmentId: input.departmentId,
    fromId: input.fromId, fromName: state.users.find(person => person.id === input.fromId)?.name ?? input.fromId,
    toId: input.toId, toName: state.users.find(person => person.id === input.toId)!.name,
    requestedBy: user.id, requestedByName: user.name, reason: input.reason, createdAt: now.toISOString(),
    unitIds: units.map(unit => unit.id), taskIds: tasks.map(task => task.id),
    units: units.map(unit => ({ unitId: unit.id, title: unit.title, ownerId: unit.ownerId })),
    tasks: tasks.map(task => ({ taskId: task.id, code: task.code, title: task.title, unitId: task.unitId, unitTitle: state.units.find(unit => unit.id === task.unitId)!.title, primaryId: task.primaryId, version: task.version, updatedAt: task.updatedAt, definitionFingerprint: definitionFingerprint(task) })),
    runIds: runs.map(run => run.id), requestedRunIds: explicitRuns.map(run => run.id),
    executionOnly: runs.filter(run => !tasks.some(task => task.id === run.taskId)).map(run => ({ runId: run.id, taskId: run.taskId, taskTitle: state.tasks.find(task => task.id === run.taskId)?.title ?? run.title, fromId: input.fromId, toId: input.toId })),
    executions: runs.map(run => ({ runId: run.id, taskId: run.taskId, taskTitle: state.tasks.find(task => task.id === run.taskId)?.title ?? run.title, primaryId: run.primaryId, reviewerId: run.reviewerId, departmentId: run.departmentId, definitionVersion: run.definitionVersion })), events: [],
  };
}

function uniqueTitle(state: WorkspaceData, title: string, ownerId: string, departmentId: string, excludeId?: string) {
  const taken = (candidate: string) => state.units.some(unit => unit.id !== excludeId && !unit.deletedAt && unit.ownerId === ownerId && unit.departmentId === departmentId && unit.title === candidate);
  if (!taken(title)) return title;
  let suffix = 1;
  while (taken(`${title} (인수 ${suffix})`)) suffix++;
  return `${title} (인수 ${suffix})`;
}

/** Moves current responsibility, while completed executions and historical snapshots remain intact. */
function apply(state: WorkspaceData, transfer: WorkTransfer, user: User, now: Date, fail: Fail) {
  if (transfer.kind === 'roles') return applyRoles(state, transfer, user, now, fail);
  const target = recipient(state, transfer.toId, transfer.departmentId, now, transfer.kind === 'emergency', fail);
  const { units, tasks } = selectedWork(state, transfer.departmentId, transfer.fromId, transfer.unitIds, transfer.taskIds, fail, transfer.runIds.length > 0);
  for (const original of transfer.executions ?? []) {
    const run = state.runs.find(item => item.id === original.runId);
    const task = state.tasks.find(item => item.id === original.taskId);
    if (!run || run.taskId !== original.taskId || run.departmentId !== original.departmentId || run.primaryId !== original.primaryId || run.reviewerId !== original.reviewerId || run.definitionVersion !== original.definitionVersion || !task || task.departmentId !== transfer.departmentId || !eligibleTask(state, task) || run.status === 'completed' && transfer.requestedRunIds?.includes(run.id)) fail(409, 'TRANSFER_RUN_CHANGED', '요청 이후 진행 회차의 담당자·상태·기준이 변경되었습니다. 확인 후 다시 요청해 주세요.');
  }
  if (tasks.length !== transfer.taskIds.length || tasks.some(task => !transfer.taskIds.includes(task.id))) fail(409, 'TRANSFER_SCOPE_CHANGED', '요청 이후 단위업무의 세부업무 구성이 바뀌었습니다. 취소 후 다시 요청해 주세요.');
  for (const unit of units) {
    const original = transfer.units.find(item => item.unitId === unit.id);
    if (!original || unit.title !== original.title || unit.ownerId !== original.ownerId) fail(409, 'TRANSFER_UNIT_CHANGED', '요청 이후 단위업무가 변경되었습니다. 취소 후 다시 요청해 주세요.');
  }
  for (const task of tasks) {
    const original = transfer.tasks.find(item => item.taskId === task.id);
    if (!original || task.unitId !== original.unitId || task.primaryId !== original.primaryId || task.version !== original.version || (original.definitionFingerprint ? definitionFingerprint(task) !== original.definitionFingerprint : task.updatedAt !== original.updatedAt)) fail(409, 'TRANSFER_TASK_CHANGED', original && !original.definitionFingerprint ? '이전 형식의 요청 이후 업무가 변경되었습니다. 최신 업무로 취소 후 다시 요청해 주세요.' : '요청 이후 업무 기준이나 담당 역할이 변경되었습니다. 최신 내용을 확인하고 다시 요청해 주세요.');
  }
  const movingRuns = state.runs.filter(run => run.departmentId === transfer.departmentId && run.status !== 'completed' && run.primaryId === transfer.fromId && (transfer.taskIds.includes(run.taskId) || transfer.runIds.includes(run.id)));
  let replacementReviewer: User | undefined;
  if (transfer.kind === 'emergency') {
    const conflict = tasks.some(task => task.reviewerId === target.id || task.versions.at(-1)?.reviewerId === target.id) || movingRuns.some(run => run.reviewerId === target.id);
    if (conflict) {
      replacementReviewer = state.users.find(person => departmentHead(person, transfer.departmentId) && isActive(person, now));
      if (!replacementReviewer) fail(409, 'TRANSFER_APPROVER_REQUIRED', '부서 담당자에게 이관할 업무의 검토 역할을 맡을 활성 부서장을 확인해 주세요.');
      transfer.reviewerChanges = [];
      for (const task of tasks) if (task.reviewerId === target.id || task.versions.at(-1)?.reviewerId === target.id) {
        transfer.reviewerChanges.push({ taskId: task.id, fromId: target.id, toId: replacementReviewer!.id });
        if (task.reviewerId === target.id) task.reviewerId = replacementReviewer!.id;
      }
      for (const run of movingRuns) if (run.reviewerId === target.id) {
        transfer.reviewerChanges.push({ taskId: run.taskId, runId: run.id, fromId: target.id, toId: replacementReviewer!.id }); run.reviewerId = replacementReviewer!.id;
      }
    }
  } else {
    validateReviewers(state, tasks, transfer.fromId, transfer.toId, fail);
    if (movingRuns.some(run => run.reviewerId === target.id)) fail(409, 'SELF_REVIEW', '진행 회차의 수행자와 검토자는 서로 달라야 합니다.');
  }
  const mappings = new Map<string, Unit>();
  for (const unit of units) {
    unit.title = uniqueTitle(state, unit.title, target.id, transfer.departmentId, unit.id);
    unit.ownerId = target.id;
    mappings.set(unit.id, unit);
  }
  for (const task of tasks) {
    const oldUnitId = task.unitId;
    if (!mappings.has(oldUnitId)) {
      const original = state.units.find(unit => unit.id === oldUnitId)!;
      let targetUnit = state.units.find(unit => !unit.deletedAt && unit.departmentId === transfer.departmentId && unit.ownerId === target.id && (unit.id === oldUnitId || unit.transferOriginUnitId === oldUnitId));
      if (!targetUnit) {
        targetUnit = { ...structuredClone(original), id: id('unit'), ownerId: target.id, title: uniqueTitle(state, original.title, target.id, transfer.departmentId), transferOriginUnitId: oldUnitId };
        state.units.push(targetUnit);
      }
      mappings.set(oldUnitId, targetUnit);
    }
    task.unitId = mappings.get(oldUnitId)!.id;
    if (task.unitId !== oldUnitId) for (const performance of state.performances.filter(item => item.taskId === task.id && !item.unitId)) performance.unitId = oldUnitId;
    task.primaryId = target.id;
    task.supportIds = task.supportIds.filter(personId => personId !== target.id);
    task.updatedAt = now.toISOString();
    // Copy the last confirmed definition, changing responsibility only. Draft
    // edits must never become confirmed because a person was transferred.
    const confirmed = task.versions.at(-1);
    if (confirmed) {
      task.version = Math.max(task.version, confirmed.version) + 1;
      task.versions.push({ ...structuredClone(confirmed), version: task.version, unitId: task.unitId, primaryId: target.id, reviewerId: confirmed.reviewerId === target.id ? replacementReviewer!.id : confirmed.reviewerId, supportIds: (confirmed.supportIds ?? task.supportIds).filter(personId => personId !== target.id), confirmedBy: user.id, confirmedAt: now.toISOString() });
    }
    for (const run of state.runs.filter(item => item.taskId === task.id && item.primaryId === transfer.fromId && item.status !== 'completed')) {
      run.primaryId = target.id; run.supportIds = run.supportIds.filter(personId => personId !== target.id); run.updatedAt = now.toISOString();
    }
    for (const delegation of state.delegations.filter(item => item.taskId === task.id && !item.revokedAt)) delegation.revokedAt = now.toISOString();
    for (const common of state.commonTasks) for (const distribution of common.distributions.filter(item => item.taskId === task.id)) {
      distribution.assigneeId = target.id; distribution.taskOwnerId = target.id; distribution.currentAssigneeId = target.id; distribution.team = target.team;
      distribution.leadId = state.users.find(person => person.departmentId === transfer.departmentId && person.team === target.team && person.role === 'lead' && isActive(person, now))?.id;
    }
  }
  transfer.executionOnly = movingRuns.filter(run => !transfer.taskIds.includes(run.taskId)).map(run => ({ runId: run.id, taskId: run.taskId, taskTitle: state.tasks.find(task => task.id === run.taskId)?.title ?? run.title, fromId: transfer.fromId, toId: target.id }));
  transfer.runIds = movingRuns.map(run => run.id);
  for (const run of movingRuns) {
    run.primaryId = target.id; run.supportIds = run.supportIds.filter(personId => personId !== target.id); run.updatedAt = now.toISOString();
  }
  transfer.unitMappings = [...mappings].map(([fromUnitId, unit]) => ({ fromUnitId, toUnitId: unit.id, title: unit.title }));
  transfer.status = 'completed'; transfer.appliedAt = now.toISOString(); transfer.resolvedBy = user.id; transfer.resolvedAt = now.toISOString();
}

function applyRoles(state: WorkspaceData, transfer: WorkTransfer, user: User, now: Date, fail: Fail) {
  const target = state.users.find(person => person.id === transfer.toId);
  if (!target || !isActive(target, now) || target.departmentId !== transfer.departmentId) fail(422, 'TRANSFER_RECIPIENT_SCOPE', '같은 부서의 활성 후임을 확인해 주세요.');
  const current = residualTransferRoles(state, transfer.fromId, transfer.departmentId, now);
  const roles = transfer.roles ?? [];
  if (!roles.length) fail(422, 'TRANSFER_EMPTY', '정리할 역할을 선택해 주세요.');
  for (const role of roles) {
    const latest = current.find(item => item.id === role.id);
    if (!latest || latest.fingerprint !== role.fingerprint) fail(409, 'TRANSFER_ROLE_CHANGED', '요청 이후 역할 배정 또는 업무 기준이 달라졌습니다. 최신 역할로 다시 요청해 주세요.');
    const error = transferRoleRecipientError(state, latest, target!, now);
    if (error) fail(422, 'TRANSFER_ROLE_RECIPIENT', error);
  }
  if ((state.workTransfers ?? []).some(other => other.id !== transfer.id && other.status === 'pending' && (other.roles?.some(role => roles.some(item => item.id === role.id)) || overlaps(other, [], transfer.taskIds, state.tasks.filter(task => transfer.taskIds.includes(task.id)), transfer.runIds)))) fail(409, 'DUPLICATE_HANDOVER', '관련 업무에 다른 인수인계 요청이 진행 중입니다. 먼저 정리해 주세요.');
  const taskRoles = new Map<string, typeof roles>();
  for (const role of roles) {
    if (role.kind === 'task_support' || role.kind === 'task_reviewer') {
      taskRoles.set(role.targetId, [...(taskRoles.get(role.targetId) ?? []), role]);
    } else if (role.kind === 'run_support' || role.kind === 'run_reviewer') {
      const run = state.runs.find(item => item.id === role.targetId)!;
      if (role.kind === 'run_support') run.supportIds = [...new Set(run.supportIds.map(personId => personId === transfer.fromId ? target!.id : personId))];
      else run.reviewerId = target!.id;
      if (run.primaryId === run.reviewerId || run.supportIds.includes(run.reviewerId)) fail(409, 'SELF_REVIEW', '수행·지원과 검토 역할은 서로 달라야 합니다.');
      run.updatedAt = now.toISOString();
    } else if (role.kind === 'common_manager') {
      const common = state.commonTasks.find(item => item.id === role.targetId)!;
      common.managerId = target!.id; common.version++;
    } else if (role.kind === 'distribution_lead' || role.kind === 'distribution_assignee') {
      const distribution = state.commonTasks.find(item => item.id === role.commonId)!.distributions.find(item => item.id === role.targetId)!;
      if (role.kind === 'distribution_lead') { distribution.leadId = target!.id; distribution.teamAssignedAt = now.toISOString(); }
      else { distribution.assigneeId = target!.id; distribution.personAssignedAt = now.toISOString(); }
    } else {
      state.delegations.find(item => item.id === role.targetId)!.revokedAt = now.toISOString();
    }
  }
  for (const [taskId, selected] of taskRoles) {
    const task = state.tasks.find(item => item.id === taskId)!;
    const confirmed = task.versions.at(-1);
    const changeRoles = (assignment: { primaryId?: string; supportIds?: string[]; reviewerId?: string }) => {
      if (selected.some(role => role.kind === 'task_support') && assignment.supportIds?.includes(transfer.fromId)) assignment.supportIds = [...new Set(assignment.supportIds.map(personId => personId === transfer.fromId ? target!.id : personId))];
      if (selected.some(role => role.kind === 'task_reviewer') && assignment.reviewerId === transfer.fromId) assignment.reviewerId = target!.id;
      if (assignment.primaryId === assignment.reviewerId || assignment.reviewerId && assignment.supportIds?.includes(assignment.reviewerId)) fail(409, 'SELF_REVIEW', '수행·지원과 검토 역할은 서로 달라야 합니다.');
    };
    changeRoles(task); task.updatedAt = now.toISOString();
    if (confirmed) {
      const next = structuredClone(confirmed); changeRoles(next);
      task.version = Math.max(task.version, confirmed.version) + 1;
      task.versions.push({ ...next, version: task.version, confirmedBy: user.id, confirmedAt: now.toISOString() });
    }
  }
  transfer.status = 'completed'; transfer.appliedAt = now.toISOString(); transfer.resolvedBy = user.id; transfer.resolvedAt = now.toISOString();
}

function requestRoles(state: WorkspaceData, user: User, payload: Record<string, unknown>, now: Date, fail: Fail): Result {
  const input = parse(z.object({ departmentId: value, fromId: value, toId: value, roleIds: z.array(value.max(300)).min(1).max(2000), reason }), payload, fail);
  if (!coordinator(user, input.departmentId) && !departmentHead(user, input.departmentId) && !(user.id === input.fromId && user.departmentId === input.departmentId)) fail(403, 'TRANSFER_REQUEST_DENIED', '본인 역할 또는 담당 부서의 역할만 정리 요청할 수 있습니다.');
  const source = state.users.find(person => person.id === input.fromId), target = state.users.find(person => person.id === input.toId);
  if (!source || !target || source.id === target.id) fail(422, 'TRANSFER_RECIPIENT_ROLE', '기존 담당자와 다른 후임을 선택해 주세요.');
  if (new Set(input.roleIds).size !== input.roleIds.length) fail(422, 'TRANSFER_DUPLICATE_SELECTION', '역할 선택이 중복되었습니다.');
  const available = residualTransferRoles(state, input.fromId, input.departmentId, now);
  const roles = input.roleIds.map(roleId => {
    const role = available.find(item => item.id === roleId);
    if (!role) return fail(409, 'TRANSFER_ROLE_CHANGED', '인계자의 현재 역할만 선택할 수 있습니다. 목록을 새로 확인해 주세요.');
    const error = transferRoleRecipientError(state, role, target!, now);
    if (error) return fail(422, 'TRANSFER_ROLE_RECIPIENT', error);
    return role;
  });
  const heads = state.users.filter(person => departmentHead(person, input.departmentId) && isActive(person, now));
  if (!heads.length) fail(409, 'TRANSFER_APPROVER_REQUIRED', '승인할 부서장을 확인해 주세요.');
  const taskIds = [...new Set(roles.flatMap(role => role.taskId ? [role.taskId] : []))];
  const runIds = roles.filter(role => role.kind.startsWith('run_')).map(role => role.targetId);
  const tasks = state.tasks.filter(task => taskIds.includes(task.id));
  if ((state.workTransfers ?? []).some(item => item.status === 'pending' && (item.roles?.some(role => roles.some(selected => selected.id === role.id)) || overlaps(item, [], taskIds, tasks, runIds))) || state.handovers.some(item => !['completed', 'cancelled'].includes(item.status) && (item.taskIds.some(id => taskIds.includes(id)) || item.runIds.some(id => runIds.includes(id))))) fail(409, 'DUPLICATE_HANDOVER', '관련 업무나 역할에 진행 중인 인수인계가 있습니다. 먼저 처리해 주세요.');
  const transfer: WorkTransfer = { id: id('transfer'), kind: 'roles', status: 'pending', departmentId: input.departmentId, fromId: source!.id, fromName: source!.name, toId: target!.id, toName: target!.name, requestedBy: user.id, requestedByName: user.name, reason: input.reason, createdAt: now.toISOString(), unitIds: [], taskIds, units: [], tasks: tasks.map(task => ({ taskId: task.id, code: task.code, title: task.title, unitId: task.unitId, unitTitle: state.units.find(unit => unit.id === task.unitId)?.title ?? '기존 업무', primaryId: task.primaryId, version: task.version, updatedAt: task.updatedAt })), runIds: [...new Set(runIds)], roles, events: [] };
  event(transfer, user, 'requested', `${input.reason} · 남은 역할 ${roles.length}건`, now);
  (state.workTransfers ??= []).unshift(transfer);
  notify(state, heads.map(head => head.id), transfer, '남은 역할 정리 승인 요청');
  return { targetId: transfer.id, departmentId: transfer.departmentId, title: '남은 역할 정리 승인 요청', detail: `${source!.name} → ${target!.name} · 역할 ${roles.length}건 · ${input.reason}` };
}

function cancelOverlapping(state: WorkspaceData, transfer: WorkTransfer, user: User, now: Date) {
  const note = `긴급 이관으로 기존 요청 취소: ${transfer.reason}`;
  const tasks = state.tasks.filter(task => transfer.taskIds.includes(task.id));
  for (const pending of (state.workTransfers ?? []).filter(item => item.status === 'pending' && overlaps(item, transfer.unitIds, transfer.taskIds, tasks, transfer.runIds))) {
    pending.status = 'cancelled'; pending.resolvedBy = user.id; pending.resolvedAt = now.toISOString(); pending.resolutionReason = note;
    event(pending, user, 'cancelled', note, now); audit(state, user, pending, 'transfer.cancel', '긴급 이관에 따른 기존 인수인계 취소', note, now);
    notify(state, [pending.requestedBy, pending.fromId, pending.toId], pending, '기존 인수인계 요청이 긴급 이관으로 취소되었습니다');
  }
  for (const legacy of state.handovers.filter(item => !['completed', 'cancelled'].includes(item.status) && (item.taskIds.some(taskId => transfer.taskIds.includes(taskId)) || item.runIds.some(runId => transfer.runIds.includes(runId))))) {
    legacy.status = 'cancelled'; legacy.feedback = note;
    state.audit.unshift({ id: id('audit'), actorId: user.id, action: 'handover.cancel', targetType: 'handover', targetId: legacy.id, title: '긴급 이관에 따른 기존 인수인계 취소', detail: note, departmentId: legacy.departmentId, createdAt: now.toISOString() });
  }
}

function execute(state: WorkspaceData, user: User, type: string, payload: Record<string, unknown>, now: Date, fail: Fail): Result {
  if (type === 'transfer.rolesRequest') return requestRoles(state, user, payload, now, fail);
  if (type === 'transfer.emergency' || type === 'transfer.request') {
    const emergency = type === 'transfer.emergency';
    const input = parse(emergency ? emergencyInput : requestInput, payload, fail);
    if (!state.departments.some(department => department.id === input.departmentId)) fail(422, 'DEPARTMENT_MISSING', '업무 소속 부서를 선택해 주세요.');
    if (!state.users.some(person => person.id === input.fromId)) fail(422, 'TRANSFER_SOURCE_MISSING', '기존 담당자 정보를 찾을 수 없습니다.');
    if (emergency ? !coordinator(user, input.departmentId) : !coordinator(user, input.departmentId) && !(user.id === input.fromId && user.departmentId === input.departmentId && ['member', 'lead'].includes(user.role))) fail(403, 'TRANSFER_REQUEST_DENIED', emergency ? '소속 부서 담당자 또는 관리자만 긴급 이관할 수 있습니다.' : '본인 업무 또는 담당 부서의 업무만 인수인계 요청할 수 있습니다.');
    recipient(state, input.toId, input.departmentId, now, emergency, fail);
    if (input.fromId === input.toId) fail(422, 'SAME_RECIPIENT', '기존 담당자와 다른 인수자를 선택해 주세요.');
    const requested = input as z.infer<typeof requestInput>;
    const unitIds = emergency ? state.units.filter(unit => !unit.deletedAt && unit.departmentId === input.departmentId && unit.ownerId === input.fromId).map(unit => unit.id) : requested.unitIds;
    const taskIds = emergency ? state.tasks.filter(task => eligibleTask(state, task) && task.departmentId === input.departmentId && task.primaryId === input.fromId).map(task => task.id) : requested.taskIds;
    const explicitRuns = emergency ? [] : selectedRuns(state, input.departmentId, input.fromId, requested.runIds, fail);
    const extraRuns = emergency && state.runs.some(run => run.departmentId === input.departmentId && run.primaryId === input.fromId && run.status !== 'completed' && state.tasks.some(task => task.id === run.taskId && eligibleTask(state, task)));
    const { units, tasks } = selectedWork(state, input.departmentId, input.fromId, unitIds, taskIds, fail, extraRuns || explicitRuns.length > 0);
    if (!emergency) validateReviewers(state, tasks, input.fromId, input.toId, fail);
    if (explicitRuns.some(run => run.reviewerId === input.toId)) fail(409, 'SELF_REVIEW', '진행 회차의 수행자와 검토자는 서로 달라야 합니다.');
    const transfer = snapshotTransfer(state, user, input, units, tasks, now, emergency, explicitRuns);
    const heads = state.users.filter(person => departmentHead(person, input.departmentId) && isActive(person, now)).map(person => person.id);
    if (emergency) {
      cancelOverlapping(state, transfer, user, now);
      apply(state, transfer, user, now, fail);
      event(transfer, user, 'emergency', `${input.reason}${transfer.executionOnly?.length ? ` · 기존 담당자가 남아 있던 진행 회차 ${transfer.executionOnly.length}건도 이관` : ''}${transfer.reviewerChanges?.length ? ` · 수행·검토 역할 중복을 방지하기 위해 검토 ${transfer.reviewerChanges.length}건을 부서장에게 연결` : ''}`, now);
      notify(state, [transfer.fromId, transfer.toId, ...heads], transfer, '인사이동 업무가 부서 담당자에게 긴급 이관되었습니다');
    } else {
      if (!heads.length) fail(409, 'TRANSFER_APPROVER_REQUIRED', '소속 부서에 승인 가능한 부서장이 없습니다. 부서장 계정을 확인해 주세요.');
      if ((state.workTransfers ?? []).some(item => item.status === 'pending' && overlaps(item, unitIds, transfer.taskIds, tasks, transfer.runIds)) || state.handovers.some(item => !['completed', 'cancelled'].includes(item.status) && (item.taskIds.some(taskId => transfer.taskIds.includes(taskId)) || item.runIds.some(runId => transfer.runIds.includes(runId))))) fail(409, 'DUPLICATE_HANDOVER', '선택한 업무에 진행 중인 인수인계가 있습니다. 기존 요청을 먼저 처리해 주세요.');
      event(transfer, user, 'requested', input.reason, now);
      notify(state, heads, transfer, '인수인계 배정 승인 요청이 도착했습니다');
    }
    (state.workTransfers ??= []).unshift(transfer);
    return { targetId: transfer.id, departmentId: transfer.departmentId, title: emergency ? '인사이동 업무 긴급 이관' : '인수인계 배정 승인 요청', detail: `${transfer.fromName} → ${transfer.toName} · 단위 ${transfer.unitIds.length}개 / 세부 ${transfer.taskIds.length}건 / 진행 ${transfer.runIds.length}회차 · ${transfer.reason}` };
  }
  const input = parse(z.object({ transferId: value, reason: reason.optional() }), payload, fail);
  const transfer = state.workTransfers?.find(item => item.id === input.transferId);
  if (!transfer || !([transfer.fromId, transfer.toId, transfer.requestedBy].includes(user.id) || coordinator(user, transfer.departmentId) || departmentHead(user, transfer.departmentId))) return fail(403, 'TRANSFER_ACCESS_DENIED', '이 인수인계 요청에 접근할 수 없습니다.');
  if (transfer.status !== 'pending') fail(409, 'TRANSFER_FINISHED', '이미 처리한 인수인계 요청입니다.');
  let title = '';
  if (type === 'transfer.approve' || type === 'transfer.reject') {
    if (!departmentHead(user, transfer.departmentId)) fail(403, 'TRANSFER_HEAD_REQUIRED', '업무 소속 부서의 부서장만 승인하거나 반려할 수 있습니다.');
    if (type === 'transfer.approve') {
      if (state.handovers.some(item => !['completed', 'cancelled'].includes(item.status) && (item.taskIds.some(taskId => transfer.taskIds.includes(taskId)) || item.runIds.some(runId => transfer.runIds.includes(runId))))) fail(409, 'DUPLICATE_HANDOVER', '새로 생성된 다른 인수인계 요청을 먼저 정리해 주세요.');
      apply(state, transfer, user, now, fail);
      transfer.approvedBy = user.id; transfer.approvedAt = now.toISOString();
      event(transfer, user, 'approved', input.reason ?? (transfer.kind === 'roles' ? '부서장 승인으로 남은 역할 정리 완료' : '부서장 승인으로 업무 배정 완료'), now); title = transfer.kind === 'roles' ? '부서장 승인 · 남은 역할 정리 완료' : '부서장 승인 · 인수인계 배정 완료';
    } else {
      if (!input.reason) fail(422, 'TRANSFER_REASON_REQUIRED', '반려 사유를 입력해 주세요.');
      transfer.status = 'rejected'; transfer.resolvedBy = user.id; transfer.resolvedAt = now.toISOString(); transfer.resolutionReason = input.reason;
      event(transfer, user, 'rejected', input.reason, now); title = '인수인계 배정 반려';
    }
  } else if (type === 'transfer.cancel') {
    if (!canCancelTransfer(user, transfer)) fail(403, 'TRANSFER_CANCEL_DENIED', '요청자 또는 소속 부서 담당자만 요청을 취소할 수 있습니다.');
    transfer.status = 'cancelled'; transfer.resolvedBy = user.id; transfer.resolvedAt = now.toISOString(); transfer.resolutionReason = input.reason ?? '요청 취소';
    event(transfer, user, 'cancelled', transfer.resolutionReason, now); title = '인수인계 요청 취소';
  } else return fail(422, 'UNKNOWN_COMMAND', '지원하지 않는 인수인계 작업입니다.');
  notify(state, [transfer.requestedBy, transfer.fromId, transfer.toId], transfer, title);
  return { targetId: transfer.id, departmentId: transfer.departmentId, title, detail: `${transfer.fromName} → ${transfer.toName} · ${transfer.kind === 'roles' ? `역할 ${transfer.roles?.length ?? 0}건` : `단위 ${transfer.unitIds.length}개 / 세부 ${transfer.taskIds.length}건 / 진행 ${transfer.runIds.length}회차`}${transfer.resolutionReason ? ` · ${transfer.resolutionReason}` : ''}` };
}

export function executePersonnelTransfer(state: WorkspaceData, user: User, type: string, payload: Record<string, unknown>, now: Date, fail: Fail): Result {
  // All validation and transfer effects commit together, including unit copies,
  // legacy cancellation, audit messages, and current execution ownership.
  const candidate = structuredClone(state);
  const result = execute(candidate, user, type, payload, now, fail);
  Object.assign(state, candidate);
  return result;
}

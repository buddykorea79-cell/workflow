import { commonPublished } from './common-approval';
import { canEditDepartmentDefinitions } from './work-division';
import type { Unit, Workspace } from './types';

type RegistrationWorkspace = Pick<Workspace, 'currentUser' | 'commonTasks' | 'units' | 'departmentWorkPlans' | 'serverTime'>;

export function registrationUnitTitle(projectName = '') {
  let title = '';
  for (const character of projectName) {
    if (title.length + character.length > 100) break;
    title += character;
  }
  return title;
}

/** Registration remains limited to the current assignee's active, own-department units. */
export function commonRegistrationState(workspace: RegistrationWorkspace, commonId: string, distributionId: string) {
  const user = workspace.currentUser;
  const common = workspace.commonTasks.find(item => item.id === commonId);
  const distribution = common?.distributions.find(item => item.id === distributionId);
  const departmentId = distribution?.departmentId || user.departmentId;
  const units = workspace.units.filter(unit => unit.ownerId === user.id && unit.departmentId === departmentId && !unit.deletedAt);
  const definitionEditable = canEditDepartmentDefinitions(workspace, user, departmentId);
  let blocked = '';
  if (!user.active || user.endsAt && new Date(user.endsAt) <= new Date(workspace.serverTime)) blocked = '현재 계정의 업무 등록 권한을 확인해 주세요.';
  else if (!common || !distribution) blocked = '배정 정보를 더 이상 찾을 수 없습니다. 목록에서 현재 상태를 확인해 주세요.';
  else if (user.role === 'head') blocked = '부서장은 직접 업무를 등록하지 않습니다. 배정받은 담당자가 등록해 주세요.';
  else if (!definitionEditable) blocked = '부서 업무분장이 확정되어 있습니다. 부서장에게 재작성 허용을 요청해 주세요.';
  else if (departmentId !== user.departmentId || distribution.assigneeId !== user.id) blocked = '현재 이 업무를 배정받은 본인만 등록할 수 있습니다.';
  else if (!commonPublished(common)) blocked = '공통업무의 배포 승인 후에 등록할 수 있습니다.';
  else if (distribution.status !== 'person_assigned') blocked = '이미 처리되었거나 배정 상태가 변경되었습니다. 목록에서 현재 상태를 확인해 주세요.';
  return { common, distribution, units, definitionEditable, blocked };
}

/** Resolve an actual server-created ID; never guess from an older, same-named unit. */
export function savedRegistrationUnit(result: Pick<Workspace, 'units' | 'audit' | 'commandChanges'>, context: {
  ownerId: string;
  departmentId: string;
  previousUnitIds: readonly string[];
  title: string;
  unitId?: string;
}): Unit | undefined {
  const eligible = result.units.filter(unit => !unit.deletedAt && unit.ownerId === context.ownerId && unit.departmentId === context.departmentId);
  if (context.unitId) return eligible.find(unit => unit.id === context.unitId);
  const previous = new Set(context.previousUnitIds);
  const added = eligible.filter(unit => !previous.has(unit.id));
  const receiptIds = new Set(result.commandChanges?.filter(change => change.kind === 'unit').map(change => change.id));
  const receipts = added.filter(unit => receiptIds.has(unit.id));
  if (receipts.length === 1) return receipts[0];
  const auditId = result.audit.find(event => event.action === 'unit.create' && event.actorId === context.ownerId)?.targetId;
  const audited = added.find(unit => unit.id === auditId);
  if (audited) return audited;
  const matching = added.filter(unit => unit.title === context.title.trim());
  return matching.length === 1 ? matching[0] : undefined;
}

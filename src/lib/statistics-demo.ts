import { commonApprovalSnapshot } from './common-approval';
import { commonWorkflow, defaultCard, offsetDate } from './seed-helpers';
import type { CommonTask, Task, Unit, WorkspaceData } from './types';

export class StatisticsDemoError extends Error {}

export const STATISTICS_DEMO_MARKER = 'statistics-publication-demo-20261106';
export const STATISTICS_DEMO_IDS = {
  sender: 'u-support-member', recipient: 'u-innovation-member',
  senderDepartment: 'dept-support', recipientDepartment: 'dept-innovation',
  senderUnit: 'statistics-demo-unit-publication', recipientUnit: 'statistics-demo-unit-materials',
  task: 'statistics-demo-task-yearbook', common: 'statistics-demo-common-yearbook',
  approval: 'statistics-demo-approval-yearbook', notification: 'statistics-demo-notification-head',
} as const;
export interface StatisticsDemoResult { changed: boolean; addedUnits: number; addedTasks: number; addedCommonTasks: number; addedNotifications: number; revision: number }

/** Explicit additive scenario setup. Never reset a completed presentation or user edits. */
export function applyStatisticsDemo(state: WorkspaceData, now = new Date()): StatisticsDemoResult {
  const result: StatisticsDemoResult = { changed: false, addedUnits: 0, addedTasks: 0, addedCommonTasks: 0, addedNotifications: 0, revision: state.revision };
  if (state.audit.some(event => event.action === 'demo.statistics.setup' && event.targetId === STATISTICS_DEMO_MARKER)) return result;
  const ids = STATISTICS_DEMO_IDS;
  const accounts = [
    [ids.sender, ids.senderDepartment, 'member'], ['u-support-head', ids.senderDepartment, 'head'],
    [ids.recipient, ids.recipientDepartment, 'member'], ['u-innovation-manager', ids.recipientDepartment, 'manager'],
    ['u-innovation-lead', ids.recipientDepartment, 'lead'], ['u-innovation-head', ids.recipientDepartment, 'head'],
  ] as const;
  // Preflight every anchor and identifier before writing anything.
  for (const [id, departmentId, role] of accounts) {
    const user = state.users.find(user => user.id === id);
    if (!user || !user.active || user.departmentId !== departmentId || user.role !== role || user.endsAt && new Date(user.endsAt) <= now) throw new StatisticsDemoError(`통계연보 시연 계정 ${id}의 소속·역할·활성 상태를 확인해 주세요. 기존 계정은 변경하지 않았습니다.`);
  }
  for (const id of [ids.senderDepartment, ids.recipientDepartment]) if (!state.departments.some(department => department.id === id)) throw new StatisticsDemoError(`통계연보 시연 대상 부서 ${id}를 찾을 수 없습니다.`);
  const recipient = state.users.find(user => user.id === ids.recipient)!;
  if (state.users.find(user => user.id === 'u-innovation-lead')!.team !== recipient.team) throw new StatisticsDemoError('시연 수신 담당자와 혁신행정담당관실 팀장의 소속 팀이 다릅니다. 기존 조직은 변경하지 않았습니다.');
  const reservedUnitIds = new Set<string>([ids.senderUnit, ids.recipientUnit]);
  const participantIds = new Set<string>([ids.sender, ids.recipient]);
  if (state.units.some(unit => reservedUnitIds.has(unit.id) || !unit.deletedAt && participantIds.has(unit.ownerId) && unit.title === '통계 간행물 발간')
    || state.tasks.some(task => task.id === ids.task)
    || state.commonTasks.some(common => common.id === ids.common || common.approvalRequests?.some(request => request.id === ids.approval))
    || state.notifications.some(notification => notification.id === ids.notification)) throw new StatisticsDemoError('통계연보 시연 자료의 ID 또는 단위업무 이름이 이미 있습니다. 기존 기록을 보존하기 위해 추가를 중단했습니다.');

  const iso = now.toISOString(); const dueDate = offsetDate(45, now);
  const units: Unit[] = [
    { id: ids.senderUnit, title: '통계 간행물 발간', departmentId: ids.senderDepartment, ownerId: ids.sender, description: '행정안전 통계연보의 자료 요청·취합·정합성 확인과 발간을 관리합니다.', color: 'stone', icon: 'folder' },
    { id: ids.recipientUnit, title: '통계 간행물 발간', departmentId: ids.recipientDepartment, ownerId: ids.recipient, description: '공통업무로 배정받은 통계연보 자료 작성·검증·제출 업무를 등록합니다.', color: 'stone', icon: 'folder' },
  ];
  const workflow = commonWorkflow(['작성 기준과 자료 요청 준비', '부서별 통계 자료 취합', '수치·출처 정합성 확인', '부서장 검토', '통계연보 발간 및 게시']);
  const codes = new Set(state.tasks.map(task => task.code)); let number = Math.max(0, ...state.tasks.map(task => Number(task.code.match(/^WK-(\d+)$/)?.[1]) || 0)) + 1;
  while (codes.has(`WK-${String(number).padStart(3, '0')}`)) number++;
  const description = '데이터정보화담당관실에서 행정안전 통계연보 발간을 총괄합니다. 혁신행정담당관실에 소관 통계 자료의 작성·확인·제출을 공통업무로 요청하고, 회신 자료를 취합하여 수치와 출처를 확인한 뒤 검토를 거쳐 발간합니다. 시연용 업무이며 실제 제출 기한이나 법적 의무를 정한 자료가 아닙니다.';
  const task: Task = {
    id: ids.task, code: `WK-${String(number).padStart(3, '0')}`, title: '행정안전 통계연보 발간', description,
    unitId: ids.senderUnit, departmentId: ids.senderDepartment, primaryId: ids.sender, supportIds: [], reviewerId: 'u-support-head',
    status: 'draft', priority: 'medium', frequency: 'yearly', dueDate, tags: ['통계연보', '시연'], version: 1,
    completionCriteria: '부서별 자료 취합과 수치·출처 확인, 부서장 검토 및 발간·게시 기록을 완료합니다.',
    card: { ...defaultCard(description), stakeholders: '데이터정보화담당관실 · 혁신행정담당관실', evidence: '아래 관련 근거의 시연용 작성 안내를 참고합니다. 실제 근거 문서는 담당자가 추가합니다.', responsibility: '업무 담당자 1 발간 총괄 · 업무 담당자 2 소관 자료 작성 · 각 부서장 검토', procedure: workflow.map(step => step.title).join(' → '), documents: '부서별 통계 작성표, 수치 검증 결과, 통계연보 발간본' },
    workflow: workflow.map(step => ({ ...step, done: false })), sourceIds: [], versions: [], createdAt: iso, updatedAt: iso,
    references: [{ id: 'statistics-demo-reference-guide', type: 'guideline', title: '통계연보 자료 작성 안내 · 시연용', content: '이 안내는 기능 시연을 위한 가상 자료입니다. 실제 법령이나 기관 지침이 아닙니다.\n발간 총괄 담당자는 대상 부서에 통계 항목, 대상 기간, 작성 양식을 안내한다. 각 부서 담당자는 소관 통계의 수치와 출처를 확인하고 작성표를 제출한다. 발간 총괄 담당자는 회신 자료를 취합해 누락과 수치 불일치를 확인한다. 부서장은 취합 결과와 발간본을 검토한다. 검토된 통계연보를 발간·게시하고 결과 기록을 남긴다.' }],
  };
  const common: CommonTask = {
    id: ids.common, kind: 'common', title: '행정안전 통계연보 발간', description: '통계 간행물 발간 단위업무에 연결되는 부서 공통 자료 요청입니다. 혁신행정담당관실은 소관 통계 작성표에 대상 기간·수치·출처를 기입하고 정합성을 확인하여 제출합니다. 시연 수신자는 업무 담당자 2(임주무관)입니다. 실제 배정은 작성 부서장의 배포 승인 후 혁신행정담당관실 부서 담당자와 팀장이 진행합니다. 시연용 가상 요청입니다.',
    managerId: ids.sender, originDepartmentId: ids.senderDepartment, distributionMode: 'selected', projectName: '통계 간행물 발간 · 두 담당자 시연', dueDate, frequency: 'yearly', version: 1,
    requiredSteps: ['통계 작성 항목과 기간 확인', '소관 통계 자료 작성', '수치·출처 정합성 확인', '부서장 검토', '통계 작성표 제출'],
    departmentIds: [], distributions: [], publicationStatus: 'pending', approvalRequests: [],
  };
  common.approvalRequests = [{ id: ids.approval, kind: 'initial', status: 'pending', departmentId: ids.senderDepartment, requestedBy: ids.sender, requestedAt: iso, targetDepartmentIds: [ids.recipientDepartment], version: 1, snapshot: commonApprovalSnapshot(common) }];

  state.units.push(...units); state.tasks.push(task); state.commonTasks.push(common);
  state.notifications.unshift({ id: ids.notification, title: '행정안전 통계연보 발간 · 배포 승인 요청', description: '업무 담당자 1이 혁신행정담당관실에 통계 자료 작성을 요청했습니다. 대상 부서에 전달하려면 작성 부서장이 승인해 주세요.', type: 'common', targetType: 'common', targetId: common.id, createdAt: now.toISOString(), read: false, userId: 'u-support-head' });
  state.audit.unshift({ id: `audit-${STATISTICS_DEMO_MARKER}`, actorId: 'system', action: 'demo.statistics.setup', targetType: 'workspace', targetId: STATISTICS_DEMO_MARKER, title: '두 담당자 통계연보 공통업무 시연 추가', detail: JSON.stringify({ senderId: ids.sender, recipientId: ids.recipient, taskId: task.id, commonId: common.id, targetDepartmentIds: [ids.recipientDepartment], publicationStatus: 'pending', preservedExistingRecords: true }), departmentId: ids.senderDepartment, createdAt: iso });
  state.revision++; return { changed: true, addedUnits: 2, addedTasks: 1, addedCommonTasks: 1, addedNotifications: 1, revision: state.revision };
}

import { currentPeriod } from './schedule';
import { commonWorkflow, createRun, defaultCard, koreaDate, offsetDate, snapshot } from './seed-helpers';
import type { CommonDistribution, CommonTask, Task, Unit, WorkspaceData } from './types';

export const BUDGET_DEMO_MARKER = 'budget-demo-041';
export const BUDGET_DEMO_PREFIX = 'budget-demo-';
export const BUDGET_COMMON_DEMAND = 'budget-demo-common-demand';
export const BUDGET_COMMON_EXECUTION = 'budget-demo-common-execution';
export interface BudgetDemoResult { changed: boolean; addedUnits: number; addedTasks: number; addedRuns: number; addedCommonTasks: number; updatedUsers: number; skippedIds: string[]; revision: number }
type TaskSpec = { id: string; title: string; description: string; unitId: string; ownerId: string; reviewerId: string; budget: number; amounts: number[]; expenseLabels: string[]; dueOffset: number; completed: number; frequency: Task['frequency']; steps: string[]; commonId?: string };

function nextTaskCode(state: WorkspaceData) {
  const codes = new Set(state.tasks.map(task => task.code));
  let number = Math.max(0, ...state.tasks.map(task => Number(task.code.match(/^WK-(\d+)$/)?.[1]) || 0)) + 1;
  while (codes.has(`WK-${String(number).padStart(3, '0')}`)) number++;
  return `WK-${String(number).padStart(3, '0')}`;
}

/** Add fictional examples once. Existing IDs, soft deletions and later user
 * edits are preserved. Run inside transaction() when modifying persisted data. */
export function applyBudgetDemo(state: WorkspaceData, now = new Date()): BudgetDemoResult {
  const result: BudgetDemoResult = { changed: false, addedUnits: 0, addedTasks: 0, addedRuns: 0, addedCommonTasks: 0, updatedUsers: 0, skippedIds: [], revision: state.revision };
  const iso = now.toISOString(); const today = koreaDate(now); const year = Number(today.slice(0, 4));
  const expected = [['u-jiho', 'dept-plan', 'member'], ['u-support-member', 'dept-support', 'member'], ['u-head', 'dept-plan', 'head'], ['u-support-head', 'dept-support', 'head']] as const;
  for (const [userId, departmentId, role] of expected) {
    const user = state.users.find(item => item.id === userId);
    if (!user || !user.active || user.departmentId !== departmentId || user.role !== role || user.endsAt && Date.parse(user.endsAt) <= now.getTime()) throw new Error(`예산 시연 계정 ${userId}의 활성 상태·부서·역할을 확인해 주세요. 기존 계정은 자동 변경하지 않았습니다.`);
  }
  for (const departmentId of ['dept-plan', 'dept-support', 'dept-innovation']) if (!state.departments.some(item => item.id === departmentId)) throw new Error(`예산 시연 대상 부서 ${departmentId}가 없습니다. 기존 조직은 자동 변경하지 않았습니다.`);
  const alreadyApplied = state.audit.some(event => event.action === 'demo.budget.setup' && event.targetId === BUDGET_DEMO_MARKER);
  if (!alreadyApplied) {
    const budgetOfficer = state.users.find(user => user.id === 'u-jiho')!;
    if (budgetOfficer.title !== '예산 담당 주무관' || !budgetOfficer.commonTaskPermission) { budgetOfficer.title = '예산 담당 주무관'; budgetOfficer.commonTaskPermission = true; result.updatedUsers++; }
  }

  const units: Unit[] = [
    { id: 'budget-demo-unit-formulation', title: '예산 편성', description: '예산 요구자료 취합, 산출 근거 검토와 예산안 편성을 관리합니다.', departmentId: 'dept-plan', ownerId: 'u-jiho', color: 'stone', icon: 'wallet' },
    { id: 'budget-demo-unit-execution', title: '예산 집행 관리', description: '월별 집행 현황, 잔액과 이월·불용 예상액을 점검합니다.', departmentId: 'dept-plan', ownerId: 'u-jiho', color: 'stone', icon: 'wallet' },
    { id: 'budget-demo-unit-settlement', title: '결산 및 재정성과', description: '집행 증빙과 결산자료를 정리하고 사업별 재정성과를 분석합니다.', departmentId: 'dept-plan', ownerId: 'u-jiho', color: 'stone', icon: 'chart' },
    { id: 'budget-demo-unit-it-planning', title: '정보화사업 예산 편성', description: '정보시스템 운영·개선 사업의 예산 요구와 산출 근거를 준비합니다.', departmentId: 'dept-support', ownerId: 'u-support-member', color: 'stone', icon: 'wallet' },
    { id: 'budget-demo-unit-it-execution', title: '정보화사업 집행·정산', description: '데이터 플랫폼 구축비와 정보화사업 집행·정산 증빙을 관리합니다.', departmentId: 'dept-support', ownerId: 'u-support-member', color: 'stone', icon: 'folder' },
  ];
  for (const unit of units) if (!state.units.some(existing => existing.id === unit.id)) { state.units.push(unit); result.addedUnits++; }

  const templates = [
    { id: BUDGET_COMMON_DEMAND, title: `${year + 1}년 부서별 사업예산 요구자료 제출`, description: '기획재정담당관실 예산 담당 박주무관이 총괄하는 가상 예산 편성 업무입니다. 부서 담당자→팀장→개인 배정 후 각자 단위업무에 등록하여 요구액과 산출 근거를 제출합니다.', requiredSteps: ['예산 요구자료 준비', '산출 근거 확인', '부서장 검토', '요구자료 제출'], dueOffset: 20, frequency: 'yearly' as const, projectName: `${year + 1}년 예산 편성 · 시연` },
    { id: BUDGET_COMMON_EXECUTION, title: '월별 예산 집행 현황 점검', description: '사업별 집행액·잔액과 지연 사유를 동일한 양식으로 확인하는 가상 공통업무입니다. 박주무관은 배정과 수행 현황을 총괄하고 부서·팀 배정 권한은 해당 담당자가 행사합니다.', requiredSteps: ['집행 자료 취합', '집행액·잔액 대조', '부서장 검토', '집행 현황 제출'], dueOffset: 5, frequency: 'monthly' as const, projectName: `${year}년 재정 집행 점검 · 시연` },
  ];
  const commonTemplates: CommonTask[] = templates.map(template => ({ id: template.id, kind: 'common', title: template.title, description: template.description, managerId: 'u-jiho', dueDate: offsetDate(template.dueOffset, now), frequency: template.frequency, version: 1, requiredSteps: template.requiredSteps, departmentIds: ['dept-plan', 'dept-support', 'dept-innovation'], distributions: [], distributionMode: 'all', projectName: template.projectName }));
  const specifications: TaskSpec[] = [
    { id: 'budget-demo-task-plan-demand', title: commonTemplates[0].title, description: '기획재정담당관실 사업예산 요구액을 취합하고 신규·계속사업별 산출 근거를 정리합니다. 모든 금액과 자료는 시연용입니다.', unitId: units[0].id, ownerId: 'u-jiho', reviewerId: 'u-head', budget: 850_000_000, amounts: [2_400_000], expenseLabels: ['예산 요구자료 인쇄·정리비 · 가상'], dueOffset: 20, completed: 2, frequency: 'yearly', steps: templates[0].requiredSteps, commonId: BUDGET_COMMON_DEMAND },
    { id: 'budget-demo-task-plan-review', title: '주요사업 예산안 산출 근거 검토', description: '신규·계속사업의 단가, 수량과 전년도 집행 실적을 비교하고 조정 의견을 작성합니다. 운영상 판단을 위한 가상 사례입니다.', unitId: units[0].id, ownerId: 'u-jiho', reviewerId: 'u-head', budget: 420_000_000, amounts: [], expenseLabels: [], dueOffset: 12, completed: 1, frequency: 'yearly', steps: ['사업별 요구액 정리', '단가·물량 검증', '조정안 검토', '예산안 반영'] },
    { id: 'budget-demo-task-plan-execution', title: commonTemplates[1].title, description: '매월 사업별 집행액과 잔액을 비교하고 집행 지연 사유 및 다음 달 계획을 정리합니다. 숫자는 기능 확인용 가상 금액입니다.', unitId: units[1].id, ownerId: 'u-jiho', reviewerId: 'u-head', budget: 320_000_000, amounts: [96_000_000, 32_000_000], expenseLabels: ['정책연구 용역 중도금 · 가상', '사업 운영비 · 가상'], dueOffset: 5, completed: 3, frequency: 'monthly', steps: templates[1].requiredSteps, commonId: BUDGET_COMMON_EXECUTION },
    { id: 'budget-demo-task-plan-carryover', title: '이월·불용 예상액 분석', description: '사업 일정과 계약 이행 현황을 토대로 연말까지의 예상 집행액과 잔액 사유를 정리합니다.', unitId: units[1].id, ownerId: 'u-jiho', reviewerId: 'u-head', budget: 180_000_000, amounts: [54_000_000, 36_000_000], expenseLabels: ['사업 지원비 1차 · 가상', '사업 지원비 2차 · 가상'], dueOffset: 10, completed: 0, frequency: 'quarterly', steps: ['집행 전망 수집', '잔액 사유 분석', '이월·불용 검토', '분석 결과 보고'] },
    { id: 'budget-demo-task-plan-settlement', title: '사업비 결산자료 정리', description: '수입·지출 집계와 증빙을 대조하고 결산 서식 및 확인 결과를 정리한 가상 완료 사례입니다.', unitId: units[2].id, ownerId: 'u-jiho', reviewerId: 'u-head', budget: 600_000_000, amounts: [188_000_000, 172_000_000, 210_000_000], expenseLabels: ['운영 용역비 · 가상', '정책사업 지원비 · 가상', '사업비 정산 지급 · 가상'], dueOffset: -3, completed: 4, frequency: 'once', steps: ['결산 증빙 취합', '수입·지출 대조', '결산자료 검토', '결산 결과 제출'] },
    { id: 'budget-demo-task-plan-performance', title: '사업별 재정성과 분석', description: '예산 투입과 사업 산출물을 비교하고 반기 성과 입력에 필요한 지표와 근거를 정리합니다.', unitId: units[2].id, ownerId: 'u-jiho', reviewerId: 'u-head', budget: 240_000_000, amounts: [84_000_000, 48_000_000], expenseLabels: ['사업 실행비 · 가상', '성과 조사비 · 가상'], dueOffset: 28, completed: 2, frequency: 'half_yearly', steps: ['사업별 실적 수집', '재정성과 지표 분석', '성과 근거 검토', '반기 성과 정리'] },
    { id: 'budget-demo-task-data-demand', title: commonTemplates[0].title, description: '정보시스템 운영비와 기능 개선비의 요구액을 산출하고 기획재정담당관실 예산 담당자에게 제출합니다. 부서에 배정된 공통업무를 개인 단위업무에 등록한 예시입니다.', unitId: units[3].id, ownerId: 'u-support-member', reviewerId: 'u-support-head', budget: 280_000_000, amounts: [1_500_000], expenseLabels: ['정보화사업 수요 조사비 · 가상'], dueOffset: 20, completed: 1, frequency: 'yearly', steps: templates[0].requiredSteps, commonId: BUDGET_COMMON_DEMAND },
    { id: 'budget-demo-task-data-platform', title: '데이터 플랫폼 구축비 집행 점검', description: '데이터 플랫폼 구축 단계별 지급액, 검수 결과와 계약 잔액을 함께 점검합니다.', unitId: units[4].id, ownerId: 'u-support-member', reviewerId: 'u-support-head', budget: 480_000_000, amounts: [144_000_000, 96_000_000], expenseLabels: ['플랫폼 구축 선금 · 가상', '데이터 연계 중도금 · 가상'], dueOffset: 7, completed: 2, frequency: 'monthly', steps: ['계약·지급 자료 확인', '검수와 집행액 대조', '집행 내역 검토', '집행 현황 기록'] },
    { id: 'budget-demo-task-data-settlement', title: '정보화사업 정산 증빙 정리', description: '정보시스템 유지관리 사업의 세금계산서, 검수 확인과 지급 내역을 대조하고 정산 자료를 작성합니다.', unitId: units[4].id, ownerId: 'u-support-member', reviewerId: 'u-support-head', budget: 120_000_000, amounts: [30_000_000, 30_000_000], expenseLabels: ['유지관리비 1차 · 가상', '유지관리비 2차 · 가상'], dueOffset: 16, completed: 0, frequency: 'quarterly', steps: ['정산 증빙 수집', '지급 내역 대조', '정산 자료 검토', '최종 정산 제출'] },
  ];

  for (const spec of specifications) {
    if (state.tasks.some(task => task.id === spec.id)) continue;
    const owner = state.users.find(user => user.id === spec.ownerId)!; const unit = state.units.find(item => item.id === spec.unitId);
    const existingCommon = spec.commonId ? state.commonTasks.find(item => item.id === spec.commonId) : undefined;
    if (!unit || unit.deletedAt || unit.ownerId !== owner.id || unit.departmentId !== owner.departmentId || state.runs.some(run => run.taskId === spec.id) || existingCommon && existingCommon.distributions.find(item => item.departmentId === owner.departmentId)?.taskId !== spec.id) { result.skippedIds.push(spec.id); continue; }
    const source = existingCommon ?? commonTemplates.find(item => item.id === spec.commonId);
    const dueDate = source?.dueDate ?? offsetDate(spec.dueOffset, now);
    const dueOffset = Math.round((Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    const workflow = commonWorkflow(source?.requiredSteps ?? spec.steps);
    const completedCount = Math.min(spec.completed, workflow.length);
    workflow.forEach((step, index) => {
      step.done = index < completedCount;
      const remaining = workflow.length - index - 1;
      step.startDate = offsetDate(step.done ? -2 * (completedCount - index) : dueOffset - 3 * (remaining + 1), now);
      step.dueDate = step.done ? offsetDate(-2 * (completedCount - index) + 1, now) : index === workflow.length - 1 ? dueDate : offsetDate(dueOffset - 3 * remaining, now);
    });
    const description = source ? `${source.description}\n\n${spec.description}` : spec.description;
    const card = defaultCard(description); card.finance = `사업 예산 ${spec.budget.toLocaleString('ko-KR')}원 · 집행 ${spec.amounts.reduce((sum, amount) => sum + amount, 0).toLocaleString('ko-KR')}원. 모두 시연용 가상 금액입니다.`; card.documents = '예산 요구서, 산출 근거표, 집행 증빙과 검토 결과 · 시연용'; card.evidence = '아래에 연결한 가상 근거를 참고합니다. 실제 법령·지침의 내용이나 효력을 주장하지 않습니다.';
    const task: Task = { id: spec.id, code: nextTaskCode(state), title: source?.title ?? spec.title, description, unitId: unit.id, departmentId: owner.departmentId, primaryId: owner.id, supportIds: [], reviewerId: spec.reviewerId, status: 'confirmed', priority: spec.commonId ? 'high' : 'medium', frequency: source?.frequency ?? spec.frequency, dueDate, tags: ['예산', '시연용', ...(spec.commonId ? ['공통업무'] : [])], version: 1, completionCriteria: '산출 근거·집행 내역 확인, 부서장 검토와 결과 기록 완료', card, workflow, sourceIds: [], versions: [], commonId: spec.commonId, budget: spec.budget, expenses: spec.amounts.map((amount, index) => ({ id: `${spec.id}-expense-${index + 1}`, date: offsetDate(-14 + index * 4, now), description: spec.expenseLabels[index], amount })), references: [
      { id: `${spec.id}-law`, type: 'law', title: '예산·회계 관련 근거 검토 · 시연', content: '법령 입력 기능을 보여 주는 가상 예시입니다. 실제 조문·법적 효력을 의미하지 않으며 운영 시 담당자가 적용 법령과 공식 원문을 확인합니다.' },
      { id: `${spec.id}-guide`, type: 'guideline', title: '예산 편성·집행 확인표 · 가상 지침', content: '요구액, 산출 근거, 집행액과 잔액을 확인하고 검토 의견을 남기는 시연용 지침입니다.' },
      { id: `${spec.id}-agenda`, type: 'national_agenda', title: '재정 효율화 · 가상 정책과제', content: '사업의 투입 예산과 산출물을 연결하는 시연용 정책과제입니다. 실제 국정과제 번호나 내용이 아닙니다.' },
      { id: `${spec.id}-directive`, type: 'directive', title: '집행 지연 사유 확인 · 시연 지시사항', content: '사업 일정, 지출 계획과 지연 사유를 함께 점검하는 가상 지시사항입니다.' },
    ], createdAt: `${offsetDate(-21, now)}T09:00:00+09:00`, updatedAt: iso };
    task.versions.push(snapshot(task, task.reviewerId, `${offsetDate(-20, now)}T09:00:00+09:00`));
    const period = currentPeriod(task.frequency, new Date(`${task.dueDate}T12:00:00+09:00`)); const run = createRun(task, period, `${offsetDate(-19, now)}T09:00:00+09:00`); run.updatedAt = iso;
    run.steps.forEach((step, index) => {
      const completed = index < completedCount; const actorId = step.role === 'reviewer' ? task.reviewerId : task.primaryId; const completedAt = `${task.workflow[index].dueDate}T17:00:00+09:00`;
      step.status = completed ? 'completed' : index === completedCount && completedCount > 0 ? 'in_progress' : 'pending';
      if (completed) { step.output = `${step.title} 확인 결과 · 가상 시연`; step.completedBy = actorId; step.completedAt = completedAt; step.checklist.forEach(item => { item.done = true; item.completedBy = actorId; item.completedAt = completedAt; }); }
    });
    run.status = completedCount === run.steps.length ? 'completed' : completedCount === 0 ? 'scheduled' : run.steps[completedCount].role === 'reviewer' ? 'review' : 'in_progress';
    if (run.status === 'completed') run.completedAt = run.steps.at(-1)?.completedAt;
    run.notes = [{ id: `${spec.id}-seed-note`, authorId: owner.id, body: '기능 시연을 위해 추가한 가상 예산 자료입니다. 실제 사업·회계 기록이 아닙니다.', createdAt: iso }];
    state.tasks.push(task); state.runs.push(run); result.addedTasks++; result.addedRuns++;
  }

  for (const template of commonTemplates) {
    if (state.commonTasks.some(existing => existing.id === template.id)) continue;
    const distribution = (departmentId: string, taskId?: string, stage: CommonDistribution['status'] = 'pending', leadId?: string, assigneeId?: string): CommonDistribution => {
      const task = taskId ? state.tasks.find(item => item.id === taskId && item.commonId === template.id && item.departmentId === departmentId && !item.deletedAt) : undefined;
      const intendedAssignee = state.users.find(user => user.id === (task?.primaryId ?? assigneeId) && user.departmentId === departmentId && user.active);
      const lead = state.users.find(user => user.id === leadId && user.role === 'lead' && user.departmentId === departmentId && user.active && (!intendedAssignee || user.team === intendedAssignee.team))
        ?? (intendedAssignee && state.users.find(user => user.role === 'lead' && user.departmentId === departmentId && user.active && user.team === intendedAssignee.team));
      const assignee = intendedAssignee?.team === lead?.team ? intendedAssignee : undefined;
      const status = task ? 'registered' : stage === 'person_assigned' && lead && assignee ? 'person_assigned' : stage === 'team_assigned' && lead ? 'team_assigned' : 'pending';
      return { id: `${template.id}-${departmentId}`, departmentId, status, distributedAt: `${offsetDate(-23, now)}T09:00:00+09:00`, ...(status !== 'pending' ? { team: lead?.team ?? state.users.find(user => user.id === task?.primaryId)?.team, leadId: lead?.id, teamAssignedAt: `${offsetDate(-22, now)}T09:00:00+09:00` } : {}), ...(['person_assigned', 'registered'].includes(status) ? { assigneeId: task?.primaryId ?? assignee?.id, personAssignedAt: `${offsetDate(-22, now)}T14:00:00+09:00` } : {}), ...(task ? { taskId: task.id, registeredAt: task.createdAt } : {}) };
    };
    template.distributions = template.id === BUDGET_COMMON_DEMAND ? [distribution('dept-plan', 'budget-demo-task-plan-demand', 'registered', 'u-plan-lead', 'u-jiho'), distribution('dept-support', 'budget-demo-task-data-demand', 'registered', 'u-support-lead', 'u-support-member'), distribution('dept-innovation')] : [distribution('dept-plan', 'budget-demo-task-plan-execution', 'registered', 'u-plan-lead', 'u-jiho'), distribution('dept-support', undefined, 'person_assigned', 'u-support-lead', 'u-support-member'), distribution('dept-innovation', undefined, 'team_assigned', 'u-innovation-lead')];
    state.commonTasks.push(template); result.addedCommonTasks++;
  }
  result.changed = !alreadyApplied || result.addedUnits + result.addedTasks + result.addedRuns + result.addedCommonTasks + result.updatedUsers > 0;
  if (result.changed) {
    let eventId = `audit-${BUDGET_DEMO_MARKER}`; let suffix = 2; while (state.audit.some(event => event.id === eventId)) eventId = `audit-${BUDGET_DEMO_MARKER}-${suffix++}`;
    state.audit.unshift({ id: eventId, actorId: 'system', action: 'demo.budget.setup', targetType: 'workspace', targetId: BUDGET_DEMO_MARKER, title: '예산 업무 시연 자료 추가', detail: `가상 단위업무 ${result.addedUnits}개, 세부업무 ${result.addedTasks}개, 수행 회차 ${result.addedRuns}개, 공통업무 ${result.addedCommonTasks}개 추가 · 기존 기록 보존`, departmentId: 'dept-plan', createdAt: iso });
    state.revision++; result.revision = state.revision;
  }
  return result;
}

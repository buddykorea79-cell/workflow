import type { Performance, UnitPerformanceSnapshot, UnitScoreAllocation, WorkspaceData } from './types';

type EvaluationState = Pick<WorkspaceData, 'users' | 'units' | 'tasks' | 'performances' | 'unitScorePlans' | 'unitEvaluations'>;

export const UNIT_SCORE_TOTAL = 50;
export const getUnitScorePlan = (state: Pick<WorkspaceData, 'unitScorePlans'>, personId: string, period: string) => state.unitScorePlans?.find(plan => plan.personId === personId && plan.period === period);
export const getUnitEvaluation = (state: Pick<WorkspaceData, 'unitEvaluations'>, personId: string, period: string) => state.unitEvaluations?.find(evaluation => evaluation.personId === personId && evaluation.period === period);

export function eligibleScoreUnits(state: Pick<WorkspaceData, 'units' | 'users'>, personId: string) {
  const person = state.users.find(user => user.id === personId);
  return state.units.filter(unit => !unit.deletedAt && unit.ownerId === personId && unit.departmentId === person?.departmentId);
}

/** A period keeps the units evidenced by its saved plan and the author's own records.
 * Moving today's assignment must not erase the work that is being evaluated. */
export function scoreUnitsForPeriod(state: EvaluationState, personId: string, period: string) {
  const plan = getUnitScorePlan(state, personId, period);
  const records = currentPersonPerformances(state, personId, period);
  const person = state.users.find(user => user.id === personId);
  const departmentId = plan?.departmentId ?? records[0]?.departmentId ?? person?.departmentId;
  const units = new Map<string, { id: string; title: string; departmentId: string }>();
  for (const allocation of plan?.allocations ?? []) units.set(allocation.unitId, { id: allocation.unitId, title: allocation.unitTitle, departmentId: plan!.departmentId });
  for (const unit of eligibleScoreUnits(state, personId).filter(unit => unit.departmentId === departmentId)) units.set(unit.id, { id: unit.id, title: unit.title, departmentId: unit.departmentId });
  for (const record of records.filter(record => record.departmentId === departmentId)) {
    const unitId = performanceUnitId(state, record);
    const unit = state.units.find(unit => unit.id === unitId);
    if (unitId && (unit || !plan) && !units.has(unitId)) units.set(unitId, { id: unitId, title: unit?.title || '이전 단위업무', departmentId: record.departmentId });
  }
  return [...units.values()];
}

/** Keep one latest half-year record per task. Legacy per-run records have no period and are excluded. */
export function currentPersonPerformances(state: Pick<WorkspaceData, 'performances'>, personId: string, period: string): Performance[] {
  const items = state.performances.filter(performance => performance.authorId === personId && performance.period === period);
  const superseded = new Set(items.map(item => item.previousId).filter(Boolean));
  const byTask = new Map<string, Performance>();
  for (const item of items.filter(candidate => !superseded.has(candidate.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    if (!byTask.has(item.taskId)) byTask.set(item.taskId, item);
  }
  return [...byTask.values()];
}

export function performanceUnitId(state: Pick<WorkspaceData, 'tasks'>, performance: Performance) {
  return performance.unitId || state.tasks.find(task => task.id === performance.taskId)?.unitId || '';
}

// Existing long-form records remain submittable; the 500-character limit applies when saving new edits.
export const hasCompletePerformance = (performance: Performance) => !!performance.description.trim();

export function missingPerformanceUnitIds(state: Pick<WorkspaceData, 'tasks'>, allocations: UnitScoreAllocation[], performances: Performance[], departmentId: string) {
  return allocations.filter(allocation => allocation.maxScore > 0 && !performances.some(performance => performance.departmentId === departmentId && performance.status !== 'changes_requested' && performanceUnitId(state, performance) === allocation.unitId && hasCompletePerformance(performance))).map(allocation => allocation.unitId);
}

export function personUnitPerformanceSummary(state: EvaluationState, personId: string, period: string) {
  const plan = getUnitScorePlan(state, personId, period);
  const evaluation = getUnitEvaluation(state, personId, period);
  const performances: (Performance | UnitPerformanceSnapshot)[] = evaluation ? evaluation.performanceSnapshot : currentPersonPerformances(state, personId, period);
  const units: { unitId: string; unitTitle: string; maxScore?: number; score?: number; comment?: string }[] = evaluation ? evaluation.scores.map(score => ({ unitId: score.unitId, unitTitle: score.unitTitle, maxScore: score.maxScore, score: score.score, comment: score.comment })) : [
    ...scoreUnitsForPeriod(state, personId, period).map(unit => ({ unitId: unit.id, unitTitle: unit.title, maxScore: plan?.allocations.find(allocation => allocation.unitId === unit.id)?.maxScore, score: undefined, comment: undefined })),
  ];
  // Keep historical or moved-unit evidence visible even before a score plan has been saved.
  for (const performance of performances) {
    const unitId = performanceUnitId(state, performance);
    if (!units.some(unit => unit.unitId === unitId)) units.push({ unitId, unitTitle: state.units.find(unit => unit.id === unitId)?.title || '이전 단위업무', maxScore: undefined, score: undefined, comment: undefined });
  }
  return {
    personId, period, plan, evaluation, performances, submittedAt: plan?.submittedAt,
    status: evaluation ? 'evaluated' as const : plan?.submittedAt ? 'submitted' as const : 'not_submitted' as const,
    units: units.map(unit => ({ ...unit, performances: performances.filter(performance => performanceUnitId(state, performance) === unit.unitId), taskCount: state.tasks.filter(task => task.primaryId === personId && task.unitId === unit.unitId && !task.deletedAt && task.status !== 'archived').length })),
    totalMaxScore: (plan?.allocations.reduce((sum, allocation) => sum + Math.round(allocation.maxScore * 100), 0) ?? 0) / 100,
    totalScore: evaluation?.totalScore,
  };
}

import type { Performance, UnitPerformanceSnapshot, UnitScoreAllocation, User, WorkspaceData } from './types';

type EvaluationState = Pick<WorkspaceData, 'users' | 'units' | 'tasks' | 'performances' | 'unitScorePlans' | 'unitEvaluations'>;

export const UNIT_SCORE_TOTAL = 50;

/** Validate the editable values without replacing incomplete input or counting invalid scores. */
export function validateWeights(units: readonly { id: string }[], values: Readonly<Record<string, string | number | null | undefined>>) {
  const fieldErrors: Record<string, string> = {};
  let totalHundredths = 0;
  for (const unit of units) {
    const raw = String(values[unit.id] ?? '').trim();
    const score = Number(raw);
    if (!raw) fieldErrors[unit.id] = '점수를 입력해 주세요.';
    else if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) || !Number.isFinite(score)) fieldErrors[unit.id] = '숫자로 입력해 주세요.';
    else if (score < 0) fieldErrors[unit.id] = '0점 이상이어야 합니다.';
    else if (score > UNIT_SCORE_TOTAL) fieldErrors[unit.id] = '50점 이하여야 합니다.';
    else {
      // Use the numeric value's precision: trailing zeros and scientific notation are equivalent.
      const [significand, exponent = '0'] = String(score).split('e');
      const decimalPlaces = (significand.split('.')[1]?.length ?? 0) - Number(exponent);
      if (decimalPlaces > 2) fieldErrors[unit.id] = '소수 둘째 자리까지 입력할 수 있습니다.';
      else totalHundredths += Math.round(score * 100);
    }
  }
  const total = totalHundredths / 100;
  const validTotal = totalHundredths === UNIT_SCORE_TOTAL * 100;
  return { fieldErrors, total, validTotal, canSave: units.length > 0 && !Object.keys(fieldErrors).length && validTotal };
}

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

/** Match the server's review readiness before the reviewer supplies their scores.
 * Historical authors may be identities in a scoped workspace after moving departments. */
export function canEvaluateUnitPerformance(state: Pick<WorkspaceData, 'users' | 'tasks' | 'performances' | 'unitScorePlans' | 'unitEvaluations'> & { identities?: readonly { id: string }[] }, user: User, personId: string, period: string, now = new Date()): boolean {
  if (!user.active || user.endsAt && new Date(user.endsAt) <= now || !['head', 'admin'].includes(user.role) || personId === user.id) return false;
  if (!state.users.some(person => person.id === personId) && !state.identities?.some(person => person.id === personId)) return false;
  const plan = getUnitScorePlan(state, personId, period);
  if (!plan?.submittedAt || user.role !== 'admin' && plan.departmentId !== user.departmentId || getUnitEvaluation(state, personId, period)) return false;
  const records = currentPersonPerformances(state, personId, period).filter(record => record.departmentId === plan.departmentId);
  return !records.some(record => record.status === 'changes_requested') && records.some(record => ['review', 'confirmed'].includes(record.status) && plan.allocations.some(allocation => allocation.unitId === performanceUnitId(state, record)));
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

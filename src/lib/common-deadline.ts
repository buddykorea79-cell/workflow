import { dueDateForPeriod, normalizePeriod } from './schedule';
import type { CommonTask, Run } from './types';

/** The reporting period is fixed when a run is created; editing its dates cannot extend the central deadline. */
export function commonDeadline(common: Pick<CommonTask, 'dueDate' | 'frequency'>, run?: Pick<Run, 'period'>): string {
  if (!run?.period?.trim() || common.frequency === 'once') return common.dueDate;
  const period = normalizePeriod(common.frequency, run.period);
  return period ? dueDateForPeriod(common.frequency, period, common.dueDate) : common.dueDate;
}

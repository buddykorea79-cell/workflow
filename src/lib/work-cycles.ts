import type { Run, Task, WorkflowStep, WorkspaceData } from './types';

/** Newest insertion wins equal creation times, as in the existing run read model. */
export function taskCycleState(state: Pick<WorkspaceData, 'runs'>, task: Task) {
  const runs = state.runs.filter(run => run.taskId === task.id).map((run, index) => ({ run, index }))
    .sort((a, b) => Date.parse(b.run.startedAt) - Date.parse(a.run.startedAt) || a.index - b.index).map(item => item.run);
  const latest = runs[0];
  const completed = latest ? latest.status === 'completed' && latest.steps.length > 0 && latest.steps.every(step => step.status === 'completed') : task.workflow.length > 0 && task.workflow.every(step => step.done);
  return { runs, latest, completed, canStart: completed && !runs.some(run => run.status !== 'completed'), nextCycleNumber: Math.max(runs.length, ...runs.map(run => run.cycleNumber || 0), latest ? 0 : 1) + 1 };
}

/** A saved run owns its procedure. Legacy runs use their unchanged definition version. */
export function runWorkflow(task: Task, run: Run): WorkflowStep[] {
  const definition = run.workflowSnapshot ?? task.versions.find(version => version.version === run.definitionVersion)?.workflow;
  return run.steps.map(step => {
    const config = definition?.find(item => item.id === step.stepId);
    return { ...(config ? structuredClone(config) : { id: step.stepId, title: step.title, role: step.role, description: '', output: '', required: true, dependsOn: [], checklist: step.checklist.map(item => item.title) }), title: step.title, role: step.role, done: step.status === 'completed' };
  });
}

/** Reuse the most recent confirmed definition; unpublished revisions are not execution templates. */
export function nextCycleWorkflow(task: Task): WorkflowStep[] {
  return structuredClone(task.versions.at(-1)?.workflow ?? task.workflow).map(({ done: _done, ...step }) => ({ ...step, done: false }));
}

export function shiftCycleDate(value: string | undefined, deltaDays: number): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time)) return undefined;
  return new Date(time + deltaDays * 86_400_000).toISOString().slice(0, 10);
}

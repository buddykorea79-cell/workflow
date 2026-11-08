type DeadlineInput = {
  taskDueDate?: string;
  cycleDueDate?: string;
  progress: number;
  runStatus?: string;
  taskStatus?: string;
  deletedAt?: string;
  deleted?: boolean;
};

function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

/** `today` is the caller's Asia/Seoul calendar date, never the browser's timezone. */
export function deadlineState(input: DeadlineInput, today: string) {
  const deadline = input.taskDueDate || '';
  const cycleDue = input.cycleDueDate || '';
  const active = !input.deleted && !input.deletedAt && !['archived', 'deleted'].includes(input.taskStatus || '');
  const completed = input.progress >= 100 || input.runStatus === 'completed' || input.taskStatus === 'completed';
  const paused = input.runStatus === 'paused' || input.taskStatus === 'paused';
  const beforeToday = (value: string) => validDay(today) && validDay(value) && value < today;
  return {
    deadline,
    cycleDue,
    overdue: active && !completed && !paused && beforeToday(deadline),
    // A paused cycle may have passed its planned end; this is separate from task lateness.
    cycleOverdue: active && !completed && beforeToday(cycleDue),
  };
}

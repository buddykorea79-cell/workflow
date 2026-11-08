import test from 'node:test';
import assert from 'node:assert/strict';
import { deadlineState } from '../src/lib/task-deadline';

test('a future cycle never hides an overdue task deadline', () => {
  const result = deadlineState({ taskDueDate: '2025-01-01', cycleDueDate: '2026-11-25', progress: 25, runStatus: 'in_progress', taskStatus: 'confirmed' }, '2026-11-07');
  assert.deepEqual(result, { deadline: '2025-01-01', cycleDue: '2026-11-25', overdue: true, cycleOverdue: false });
});

test('completed, paused, archived and deleted tasks do not count as overdue', () => {
  const base = { taskDueDate: '2026-11-01', progress: 25, runStatus: 'in_progress', taskStatus: 'confirmed' };
  for (const change of [{ progress: 100 }, { runStatus: 'completed' }, { runStatus: 'paused' }, { taskStatus: 'archived' }, { deletedAt: '2026-11-02T01:00:00Z' }, { deleted: true }]) {
    assert.equal(deadlineState({ ...base, ...change }, '2026-11-07').overdue, false);
  }
});

test('cycle end has a separate indication and the deadline day is not overdue', () => {
  assert.deepEqual(deadlineState({ taskDueDate: '2026-11-07', cycleDueDate: '2026-11-06', progress: 0 }, '2026-11-07'), { deadline: '2026-11-07', cycleDue: '2026-11-06', overdue: false, cycleOverdue: true });
  assert.equal(deadlineState({ taskDueDate: '2026-02-30', cycleDueDate: '', progress: 0 }, '2026-11-07').overdue, false);
  assert.equal(deadlineState({ taskDueDate: '', progress: 0 }, '2026-11-07').overdue, false);
});

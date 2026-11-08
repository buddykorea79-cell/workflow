import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { executeCommand, assertDefinitionWritable, activeUser } from '../src/lib/domain';
import { commandExpectation } from '../src/lib/command-targets';
import type { User, WorkspaceData } from '../src/lib/types';

/** Explicit local input only. Never import a store, load env files, or persist command results. */
const args = process.argv.slice(2);
function options() {
  let file: string | undefined; let now = new Date();
  for (let index = 0; index < args.length; index++) {
    const key = args[index]; const value = args[++index];
    if (!value || !['--file', '--now'].includes(key)) throw new Error('--file <합성 QA JSON> [--now <ISO 시각>]만 사용할 수 있습니다.');
    if (key === '--file') file = path.resolve(value);
    else { now = new Date(value); if (!Number.isFinite(now.getTime())) throw new Error('--now에 유효한 ISO 시각을 입력해 주세요.'); }
  }
  if (!file || path.extname(file).toLowerCase() !== '.json') throw new Error('--file로 기존 합성 QA JSON 파일을 지정해 주세요.');
  return { file, now };
}
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
function measure(state: WorkspaceData) {
  const fields = Object.entries(state).map(([field, value]) => ({ field, kind: Array.isArray(value) ? 'array' : value !== null && typeof value === 'object' ? 'object' : 'scalar', count: Array.isArray(value) ? value.length : value !== null && typeof value === 'object' ? Object.keys(value).length : 1, bytes: bytes(value) })).sort((a, b) => b.bytes - a.bytes || a.field.localeCompare(b.field));
  return { bytes: bytes(state), fields, taskVersions: state.tasks.reduce((sum, task) => sum + task.versions.length, 0), recordHistoryEntries: state.tasks.reduce((sum, task) => sum + (task.recordHistory?.length ?? 0), 0) };
}
function actorFor(state: WorkspaceData, now: Date): User {
  const actor = state.users.find(user => {
    try {
      activeUser(state, user.id, now); assertDefinitionWritable(state, user, user.departmentId);
      return user.role === 'member' && state.users.some(head => head.departmentId === user.departmentId && head.role === 'head' && head.active && (!head.endsAt || new Date(head.endsAt) > now));
    } catch { return false; }
  });
  if (!actor) throw new Error('합성 QA 자료에 편집 가능한 부서의 활성 담당자·부서장이 필요합니다. 원본 권한을 바꾸지 않습니다.');
  return actor;
}

async function main() {
  const { file, now } = options(); const raw = await readFile(file); const fileInfo = await stat(file);
  const state = JSON.parse(raw.toString('utf8')) as WorkspaceData;
  if (!state || !Array.isArray(state.users) || !Array.isArray(state.tasks) || !Array.isArray(state.audit) || !Array.isArray(state.processedRequests)) throw new Error('기존 WorkspaceData 형식의 합성 QA 파일을 지정해 주세요.');
  const baseline = measure(state); const actor = actorFor(state, now); const steps = [1, 10, 100];
  const scenarios = ['task.create', 'task.configure', 'task.record'] as const;
  const results = scenarios.map(type => {
    const clone = structuredClone(state); let sequence = 0; const runId = randomUUID();
    const apply = (commandType: string, payload: Record<string, unknown>) => {
      const expected = commandExpectation(clone, commandType, payload, actor);
      executeCommand(clone, actor.id, { type: commandType, payload, expectedRevision: clone.revision, ...(expected ? { expected } : {}), requestId: `growth:${runId}:${String(++sequence).padStart(6, '0')}` }, new Date(now.getTime() + sequence * 1000));
    };
    apply('unit.create', { title: `합성 계측 단위 ${runId}`, description: '저장 구조 증가량 확인을 위한 합성 단위업무입니다.' });
    const unit = clone.units.at(-1)!;
    const taskInput = { unitId: unit.id, primaryId: actor.id, title: '합성 계측 업무 000000', description: '현황 자료를 확인하고 점검 결과를 정리합니다.', dueDate: '2099-12-31', frequency: 'once', priority: 'medium', supportIds: [] };
    apply('task.create', taskInput); const task = clone.tasks[0]; const start = measure(clone);
    const samples = [];
    for (let count = 1; count <= 100; count++) {
      const number = String(count).padStart(6, '0');
      if (type === 'task.create') apply(type, { ...taskInput, title: `합성 계측 업무 ${number}` });
      if (type === 'task.configure') apply(type, { taskId: task.id, description: `현황 자료를 확인하고 점검 결과를 정리합니다. 변경 ${number}` });
      if (type === 'task.record') apply(type, { taskId: task.id, expenses: [...(task.expenses ?? []), { id: `expense-${number}`, date: '2026-11-08', description: `합성 점검 집행 ${number}`, amount: 1000 }] });
      if (steps.includes(count)) {
        const current = measure(clone);
        samples.push({ commands: count, bytes: current.bytes, addedBytes: current.bytes - start.bytes, averageBytesPerCommand: (current.bytes - start.bytes) / count, addedTaskVersions: current.taskVersions - start.taskVersions, addedRecordHistoryEntries: current.recordHistoryEntries - start.recordHistoryEntries, fields: current.fields.flatMap(field => {
          const prior = start.fields.find(item => item.field === field.field); const addedBytes = field.bytes - (prior?.bytes ?? 0); const addedCount = field.count - (prior?.count ?? 0);
          return addedBytes || addedCount ? [{ field: field.field, bytes: field.bytes, count: field.count, addedBytes, addedCount }] : [];
        }) });
      }
    }
    return { command: type, preparationCommands: 2, preparationAddedBytes: start.bytes - baseline.bytes, baselineBytes: start.bytes, samples };
  });
  const after = await readFile(file);
  if (hash(after) !== hash(raw)) throw new Error('계측 중 원본 파일이 다른 작업에 의해 변경되었습니다. 안정된 합성 사본에서 다시 실행해 주세요.');
  console.log(JSON.stringify({ source: file, sourceSha256: hash(raw), sourceFileBytes: raw.length, sourceModifiedAt: fileInfo.mtime.toISOString(), measuredAt: new Date().toISOString(), scenarioTime: now.toISOString(), sourceUnchanged: true, actorRole: actor.role, baseline, scenarios: results }, null, 2));
}
main().catch(error => { console.error(error instanceof Error ? error.message : '합성 계측을 완료하지 못했습니다.'); process.exitCode = 1; });

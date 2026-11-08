import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { DomainError, executeCommand } from '../src/lib/domain';
import { createSeed } from '../src/lib/seed';
import { parseBudgetCatalog } from '../src/lib/budget-catalog';
import { apiError } from '../src/lib/api';
import { formatIssues, parseInput, validationLabel } from '../src/lib/validation';
import { matchFieldPath, requiredTextIssues, requireText, summarizeIssues, withParticle } from '../src/lib/form-validation';

const now = new Date('2026-11-07T03:00:00Z');
function commandError(type: string, payload: Record<string, unknown>, actor = 'u-support-member') {
  const state = createSeed(now), before = structuredClone(state);
  let caught: unknown;
  try { executeCommand(state, actor, { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, now); }
  catch (error) { caught = error; }
  assert.ok(caught instanceof DomainError);
  assert.deepEqual(state, before, 'validation must not mutate business data');
  assert.doesNotMatch(caught.message, /[A-Za-z]{3,}/);
  return caught;
}

test('task and unit whitespace validation uses Korean business labels and keeps field paths', () => {
  const error = commandError('task.create', { title: '   ', description: '\t\n ', unitId: 'unit-data', primaryId: 'u-support-member', supportIds: [], dueDate: '2026-11-30', frequency: 'once' });
  assert.equal(error.code, 'VALIDATION_ERROR');
  assert.equal(error.message, '세부업무 이름을 입력해 주세요.\n업무 설명을 입력해 주세요.');
  assert.deepEqual(error.fieldErrors, [{ path: 'title', message: '세부업무 이름을 입력해 주세요.' }, { path: 'description', message: '업무 설명을 입력해 주세요.' }]);
  assert.match(commandError('unit.create', { title: ' ', description: ' ' }).message, /단위업무 이름을.*\n업무 범위를/);
});

test('handover and both delegation parsing paths reject invalid fields in Korean', () => {
  const transfer = commandError('transfer.request', { departmentId: 'dept-support', fromId: 'u-support-member', toId: 'u-doyun', taskIds: ['task-data'], reason: ' ' });
  assert.equal(transfer.code, 'VALIDATION_ERROR');
  assert.deepEqual(transfer.fieldErrors, [{ path: 'reason', message: '인수인계 사유를 입력해 주세요.' }]);
  for (const type of ['delegation.request', 'delegation.requestBatch']) {
    const error = commandError(type, { taskId: 'task-data', taskIds: ['task-data'], fromId: 'u-support-member', toId: 7, startsAt: 'bad', endsAt: 'bad', reason: ' ' });
    assert.equal(error.code, 'VALIDATION_ERROR');
    assert.ok(error.fieldErrors?.some(field => field.path === 'toId' && field.message.includes('대행자')));
    assert.ok(error.fieldErrors?.some(field => field.path === 'reason'));
  }
});

test('budget validation preserves its existing error code without leaking schema keys', () => {
  assert.throws(() => parseBudgetCatalog({ schemaVersion: 1, year: 'bad', source: { fileName: '자료' }, items: [] }), error => {
    assert.ok(error instanceof DomainError);
    assert.equal(error.code, 'BUDGET_INVALID_INPUT');
    assert.doesNotMatch(error.message, /[A-Za-z]{3,}/);
    assert.ok(error.fieldErrors?.some(field => field.path === 'year' && field.message.includes('연도')));
    return true;
  });
});

test('Korean particles and client whitespace checks handle the first invalid field in order', () => {
  for (const label of ['이름', '설명', '마감일']) assert.equal(requireText(' \t\n ', label), `${label}을 입력해 주세요.`);
  assert.equal(requireText(' ', '사유'), '사유를 입력해 주세요.');
  assert.equal(withParticle('설명', '은', '는'), '설명은');
  assert.equal(withParticle('사유', '은', '는'), '사유는');
  assert.equal(requireText(' 유효한 값 ', '이름'), '');
  assert.deepEqual(requiredTextIssues([{ path: 'title', value: ' ', label: '이름' }, { path: 'description', value: '내용', label: '설명' }, { path: 'reason', value: '\t', label: '사유' }]).map(field => field.path), ['title', 'reason']);
});

test('formatting hides English types, enum values, regex patterns and unknown internal keys', () => {
  const schema = z.object({ title: z.string(), priority: z.enum(['high', 'low']), opaqueInternalKey: z.string().regex(/^secretToken[A-Z]+$/), period: z.string().regex(/^20\d{2}-H[12]$/), count: z.number().min(1), payload: z.object({ known: z.string() }).strict() });
  const parsed = schema.safeParse({ title: 9, priority: 'internal', opaqueInternalKey: 'bad', period: 'bad', count: -1, payload: { known: 'ok', secretKey: true } });
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  const formatted = formatIssues(parsed.error.issues);
  assert.doesNotMatch(formatted.message, /[A-Za-z]{3,}/);
  assert.doesNotMatch(formatted.message, /정규식|타입|secret|opaque/);
  assert.equal(formatted.fields.length, 6);
  assert.equal(formatted.message.split('\n').length, 6);
  assert.match(formatted.message, /외 1건$/);
  assert.equal(summarizeIssues(['가', '나']), '가\n나');
});

test('nested paths keep human labels, dates keep custom guidance, string limits show character counts', () => {
  assert.equal(validationLabel(['workflow', 0, 'title']), '1번째 절차 이름');
  assert.equal(validationLabel(['steps', 1, 'dueDate']), '2번째 절차 종료일');
  assert.equal(validationLabel(['expenses', 2, 'amount']), '3번째 집행 금액');
  assert.equal(validationLabel(['references', 0, 'title']), '1번째 근거 제목');
  assert.equal(validationLabel(['allocations', 0, 'maxScore']), '업무 비중');
  assert.throws(() => parseInput(z.object({ dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식이 올바르지 않습니다.') }), { dueDate: 'bad' }), error => error instanceof DomainError && error.message === '날짜 형식이 올바르지 않습니다.');
  assert.throws(() => parseInput(z.object({ description: z.string().max(500) }), { description: '가'.repeat(501) }, { labels: { description: '성과 내용' } }), error => error instanceof DomainError && error.message === '성과 내용은 500자 이내로 입력해 주세요.');
});

test('server fields match exact inputs or their array input, never a similarly named field', () => {
  assert.equal(matchFieldPath('workflow.0.title', ['workflow', 'workflow.0.title']), 'workflow.0.title');
  assert.equal(matchFieldPath('requiredSteps.0', ['requiredSteps']), 'requiredSteps');
  assert.equal(matchFieldPath('titleExtra', ['title']), undefined);
  assert.equal(matchFieldPath('reason', ['title']), undefined);
});

test('API validation responses preserve error and code while exposing optional fields', async () => {
  const fields = [{ path: 'title', message: '이름을 입력해 주세요.' }];
  const response = apiError(new DomainError(422, 'VALIDATION_ERROR', fields[0].message, fields));
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), { error: fields[0].message, code: 'VALIDATION_ERROR', fields });
  assert.deepEqual(await apiError(new DomainError(409, 'VERSION_CONFLICT', '다시 확인해 주세요.')).json(), { error: '다시 확인해 주세요.', code: 'VERSION_CONFLICT' });
});

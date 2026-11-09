import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { markdownToHwpx } from 'kordoc';

const base = process.argv.find(value => /^http:/.test(value)) || 'http://127.0.0.1:3001';
const origin = new URL(base);
assert.equal(origin.hostname, '127.0.0.1'); assert.equal(origin.port, '3001', 'Only use the isolated local QA server.');
const qa = path.resolve('.qa'); await mkdir(qa, { recursive: true });
const cookies = new Map(), log = [];
const owner = 'u-seoyeon', deputy = 'u-jiho', head = 'u-head', foreign = 'u-support-member', admin = 'u-admin';
const summaryPath = path.join(qa, 'http-description-delegation-result.json');
const aiPath = path.join(qa, 'http-description-delegation-ai.json');
const output = { base, accounts: { owner, deputy, head, foreign, admin }, files: {}, checks: log, aiRequests: 0 };
async function save() { await writeFile(summaryPath, JSON.stringify(output, null, 2)); }
async function check(name, fn) { await fn(); log.push(name); console.log(`PASS ${name}`); await save(); }
async function request(route, { user, method = 'GET', body, expected = 200, binary = false } = {}) {
  const response = await fetch(base + route, { method, headers: { Origin: origin.origin, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(user ? { Cookie: cookies.get(user) || '' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90_000) });
  if (binary && response.status === expected) return { response, bytes: Buffer.from(await response.arrayBuffer()) };
  const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data).slice(0, 700)); return { data, response };
}
async function login(user) { const { data, response } = await request('/api/session', { method: 'POST', body: { userId: user } }); cookies.set(user, response.headers.get('set-cookie').split(';')[0]); assert.equal(data.mode, 'local', 'Never run against Neon.'); return data; }
async function workspace(user) { return (await request('/api/workspace', { user })).data; }
async function command(user, type, payload, expected = 200) {
  const state = await workspace(user); return (await request('/api/commands', { user, method: 'POST', body: { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, expected })).data;
}
async function upload(user, taskId, bytes, name, mime = 'text/plain') {
  const form = new FormData(); form.set('taskId', taskId); form.set('file', new Blob([bytes], { type: mime }), name);
  const { data } = await request('/api/attachments', { user, method: 'POST', body: form });
  const attachment = data.attachments.find(item => item.taskId === taskId && item.name === name); assert.ok(attachment); return attachment;
}

try {
  let state = await login(owner); await login(deputy); await login(head); await login(foreign); await login(admin);
  await check('Only the isolated local store is used', () => assert.equal(state.mode, 'local'));
  if (state.departmentWorkPlans?.find(plan => plan.departmentId === state.currentUser.departmentId)?.status === 'confirmed') await command(head, 'department.reopen', { reason: '격리 통합 검증용 업무 등록' });
  const title = `문서 기반 업무대행 검증 ${randomUUID().slice(0, 6)}`; output.taskTitle = title;
  const txt = Buffer.from('가상 업무 설명 자료입니다.\n업무명: 분기 자료 검토 및 결과 보고\n목적: 각 팀이 제출한 자료를 취합하고 누락 사항을 확인한다.\n담당자는 자료 목록과 검토 결과를 작성하고 부서장은 최종 보고서를 검토한다.\n산출물: 자료 목록, 보완 요청 기록, 최종 결과 보고서.\n');
  const hwpx = Buffer.from(await markdownToHwpx('# 가상 업무 수행 지침\n\n## 수행 범위\n\n팀별 자료를 취합하고 증빙과 목록이 일치하는지 확인한다.\n\n## 협업과 산출물\n\n누락된 자료는 제출 팀에 보완을 요청한다. 검토 결과와 보완 내역을 결과 보고서에 정리한다. 출장 기간에는 승인된 업무대행자가 동일한 기록에 수행 결과를 입력한다.\n\n## 검토\n\n최종 보고서는 부서장이 검토한다. 본 문서는 기능 점검을 위한 가상 자료이다.'));
  const txtPath = path.join(qa, 'description-delegation-source.txt'), hwpxPath = path.join(qa, 'description-delegation-source.hwpx');
  await writeFile(txtPath, txt); await writeFile(hwpxPath, hwpx); output.files = { txt: txtPath, hwpx: hwpxPath };
  const draftId = `draft:${owner}:${randomUUID()}`; output.draftId = draftId;
  const first = await upload(owner, draftId, txt, '업무 설명 자료.txt');
  const second = await upload(owner, draftId, hwpx, '업무 수행 지침.hwpx', 'application/vnd.hancom.hwpx');
  output.descriptionAttachmentIds = [first.id, second.id]; await save();
  await check('TXT and HWPX upload as uploader-only draft attachments', async () => {
    assert.equal((await workspace(deputy)).attachments.some(item => output.descriptionAttachmentIds.includes(item.id)), false);
    await request('/api/task-description', { user: deputy, method: 'POST', body: { action: 'extract', attachmentId: first.id }, expected: 403 });
  });
  const documents = [];
  for (const file of [first, second]) {
    const { data } = await request('/api/task-description', { user: owner, method: 'POST', body: { action: 'extract', attachmentId: file.id } });
    assert.match(data.text, /자료/); assert.match(data.text, /부서장/); documents.push({ attachmentId: file.id, text: data.text });
  }
  await check('TXT and actual HWPX bodies extract correctly', () => assert.equal(documents.length, 2));
  await writeFile(path.join(qa, 'http-description-delegation-extracted.json'), JSON.stringify(documents, null, 2));
  let ai;
  if (process.argv.includes('--skip-ai')) ai = JSON.parse(await readFile(aiPath, 'utf8'));
  else {
    assert.equal(await readFile(aiPath, 'utf8').then(() => true, () => false), false, 'A previous real AI result exists; use --skip-ai to avoid a second paid request.');
    output.aiRequests = 1; await save();
    const { data } = await request('/api/task-description', { user: owner, method: 'POST', body: { action: 'generate', title, description: '첨부한 두 문서를 검토해 업무 설명 초안을 작성합니다.', documents } });
    ai = data; await writeFile(aiPath, JSON.stringify(ai, null, 2));
    await check('One real BizRouter request summarizes both documents with source evidence', () => {
      assert.equal(ai.draft.sources.length, 2); assert.deepEqual(new Set(ai.draft.sources.map(source => source.attachmentId)), new Set(documents.map(document => document.attachmentId)));
      assert.ok(ai.draft.description.length > 30); assert.ok(ai.model);
    });
  }
  output.aiModel = ai.model; output.files.aiResult = aiPath;
  state = await workspace(owner);
  const unit = state.units.find(item => item.ownerId === owner && !item.deletedAt); assert.ok(unit); output.unitId = unit.id;
  const serverNow = new Date(state.serverTime), day = offset => new Date(serverNow.getTime() + offset * 86400_000).toISOString().slice(0, 10);
  state = await command(owner, 'task.create', { title, description: ai.draft.description, descriptionAttachmentIds: output.descriptionAttachmentIds, unitId: unit.id, primaryId: owner, supportIds: [], frequency: 'monthly', dueDate: day(14), deputy: { toId: deputy, startsAt: new Date(serverNow.getTime() - 60_000).toISOString(), endsAt: new Date(serverNow.getTime() + 7 * 86400_000).toISOString(), reason: '격리 검증: 출장 기간 업무대행' } });
  const task = state.tasks.find(item => item.title === title); assert.ok(task); output.taskId = task.id;
  const delegation = state.delegations.find(item => item.taskId === task.id); assert.ok(delegation); output.delegationId = delegation.id;
  await check('Draft task creation claims both explanation files and atomically requests delegation', () => {
    assert.equal(task.status, 'draft'); assert.equal(task.reviewerId, head); assert.equal(delegation.status, 'pending');
    assert.deepEqual(task.descriptionAttachmentIds, output.descriptionAttachmentIds);
    for (const fileId of output.descriptionAttachmentIds) assert.equal(state.attachments.find(item => item.id === fileId).taskId, task.id);
  });
  await check('Deputy has no original task access before source-head approval', async () => {
    assert.equal((await workspace(deputy)).tasks.some(item => item.id === task.id), false);
    const denied = await command(deputy, 'task.record', { taskId: task.id, documents: [] }, 403); assert.equal(denied.code, 'TASK_ACCESS_DENIED');
    const foreignDenied = await command(foreign, 'delegation.approve', { delegationId: delegation.id }, 403); assert.equal(foreignDenied.code, 'DELEGATION_HEAD_REQUIRED');
  });
  state = await command(head, 'delegation.approve', { delegationId: delegation.id });
  await check('Source head approves and deputy sees the same original task', async () => {
    const delegated = await workspace(deputy); assert.ok(delegated.delegatedTaskIds.includes(task.id));
    const original = delegated.tasks.find(item => item.id === task.id); assert.ok(original); assert.equal(original.primaryId, owner); assert.equal(original.unitId, unit.id);
    assert.ok(delegated.attachments.some(item => item.id === first.id && item.taskId === task.id));
  });
  state = await command(deputy, 'run.schedule', { taskId: task.id, startDate: day(0), dueDate: day(3), scheduleDetails: '승인된 업무대행자의 일정 등록', steps: task.workflow.map(step => ({ stepId: step.id })) });
  const run = state.runs.find(item => item.taskId === task.id); assert.ok(run); output.runId = run.id;
  state = await command(deputy, 'run.note', { runId: run.id, body: '업무대행자가 원본 업무에 수행 메모를 남겼습니다.' });
  state = await command(deputy, 'task.setProgress', { taskId: task.id, stepId: task.workflow[0].id, done: true });
  const resultFile = await upload(deputy, task.id, Buffer.from('업무대행자의 자료 확인 결과입니다. 원본 담당자는 계속 정주무관입니다.'), '업무대행 결과.txt');
  state = await command(deputy, 'task.record', { taskId: task.id, documents: [{ id: randomUUID(), type: 'document', title: '업무대행 수행 결과', content: '자료 취합 단계 확인 완료', attachmentId: resultFile.id }] });
  await check('Deputy schedules, records a note, completes a performer step and uploads a produced document on the original', async () => {
    const original = (await workspace(owner)).tasks.find(item => item.id === task.id);
    assert.equal(original.primaryId, owner); assert.equal(original.workflow[0].done, true);
    assert.ok(original.references.some(item => item.attachmentId === resultFile.id));
    assert.equal(original.recordHistory.at(-1).recordedBy, deputy);
    const reviewStep = original.workflow.find(step => step.role === 'reviewer');
    const denied = await command(deputy, 'task.setProgress', { taskId: task.id, stepId: reviewStep.id, done: true }, 403); assert.equal(denied.code, 'EXECUTION_DENIED');
  });
  await check('Source department audit preserves request, approval and actual performer records', async () => {
    const audited = await workspace(head);
    for (const action of ['delegation.request', 'delegation.approve', 'run.note', 'task.record']) assert.ok(audited.audit.some(item => item.action === action && [delegation.id, task.id, run.id].includes(item.targetId)), action);
  });
  await check('All colleagues can select assignment titles from other departments without task access', async () => {
    const own = await workspace(owner), colleague = await workspace(deputy), departmentHead = await workspace(head), other = await workspace(foreign), administrator = await workspace(admin);
    assert.deepEqual(own.organizationDivision.departments, colleague.organizationDivision.departments);
    assert.deepEqual(own.organizationDivision.departments, departmentHead.organizationDivision.departments);
    assert.deepEqual(other.organizationDivision.departments, own.organizationDivision.departments);
    assert.notEqual(own.currentUser.departmentId, other.currentUser.departmentId);
    assert.deepEqual(new Set(administrator.organizationDivision.departments.map(department => department.id)), new Set(administrator.departments.map(department => department.id)));
    assert.deepEqual(administrator.organizationDivision.departments, own.organizationDivision.departments);
    assert.equal(other.tasks.some(item => item.id === task.id), false);
    assert.equal(other.organizationDivision.departments.flatMap(department => department.people).flatMap(person => person.units).flatMap(unit => unit.tasks).some(item => item.id === task.id), true);
    const row = own.organizationDivision.departments.flatMap(department => department.people).flatMap(person => person.units).flatMap(unit => unit.tasks).find(item => item.id === task.id);
    assert.ok(row); assert.ok(row.delegates.some(person => person.id === deputy));
    assert.equal('description' in row, false); assert.equal('code' in row, false);
  });
  for (const format of ['xlsx', 'pdf']) await check(`${format.toUpperCase()} export returns a private downloadable file with the expected signature`, async () => {
    await request(`/api/organization-division/export?format=${format}&departmentId=${task.departmentId}`, { user: foreign, binary: true });
    const { response, bytes } = await request(`/api/organization-division/export?format=${format}`, { user: foreign, binary: true });
    assert.match(response.headers.get('content-type'), format === 'pdf' ? /application\/pdf/ : /spreadsheetml/);
    assert.match(response.headers.get('content-disposition'), /attachment;.*filename/); assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal(bytes.subarray(0, format === 'pdf' ? 5 : 2).toString(), format === 'pdf' ? '%PDF-' : 'PK'); assert.ok(bytes.length > 500);
    const destination = path.join(qa, `description-delegation-division.${format}`); await writeFile(destination, bytes); output.files[format] = destination;
  });
  output.success = true; await save(); console.log(JSON.stringify({ success: true, checks: log.length, taskId: output.taskId, delegationId: output.delegationId, aiRequests: output.aiRequests, summaryPath }));
} catch (error) { output.success = false; output.error = error instanceof Error ? error.message : String(error); await save(); throw error; }

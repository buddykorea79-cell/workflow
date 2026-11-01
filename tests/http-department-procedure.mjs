import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.argv[2] || 'http://127.0.0.1:3001';
const origin = new URL(base);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname));
assert.equal(origin.port, '3001', 'Use the isolated copied store only.');
const cookies = new Map();
let count = 0;
function check(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
async function request(path, { user, method = 'GET', body, expected = 200 } = {}) {
  const response = await fetch(base + path, { method, headers: { Origin: origin.origin, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(user ? { Cookie: cookies.get(user) || '' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data).slice(0, 500));
  return { data, response };
}
async function login(id) { const result = await request('/api/session', { method: 'POST', body: { userId: id } }); cookies.set(id, result.response.headers.get('set-cookie').split(';')[0]); return result.data; }
async function command(user, type, payload, expected = 200) { const { data: state } = await request('/api/workspace', { user }); return (await request('/api/commands', { user, method: 'POST', expected, body: { type, payload, expectedRevision: state.revision, requestId: randomUUID() } })).data; }
function pdfBytes() {
  const stream = 'BT /F1 14 Tf 50 760 Td (1. Prepare budget application) Tj 0 -24 Td (2. Review evidence and approve) Tj 0 -24 Td (3. Submit the final report) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let result = '%PDF-1.4\n'; const offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(result)); result += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
  const start = Buffer.byteLength(result); result += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(value => String(value).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(result);
}
const employee = 'u-support-member', head = 'u-support-head', admin = 'u-support-admin';
let workspace = await login(employee); await login(head); await login(admin); const budget = await login('u-jiho');
check('Employees receive their own department personnel and privileges only', () => { assert.ok(workspace.users.every(user => user.departmentId === 'dept-support')); assert.equal(workspace.departments.length, 1); });
check('Common summary keeps cross-department names without privileges or contacts', () => { assert.ok(budget.commonTasks.some(common => common.distributions.some(d => d.departmentId === 'dept-support'))); for (const person of budget.identities) { assert.equal(person.role, undefined); assert.equal(person.commonTaskPermission, undefined); assert.equal(person.email, undefined); } });
const directory = (await request('/api/session', { user: employee })).data;
check('Authenticated demo directory is scoped and omits contacts', () => { assert.ok(directory.users.every(user => user.departmentId === 'dept-support')); assert.ok(directory.users.every(user => user.email === undefined && user.phone === undefined)); });
const all = (await request('/api/workspace', { user: admin })).data;
check('Administrator can inspect all departments and roles', () => { assert.equal(all.departments.length, 3); assert.ok(new Set(all.users.map(user => user.departmentId)).size === 3); assert.ok(all.users.every(user => user.role)); });
const task = workspace.tasks.find(task => task.primaryId === employee && !task.commonId && !task.deletedAt && task.status !== 'archived'); assert.ok(task);
async function extract(user, expected = 200, bytes = pdfBytes()) { const form = new FormData(); form.set('taskId', task.id); form.set('file', new Blob([bytes], { type: 'application/pdf' }), 'budget-procedure.pdf'); return (await request('/api/procedure-extract', { user, method: 'POST', body: form, expected })).data; }
const extracted = await extract(employee);
check('PDF body is actually extracted with page provenance', () => { assert.equal(extracted.pageCount, 1); assert.match(extracted.text, /Prepare budget application/); assert.equal(extracted.pages[0].page, 1); });
await extract(undefined, 401); await extract('u-jiho', 403); await extract(employee, 415, Buffer.from('not a PDF'));
check('PDF extraction enforces session, task access and actual PDF signature', () => {});
const deniedHead = await command(head, 'unit.create', { title: '부서장 개인업무 금지 검증', description: '검증' }, 403);
check('Head cannot create personal work', () => assert.equal(deniedHead.code, 'HEAD_REGISTRATION_DENIED'));
const forbidden = await command(head, 'department.confirm', { departmentId: 'dept-plan' }, 403);
check('Head cannot confirm another department', () => assert.equal(forbidden.code, 'OUTSIDE_SCOPE'));
workspace = await command(head, 'department.confirm', {});
const confirmed = workspace.departmentWorkPlans.find(plan => plan.departmentId === 'dept-support');
check('Head confirms division with a durable snapshot', () => { assert.equal(confirmed.status, 'confirmed'); assert.ok(confirmed.snapshot.tasks.length); assert.equal(confirmed.history.length, 1); });
for (const [type, payload] of [['unit.create', { title: '차단 검증', description: '검증' }], ['task.configure', { taskId: task.id, description: '차단 검증' }], ['task.delete', { taskId: task.id }]]) { const result = await command(employee, type, payload, 409); assert.equal(result.code, 'DEPARTMENT_CONFIRMED'); }
await extract(employee, 409);
check('Confirmed division rejects structural edits and PDF draft generation', () => {});
workspace = (await request('/api/workspace', { user: employee })).data;
const next = workspace.tasks.filter(t => t.primaryId === employee).flatMap(t => t.workflow.filter(step => !step.done && step.role !== 'reviewer' && step.dependsOn.every(id => t.workflow.find(old => old.id === id)?.done)).map(step => ({ t, step })))[0]; assert.ok(next);
workspace = await command(employee, 'task.setProgress', { taskId: next.t.id, stepId: next.step.id, done: true });
check('Execution can continue while the division is confirmed', () => assert.ok(workspace.tasks.find(t => t.id === next.t.id).workflow.find(step => step.id === next.step.id).done));
workspace = await command(head, 'department.reopen', { reason: 'PDF 절차와 업무분장 수정 검증' });
check('Head reopens editing and preserves the previous confirmed snapshot', () => { const plan = workspace.departmentWorkPlans.find(plan => plan.departmentId === 'dept-support'); assert.equal(plan.status, 'draft'); assert.equal(plan.history.length, 1); assert.equal(plan.reason, 'PDF 절차와 업무분장 수정 검증'); });
workspace = await command(employee, 'unit.create', { title: `재작성 허용 확인 ${randomUUID().slice(0, 6)}`, description: '격리 저장소 검증용 단위업무' });
check('Employee can edit again after reopening', () => assert.ok(workspace.units.some(unit => unit.title.startsWith('재작성 허용 확인'))));
console.log(JSON.stringify({ success: true, checks: count }));

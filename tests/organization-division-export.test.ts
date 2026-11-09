import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { NextRequest } from 'next/server';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createSeed } from '../src/lib/seed';
import { buildOrganizationDivision, filterOrganizationDivision, type OrganizationDivisionReadModel } from '../src/lib/organization-division';
import { exportOrganizationDivisionPdf, exportOrganizationDivisionXlsx } from '../src/lib/organization-division-export';
import { signSession } from '../src/lib/auth';
import { GET } from '../src/app/api/organization-division/export/route';
import { GET as downloadAttachment } from '../src/app/api/attachments/[id]/route';

const now = new Date('2026-11-06T03:00:00Z');

async function attachmentText(bytes: Buffer, format: 'xlsx' | 'pdf') {
  if (format === 'xlsx') {
    const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as never);
    return JSON.stringify(book.getWorksheet(1)!.getSheetValues());
  }
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    let text = '';
    for (let page = 1; page <= pdf.numPages; page++) text += (await (await pdf.getPage(page)).getTextContent()).items.map(item => 'str' in item ? item.str : '').join('');
    return text;
  } finally { await loading.destroy(); }
}

test('Excel is a real workbook with four Korean columns and literal user-entered text', async () => {
  const model = buildOrganizationDivision(createSeed(now), now);
  const department = model.departments.find(item => item.people.some(person => person.units.some(unit => unit.tasks.length)))!;
  const task = department.people.flatMap(person => person.units.flatMap(unit => unit.tasks))[0];
  task.title = '=HYPERLINK("https://example.com","수식으로 실행하지 않음")';
  const filtered = filterOrganizationDivision(model, { departmentId: department.id });
  const bytes = await exportOrganizationDivisionXlsx(filtered, { departmentId: department.id });
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0]; assert.equal(sheet.columnCount, 4);
  assert.deepEqual((sheet.getRow(4).values as ExcelJS.CellValue[]).slice(1), ['담당자', '단위업무', '세부업무', '업무대행자']);
  const titleCell = sheet.getColumn(3).values.find(value => value === task.title); assert.equal(titleCell, task.title);
  sheet.eachRow(row => row.eachCell(cell => assert.notEqual(cell.type, ExcelJS.ValueType.Formula)));
  const contents = JSON.stringify(sheet.getSheetValues());
  assert.ok(contents.includes(department.name)); assert.equal(contents.includes('WK-'), false);
  assert.equal(contents.includes('@ieum.example'), false);
});

test('PDF embeds Korean text and paginates long task names without losing the final text', async () => {
  const longTitle = `${'한글 업무 내용과 부서별 수행 절차를 빠짐없이 표시합니다. '.repeat(190)}마지막한글검증문구`;
  const model: OrganizationDivisionReadModel = { generatedAt: now.toISOString(), departments: [{ id: 'dept', name: '한글 부서', shortName: '한글', people: [{ id: 'person', name: '홍길동', team: '운영팀', units: [{ id: 'unit', title: '긴 단위업무', tasks: [{ id: 'task', title: longTitle, delegates: [{ id: 'deputy', name: '김대행', team: '운영팀', startsAt: '2026-11-01', endsAt: '2026-12-01' }] }] }] }] }] };
  const bytes = await exportOrganizationDivisionPdf(model);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pdf = await loading.promise;
  try {
    assert.ok(pdf.numPages > 1);
    let extracted = '';
    for (let page = 1; page <= pdf.numPages; page++) { const content = await (await pdf.getPage(page)).getTextContent(); extracted += content.items.map(item => 'str' in item ? item.str : '').join(''); }
    for (const text of ['업무분장표', '한글 부서', '홍길동', '김대행', '마지막한글검증문구']) assert.ok(extracted.includes(text), `Missing Korean text: ${text}`);
  } finally { await loading.destroy(); }
});

test('all roles default exports to their department and can export a filtered foreign division without private data', async () => {
  const qaRoot = path.resolve(process.cwd(), '.qa-data'); await mkdir(qaRoot, { recursive: true });
  const directory = await mkdtemp(path.join(qaRoot, 'organization-export-test-'));
  const keys = ['DATABASE_URL', 'NEON_AUTH_BASE_URL', 'VERCEL', 'IEUM_DATA_DIR', 'IEUM_SESSION_SECRET', 'IEUM_STORE'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.DATABASE_URL = ''; process.env.NEON_AUTH_BASE_URL = ''; process.env.VERCEL = ''; process.env.IEUM_DATA_DIR = directory; process.env.IEUM_SESSION_SECRET = 'isolated-organization-export-test-secret'; process.env.IEUM_STORE = 'local';
  try {
    const state = createSeed();
    const privateTask = state.tasks.find(task => task.id === 'task-data')!;
    privateTask.description = 'PRIVATE-TASK-BODY'; privateTask.references = [{ id: 'private-reference', type: 'document', title: 'PRIVATE-DOCUMENT-TITLE', content: 'PRIVATE-DOCUMENT-CONTENT', attachmentId: 'private-file' }];
    state.attachments.push({ id: 'private-file', taskId: privateTask.id, name: 'PRIVATE-FILE-NAME.txt', size: 10, mime: 'text/plain', sha256: 'private-hash', storageKey: 'private-object', status: 'test_allowed', uploadedBy: privateTask.primaryId, createdAt: new Date().toISOString() });
    await writeFile(path.join(directory, 'workspace.json'), JSON.stringify(state), 'utf8');
    const endpoint = 'http://127.0.0.1:3001/api/organization-division/export';
    assert.equal((await GET(new NextRequest(`${endpoint}?format=xlsx`))).status, 401);
    const model = buildOrganizationDivision(state);
    const foreignDepartment = model.departments.find(item => item.id === privateTask.departmentId)!;
    const foreignOwner = foreignDepartment.people.find(person => person.id === privateTask.primaryId)!;
    for (const role of ['member', 'lead', 'manager', 'head', 'admin']) {
      const user = state.users.find(item => item.departmentId === 'dept-plan' && item.role === role)!;
      const headers = { Cookie: `ieum_demo_session=${signSession(user.id)}` };
      assert.equal((await GET(new NextRequest(`${endpoint}?format=csv`, { headers }))).status, 422);
      assert.equal((await GET(new NextRequest(`${endpoint}?format=xlsx&departmentId=missing`, { headers }))).status, 422);
      for (const format of ['xlsx', 'pdf'] as const) {
        const ownResponse = await GET(new NextRequest(`${endpoint}?format=${format}`, { headers }));
        assert.equal(ownResponse.status, 200); assert.match(ownResponse.headers.get('content-disposition')!, /attachment;.*filename\*=UTF-8''/); assert.equal(ownResponse.headers.get('cache-control'), 'no-store, private');
        const ownText = await attachmentText(Buffer.from(await ownResponse.arrayBuffer()), format);
        assert.ok(ownText.includes(state.departments.find(item => item.id === user.departmentId)!.name));
        assert.equal(ownText.includes(foreignDepartment.name), false);
        const query = new URLSearchParams({ format, departmentId: foreignDepartment.id, team: foreignOwner.team, name: foreignOwner.name });
        const response = await GET(new NextRequest(`${endpoint}?${query}`, { headers }));
        assert.equal(response.status, 200);
        const text = await attachmentText(Buffer.from(await response.arrayBuffer()), format);
        assert.ok(text.includes(foreignDepartment.name)); assert.ok(text.includes(privateTask.title));
        assert.equal(text.includes('PRIVATE-'), false);
        const excluded = foreignDepartment.people.find(person => person.id !== foreignOwner.id && person.units.some(unit => unit.tasks.length));
        assert.ok(excluded); assert.equal(text.includes(excluded.name), false);
      }
      const allResponse = await GET(new NextRequest(`${endpoint}?format=xlsx&departmentId=all`, { headers }));
      assert.equal(allResponse.status, 200);
      const allText = await attachmentText(Buffer.from(await allResponse.arrayBuffer()), 'xlsx');
      assert.equal(allText.includes(foreignDepartment.name), role === 'admin');
      if (role !== 'admin') {
        const fileResponse = await downloadAttachment(new NextRequest('http://127.0.0.1:3001/api/attachments/private-file', { headers }), { params: Promise.resolve({ id: 'private-file' }) });
        assert.equal(fileResponse.status, 403); assert.equal((await fileResponse.json()).code, 'DOWNLOAD_DENIED');
      }
    }
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.ok(path.resolve(directory).startsWith(qaRoot + path.sep)); await rm(directory, { recursive: true, force: true });
  }
});

import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { organizationDivisionRows, type OrganizationDivisionFilters, type OrganizationDivisionReadModel } from './organization-division';

const columns = ['담당자', '단위업무', '세부업무', '업무대행자'];
const colors = { ink: '172B4D', muted: '52637A', blue: '1863DC', line: 'DCE4EE', pale: 'EFF5FF' };
const exportDate = (model: OrganizationDivisionReadModel) => new Date(model.generatedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
function filterLabel(model: OrganizationDivisionReadModel, filters: OrganizationDivisionFilters) {
  const department = !filters.departmentId || filters.departmentId === 'all' ? '전체 부서' : model.departments.find(item => item.id === filters.departmentId)?.name || '선택 부서';
  return `${department} · ${!filters.team || filters.team === 'all' ? '전체 팀' : filters.team} · ${filters.name?.trim() ? `담당자: ${filters.name.trim()}` : '전체 담당자'}`;
}

export async function exportOrganizationDivisionXlsx(model: OrganizationDivisionReadModel, filters: OrganizationDivisionFilters = {}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook(); workbook.creator = '온이음'; workbook.created = new Date(model.generatedAt); workbook.modified = new Date(model.generatedAt);
  const sheet = workbook.addWorksheet('업무분장표', { views: [{ state: 'frozen', ySplit: 4 }], pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '4:4' } });
  sheet.columns = [{ width: 22 }, { width: 38 }, { width: 67 }, { width: 28 }];
  sheet.mergeCells('A1:D1'); sheet.getCell('A1').value = '온이음 · 전체 업무분장표'; sheet.getRow(1).height = 38; sheet.getCell('A1').font = { name: '맑은 고딕', size: 20, bold: true, color: { argb: colors.ink } };
  sheet.mergeCells('A2:D2'); sheet.getCell('A2').value = filterLabel(model, filters); sheet.getRow(2).height = 27;
  sheet.mergeCells('A3:D3'); sheet.getCell('A3').value = `조회 ${exportDate(model)} · 현재 승인·기간이 유효한 업무대행자만 표시`; sheet.getRow(3).height = 27;
  for (const number of [2, 3]) sheet.getRow(number).font = { name: '맑은 고딕', size: 11, color: { argb: colors.muted } };
  const header = sheet.getRow(4); header.values = columns; header.height = 30; header.font = { name: '맑은 고딕', size: 12, bold: true, color: { argb: colors.ink } }; header.alignment = { vertical: 'middle' }; header.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colors.pale } }; });
  const rows = organizationDivisionRows(model);
  for (const department of model.departments) {
    const section = sheet.addRow([department.name]); sheet.mergeCells(section.number, 1, section.number, 4); section.height = 30; section.font = { name: '맑은 고딕', size: 12, bold: true, color: { argb: colors.blue } }; section.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F4F7FC' } };
    const departmentRows = rows.filter(row => row.departmentId === department.id);
    let personStart = 0, unitStart = 0, previousPerson = '', previousUnit = '';
    const merge = (start: number, end: number, column: number) => { if (start && end > start) sheet.mergeCells(start, column, end, column); };
    for (const item of departmentRows) {
      const row = sheet.addRow([`${item.person}\n${item.team || '팀 미지정'}`, item.unit, item.task, item.delegate]);
      row.font = { name: '맑은 고딕', size: 11, color: { argb: colors.ink } }; row.alignment = { vertical: 'top', wrapText: true };
      row.height = Math.min(400, Math.max(46, 18 * Math.max(2, Math.ceil(item.task.length / 32), Math.ceil(item.unit.length / 18), Math.ceil(item.delegate.length / 13))));
      row.eachCell(cell => { cell.border = { bottom: { style: 'thin', color: { argb: colors.line } }, right: { style: 'hair', color: { argb: colors.line } } }; });
      if (previousPerson !== item.personId) { merge(personStart, row.number - 1, 1); personStart = row.number; }
      if (previousPerson !== item.personId || previousUnit !== item.unitId) { merge(unitStart, row.number - 1, 2); unitStart = row.number; }
      previousPerson = item.personId; previousUnit = item.unitId;
    }
    merge(personStart, sheet.rowCount, 1); merge(unitStart, sheet.rowCount, 2);
    if (!departmentRows.length) { const row = sheet.addRow(['조회 조건에 해당하는 등록 업무가 없습니다.']); sheet.mergeCells(row.number, 1, row.number, 4); row.font = { name: '맑은 고딕', size: 11, color: { argb: colors.muted } }; row.height = 30; }
  }
  sheet.headerFooter.oddFooter = '&L온이음 업무분장표&R&P / &N';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Embed a static OFL Korean font; requires no system fonts or browser. */
export async function exportOrganizationDivisionPdf(model: OrganizationDivisionReadModel, filters: OrganizationDivisionFilters = {}): Promise<Buffer> {
  const font = await readFile(path.join(process.cwd(), 'public', 'fonts', 'Pretendard-Regular.otf'));
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, autoFirstPage: false, bufferPages: true, info: { Title: '온이음 전체 업무분장표', Author: '온이음', CreationDate: new Date(model.generatedAt) } });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => { doc.on('data', chunk => chunks.push(Buffer.from(chunk))); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  doc.registerFont('Korean', font); doc.font('Korean');
  const widths = [104, 174, 320, 172];
  const left = 36, right = left + widths.reduce((sum, width) => sum + width, 0), lineHeight = 15;
  let y = 0, pageNumber = 0, currentDepartment = '';
  const text = (value: string, x: number, top: number, size = 10.5, color = colors.ink) => { doc.fontSize(size).fillColor(`#${color}`).text(value, x, top, { lineBreak: false }); };
  const newPage = (department: string, continued = false) => {
    doc.addPage(); pageNumber++;
    text('온이음 · 전체 업무분장표', left, 27, 19);
    doc.fontSize(9).fillColor(`#${colors.muted}`).text(filterLabel(model, filters), left, 55, { width: right - left, height: 25, ellipsis: true });
    text(`조회 ${exportDate(model)}`, left, 82, 9, colors.muted);
    text(`${pageNumber}`, right - 18, doc.page.height - 25, 9, colors.muted);
    y = 106; currentDepartment = department;
    doc.rect(left, y, right - left, 28).fill('#EFF5FF'); text(`${department}${continued ? ' · 계속' : ''}`, left + 10, y + 6, 11.5, colors.blue); y += 28;
    drawHeader();
  };
  const drawHeader = () => {
    doc.rect(left, y, right - left, 28).fill('#F4F7FC');
    let x = left; columns.forEach((column, index) => { text(column, x + 10, y + 6, 10.5); x += widths[index]; });
    y += 28; doc.moveTo(left, y).lineTo(right, y).strokeColor('#DCE4EE').lineWidth(.6).stroke();
  };
  const wrap = (value: string, width: number) => {
    doc.fontSize(10.5);
    const lines: string[] = []; let line = '';
    for (const char of value) {
      if (char === '\n') { lines.push(line); line = ''; continue; }
      if (line && doc.widthOfString(line + char) > width) { lines.push(line); line = char; } else line += char;
    }
    lines.push(line); return lines;
  };
  const drawRow = (values: string[]) => {
    const wrapped = values.map((value, index) => wrap(value, widths[index] - 20));
    const maxLines = Math.max(...wrapped.map(lines => lines.length)); let offset = 0;
    // Keep an ordinary row together; only unusually long cells span pages.
    const rowHeight = maxLines * lineHeight + 20;
    const pageBodyHeight = doc.page.height - 45 - 162;
    if (rowHeight <= pageBodyHeight && y + rowHeight > doc.page.height - 45) newPage(currentDepartment, true);
    while (offset < maxLines) {
      if (doc.page.height - 45 - y < 20 + lineHeight) newPage(currentDepartment, true);
      const count = Math.min(maxLines - offset, Math.floor((doc.page.height - 45 - y - 20) / lineHeight));
      const height = count * lineHeight + 20; let x = left;
      wrapped.forEach((lines, column) => {
        const visible = lines.slice(offset, offset + count);
        if (offset && column < 2 && !visible.length) visible.push(lines[0]);
        visible.forEach((line, index) => text(line, x + 10, y + 9 + index * lineHeight));
        doc.moveTo(x, y).lineTo(x, y + height).strokeColor('#E5EBF3').lineWidth(.4).stroke(); x += widths[column];
      });
      doc.moveTo(right, y).lineTo(right, y + height).strokeColor('#E5EBF3').lineWidth(.4).stroke();
      y += height; doc.moveTo(left, y).lineTo(right, y).strokeColor('#DCE4EE').lineWidth(.5).stroke(); offset += count;
    }
  };
  try {
    const rows = organizationDivisionRows(model);
    for (const department of model.departments) {
      newPage(department.name);
      const departmentRows = rows.filter(row => row.departmentId === department.id);
      for (const row of departmentRows) drawRow([`${row.person}\n${row.team || '팀 미지정'}`, row.unit, row.task, row.delegate]);
      if (!departmentRows.length) drawRow(['—', '—', '조회 조건에 해당하는 등록 업무가 없습니다.', '—']);
    }
    if (!model.departments.length) { newPage('조회 결과'); drawRow(['—', '—', '조회 조건에 해당하는 등록 업무가 없습니다.', '—']); }
    doc.end();
  } catch (error) { doc.destroy(); throw error; }
  return result;
}

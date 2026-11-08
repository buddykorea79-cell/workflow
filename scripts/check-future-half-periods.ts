import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { currentHalf, isFutureHalf } from '../src/lib/period';

class DiagnosticError extends Error {}
type JsonRecord = Record<string, unknown>;
type Options = { file?: string; neon: boolean; workspaceId?: string; now: Date; help: boolean };
const halfPattern = /^20\d{2}-H[12]$/;
const asRecord = (value: unknown): JsonRecord | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;

function options(args: string[]): Options {
  const parsed: Options = { neon: false, now: new Date(), help: args.length === 0 };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (seen.has(key)) throw new DiagnosticError('같은 옵션을 중복해서 지정할 수 없습니다.');
    seen.add(key);
    if (key === '--help') { parsed.help = true; continue; }
    if (key === '--neon') { parsed.neon = true; continue; }
    if (!['--file', '--workspace-id', '--now'].includes(key)) throw new DiagnosticError('--file, --neon, --workspace-id, --now, --help만 사용할 수 있습니다.');
    const value = args[++index];
    if (!value || value.startsWith('--')) throw new DiagnosticError('옵션의 값을 입력해 주세요.');
    if (key === '--file') parsed.file = value;
    if (key === '--workspace-id') parsed.workspaceId = value.trim();
    if (key === '--now') {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new DiagnosticError('--now는 시간대가 포함된 ISO 날짜로 입력해 주세요.');
      parsed.now = new Date(value);
    }
  }
  if (parsed.help) return parsed;
  if (!!parsed.file === parsed.neon) throw new DiagnosticError('--file <기존 JSON 파일> 또는 --neon 중 하나만 지정해 주세요.');
  if (parsed.neon && (!parsed.workspaceId || parsed.workspaceId.length > 200)) throw new DiagnosticError('Neon 조회에는 --workspace-id를 명시해 주세요.');
  if (!parsed.neon && parsed.workspaceId) throw new DiagnosticError('--workspace-id는 --neon과 함께 사용해 주세요.');
  return parsed;
}

async function readExisting(input: Options): Promise<unknown> {
  if (input.file) {
    let raw: string;
    try { raw = await readFile(path.resolve(input.file), 'utf8'); }
    catch { throw new DiagnosticError('지정한 기존 JSON 파일을 읽을 수 없습니다. 경로와 읽기 권한을 확인해 주세요. 새 파일은 생성하지 않습니다.'); }
    try { return JSON.parse(raw); }
    catch { throw new DiagnosticError('지정한 파일이 올바른 JSON이 아닙니다. 파일 내용은 출력하지 않습니다.'); }
  }
  if (!process.env.DATABASE_URL?.trim()) throw new DiagnosticError('Neon 조회에는 DATABASE_URL 설정이 필요합니다. 연결값은 출력하지 않습니다.');
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL);
    // Explicit SELECT only: no initialization, FOR UPDATE, transaction,
    // migrations, seed creation, archive, or data correction.
    const rows = await sql`SELECT data FROM ieum_workspaces WHERE id = ${input.workspaceId}`;
    if (!rows[0]) throw new DiagnosticError('해당 워크스페이스가 없습니다. 테이블이나 데이터를 생성하지 않았습니다.');
    return rows[0].data;
  } catch (error) {
    if (error instanceof DiagnosticError) throw error;
    throw new DiagnosticError('Neon 읽기 진단에 실패했습니다. 연결·조회 권한과 workspace-id를 확인해 주세요. 공급자 오류나 연결값은 출력하지 않습니다.');
  }
}

function report(value: unknown, now: Date) {
  const state = asRecord(value);
  if (!state || !Array.isArray(state.performances) || ['unitScorePlans', 'unitEvaluations'].some(key => state[key] !== undefined && !Array.isArray(state[key]))) throw new DiagnosticError('성과·업무 비중·평가 배열이 있는 워크스페이스 JSON인지 확인해 주세요.');
  const future = (key: string, personKey: string) => ((state[key] ?? []) as unknown[]).flatMap(value => {
    const record = asRecord(value);
    if (!record || typeof record.period !== 'string' || !halfPattern.test(record.period) || !isFutureHalf(record.period, now)) return [];
    const metadata: JsonRecord = { period: record.period };
    // Whitelist identifiers/status only; never emit descriptions, evidence,
    // attachments, contacts, document contents, or connection settings.
    for (const field of ['id', 'taskId', 'departmentId', 'status']) if (typeof record[field] === 'string') metadata[field] = record[field];
    if (typeof record[personKey] === 'string') metadata.personId = record[personKey];
    return [metadata];
  });
  const records = { performances: future('performances', 'authorId'), unitScorePlans: future('unitScorePlans', 'personId'), unitEvaluations: future('unitEvaluations', 'personId') };
  const counts = { performances: records.performances.length, unitScorePlans: records.unitScorePlans.length, unitEvaluations: records.unitEvaluations.length };
  return { checkedAt: now.toISOString(), currentHalf: currentHalf(now), counts, futurePeriods: [...new Set(Object.values(records).flat().map(record => String(record.period)))].sort(), records };
}

async function main() {
  const input = options(process.argv.slice(2));
  if (input.help) {
    console.log(JSON.stringify({ readOnly: true, usage: ['node --import tsx scripts/check-future-half-periods.ts --file <existing-workspace.json>', 'node --env-file=.env.local --import tsx scripts/check-future-half-periods.ts --neon --workspace-id <explicit-id>'], optional: '--now <ISO timestamp with timezone>: 합성 데이터의 날짜 경계 검사', note: '사용자가 직접 실행하는 읽기 전용 진단입니다. 데이터를 생성·수정·삭제하지 않습니다. 인자가 없으면 연결하지 않고 도움말만 출력합니다.' }, null, 2));
    return;
  }
  console.log(JSON.stringify({ readOnly: true, source: input.neon ? 'neon' : 'file', ...report(await readExisting(input), input.now) }, null, 2));
}

main().catch(error => {
  console.error(JSON.stringify({ error: error instanceof DiagnosticError ? error.message : '진단을 완료하지 못했습니다. 원본 데이터는 변경하지 않았습니다.' }));
  process.exitCode = 1;
});

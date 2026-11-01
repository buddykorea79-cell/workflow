import { applyBudgetDemo } from '../src/lib/budget-demo';
import { dataDirectory, transaction } from '../src/lib/store';
import { access } from 'node:fs/promises';
import path from 'node:path';

async function main() {
  if (process.env.DATABASE_URL || process.env.VERCEL) throw new Error('예산 시연 보충 스크립트는 기존 로컬 데이터 전용입니다. DATABASE_URL 또는 VERCEL 환경에서는 실행할 수 없습니다.');
  const directory = dataDirectory();
  await access(path.join(directory, 'workspace.json')).catch(() => { throw new Error(`기존 로컬 workspace.json을 찾을 수 없습니다: ${directory}. 새 저장소는 앱의 초기 시드에서 예산 예시를 제공합니다.`); });
  const result = await transaction(state => applyBudgetDemo(state));
  console.log(JSON.stringify({ storage: directory, ...result }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : '예산 시연 자료를 추가하지 못했습니다.'); process.exitCode = 1; });

import { randomUUID } from 'node:crypto';
import { transaction } from '../src/lib/store';
import { executeCommand } from '../src/lib/domain';
import { getBudgetCatalog } from '../src/lib/budget-catalog';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Neon DATABASE_URL을 설정한 환경에서 실행해 주세요.');
  const apply = process.argv.includes('--apply');
  const result = await transaction(state => {
    if (state.budgetCatalog) return { applied: false, reason: 'existing-catalog-preserved', count: state.budgetCatalog.items.length };
    const catalog = getBudgetCatalog(state);
    const summary = { year: catalog.year, count: catalog.items.length, totalConfirmedAmountWon: catalog.items.reduce((sum, item) => sum + item.confirmedAmountWon, 0) };
    if (!apply) return { applied: false, reason: 'dry-run', ...summary };
    const admin = state.users.find(user => user.role === 'admin' && user.active && (!user.endsAt || new Date(user.endsAt) > new Date()));
    if (!admin) throw new Error('예산 원장을 등록할 활성 관리자 계정이 없습니다.');
    executeCommand(state, admin.id, { type: 'budget.import', payload: { catalog }, expectedRevision: state.revision, requestId: randomUUID() });
    return { applied: true, ...summary };
  });
  console.log(JSON.stringify(result, null, 2));
}
main().catch(() => { console.error('예산 원장 이관에 실패했습니다. DB 연결과 관리자 계정, 카탈로그 검증 결과를 확인해 주세요.'); process.exitCode = 1; });

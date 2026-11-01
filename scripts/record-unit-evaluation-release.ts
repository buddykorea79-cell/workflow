import { access } from 'node:fs/promises';
import path from 'node:path';
import { executeCommand } from '../src/lib/domain';
import { dataDirectory, transaction } from '../src/lib/store';

const release = {
  version: '0.6.0',
  title: '부서 업무 계층 조회와 개인별 50점 평가',
  notes: '팀·직원·단위업무·세부업무를 한 화면에 연결하고 세부업무 상세를 조회합니다. 반기 성과를 개인별로 모아 보고, 개인이 설정한 단위업무별 배점 합계 50점 안에서 부서장이 평가합니다. 평가 당시의 배점과 성과 근거를 함께 보존합니다.',
};

async function main() {
  if (process.env.DATABASE_URL || process.env.VERCEL) {
    throw new Error('이 유지보수 스크립트는 기존 로컬 워크스페이스에서만 실행할 수 있습니다.');
  }
  await access(path.join(dataDirectory(), 'workspace.json'));
  const result = await transaction(state => {
    const existing = state.releases?.find(item => item.version === release.version);
    if (existing) return { version: release.version, recorded: false, revision: state.revision };
    const now = new Date();
    const admin = state.users.find(user => user.role === 'admin' && user.active && (!user.endsAt || new Date(user.endsAt) > now));
    if (!admin) throw new Error('릴리스를 기록할 활성 관리자 계정이 없습니다.');
    executeCommand(state, admin.id, {
      type: 'admin.release',
      payload: release,
      expectedRevision: state.revision,
      requestId: 'maintenance-demo-release-0.6.0',
    }, now);
    return { version: release.version, recorded: true, revision: state.revision };
  });
  console.log(JSON.stringify(result));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : '릴리스 기록에 실패했습니다.');
  process.exitCode = 1;
});

import { access } from 'node:fs/promises';
import path from 'node:path';
import { executeCommand } from '../src/lib/domain';
import { dataDirectory, transaction } from '../src/lib/store';

const release = {
  version: '0.7.0',
  title: '반복 업무 회차와 지난 절차 이력',
  notes: '세부업무의 모든 절차를 완료하면 같은 업무 절차에 새 일정을 적용하여 다음 회차를 시작합니다. 지난 회차의 절차·일정·체크리스트·완료자·결과를 보존하고 읽기 전용으로 조회합니다.',
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
      requestId: 'maintenance-demo-release-0.7.0',
    }, now);
    return { version: release.version, recorded: true, revision: state.revision };
  });
  console.log(JSON.stringify(result));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : '릴리스 기록에 실패했습니다.');
  process.exitCode = 1;
});

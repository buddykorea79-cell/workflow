import { access } from 'node:fs/promises';
import path from 'node:path';
import { executeCommand } from '../src/lib/domain';
import { dataDirectory, transaction } from '../src/lib/store';

const release = {
  version: '0.4.1',
  title: '부서별 로그인과 예산 업무 시연',
  notes: '일반 역할은 데이터정보화담당관실 계정을 기본 선택하고, 공통업무 담당은 기획재정담당관실 예산담당 주무관으로 시연합니다. 기획재정담당관실 박주무관은 개인 담당자 역할의 예산담당 주무관으로 공통업무 관리 권한을 함께 갖습니다. 기획재정·데이터정보화 부서의 예산 단위업무·세부업무와 공통 예산업무 예시를 보충했습니다. 공통업무 관리와 부서·팀 배정 권한을 구분하며 기존 업무를 보존하고 같은 데모 항목의 중복 생성을 방지합니다.',
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
      requestId: 'maintenance-demo-release-0.4.1',
    }, now);
    return { version: release.version, recorded: true, revision: state.revision };
  });
  console.log(JSON.stringify(result));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : '릴리스 기록에 실패했습니다.');
  process.exitCode = 1;
});

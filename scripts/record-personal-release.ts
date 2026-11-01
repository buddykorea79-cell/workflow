import { access } from 'node:fs/promises';
import path from 'node:path';
import { executeCommand } from '../src/lib/domain';
import { dataDirectory, transaction } from '../src/lib/store';

const release = {
  version: '0.3.0',
  title: '단위업무와 세부업무를 명확하게',
  notes: '단위업무는 업무 묶음, 세부업무는 실행 과제로 구분하고 단위업무별로 표시합니다. 본인 단위업무의 추가·수정·삭제·복원과 직접 만든 세부업무의 추가·수정·단위 이동·삭제·복원을 제공합니다. 활성 세부업무가 있는 단위업무의 삭제와 공통업무 원본의 삭제를 보호하며, 배정된 공통업무는 소속 단위업무를 변경할 수 있습니다. 삭제한 항목은 개인업무 휴지통에서 확인하고 복원합니다.',
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
      requestId: 'maintenance-personal-release-0.3.0',
    }, now);
    return { version: release.version, recorded: true, revision: state.revision };
  });
  console.log(JSON.stringify(result));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : '릴리스 기록에 실패했습니다.');
  process.exitCode = 1;
});

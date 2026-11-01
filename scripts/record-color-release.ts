import { access } from 'node:fs/promises';
import path from 'node:path';
import { executeCommand } from '../src/lib/domain';
import { dataDirectory, transaction } from '../src/lib/store';

const release = {
  version: '0.2.1',
  title: '업무 상태를 색으로 더 명확하게',
  notes: '기존 Pretendard 글꼴과 화면 배치·디자인 컨셉을 유지하고 Cohere 디자인 문서를 참고한 녹색·파랑·코랄 강조를 적용했습니다. 선택·완료는 녹색, 진행·안내는 파랑, 기한 경과·확인 필요는 코랄로 구분하며, 밝은 본문과 카드 바탕을 유지했습니다.',
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
      requestId: 'maintenance-color-release-0.2.1',
    }, now);
    return { version: release.version, recorded: true, revision: state.revision };
  });
  console.log(JSON.stringify(result));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : '릴리스 기록에 실패했습니다.');
  process.exitCode = 1;
});

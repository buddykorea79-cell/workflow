import { access } from 'node:fs/promises';
import path from 'node:path';
import { executeCommand } from '../src/lib/domain';
import { dataDirectory, transaction } from '../src/lib/store';

const release = {
  version: '0.5.0',
  title: '부서 업무분장과 자료 기반 흐름도',
  notes: '부서장 전용 업무 요약, 업무분장 일괄 확정·재작성 허용과 변경 잠금, 부서별 조직 조회 및 관리자 전체 권한 확인을 제공합니다. PDF 텍스트·법령·지침 본문에서 근거와 역할이 연결된 절차 초안을 작성하고 검토 후 흐름도로 저장합니다. 스캔 PDF OCR과 외부 AI·법령 자동 조회는 후속 과제입니다.',
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
      requestId: 'maintenance-demo-release-0.5.0',
    }, now);
    return { version: release.version, recorded: true, revision: state.revision };
  });
  console.log(JSON.stringify(result));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : '릴리스 기록에 실패했습니다.');
  process.exitCode = 1;
});

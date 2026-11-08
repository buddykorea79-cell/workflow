import { constants } from 'node:fs';
import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { applyStatisticsDemo, StatisticsDemoError, STATISTICS_DEMO_IDS } from '../src/lib/statistics-demo';
import { dataDirectory, transaction } from '../src/lib/store';
import { resolveStoreMode } from '../src/lib/store-mode';
import { DomainError } from '../src/lib/domain-error';

class SetupError extends Error {}

async function main() {
  const apply = process.argv.includes('--apply');
  const index = process.argv.indexOf('--expect-workspace');
  const expectedWorkspace = index >= 0 ? process.argv[index + 1] : undefined;
  const workspaceId = process.env.IEUM_WORKSPACE_ID?.trim() || 'development';
  const database = resolveStoreMode() === 'neon';
  if (apply && database && expectedWorkspace !== workspaceId) throw new SetupError('DB 적용에는 미리보기의 workspaceId와 같은 --expect-workspace 값을 명시해 주세요.');
  const directory = dataDirectory(); const source = path.join(directory, 'workspace.json');
  if (!database) await access(source).catch(() => { throw new SetupError('기존 로컬 workspace.json이 없습니다. 먼저 앱을 한 번 실행하거나 DB 연결을 설정해 주세요.'); });
  const result = await transaction(async state => {
    const candidate = structuredClone(state); const beforeRevision = state.revision;
    const change = applyStatisticsDemo(candidate); let backup: string | undefined;
    if (apply && change.changed) {
      if (!database) {
        const backupDirectory = path.join(directory, 'backups'); await mkdir(backupDirectory, { recursive: true });
        backup = path.join(backupDirectory, `workspace-before-statistics-${new Date().toISOString().replaceAll(':', '-')}.json`);
        await copyFile(source, backup, constants.COPYFILE_EXCL);
      }
      Object.assign(state, candidate);
    }
    return { mode: apply ? 'apply' : 'preview', storage: database ? 'neon' : 'local', workspaceId, beforeRevision, ...change, ...(backup ? { backup } : {}), scenario: STATISTICS_DEMO_IDS };
  });
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error instanceof SetupError || error instanceof StatisticsDemoError || error instanceof DomainError ? error.message : '통계연보 시연 자료를 준비하지 못했습니다. DB 연결·워크스페이스 초기화 또는 로컬 파일 접근 상태를 확인해 주세요.'); process.exitCode = 1; });

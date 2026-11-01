import { constants } from 'node:fs';
import { access, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { applyOrganizationDemo } from '../src/lib/organization-demo';
import { dataDirectory, transaction } from '../src/lib/store';

async function main() {
  if (process.env.DATABASE_URL || process.env.VERCEL) throw new Error('가상 조직 구성 스크립트는 기존 로컬 데이터 전용입니다. DATABASE_URL 또는 VERCEL 환경에서는 실행할 수 없습니다.');
  const directory = dataDirectory();
  const source = path.join(directory, 'workspace.json');
  await access(source).catch(() => { throw new Error(`기존 로컬 workspace.json을 찾을 수 없습니다: ${directory}. 새 저장소에는 초기 시드에서 가상 조직을 제공합니다.`); });
  const result = await transaction(async state => {
    const updated = structuredClone(state);
    const applied = applyOrganizationDemo(updated);
    if (!applied.changed) return { ...applied, backup: undefined };
    const backupDirectory = path.join(directory, 'backups');
    await mkdir(backupDirectory, { recursive: true });
    const backup = path.join(backupDirectory, `workspace-before-organization-${new Date().toISOString().replaceAll(':', '-')}.json`);
    await copyFile(source, backup, constants.COPYFILE_EXCL);
    Object.assign(state, updated);
    return { ...applied, backup };
  });
  console.log(JSON.stringify({ storage: directory, ...result }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : '가상 조직을 구성하지 못했습니다.'); process.exitCode = 1; });

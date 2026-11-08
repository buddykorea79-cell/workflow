import { neon, Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { eq } from 'drizzle-orm';
import ws from 'ws';
import { workspaces } from './db-schema';
import { DomainError } from './domain-error';
import type { WorkspaceData } from './types';
import { normalizeUnitImportance } from './unit-importance';

neonConfig.webSocketConstructor = ws;
/** HTTP queries carry no request-spanning WebSocket session and need no row lock. */
export async function neonReadState(): Promise<WorkspaceData> {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`SELECT data FROM ieum_workspaces WHERE id = ${process.env.IEUM_WORKSPACE_ID || 'development'}`;
  if (!rows[0]) throw new DomainError(503, 'DATABASE_NOT_INITIALIZED', 'DB 마이그레이션과 검증용 초기 데이터 설치를 먼저 실행해 주세요.');
  return normalizeUnitImportance(rows[0].data as WorkspaceData);
}

export async function neonTransaction<T>(callback: (state: WorkspaceData) => T | Promise<T>): Promise<T> {
  // Keep the existing request-scoped write lifetime until the deployed runtime's
  // pool lifecycle integration is configured and verified. The HTTP read path
  // above needs no WebSocket pool; Edge request-lifetime restrictions do not
  // establish whether a separate Node/Fluid Compute deployment may reuse pools.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL!, max: 1, connectionTimeoutMillis: 10_000 });
  try { const db = drizzle(pool); return await db.transaction(async tx => {
    const rows = await tx.select().from(workspaces).where(eq(workspaces.id, process.env.IEUM_WORKSPACE_ID || 'development')).for('update');
    if (!rows[0]) throw new DomainError(503, 'DATABASE_NOT_INITIALIZED', 'DB 마이그레이션과 검증용 초기 데이터 설치를 먼저 실행해 주세요.');
    const state = normalizeUnitImportance(rows[0].data); const before = JSON.stringify(state); const result = await callback(state); normalizeUnitImportance(state);
    if (JSON.stringify(state) !== before) await tx.update(workspaces).set({ revision: state.revision, data: state, updatedAt: new Date() }).where(eq(workspaces.id, rows[0].id));
    return result;
  }); } finally { await pool.end(); }
}

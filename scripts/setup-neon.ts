import { readFile } from 'node:fs/promises';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { createSeed } from '../src/lib/seed';
async function main() {
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Use a separate development Neon branch.');
if (process.env.IEUM_ALLOW_DEMO_SEED !== 'true') throw new Error('Set IEUM_ALLOW_DEMO_SEED=true to acknowledge this installs fictional development data only.');
neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try { const client = await pool.connect(); try { await client.query('BEGIN'); await client.query(await readFile('drizzle/0001_workspace.sql', 'utf8')); const state = createSeed(); await client.query('INSERT INTO ieum_workspaces (id, revision, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING', [process.env.IEUM_WORKSPACE_ID || 'development', state.revision, JSON.stringify(state)]); await client.query('COMMIT'); console.log('Development workspace migration completed. Existing workspaces were preserved.'); } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } } finally { await pool.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Database setup failed'); process.exitCode = 1; });

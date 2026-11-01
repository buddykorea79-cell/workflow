import { pgTable, text, jsonb, timestamp, integer } from 'drizzle-orm/pg-core';
import type { WorkspaceData } from './types';

// This first implementation keeps the aggregate transaction boundary explicit.
// Split into normalized entity tables before institution-scale rollout.
export const workspaces = pgTable('ieum_workspaces', { id: text('id').primaryKey(), revision: integer('revision').notNull(), data: jsonb('data').$type<WorkspaceData>().notNull(), updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow() });

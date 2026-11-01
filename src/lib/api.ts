import { NextResponse } from 'next/server';
import { DomainError } from './domain';
export function apiError(error: unknown) { if (error instanceof DomainError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status }); console.error('[ieum] Request failed:', error instanceof Error ? error.name : 'UnknownError'); return NextResponse.json({ error: '저장하지 못했습니다. 잠시 후 다시 시도해 주세요. 입력 내용은 유지됩니다.', code: 'INTERNAL_ERROR' }, { status: 500 }); }
export function json(data: unknown) { return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' } }); }

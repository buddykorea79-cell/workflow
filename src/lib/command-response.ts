import type { FieldIssue } from './form-validation';
import type { Workspace } from './types';

export type CommandFailure = {
  outcome: 'not-sent' | 'rejected' | 'unknown';
  status?: number;
  code?: string;
  message: string;
  fields?: FieldIssue[];
};

export class CommandResponseError extends Error {
  constructor(readonly failure: CommandFailure) { super(failure.message); }
}

/** Only an explicit API rejection proves that the write was not applied. */
export async function readCommandResponse(response: Response, actorId?: string): Promise<Workspace> {
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new CommandResponseError({ outcome: 'unknown', status: response.status, message: '저장 결과를 확인하지 못했습니다. 입력 내용은 유지됩니다.' }); }
  const result = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  if (!response.ok) {
    const fields = Array.isArray(result.fields) ? result.fields.filter((field): field is FieldIssue => !!field && typeof field.path === 'string' && typeof field.message === 'string') : [];
    throw new CommandResponseError({
      outcome: response.status >= 400 && response.status < 500 && typeof result.code === 'string' ? 'rejected' : 'unknown',
      status: response.status, code: typeof result.code === 'string' ? result.code : undefined,
      message: typeof result.error === 'string' ? result.error : '요청을 처리하지 못했습니다.', fields,
    });
  }
  const user = result.currentUser && typeof result.currentUser === 'object' ? result.currentUser as Record<string, unknown> : null;
  if (!Number.isSafeInteger(result.revision) || !user || typeof user.id !== 'string' || !user.id.trim() || !Array.isArray(result.units) || !Array.isArray(result.tasks)) {
    throw new CommandResponseError({ outcome: 'unknown', status: response.status, message: '저장 응답을 확인하지 못했습니다. 입력 내용은 유지됩니다.' });
  }
  if (actorId && user.id !== actorId) throw new CommandResponseError({ outcome: 'unknown', status: response.status, message: '응답의 계정이 변경되어 저장 결과를 확인하지 못했습니다. 입력 내용은 유지됩니다.' });
  return result as unknown as Workspace;
}

export function commandFailure(error: unknown): CommandFailure {
  return error instanceof CommandResponseError ? error.failure : {
    outcome: 'unknown', message: error instanceof Error ? error.message : '저장 결과를 확인하지 못했습니다.',
  };
}

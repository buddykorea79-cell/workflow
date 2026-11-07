import type { Workspace } from './types';

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error || '파일을 등록하지 못했습니다. 연결 상태와 파일 크기를 확인해 주세요.');
  return body;
}

/** Only signed PUT URLs cross into the browser; storage credentials remain on the server. */
export async function uploadAttachment(file: File, taskId: string, performanceId?: string): Promise<Workspace> {
  if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('비어 있지 않은 10MB 이하 파일을 선택해 주세요.');
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const sha256 = Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
  const prepared = await responseJson<{ provider: 'local' | 'neon'; uploadUrl?: string; token?: string; contentType?: string }>(await fetch('/api/attachments/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'prepare', file: { taskId, ...(performanceId ? { performanceId } : {}), name: file.name, size: file.size, mime: file.type || 'application/octet-stream', sha256 } }) }));
  if (prepared.provider === 'local') {
    const form = new FormData(); form.append('file', file); form.append('taskId', taskId);
    if (performanceId) form.append('performanceId', performanceId);
    return responseJson<Workspace>(await fetch('/api/attachments', { method: 'POST', body: form }));
  }
  if (!prepared.uploadUrl || !prepared.token) throw new Error('Neon 업로드 주소를 확인하지 못했습니다.');
  let uploaded: Response;
  try { uploaded = await fetch(prepared.uploadUrl, { method: 'PUT', headers: { 'Content-Type': prepared.contentType || 'application/octet-stream' }, body: file, credentials: 'omit' }); }
  catch { throw new Error('Neon 파일 업로드에 연결하지 못했습니다. 저장소 CORS에 현재 사이트 주소와 PUT·Content-Type 허용이 설정되어 있는지 확인해 주세요.'); }
  if (!uploaded.ok) throw new Error('Neon 파일 업로드가 거절되었습니다. 저장소 자격증명·권한·CORS 설정을 확인하고 다시 선택해 주세요.');
  return responseJson<Workspace>(await fetch('/api/attachments/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'complete', token: prepared.token }) }));
}

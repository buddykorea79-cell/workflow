import { activeUser, assertDefinitionWritable, assertTaskWritable, canReadTask, DomainError } from './domain';
import { PROCEDURE_PDF_LIMIT } from './procedure-draft';
import type { WorkspaceData } from './types';

/** Stored attachments are read-only evidence; importing a new procedure source requires definition access. */
export function authorizeProcedureExtraction(state: WorkspaceData, userId: string, taskId: string, attachmentId?: string, now = new Date()) {
  const user = activeUser(state, userId, now); const task = state.tasks.find(item => item.id === taskId);
  if (!task || !canReadTask(state, user, task, now)) throw new DomainError(403, 'PROCEDURE_ACCESS_DENIED', '이 업무의 문서 본문을 읽을 권한이 없습니다.');
  assertTaskWritable(state, task);
  if (task.status === 'archived') throw new DomainError(409, 'TASK_ARCHIVED', '보관된 업무에서는 문서 본문을 가져올 수 없습니다.');
  if (attachmentId) {
    const attachment = state.attachments.find(item => item.id === attachmentId && item.taskId === taskId);
    if (!attachment) throw new DomainError(404, 'ATTACHMENT_NOT_FOUND', '이 업무의 첨부파일을 찾을 수 없습니다.');
    if (attachment.performanceId) throw new DomainError(403, 'PROCEDURE_ACCESS_DENIED', '성과 전용 파일은 절차 자료로 사용할 수 없습니다.');
    if (!attachment.size || attachment.size > PROCEDURE_PDF_LIMIT) throw new DomainError(413, 'FILE_TOO_LARGE', '문서는 비어 있지 않은 10MB 이하 파일이어야 합니다.');
    return attachment;
  }
  if (user.id !== task.primaryId && user.role !== 'admin' && !(user.departmentId === task.departmentId && ['manager', 'head'].includes(user.role))) throw new DomainError(403, 'PROCEDURE_EDIT_DENIED', '담당자 또는 부서 관리자만 절차 자료를 가져올 수 있습니다.');
  assertDefinitionWritable(state, user, task.departmentId);
  return undefined;
}

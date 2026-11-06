import { activeUser, assertDefinitionWritable, assertTaskWritable, canReadTask, DomainError } from './domain';
import { isOwnDraftAttachment } from './attachment-upload';
import type { WorkspaceData } from './types';

export function descriptionAttachment(state: WorkspaceData, userId: string, attachmentId: string) {
  const user = activeUser(state, userId); const attachment = state.attachments.find(item => item.id === attachmentId);
  if (!attachment) throw new DomainError(404, 'ATTACHMENT_NOT_FOUND', '첨부파일을 찾을 수 없습니다.');
  if (attachment.uploadedBy === user.id && isOwnDraftAttachment(attachment.taskId, user.id) && user.role !== 'head') return attachment;
  const task = state.tasks.find(item => item.id === attachment.taskId);
  if (!task || !canReadTask(state, user, task) || !(user.id === task.primaryId || user.role === 'admin' || user.role === 'manager' && user.departmentId === task.departmentId)) throw new DomainError(403, 'DESCRIPTION_EDIT_DENIED', '업무 담당자 또는 부서 담당자만 설명 자료를 분석할 수 있습니다.');
  assertTaskWritable(state, task); assertDefinitionWritable(state, user, task.departmentId);
  return attachment;
}

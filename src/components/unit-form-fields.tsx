'use client';

import { useId } from 'react';
import { Field, showCommandError } from './ui';

export function unitImportanceInputError(value: string) {
  const text = value.trim();
  if (!text) return '중요도를 입력해 주세요.';
  return /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 10
    ? '' : '중요도는 1~10 사이의 정수로 입력해 주세요.';
}

export function validateUnitImportance(value: string) {
  const message = unitImportanceInputError(value);
  if (message) showCommandError(message, [{ path: 'importance', message }]);
  return !message;
}

export function UnitFormFields({ title, description, importance, onTitleChange, onDescriptionChange, onImportanceChange, autoFocus = false }: {
  title: string;
  description: string;
  importance: string;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onImportanceChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const importanceHintId = useId();
  return <>
    <Field name="title" label="단위업무 이름 · 업무 묶음의 이름" validationLabel="단위업무 이름">
      <input name="unitTitle" required maxLength={100} value={title} onChange={event => onTitleChange(event.target.value)} placeholder="예: 예산 편성 및 집행 관리" autoFocus={autoFocus} />
    </Field>
    <Field name="description" label="업무 범위와 목적" validationLabel="업무 범위">
      <textarea name="unitDescription" required maxLength={5000} rows={4} value={description} onChange={event => onDescriptionChange(event.target.value)} placeholder="이 업무 묶음에 어떤 세부업무를 모아둘지 적어 주세요." />
    </Field>
    <Field name="importance" label="중요도" error={unitImportanceInputError(importance)}>
      <input name="importance" type="text" inputMode="numeric" required value={importance} onChange={event => onImportanceChange(event.target.value)} aria-describedby={importanceHintId} />
      <small id={importanceHintId} className="muted">1~10 사이의 정수 · 숫자가 클수록 목록에 먼저 표시됩니다. 기본값은 5입니다.</small>
    </Field>
  </>;
}

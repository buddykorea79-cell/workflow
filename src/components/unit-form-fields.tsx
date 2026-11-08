'use client';

import { Field } from './ui';

export function UnitFormFields({ title, description, onTitleChange, onDescriptionChange, autoFocus = false }: {
  title: string;
  description: string;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return <>
    <Field name="title" label="단위업무 이름 · 업무 묶음의 이름" validationLabel="단위업무 이름">
      <input name="unitTitle" required maxLength={100} value={title} onChange={event => onTitleChange(event.target.value)} placeholder="예: 예산 편성 및 집행 관리" autoFocus={autoFocus} />
    </Field>
    <Field name="description" label="업무 범위와 목적" validationLabel="업무 범위">
      <textarea name="unitDescription" required maxLength={5000} rows={4} value={description} onChange={event => onDescriptionChange(event.target.value)} placeholder="이 업무 묶음에 어떤 세부업무를 모아둘지 적어 주세요." />
    </Field>
  </>;
}

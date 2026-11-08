'use client';

import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { CalendarDays, X } from 'lucide-react';
import { changedDatePart, dateInputError, dateInputValue, datePartLength, pastedDateInput, splitDateInput, type DatePart, type DateParts } from '@/lib/date-input';
import { useUnsavedChanges } from './unsaved-changes';
import './date-input.css';

export interface DateInputProps {
  value: string; onChange: (value: string) => void; required?: boolean; disabled?: boolean;
  min?: string; max?: string; id?: string; name?: string;
  'aria-label'?: string; 'aria-describedby'?: string;
}
const partNames: Record<DatePart, string> = { year: '연도', month: '월', day: '일' };
const order: DatePart[] = ['year', 'month', 'day'];

/** A deterministic year/month/day keyboard entry with a native calendar alternative. */
export function DateInput({ value, onChange, required = false, disabled = false, min, max, id, name, 'aria-label': label = '날짜', 'aria-describedby': describedBy }: DateInputProps) {
  const generatedId = useId(); const inputId = id || generatedId;
  const [parts, setParts] = useState(() => splitDateInput(value));
  const [showError, setShowError] = useState(false);
  const [pasteError, setPasteError] = useState('');
  const [calendarFallback, setCalendarFallback] = useState(false);
  const emitted = useRef(value);
  const inputs = useRef<Partial<Record<DatePart, HTMLInputElement>>>({});
  const calendar = useRef<HTMLInputElement>(null);
  const error = pasteError || dateInputError(parts, { required, min, max });
  const hasParts = order.some(part => parts[part]);
  // Incomplete optional dates have no ISO value, so the parent cannot detect
  // their local draft through onChange alone. Protect those entries on close.
  useUnsavedChanges(!disabled && (!!pasteError || hasParts && !dateInputValue(parts)), `${label} 입력`);
  useEffect(() => {
    if (value !== emitted.current) { emitted.current = value; setParts(splitDateInput(value)); setShowError(false); setPasteError(''); }
  }, [value]);
  useEffect(() => { inputs.current.year?.setCustomValidity(disabled ? '' : error); }, [error, disabled]);

  function update(next: DateParts) {
    setParts(next); setShowError(false); setPasteError('');
    const iso = dateInputValue(next);
    emitted.current = iso;
    onChange(iso);
  }
  function focus(part?: DatePart) { if (part) { inputs.current[part]?.focus(); inputs.current[part]?.select(); } }
  function paste(event: ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData('text');
    const next = pastedDateInput(text);
    if (next) { event.preventDefault(); update(next); focus('day'); }
    else if (text.includes('-') || text.replace(/\D/g, '').length > 4) { event.preventDefault(); setShowError(true); setPasteError('날짜는 YYYY-MM-DD 형식의 실제 날짜로 입력해 주세요.'); }
  }
  function navigate(event: KeyboardEvent<HTMLInputElement>, part: DatePart) {
    const index = order.indexOf(part); const field = event.currentTarget;
    if (event.key === 'ArrowLeft' && field.selectionStart === 0 && index > 0) { event.preventDefault(); focus(order[index - 1]); }
    else if (event.key === 'ArrowRight' && field.selectionEnd === field.value.length && index < 2) { event.preventDefault(); focus(order[index + 1]); }
    else if (event.key === 'Backspace' && !field.value && index > 0) { event.preventDefault(); focus(order[index - 1]); }
  }
  return <div className="date-input" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setParts(current => ({ ...current, month: current.month ? current.month.padStart(2, '0') : '', day: current.day ? current.day.padStart(2, '0') : '' }));
      setShowError(true);
    }
  }}>
    <div className="date-input-controls" role="group" aria-label={label}>
      {order.map((part, index) => <span className={`date-input-part date-input-${part}`} key={part}>
        <input ref={element => { if (element) inputs.current[part] = element; else delete inputs.current[part]; }} id={index === 0 ? inputId : `${inputId}-${part}`} type="text" inputMode="numeric" autoComplete="off" placeholder={part === 'year' ? 'YYYY' : part === 'month' ? 'MM' : 'DD'} maxLength={datePartLength[part]} pattern={part === 'year' ? '[0-9]{4}' : '[0-9]{1,2}'} required={required || hasParts} disabled={disabled} value={parts[part]} aria-label={`${label} ${partNames[part]}`} aria-describedby={[describedBy, showError && error ? `${inputId}-error` : ''].filter(Boolean).join(' ') || undefined} aria-invalid={showError && !!error || undefined} onFocus={event => event.currentTarget.select()} onInvalid={() => setShowError(true)} onPaste={paste} onKeyDown={event => navigate(event, part)} onChange={event => {
          const next = changedDatePart(part, event.target.value);
          update({ ...parts, [part]: next.text });
          if (next.advance && index < 2) focus(order[index + 1]);
        }}/><span aria-hidden="true">{part === 'year' ? '년' : partNames[part]}</span>
      </span>)}
      <button type="button" className="date-input-calendar" disabled={disabled} aria-label={`${label} 달력 열기`} title="달력에서 선택" onClick={() => {
        try { if (calendar.current?.showPicker) calendar.current.showPicker(); else setCalendarFallback(true); }
        catch { setCalendarFallback(true); }
      }}><CalendarDays size={17} aria-hidden="true"/></button>
      {!required && hasParts && <button type="button" className="date-input-clear" disabled={disabled} aria-label={`${label} 지우기`} title="날짜 지우기" onClick={() => { update(splitDateInput('')); focus('year'); }}><X size={15} aria-hidden="true"/></button>}
    </div>
    <input ref={calendar} className={calendarFallback ? 'date-input-calendar-fallback' : 'date-input-calendar-native'} type="date" value={dateInputValue(parts)} min={min || '0001-01-01'} max={max || '9999-12-31'} disabled={disabled} aria-label={`${label} 달력 선택`} aria-hidden={!calendarFallback || undefined} tabIndex={calendarFallback ? 0 : -1} onChange={event => { update(splitDateInput(event.target.value)); setCalendarFallback(false); focus('day'); }}/>
    {name && <input type="hidden" name={name} value={dateInputValue(parts)} disabled={disabled}/>}
    {showError && error && <small id={`${inputId}-error`} className="field-error" role="alert">{error}</small>}
  </div>;
}

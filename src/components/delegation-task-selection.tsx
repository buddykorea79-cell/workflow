'use client';

import { useEffect, useRef } from 'react';
import type { Task, Workspace } from '@/lib/types';
import { activeTaskDelegations } from '@/lib/delegations';

function SelectionCheckbox({ label, ids, selectedIds, onChange, disabled }: { label: string; ids: string[]; selectedIds: string[]; onChange: (ids: string[]) => void; disabled: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const count = ids.filter(id => selectedIds.includes(id)).length;
  const checked = ids.length > 0 && count === ids.length;
  const mixed = count > 0 && !checked;
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <input ref={ref} type="checkbox" aria-label={label} aria-checked={mixed ? 'mixed' : checked} checked={checked} disabled={disabled || !ids.length} onChange={event => onChange(event.target.checked ? [...new Set([...selectedIds, ...ids])] : selectedIds.filter(id => !ids.includes(id)))}/>;
}

/** A fixed selection of original detail-task IDs, grouped for the user by unit. */
export function DelegationTaskSelection({ workspace: w, tasks, selectedIds, onChange, disabled = false }: { workspace: Workspace; tasks: Task[]; selectedIds: string[]; onChange: (ids: string[]) => void; disabled?: boolean }) {
  const now = new Date(w.serverTime);
  const units = [...new Set(tasks.map(task => task.unitId))].map(id => ({ id, title: w.units.find(unit => unit.id === id)?.title || '단위업무', tasks: tasks.filter(task => task.unitId === id).sort((a, b) => a.title.localeCompare(b.title, 'ko')) })).sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  const person = tasks[0] && w.users.find(user => user.id === tasks[0].primaryId);
  const current = tasks.filter(task => selectedIds.includes(task.id)).length;
  return <section className="delegation-selection" aria-label="대행할 업무 선택">
    <header><label><SelectionCheckbox label="담당자의 전체 업무 선택" ids={tasks.map(task => task.id)} selectedIds={selectedIds} onChange={onChange} disabled={disabled}/><strong>전체 업무 선택</strong></label><span>선택 <b>{current}</b> / {tasks.length}개 세부업무</span></header>
    <p>전체를 선택하거나 단위업무·세부업무별로 필요한 범위를 선택하세요. 현재 선택한 업무만 요청하며 나중에 추가한 업무는 포함하지 않습니다.</p>
    <div className="delegation-selection-scroll" role="region" aria-label="업무분장표 형식의 업무대행 선택표" tabIndex={0}><table><caption>담당자·단위업무·세부업무별 대행 선택</caption><thead><tr><th scope="col">담당자</th><th scope="col">단위업무</th><th scope="col">세부업무</th><th scope="col">현재 업무대행자</th></tr></thead><tbody>{units.flatMap((unit, unitIndex) => unit.tasks.map((task, taskIndex) => <tr key={task.id} className={selectedIds.includes(task.id) ? 'selected' : ''}>
      {unitIndex === 0 && taskIndex === 0 && <th scope="rowgroup" rowSpan={tasks.length} className="delegation-selection-person"><strong>{person?.name || '담당자'}</strong><span>{person?.team}</span></th>}
      {taskIndex === 0 && <td rowSpan={unit.tasks.length} className="delegation-selection-unit"><label><SelectionCheckbox label={`${unit.title} 단위업무 전체 선택`} ids={unit.tasks.map(item => item.id)} selectedIds={selectedIds} onChange={onChange} disabled={disabled}/><strong>{unit.title}</strong></label></td>}
      <td><label><SelectionCheckbox label={`${task.title} 세부업무 선택`} ids={[task.id]} selectedIds={selectedIds} onChange={onChange} disabled={disabled}/><span>{task.title}</span></label></td>
      <td>{activeTaskDelegations(w, task, undefined, now).map(item => w.users.find(user => user.id === item.toId)?.name || '구성원').join(', ') || '—'}</td>
    </tr>))}</tbody></table></div>
    {!tasks.length && <p className="delegation-empty">대행을 요청할 수 있는 세부업무가 없습니다.</p>}
  </section>;
}

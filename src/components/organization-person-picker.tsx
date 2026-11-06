'use client';

import { useId, useState } from 'react';
import { Building2, Check, ChevronDown, ChevronRight, Search, UserRound, Users } from 'lucide-react';
import type { User, Workspace } from '@/lib/types';
import { roleLabels } from './ui';
import './organization-person-picker.css';

export function OrganizationPersonPicker({ workspace, value, onChange, candidates, disabled = false, label = '업무대행자' }: { workspace: Workspace; value: string; onChange: (id: string) => void; candidates: User[]; disabled?: boolean; label?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<string[]>([]);
  const selected = candidates.find(person => person.id === value);
  const departments = workspace.departmentDirectory ?? workspace.departments;
  const departmentName = (departmentId: string) => departments.find(item => item.id === departmentId)?.name || '부서';
  const filtered = candidates.filter(person => [person.name, person.team, departmentName(person.departmentId), person.title].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (key: string) => setClosed(items => items.includes(key) ? items.filter(item => item !== key) : [...items, key]);
  return <div className="org-person-picker">
    <span className="org-picker-label" id={id + '-label'}>{label}</span>
    <button type="button" className="org-picker-selected" disabled={disabled} aria-labelledby={id + '-label ' + id + '-selection'} aria-expanded={open && !disabled} aria-controls={id + '-tree'} onClick={() => setOpen(!open)}><UserRound size={19}/><span id={id + '-selection'}>{selected ? <><strong>{selected.name} · {roleLabels[selected.role]}</strong><small>{departmentName(selected.departmentId)} → {selected.team || '소속 팀 없음'}</small></> : <strong>조직도에서 대행자를 선택하세요</strong>}</span><ChevronDown size={18}/></button>
    {open && !disabled && <div className="org-picker-panel" id={id + '-tree'}>
      <label className="org-picker-search"><Search size={17}/><input value={query} onChange={event => { setQuery(event.target.value); setClosed([]); }} placeholder="이름·부서·팀 검색" aria-label="업무대행자 검색"/></label>
      <div className="org-picker-tree" role="group" aria-label="부서·팀별 업무대행자 선택">
        {departments.filter(department => filtered.some(person => person.departmentId === department.id)).map(department => {
          const people = filtered.filter(person => person.departmentId === department.id);
          const departmentKey = 'department-' + department.id;
          return <div className="org-picker-department" key={department.id}><button type="button" className="org-picker-group" aria-expanded={!closed.includes(departmentKey)} onClick={() => toggle(departmentKey)}>{closed.includes(departmentKey) ? <ChevronRight size={16}/> : <ChevronDown size={16}/>}<Building2 size={17}/><strong>{department.name}</strong><span>{people.length}명</span></button>
            {!closed.includes(departmentKey) && <div className="org-picker-teams">{[...new Set(people.map(person => person.team || '소속 팀 없음'))].map(team => {
              const teamKey = department.id + '-' + team;
              return <div key={team}><button type="button" className="org-picker-group org-picker-team" aria-expanded={!closed.includes(teamKey)} onClick={() => toggle(teamKey)}>{closed.includes(teamKey) ? <ChevronRight size={15}/> : <ChevronDown size={15}/>}<Users size={16}/><strong>{team}</strong></button>{!closed.includes(teamKey) && <div className="org-picker-people">{people.filter(person => (person.team || '소속 팀 없음') === team).map(person => <label key={person.id} className={person.id === value ? 'selected' : ''}><input type="radio" name={id} value={person.id} checked={person.id === value} onChange={() => { onChange(person.id); setOpen(false); }}/><span><strong>{person.name}</strong><small>{person.title} · {roleLabels[person.role]}</small></span>{person.id === value && <Check size={17}/>}</label>)}</div>}</div>;
            })}</div>}
          </div>;
        })}
        {!filtered.length && <p className="org-picker-empty">{query ? '검색 조건에 맞는 직원이 없습니다.' : '지정할 수 있는 활성 직원이 없습니다.'}</p>}
      </div>
      <p className="org-picker-hint">해당 업무 부서의 활성 직원 중 원담당자와 부서장을 제외하여 표시합니다.</p>
    </div>}
  </div>;
}

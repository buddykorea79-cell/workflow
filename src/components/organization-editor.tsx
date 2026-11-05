'use client';

import { useState } from 'react';
import { ArrowLeftRight, Building2, History, Save, ShieldCheck } from 'lucide-react';
import type { User, Workspace } from '@/lib/types';
import { isOrganizationUserActive, organizationResponsibilities, organizationUserChangeIssue } from '@/lib/organization-management';
import { Badge, Button, Field, Modal, type CommandFn } from './ui';

const roleNames: Record<User['role'], string> = { admin: '시스템 관리자', head: '부서장', manager: '부서 담당자', lead: '팀장', member: '개인 담당자' };
type Props = { workspace: Workspace; command: CommandFn; mode: 'department' | 'user' | User; onClose: () => void };

export function OrganizationEditor({ workspace: w, command, mode, onClose }: Props) {
  const existing = typeof mode === 'object' ? mode : undefined;
  const [name, setName] = useState(existing?.name || '');
  const [shortName, setShortName] = useState('');
  const [departmentId, setDepartmentId] = useState(existing?.departmentId || w.currentUser.departmentId);
  const [team, setTeam] = useState(existing?.team || '');
  const [role, setRole] = useState<User['role']>(existing?.role || 'member');
  const [title, setTitle] = useState(existing?.title || '');
  const [email, setEmail] = useState(existing?.email || '');
  const [phone, setPhone] = useState(existing?.phone || '');
  const [commonTaskPermission, setCommonTaskPermission] = useState(!!existing?.commonTaskPermission);
  const [active, setActive] = useState(existing ? isOrganizationUserActive(existing, new Date(w.serverTime)) : true);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (w.currentUser.role !== 'admin') return null;
  const now = new Date(w.serverTime);
  const responsibilities = existing ? organizationResponsibilities(w, existing.id, now) : [];
  const next = existing ? { ...existing, name: name.trim(), departmentId, team: team.trim(), role, title: title.trim(), email: email.trim().toLowerCase() || undefined, phone: phone.trim() || undefined, commonTaskPermission, active } : undefined;
  if (next?.active && existing && !isOrganizationUserActive(existing, now)) delete next.endsAt;
  const issue = existing && next ? organizationUserChangeIssue(w, w.currentUser, existing, next, now) : undefined;
  const personnelChanges = existing ? w.audit.filter(event => event.targetId === existing.id && event.action === 'organization.userUpdate').slice(0, 10) : [];
  const departmentName = (id?: string) => w.departments.find(department => department.id === id)?.name || id || '미지정';
  const openHandover = () => { onClose(); window.location.hash = 'handover'; };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); if (saving || issue) return;
    setSaving(true); setError('');
    const payload = mode === 'department' ? { name, shortName } : { name, departmentId, team, role, title, email, phone, commonTaskPermission, ...(existing ? { userId: existing.id, active, reason } : {}) };
    try {
      if (await command(mode === 'department' ? 'organization.departmentCreate' : existing ? 'organization.userUpdate' : 'organization.userCreate', payload)) onClose();
      else setError('저장하지 못했습니다. 화면 위 안내 메시지를 확인하고 입력값 또는 남은 업무 책임을 정리해 주세요.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '인사정보를 저장하지 못했습니다.'); }
    finally { setSaving(false); }
  };
  return <Modal title={mode === 'department' ? '새 부서 등록' : existing ? '구성원 인사정보 변경' : '새 구성원 등록'} description={existing ? '업무 소유권은 자동 변경되지 않습니다. 전보·비활성화 전에 인수인계를 완료해 주세요.' : '등록한 정보는 프로토타입 조직과 역할 선택에 반영됩니다.'} wide={!!existing} onClose={() => { if (!saving) onClose(); }}>
    <form className="form-stack organization-editor" onSubmit={submit}>
      {mode === 'department' ? <>
        <Field label="부서 이름"><input required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="예: 디지털전략실" /></Field>
        <Field label="짧은 부서 이름"><input required maxLength={10} value={shortName} onChange={event => setShortName(event.target.value)} placeholder="예: 디지털" /></Field>
        <div className="management-info"><Building2 size={18} /><p>부서 등록 후 활성 부서장과 부서 담당자를 먼저 등록하세요. 기존 공통업무에 자동 배포되지는 않습니다.</p></div>
      </> : <>
        {existing && <p className="muted">구성원 ID: {existing.id} · 기존 업무·성과·인수인계 기록의 작성자는 보존됩니다.</p>}
        <div className="form-grid">
          <Field label="구성원 이름"><input required maxLength={50} value={name} onChange={event => setName(event.target.value)} /></Field>
          <Field label="소속 부서"><select required value={departmentId} onChange={event => setDepartmentId(event.target.value)}>{w.departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</select></Field>
          <Field label="소속 팀"><input required maxLength={100} value={team} onChange={event => setTeam(event.target.value)} placeholder="예: 기획팀 / 부서 직속" /></Field>
          <Field label="직위·직책"><input required maxLength={100} value={title} onChange={event => setTitle(event.target.value)} placeholder="예: 주무관" /></Field>
          <Field label="조직 역할"><select value={role} onChange={event => setRole(event.target.value as User['role'])}>{Object.entries(roleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
          {existing && <Field label="계정 상태"><select value={active ? 'active' : 'inactive'} onChange={event => setActive(event.target.value === 'active')}><option value="active">활성</option><option value="inactive">비활성 · 퇴직/사용 중지</option></select></Field>}
          <Field label="이메일 · 선택"><input type="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} autoComplete="off" /></Field>
          <Field label="전화번호 · 선택"><input type="tel" maxLength={30} value={phone} onChange={event => setPhone(event.target.value)} placeholder="예: 02-0000-0000" /></Field>
        </div>
        <label className="organization-permission"><input type="checkbox" checked={role === 'admin' || commonTaskPermission} disabled={role === 'admin'} onChange={event => setCommonTaskPermission(event.target.checked)} /><span>공통업무 등록·총괄 권한</span></label>
        {existing && <>
          <section className="organization-responsibilities" aria-label="인사 변경 전 남은 업무 책임"><header><h3>남은 업무 책임</h3><Badge tone={responsibilities.length ? 'warning' : 'success'}>{responsibilities.length}건</Badge></header>
            <p>전보·비활성화는 아래 책임을 모두 정리한 후 저장할 수 있습니다. 팀·역할 변경도 현재 배정 자격을 유지해야 합니다.</p>
            {responsibilities.length ? <><ul>{responsibilities.map(item => <li key={item.id}><Badge tone="outline">{item.label}</Badge><div><strong>{item.title}</strong><small>{departmentName(item.departmentId)}</small></div></li>)}</ul><Button type="button" variant="secondary" onClick={openHandover}><ArrowLeftRight size={16} />인수인계에서 책임 정리</Button></> : <p className="organization-no-responsibility">현재 인수인계할 업무 책임이 없습니다.</p>}
          </section>
          <Field label="변경 사유"><textarea required rows={3} maxLength={5000} value={reason} onChange={event => setReason(event.target.value)} placeholder="발령, 팀 조정, 권한 변경, 퇴직 또는 재활성화 사유를 기록하세요." /></Field>
        </>}
        <div className="management-info"><ShieldCheck size={18} /><p>인사정보는 기관 관리자만 변경합니다. 기존 부서의 부서장·부서 담당자와 기관 관리자를 유지해야 하며, 업무 배정은 인수인계에서 별도로 처리합니다.</p></div>
      </>}
      {issue && <p className="form-error" role="alert">{issue.message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><Button type="button" variant="secondary" disabled={saving} onClick={onClose}>취소</Button><Button type="submit" disabled={saving || !!issue}><Save size={16} />{saving ? '저장 중…' : mode === 'department' ? '부서 등록' : existing ? '인사정보 저장' : '구성원 등록'}</Button></div>
    </form>
    {existing && <section className="organization-change-history" aria-label="인사정보 변경 기록"><h3><History size={17} />최근 인사정보 변경 기록</h3>{personnelChanges.length ? personnelChanges.map(event => {
      let change: { reason?: string; before?: Partial<User>; after?: Partial<User> } = {};
      try { change = JSON.parse(event.detail); } catch { /* Older audit text remains readable. */ }
      const summary = change.before && change.after ? [change.before.departmentId !== change.after.departmentId ? `${departmentName(change.before.departmentId)} → ${departmentName(change.after.departmentId)}` : '', change.before.team !== change.after.team ? `${change.before.team} → ${change.after.team}` : '', change.before.role !== change.after.role ? `${roleNames[change.before.role!]} → ${roleNames[change.after.role!]}` : '', change.before.active !== change.after.active ? change.after.active ? '활성화' : '비활성화' : ''].filter(Boolean).join(' · ') : '';
      return <article key={event.id}><strong>{summary || '구성원 정보 수정'}</strong><p>{change.reason || event.detail}</p><small>{w.users.find(user => user.id === event.actorId)?.name || '관리자'} · {new Date(event.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</small></article>;
    }) : <p className="muted">아직 변경 기록이 없습니다.</p>}</section>}
  </Modal>;
}

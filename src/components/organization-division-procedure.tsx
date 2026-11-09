'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import type { OrganizationDivisionProcedure as ProcedureData } from '@/lib/organization-division-procedure';
import type { WorkflowStep } from '@/lib/types';
import { Button, EmptyState } from './ui';
import { ProcedureFlow } from './procedure-builder';
import './organization-division-procedure.css';

type LoadState = { taskId: string; loading: boolean; data: ProcedureData | null; error: string };

/** Minimal read model only: never use workspace tasks or run records for this viewer. */
export function OrganizationDivisionProcedure({ taskId }: { taskId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ taskId, loading: true, data: null, error: '' });
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    const timeout = setTimeout(() => controller.abort(new DOMException('조회 시간이 지났습니다.', 'TimeoutError')), 30_000);
    setState({ taskId, loading: true, data: null, error: '' });
    void (async () => {
      try {
        const response = await fetch(`/api/organization-division/procedure?${new URLSearchParams({ taskId })}`, { cache: 'no-store', signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (!active) return;
        if (controller.signal.aborted) throw controller.signal.reason;
        if (!response.ok || !body) throw new Error(body?.error || body?.message || '업무 절차도를 불러오지 못했습니다.');
        if (body.taskId !== taskId || !Array.isArray(body.workflow)) throw new Error('업무 절차도 응답을 확인하지 못했습니다. 다시 불러와 주세요.');
        setState({ taskId, loading: false, data: body as ProcedureData, error: '' });
      } catch (cause) {
        if (!active) return;
        const error = controller.signal.reason?.name === 'TimeoutError' ? '조회 시간이 지났습니다. 연결 상태를 확인하고 다시 불러와 주세요.' : cause instanceof Error ? cause.message : '업무 절차도를 불러오지 못했습니다.';
        setState({ taskId, loading: false, data: null, error });
      } finally { clearTimeout(timeout); }
    })();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [taskId, attempt]);

  if (state.taskId !== taskId || state.loading) return <div className="od-procedure-loading" role="status" aria-busy="true"><LoaderCircle className="spin" size={22}/><p>저장된 업무 절차도를 불러오고 있습니다.</p></div>;
  if (state.error || !state.data) return <div className="od-procedure-error" role="alert"><p>{state.error || '업무 절차도를 불러오지 못했습니다.'}</p><Button variant="secondary" onClick={() => setAttempt(value => value + 1)}><RefreshCw size={16}/>다시 불러오기</Button></div>;
  const data = state.data;
  const workflow: WorkflowStep[] = data.workflow.map(step => ({ id: step.id, title: step.title, role: step.role, dependsOn: step.dependsOn, description: '', output: '', required: false, checklist: [], done: false }));
  return <section className="od-procedure-view" aria-label="업무분장표의 읽기 전용 절차도">
    {workflow.length ? <ProcedureFlow workflow={workflow} participants={data.participants} scrollOnly/> : <EmptyState title="아직 등록된 절차가 없습니다." description="담당자가 업무 절차를 저장하면 이곳에서 확인할 수 있습니다."/>}
  </section>;
}

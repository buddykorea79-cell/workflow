'use client';

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { buildProcedureFlowLayout, type ProcedureFlowLayoutEdge } from '@/lib/procedure-flow-layout';
import type { WorkflowStep } from '@/lib/types';
import './procedure-flow-document.css';

type Role = WorkflowStep['role'];
type DocumentStep = Pick<WorkflowStep, 'id' | 'title' | 'role' | 'dependsOn' | 'done'>;
const roleLabels: Record<Role, string> = { primary: '담당자', support: '협업·지원', reviewer: '검토자' };
const participantFallbacks: Record<Role, string> = { primary: '담당자 미지정', support: '지원자 미지정', reviewer: '검토자 미지정' };

export interface ProcedureFlowDocumentProps {
  workflow: readonly DocumentStep[];
  participants?: Partial<Record<Role, string>>;
  selectedId?: string;
  onSelect?: (id: string) => void;
  className?: string;
}

export interface DocumentCardBox {
  left: number; right: number; top: number; bottom: number;
  row: number; rowTop: number; rowBottom: number;
}

/** Route through row and column gutters, including returning/self edges. */
export function documentConnectorPath(source: DocumentCardBox, target: DocumentCardBox, backward: boolean, width: number): string {
  const start = (source.left + source.right) / 2, end = (target.left + target.right) / 2;
  const departure = source.rowBottom + 22, arrival = target.rowTop - 22;
  const points: [number, number][] = [[start, source.bottom]];
  if (!backward && target.row === source.row + 1) {
    const middle = (source.rowBottom + target.rowTop) / 2;
    points.push([start, middle], [end, middle]);
  } else {
    const gutter = backward ? width - 9 : end < start ? source.left - 22 : source.right + 22;
    points.push([start, departure], [gutter, departure], [gutter, arrival], [end, arrival]);
  }
  points.push([end, target.top - 2]);
  return points.map(([x, y], index) => `${index ? 'L' : 'M'} ${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`).join(' ');
}

interface Drawing {
  width: number;
  height: number;
  paths: (ProcedureFlowLayoutEdge & { path: string })[];
}

export function ProcedureFlowDocument({ workflow, participants, selectedId, onSelect, className = '' }: ProcedureFlowDocumentProps) {
  const layout = useMemo(() => buildProcedureFlowLayout(workflow), [workflow]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  const [drawing, setDrawing] = useState<Drawing>({ width: 0, height: 0, paths: [] });
  const [horizontalOverflow, setHorizontalOverflow] = useState(false);
  const markerId = `pfd-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const participant = (role: Role) => participants?.[role]?.trim() || participantFallbacks[role];
  const numberById = new Map(layout.nodes.map(node => [node.id, String(node.index + 1).padStart(2, '0')]));
  const predecessors = new Map(layout.nodes.map(node => [node.id, layout.edges.filter(edge => edge.target === node.id).map(edge => numberById.get(edge.source)!)]));

  useEffect(() => {
    const scroll = scrollRef.current, body = bodyRef.current;
    if (!scroll || !body) return;
    let frame = 0, active = true;
    const measure = () => {
      if (!active) return;
      const origin = body.getBoundingClientRect();
      const boxes = new Map<string, DocumentCardBox>();
      for (const node of layout.nodes) {
        const card = cardRefs.current.get(node.id), row = rowRefs.current.get(node.row);
        if (!card || !row) continue;
        const rect = card.getBoundingClientRect(), rowRect = row.getBoundingClientRect();
        boxes.set(node.id, { left: rect.left - origin.left, right: rect.right - origin.left, top: rect.top - origin.top, bottom: rect.bottom - origin.top, row: node.row, rowTop: rowRect.top - origin.top, rowBottom: rowRect.bottom - origin.top });
      }
      const next: Drawing = { width: body.clientWidth, height: body.clientHeight, paths: layout.edges.flatMap(edge => {
        const source = boxes.get(edge.source), target = boxes.get(edge.target);
        return source && target ? [{ ...edge, path: documentConnectorPath(source, target, edge.backward, body.clientWidth) }] : [];
      }) };
      setDrawing(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      setHorizontalOverflow(scroll.scrollWidth > scroll.clientWidth + 1);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    schedule();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    observer?.observe(scroll); observer?.observe(body);
    for (const card of cardRefs.current.values()) observer?.observe(card);
    return () => { active = false; observer?.disconnect(); cancelAnimationFrame(frame); };
  }, [layout, participants]);

  useEffect(() => {
    if (!selectedId) return;
    const frame = requestAnimationFrame(() => {
      const scroll = scrollRef.current, card = cardRefs.current.get(selectedId);
      if (!scroll || !card) return;
      const viewport = scroll.getBoundingClientRect(), rect = card.getBoundingClientRect();
      const headerHeight = headerRef.current?.getBoundingClientRect().height || 0;
      const visibleTop = viewport.top + headerHeight + 14, visibleBottom = viewport.top + scroll.clientHeight - 14;
      const visibleLeft = viewport.left + 14, visibleRight = viewport.left + scroll.clientWidth - 14;
      let top = scroll.scrollTop, left = scroll.scrollLeft;
      if (rect.top < visibleTop || rect.height > visibleBottom - visibleTop) top += rect.top - visibleTop;
      else if (rect.bottom > visibleBottom) top += rect.bottom - visibleBottom;
      if (rect.left < visibleLeft) left += rect.left - visibleLeft;
      else if (rect.right > visibleRight) left += rect.right - visibleRight;
      if (top !== scroll.scrollTop || left !== scroll.scrollLeft) scroll.scrollTo({ top: Math.max(0, top), left: Math.max(0, left), behavior: 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, layout, horizontalOverflow]);

  if (!layout.nodes.length) return <div className="pfd-empty">등록된 절차가 없습니다.</div>;
  const columnCount = layout.columns.length;
  return <div ref={scrollRef} className={`procedure-flow-document ${className}`.trim()} role="region" aria-label="역할별 업무 절차도" tabIndex={0}>
    <div className="pfd-content" style={{ '--pfd-columns': columnCount, '--pfd-min-width': `${columnCount * 280 + (columnCount - 1) * 44 + 48}px` } as CSSProperties}>
      <div ref={headerRef} className="pfd-role-header">
        {horizontalOverflow && <p className="pfd-scroll-hint">↔ 좌우로 스크롤해 다른 역할을 확인하세요.</p>}
        <div className="pfd-role-columns">{layout.columns.map(column => <div key={column.role} className={`pfd-role pfd-role-${column.role}`}><strong>{roleLabels[column.role]}</strong><span title={participant(column.role)}>{participant(column.role)}</span></div>)}</div>
      </div>
      <div ref={bodyRef} className="pfd-body">
        <div className="pfd-lanes" aria-hidden="true">{layout.columns.map(column => <div key={column.role} className={`pfd-lane pfd-lane-${column.role}`}/>)}</div>
        {drawing.width > 0 && <svg className="pfd-connections" width={drawing.width} height={drawing.height} aria-hidden="true" focusable="false">
          <defs><marker id={markerId} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 9 4.5 L 0 9 z" fill="#55728e"/></marker><marker id={`${markerId}-return`} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 9 4.5 L 0 9 z" fill="#aa6b12"/></marker></defs>
          {drawing.paths.map(edge => <path key={edge.id} data-source={edge.source} data-target={edge.target} className={edge.backward ? 'is-backward' : undefined} d={edge.path} markerEnd={`url(#${markerId}${edge.backward ? '-return' : ''})`}/>)}
        </svg>}
        {layout.rows.map(row => <div key={row.index} ref={element => { if (element) rowRefs.current.set(row.index, element); else rowRefs.current.delete(row.index); }} className="pfd-row" data-row={row.index}>{row.nodes.map(node => {
          const step = workflow[node.index], incoming = predecessors.get(node.id)!;
          const content = <><span className="pfd-card-heading"><span className="pfd-step-number">{numberById.get(node.id)}</span><span>{roleLabels[node.role]}</span>{step.done && <span className="pfd-complete">완료</span>}</span><strong className="pfd-card-title">{step.title || '새 절차'}</strong><span className="pfd-card-participant">{participant(node.role)}</span><span className="pfd-card-dependencies">{incoming.length ? `선행 절차 ${incoming.join(', ')}` : '시작 절차'}</span></>;
          const shared = { 'data-step-id': node.id, 'data-role': node.role, className: `pfd-card pfd-card-${node.role}${selectedId === node.id ? ' is-selected' : ''}`, style: { gridColumn: node.column + 1 }, ref: (element: HTMLElement | null) => { if (element) cardRefs.current.set(node.id, element); else cardRefs.current.delete(node.id); } };
          return onSelect ? <button key={node.id} {...shared} type="button" aria-pressed={selectedId === node.id} onClick={() => onSelect(node.id)}>{content}</button> : <article key={node.id} {...shared}>{content}</article>;
        })}</div>)}
      </div>
      {layout.edges.some(edge => edge.backward) && <p className="pfd-cycle-notice">점선은 앞 단계로 돌아가는 연결입니다. 선행 관계를 확인하세요.</p>}
    </div>
  </div>;
}

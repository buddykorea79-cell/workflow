'use client';

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { buildProcedureFlowLayout, type ProcedureFlowLayoutEdge } from '@/lib/procedure-flow-layout';
import type { WorkflowStep } from '@/lib/types';
import './procedure-flow-document.css';

type Role = WorkflowStep['role'];
type DocumentStep = Pick<WorkflowStep, 'id' | 'title' | 'role' | 'dependsOn' | 'done'>;
const roleLabels: Record<Role, string> = { primary: '담당자', support: '협업·지원', reviewer: '검토자' };
const participantFallbacks: Record<Role, string> = { primary: '담당자 미지정', support: '지원자 미지정', reviewer: '검토자 미지정' };
const BASE_CARD_WIDTH = 220;
const COLUMN_GAP = 56;

export interface ProcedureFlowDocumentProps {
  workflow: readonly DocumentStep[];
  participants?: Partial<Record<Role, string>>;
  selectedId?: string;
  onSelect?: (id: string) => void;
  className?: string;
}
export interface DocumentCardBox {
  left: number; right: number; top: number; bottom: number;
  column: number; laneTop: number; laneBottom: number;
}

/** Route left to right through the gaps between stages and role lanes. */
export function documentConnectorPath(source: DocumentCardBox, target: DocumentCardBox, backward: boolean, height: number): string {
  const start = (source.top + source.bottom) / 2, end = (target.top + target.bottom) / 2;
  const departure = source.right + 18, arrival = target.left - 18;
  const points: [number, number][] = [[source.right, start]];
  if (!backward && target.column === source.column + 1) {
    const middle = (source.right + target.left) / 2;
    points.push([middle, start], [middle, end]);
  } else {
    const gutter = backward ? height - 3 : end < start ? source.laneTop : source.laneBottom;
    points.push([departure, start], [departure, gutter], [arrival, gutter], [arrival, end]);
  }
  points.push([target.left - 2, end]);
  return points.map(([x, y], index) => `${index ? 'L' : 'M'} ${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`).join(' ');
}

/** Increase space for text instead of reducing its font or clipping a lane. */
export function expandedDocumentCardWidth(cardWidth: number, titleWidth: number, titleHeight: number, availableTitleHeight: number): number {
  if (titleHeight <= availableTitleHeight + 1) return cardWidth;
  const ratio = titleHeight / Math.max(1, availableTitleHeight);
  return Math.ceil((cardWidth - titleWidth + titleWidth * ratio + 16) / 16) * 16;
}

interface Drawing { width: number; height: number; paths: (ProcedureFlowLayoutEdge & { path: string })[] }
export function ProcedureFlowDocument({ workflow, participants, selectedId, onSelect, className = '' }: ProcedureFlowDocumentProps) {
  const layout = useMemo(() => buildProcedureFlowLayout(workflow), [workflow]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  const [viewportHeight, setViewportHeight] = useState(400);
  const [columnWidths, setColumnWidths] = useState<number[]>([]);
  const [drawing, setDrawing] = useState<Drawing>({ width: 0, height: 0, paths: [] });
  const markerId = `pfd-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const participant = (role: Role) => participants?.[role]?.trim() || participantFallbacks[role];
  const numberById = new Map(layout.nodes.map(node => [node.id, String(node.index + 1).padStart(2, '0')]));
  const widths = layout.rows.map((_, index) => columnWidths[index] || BASE_CARD_WIDTH);
  const dense = viewportHeight < 280, tight = viewportHeight < 180;

  useEffect(() => { setColumnWidths([]); }, [layout]);
  useEffect(() => {
    const scroll = scrollRef.current, body = bodyRef.current;
    if (!scroll || !body) return;
    let frame = 0, active = true;
    const measure = () => {
      if (!active) return;
      const height = scroll.clientHeight;
      if (height > 0 && Math.abs(height - viewportHeight) > 1) { setViewportHeight(height); setColumnWidths([]); return; }
      const origin = body.getBoundingClientRect();
      const boxes = new Map<string, DocumentCardBox>();
      const requiredWidths = layout.rows.map(() => BASE_CARD_WIDTH);
      let needsWider = false;
      for (const node of layout.nodes) {
        const card = cardRefs.current.get(node.id), lane = rowRefs.current.get(node.column);
        if (!card || !lane) continue;
        const rect = card.getBoundingClientRect(), laneRect = lane.getBoundingClientRect();
        boxes.set(node.id, { left: rect.left - origin.left, right: rect.right - origin.left, top: rect.top - origin.top, bottom: rect.bottom - origin.top, column: node.row, laneTop: laneRect.top - origin.top, laneBottom: laneRect.bottom - origin.top });
        const title = card.querySelector<HTMLElement>('.pfd-card-title');
        if (!title) continue;
        const style = getComputedStyle(card), titleStyle = getComputedStyle(title);
        const available = Math.max(parseFloat(titleStyle.lineHeight) || 23, card.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
        const nextWidth = expandedDocumentCardWidth(rect.width, title.clientWidth, title.scrollHeight, available);
        requiredWidths[node.row] = Math.max(requiredWidths[node.row], nextWidth);
        if (nextWidth > rect.width + 1) needsWider = true;
      }
      if (needsWider) { setColumnWidths(previous => requiredWidths.map((width, index) => Math.max(width, previous[index] || BASE_CARD_WIDTH))); return; }
      const next: Drawing = { width: body.clientWidth, height: body.clientHeight, paths: layout.edges.flatMap(edge => {
        const source = boxes.get(edge.source), target = boxes.get(edge.target);
        return source && target ? [{ ...edge, path: documentConnectorPath(source, target, edge.backward, body.clientHeight) }] : [];
      }) };
      setDrawing(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    schedule();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    observer?.observe(scroll); observer?.observe(body);
    for (const card of cardRefs.current.values()) observer?.observe(card);
    return () => { active = false; observer?.disconnect(); cancelAnimationFrame(frame); };
  }, [layout, viewportHeight, columnWidths]);

  useEffect(() => {
    if (!selectedId) return;
    const frame = requestAnimationFrame(() => {
      const scroll = scrollRef.current, card = cardRefs.current.get(selectedId);
      if (!scroll || !card) return;
      const viewport = scroll.getBoundingClientRect(), rect = card.getBoundingClientRect();
      const labelWidth = headerRef.current?.getBoundingClientRect().width || 0;
      const visibleLeft = viewport.left + labelWidth + 12, visibleRight = viewport.left + scroll.clientWidth - 12;
      let left = scroll.scrollLeft;
      if (rect.left < visibleLeft || rect.width > visibleRight - visibleLeft) left += rect.left - visibleLeft;
      else if (rect.right > visibleRight) left += rect.right - visibleRight;
      if (left !== scroll.scrollLeft) scroll.scrollTo({ left: Math.max(0, left), behavior: 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, layout, columnWidths]);

  if (!layout.nodes.length) return <div className="pfd-empty">등록된 절차가 없습니다.</div>;
  const bodyWidth = widths.reduce((sum, width) => sum + width, 0) + (widths.length - 1) * COLUMN_GAP + 48;
  return <div ref={scrollRef} className={`procedure-flow-document ${className}`.trim()} data-direction="horizontal" role="region" aria-label="역할별 업무 절차도, 왼쪽에서 오른쪽으로 진행" aria-description={layout.edges.some(edge => edge.backward) ? '점선은 앞 단계로 돌아가는 연결입니다.' : undefined} tabIndex={0}>
    <div className={`pfd-content${dense ? ' is-dense' : ''}${tight ? ' is-tight' : ''}`} style={{ '--pfd-roles': layout.columns.length, '--pfd-height': `${viewportHeight}px`, '--pfd-body-width': `${bodyWidth}px`, '--pfd-grid-columns': widths.map(width => `${width}px`).join(' ') } as CSSProperties}>
      <div ref={headerRef} className="pfd-role-header">{layout.columns.map(column => <div key={column.role} className={`pfd-role pfd-role-${column.role}`}><strong>{roleLabels[column.role]}</strong><span title={participant(column.role)}>{participant(column.role)}</span></div>)}</div>
      <div ref={bodyRef} className="pfd-body">
        <div className="pfd-lanes" aria-hidden="true">{layout.columns.map(column => <div key={column.role} className={`pfd-lane pfd-lane-${column.role}`}/>)}</div>
        {drawing.width > 0 && <svg className="pfd-connections" width={drawing.width} height={drawing.height} aria-hidden="true" focusable="false">
          <defs><marker id={markerId} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 9 4.5 L 0 9 z" fill="#55728e"/></marker><marker id={`${markerId}-return`} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 9 4.5 L 0 9 z" fill="#aa6b12"/></marker></defs>
          {drawing.paths.map(edge => <path key={edge.id} data-source={edge.source} data-target={edge.target} className={edge.backward ? 'is-backward' : undefined} d={edge.path} markerEnd={`url(#${markerId}${edge.backward ? '-return' : ''})`}/>)}
        </svg>}
        {layout.columns.map(column => <div key={column.role} ref={element => { if (element) rowRefs.current.set(column.index, element); else rowRefs.current.delete(column.index); }} className="pfd-row" data-row={column.index} data-role={column.role}>{layout.nodes.filter(node => node.column === column.index).map(node => {
          const step = workflow[node.index];
          const incoming = layout.edges.filter(edge => edge.target === node.id).map(edge => numberById.get(edge.source)!);
          const content = <><span className="pfd-step-number">{numberById.get(node.id)}</span><strong className="pfd-card-title">{step.title || '새 절차'}</strong></>;
          const shared = { 'data-step-id': node.id, 'data-role': node.role, 'aria-label': `${node.index + 1}. ${step.title || '새 절차'}, ${roleLabels[node.role]}, ${participant(node.role)}${incoming.length ? `, 선행 절차 ${incoming.join(', ')}` : ', 시작 절차'}`, className: `pfd-card pfd-card-${node.role}${selectedId === node.id ? ' is-selected' : ''}`, style: { gridColumn: node.row + 1 }, ref: (element: HTMLElement | null) => { if (element) cardRefs.current.set(node.id, element); else cardRefs.current.delete(node.id); } };
          return onSelect ? <button key={node.id} {...shared} type="button" aria-pressed={selectedId === node.id} onClick={() => onSelect(node.id)}>{content}</button> : <article key={node.id} {...shared}>{content}</article>;
        })}</div>)}
      </div>
    </div>
  </div>;
}

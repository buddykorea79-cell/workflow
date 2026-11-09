import type { WorkflowStep } from './types';

export type ProcedureFlowRole = WorkflowStep['role'];
export type ProcedureFlowLayoutInput = Pick<WorkflowStep, 'id' | 'role' | 'dependsOn'>;
export interface ProcedureFlowLayoutColumn { role: ProcedureFlowRole; index: number }
export interface ProcedureFlowLayoutNode {
  id: string;
  /** Index in the supplied workflow, including when duplicate IDs were skipped. */
  index: number;
  role: ProcedureFlowRole;
  column: number;
  row: number;
}
export interface ProcedureFlowLayoutEdge { id: string; source: string; target: string; backward: boolean }
export interface ProcedureFlowLayout {
  columns: ProcedureFlowLayoutColumn[];
  rows: { index: number; nodes: ProcedureFlowLayoutNode[] }[];
  nodes: ProcedureFlowLayoutNode[];
  edges: ProcedureFlowLayoutEdge[];
}

const roles: ProcedureFlowRole[] = ['primary', 'support', 'reviewer'];

/**
 * Logical grid for an unscaled document: one card per role/row, with predecessors
 * above their dependants. Rows deliberately have no pixel height. The renderer
 * uses natural card heights and measures the DOM for SVG connector coordinates.
 */
export function buildProcedureFlowLayout(workflow: readonly ProcedureFlowLayoutInput[]): ProcedureFlowLayout {
  const seen = new Set<string>();
  const steps = workflow.flatMap((step, index) => {
    if (!step.id || seen.has(step.id)) return [];
    seen.add(step.id);
    return [{ id: step.id, index, role: roles.includes(step.role) ? step.role : 'primary' as const, dependsOn: step.dependsOn }];
  });
  if (!steps.length) return { columns: [], rows: [], nodes: [], edges: [] };
  const byId = new Map(steps.map(step => [step.id, step]));
  const dependencies = new Map(steps.map(step => [step.id, [...new Set(step.dependsOn.filter(id => byId.has(id)))]]));
  const successors = new Map(steps.map(step => [step.id, [] as string[]]));
  for (const step of steps) for (const dependency of dependencies.get(step.id)!) successors.get(dependency)!.push(step.id);

  // Condense legacy cycles first. A blocked cycle must not hide its downstream
  // steps, and every original valid edge remains available to the renderer.
  let nextIndex = 0;
  const indices = new Map<string, number>(), lowest = new Map<string, number>();
  const stack: string[] = [], inStack = new Set<string>(), components: string[][] = [];
  function visit(id: string) {
    indices.set(id, nextIndex); lowest.set(id, nextIndex++); stack.push(id); inStack.add(id);
    for (const target of successors.get(id)!) {
      if (!indices.has(target)) { visit(target); lowest.set(id, Math.min(lowest.get(id)!, lowest.get(target)!)); }
      else if (inStack.has(target)) lowest.set(id, Math.min(lowest.get(id)!, indices.get(target)!));
    }
    if (lowest.get(id) !== indices.get(id)) return;
    const component: string[] = [];
    let current: string;
    do { current = stack.pop()!; inStack.delete(current); component.push(current); } while (current !== id);
    components.push(component.sort((a, b) => byId.get(a)!.index - byId.get(b)!.index));
  }
  for (const step of steps) if (!indices.has(step.id)) visit(step.id);

  const componentOf = new Map(components.flatMap((members, index) => members.map(id => [id, index] as const)));
  const incoming = components.map(() => new Set<number>()), outgoing = components.map(() => new Set<number>());
  for (const step of steps) for (const dependency of dependencies.get(step.id)!) {
    const from = componentOf.get(dependency)!, to = componentOf.get(step.id)!;
    if (from !== to) { incoming[to].add(from); outgoing[from].add(to); }
  }
  const columns = roles.filter(role => steps.some(step => step.role === role)).map((role, index) => ({ role, index }));
  const columnOf = new Map(columns.map(column => [column.role, column.index]));
  const nextRow = columns.map(() => 0), componentEnd = components.map(() => -1);
  const remaining = incoming.map(items => items.size);
  const ready = components.flatMap((_, index) => remaining[index] ? [] : [index]);
  const nodes: ProcedureFlowLayoutNode[] = [];
  while (ready.length) {
    ready.sort((a, b) => byId.get(components[a][0])!.index - byId.get(components[b][0])!.index);
    const component = ready.shift()!;
    let firstRow = Math.max(0, ...[...incoming[component]].map(previous => componentEnd[previous] + 1));
    for (const id of components[component]) {
      const step = byId.get(id)!, column = columnOf.get(step.role)!;
      const row = Math.max(firstRow, nextRow[column]);
      nodes.push({ id, index: step.index, role: step.role, column, row });
      nextRow[column] = row + 1; componentEnd[component] = Math.max(componentEnd[component], row);
      if (components[component].length > 1) firstRow = row + 1;
    }
    for (const next of outgoing[component]) if (--remaining[next] === 0) ready.push(next);
  }
  nodes.sort((a, b) => a.index - b.index);
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const rows = Array.from({ length: Math.max(...nodes.map(node => node.row)) + 1 }, (_, index) => ({ index, nodes: nodes.filter(node => node.row === index).sort((a, b) => a.column - b.column) }));
  const edges = steps.flatMap(step => dependencies.get(step.id)!.map(source => ({
    id: JSON.stringify([source, step.id]), source, target: step.id,
    backward: nodeById.get(source)!.row >= nodeById.get(step.id)!.row,
  })));
  return { columns, rows, nodes, edges };
}

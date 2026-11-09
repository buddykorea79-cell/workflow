import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProcedureFlowLayout, type ProcedureFlowLayout, type ProcedureFlowLayoutInput } from '../src/lib/procedure-flow-layout';

const step = (id: string, role: ProcedureFlowLayoutInput['role'], dependsOn: string[] = []): ProcedureFlowLayoutInput => ({ id, role, dependsOn });
function assertGrid(layout: ProcedureFlowLayout) {
  const cells = layout.nodes.map(node => `${node.row}:${node.column}`);
  assert.equal(new Set(cells).size, cells.length, 'cards never occupy the same role/row cell');
  assert.equal(layout.rows.flatMap(row => row.nodes).length, layout.nodes.length);
  for (const node of layout.nodes) {
    assert.equal(layout.columns[node.column].role, node.role);
    assert.ok(Number.isSafeInteger(node.row) && node.row >= 0);
    assert.ok(layout.rows[node.row].nodes.some(item => item.id === node.id));
  }
}
function assertDownward(layout: ProcedureFlowLayout) {
  const nodes = new Map(layout.nodes.map(node => [node.id, node]));
  for (const edge of layout.edges) {
    assert.ok(nodes.get(edge.target)!.row > nodes.get(edge.source)!.row, `${edge.source} precedes ${edge.target}`);
    assert.equal(edge.backward, false);
  }
}

test('roles become columns and long chains extend vertically without adding columns', () => {
  const workflow = Array.from({ length: 50 }, (_, index) => step(`step-${index}`, index % 3 === 0 ? 'primary' : index % 3 === 1 ? 'support' : 'reviewer', index ? [`step-${index - 1}`] : []));
  const before = structuredClone(workflow), layout = buildProcedureFlowLayout(workflow);
  assert.deepEqual(layout.columns.map(column => column.role), ['primary', 'support', 'reviewer']);
  assert.equal(layout.rows.length, 50); assert.equal(layout.nodes.length, 50); assert.equal(layout.edges.length, 49);
  assertGrid(layout); assertDownward(layout); assert.deepEqual(workflow, before);
  assert.ok(layout.nodes.every(node => !('height' in node) && !('width' in node)), 'card dimensions stay under natural DOM layout control');
});

test('parallel branches share rows across roles while same-role siblings and their merge stay distinct', () => {
  const layout = buildProcedureFlowLayout([
    step('prepare', 'primary'), step('first-check', 'support', ['prepare']),
    step('second-check', 'support', ['prepare']), step('parallel-review', 'reviewer', ['prepare']),
    step('merge', 'primary', ['first-check', 'second-check', 'parallel-review']),
  ]);
  const nodes = new Map(layout.nodes.map(node => [node.id, node]));
  assert.equal(nodes.get('first-check')!.row, nodes.get('parallel-review')!.row);
  assert.ok(nodes.get('second-check')!.row > nodes.get('first-check')!.row);
  assert.deepEqual(layout.edges.filter(edge => edge.target === 'merge').map(edge => edge.source), ['first-check', 'second-check', 'parallel-review']);
  assert.equal(layout.edges.some(edge => edge.source === 'first-check' && edge.target === 'second-check'), false, 'visual stacking does not invent a dependency');
  assertGrid(layout); assertDownward(layout);
});

test('dependency order wins over input order and independent same-role work never overlaps', () => {
  const workflow = Array.from({ length: 40 }, (_, index) => step(`task-${index}`, (['primary', 'support', 'reviewer'] as const)[index % 3], index > 2 ? [`task-${Math.floor(index / 2)}`, `task-${index - 3}`] : []));
  const reversed = [...workflow].reverse(), layout = buildProcedureFlowLayout(reversed);
  assert.equal(layout.nodes.length, reversed.length); assertGrid(layout); assertDownward(layout);
  assert.ok(layout.nodes.every(node => reversed[node.index].id === node.id), 'node index always references the original input');
  const independent = buildProcedureFlowLayout(Array.from({ length: 8 }, (_, index) => step(`parallel-${index}`, 'primary')));
  assert.equal(independent.columns.length, 1); assert.equal(independent.rows.length, 8); assert.equal(independent.edges.length, 0); assertGrid(independent);
  assert.deepEqual(buildProcedureFlowLayout(reversed), layout, 'layout is deterministic');
});

test('cycles keep every valid edge and their downstream work without recursion failure', () => {
  const layout = buildProcedureFlowLayout([
    step('before', 'primary'), step('cycle-a', 'support', ['before', 'cycle-c']),
    step('cycle-b', 'primary', ['cycle-a']), step('cycle-c', 'reviewer', ['cycle-b']),
    step('after', 'primary', ['cycle-a']), step('independent', 'support'),
  ]);
  assert.equal(layout.nodes.length, 6); assertGrid(layout);
  assert.deepEqual(layout.edges.map(({ source, target }) => [source, target]), [['before', 'cycle-a'], ['cycle-c', 'cycle-a'], ['cycle-a', 'cycle-b'], ['cycle-b', 'cycle-c'], ['cycle-a', 'after']]);
  assert.deepEqual(layout.edges.filter(edge => edge.backward).map(edge => [edge.source, edge.target]), [['cycle-c', 'cycle-a']]);
  const node = (id: string) => layout.nodes.find(item => item.id === id)!;
  assert.ok(node('after').row > Math.max(node('cycle-a').row, node('cycle-b').row, node('cycle-c').row));
});

test('empty, missing and duplicate IDs remain renderable while known self loops stay visible', () => {
  assert.deepEqual(buildProcedureFlowLayout([]), { columns: [], rows: [], nodes: [], edges: [] });
  const layout = buildProcedureFlowLayout([
    step('source', 'primary'), step('source', 'reviewer'), step('', 'support'),
    step('target', 'reviewer', ['missing', 'source', 'source', 'target']),
  ]);
  assert.deepEqual(layout.nodes.map(node => [node.id, node.index]), [['source', 0], ['target', 3]]);
  assert.deepEqual(layout.columns.map(column => column.role), ['primary', 'reviewer']);
  assert.deepEqual(layout.edges.map(edge => [edge.source, edge.target]), [['source', 'target'], ['target', 'target']]);
  assert.equal(layout.edges[0].backward, false); assert.equal(layout.edges[1].backward, true);
  assertGrid(layout);
});

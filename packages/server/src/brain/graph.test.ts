import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BrainKind } from '@tuffcode/contracts';
import { transaction } from '../db/index.js';
import type { UpsertBrainInput } from '../db/repos/index.js';
import { createTestContext, type TestContext } from '../test-support.js';
import { GRAPH_MAX_NODES, buildBrainGraph } from './graph.js';

const NOW = '2026-11-24T10:00:00.000Z';

describe('brain graph', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = createTestContext();
    for (const id of ['prj_a', 'prj_b']) {
      ctx.repos.projects.add({
        id,
        name: id,
        path: `C:/tmp/${id}`,
        defaultBranch: 'main',
        createdAt: NOW,
      });
    }
  });

  afterEach(() => {
    ctx.dispose();
  });

  function add(kind: BrainKind, text: string, extra: Partial<UpsertBrainInput> = {}) {
    return ctx.repos.brain.upsert({
      kind,
      scope: extra.projectId === undefined ? 'global' : 'project',
      text,
      ...extra,
    });
  }

  it('loads the project brain plus globals and skips other projects', () => {
    const global = add('memory', 'global fact');
    const project = add('project', 'Electron plus React', { projectId: 'prj_a' });
    const note = add('working-note', 'mid refactor of the selector', { projectId: 'prj_a' });
    const other = add('memory', 'beta only fact', { projectId: 'prj_b' });

    const graph = buildBrainGraph(ctx.repos.brain, { projectId: 'prj_a' });
    const ids = graph.nodes.map((node) => node.id);

    expect(ids).toContain(global.id);
    expect(ids).toContain(project.id);
    expect(ids).toContain(note.id);
    expect(ids).not.toContain(other.id);
    expect(graph.nodes.map((node) => node.kind)).toEqual(
      expect.arrayContaining(['memory', 'project', 'working-note']),
    );
  });

  it('labels nodes with the first 60 characters of the entry text', () => {
    const text = `start ${'x'.repeat(80)}`;
    const entry = add('memory', text);

    const [node] = buildBrainGraph(ctx.repos.brain, { projectId: 'prj_a' }).nodes;

    expect(node?.id).toBe(entry.id);
    expect(node?.label).toBe(text.slice(0, 60));
    expect(node?.label).toHaveLength(60);
  });

  it('computes degree from edges and keeps edges only between returned nodes', () => {
    const alpha = add('memory', 'alpha');
    const beta = add('memory', 'beta');
    const outside = add('memory', 'outside project', { projectId: 'prj_b' });
    const inactive = add('memory', 'turned off');
    ctx.repos.brain.upsert({
      id: inactive.id,
      kind: 'memory',
      scope: 'global',
      text: 'turned off',
      active: false,
    });

    ctx.repos.brain.upsertEdge({ from: alpha.id, to: beta.id, relation: 'about' });
    ctx.repos.brain.upsertEdge({ from: alpha.id, to: outside.id, relation: 'mentions' });
    ctx.repos.brain.upsertEdge({ from: alpha.id, to: inactive.id, relation: 'archived' });

    const graph = buildBrainGraph(ctx.repos.brain, { projectId: 'prj_a' });
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));

    expect(graph.edges).toEqual([{ from: alpha.id, to: beta.id, relation: 'about' }]);
    expect(byId.get(alpha.id)?.degree).toBe(1);
    expect(byId.get(beta.id)?.degree).toBe(1);
    expect(byId.has(outside.id)).toBe(false);
    expect(byId.has(inactive.id)).toBe(false);
  });

  it('counts a self relation once per endpoint', () => {
    const entry = add('memory', 'loops');
    ctx.repos.brain.upsertEdge({ from: entry.id, to: entry.id, relation: 'related' });

    const [node] = buildBrainGraph(ctx.repos.brain, { projectId: 'prj_a' }).nodes;

    expect(node?.degree).toBe(2);
  });

  it('caps nodes at 300 by importance and keeps the project anchor', () => {
    transaction(ctx.db, () => {
      for (let index = 0; index < GRAPH_MAX_NODES + 20; index += 1) {
        ctx.repos.brain.upsert({
          kind: 'memory',
          scope: 'global',
          text: `memory ${index}`,
          importance: index / (GRAPH_MAX_NODES + 20),
        });
      }
    });
    const anchor = add('project', 'low importance but the project itself', {
      projectId: 'prj_a',
      importance: 0,
    });

    const graph = buildBrainGraph(ctx.repos.brain, { projectId: 'prj_a' });

    expect(graph.nodes).toHaveLength(GRAPH_MAX_NODES);
    expect(graph.nodes.map((node) => node.id)).toContain(anchor.id);
    for (let index = 1; index < graph.nodes.length; index += 1) {
      expect(graph.nodes[index - 1]!.importance).toBeGreaterThanOrEqual(
        graph.nodes[index]!.importance,
      );
    }
  });

  it('honors a smaller limit and never exceeds the 300 node cap', () => {
    for (let index = 0; index < 10; index += 1) add('memory', `memory ${index}`);

    expect(buildBrainGraph(ctx.repos.brain, { projectId: 'prj_a', limit: 4 }).nodes).toHaveLength(
      4,
    );
    expect(
      buildBrainGraph(ctx.repos.brain, { projectId: 'prj_a', limit: 500 }).nodes.length,
    ).toBeLessThanOrEqual(GRAPH_MAX_NODES);
  });

  it('builds a graph for the whole brain when no project is given', () => {
    const alpha = add('memory', 'alpha fact', { projectId: 'prj_a' });
    const beta = add('memory', 'beta fact', { projectId: 'prj_b' });

    const ids = buildBrainGraph(ctx.repos.brain).nodes.map((node) => node.id);

    expect(ids).toContain(alpha.id);
    expect(ids).toContain(beta.id);
  });
});

import { describe, expect, test } from 'bun:test';
import { defaultPanels, movePanelItem } from './panels';
import { parseWorkspaces, removeWorkspace, withWorkspace } from './workspaces';

const panels = defaultPanels('studio');

describe('saved arrangements', () => {
  test('a workspace keeps the panels and where the windows sit', () => {
    const list = withWorkspace([], 'Планшет', panels, { palette: { x: 10, y: 20 } });
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Планшет');
    expect(list[0].panels.left).toEqual(panels.left);
    expect(list[0].floatPos.palette).toEqual({ x: 10, y: 20 });
  });

  test('saving under a name that exists replaces it, and keeps its place', () => {
    const moved = movePanelItem(panels, 'onion', 'left', 0);
    const list = withWorkspace(withWorkspace([], 'A', panels, {}), 'B', panels, {});
    const again = withWorkspace(list, 'A', moved, {});
    expect(again).toHaveLength(2);
    expect(again[0].name).toBe('A');
    expect(again[0].panels.left[0]).toBe('onion');
  });

  test('a workspace goes away by id', () => {
    const list = withWorkspace([], 'A', panels, {});
    expect(removeWorkspace(list, list[0].id)).toEqual([]);
  });

  test('stored rubbish is not a workspace', () => {
    expect(parseWorkspaces(null, 'studio')).toEqual([]);
    expect(parseWorkspaces('not json', 'studio')).toEqual([]);
    expect(parseWorkspaces('{"a":1}', 'studio')).toEqual([]);
    expect(parseWorkspaces('[{"name":"","panels":{}}]', 'studio')).toEqual([]);
  });

  test('a stored arrangement is cleaned the way a live one is', () => {
    const raw = JSON.stringify([{ id: 3, name: 'A', panels: { left: ['nope'] }, floatPos: { x: 'bad' } }]);
    const [workspace] = parseWorkspaces(raw, 'studio');
    expect(workspace.panels.left).not.toContain('nope');
    // Every item still has a home, as with any normalized layout.
    expect(workspace.panels.left).toContain('tool:pencil');
    expect(workspace.floatPos).toEqual({});
  });
});

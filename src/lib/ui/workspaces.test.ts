import { describe, expect, test } from 'bun:test';
import { defaultPanels, movePanelItem } from './panels';
import {
  exportWorkspace,
  importWorkspaces,
  parseWorkspaces,
  removeWorkspace,
  withWorkspace,
} from './workspaces';

const panels = defaultPanels();

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
    expect(parseWorkspaces(null)).toEqual([]);
    expect(parseWorkspaces('not json')).toEqual([]);
    expect(parseWorkspaces('{"a":1}')).toEqual([]);
    expect(parseWorkspaces('[{"name":"","panels":{}}]')).toEqual([]);
  });

  test('a stored arrangement is cleaned the way a live one is', () => {
    const raw = JSON.stringify([{ id: 3, name: 'A', panels: { left: ['nope'] }, floatPos: { x: 'bad' } }]);
    const [workspace] = parseWorkspaces(raw);
    expect(workspace.panels.left).not.toContain('nope');
    // Every item still has a home, as with any normalized layout.
    expect(workspace.panels.left).toContain('tool:pencil');
    expect(workspace.floatPos).toEqual({});
  });

  test('the file carries the one arrangement it was given', () => {
    const moved = movePanelItem(panels, 'onion', 'left', 0);
    const file = parseWorkspaces(exportWorkspace('Планшет', moved, { palette: { x: 1, y: 2 } }));
    expect(file.map((w) => w.name)).toEqual(['Планшет']);
    expect(file[0].panels.left[0]).toBe('onion');
    expect(file[0].floatPos.palette).toEqual({ x: 1, y: 2 });
  });

  test('loading a file adds its arrangements, replacing ones of the same name', () => {
    const mine = withWorkspace(withWorkspace([], 'A', panels, {}), 'B', panels, {});
    const moved = movePanelItem(panels, 'onion', 'left', 0);
    const raw = exportWorkspace('B', moved, {});
    const { workspaces, loaded } = importWorkspaces(mine, raw);
    expect(loaded).toBe(1);
    expect(workspaces.map((w) => w.name)).toEqual(['A', 'B']);
    expect(workspaces[1].panels.left[0]).toBe('onion');
  });

  test('a file with no arrangements loads nothing', () => {
    const mine = withWorkspace([], 'A', panels, {});
    expect(importWorkspaces(mine, 'not json')).toEqual({ workspaces: mine, loaded: 0 });
  });
});

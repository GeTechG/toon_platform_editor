import { describe, expect, it } from 'bun:test';
import { plugins } from '../plugins';
import { brushOfType, brushTypesFor } from '../plugins/brush-types';
import { loadUiConfig, parseUiConfig, presetExists, presetPanels, presets, saveUiConfig } from './presets';
import { tourPages } from './tour';

// The owner, 2026-10-31: the Multator and Toonio arrangements are gone, what
// they brought stays. A config written under one of them opens as toonop.
void plugins;

const stored = (fields: Record<string, unknown>) => JSON.stringify(fields);

describe('the Multator and Toonio presets are retired', () => {
  it('the editor offers its own preset alone', () => {
    expect(presets().map((preset) => preset.id)).toEqual(['toonop']);
    expect(presetExists('multator')).toBe(false);
    expect(presetExists('toonio')).toBe(false);
  });

  for (const preset of ['multator', 'toonio']) {
    it(`a config left under ${preset} opens as toonop, on toonop's arrangement`, () => {
      const config = parseUiConfig(stored({
        preset,
        moves: [{ id: 'color', to: 'rows', row: 0, at: 0 }],
        panels: { left: [], right: [], top: [], rows: [['timeline']], float: [], hidden: [] },
        floatPos: { onion: { x: 10, y: 20 } },
        drawing: {
          panelHeight: 400,
          panelCollapsed: true,
          sides: { left: { width: 80, collapsed: true }, right: { width: 300, collapsed: true } },
        },
      }))!;
      expect(config.preset).toBe('toonop');
      expect(config.panels).toEqual(presetPanels('toonop'));
      expect(config.floatPos).toEqual({});
      expect(config.drawing.panelHeight).toBeNull();
      expect(config.drawing.panelCollapsed).toBe(false);
      expect(config.drawing.sides.right).toEqual({ width: null, collapsed: false });
    });

    it(`what a hand set under ${preset} is kept: the brushes, the settings, the finished tour`, () => {
      const config = parseUiConfig(stored({
        preset,
        tourDone: true,
        settings: { letterKeys: false },
        drawing: { byTool: { pencil: { width: 77, smooth: 5, minDistance: 2 } } },
      }))!;
      expect(config.drawing.byTool.pencil).toEqual({ width: 77, smooth: 5, minDistance: 2 });
      expect(config.settings.letterKeys).toBe(false);
      expect(config.tourDone).toBe(true);
    });
  }

  it('a Multator hand keeps the multator line', () => {
    const config = parseUiConfig(stored({ preset: 'multator', drawing: { brushType: 'multator' } }))!;
    expect(config.drawing.brushType).toBe('multator');
    expect(config.drawing.defaultBrush).toBe('toonop-brush');
  });

  it('a Multator config that never stored a type still opens with that line, as the preset did', () => {
    const config = parseUiConfig(stored({ preset: 'multator' }))!;
    expect(config.drawing.brushType).toBe('multator');
  });

  it('a Toonio hand moves to the everyday brush: the owner dropped the line, it was that brush with two faults (2026-10-31)', () => {
    expect(parseUiConfig(stored({ preset: 'toonio' }))!.drawing.brushType).toBe('normal');
    expect(parseUiConfig(stored({ preset: 'toonio', drawing: { brushType: 'normal' } }))!.drawing.brushType).toBe('normal');
  });

  it('a type picked by hand under Toonio stays picked', () => {
    expect(parseUiConfig(stored({ preset: 'toonio', drawing: { brushType: 'old' } }))!.drawing.brushType).toBe('old');
  });

  it('a preset a plugin brought is still waited for: only the two retired ones are rewritten', () => {
    expect(parseUiConfig(stored({ preset: 'from-a-plugin' }))!.preset).toBe('from-a-plugin');
  });
});

describe('a tab that did not rearrange writes the config back', () => {
  it('leaves the retired preset’s arrangement behind: over toonop’s start it would be nonsense', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    const old = stored({ preset: 'multator', panels: { left: [], right: [], top: [], rows: [['manual', 'timeline', 'color']], float: [], hidden: [] } });
    store.set('toon-editor:ui', old);
    saveUiConfig(parseUiConfig(old)!, false);
    const back = loadUiConfig()!;
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(back.preset).toBe('toonop');
    expect(back.panels).toEqual(presetPanels('toonop'));
  });
});

describe('the Toonio line left with its preset', () => {
  it('is no type of the brush and no brush of the register', () => {
    expect(brushOfType('pencil', 'toonio')).toBe('pencil');
    expect(brushOfType('eraser', 'toonio')).toBe('eraser');
    expect(brushTypesFor('pencil').map((type) => type.id)).toEqual(['normal', 'old', 'multator']);
    expect(plugins.tool('toonio-brush')).toBeUndefined();
    expect(plugins.tool('toonio-eraser')).toBeUndefined();
  });
});

describe('the tour asks nothing when there is nothing to choose', () => {
  it('the choice closes the tour only with a second preset to pick', () => {
    expect(tourPages(true, true, 1)).not.toContain('layout');
    expect(tourPages(true, true, 2).at(-1)).toBe('layout');
  });
});

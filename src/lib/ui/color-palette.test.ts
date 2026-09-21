import { describe, expect, it } from 'bun:test';
import type { ToolDescriptor, ToonDocument } from '../format/types';
import {
  PALETTE_LIMIT,
  TONIO_DEFAULT_PALETTE,
  addPaletteColor,
  contrastInk,
  exportPalettes,
  importPalettes,
  loadPalette,
  mergePalettes,
  parseSavedPalettes,
  removePaletteColor,
  stealPalette,
  withSavedPalette,
} from './color-palette';
import { t } from '../i18n';

describe('TONIO_DEFAULT_PALETTE', () => {
  it('is the reference palette of 30 colors', () => {
    expect(TONIO_DEFAULT_PALETTE).toHaveLength(30);
    expect(TONIO_DEFAULT_PALETTE[0]).toBe('#000000');
    expect(TONIO_DEFAULT_PALETTE[5]).toBe('#ffffff');
    expect(TONIO_DEFAULT_PALETTE.at(-1)).toBe('#ff7fb6');
  });
});

const grid = (n: number) => Array.from({ length: n }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`);

describe('addPaletteColor', () => {
  it('appends a new color, leaving the overwrite cursor where it was', () => {
    expect(addPaletteColor(['#000000'], '#123456')).toEqual({ palette: ['#000000', '#123456'], cursor: 0 });
  });

  it('normalizes case and keeps a color it already has', () => {
    expect(addPaletteColor(['#123456'], '#123456').palette).toEqual(['#123456']);
    expect(addPaletteColor(['#123456'], '#123456'.toUpperCase()).palette).toEqual(['#123456']);
  });

  it('overwrites the cell at the cursor once the palette is full', () => {
    const full = grid(PALETTE_LIMIT);
    const one = addPaletteColor(full, '#ff0000', PALETTE_LIMIT, 0);
    expect(one.palette).toHaveLength(PALETTE_LIMIT);
    expect(one.palette[0]).toBe('#ff0000');
    expect(one.palette.slice(1)).toEqual(full.slice(1));
    expect(one.cursor).toBe(1);

    const two = addPaletteColor(one.palette, '#00ff00', PALETTE_LIMIT, one.cursor);
    expect(two.palette[0]).toBe('#ff0000');
    expect(two.palette[1]).toBe('#00ff00');
    expect(two.palette.slice(2)).toEqual(full.slice(2));
    expect(two.cursor).toBe(2);
  });

  it('wraps the cursor back to the first cell at the end of the grid', () => {
    const full = grid(3);
    expect(addPaletteColor(full, '#ffffff', 3, 2)).toEqual({
      palette: ['#000000', '#000001', '#ffffff'],
      cursor: 0,
    });
  });
});

describe('removePaletteColor', () => {
  it('drops the color, ignoring case, and leaves an unknown one alone', () => {
    expect(removePaletteColor(['#000000', '#ff0000'], '#FF0000')).toEqual(['#000000']);
    expect(removePaletteColor(['#000000'], '#123456')).toEqual(['#000000']);
  });
});

describe('mergePalettes', () => {
  it('appends only the colors the palette lacks', () => {
    const merged = mergePalettes(['#000000'], ['#000000', '#ff0000', '#00ff00'], 50);
    expect(merged.palette).toEqual(['#000000', '#ff0000', '#00ff00']);
    expect(merged.added).toBe(2);
    expect(merged.skipped).toBe(0);
  });

  it('stops at the limit and reports what did not fit', () => {
    const merged = mergePalettes(['#000000'], ['#ff0000', '#00ff00', '#0000ff'], 3);
    expect(merged.palette).toEqual(['#000000', '#ff0000', '#00ff00']);
    expect(merged.added).toBe(2);
    expect(merged.skipped).toBe(1);
  });
});

describe('saved palettes', () => {
  it('parses the reference toonio_saved_palettes shape and drops malformed colors', () => {
    const raw = JSON.stringify([
      { id: 0, name: 'Тёплая', created: 5, colours: ['#FF0000', 'red', '#00ff00'] },
      { name: 'no id' },
    ]);
    expect(parseSavedPalettes(raw)).toEqual([
      { id: 0, name: 'Тёплая', created: 5, colours: ['#ff0000', '#00ff00'] },
    ]);
    expect(parseSavedPalettes('garbage')).toEqual([]);
    expect(parseSavedPalettes(null)).toEqual([]);
  });

  it('appends a named copy of the colors with a fresh id', () => {
    const list = withSavedPalette([{ id: 3, name: 'a', created: 1, colours: ['#000000'] }], 'b', ['#ffffff']);
    expect(list).toHaveLength(2);
    expect(list[1].name).toBe('b');
    expect(list[1].colours).toEqual(['#ffffff']);
    expect(list[1].id).toBe(4);
  });
});

describe('contrastInk', () => {
  it('is black on light colors and white on dark ones', () => {
    expect(contrastInk('#ffffff')).toBe('#000');
    expect(contrastInk('#ffd800')).toBe('#000');
    expect(contrastInk('#000000')).toBe('#fff');
    expect(contrastInk('#0026ff')).toBe('#fff');
  });
});

describe('the palette limit from the settings', () => {
  it('appends up to the limit it is given', () => {
    expect(addPaletteColor(['#000000'], '#123456', 30).palette).toEqual(['#000000', '#123456']);
  });

  it('overwrites from the first cell once the grid is at its limit', () => {
    const full = ['#000000', '#111111', '#222222'];
    expect(addPaletteColor(full, '#ffffff', 3).palette).toEqual(['#ffffff', '#111111', '#222222']);
  });

  it('brings a grid saved under a larger limit back down, replacing from the start', () => {
    const wide = grid(60);
    const grown = addPaletteColor(wide, '#ffffff', 30);
    expect(grown.palette).toHaveLength(30);
    expect(grown.palette[0]).toBe('#ffffff');
    expect(grown.palette.slice(1)).toEqual(wide.slice(1, 30));
  });
});

describe('exportPalettes / importPalettes', () => {
  it('round-trips the saved palettes through the reference file format', () => {
    const list = withSavedPalette([], 'мои', ['#000000', '#FF0000']);
    expect(parseSavedPalettes(exportPalettes(list))).toEqual(list);
  });

  it('gives imported palettes ids of their own so they never collide', () => {
    const mine = withSavedPalette([], 'мои', ['#000000']);
    const file = exportPalettes(withSavedPalette([], 'чужие', ['#ff0000']));
    const { palettes, loaded } = importPalettes(mine, file);
    expect(loaded).toBe(1);
    expect(palettes).toHaveLength(2);
    expect(new Set(palettes.map((p) => p.id)).size).toBe(2);
    expect(palettes[1]?.colours).toEqual(['#ff0000']);
  });

  it('drops broken entries and invalid colors, and reports what was loaded', () => {
    const file = JSON.stringify([
      { id: 0, name: 'ок', created: 1, colours: ['#00ff00', 'red'] },
      { name: 'без id', colours: ['#000000'] },
      'мусор',
    ]);
    const { palettes, loaded } = importPalettes([], file);
    expect(loaded).toBe(1);
    expect(palettes[0]?.colours).toEqual(['#00ff00']);
  });

  it('reports nothing loaded from a file that is not a palette export', () => {
    expect(importPalettes([], '{')).toEqual({ palettes: [], loaded: 0 });
  });
});

describe('loadPalette', () => {
  it('keeps a grid saved under a raised limit instead of cutting it to the default', () => {
    // bun test has no DOM; a Map is all loadPalette asks of localStorage.
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    try {
      const wide = Array.from({ length: 200 }, (_, i) => `#${i.toString(16).padStart(6, '0')}`);
      store.set('toon-editor:palette', JSON.stringify(wide));
      expect(loadPalette()).toEqual(wide);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('stealPalette', () => {
  /** A document whose tool table carries the colours to steal. */
  const doc = (tools: ToolDescriptor[]): ToonDocument => ({
    schema_version: 7,
    width: 10240,
    height: 5760,
    frame_rate: 12,
    tools,
    layers: [{ hidden: false, frames: [{ strokes: [] }] }],
  });

  it('appends the colours of the opened document the grid lacks', () => {
    const stolen = stealPalette(['#000000'], doc([
      { kind: 'pencil', geometry: 'smooth', width: 40, color: '#Ff0000' },
      { kind: 'eraser', geometry: 'smooth', width: 40 },
      { kind: 'feather', geometry: 'smooth', width: 40, color: '#00ff00', fill: '#0000ff' },
      { kind: 'pencil', geometry: 'smooth', width: 8, color: '#000000' },
    ]), 50);
    expect(stolen).toEqual(['#000000', '#ff0000', '#00ff00', '#0000ff']);
  });

  it('stops at the limit and leaves the grid alone when it has them all', () => {
    expect(stealPalette(['#000000'], doc([
      { kind: 'pencil', geometry: 'smooth', width: 40, color: '#ff0000' },
      { kind: 'pencil', geometry: 'smooth', width: 40, color: '#00ff00' },
    ]), 2)).toEqual(['#000000', '#ff0000']);
    expect(stealPalette(['#ff0000'], doc([
      { kind: 'pencil', geometry: 'smooth', width: 40, color: '#ff0000' },
    ]), 50)).toEqual(['#ff0000']);
  });
});

describe('a palette is a set: one swatch per colour', () => {
  it('mergePalettes drops repeats inside the incoming list, not just the ones already there', () => {
    // The grid is keyed by colour, so a repeat is not a cosmetic duplicate —
    // it takes the whole editor down with `each_key_duplicate`.
    const merged = mergePalettes(['#000000'], ['#e2e8f0', '#E2E8F0', '#000000', '#ff0000'], 50);
    expect(merged.palette).toEqual(['#000000', '#e2e8f0', '#ff0000']);
    expect(merged.added).toBe(2);
  });

  it('stealPalette takes a colour used by two tools only once', () => {
    const doc: ToonDocument = {
      schema_version: 7,
      width: 10240,
      height: 5760,
      frame_rate: 12,
      tools: [
        { kind: 'pencil', geometry: 'smooth', width: 40, color: '#e2e8f0' },
        { kind: 'pencil', geometry: 'smooth', width: 144, color: '#e2e8f0' },
        { kind: 'feather', geometry: 'smooth', width: 40, color: '#e2e8f0', fill: '#e2e8f0' },
      ],
      layers: [{ hidden: false, frames: [{ strokes: [] }] }],
    };
    const stolen = stealPalette(['#000000'], doc, 50);
    expect(stolen).toEqual(['#000000', '#e2e8f0']);
    expect(new Set(stolen).size).toBe(stolen.length);
  });

  it('a grid saved with duplicates in it comes back clean', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    try {
      store.set('toon-editor:palette', JSON.stringify(['#000000', '#e2e8f0', '#e2e8f0', '#ff0000']));
      expect(loadPalette()).toEqual(['#000000', '#e2e8f0', '#ff0000']);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

// The picker and the palette box are Svelte components: asserted as source,
// the same contract style as settings-sheet.test.ts.
const picker = await Bun.file(new URL('./ColourPicker.svelte', import.meta.url)).text();
const paletteBox = await Bun.file(new URL('./PaletteBox.svelte', import.meta.url)).text();
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

describe('the colour picker follows the reference window', () => {
  it('applies the hex field on every keystroke, not only on Enter', () => {
    expect(picker).toMatch(/oninput=\{[^}]*typeHex/);
    expect(picker).toMatch(/function typeHex[^]{0,200}normalizeHexInput/);
  });

  it('shows the R/G/B fields and hides the bar in the rgb model only', () => {
    expect(picker).toContain("{#if model === 'rgb'}");
    expect(picker).toContain("{#if model !== 'rgb'}");
  });

  it('reads a surface drag through the model geometry', () => {
    expect(picker).toContain('surfaceToPointer(model, pointer,');
  });

  it('remembers which of the surface and the bar the arrows drive', () => {
    expect(picker).toContain('onpointerup');
    expect(picker).toContain('target: lastTarget');
  });

  it('takes its model from the settings and writes the choice back', () => {
    expect(picker).toContain('onmodel(next)');
    expect(paletteBox).toContain("editor.setSetting('pickerModel'");
    expect(paletteBox).toContain('model={editor.settings.pickerModel}');
  });

  it('closes with a revert flag on Esc and without one otherwise', () => {
    expect(picker).toContain('onclose: (options?: { revert?: boolean }) => void');
    expect(picker).toContain('onclose({ revert: true })');
    expect(picker).toMatch(/e\.key === 'Enter'[^]{0,400}onclose\(\)/);
  });

  it('opens under the swatch, clamped to the viewport', () => {
    expect(paletteBox).toContain('r.bottom + 6');
    expect(paletteBox).toContain('window.innerHeight');
  });
});

describe('the palette box follows the reference palette', () => {
  it('puts the original colour back on a revert, without touching the grid', () => {
    expect(paletteBox).toMatch(/options\?\.revert[^]{0,80}pickColor\(origin, target, true\)/);
  });

  it('adds the picked colour to the grid on close only while auto-add is on', () => {
    expect(paletteBox).toContain('editor.settings.paletteAutoAdd');
  });

  it('asks before a merge that would overflow, then reports what was added', () => {
    expect(paletteBox).toMatch(/skipped > 0[^]{0,200}confirm\(/);
    expect(paletteBox).toContain('editor.settings.paletteLimit');
    expect(paletteBox).toContain("t('palette.added'");
    expect(t('palette.added', { added: 3 })).toContain('Добавлено');
    expect(paletteBox).not.toContain('PALETTE_LIMIT');
  });

  it('says nothing fits when the grid is already full, instead of asking and reporting zero', () => {
    expect(paletteBox).toMatch(/added === 0[^]{0,400}return;[^]{0,200}skipped > 0[^]{0,200}confirm\(/);
    expect(paletteBox).toContain("t('palette.full'");
    expect(t('palette.full', { limit: 30, skipped: 2 })).toContain('Палитра заполнена');
  });

  it('shows the remover hint once, then remembers that it did', () => {
    expect(paletteBox).toContain('removerTipShown');
    expect(paletteBox).toContain("alert(t('palette.remover_hint'))");
    expect(t('palette.remover_hint')).toContain('цвет');
  });

  it('scrolls the grid to the cell of the chosen outline', () => {
    expect(paletteBox).toContain("scrollIntoView({ block: 'nearest'");
  });

  it('gives the foot pipette a right button that picks into the fill', () => {
    expect(paletteBox).toMatch(/oncontextmenu=\{[^}]*selectTool\('pipette', 'fill'\)/);
    // The canvas pick honours that target as well as the button it is made with.
    expect(state).toContain("pipetteTarget = $state<'outline' | 'fill'>('outline')");
    expect(canvas).toContain("editor.pipetteTarget === 'fill'");
  });
});

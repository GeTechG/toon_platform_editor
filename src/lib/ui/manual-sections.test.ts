import { describe, expect, it } from 'bun:test';
import { manualSections, searchManual, type ManualContext, type ManualRow } from './manual-sections';

const context = (patch: Partial<ManualContext> = {}): ManualContext => ({
  input: 'cursor',
  tools: [
    { id: 'pencil', label: 'Кисть' },
    { id: 'bucket', label: 'Заливка' },
    { id: 'drag', label: 'Рука' },
    { id: 'lasso', label: 'Трансформация' },
    { id: 'loop', label: 'Лассо' },
    { id: 'my-plugin', label: 'Штамп' },
  ],
  quickPalette: false,
  hasProjectFile: false,
  fullscreen: true,
  toolOpensBrush: true,
  keysOf: (command) => (command === 'undo' ? ['Z', 'Ctrl+Z'] : command === 'tool:pencil' ? ['B'] : []),
  ...patch,
});

const ids = (rows: readonly ManualRow[]): string[] => rows.map((row) => row.id);
const section = (id: string, ctx = context()) => manualSections(ctx).find((one) => one.id === id);
const kinds = (ctx: ManualContext) => new Set(manualSections(ctx).flatMap((one) => one.rows.map((row) => row.kind)));

describe('sections go by task, not by input device', () => {
  it('undo and the clipboard are edits, not frames', () => {
    expect(ids(section('edit')!.rows)).toEqual(expect.arrayContaining(['undo', 'redo', 'copy', 'paste', 'cut']));
    expect(ids(section('frames')!.rows)).not.toContain('undo');
  });

  it('the preview has a section of its own', () => {
    expect(ids(section('preview')!.rows)).toEqual(expect.arrayContaining(['play', 'play-from-active']));
  });

  it('a mouse move stands with the task it serves', () => {
    expect(ids(section('sheet')!.rows)).toEqual(expect.arrayContaining(['mouse.wheel', 'mouse.middle']));
    expect(ids(section('frames')!.rows)).toContain('mouse.frame_menu');
    expect(ids(section('draw')!.rows)).toContain('mouse.shift_drag');
  });

  it('a plugin tool is listed with the drawing tools, and can be given a key', () => {
    expect(section('draw')!.rows.find((row) => row.id === 'tool:my-plugin')).toMatchObject({ kind: 'command', command: 'tool:my-plugin', label: 'Штамп' });
  });
});

describe('the sheet says what is true of this studio', () => {
  it('a tool off the panel has no row', () => {
    expect(ids(section('sheet')!.rows)).toContain('tool:drag');
    const noHand = context({ tools: [{ id: 'pencil', label: 'Кисть' }] });
    expect(ids(section('sheet', noHand)!.rows)).not.toContain('tool:drag');
    expect(manualSections(noHand).find((one) => one.id === 'selection')?.rows.some((row) => row.id === 'tool:lasso')).toBeFalsy();
  });

  it('the pipette is always there: its key works without a tool on the panel', () => {
    expect(ids(section('colour')!.rows)).toContain('tool:pipette');
  });

  it('fullscreen is left out where there is none', () => {
    expect(ids(section('sheet')!.rows)).toContain('fullscreen');
    expect(ids(section('sheet', context({ fullscreen: false }))!.rows)).not.toContain('fullscreen');
  });

  it('a section with nothing to say is not drawn', () => {
    const noLasso = context({ tools: [{ id: 'pencil', label: 'Кисть' }] });
    expect(manualSections(noLasso).map((one) => one.id)).not.toContain('selection');
  });
});

describe('what shows for each kind of hand', () => {
  it('under a cursor: keys and the mouse, no fingers', () => {
    const seen = kinds(context());
    expect(seen.has('command')).toBe(true);
    expect(seen.has('mouse')).toBe(true);
    expect(seen.has('gesture')).toBe(false);
  });

  it('under fingers alone: gestures and nothing else, no thirty keys the phone lacks', () => {
    const seen = kinds(context({ input: 'finger' }));
    expect([...seen]).toEqual(['gesture']);
  });

  it('fingers with a keyboard by them: gestures first, keys after, no mouse', () => {
    const ctx = context({ input: 'both' });
    const seen = kinds(ctx);
    expect(seen.has('gesture') && seen.has('command')).toBe(true);
    expect(seen.has('mouse')).toBe(false);
    const rows = section('frames', ctx)!.rows;
    expect(rows[0].kind).toBe('gesture');
  });

  it('a repeat press on a tool is named only where it opens the brush', () => {
    expect(ids(section('draw')!.rows)).toContain('mouse.tool_again');
    expect(ids(section('draw', context({ toolOpensBrush: false }))!.rows)).not.toContain('mouse.tool_again');
  });
});

describe('search', () => {
  const sections = manualSections(context());

  it('finds across sections by the words of the action', () => {
    const found = searchManual(sections, 'отмен', context().keysOf);
    expect(found.flatMap((one) => ids(one.rows))).toContain('undo');
    expect(found.every((one) => one.rows.length > 0)).toBe(true);
  });

  it('ignores case and ё', () => {
    const lower = searchManual(sections, 'ЗАЛИВКА', context().keysOf).flatMap((one) => ids(one.rows));
    expect(lower).toContain('tool:bucket');
    const yo = searchManual(manualSections(context({ tools: [{ id: 'x', label: 'Ёжик' }] })), 'ежик', context().keysOf);
    expect(yo.flatMap((one) => ids(one.rows))).toContain('tool:x');
  });

  it('finds a key by its name, spaced or not', () => {
    for (const query of ['ctrl+z', 'Ctrl + Z']) {
      expect(searchManual(sections, query, context().keysOf).flatMap((one) => ids(one.rows))).toContain('undo');
    }
  });

  it('nothing found is an empty list, and an empty query is everything', () => {
    expect(searchManual(sections, 'qqqqzz', context().keysOf)).toEqual([]);
    expect(searchManual(sections, '   ', context().keysOf)).toEqual(sections);
  });
});

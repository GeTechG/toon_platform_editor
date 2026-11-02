import { describe, expect, it } from 'bun:test';
import { t } from '../i18n';
import { buildKeymap, chordLabel, studioCommands } from './keymap';
import { manualSections, type ManualContext } from './manual-sections';
import { toolKeyList, toolOrder } from './panels';
import ru from '../i18n/ru.json';

// The manual is a mirror of the key handler. It used to be written once for
// the old default and footnote the Toonio meaning in brackets — and then the
// default grew a feather, so it promised fullscreen on F while F picked the pen.
const box = await Bun.file(new URL('./PaletteBox.svelte', import.meta.url)).text();
const keys = buildKeymap(studioCommands(toolOrder().map((id) => ({ id, keys: toolKeyList(id) }))), {});
const manual = (patch: Partial<ManualContext> = {}) =>
  manualSections({
    input: 'cursor',
    tools: toolOrder().map((id) => ({ id, label: id })),
    quickPalette: false,
    hasProjectFile: false,
    fullscreen: true,
    toolOpensBrush: false,
    keysOf: (command) => keys.bindings(command).map(chordLabel),
    ...patch,
  });
const rowsOf = (section: string, patch: Partial<ManualContext> = {}) => manual(patch).find((one) => one.id === section)?.rows ?? [];
const idsOf = (section: string, patch: Partial<ManualContext> = {}) => rowsOf(section, patch).map((row) => row.id);

describe('the manual says what each key does in this studio', () => {
  it('names no other preset in brackets', () => {
    for (const line of Object.values(ru.key)) expect(line).not.toContain('Toonio');
  });

  it('F reads as the pen where the pen is on the panel, fullscreen elsewhere', () => {
    const onPanel = () => true;
    const offPanel = (id: string) => id !== 'tool:feather';
    expect(keys.resolve('f', { available: onPanel })).toBe('tool:feather');
    expect(keys.resolve('f', { available: offPanel })).toBe('fullscreen');
    // The row says the same: under the pen fullscreen names no key of its own.
    expect(keys.effective('tool:feather', onPanel)).toEqual(['f']);
    expect(keys.effective('fullscreen', onPanel)).toEqual([]);
    expect(keys.effective('fullscreen', offPanel)).toEqual(['f']);
    expect(idsOf('draw')).toContain('tool:feather');
    expect(idsOf('draw', { tools: [{ id: 'pencil', label: 'Кисть' }] })).not.toContain('tool:feather');
  });

  it('M reads as the palette or the merge, as the preset decides', () => {
    const merge = (section: string, quickPalette: boolean) => rowsOf(section, { quickPalette }).find((row) => row.id === 'merge');
    expect(merge('colour', true)?.label).toBe(t('key.palette'));
    expect(merge('edit', true)).toBeUndefined();
    expect(merge('edit', false)?.label).toBe(t('key.merge'));
    expect(merge('colour', false)).toBeUndefined();
    expect(keys.bindings('merge')).toEqual(['m', 'Ctrl+m']);
  });

  it('lists the tool keys the handler holds, only where the tool is', () => {
    const none = { tools: [{ id: 'pencil', label: 'Кисть' }] };
    expect(idsOf('sheet')).toContain('tool:drag');
    expect(idsOf('sheet', none)).not.toContain('tool:drag');
    expect(idsOf('selection')).toContain('tool:lasso');
    expect(idsOf('selection', none)).not.toContain('tool:lasso');
    expect(idsOf('draw')).toEqual(expect.arrayContaining(['tool:distort', 'tool:mega-eraser']));
    expect(idsOf('draw', none)).not.toContain('tool:distort');
    expect(idsOf('draw', none)).not.toContain('tool:mega-eraser');
    expect(idsOf('edit')).toEqual(expect.arrayContaining(['mirror-h', 'mirror-v']));
  });
});

describe('owner after the tenth audit: the pipette into the fill from the keys', () => {
  it('Shift+Enter on the pipette key arms it for the fill, as the right button does', () => {
    const at = box.indexOf('onpointerdown={pipetteHold}');
    const key = box.slice(at, box.indexOf('</button>', at));
    expect(key).toMatch(/e\.key === 'Enter' && e\.shiftKey[^]*editor\.selectTool\('pipette', 'fill'\)/);
  });

  it('says so on the key and in the manual', () => {
    expect(ru.palette.pipette_title).toContain('Shift+Enter');
    expect(ru.palette.pipette).toContain('Shift+Enter');
    expect(rowsOf('colour').find((row) => row.id === 'pick_fill')).toMatchObject({ kind: 'fixed', keys: 'Shift+Enter', label: t('key.pick_fill') });
    expect(ru.key.pick_fill).toContain('заливк');
  });
});

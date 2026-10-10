import { describe, expect, it } from 'bun:test';
import { plugins } from '../plugins';
import { presetPanels, presetUx } from './presets';
import { deskOnPhone } from './small-screen';

// The owner, 2026-10-10: «мобильные/планшетные версии мультатор и тунио
// сделать более похожими на пк версии, но с адаптивом» — a phone draws the
// preset's own desk, not toonop's row of keys. Toonop's phone stays its own.
void plugins;
const multator = presetPanels('multator');
const toonio = presetPanels('toonio');

describe('a phone keeps the preset’s desk', () => {
  it('only toonop asks for its own phone cut', () => {
    expect(presetUx('toonop').phoneCut).toBe(true);
    expect(presetUx('multator').phoneCut).toBeUndefined();
    expect(presetUx('toonio').phoneCut).toBeUndefined();
  });

  it('Multator: everything under the sheet, as on a desk, whichever way the phone is held (owner: beside it was «странно») — and export, which a desk has a key combination for', () => {
    const cut = deskOnPhone(multator);
    expect(cut.panels.left).toEqual([]);
    expect(cut.panels.right).toEqual([]);
    expect(cut.panels.top).toEqual([]);
    expect(cut.panels.rows).toEqual([
      ['add-frame', 'delete-frame', 'timeline'],
      ['transport', 'fullscreen', 'settings', 'export', 'manual', 'publish', 'saved'],
      ['tool:pencil', 'tool:eraser', 'tool:pipette', 'brush-sizes', 'color'],
    ]);
    expect(cut.panels.hidden).not.toContain('export');
    expect(cut.more).toEqual([]);
    expect(cut.tools).toEqual([]);
  });

  it('Toonio: the rail is the tools and undo — the sheet has the room; the toon’s own keys join the transport’s row', () => {
    const cut = deskOnPhone(toonio);
    expect(cut.panels.left).toEqual([
      'tool:pencil', 'tool:eraser', 'tool:feather', 'tool:mega-eraser', 'tool:pipette', 'tool:drag', 'tool:lasso', 'tool:distort', 'history',
    ]);
    expect(cut.panels.right).toEqual(['palette', 'brush']);
    expect(cut.panels.rows).toEqual([
      ['fps', 'transport', 'add-frame', 'onion', 'audio', 'settings', 'drafts', 'saved', 'save', 'export', 'publish', 'fullscreen', 'manual'],
      ['timeline'],
    ]);
  });

  it('a rail with no row of keys to give to keeps its keys', () => {
    const lone = { ...toonio, rows: [['timeline']] };
    expect(deskOnPhone(lone).panels.left).toEqual(toonio.left);
  });
});

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

  it('Multator standing: everything under the sheet, as on a desk — and export, which a desk has a key combination for', () => {
    const cut = deskOnPhone(multator, true);
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

  it('Multator lying down: what stood under the sheet stands beside it, in the same order; the strip alone is left under', () => {
    const cut = deskOnPhone(multator, false);
    expect(cut.panels.right).toEqual([
      'add-frame', 'delete-frame',
      'transport', 'fullscreen', 'settings', 'export', 'manual', 'publish', 'saved',
      'tool:pencil', 'tool:eraser', 'tool:pipette', 'brush-sizes', 'color',
    ]);
    expect(cut.panels.rows).toEqual([['timeline']]);
    expect(cut.panels.left).toEqual([]);
  });

  it('Toonio standing up: the rail is the tools and undo — a key wide, the sheet has the width; the toon’s own keys join the transport’s row', () => {
    const cut = deskOnPhone(toonio, true);
    expect(cut.panels.left).toEqual([
      'tool:pencil', 'tool:eraser', 'tool:feather', 'tool:mega-eraser', 'tool:pipette', 'tool:drag', 'tool:lasso', 'tool:distort', 'history',
    ]);
    expect(cut.panels.right).toEqual(['palette', 'brush']);
    expect(cut.panels.rows).toEqual([
      ['fps', 'transport', 'add-frame', 'onion', 'audio', 'settings', 'drafts', 'saved', 'save', 'export', 'publish', 'fullscreen', 'manual'],
      ['timeline'],
    ]);
  });

  it('Toonio lying down: its columns and its rows as on a desk — there is the width for them', () => {
    expect(deskOnPhone(toonio, false).panels).toEqual(toonio);
  });

  it('a rail with no row of keys to give to keeps its keys', () => {
    const lone = { ...toonio, rows: [['timeline']] };
    expect(deskOnPhone(lone, true).panels.left).toEqual(toonio.left);
  });
});

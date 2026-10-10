import { describe, expect, it } from 'bun:test';
import { plugins } from '../plugins';
import { panelItems } from './panels';
import { DEFAULT_PRESET, presetPanels, presetUx } from './presets';
import { phoneLayout, phoneTools } from './small-screen';

// The owner, 2026-10-10: «на пк toonop не очень удобен, он повторяет procreate
// dreams, но он для планшетов был» — on a desk toonop stands as desk programs
// do: the tools down the left, the colours open on the right, the film's own
// keys over the canvas. Toonop's own colours, not Toonio's palette box.
void plugins;
const base = presetPanels(DEFAULT_PRESET);

describe('toonop on a desk', () => {
  it('the tools stand down the left with the thickness under them — the ones the bar held, no more', () => {
    expect(base.left).toEqual([
      'tool:pencil', 'tool:eraser', 'tool:feather', 'tool:mega-eraser', 'tool:pipette', 'tool:drag', 'tool:lasso',
      'brush-rail',
    ]);
    expect(base.hidden).toContain('tool:distort');
  });

  it('toonop’s own colours stand open on the right; Toonio’s palette box stays on the shelf', () => {
    expect(base.right).toEqual(['colours']);
    expect(panelItems().find((item) => item.id === 'colours')?.wide).toBe(true);
    expect(base.hidden).toEqual(expect.arrayContaining(['palette', 'brush', 'color-key']));
  });

  it('over the canvas: the film’s keys and undo at the near end, the studio’s at the far one', () => {
    expect(base.top).toEqual(['publish', 'save', 'export', 'history', 'saved', 'spring', 'settings', 'manual', 'fullscreen']);
  });

  it('the onion skin and the sound stand with the transport', () => {
    expect(base.rows).toEqual([['fps', 'add-frame', 'transport', 'onion', 'audio'], ['timeline']]);
  });

  it('a phone is drawn as it was: the thickness and undo beside the canvas, the colours behind their key', () => {
    const keep = { tools: phoneTools(presetUx(DEFAULT_PRESET)), tall: true, room: 4, drawn: (tool: string) => tool !== 'pipette' };
    const cut = phoneLayout(base, base, keep);
    expect(cut.panels.left).toEqual(['brush-rail', 'history']);
    expect(cut.panels.right).toEqual([]);
    expect(cut.panels.top).toEqual(['publish', 'more', 'spring', 'tool:pencil', 'tool:eraser', 'tools', 'color-key']);
    expect(cut.panels.rows).toEqual([['add-frame', 'transport', 'spring', 'onion', 'audio'], ['timeline']]);
    expect(cut.more.flatMap((group) => group.items)).not.toContain('colours');
  });
});

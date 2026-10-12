import { describe, expect, it } from 'bun:test';
import type { ToolDescriptor } from '../format/types';
import { colourOfPixel } from './hold-pick';

const opaque: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 32, color: '#000000' };
const faint: ToolDescriptor = { kind: 'pencil', geometry: 'smooth', width: 32, color: '#3366cc', opacity: 40 };

describe('the colour the pipette reads off a pixel', () => {
  it('an opaque pixel is its colour, an empty one is emptiness', () => {
    expect(colourOfPixel([18, 52, 86, 255], [opaque])).toBe('#123456');
    expect(colourOfPixel([0, 0, 0, 0], [opaque, faint])).toBeNull();
  });

  it('the soft rim of a line is emptiness where nothing is drawn translucent', () => {
    expect(colourOfPixel([0, 0, 0, 128], [opaque])).toBeNull();
  });

  it('a translucent line gives the colour it is seen as on the paper, opaque', () => {
    // 40 % of #3366cc over white.
    expect(colourOfPixel([50, 103, 205, 102], [opaque, faint])).toBe('#adc2eb');
  });

  it('two translucent lines over each other give what is seen there', () => {
    const red: ToolDescriptor = { ...faint, color: '#ff0000' };
    expect(colourOfPixel([150, 60, 120, 163], [faint, red])).toBe('#bc82a9');
  });

  it('the rim of a translucent line, fainter than the line itself, is still emptiness', () => {
    expect(colourOfPixel([51, 102, 204, 40], [faint])).toBeNull();
  });
});

describe('the pipette leaves the brush as strong as it was', () => {
  it('takes a colour and nothing else', async () => {
    const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
    expect(canvas.match(/function takeColour[^]*?\n {2}}/)?.[0] ?? '').not.toContain('Opacity');
  });
});

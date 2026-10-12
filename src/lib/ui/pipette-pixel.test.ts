import { describe, expect, it } from 'bun:test';
import type { ToolDescriptor } from '../format/types';
import { colourOfPixel, opacityOfPixel } from './hold-pick';

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

  it('a translucent line gives the colour it was drawn with, not what the rounding left of it', () => {
    // 40 % is an alpha of 102, and the channels come back a step or two off.
    expect(colourOfPixel([50, 103, 205, 102], [opaque, faint])).toBe('#3366cc');
  });

  it('two translucent lines over each other give what is seen there', () => {
    const red: ToolDescriptor = { ...faint, color: '#ff0000' };
    expect(colourOfPixel([150, 60, 120, 163], [faint, red])).toBe('#963c78');
  });

  it('the rim of a translucent line, fainter than the line itself, is still emptiness', () => {
    expect(colourOfPixel([51, 102, 204, 40], [faint])).toBeNull();
  });
});

describe('the opacity the pipette reads off a pixel', () => {
  it('an opaque pixel is an opaque brush', () => {
    expect(opacityOfPixel(255, [opaque, faint])).toBe(100);
  });

  it('a translucent line gives the opacity it was drawn at, not what the rounding left of it', () => {
    // 40 % is 102 of 255; a canvas may hand back 101 or 103.
    expect(opacityOfPixel(102, [faint])).toBe(40);
    expect(opacityOfPixel(104, [faint])).toBe(40);
  });

  it('two lines over each other give what is seen there', () => {
    expect(opacityOfPixel(163, [faint])).toBe(64);
  });
});

describe('the pipette hands the opacity to the brush', () => {
  it('with the colour, to the brush that draws next', async () => {
    const canvas = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
    const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
    const take = canvas.match(/function takeColour[^]*?\n {2}}/)?.[0] ?? '';
    expect(take).toMatch(/editor\.pickColor\(picked[^]*editor\.takeBrushOpacity\(/);
    const method = state.match(/takeBrushOpacity\(value: number\)[^]*?\n {2}}/)?.[0] ?? '';
    // Not the pipette's own record: the tool the hand goes back to.
    expect(method).toContain("this.tool === 'pipette' ? toolAfterHelp(this.previousDrawingTool) : this.tool");
  });
});

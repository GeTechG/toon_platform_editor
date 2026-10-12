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

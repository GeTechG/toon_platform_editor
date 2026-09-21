import { describe, expect, it } from 'bun:test';

import { plugins } from '.';
import { brushOfType, hasBrushTypes } from './brush-types';

describe('the multator type is a brush of the multator canvas', () => {
  it('is the multator type of the brush in hand, not a tool of its own', () => {
    expect(brushOfType('pencil', 'multator')).toBe('multator-pencil');
    expect(brushOfType('eraser', 'multator')).toBe('multator-eraser');
    expect(brushOfType('pencil', 'normal')).toBe('pencil');
    expect(brushOfType('pencil', 'old')).toBe('oldschool');
  });

  it('leaves a brush with no multator form alone', () => {
    expect(brushOfType('feather', 'multator')).toBe('feather');
    expect(brushOfType('drag', 'multator')).toBe('drag');
  });

  it('fixes the multator canvas, whatever preset holds it', () => {
    expect(plugins.tool('multator-pencil')?.stroke?.dialect).toBe('multator');
    expect(plugins.tool('multator-eraser')?.stroke?.dialect).toBe('multator');
  });

  it('draws the plain multator line: no capture and no commit of its own', () => {
    for (const id of ['multator-pencil', 'multator-eraser']) {
      expect(plugins.tool(id)?.stroke?.capture).toBeUndefined();
      expect(plugins.tool(id)?.stroke?.commit).toBeUndefined();
    }
    expect(plugins.tool('multator-pencil')?.stroke?.descriptor({
      width: 64, color: '#ff0000', fill: '#ffffff', dialect: 'toonio',
    })).toEqual({ kind: 'pencil', dialect: 'multator', width: 64, color: '#ff0000' });
    expect(plugins.tool('multator-eraser')?.stroke?.descriptor({
      width: 64, color: '#ff0000', fill: '#ffffff', dialect: 'toonio',
    })).toEqual({ kind: 'eraser', dialect: 'multator', width: 64 });
  });

  it('is on no panel — it is a type of the brush in hand, not a key', () => {
    expect(plugins.tool('multator-pencil')?.key).toBe('');
    expect(plugins.tool('multator-pencil')?.offPanel).toBe(true);
    expect(plugins.tool('multator-eraser')?.offPanel).toBe(true);
  });

  it('offers the types where there is something to switch to', () => {
    expect(hasBrushTypes('pencil')).toBe(true);
    expect(hasBrushTypes('eraser')).toBe(true);
    expect(hasBrushTypes('feather')).toBe(false);
  });
});

import { describe, expect, it } from 'bun:test';

import { plugins } from '../lib/plugins';
import { brushOfType, hasBrushTypes } from '../lib/plugins/brush-types';

describe('the multator type is a brush of its own', () => {
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

  it('carries the multator numbers, whatever preset holds it', () => {
    for (const id of ['multator-pencil', 'multator-eraser']) {
      expect(plugins.probeRules(id)?.range).toEqual({ min: 1, max: 640 });
      expect(plugins.probeRules(id)?.defaults?.width).toBe(9);
    }
  });

  it('draws the plain multator line: no capture and no commit of its own', () => {
    for (const id of ['multator-pencil', 'multator-eraser']) {
      expect(plugins.probeRules(id)?.commit).toBeUndefined();
      expect(plugins.probeRules(id)?.preview).toBeUndefined();
    }
    expect(plugins.tool('multator-pencil')?.stroke?.descriptor({
      width: 64, color: '#ff0000', fill: '#ffffff', smooth: 3, minDistance: 3,
    })).toEqual({ kind: 'pencil', geometry: 'smooth', width: 64, color: '#ff0000' });
    expect(plugins.tool('multator-eraser')?.stroke?.descriptor({
      width: 64, color: '#ff0000', fill: '#ffffff', smooth: 3, minDistance: 3,
    })).toEqual({ kind: 'eraser', geometry: 'smooth', width: 64 });
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

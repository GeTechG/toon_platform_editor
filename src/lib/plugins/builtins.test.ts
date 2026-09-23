import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { BUILTIN_PLUGIN } from './builtins';

const icons = readFileSync(new URL('../ui/Icon.svelte', import.meta.url), 'utf8');

describe('the two frame tools say what they do', () => {
  it('the frame grabber is called a transform, not a lasso', () => {
    const tool = BUILTIN_PLUGIN.tools?.lasso;
    expect(tool?.label).toBe('Трансформация');
    expect(tool?.title).toBe('Трансформация (Q) — двигать, вращать и масштабировать кадр');
    expect(tool?.icon).toBe('transform');
  });

  it('the jitter brush is called a tremble, not a distortion', () => {
    const tool = BUILTIN_PLUGIN.tools?.distort;
    expect(tool?.label).toBe('Дрожь');
    expect(tool?.title).toBe('Дрожь (~) — дребезг штрихов кадра');
    expect(tool?.icon).toBe('jitter');
  });

  it('the vocabulary draws both of the icons they name', () => {
    for (const name of ['transform', 'jitter']) {
      expect(icons).toContain(`\n    ${name}:`);
    }
    expect(icons).not.toContain("lasso:");
    expect(icons).not.toContain("distort:");
  });
});

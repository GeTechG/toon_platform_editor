import { describe, expect, it } from 'bun:test';

// Tenth audit. A width grown to 640 under Multator stayed 640 after switching
// to Toonop, whose ceiling is 500: the number field showed 640 as invalid, the
// track sat pinned at its end, and the pencil drew wider than the preset
// allows. The record keeps what was set; what is read is held to the ceiling.
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

function member(source: string, name: string): string {
  const match = source.match(new RegExp(`${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('a width is held to the ceiling of the preset in hand', () => {
  it('the brush record read by the sliders and the stroke is capped', () => {
    expect(member(state, 'get brush')).toContain('this.ux.brushSizeMax');
  });
});

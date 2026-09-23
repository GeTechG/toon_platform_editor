import { describe, expect, it } from 'bun:test';

// The site's player drew at the raw device density — 3 to 3.5 on the phones
// most of the audience watches on — while the editor caps at 2 because 3× is
// not visible on line art and costs 2.25× the pixels on every frame.
const player = await Bun.file(new URL('./Player.svelte', import.meta.url)).text();

describe('the player draws at the same capped density as the editor', () => {
  it('goes through renderDensity, not the raw device ratio', () => {
    expect(player).toContain('renderDensity(window.devicePixelRatio || 1)');
    expect(player).not.toContain('const dpr = window.devicePixelRatio || 1;');
  });
});

// A publication with sound never autoplays, so most share-page visits never
// press play — yet `preload = 'auto'` pulled the whole track down on every one,
// on the phone data plan PRODUCT.md calls the main one. Its length is all the
// page needs up front; play and a paused step fetch the rest on demand.
describe('the soundtrack waits for the visitor', () => {
  it('preloads only the metadata', () => {
    expect(player).toContain("element.preload = 'metadata';");
    expect(player).not.toContain("element.preload = 'auto';");
  });
});

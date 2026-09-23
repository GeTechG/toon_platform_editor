import { describe, expect, it } from 'bun:test';

// Tenth audit. The readout under the row of dots was hidden on a phone as
// "only repeating what the picked dot says" — but a size between the dots
// (grown by +/−, or carried over from the slider of another preset) picks no
// dot, and then the phone showed no thickness at all. It was also silent:
// +/− changed the size with nothing said to a screen reader (WCAG 4.1.3).
const sizes = await Bun.file(new URL('./BrushSizes.svelte', import.meta.url)).text();
const style = sizes.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? '';

describe('the thickness readout of the row of dots', () => {
  it('stays on a phone while no dot is picked', () => {
    expect(sizes).toMatch(/class:picked=/);
    expect(style).toContain('.size.picked');
    expect(style).not.toMatch(/\.size\s*\{\s*display:\s*none/);
  });

  it('speaks a size changed by the keys', () => {
    expect(sizes).toMatch(/<span\s+class="size"[^>]*role="status"/);
  });
});

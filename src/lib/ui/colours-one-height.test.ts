import { describe, expect, it } from 'bun:test';

// Each way of choosing is as tall as what it holds — a ring, a square with
// three sliders, six sliders — and the row of ways under it stood 200px
// higher or lower with every press (owner, 2026-10-12: «переключение вкладок
// прыгает»). The panel is one height on every tab; what is left over lies
// between the swatches and the ways.
const panel = await Bun.file(new URL('./ColoursPanel.svelte', import.meta.url)).text();
const style = panel.slice(panel.indexOf('<style>'));

describe('the colours panel is one height on every tab', () => {
  it('behind a key: a height of its own, no taller than the room under the key', () => {
    expect(style).toMatch(/\n  \.colours \{[^}]*\n    height: min\([\d.]+rem, var\(--room\)/);
  });

  it('standing in a column: a height of its own, no taller than the column', () => {
    expect(style).toMatch(/\n  \.colours\.docked \{[^}]*\n    height: [\d.]+rem;[^}]*max-height: 100%/);
  });

  it('the swatches take what the surface leaves and scroll in it: the ways stay at the bottom', () => {
    expect(style).toMatch(/\n  \.colours \.rest \{[^}]*flex: 1 1 auto;[^}]*overflow-y: auto/);
  });
});

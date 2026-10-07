import { describe, expect, it } from 'bun:test';

// A phone lying down leaves some 270px under the colours key, and the window
// is 640 tall: half a ring stood over the tabs, the rest under a scroll. In a
// low window the surface stands beside the rest, as tall as the room.
const panel = await Bun.file(new URL('./ColoursPanel.svelte', import.meta.url)).text();
const popKey = await Bun.file(new URL('./PopKey.svelte', import.meta.url)).text();
const brush = await Bun.file(new URL('./BrushPanel.svelte', import.meta.url)).text();
const style = panel.slice(panel.indexOf('<style>'));
const low = style.match(/@media \(max-height: [\d.]+rem\) and \(min-width: [\d.]+rem\) \{[^]*?\n  \}\n/)?.[0] ?? '';

describe('the colours window in a low window', () => {
  it('the key tells its box the room it has before it measures the box', () => {
    expect(popKey).toMatch(/setProperty\('--room'[^]*?offsetWidth/);
  });

  it('the surface is as tall as the room and stands beside the rest', () => {
    expect(low).toContain('var(--room');
    expect(low).toMatch(/\.colours \{[^}]*display: grid/);
    expect(low).toMatch(/\.surface \{[^}]*width: var\(--side\)/);
  });

  it('the rest scrolls on its own; the tabs stay under it', () => {
    expect(low).toMatch(/\.rest \{[^}]*overflow-y: auto/);
    expect(low).toMatch(/\.tabs \{[^}]*position: static/);
  });

  it('what is drawn follows the order it is read in', () => {
    // Columns by placement, not by `order`: Tab walks the DOM.
    expect(style).not.toMatch(/\border:/);
  });

  it('«Значения»: the hex field stands under H, S, B, the stage of that tab', () => {
    const stage = panel.slice(panel.indexOf('<div class="stage">'), panel.indexOf('<div class="rest">'));
    expect(stage).toContain('class="hex"');
  });
});

// The brush box under a tool's key is 488px of a column: a title over each
// slider. In a low window a setting is one line — its name, the track, the
// number — and the box is as wide as that takes.
describe('the brush box in a low window', () => {
  const low = brush.match(/@media \(max-height: [\d.]+rem\) and \(min-width: [\d.]+rem\) \{[^]*?\n  \}\n/)?.[0] ?? '';

  it('only the box behind a key: a side column is as narrow as it was', () => {
    expect(low).toContain(':global(.pop-plate) .brush-box {');
    expect(low).not.toMatch(/\n    \.brush-box/);
  });

  it('a setting is one line: its name beside the track', () => {
    expect(low).toMatch(/\.brush-box \{[^}]*grid-template-columns: auto /);
    expect(low).toMatch(/\.field \{[^}]*grid-column: 1;/);
  });

  it('the list names the type: no title over it, no second sample under it', () => {
    expect(low).toMatch(/\.type-title,\s*:global\(\.pop-plate\) \.live \{\s*display: none/);
  });
});

import { describe, expect, it } from 'bun:test';

// Eleventh audit, the brush.
const panel = await Bun.file(new URL('./BrushPanel.svelte', import.meta.url)).text();
const sizes = await Bun.file(new URL('./BrushSizes.svelte', import.meta.url)).text();
const panelStyle = panel.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? '';

function rule(style: string, selector: string): string {
  const at = style.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`missing ${selector}`);
  return style.slice(at, style.indexOf('}', at));
}

describe('the list of brush types', () => {
  // At 400 % zoom (320×200) the three types stood 389px tall in a window of
  // 200, and the list had no ceiling: «Мультатор» was below the edge with no
  // way to it (WCAG 1.4.10).
  it('is held to the window and scrolls inside it', () => {
    const types = rule(panelStyle, '.types');
    expect(types).toMatch(/max-height:\s*calc\(100% - 16px\)/);
    expect(types).toMatch(/overflow-y:\s*auto/);
  });

  // A phone turned with the list open left it where the old window had it.
  it('follows the window when it changes size', () => {
    expect(panel).toMatch(/<svelte:window[^>]*onresize=/);
  });
});

describe('forced colors', () => {
  // The sample is an SVG in `currentColor`, and forced colors leave an SVG's
  // colour alone: near-black on a black high-contrast canvas. The picked type
  // opts out of the mode (controls.css) and kept its red name, grey hint and
  // black wave on Highlight.
  const forced = panelStyle.match(/@media \(forced-colors: active\) \{([\s\S]*?)\n {2}\}/)?.[1] ?? '';

  it('draws the samples in the system text colour', () => {
    expect(forced).toMatch(/\.sample\s*\{\s*color:\s*CanvasText/);
  });

  it('writes the picked type in HighlightText', () => {
    expect(forced).toMatch(/\.type\.active[^{]*\{\s*color:\s*HighlightText/);
  });
});

describe('the help under a heading', () => {
  // The box scrolls, and the words of «Упрощение» opened below its bottom
  // edge: cut off on a phone and on a short desktop window alike.
  it('is brought into view when it opens', () => {
    expect(panel).toMatch(/scrollIntoView\(\{\s*block:\s*'nearest'/);
  });
});

describe('the row of dots, to a screen reader', () => {
  // Inside the group «Толщина кисти» each dot said «Толщина кисти 4 px» — the
  // name twice and a unit a reader spells out. The slider already speaks
  // pixels (`brush.size_value`); the dots and the readout now do too.
  it('names each dot by its size in pixels', () => {
    expect(sizes).toMatch(/aria-label=\{t\('brush\.size_value', \{ count: size \}\)\}/);
  });

  it('announces the readout in words, the «px» only on screen', () => {
    expect(sizes).toMatch(/aria-hidden="true">\{editor\.brushSizeLogical\}px</);
    expect(sizes).toMatch(/class="sr-only">\{t\('brush\.size_value', \{ count: editor\.brushSizeLogical \}\)\}</);
  });
});

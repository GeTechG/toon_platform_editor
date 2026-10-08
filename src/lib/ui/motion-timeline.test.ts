import { describe, expect, it } from 'bun:test';

// The strip's motion rules. The drawing is the animation, so the strip only
// answers the hand: what arrives says where it came from, and nothing of it
// moves while frames flip — the marker of the frame on screen jumps.
const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const style = (source: string) =>
  (source.match(/<style>([\s\S]*)<\/style>/)?.[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');

const files = {
  timeline: await read('./Timeline.svelte'),
  rows: await read('./LayerRows.svelte'),
  frameThumb: await read('./FrameThumb.svelte'),
  layerThumb: await read('./LayerThumb.svelte'),
  play: await read('./PlayControls.svelte'),
  audio: await read('./AudioPanel.svelte'),
  player: await read('../player/Player.svelte'),
};

/** The body of the top-level rule with exactly this selector (not one inside a query). */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`\n  ${selector} {`);
  return at < 0 ? '' : css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
}

describe('motion in the strip, the layers and the player', () => {
  it('times every move by the tokens, never by a number of its own', () => {
    for (const [name, source] of Object.entries(files)) {
      for (const decl of style(source).match(/(transition|animation)\s*:[^;]+;/g) ?? []) {
        expect(`${name}: ${decl}`).not.toMatch(/\ball\b|ease-in|linear/);
        // A literal only as the fallback of a token (the player can be
        // mounted where the table of tokens did not come).
        expect(`${name}: ${decl.replace(/var\(--(dur|dur-fast|dur-enter|ease-out),[^)]*(\([^)]*\))?[^)]*\)/g, 'var()')}`).not.toMatch(/\d(s|ms)\b|cubic-bezier/);
      }
      expect(style(source)).not.toContain('will-change');
    }
  });

  it('moves transform and opacity only', () => {
    for (const source of Object.values(files)) {
      for (const frames of style(source).match(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})+/g) ?? []) {
        for (const prop of frames.match(/[a-z-]+(?=\s*:)/g) ?? []) {
          expect(['opacity', 'transform']).toContain(prop);
        }
      }
    }
  });

  it('leaves a cell of the strip still: at 24 frames a second the marker jumps', () => {
    const css = style(files.timeline);
    expect(rule(css, '.cell')).not.toMatch(/transition|animation/);
    expect(rule(css, '.cell.active')).not.toMatch(/transition|animation/);
    expect(rule(css, '.cell.selected')).not.toMatch(/transition|animation/);
    // The one move a cell makes is arriving, and never under a preview.
    expect(files.timeline).toMatch(/if \(editor\.playing\) \{\s*arrived = null;/);
  });

  it('brings in the one new frame or layer, not the list', () => {
    const css = style(files.timeline);
    expect(rule(css, '.cell.arrived')).toContain('var(--dur-enter) var(--ease-out)');
    expect(rule(style(files.rows), '.row.arrived')).toContain('var(--dur-enter) var(--ease-out)');
    // By a class the count's growth by one puts on: a rule on the cell or the
    // row itself would play for every one the scroll builds.
    expect(rule(css, '.cell')).not.toContain('animation');
    expect(rule(style(files.rows), '.row')).not.toContain('animation');
  });

  it('opens the frame menu, the picking chip and the sound plate from where they were called', () => {
    expect(rule(style(files.timeline), '.frame-menu')).toContain('var(--dur-enter) var(--ease-out)');
    expect(rule(style(files.timeline), '.pick-bar.picking')).toContain('var(--dur-enter) var(--ease-out)');
    expect(rule(style(files.audio), '.audio-plate')).toContain('var(--dur-enter) var(--ease-out)');
    // In a small screen's window the window arrives, not its body.
    expect(rule(style(files.audio), '.audio-plate.docked')).toContain('animation: none');
  });

  it('keeps the change and drops the travel under reduced motion', () => {
    // The layer's row is not here: it comes by opacity alone.
    for (const name of ['timeline', 'audio', 'player'] as const) {
      const still = style(files[name]).match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?\})\s*\}/)?.[1] ?? '';
      expect(`${name}: ${still}`).toMatch(/animation-name: [\w-]*fade|transition: none|animation: none/);
    }
  });
});

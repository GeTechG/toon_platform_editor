import { describe, expect, it } from 'bun:test';
import { plugins } from '../plugins';
import { defaultPanels } from './panels';
import { DEFAULT_TAB_ORDER, compactLayout } from './small-screen';

// The phone, after «одно окно за раз» (small-screens-one-window). The columns
// stacked above and below the canvas are gone, and with them the rails capped
// in dvh, the bar sized to its contents and the short-screen branch: a phone
// has the canvas, a one-key strip, the dock and at most one window. What the
// old notes measured and still holds is kept here — the key's width in a
// strip, the strip's fade, the history outranking the column rule, the
// windows un-floated under the canvas, the strip as wide as the phone.
void plugins;
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const style = editorUi.slice(editorUi.indexOf('<style>'));

/** One rule's body by its exact selector. */
function rule(selector: string): string {
  const at = style.indexOf(`\n  ${selector} {`);
  expect(at).toBeGreaterThan(-1);
  return style.slice(at, style.indexOf('}', at));
}

describe('a phone keeps room to draw', () => {
  it('the strip is one key thick and scrolls what does not fit', () => {
    const strip = rule('.studio.phone.tall .left');
    expect(strip).toMatch(/flex-direction:\s*row/);
    expect(strip).toMatch(/overflow-x:\s*auto/);
    expect(rule('.studio.phone:not(.tall) .left')).toMatch(/width:\s*calc\(var\(--key-h\) \+ 1rem\)/);
  });

  it('a key keeps its finger-sized width in the strip', () => {
    // Nine tools split 360px into 17px slivers once: under WCAG 2.2 AA 2.5.8.
    expect(style).toMatch(/\.studio\.phone \.left > :global\(\.key\)[^}]*min-width:\s*var\(--key-h\)/s);
  });

  it('the strip says it scrolls, with a fade at its end', () => {
    expect(rule('.studio.phone.tall .left')).toMatch(/mask-image:\s*linear-gradient\(to right/);
    expect(rule('.studio.phone:not(.tall) .left')).toMatch(/mask-image:\s*linear-gradient\(to bottom/);
  });

  it('the dock clears the home indicator', () => {
    expect(rule('.dock')).toMatch(/padding-bottom:\s*max\([^)]*env\(safe-area-inset-bottom\)\)/);
  });
});

// The column rule `.studio .left .history` is three classes; a phone rule of
// two lost to it and the history stayed a 16px grid in the strip.
describe('undo and redo stay reachable on a phone', () => {
  it('the phone rule for the history outranks the column rule', () => {
    expect(rule('.studio.phone.tall .left .history')).toMatch(/display:\s*flex/);
  });

  it('the history rides in the strip with the tools', () => {
    expect(compactLayout(defaultPanels(), 'phone', DEFAULT_TAB_ORDER).rail).toContain('history');
  });
});

describe('a window that stops floating gets a row of its own', () => {
  // A static child in a stage the canvas fills edge to edge laid itself out
  // under the next panel, present and unpressable. The stage is a column on a
  // small screen and the canvas gives the rows back.
  it('un-floats the tool windows and turns the stage into a column', () => {
    expect(rule('.studio.compact .stage')).toMatch(/flex-direction:\s*column/);
    expect(rule('.studio.compact .tool-windows')).toMatch(/position:\s*static/);
  });

  it('the zoom window stays a small float, in the top corner, out of the windows’ row', () => {
    // As a row of its own at 200 % text lying down, it took 88 of the
    // stage's 179 px: the canvas had 90.
    const zoom = rule('.studio.compact .scale-window');
    expect(zoom).toMatch(/top:/);
    expect(zoom).toMatch(/bottom:\s*auto/);
    expect(zoom).not.toMatch(/position:\s*static/);
  });

  it('lets the canvas shrink instead of filling the stage', () => {
    const wrap = rule('.studio.compact .stage > :global(.wrap)');
    expect(wrap).toMatch(/flex:\s*1/);
    expect(wrap).toMatch(/height:\s*auto/);
  });
});

describe('the strip in its window is as wide as the phone', () => {
  it('the timeline takes the window’s width, not the width of every frame', () => {
    expect(style).toMatch(/\.tab-window > :global\(\.timeline\)[^{]*\{[^}]*width:\s*100%/);
  });
});

describe('a phone can still set the frame rate', () => {
  it('the fps box waits behind «⋯»', () => {
    const more = compactLayout(defaultPanels(), 'phone', DEFAULT_TAB_ORDER).tabs.find((tab) => tab.id === 'more');
    expect(more?.items).toContain('fps');
  });
});

describe('the phone branch and the desktop branch do not overlap', () => {
  it('no breakpoint matches on both sides of the same edge', () => {
    const phoneEdges = [...editorUi.matchAll(/@media \(max-width: ([\d.]+)rem\)/g)].map((m) => m[1]);
    const deskEdges = [...editorUi.matchAll(/@media \(min-width: ([\d.]+)rem\)/g)].map((m) => m[1]);
    expect(deskEdges.filter((edge) => phoneEdges.includes(edge))).toEqual([]);
  });
});

describe('height in the studio is written in dvh', () => {
  // `vh` is the tall viewport: a value in it jumps the moment Mobile Safari
  // collapses its address bar.
  it('no rule measures a height in vh', () => {
    const bare = style.replace(/\/\*[\s\S]*?\*\//g, '');
    const stray = [...bare.matchAll(/[\w-]+:\s*[^;]*?\b[\d.]+vh\b[^;]*/g)].map((m) => m[0].trim());
    expect(stray).toEqual([]);
  });
});

// The floor under the bottom bar is arithmetic for rows one key tall; a
// transport that wraps took its second line out of the strip.
describe('a wrapped row raises the floor under the bar', () => {
  it('each key row is measured and what it takes over one key is added', () => {
    expect(editorUi).toContain('bind:contentRect={rowBoxes[i]}');
    const floor = editorUi.match(/const panelFloor = \$derived\([^]*?\n  \);/)?.[0] ?? '';
    expect(floor).toContain('wrapExtra');
  });
});

describe('the bar floor grows with the text size', () => {
  it('the px of the floor and of one key row are scaled by the root text size', () => {
    expect(editorUi).toMatch(/const textScale = \$derived/);
    const floor = editorUi.match(/const panelFloor = \$derived\([^]*?\n  \);/)?.[0] ?? '';
    expect(floor).toContain('* textScale');
    expect(editorUi).toMatch(/KEY_ROW \* textScale/);
  });
});

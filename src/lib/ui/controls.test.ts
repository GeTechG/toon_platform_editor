import { describe, expect, it } from 'bun:test';
import { Glob } from 'bun';

// The studio draws its own controls (web-look «Свои контролы»): a checkbox, a
// switch, a range, a select, a progress bar and a scrollbar are the browser's
// grey chrome unless the sheet takes them over, and a native one tinted with
// `accent-color` still wears the browser's shape.
const UI = new URL('./', import.meta.url).pathname;
const controlsCss = (await Bun.file(UI + 'controls.css').text()).replace(/\/\*[\s\S]*?\*\//g, '');
const editorUi = await Bun.file(UI + 'Editor.svelte').text();
const sheets: { file: string; text: string }[] = [];
for await (const file of new Glob('*.svelte').scan(UI)) {
  sheets.push({ file, text: await Bun.file(UI + file).text() });
}

/** The body of the first rule whose selector list contains `sel`. */
function rule(sel: string): string {
  const at = controlsCss.indexOf(sel);
  expect(at).toBeGreaterThan(-1);
  const open = controlsCss.indexOf('{', at);
  return controlsCss.slice(open, controlsCss.indexOf('}', open));
}

describe('the studio draws its own controls', () => {
  it('the editor carries the sheet', () => {
    expect(editorUi).toContain("import './controls.css'");
  });

  it.each([
    "input[type='checkbox']",
    "input[type='range']",
    'select',
    'progress',
  ])('%s drops the native look', (sel) => {
    expect(rule(`:where(.editor) ${sel}`)).toContain('appearance: none');
  });

  it('a text field left to itself wears the field edge, not the browser inset', () => {
    // The plugin catalogue address in the settings was a raw 21px browser box.
    const body = rule("input[type='url']");
    expect(body).toContain('border: 1px solid var(--edge)');
    expect(body).toContain('min-height: var(--key-h');
  });

  it('a range left to itself is a finger deep, not the 6px of its track', () => {
    // The palette limit in the settings sized nothing and fell to the track:
    // a 144×6 band, while the brush and fps sliders each pinned their own 44.
    expect(rule(":where(.editor) input[type='range']")).toContain('height: var(--key-h');
  });

  it('a switch is a pill with a knob, not a box', () => {
    const body = rule("[role='switch']");
    expect(body).toContain('border-radius: var(--r-pill)');
  });

  it('a checked box and an on switch take the accent', () => {
    expect(rule("input[type='checkbox']:checked")).toContain('var(--accent)');
  });

  it('a number field loses its spinner', () => {
    expect(rule("input[type='number']")).toContain('appearance: textfield');
    expect(controlsCss).toContain('::-webkit-inner-spin-button');
  });

  it('no component tints a native control instead', () => {
    const tinted = sheets.filter((s) => s.text.includes('accent-color')).map((s) => s.file);
    expect(tinted).toEqual([]);
  });
});

describe('scrollbars stay out of the way', () => {
  it('every scroller in the studio gets the thin bar, not only the root', () => {
    // `scrollbar-width` does not inherit: set on `.editor` alone, the palette
    // grid under it kept Chrome's thick bar with arrows.
    expect(controlsCss).toMatch(/:where\(\.editor\) \*[^{]*\{[^}]*scrollbar-width: thin/);
  });

  it('the thumb is invisible until the pointer is over the scroller', () => {
    expect(rule('::-webkit-scrollbar-thumb')).toContain('background: transparent');
    expect(rule(':hover::-webkit-scrollbar-thumb')).toContain('var(--edge)');
    expect(controlsCss).toContain('scrollbar-color: transparent transparent');
    expect(controlsCss).toMatch(/:hover\s*\{[^}]*scrollbar-color: var\(--edge\) transparent/);
  });

  it('the scroller itself changes on hover, or Chrome never repaints the thumb', () => {
    expect(controlsCss).toMatch(/@property --hovered\s*\{[^}]*inherits: false/);
    expect(controlsCss).toMatch(/:where\(\.editor\) :hover\s*\{\s*--hovered: 1/);
  });

  it('no arrow buttons at the ends', () => {
    expect(rule('::-webkit-scrollbar-button')).toContain('display: none');
  });
});

// Windows High Contrast (forced colors) repaints every author colour with the
// system pair and drops every background image that is not a url(), every
// gradient and every box-shadow. What the studio said with those alone — the
// picked tool, the on switch, the palette itself, the focus on a seam, the
// edge of a menu over the canvas — went blank.
describe('forced colors keep what colour and shadow were saying', () => {
  const forced = controlsCss.slice(controlsCss.indexOf('@media (forced-colors: active)'));
  const block = (sel: string): string => {
    const at = forced.indexOf(sel);
    expect(at).toBeGreaterThan(-1);
    const open = forced.indexOf('{', at);
    return forced.slice(open, forced.indexOf('}', open));
  };

  it('the sheet has a forced-colors block', () => {
    expect(controlsCss).toContain('@media (forced-colors: active)');
  });

  it('a colour that is the content — a swatch, a layer tag — keeps its colour', () => {
    const body = block("[style*='--swatch']");
    expect(body).toContain('forced-color-adjust: none');
    expect(forced).toContain("[style*='background']");
  });

  it('a pressed, selected or current control is marked in the system highlight', () => {
    const body = block("[aria-pressed='true']");
    expect(body).toContain('Highlight');
    expect(body).toContain('HighlightText');
    // Text on a forced highlight gets a Canvas backplate and vanishes.
    expect(body).toContain('forced-color-adjust: none');
    expect(forced).toContain("[aria-selected='true']");
  });

  it('an on switch and a ticked box are told apart by the highlight', () => {
    expect(block("input[type='checkbox']:checked")).toContain('Highlight');
  });

  it('the switch knob is an image, which forced colors keeps — a gradient it drops', () => {
    expect(block("[role='switch']")).toContain('url(');
  });

  it('a range keeps its track and a progress bar its fill', () => {
    expect(block('::-webkit-slider-runnable-track')).toContain('CanvasText');
    expect(block('::-webkit-progress-value')).toContain('Highlight');
  });

  it('a seam that shows focus with a gradient gets an outline back', () => {
    expect(block("[role='separator']:focus-visible")).toMatch(/outline: [^;]*Highlight/);
  });

  it('a brush-size dot, drawn by its background, is drawn in CanvasText', () => {
    const sizes = sheets.find((s) => s.file === 'BrushSizes.svelte')!.text;
    expect(sizes).toMatch(/@media \(forced-colors: active\)\s*\{\s*\.dot\s*\{\s*background: CanvasText/);
  });

  it('the brush cursor keeps its ink ring and canvas halo — the sheet under it is never recoloured', () => {
    const view = sheets.find((s) => s.file === 'CanvasView.svelte')!.text;
    expect(view).toMatch(/\.brush-cursor \{[^}]*forced-color-adjust: none/);
  });

  it.each([
    ['Timeline.svelte', '.bar > span'],
    ['PanelArranger.svelte', '.drop-line'],
  ])('%s: %s, a mark drawn by its background, is drawn in CanvasText', (file, sel) => {
    const text = sheets.find((s) => s.file === file)!.text;
    const at = text.indexOf('@media (forced-colors: active)');
    expect(at).toBeGreaterThan(-1);
    expect(text.slice(at)).toMatch(new RegExp(sel.replace(/[.>]/g, (c) => '\\' + c) + '\\s*\\{\\s*background: CanvasText'));
  });

  it('a surface over the canvas that stood out by its shadow gets an edge', () => {
    expect(block('dialog')).toContain('outline: 1px solid CanvasText');
    expect(forced).toContain('[popover]');
    expect(forced).toContain("[role='menu']");
  });
});

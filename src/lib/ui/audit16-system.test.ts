import { describe, expect, it } from 'bun:test';
import { sheetScrollsWhole } from './small-screen';

// Sixteenth audit, the small screens and the shared system. Measured live at
// 320×568, 360×740, 390×844, 740×360, 820×1180 and 1280×800 (touch and
// mouse), at 100 % and 200 % text, forced colours on and off; the logic is
// asserted by behaviour, the sheets and the components as source, like
// audit15-system: the browsers and the phones are not in the run.
const UI = new URL('./', import.meta.url).pathname;
const editorUi = await Bun.file(UI + 'Editor.svelte').text();
const rule = (selector: string, from = editorUi) => {
  const at = from.indexOf(`${selector} {`);
  return at < 0 ? '' : from.slice(at, from.indexOf('}', at));
};

describe('a sheet on a low screen scrolls whole', () => {
  // 740×360 at 200 % text: the head (the title and ×) and the foot («Готово»)
  // kept 268 of the sheet's 306 px, pinned, and every sheet — export,
  // settings, drafts, the manual — showed its body through a 35 px slit.
  // Where the chrome would take more than the body, the sheet scrolls as one.
  it('when 85 % of the height would leave the body less than the head and the foot', () => {
    expect(sheetScrollsWhole(360, 32)).toBe(true);
    expect(sheetScrollsWhole(568, 32)).toBe(true);
    expect(sheetScrollsWhole(360, 16)).toBe(false);
    expect(sheetScrollsWhole(844, 32)).toBe(false);
    expect(sheetScrollsWhole(300, 16)).toBe(true);
    // Not measured yet: the pinned sheet.
    expect(sheetScrollsWhole(0, 16)).toBe(false);
  });

  it('the studio says so, and the sheet scrolls, its body does not', () => {
    expect(editorUi).toContain('class:low={sheetScrollsWhole(viewportHeight, rootFont)}');
    const sheet = rule('.editor.low :global(.sheet)');
    expect(sheet).toMatch(/overflow-y:\s*auto/);
    expect(sheet).toMatch(/overscroll-behavior:\s*contain/);
    const body = rule('.editor.low :global(.sheet-body)');
    expect(body).toMatch(/flex:\s*none/);
    expect(body).toMatch(/overflow-y:\s*visible/);
  });
});

describe('a tool window on a small screen stays clear of the tab window', () => {
  // 390×844, the «Цвет» tab open and the pipette picked in it: its source
  // window («Холст» / «Слой») lay in the stage's bottom row, wholly under the
  // tab window — out of the finger's reach, its keys still in the Tab order
  // (WCAG 2.4.11). Lying down (740×360) the side window hid «Слой». The
  // transform fields and a plugin's window sit in the same row.
  it('standing, the tool windows rise above the tab window, as tall as it is measured', () => {
    expect(editorUi).toMatch(/id="tab-window"[^>]*bind:offsetHeight=\{tabWindowHeight\}/);
    expect(editorUi).toMatch(/class="tool-windows" bind:offsetHeight=\{toolWindowsHeight\}/);
    expect(editorUi).toContain('style:--tab-window-h={shownTab ? `${tabWindowHeight}px` : undefined}');
    const low = rule('.studio.compact .stage.low-window > .tool-windows');
    expect(low).toMatch(/position:\s*absolute/);
    // `inset`, not `bottom`: the float's own `top` stretched it to 403 px.
    expect(low).toMatch(/inset:\s*auto 0 var\(--tab-window-h\) 0/);
  });

  it('and the thickness rail ends above both', () => {
    expect(rule('.studio.compact .stage.low-window :global(.size-rail)')).toMatch(
      /bottom:\s*calc\(max\(55%, var\(--tab-window-h, 0px\) \+ var\(--tool-windows-h, 0px\)\) \+ 0\.75rem\)/,
    );
  });

  it('lying down, they end where the side window begins', () => {
    expect(rule('.studio.compact .stage.side-window > .tool-windows')).toMatch(/margin-right:\s*calc\(min\(55%, 24rem\) \+ 0\.5rem\)/);
  });
});

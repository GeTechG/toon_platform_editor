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

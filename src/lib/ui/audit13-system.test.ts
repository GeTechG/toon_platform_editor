import { describe, expect, it } from 'bun:test';

// Thirteenth audit, the small screens and the shared system: the first look
// at the one-window layout since it shipped. Measured live at 360×740,
// 740×360 and 820×1180, at 100 % and 200 % text; asserted here as source.
const UI = new URL('./', import.meta.url).pathname;
const editorUi = await Bun.file(UI + 'Editor.svelte').text();
const rule = (selector: string) => {
  const at = editorUi.indexOf(`${selector} {`);
  return at < 0 ? '' : editorUi.slice(at, editorUi.indexOf('}', at));
};

describe('the step follows the text size, not only the window', () => {
  // A text-only zoom (Firefox «Zoom text only», a font size changed in the
  // browser's settings, a host that sets its root size) resizes no window.
  // The step kept 100 %'s sum: a portrait tablet at 200 % stayed «full» with
  // a canvas 42 px wide.
  it('the root text size is watched by a ResizeObserver on a one-rem probe', () => {
    const scale = editorUi.match(/const textScale = \$derived[^;]*;/)?.[0] ?? '';
    expect(scale).not.toContain('viewportWidth');
    expect(editorUi).toMatch(/class="rem-probe"[^>]*bind:this=\{remProbe\}/);
    expect(editorUi).toMatch(/new ResizeObserver\(readRootFont\)/);
    expect(rule('.rem-probe')).toMatch(/width:\s*1rem/);
  });
});

describe('the zoom window is whole on a narrow stage', () => {

});

describe('the studio in full screen keeps off the cutout', () => {
  // Its own full screen hides the site's header: on a phone standing up the
  // notch sat over the first key and the zoom window.
  it('pads its top by the safe area there', () => {
    expect(rule('.editor.studio:fullscreen')).toMatch(/padding-top:\s*env\(safe-area-inset-top\)/);
  });
});

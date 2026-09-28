import { describe, expect, it } from 'bun:test';
import ru from '../i18n/ru.json';

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

describe('the dock stays one line lying down at 200 % text', () => {
  // 740×360 at 200 %: three 88 px transport keys and five tabs did not share
  // a line, the dock took 167 px and left the sheet 160. On 360×740 the
  // transport itself broke in two. The tabs already sit on the 44 px floor.
  it('the mini transport keys take the tap floor, as the tabs do', () => {
    expect(rule('.mini-transport')).toMatch(/--key-h:\s*var\(--tap\)/);
  });
});

describe('the zoom window is whole on a narrow stage', () => {
  // 360×740 at 200 %: 293 px of keys on a 240 px stage, «−» clipped under
  // the tool column — neither seen nor pressable.
  it('keys on the tap floor, never wider than the stage', () => {
    const zoom = rule('.studio.compact .scale-window');
    expect(zoom).toMatch(/--key-h:\s*var\(--tap\)/);
    expect(zoom).toMatch(/max-width:\s*calc\(100% - 2 \* var\(--zoom-inset\)\)/);
    expect(rule('.studio.compact .scale-window :global(.value)')).toMatch(/min-width:\s*0/);
  });

  it('the thickness rail clears the window as tall as it now is', () => {
    expect(editorUi).toMatch(/--zoom-foot: calc\(var\(--zoom-inset\) \+ var\(--tap\) \+ 4px/);
  });
});

describe('the mini transport says which frame in words', () => {
  // «1 / 3» was read as «один косая черта три».
  it('the count is spoken as «Кадр 1 из 3», the slash is for the eyes', () => {
    expect(ru.editor.frame_of_said).toBe('Кадр {{n}} из {{total}}');
    const count = editorUi.match(/<span class="frame-of"[^]*?<\/span>\s*<\/span>/)?.[0] ?? '';
    expect(count).toContain('aria-hidden="true"');
    expect(count).toContain("t('editor.frame_of_said'");
    expect(count).toContain('class="sr-only"');
  });
});

describe('the studio in full screen keeps off the cutout', () => {
  // Its own full screen hides the site's header: on a phone standing up the
  // notch sat over the first key and the zoom window.
  it('pads its top by the safe area there', () => {
    expect(rule('.editor.studio:fullscreen')).toMatch(/padding-top:\s*env\(safe-area-inset-top\)/);
  });
});

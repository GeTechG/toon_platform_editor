import { describe, expect, it } from 'bun:test';
import { plugins } from '../plugins';

// Seventeenth audit, the small screens and the shared system. Measured live at
// 320×568, 360×740, 390×844, 568×320, 740×360, 844×390, 768×1024 and 600×960
// (touch), at 100, 150 and 200 % text, forced colours on and off. The layout
// cut runs for real; the sheets are asserted as source, like audit16-system.
void plugins;
const UI = new URL('./', import.meta.url).pathname;
const editorUi = await Bun.file(UI + 'Editor.svelte').text();
const audioUi = await Bun.file(UI + 'AudioPanel.svelte').text();
const rule = (selector: string, from = editorUi) => {
  const at = from.indexOf(`${selector} {`);
  return at < 0 ? '' : from.slice(at, from.indexOf('}', at));
};

describe('the sound window keeps its × on the screen', () => {
  // 320×568 at 200 % text: the heading and the 88 px × asked 187 px of a
  // 152 px plate; the × stood 10 px past the screen's edge and the window
  // scrolled sideways. «Заменить» and the bin did the same.
  it('the head and the key row wrap instead of widening the window', () => {
    expect(rule('header', audioUi)).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.row', audioUi)).toMatch(/flex-wrap:\s*wrap/);
  });
});

import { describe, expect, it } from 'bun:test';
import { plugins } from '../plugins';
import { defaultPanels, movePanelItem } from './panels';
import { DEFAULT_TAB_ORDER, compactLayout } from './small-screen';

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

describe('the tablet column does not carry a second transport', () => {
  // The transport moved into the left column on a desktop: on a tablet
  // standing up the column drew the whole widget — a second play key and
  // frame count under the mini transport, which is always there.
  it('the mini transport does its work; the column leaves it out', () => {
    const layout = movePanelItem(defaultPanels(), 'transport', 'left', 0);
    expect(layout.left).toContain('transport');
    for (const step of ['tablet', 'phone'] as const) {
      const cut = compactLayout(layout, step, DEFAULT_TAB_ORDER);
      expect(cut.rail).not.toContain('transport');
      expect(cut.tabs.flatMap((tab) => tab.items)).not.toContain('transport');
    }
  });
});

describe('the frame rate slider never shrinks under its knob', () => {
  // 320×568 at 200 % text: the timeline tab's window is 200 px, and the
  // slider gave way to 11 px under a 40 px knob — a sliver no finger moves.
  // It shares the box's line where it fits whole, and takes a line of its
  // own where it does not.
  it('the pair wraps where the slider’s own 6 rem do not fit beside the box', () => {
    expect(rule('.tab-window > .fps-inline')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.fps-inline input[type=\'range\']')).toMatch(/width:\s*6rem/);
    expect(rule(".tab-window .fps-inline input[type='range']")).not.toMatch(/(^|[^-])width:/);
  });
});

describe('the sound window keeps its × on the screen', () => {
  // 320×568 at 200 % text: the heading and the 88 px × asked 187 px of a
  // 152 px plate; the × stood 10 px past the screen's edge and the window
  // scrolled sideways. «Заменить» and the bin did the same.
  it('the head and the key row wrap instead of widening the window', () => {
    expect(rule('header', audioUi)).toMatch(/flex-wrap:\s*wrap/);
    expect(rule('.row', audioUi)).toMatch(/flex-wrap:\s*wrap/);
  });
});

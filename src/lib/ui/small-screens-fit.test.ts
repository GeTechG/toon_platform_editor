import { describe, expect, it } from 'bun:test';
import { tabLabelsFit } from './small-screen';

// The owner: at 200 % text the tab words broke («Цв/ет», «Тайм/лайн») — when
// any word does not fit on one line, every tab shows only its icon; and on
// 390×844 at 200 % the thickness rail ran under the zoom window. The fit runs
// for real; the markup is asserted as source.
const UI = new URL('./', import.meta.url).pathname;
const editorUi = await Bun.file(UI + 'Editor.svelte').text();
const rule = (selector: string) => {
  const at = editorUi.indexOf(`${selector} {`);
  return at < 0 ? '' : editorUi.slice(at, editorUi.indexOf('}', at));
};

describe('the tab words fit all or none', () => {
  it('every word within its tab: the words stay', () => {
    expect(tabLabelsFit([{ scrollWidth: 40, clientWidth: 60 }, { scrollWidth: 60, clientWidth: 60 }])).toBe(true);
  });

  it('one word wider than its tab: all go', () => {
    expect(tabLabelsFit([{ scrollWidth: 40, clientWidth: 60 }, { scrollWidth: 61, clientWidth: 60 }])).toBe(false);
  });

  it('no tabs: nothing to hide', () => {
    expect(tabLabelsFit([])).toBe(true);
  });
});

describe('the tabs measure their words, not the screen', () => {
  it('a ResizeObserver on the bar and the words decides, through tabLabelsFit', () => {
    expect(editorUi).toContain('new ResizeObserver');
    expect(editorUi).toMatch(/tabsBare = !tabLabelsFit\(/);
    expect(editorUi).toContain('class:bare={tabsBare}');
  });

  it('the name stays in aria-label and title', () => {
    const tab = editorUi.slice(editorUi.indexOf('class="tab"'), editorUi.indexOf('</button>', editorUi.indexOf('class="tab"')));
    expect(tab).toContain('aria-label={t(`editor.tab.${tab.id}`)}');
    expect(tab).toContain('title={t(`editor.tab.${tab.id}`)}');
  });

  it('a word is one line as wide as its tab and never breaks', () => {
    const label = rule('.tab-label');
    expect(label).toContain('white-space: nowrap');
    expect(label).not.toContain('overflow-wrap: anywhere');
  });

  it('hidden, the word keeps the width it is measured in: no flicker', () => {
    const bare = rule('.tabs.bare .tab-label');
    expect(bare).toContain('position: absolute');
    expect(bare).toContain('visibility: hidden');
    expect(rule('.tab')).toContain('position: relative');
  });
});

describe('the thickness rail keeps clear of the zoom window', () => {
  it('on a small screen the rail starts below the zoom window’s row', () => {
    const rail = rule('.studio.compact .stage :global(.size-rail)');
    expect(rail).toMatch(/top: max\([^;]*var\(--zoom-foot\)/);
    expect(rail).toContain('min-height: var(--key-h)');
  });

  it('the zoom window sits at the same inset the rail counts from', () => {
    expect(rule('.studio.compact .scale-window')).toContain('top: var(--zoom-inset)');
    expect(editorUi).toMatch(/--zoom-foot: calc\(var\(--zoom-inset\) \+ var\(--key-h\) \+ 4px/);
  });
});

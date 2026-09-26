import { describe, expect, it } from 'bun:test';
import { plugins } from '../plugins';
import { defaultPanels, movePanelItem, toolItem, toolOrder } from './panels';
import { DEFAULT_TAB_ORDER, compactLayout, normalizeTabOrder } from './small-screen';

// The owner, after «одно окно за раз»: «сделай расположение кнопок ближе, как
// в десктопе. Вместо "Слои" — "Таймлайн", туда можно положить fps. "Отправить
// мульт" — на левую панель вниз». The cut runs for real; the studio markup and
// styles are asserted as source.
void plugins;
const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const editorUi = await read('./Editor.svelte');
const style = editorUi.slice(editorUi.indexOf('<style>'));
const ru = JSON.parse(await read('../i18n/ru.json'));
const icons = await read('./Icon.svelte');
const rule = (selector: string) => {
  const at = style.indexOf(`${selector} {`);
  return at < 0 ? '' : style.slice(at, style.indexOf('}', at));
};

describe('the small screen’s column is the desktop’s left column', () => {
  // A phone keeps only the essentials of it: small-screens-essentials.test.ts.
  it('a tablet gets the left column in its order, the publish key taken to the foot', () => {
    const layout = defaultPanels();
    const cut = compactLayout(layout, 'tablet', DEFAULT_TAB_ORDER);
    expect(cut.rail).toEqual(layout.left.filter((id) => id !== 'publish'));
    expect(cut.rail).toEqual([...toolOrder().map(toolItem), 'save', 'export', 'history', 'fullscreen', 'manual']);
    expect(cut.foot).toEqual(['publish']);
  });

  it('the tablet has the same column and the same foot', () => {
    const cut = compactLayout(defaultPanels(), 'tablet', DEFAULT_TAB_ORDER);
    expect(cut.rail).toContain('save');
    expect(cut.foot).toEqual(['publish']);
  });

  it('what the column holds is not behind «⋯» any more', () => {
    const more = compactLayout(defaultPanels(), 'phone', DEFAULT_TAB_ORDER).tabs.find((tab) => tab.id === 'more')?.items ?? [];
    for (const id of ['save', 'export', 'publish', 'fullscreen', 'manual', 'history']) expect(more).not.toContain(id);
    expect(more).toContain('settings');
  });

  it('publish comes to the foot wherever the layout put it', () => {
    const layout = movePanelItem(defaultPanels(), 'publish', 'row:0');
    const cut = compactLayout(layout, 'phone', DEFAULT_TAB_ORDER);
    expect(cut.foot).toEqual(['publish']);
    expect(cut.tabs.flatMap((tab) => tab.items)).not.toContain('publish');
  });

  it('tools and history placed elsewhere come after the column’s own keys', () => {
    let layout = movePanelItem(defaultPanels(), toolItem('pencil'), 'row:0');
    layout = movePanelItem(layout, 'history', 'row:0');
    const cut = compactLayout(layout, 'phone', DEFAULT_TAB_ORDER);
    expect(cut.rail.slice(-2)).toEqual([toolItem('pencil'), 'history']);
  });

  it('a phone’s one-key column sends a wide widget to its tab; the tablet keeps it', () => {
    const layout = movePanelItem(defaultPanels(), 'palette', 'left');
    expect(compactLayout(layout, 'phone', DEFAULT_TAB_ORDER).rail).not.toContain('palette');
    expect(compactLayout(layout, 'phone', DEFAULT_TAB_ORDER).tabs[0]).toEqual({ id: 'color', items: ['palette'] });
    expect(compactLayout(layout, 'tablet', DEFAULT_TAB_ORDER).rail).toContain('palette');
  });

  it('with no publish placed there is no foot', () => {
    const layout = { ...defaultPanels() };
    layout.left = layout.left.filter((id) => id !== 'publish');
    expect(compactLayout(layout, 'phone', DEFAULT_TAB_ORDER).foot).toEqual([]);
  });
});

describe('«Слои» is «Таймлайн», with the frame and playback settings in it', () => {
  it('the tab is timeline, in the old place of layers', () => {
    expect(DEFAULT_TAB_ORDER).toEqual(['color', 'brush', 'timeline', 'sound', 'more']);
    expect(ru.editor.tab.timeline).toBe('Таймлайн');
    expect(ru.editor.tab.layers).toBeUndefined();
  });

  it('holds fps, the onion skin and the frame key, the strip last; not the transport', () => {
    const cut = compactLayout(defaultPanels(), 'phone', DEFAULT_TAB_ORDER);
    const items = cut.tabs.find((tab) => tab.id === 'timeline')?.items ?? [];
    expect(items).toEqual(['fps', 'add-frame', 'onion', 'timeline']);
    expect(cut.tabs.flatMap((tab) => tab.items)).not.toContain('transport');
  });

  it('the cell keys, once placed, go to the timeline too', () => {
    const layout = movePanelItem(defaultPanels(), 'copy', 'row:0');
    const items = compactLayout(layout, 'phone', DEFAULT_TAB_ORDER).tabs.find((tab) => tab.id === 'timeline')?.items ?? [];
    expect(items).toContain('copy');
    expect(items.at(-1)).toBe('timeline');
  });

  it('a stored order with the old layers reads as timeline in the same place', () => {
    expect(normalizeTabOrder(['sound', 'layers', 'color'])).toEqual(['sound', 'timeline', 'color', 'brush', 'more']);
  });

  it('the tab wears a timeline icon of its own', () => {
    expect(editorUi).toMatch(/timeline: 'timeline'/);
    expect(icons).toMatch(/\n\s*timeline: '/);
  });
});

describe('the studio draws the column down the left in both orientations', () => {
  it('the foot is drawn after the keys, and only with a host that publishes', () => {
    expect(editorUi).toMatch(/\{@render slot\(cut\.rail\)\}\s*<\/div>\s*\{#if onPublish && cut\.foot\.length > 0\}\s*<div class="rail-foot">\{@render slot\(cut\.foot\)\}<\/div>/);
  });

  it('the keys scroll inside the column; the foot stays at its bottom, never scrolled away', () => {
    expect(rule('.studio.compact .left')).toMatch(/flex-direction:\s*column/);
    expect(rule('.studio.compact .left')).toMatch(/overflow:\s*hidden/);
    expect(rule('.rail-keys')).toMatch(/overflow-y:\s*auto/);
    expect(rule('.studio.compact .rail-foot')).toMatch(/margin-top:\s*auto/);
    expect(rule('.studio.compact .rail-foot')).toMatch(/flex:\s*none/);
  });

  it('the foot key takes one cell, as on the desktop, not the column’s width', () => {
    expect(style).toMatch(/\n  \.rail-foot \{[^}]*grid-template-columns:\s*repeat\(auto-fill/);
  });

  it('the dock runs under the column, as the desktop’s bottom bar does', () => {
    // Beside the column the tabs lost 60 px at 390 and «Таймлайн» broke in two.
    expect(rule('.studio.compact .left')).toMatch(/grid-row:\s*1;/);
    expect(rule('.studio.compact .dock')).toMatch(/grid-column:\s*1 \/ -1/);
  });

  it('lying down the column keeps the whole height, the dock beside it', () => {
    // 844×390 at 200 %: over the dock the column had 279 px, its foot 120 of
    // them, and showed a key and a half.
    expect(rule('.studio.compact:not(.tall) .left')).toMatch(/grid-row:\s*1 \/ -1/);
    expect(rule('.studio.compact:not(.tall) .dock')).toMatch(/grid-column:\s*2;/);
  });

  it('no strip across the top any more: a phone standing up has the column too', () => {
    expect(style).not.toContain('.studio.phone.tall .left');
    expect(style).not.toContain('.editor.studio.phone.tall {');
    expect(rule('.studio.phone .left')).toMatch(/width:\s*calc\(var\(--key-h\) \+ 1rem\)/);
    expect(rule('.studio.compact .rail-keys')).toMatch(/mask-image:\s*linear-gradient\(to bottom/);
  });
});

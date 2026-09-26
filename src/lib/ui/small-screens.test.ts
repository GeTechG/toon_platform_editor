import { describe, expect, it } from 'bun:test';
import { plugins } from '../plugins';
import { defaultPanels, movePanelItem, hidePanelItem, toolItem, toolOrder } from './panels';
import { parseUiConfig, DEFAULT_SETTINGS } from './presets';
import {
  DEFAULT_TAB_ORDER,
  HYSTERESIS,
  compactLayout,
  moveTab,
  normalizeTabOrder,
  pickStep,
} from './small-screen';

// The owner's «одно окно за раз». The step, the split of the layout into a
// rail and tabs, and the tab order run for real; the studio markup is
// asserted as source below.
void plugins;
const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const editorUi = await read('./Editor.svelte');
const style = editorUi.slice(editorUi.indexOf('<style>'));

describe('the layout step is worked out from the room the canvas would get', () => {
  const view = { w: 1280, h: 800 };
  const roomy = { w: 891, h: 649 };

  it('a canvas with room keeps the full layout', () => {
    expect(pickStep('full', { full: roomy, tablet: roomy }, view)).toBe('full');
  });

  it('under min(360px, 45vw) wide the columns go', () => {
    // 768×1024 at 200 % text: the columns left the canvas 0 px.
    const v = { w: 768, h: 1024 };
    expect(pickStep('full', { full: { w: 0, h: 627 }, tablet: { w: 499, h: 870 } }, v)).toBe('tablet');
  });

  it('under 38dvh tall the columns go too', () => {
    const v = { w: 768, h: 1024 };
    expect(pickStep('full', { full: { w: 500, h: 380 }, tablet: { w: 634, h: 900 } }, v)).toBe('tablet');
  });

  it('the tablet step needs a whole 360 px beside its column, or it is a phone', () => {
    // 390×844: the tool column would leave 256 px — more than 45vw, still a phone.
    const v = { w: 390, h: 844 };
    expect(pickStep('full', { full: { w: 2, h: 426 }, tablet: { w: 256, h: 700 } }, v)).toBe('phone');
  });

  it('the tablet step is for a screen standing up; lying down a phone step it is', () => {
    // 844×390 at 200 % text: a 269px tool column beside a canvas 207 tall,
    // where the one-key strip leaves it the whole height.
    const v = { w: 844, h: 390 };
    expect(pickStep('full', { full: { w: 66, h: 195 }, tablet: { w: 575, h: 280 } }, v)).toBe('phone');
  });

  it('a narrow viewport lowers the width floor to 45vw for the full layout', () => {
    const v = { w: 700, h: 900 };
    expect(pickStep('full', { full: { w: 320, h: 600 }, tablet: { w: 560, h: 800 } }, v)).toBe('full');
  });

  it('stepping up needs the floor plus the hysteresis, stepping down does not', () => {
    const v = { w: 800, h: 1280 };
    const edge = { w: 360 + HYSTERESIS / 2, h: 600 };
    expect(pickStep('full', { full: edge, tablet: edge }, v)).toBe('full');
    expect(pickStep('tablet', { full: edge, tablet: { w: 900, h: 700 } }, v)).toBe('tablet');
    expect(pickStep('tablet', { full: { w: 360 + HYSTERESIS, h: 600 }, tablet: { w: 900, h: 700 } }, v)).toBe('full');
    expect(pickStep('phone', { full: { w: 0, h: 0 }, tablet: { w: 360 + HYSTERESIS / 2, h: 700 } }, v)).toBe('phone');
  });
});

describe('the tabs are cut from the user’s own layout', () => {
  it('a phone rail holds every placed tool and the history; the rest goes to the tabs', () => {
    const cut = compactLayout(defaultPanels(), 'phone', DEFAULT_TAB_ORDER);
    expect(cut.rail).toEqual([...toolOrder().map(toolItem), 'history']);
    expect(cut.tabs.map((tab) => tab.id)).toEqual(['color', 'brush', 'layers', 'sound', 'more']);
    expect(cut.tabs.find((tab) => tab.id === 'color')?.items).toEqual(['palette']);
    expect(cut.tabs.find((tab) => tab.id === 'layers')?.items).toEqual(['timeline']);
    const more = cut.tabs.find((tab) => tab.id === 'more')?.items ?? [];
    expect(more).toContain('save');
    expect(more).toContain('settings');
    expect(more).toContain('publish');
    // The mini transport does the transport's work; the rail holds the tools.
    expect(more).not.toContain('transport');
    expect(more).not.toContain(toolItem('pencil'));
    expect(more).not.toContain('history');
  });

  it('the tablet keeps the left column as it is', () => {
    const layout = defaultPanels();
    const cut = compactLayout(layout, 'tablet', DEFAULT_TAB_ORDER);
    expect(cut.rail).toEqual(layout.left);
    const more = cut.tabs.find((tab) => tab.id === 'more')?.items ?? [];
    expect(more).not.toContain('save');
  });

  it('a floating window is a tab; its place on a big screen is not touched', () => {
    const layout = movePanelItem(defaultPanels(), 'palette', 'float');
    expect(compactLayout(layout, 'phone', DEFAULT_TAB_ORDER).tabs[0]).toEqual({ id: 'color', items: ['palette'] });
    expect(layout.float).toEqual(['palette']);
  });

  it('a tab with nothing in it is not drawn; the shelf is not a tab', () => {
    const layout = hidePanelItem(defaultPanels(), 'audio');
    expect(compactLayout(layout, 'phone', DEFAULT_TAB_ORDER).tabs.map((tab) => tab.id)).not.toContain('sound');
  });

  it('the tabs come in the user’s order', () => {
    const order = moveTab(DEFAULT_TAB_ORDER, 'sound', 0);
    expect(order).toEqual(['sound', 'color', 'brush', 'layers', 'more']);
    expect(compactLayout(defaultPanels(), 'phone', order).tabs.map((tab) => tab.id)).toEqual(order);
  });
});

describe('the tab order is a setting', () => {
  it('reads back clean: unknown ids out, missing ones back at the end', () => {
    expect(normalizeTabOrder(['layers', 'nope', 'layers', 'color'])).toEqual(['layers', 'color', 'brush', 'sound', 'more']);
    expect(normalizeTabOrder(undefined)).toEqual([...DEFAULT_TAB_ORDER]);
  });

  it('is stored with the rest of the settings', () => {
    expect(DEFAULT_SETTINGS.tabOrder).toEqual([...DEFAULT_TAB_ORDER]);
    const saved = parseUiConfig(JSON.stringify({ preset: 'toonop', settings: { tabOrder: ['more', 'color'] } }));
    expect(saved?.settings.tabOrder).toEqual(['more', 'color', 'brush', 'layers', 'sound']);
  });
});

describe('the studio takes its step from the sum, not from a width query', () => {
  it('no studio branch hangs on the screen width or height any more', () => {
    expect(style).not.toContain('@media (max-width: 40rem)');
    expect(style).not.toContain('@media (max-height: 30rem)');
    expect(editorUi).not.toMatch(/viewportWidth > 640/);
  });

  it('the step is picked from the editor box with the columns taken out', () => {
    expect(editorUi).toMatch(/pickStep\(/);
    expect(editorUi).toContain('bind:clientWidth={boxW}');
    expect(editorUi).toContain('bind:clientHeight={boxH}');
    expect(editorUi).toMatch(/class:compact=\{compact\}/);
    expect(editorUi).toMatch(/class:phone=\{step === 'phone'\}/);
  });

  it('on a small screen the right column, the bottom bar and the windows are not drawn', () => {
    expect(editorUi).toMatch(/\{#if !compact && \(editor\.panels\.right\.length > 0/);
    expect(editorUi).toMatch(/\{#if !compact && \(editor\.panels\.rows\.length > 0/);
    expect(editorUi).toMatch(/\{#if !compact\}\s*\{#each \[\.\.\.editor\.panels\.float\]/);
  });
});

describe('one window at a time', () => {
  it('each tab is a disclosure: aria-expanded and aria-controls', () => {
    expect(editorUi).toMatch(/aria-expanded=\{openTab === tab\.id\}/);
    expect(editorUi).toMatch(/aria-controls="tab-window"/);
    expect(editorUi).toMatch(/id="tab-window"/);
  });

  it('a second press closes, another tab swaps, Esc closes and the focus goes home', () => {
    const toggle = editorUi.match(/\n  async function toggleTab\([^]*?\n  }/)?.[0] ?? '';
    expect(toggle).toMatch(/openTab === id/);
    expect(toggle).toContain('closeTab()');
    expect(toggle).toMatch(/focus\(\)/);
    const close = editorUi.match(/\n  function closeTab\([^]*?\n  }/)?.[0] ?? '';
    expect(close).toMatch(/tabKeys\[[^\]]+\]\?\.focus\(\)/);
    expect(editorUi).toMatch(/function onTabWindowKey\([^]*?'Escape'[^]*?closeTab\(\)/);
  });

  it('the mini transport stays outside the window', () => {
    expect(editorUi).toMatch(/class="mini-transport"/);
    expect(editorUi).toMatch(/\{t\('editor\.frame_of'/);
  });

  it('the sound tab draws the plate docked, not as a fixed popover', () => {
    expect(editorUi).toMatch(/<AudioPanel \{editor\} docked/);
  });

  it('reduced motion takes the slide away; forced colors outline the window', () => {
    expect(style).toMatch(/prefers-reduced-motion: reduce\)[^]*\.tab-window[^}]*animation:\s*none/);
    expect(style).toMatch(/forced-colors: active\)[^]*\.tab-window[^}]*outline/);
  });

  it('tabs move under a pointer, placed by the arranger’s own geometry', () => {
    expect(editorUi).toMatch(/import \{ dropPlacement \} from '\.\/arrange'/);
    expect(editorUi).toMatch(/editor\.setSetting\('tabOrder', moveTab\(/);
  });
});

describe('a small screen offers only the tab order to rearrange', () => {
  it('the settings sheet swaps «Редактировать панели» for a word about the tabs', async () => {
    const sheet = await read('./SettingsSheet.svelte');
    expect(sheet).toMatch(/\{#if compact\}\s*<p class="hint">\{t\('settings\.tabs_hint'\)\}<\/p>\s*\{:else\}/);
    expect(editorUi).toMatch(/<SettingsSheet\s+\{editor\}\s+\{compact\}/);
  });
});

describe('the sound plate docked in a window', () => {
  it('places nothing itself and stays in the flow of the window', async () => {
    const plate = await read('./AudioPanel.svelte');
    expect(plate).toMatch(/docked = false/);
    expect(plate).toMatch(/if \(docked\) \{\s*at = undefined;/);
    expect(plate).toMatch(/class:docked/);
    expect(plate).toMatch(/\.audio-plate\.docked \{[^}]*position: static/);
  });
});

describe('a drag that fires no click does not eat the next press', () => {
  it('each press starts with the dropped flag down', () => {
    // A finger dragged a tab and the browser sent no click after it: the
    // flag stayed up and swallowed the next real tap on any tab.
    const down = editorUi.match(/\n  function onTabDown\([^]*?\n  }/)?.[0] ?? '';
    expect(down).toContain('tabDropped = false');
  });
});

describe('Esc closes the window wherever the focus is', () => {
  it('the studio key handler closes an open window before anything else takes Esc', () => {
    // After a press on the mini transport the focus is outside the window,
    // and Esc went nowhere: the window stayed open over the canvas.
    const keys = editorUi.slice(editorUi.indexOf('function onKeydown('));
    const close = keys.indexOf("key === 'Escape' && openTab");
    expect(close).toBeGreaterThan(0);
    expect(close).toBeLessThan(keys.indexOf('keyOwner('));
  });
});

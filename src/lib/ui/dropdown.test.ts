import { describe, expect, it } from 'bun:test';
import { placeDropdown, stepOption } from './dropdown';

const read = (name: string) => Bun.file(new URL(`./${name}`, import.meta.url)).text();
const dropdown = await read('Dropdown.svelte');
const view = { width: 1000, height: 800 };

describe('where the list of a drop-down stands', () => {
  it('under its button, four pixels off, when there is room', () => {
    const at = placeDropdown({ left: 100, top: 100, bottom: 144 }, { width: 160, height: 200 }, view);
    expect(at).toEqual({ x: 100, y: 148, maxHeight: 644 });
  });

  it('over the button when the bottom of the window is too near', () => {
    const at = placeDropdown({ left: 100, top: 700, bottom: 744 }, { width: 160, height: 200 }, view);
    expect(at).toEqual({ x: 100, y: 496, maxHeight: 688 });
  });

  it('never past the right edge, never past the left one', () => {
    expect(placeDropdown({ left: 950, top: 100, bottom: 144 }, { width: 160, height: 200 }, view).x).toBe(832);
    expect(placeDropdown({ left: -20, top: 100, bottom: 144 }, { width: 160, height: 200 }, view).x).toBe(8);
  });

  it('fits neither side: the roomier one, scrolling inside it — not laid over its button', () => {
    const at = placeDropdown({ left: 100, top: 300, bottom: 344 }, { width: 160, height: 900 }, view);
    // 800 - 8 - 348 under, 300 - 12 over: under is roomier.
    expect(at).toEqual({ x: 100, y: 348, maxHeight: 444 });
  });

  it('no side holds even two options: the list takes the window', () => {
    const at = placeDropdown({ left: 10, top: 80, bottom: 124 }, { width: 160, height: 400 }, { width: 400, height: 200 });
    expect(at).toEqual({ x: 10, y: 8, maxHeight: null });
  });
});

describe('the keys of a drop-down list', () => {
  it('arrows walk it round, Home and End jump to the ends, the rest is not its own', () => {
    expect(stepOption('ArrowDown', 0, 3)).toBe(1);
    expect(stepOption('ArrowDown', 2, 3)).toBe(0);
    expect(stepOption('ArrowUp', 0, 3)).toBe(2);
    expect(stepOption('Home', 2, 3)).toBe(0);
    expect(stepOption('End', 0, 3)).toBe(2);
    expect(stepOption('a', 0, 3)).toBeNull();
    expect(stepOption('ArrowDown', 0, 0)).toBeNull();
  });
});

describe('every drop-down in the studio is the studio\'s own', () => {
  it('no sheet or bar draws the system list', async () => {
    for (const name of ['SettingsSheet.svelte', 'PanelArranger.svelte', 'ExportSheet.svelte', 'Editor.svelte']) {
      const source = await read(name);
      expect(source).not.toMatch(/<select[\s>]/);
    }
    expect(await read('SettingsSheet.svelte')).toContain('<Dropdown');
    expect(await read('PanelArranger.svelte')).toContain('<Dropdown');
  });

  it('is a button that opens a list of options, named with what is picked', () => {
    expect(dropdown).toContain('aria-haspopup="listbox"');
    expect(dropdown).toContain('role="listbox"');
    expect(dropdown).toContain('role="option"');
    expect(dropdown).toContain('aria-selected={option.value === value}');
    expect(dropdown).toContain("aria-label={`${label}: ${current?.label ?? ''}`}");
  });

  it('Esc closes the list alone, not the mode or the sheet under it', () => {
    expect(dropdown).toMatch(/if \(e\.key === 'Escape'\) \{\s*e\.stopPropagation\(\);\s*return;/);
  });

  it('where the browser has no popover it stays the system list, not a list cut by the sheet', () => {
    // Safari 16: no top layer to lift the list out of a scrolling, transformed sheet.
    expect(dropdown).toMatch(/\{:else\}\s*<select/);
    expect(dropdown).toContain("'popover' in HTMLElement.prototype");
  });

  it('separates the list by tone, not by a shadow', () => {
    const style = dropdown.slice(dropdown.indexOf('<style>'));
    expect(style).not.toContain('box-shadow');
    expect(style).toMatch(/\.list \{[^}]*background: var\(--sub\)/);
    expect(style).toMatch(/\.option\[aria-selected='true'\] \{[^}]*background: var\(--canvas\)/);
  });
});

import { describe, expect, it } from 'bun:test';
import { pickerKeyAction } from './picker-model';
import { t } from '../i18n';

const read = (name: string) => Bun.file(new URL(name, import.meta.url)).text();
const canvas = await read('./CanvasView.svelte');
const brush = await read('./BrushPanel.svelte');
const picker = await read('./ColourPicker.svelte');
const palette = await read('./PaletteBox.svelte');

describe('the colour window leaves Enter and Space to its keys', () => {
  it('a focused key presses itself instead of closing the window', () => {
    // Enter on «RGB» closed the window: the model could not be changed from
    // the keyboard, nor the original colour taken back.
    expect(pickerKeyAction('Enter', 'BUTTON')).toBeNull();
    expect(pickerKeyAction(' ', 'BUTTON')).toBeNull();
  });

  it('the surface and the bar still close on what is chosen, a field commits', () => {
    expect(pickerKeyAction('Enter', 'CANVAS')).toBe('close');
    expect(pickerKeyAction(' ', 'CANVAS')).toBe('close');
    expect(pickerKeyAction('Enter', 'INPUT')).toBe('commit');
    expect(pickerKeyAction(' ', 'INPUT')).toBeNull();
    expect(pickerKeyAction('a', 'CANVAS')).toBeNull();
  });

  it('the component asks the rule, not its own tag check', () => {
    expect(picker).toContain('pickerKeyAction(');
  });

  it('an emptied channel field is not read as zero', () => {
    // `Number('')` is 0: clearing R to type a new value painted the channel black.
    expect(picker).not.toContain('Number(e.currentTarget.value)');
  });

  it('names the wheel in the interface language', () => {
    expect(picker).not.toMatch(/\['wheel', 'Wheel'\]/);
    expect(t('picker.wheel')).toBe('Круг');
  });
});

describe('the brush fields never hand the brush a NaN', () => {
  it('an emptied number field is refused, not saved as `width: null`', () => {
    const snippet = brush.match(/\{#snippet slider[\s\S]*?\{\/snippet\}/)?.[0] ?? '';
    expect(snippet).toContain('Number.isFinite');
  });
});

describe('the saved palettes take a colour from the keyboard too', () => {
  it('a preview cell answers a click, not only a mouse press', () => {
    const grid = palette.match(/<div class="grid preview-grid"[\s\S]*?<\/div>/)?.[0] ?? '';
    // Enter on a button fires `click`, never `mousedown`: the preview was
    // mouse-only.
    expect(grid).toContain('onkeydown=');
  });

  it('counts the colours of a tile in Russian plurals', () => {
    expect(t('palette.tile', { name: 'А', count: 1 })).toBe('Палитра А, 1 цвет');
    expect(t('palette.tile', { name: 'А', count: 3 })).toBe('Палитра А, 3 цвета');
    expect(t('palette.tile', { name: 'А', count: 30 })).toBe('Палитра А, 30 цветов');
  });
});

describe('the canvas', () => {
  it('announces the hidden-layer hint from a live region that is already there', () => {
    // A `role="status"` mounted together with its text is not announced by
    // most screen readers: the region has to exist before the words change.
    const region = canvas.match(/<p class="hint"[^>]*>/)?.[0] ?? '';
    expect(region).toContain('role="status"');
    expect(canvas).not.toMatch(/\{#if hint\}\s*<p class="hint"/);
  });

  it('leaves Space to the preview: the canvas never pans on it', () => {
    // Space was both play/stop and a pan modifier: a held Space started the
    // preview and turned the next press on the sheet into a pan. The owner
    // keeps Space for playback only; the middle button, two fingers and the
    // hand still pan.
    expect(canvas).not.toContain('spaceHeld');
    expect(canvas).not.toMatch(/<svelte:window/);
  });

  it('sizes the hint in rem, so it follows the reader’s text size', () => {
    const style = canvas.match(/\.hint \{[\s\S]*?\}/)?.[0] ?? '';
    expect(style).not.toMatch(/font-size:\s*\d+px/);
  });
});

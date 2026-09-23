import { describe, expect, it } from 'bun:test';
import { ctrlWheelZoom, WHEEL_ZOOM_RATE } from './viewport';
import { SIZE_TRACK, sizeAtPosition, positionOfSize } from './size-scale';
import { parseUiConfig, DEFAULT_SETTINGS } from './presets';
import { t } from '../i18n';

// The owner's answers after the ninth audit: onion frame numbers in the
// blue of the onion-skin, a thickness track that gives the thin sizes room,
// Ctrl+wheel (and a Mac trackpad pinch) zooming the sheet, and the
// mega-eraser warning with «Больше не показывать».
const UI = new URL('./', import.meta.url).pathname;
const tokensCss = await Bun.file(UI + 'tokens.css').text();
const timeline = await Bun.file(UI + 'Timeline.svelte').text();
const canvasView = await Bun.file(UI + 'CanvasView.svelte').text();
const brushPanel = await Bun.file(UI + 'BrushPanel.svelte').text();
const editorUi = await Bun.file(UI + 'Editor.svelte').text();
const settingsSheet = await Bun.file(UI + 'SettingsSheet.svelte').text();
const ru = await Bun.file(UI + '../i18n/ru.json').json();

describe('onion frame numbers are the onion-skin blue', () => {
  it('the header mark takes its own token, the dark electric for text', () => {
    expect(tokensCss).toContain('--onion-ink: var(--electric-dark);');
    const at = timeline.indexOf('.num.onion {');
    expect(timeline.slice(at, timeline.indexOf('}', at))).toContain('color: var(--onion-ink);');
  });
});

describe('the thickness track is logarithmic', () => {
  it('runs from the least to the most', () => {
    expect(sizeAtPosition(0, 1, 500)).toBe(1);
    expect(sizeAtPosition(SIZE_TRACK, 1, 500)).toBe(500);
  });

  it('gives the everyday sizes most of the track', () => {
    // Linear, 1–20 was the first 4% of the track; now it is nearly half.
    expect(positionOfSize(20, 1, 500) / SIZE_TRACK).toBeGreaterThan(0.4);
    expect(sizeAtPosition(SIZE_TRACK / 2, 1, 500)).toBeLessThan(30);
  });

  it('goes there and back', () => {
    for (const size of [1, 2, 9, 20, 64, 333, 500]) {
      expect(sizeAtPosition(positionOfSize(size, 1, 500), 1, 500)).toBe(size);
    }
  });

  it('never leaves the range and survives a range of one size', () => {
    expect(positionOfSize(9999, 1, 500)).toBe(SIZE_TRACK);
    expect(positionOfSize(0, 1, 500)).toBe(0);
    expect(sizeAtPosition(300, 5, 5)).toBe(5);
    expect(positionOfSize(5, 5, 5)).toBe(0);
  });

  it('the slider speaks the size and keys step one size at a time', () => {
    expect(brushPanel).toContain('sizeAtPosition(');
    expect(brushPanel).toContain('aria-valuetext');
    expect(brushPanel).toMatch(/ArrowUp[^]*?ArrowDown/);
  });
});

describe('Ctrl+wheel zooms the sheet', () => {
  it('a trackpad pinch step is small and smooth', () => {
    const z = ctrlWheelZoom(1, -4, 0);
    expect(z).toBeGreaterThan(1);
    expect(z).toBeLessThan(1.05);
  });

  it('a mouse notch is a clear step, and a huge delta is capped', () => {
    expect(ctrlWheelZoom(1, -100, 0)).toBeCloseTo(Math.exp(100 * WHEEL_ZOOM_RATE));
    expect(ctrlWheelZoom(1, -100000, 0)).toBe(ctrlWheelZoom(1, -100, 0));
    expect(ctrlWheelZoom(2, 100, 0)).toBeLessThan(2);
    // Lines come as one notch.
    expect(ctrlWheelZoom(1, -3, 1)).toBe(ctrlWheelZoom(1, -100, 0));
  });

  it('the canvas keeps Ctrl+wheel from the browser', () => {
    expect(canvasView).not.toMatch(/e\.ctrlKey \|\| e\.metaKey \|\| editor\.playing/);
    expect(canvasView).toContain('ctrlWheelZoom(');
  });
});

describe('the mega-eraser warning can be muted for good', () => {
  it('is a stored setting, on by default', () => {
    expect(DEFAULT_SETTINGS.megaEraserWarning).toBe(true);
    const muted = parseUiConfig(JSON.stringify({ preset: 'toonop', settings: { megaEraserWarning: false } }));
    expect(muted?.settings.megaEraserWarning).toBe(false);
  });

  it('is a dialog with «Больше не показывать», not alert()', () => {
    expect(editorUi).not.toContain('alert(MEGA_ERASER_WARNING)');
    expect(editorUi).toContain("t('editor.dont_show_again')");
    expect(editorUi).toContain("setSetting('megaEraserWarning'");
    expect(ru.editor.dont_show_again).toBe('Больше не показывать');
  });

  it('can be turned back on in the settings', () => {
    expect(settingsSheet).toContain('editor.settings.megaEraserWarning');
  });
});

describe('owner after the tenth audit: the thickness slider', () => {
  it('arrow keys step as +/− do in the preset (nudgeBrushSize)', () => {
    const at = brushPanel.indexOf('{#snippet slider(');
    const block = brushPanel.slice(at, brushPanel.indexOf('{:else}', at));
    expect(block).toMatch(/ArrowUp[^]*?nudgeBrushSize\(value, 1, editor\.ux\)/);
    expect(block).toMatch(/ArrowDown[^]*?nudgeBrushSize\(value, -1, editor\.ux\)/);
  });

  it('speaks the size with its unit in the right Russian plural', () => {
    expect(t('brush.size_value', { count: 9 })).toBe('9 пикселей');
    expect(t('brush.size_value', { count: 1 })).toBe('1 пиксель');
    expect(t('brush.size_value', { count: 2 })).toBe('2 пикселя');
    expect(t('brush.size_value', { count: 21 })).toBe('21 пиксель');
    expect(brushPanel).toContain("aria-valuetext={t('brush.size_value', { count: value })}");
  });
});

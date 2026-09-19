import { describe, expect, it } from 'bun:test';
import { SCALE_MENU_MS, scaleMenuVisible } from './frame-selection';

const menu = await Bun.file(new URL('./ScaleMenu.svelte', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const canvasView = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();

describe('ScaleMenu', () => {
  it('shows the frame as a thumbnail instead of re-rendering it by hand', () => {
    expect(menu).toContain('FrameThumb');
    expect(menu).toContain('editor.displayedFrame');
  });

  it('marks the visible region on the thumbnail', () => {
    expect(menu).toContain('class="viewport"');
    expect(menu).toContain('editor.view.zoom');
    expect(menu).toContain('editor.view.panX');
  });

  it('gives the zoom a slider and a number field over the reference range', () => {
    expect(menu).toContain('type="range"');
    expect(menu).toContain('type="number"');
    expect(menu).toContain('ZOOM_MIN');
    expect(menu).toContain('ZOOM_MAX');
    expect(menu).toContain('ZOOM_STEP');
  });

  it('names its controls and its window for a reader', () => {
    expect(menu).toContain('aria-label="Масштаб"');
    expect(menu).toContain('aria-label');
  });

  it('opens with the hand, the tool it belongs to', () => {
    expect(editorUi).toContain('ScaleMenu');
    expect(editorUi).toContain("editor.tool === 'drag'");
  });
});

describe('when the zoom window is up', () => {
  it('stays up for as long as the hand is held', () => {
    expect(scaleMenuVisible('drag', 0, 1_000)).toBe(true);
  });

  it('shows for two seconds after a wheel zoom, then goes away', () => {
    const until = 1_000 + SCALE_MENU_MS;
    expect(scaleMenuVisible('pencil', until, 1_000)).toBe(true);
    expect(scaleMenuVisible('pencil', until, until - 1)).toBe(true);
    expect(scaleMenuVisible('pencil', until, until)).toBe(false);
  });

  it('is not up at all when nothing asked for it', () => {
    expect(scaleMenuVisible('pencil', 0, 1_000)).toBe(false);
  });
});

describe('the slider steps in whole percent-free units', () => {
  it('moves the zoom one step at a time', () => {
    expect(menu).toContain('step={1}');
  });
});

describe('the wheel raises the window', () => {
  it('the canvas asks the state to flash it', () => {
    expect(canvasView).toContain('editor.flashScaleMenu()');
  });
});

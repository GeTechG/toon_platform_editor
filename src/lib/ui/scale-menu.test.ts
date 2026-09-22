import { describe, expect, it } from 'bun:test';
import { SCALE_MENU_MS, scaleMenuVisible } from './frame-selection';
import { allPlaced, defaultPanels, panelItems } from './panels';
import { t } from '../i18n';

const menu = await Bun.file(new URL('./ScaleMenu.svelte', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();
const canvasView = await Bun.file(new URL('./CanvasView.svelte', import.meta.url)).text();
const draggableSrc = await Bun.file(new URL('./draggable.ts', import.meta.url)).text();

describe('ScaleMenu', () => {
  it('is one compact row: minus, the current scale, plus — nothing else', () => {
    expect(menu).toContain('editor.view.zoom');
    expect(menu).toContain('zoomDelta(editor.view.zoom, -1)');
    expect(menu).toContain('zoomDelta(editor.view.zoom, 1)');
    // No preview, no slider, no typing field.
    expect(menu).not.toContain('FrameThumb');
    expect(menu).not.toContain('type="range"');
    expect(menu).not.toContain('type="number"');
  });

  it('stops the steps at the ends of the zoom range', () => {
    expect(menu).toContain('ZOOM_MIN');
    expect(menu).toContain('ZOOM_MAX');
  });

  it('names its controls and its window for a reader', () => {
    expect(menu).toContain("aria-label={t('scale.group')}");
    expect(t('scale.group')).toBe('Масштаб');
    expect(menu).toContain('aria-label');
  });

  it('sits in the bottom-left corner of the canvas, its fill stepped back', () => {
    expect(editorUi).toContain('class="scale-window"');
    expect(editorUi).toMatch(/\.scale-window \{[^}]*bottom:/);
    // The fill steps back, never the window: `opacity` on the whole thing took
    // the readout to 4.33:1 and the edge to 1.8:1 (WCAG 1.4.3, 1.4.11).
    expect(editorUi).not.toMatch(/\.scale-window[^{]*\{[^}]*opacity:/s);
    expect(menu).toMatch(/background: color-mix\(in srgb, var\(--canvas\) 55%/);
  });

  it('comes back to full when hovered, focused, or the hand is up', () => {
    expect(menu).toContain('class:up={editor.scaleMenuVisible}');
    expect(menu).toMatch(/\.scale-menu\.up,\n\s*\.scale-menu:hover,\n\s*\.scale-menu:focus-within \{\n\s*background: var\(--canvas\)/);
  });

  it('opens with the hand, the tool it belongs to', () => {
    expect(editorUi).toContain('ScaleMenu');
    expect(editorUi).toContain("editor.tool === 'drag'");
  });

  it('is the only zoom control: the panel has no zoom widget left', () => {
    expect(panelItems().map((item) => item.id)).not.toContain('zoom');
    expect(allPlaced(defaultPanels())).not.toContain('zoom');
    expect(editorUi).not.toContain("id === 'zoom'");
  });

  it('makes the scale itself the way back to 100%', () => {
    expect(menu).toMatch(/class="value"[^]*?editor\.resetView\(\)/);
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

describe('the wheel raises the window', () => {
  it('the canvas asks the state to flash it', () => {
    expect(canvasView).toContain('editor.flashScaleMenu()');
  });
});

describe('dragging a floating window', () => {
  it('lifts the windows with a shadow, not a filter', () => {
    // A filtered ancestor becomes the containing block of its fixed child, so
    // the dragged window is re-anchored to it and flies off the screen.
    expect(editorUi).not.toMatch(/\.scale-window \{[^}]*filter:/);
    expect(editorUi).not.toMatch(/\.tool-windows \{[^}]*filter:/);
  });

  it('takes the zoom window anywhere on it, keys included', () => {
    expect(menu).toMatch(/class="scale-menu"[^>]*data-drag-handle/);
    // A press on a key stays a press until it travels: past the threshold it
    // is a drag, and the pointer capture keeps the click from landing.
    expect(draggableSrc).toContain('DRAG_THRESHOLD');
    expect(draggableSrc).toContain('setPointerCapture');
  });
});

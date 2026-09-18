import { describe, expect, it } from 'bun:test';

const menu = await Bun.file(new URL('./ScaleMenu.svelte', import.meta.url)).text();
const editorUi = await Bun.file(new URL('./Editor.svelte', import.meta.url)).text();

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

import { describe, expect, it } from 'bun:test';
import { t } from '../i18n';

const source = await Bun.file(new URL('./LayerRows.svelte', import.meta.url)).text();
const rows = source;
const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();

function fn(name: string): string {
  const match = source.match(new RegExp(`function ${name}\\([^]*?\\n  }`));
  if (!match) throw new Error(`missing ${name}`);
  return match[0];
}

describe('layer drag contract', () => {
  it('counts the rows the list scrolled past under the pointer', () => {
    // With auto-scroll the pointer can stay still while rows move, so travel
    // is pointer delta plus scroll delta — otherwise rows revealed by the
    // auto-scroll are unreachable.
    const update = fn('updateTarget');
    expect(update).toContain('scrollTop');
    expect(update).toContain('dragTargetIndex');
    expect(source).toContain('startScroll');
  });

  it('re-evaluates the target while auto-scrolling, without new pointer events', () => {
    expect(fn('edgeScroll')).toContain('updateTarget');
  });

  it('restarts auto-scroll when the drag crosses to the other edge', () => {
    const edge = fn('edgeScroll');
    expect(edge).toContain('direction');
  });

  it('ignores pointerup and pointercancel from another pointer', () => {
    for (const name of ['endDrag', 'cancelDrag']) {
      expect(fn(name)).toContain('pointerId');
    }
  });

  it('rolls back through a path playback cannot block', async () => {
    // moveLayerTo used to refuse while the player ran, so a drag cancelled
    // after playback started froze the layer at its dragged position.
    const state = await Bun.file(new URL('./editor-state.svelte.ts', import.meta.url)).text();
    const move = state.match(/moveLayerTo\([^]*?\n  }/)?.[0] ?? '';
    expect(move).not.toContain('this.playing');
  });

  it('finishes the drag from the window, not from the handle', () => {
    // Reordering moves the handle's node in the DOM, which drops its pointer
    // capture, so a pointerup delivered elsewhere would never reach the
    // handle's own listener — the drag and its auto-scroll interval would run
    // on forever. The window sees every release.
    const win = source.match(/<svelte:window[^]*?\/>/)?.[0] ?? '';
    expect(win).toContain('onpointermove={onHandleMove}');
    expect(win).toContain('onpointerup={endDrag}');
    expect(win).toContain('onpointercancel={cancelDrag}');
  });

  it('stops the auto-scroll interval when the panel goes away', () => {
    expect(source).toContain('onDestroy');
    expect(source.match(/onDestroy\([^]*?\)/)?.[0] ?? '').toContain('stopAutoscroll');
  });
});

describe('layer names and colour tags (Toonio parity)', () => {
  it('a row shows the stored name, falling back to its position', () => {
    expect(rows).toContain('editor.layerLabel(layerIndex)');
  });

  it('double-clicking a row name opens it for renaming', () => {
    expect(rows).toContain('ondblclick');
    expect(rows).toContain('editor.renameActiveLayer(');
    expect(rows).toContain('MAX_LAYER_NAME');
  });

  it('Enter commits the new name and Escape drops it', () => {
    expect(rows).toContain("'Enter'");
    expect(rows).toContain("'Escape'");
  });

  it('every row carries one of the six colour tags', () => {
    expect(rows).toContain('--layer-tag-{editor.layerColor(layerIndex)}');
  });

  it('the eye, the handle and the delete keep their size in a narrow column', () => {
    // The column narrows down to the icons; squeezing them instead of the
    // name would shrink the tap targets (WCAG 2.5.8).
    const icons = rows.slice(rows.indexOf('.eye {'));
    for (const rule of ['.eye {', '.handle {', '.kill {']) {
      const block = icons.slice(icons.indexOf(rule), icons.indexOf('}', icons.indexOf(rule)));
      expect(block).toContain('flex: none');
    }
  });
});

describe('the colour tag is pickable', () => {
  it('the tag is a button that walks the six swatches', () => {
    expect(rows).toContain('class="tag"');
    expect(rows).toContain('editor.cycleLayerColor(layerIndex)');
    expect(rows).toContain("t('layer.colour_title')");
    expect(t('layer.colour_title')).toStartWith('Цвет слоя');
    expect(rows).toContain('editor.layerColor(layerIndex)');
  });

  it('a fast double click on a control is not a rename', () => {
    // The tag, the eye and the delete sit inside the row, whose double click
    // opens the name for editing; two quick colour steps must not rename.
    expect(rows).toContain('ondblclick={(e) => startRename(e, layerIndex)}');
    expect(fn('startRename')).toContain("closest('button, .handle')");
  });

  it('the colours follow their layers through add, delete and reorder', () => {
    expect(state).toContain('layerColors');
    expect(state).toContain('this.layerColors.splice(at, 0,');
    expect(state).toContain('this.layerColors.splice(removed, 1)');
    expect(state).toContain('this.layerColors.splice(to, 0, ...this.layerColors.splice(from, 1))');
  });

  it('a draft carries them, since the file format has no field for them', () => {
    expect(state).toContain('layerColors: this.layerColors.slice()');
    expect(state).toContain('normalizeLayerColors(saved.layerColors');
  });
});

import { describe, expect, it } from 'bun:test';

const source = await Bun.file(new URL('./LayerRows.svelte', import.meta.url)).text();

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

  it('stops the auto-scroll interval when the panel goes away', () => {
    expect(source).toContain('onDestroy');
    expect(source.match(/onDestroy\([^]*?\)/)?.[0] ?? '').toContain('stopAutoscroll');
  });
});

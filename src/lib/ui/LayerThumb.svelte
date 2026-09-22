<script lang="ts">
  // Thumbnail of one layer's cell — the layer alone, not the composite, so a
  // layers-panel row shows what that layer contributes. Same stroke path as
  // the canvas (renderStrokesLayer), on a transparent little buffer.
  import type { Frame, ToonDocument } from '../format/types';
  import { renderStrokesLayer, type Canvas2DLike } from '../render/canvas2d';
  import { fitThumb } from './thumb-size';
  import { whenOnScreen } from './on-screen';
  import { renderDensity } from './viewport';

  let {
    doc,
    layerIndex,
    frameIndex,
    maxW = 28,
    maxH = maxW,
  }: { doc: ToonDocument; layerIndex: number; frameIndex: number; maxW?: number; maxH?: number } = $props();

  let canvasEl: HTMLCanvasElement;
  // The canvas max-fitted into the frame it is given, proportions kept.
  const box = $derived(fitThumb(doc.width, doc.height, maxW, maxH));

  /**
   * The timeline is frames × layers of these, and the format allows 4096
   * frames — sixty of them already meant sixty live 2D contexts, of which a
   * screen shows about twenty. A canvas costs nothing until `getContext`; after
   * it, it is a backing store the browser keeps, and a few hundred is where one
   * starts evicting and a cheap phone starts swapping. So the context is taken
   * when the cell comes into view, and not before.
   *
   * It is not given back when the cell leaves: freeing a 2D context means
   * resizing the canvas to nothing, and the flicker of redrawing every cell on
   * every scroll costs more than the memory it returns.
   * ponytail: bounded by what was scrolled past, not by what is on screen —
   * release on exit if a very long strip ever proves it matters.
   *
   * One observer serves the whole strip (`on-screen.ts`): a pair per cell was
   * a pair per thousand cells, which is the cost the window was put here to
   * remove.
   */
  let onScreen = $state(false);
  $effect(() => {
    if (!canvasEl) {
      return;
    }
    return whenOnScreen(canvasEl, () => {
      onScreen = true;
    });
  });

  /**
   * The cell this thumbnail currently shows, and how many strokes were on it.
   * A write to the document replaces the whole holder, so every thumbnail on
   * screen hears every stroke; a block edit writes a fresh cell and a new
   * stroke is pushed onto the one that is there, so the pair of them is what
   * says whether this thumbnail has anything new to draw.
   */
  let painted: Frame | undefined;
  let paintedStrokes = -1;
  let paintedBox = '';

  $effect(() => {
    const cell = doc.layers[layerIndex]?.frames[frameIndex];
    if (!canvasEl || !cell || !onScreen) {
      return;
    }
    const shape = `${box.w}x${box.h}`;
    if (cell === painted && cell.strokes.length === paintedStrokes && shape === paintedBox) {
      return;
    }
    painted = cell;
    paintedStrokes = cell.strokes.length;
    paintedBox = shape;
    const dpr = renderDensity(window.devicePixelRatio || 1);
    canvasEl.width = Math.max(1, Math.round(box.w * dpr));
    canvasEl.height = Math.max(1, Math.round(box.h * dpr));
    const ctx = canvasEl.getContext('2d') as unknown as Canvas2DLike & {
      clearRect(x: number, y: number, w: number, h: number): void;
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    renderStrokesLayer(cell, doc.tools, ctx, { scale: box.w / doc.width, dpr });
  });
</script>

<canvas bind:this={canvasEl} style:width="{box.w}px" style:height="{box.h}px"></canvas>

<style>
  canvas {
    display: block;
    background: var(--canvas, #fff);
  }
</style>

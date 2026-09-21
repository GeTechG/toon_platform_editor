<script lang="ts">
  // Thumbnail of one layer's cell — the layer alone, not the composite, so a
  // layers-panel row shows what that layer contributes. Same stroke path as
  // the canvas (renderStrokesLayer), on a transparent little buffer.
  import type { ToonDocument } from '../format/types';
  import { renderStrokesLayer, type Canvas2DLike } from '../render/canvas2d';
  import { fitThumb } from './thumb-size';

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
   */
  let onScreen = $state(false);
  $effect(() => {
    if (!canvasEl) {
      return;
    }
    if (typeof IntersectionObserver === 'undefined') {
      onScreen = true; // no observer (older engine, SSR shim): draw as before
      return;
    }
    // The `.grid` scroller clips the cells, so intersection with the viewport
    // is exactly "inside the visible part of the strip". A screen of margin
    // either side, so a cell is drawn before the scroll reaches it.
    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen ||= entry.isIntersecting;
      },
      { rootMargin: '200px' },
    );
    io.observe(canvasEl);
    return () => io.disconnect();
  });

  $effect(() => {
    const cell = doc.layers[layerIndex]?.frames[frameIndex];
    void cell?.strokes.length;
    if (!canvasEl || !cell || !onScreen) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
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

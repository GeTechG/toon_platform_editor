<script lang="ts">
  import type { ToonDocument } from '../format/types';
  import { Canvas2DFrameRenderer, type Canvas2DLike } from '../render/canvas2d';
  import { fitThumb } from './thumb-size';

  // `maxW`/`maxH` are the frame the thumbnail fits into: the canvas is drawn
  // as large as it fits there, keeping its own proportions.
  let {
    doc,
    frameIndex,
    maxW = 32,
    maxH = maxW,
  }: { doc: ToonDocument; frameIndex: number; maxW?: number; maxH?: number } = $props();

  let canvasEl: HTMLCanvasElement;

  const renderer = new Canvas2DFrameRenderer();
  const box = $derived(fitThumb(doc.width, doc.height, maxW, maxH));

  $effect(() => {
    // Redraw when the cells, the layer order or a layer's visibility change.
    void doc.layers.length;
    for (const layer of doc.layers) {
      void layer.hidden;
      void layer.frames[frameIndex]?.strokes.length;
    }
    if (!canvasEl) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = Math.max(1, Math.round(box.w * dpr));
    canvasEl.height = Math.max(1, Math.round(box.h * dpr));
    const ctx = canvasEl.getContext('2d') as unknown as Canvas2DLike;
    renderer.render(doc, frameIndex, ctx, { scale: box.w / doc.width, dpr });
  });
</script>

<canvas bind:this={canvasEl} style:width="{box.w}px" style:height="{box.h}px"></canvas>

<style>
  canvas {
    display: block;
  }
</style>

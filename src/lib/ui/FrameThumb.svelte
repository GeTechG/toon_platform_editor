<script lang="ts">
  import type { ToonDocument } from '../format/types';
  import { Canvas2DFrameRenderer, type Canvas2DLike } from '../render/canvas2d';

  let {
    doc,
    frameIndex,
    height = 32,
  }: { doc: ToonDocument; frameIndex: number; height?: number } = $props();

  let canvasEl: HTMLCanvasElement;

  const renderer = new Canvas2DFrameRenderer();
  const cssWidth = $derived(Math.round(height * (doc.width / doc.height)));

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
    canvasEl.width = Math.max(1, Math.round(cssWidth * dpr));
    canvasEl.height = Math.max(1, Math.round(height * dpr));
    const ctx = canvasEl.getContext('2d') as unknown as Canvas2DLike;
    renderer.render(doc, frameIndex, ctx, { scale: cssWidth / doc.width, dpr });
  });
</script>

<canvas bind:this={canvasEl} style:width="{cssWidth}px" style:height="{height}px"></canvas>

<style>
  canvas {
    display: block;
  }
</style>

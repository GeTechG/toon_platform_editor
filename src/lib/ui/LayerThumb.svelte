<script lang="ts">
  // Thumbnail of one layer's cell — the layer alone, not the composite, so a
  // layers-panel row shows what that layer contributes. Same stroke path as
  // the canvas (renderStrokesLayer), on a transparent little buffer.
  import type { ToonDocument } from '../format/types';
  import { renderStrokesLayer, type Canvas2DLike } from '../render/canvas2d';

  let {
    doc,
    layerIndex,
    frameIndex,
    height = 28,
  }: { doc: ToonDocument; layerIndex: number; frameIndex: number; height?: number } = $props();

  let canvasEl: HTMLCanvasElement;
  const cssWidth = $derived(Math.round(height * (doc.width / doc.height)));

  $effect(() => {
    const cell = doc.layers[layerIndex]?.frames[frameIndex];
    void cell?.strokes.length;
    if (!canvasEl || !cell) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = Math.max(1, Math.round(cssWidth * dpr));
    canvasEl.height = Math.max(1, Math.round(height * dpr));
    const ctx = canvasEl.getContext('2d') as unknown as Canvas2DLike & {
      clearRect(x: number, y: number, w: number, h: number): void;
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    renderStrokesLayer(cell, doc.tools, ctx, { scale: cssWidth / doc.width, dpr });
  });
</script>

<canvas bind:this={canvasEl} style:width="{cssWidth}px" style:height="{height}px"></canvas>

<style>
  canvas {
    display: block;
    background: var(--canvas, #fff);
  }
</style>

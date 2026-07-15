<script lang="ts">
  import type { Frame } from '../format/types';
  import { Canvas2DFrameRenderer, type Canvas2DLike } from '../render/canvas2d';

  let {
    frame,
    docWidth,
    docHeight,
    height = 32,
  }: { frame: Frame; docWidth: number; docHeight: number; height?: number } = $props();

  let canvasEl: HTMLCanvasElement;

  const renderer = new Canvas2DFrameRenderer();
  const cssWidth = $derived(Math.round(height * (docWidth / docHeight)));

  $effect(() => {
    // Redraw when strokes are added/removed or the thumb size changes.
    void frame.strokes.length;
    if (!canvasEl) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = Math.max(1, Math.round(cssWidth * dpr));
    canvasEl.height = Math.max(1, Math.round(height * dpr));
    const ctx = canvasEl.getContext('2d') as unknown as Canvas2DLike;
    // Opaque render (background + strokes): eraser strokes must not punch
    // through the thumb's background, so no transparent-layer path here.
    renderer.render(frame, ctx, { scale: cssWidth / docWidth, dpr });
  });
</script>

<canvas bind:this={canvasEl} style:width="{cssWidth}px" style:height="{height}px"></canvas>

<style>
  canvas {
    display: block;
  }
</style>

<script lang="ts">
  import type { ToonDocument } from '../format/types';
  import { Canvas2DFrameRenderer, type Canvas2DLike } from '../render/canvas2d';
  import { fitThumb } from './thumb-size';
  import { renderDensity } from './viewport';

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

  /** The cells this thumbnail was last drawn from — see `LayerThumb`. */
  let painted = '';

  $effect(() => {
    // Redraw when the cells, their strokes, the layer order or a layer's
    // visibility change — and not merely because the document was written to.
    const cells = doc.layers
      .map((layer) => (layer.hidden ? 'x' : (layer.frames[frameIndex]?.strokes.length ?? 'x')))
      .join('|') + `:${box.w}x${box.h}`;
    if (!canvasEl || cells === painted) {
      return;
    }
    painted = cells;
    const dpr = renderDensity(window.devicePixelRatio || 1);
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

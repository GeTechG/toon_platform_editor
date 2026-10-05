<script lang="ts">
  import type { ToonDocument } from '../format/types';
  import { Canvas2DFrameRenderer, type Canvas2DLike } from '../render/canvas2d';
  import { cellStamp, fitThumb } from './thumb-size';
  import { whenOnScreen } from './on-screen';
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

  // The context is taken when the thumbnail comes into view, as a cell's is
  // (LayerThumb): a long list of drafts is mostly below the fold.
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
   * What this thumbnail was last drawn from: the stamp of every visible cell
   * of the frame, in layer order (`cellStamp`). The document's identity
   * redrew every thumbnail whenever a new one was handed over, changed or
   * not; the counts alone missed a lasso move or a
   * distort, which keep every one of them.
   */
  let painted = '';

  $effect(() => {
    if (!canvasEl || !onScreen) {
      return;
    }
    let stamp = 0;
    for (const layer of doc.layers) {
      const cell = layer.frames[frameIndex];
      stamp = (Math.imul(stamp, 31) + (layer.hidden || !cell ? -1 : cellStamp(cell))) | 0;
    }
    const cells = `${stamp}:${box.w}x${box.h}`;
    if (cells === painted) {
      return;
    }
    const dpr = renderDensity(window.devicePixelRatio || 1);
    canvasEl.width = Math.max(1, Math.round(box.w * dpr));
    canvasEl.height = Math.max(1, Math.round(box.h * dpr));
    const ctx = canvasEl.getContext('2d') as unknown as Canvas2DLike | null;
    // Safari hands out null once the page's canvas memory is spent: a blank
    // thumbnail, not an effect that throws.
    if (!ctx) {
      return;
    }
    painted = cells;
    renderer.render(doc, frameIndex, ctx, { scale: box.w / doc.width, dpr });
  });
</script>

<canvas bind:this={canvasEl} style:width="{box.w}px" style:height="{box.h}px"></canvas>

<style>
  canvas {
    display: block;
  }
</style>

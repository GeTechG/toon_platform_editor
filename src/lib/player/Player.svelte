<script lang="ts">
  // Read-only looping player: renders a document's frames on a canvas and loops
  // at the document's frame rate. Reuses the same frame renderer as the editor
  // (single rendering contract) and the drift-free LoopPlayer. No tools, no
  // onion skin, no draft — a pure viewer for the public share page.
  import { onMount } from 'svelte';
  import { CANVAS_LOGICAL_WIDTH } from '../format/constants';
  import type { ToonDocument } from '../format/types';
  import { Canvas2DFrameRenderer, type Canvas2DLike } from '../render/canvas2d';
  import { LoopPlayer } from './player';

  let { doc }: { doc: ToonDocument } = $props();

  const renderer = new Canvas2DFrameRenderer();
  let canvasEl: HTMLCanvasElement;
  let wrapWidth = $state(CANVAS_LOGICAL_WIDTH);
  let wrapHeight = $state(0);
  let current = $state(0);

  // Fit the document aspect inside the wrap: capped by width and, when known,
  // by height (same letterboxing as the editor canvas).
  const cssWidth = $derived(
    Math.max(
      1,
      Math.min(
        wrapWidth || CANVAS_LOGICAL_WIDTH,
        wrapHeight > 0 ? wrapHeight * (doc.width / doc.height) : Infinity,
      ),
    ),
  );
  const cssHeight = $derived(cssWidth * (doc.height / doc.width));

  function draw(): void {
    if (!canvasEl) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    const pxWidth = Math.max(1, Math.round(cssWidth * dpr));
    const pxHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (canvasEl.width !== pxWidth) {
      canvasEl.width = pxWidth;
    }
    if (canvasEl.height !== pxHeight) {
      canvasEl.height = pxHeight;
    }
    const frame = doc.frames[current];
    if (!frame) {
      return;
    }
    const ctx = canvasEl.getContext('2d') as unknown as Canvas2DLike;
    renderer.render(frame, doc.tools, ctx, { scale: cssWidth / doc.width, dpr });
  }

  onMount(() => {
    const player = new LoopPlayer({
      frameCount: doc.frames.length,
      fps: doc.frame_rate,
      startFrame: 0,
      onFrame: (index) => {
        current = index;
      },
    });
    let raf = requestAnimationFrame(function tick(now: number) {
      player.tick(now);
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  });

  // Redraw on frame change or resize (client-only; effects do not run in SSR).
  $effect(() => {
    void current;
    void cssWidth;
    void doc;
    draw();
  });
</script>

<div class="wrap" bind:clientWidth={wrapWidth} bind:clientHeight={wrapHeight}>
  <canvas bind:this={canvasEl} style:width="{cssWidth}px" style:height="{cssHeight}px"></canvas>
</div>

<style>
  .wrap {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  canvas {
    display: block;
    background: #fff;
    max-width: 100%;
    max-height: 100%;
  }
</style>

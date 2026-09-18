<script lang="ts">
  // Read-only looping player: renders a document's frames on a canvas and loops
  // at the document's frame rate. Reuses the same frame renderer as the editor
  // (single rendering contract) and the drift-free LoopPlayer. No tools, no
  // onion skin, no draft — a pure viewer for the public share page.
  import { untrack } from 'svelte';
  import { CANVAS_LOGICAL_WIDTH } from '../format/constants';
  import type { ToonDocument } from '../format/types';
  import { Canvas2DFrameRenderer, type Canvas2DLike } from '../render/canvas2d';
  import { frameCount } from '../model/operations';
  import { LoopPlayer } from './player';

  /**
   * Reduced motion means no autoplay: the visitor lands on the first frame
   * and presses play. That is the alternative DESIGN requires for a looping
   * animation, so it has to be decided before the clock ever starts.
   */
  function prefersReducedMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  let {
    doc,
    /** Renders the play/pause key over the canvas. */
    controls = true,
    playing = $bindable(!prefersReducedMotion()),
  }: { doc: ToonDocument; controls?: boolean; playing?: boolean } = $props();

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
    if (current >= frameCount(doc)) {
      return;
    }
    const ctx = canvasEl.getContext('2d') as unknown as Canvas2DLike;
    renderer.render(doc, current, ctx, { scale: cssWidth / doc.width, dpr });
  }

  // The frame clock runs only while playing. Pausing tears the loop down;
  // pressing play builds a new one starting at the frame on the canvas, so
  // nothing jumps. `current` is read untracked — the loop writes it.
  $effect(() => {
    if (!playing) {
      return;
    }
    const player = new LoopPlayer({
      frameCount: frameCount(doc),
      fps: doc.frame_rate,
      startFrame: Math.min(untrack(() => current), frameCount(doc) - 1),
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
  <!-- ARIA in HTML allows any role on <canvas>; without one the animation is
       an anonymous box in the accessibility tree. -->
  <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
  <canvas
    bind:this={canvasEl}
    style:width="{cssWidth}px"
    style:height="{cssHeight}px"
    role="img"
    aria-label="Мультик, кадр {current + 1} из {frameCount(doc)}"
  ></canvas>
  {#if controls}
    <button
      class="btn"
      type="button"
      onclick={() => (playing = !playing)}
      title={playing ? 'Пауза' : 'Проиграть'}
      aria-label={playing ? 'Пауза' : 'Проиграть'}
    >
      <!-- Two paths inline instead of the editor's Icon component: this entry
           point exists to keep the viewer's module graph small. -->
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d={playing ? 'M9 6v12M15 6v12' : 'M8 5.5v13l11-6.5-11-6.5Z'} />
      </svg>
      <span>{playing ? 'Пауза' : 'Проиграть'}</span>
    </button>
  {/if}
</div>

<style>
  .wrap {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  /* The product's physical key (DESIGN §4): a hard offset shadow that the
     press takes away. Electric, never signal red — red belongs to «рисовать».
     Tokens fall back so the player works outside the editor's root. */
  .btn {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    min-width: 44px;
    min-height: 44px;
    padding: 0 0.9rem;
    border: none;
    border-radius: var(--r-sm, 7px);
    background: var(--electric, #1b5cff);
    color: var(--canvas, #ffffff);
    font: inherit;
    font-weight: 650;
    cursor: pointer;
    box-shadow: 0 4px 0 var(--electric-dark, #134bd6);
    transition:
      transform 0.13s cubic-bezier(0.2, 0.8, 0.2, 1),
      box-shadow 0.13s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .btn:hover {
    transform: translateX(-50%) translateY(2px);
    box-shadow: 0 2px 0 var(--electric-dark, #134bd6);
  }
  .btn:active {
    transform: translateX(-50%) translateY(4px);
    box-shadow: 0 0 0 var(--electric-dark, #134bd6);
  }
  .btn:focus-visible {
    outline: 3px solid var(--electric, #1b5cff);
    outline-offset: 3px;
  }
  /* The key keeps its depth and its pressed state; only the travel goes. */
  @media (prefers-reduced-motion: reduce) {
    .btn {
      transition: none;
    }
    .btn:hover,
    .btn:active {
      transform: translateX(-50%);
    }
  }
  canvas {
    display: block;
    background: #fff;
    max-width: 100%;
    max-height: 100%;
  }
</style>

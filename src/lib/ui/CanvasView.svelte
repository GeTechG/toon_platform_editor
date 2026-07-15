<script lang="ts">
  import type { EditorState } from './editor-state.svelte';
  import { CANVAS_LOGICAL_WIDTH } from '../format/constants';
  import type { Frame } from '../format/types';
  import { addStroke } from '../model/operations';
  import {
    Canvas2DFrameRenderer,
    blitLayer,
    renderRawPolyline,
    type BlitTarget,
    type Canvas2DLike,
  } from '../render/canvas2d';
  import { StrokeBuilder, brushWidthDoc } from '../tools/stroke-builder';

  let { editor }: { editor: EditorState } = $props();

  const renderer = new Canvas2DFrameRenderer();
  let canvasEl: HTMLCanvasElement;
  let wrapWidth = $state(CANVAS_LOGICAL_WIDTH);
  let builder: StrokeBuilder | null = null;
  let rafPending = false;
  // Committed-frame layer cache: live-stroke redraws blit this instead of
  // replaying every committed stroke (input latency on low-end devices).
  let committedEl: HTMLCanvasElement | null = null;
  let cachedFrame: Frame | null = null;
  let cachedStrokeCount = -1;

  const cssWidth = $derived(Math.max(1, Math.min(wrapWidth || CANVAS_LOGICAL_WIDTH, CANVAS_LOGICAL_WIDTH)));
  const cssHeight = $derived(cssWidth * (editor.doc.height / editor.doc.width));

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
    const ctx = canvasEl.getContext('2d') as unknown as Canvas2DLike & BlitTarget;
    const viewport = { scale: cssWidth / editor.doc.width, dpr };
    const frame = editor.doc.frames[editor.displayedFrame];
    if (!frame) {
      return;
    }
    committedEl ??= document.createElement('canvas');
    if (
      cachedFrame !== frame ||
      cachedStrokeCount !== frame.strokes.length ||
      committedEl.width !== pxWidth ||
      committedEl.height !== pxHeight
    ) {
      committedEl.width = pxWidth;
      committedEl.height = pxHeight;
      renderer.render(frame, committedEl.getContext('2d') as unknown as Canvas2DLike, viewport);
      cachedFrame = frame;
      cachedStrokeCount = frame.strokes.length;
    }
    blitLayer(committedEl, ctx);
    if (builder) {
      renderRawPolyline(builder.rawPoints, builder.brush.width, builder.brush.color, ctx, viewport);
    }
  }

  function scheduleDraw(): void {
    if (rafPending) {
      return;
    }
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      draw();
    });
  }

  $effect(() => {
    // Redraw dependencies: size, displayed frame and its strokes.
    void cssWidth;
    void editor.displayedFrame;
    void editor.doc.frames[editor.displayedFrame]?.strokes.length;
    scheduleDraw();
  });

  function toDocUnits(e: { clientX: number; clientY: number }): [number, number] {
    const rect = canvasEl.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * editor.doc.width;
    const y = ((e.clientY - rect.top) / rect.height) * editor.doc.height;
    return [x, y];
  }

  function onPointerDown(e: PointerEvent): void {
    if (editor.playing || !e.isPrimary || builder) {
      return;
    }
    canvasEl.setPointerCapture(e.pointerId);
    builder = new StrokeBuilder({
      width: brushWidthDoc(editor.brushSizeLogical),
      color: editor.brushColor,
    });
    const [x, y] = toDocUnits(e);
    builder.addPoint(x, y);
    scheduleDraw();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!builder || !e.isPrimary) {
      return;
    }
    const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const event of coalesced.length > 0 ? coalesced : [e]) {
      const [x, y] = toDocUnits(event);
      builder.addPoint(x, y);
    }
    scheduleDraw();
  }

  function onPointerUp(e: PointerEvent): void {
    if (!builder || !e.isPrimary) {
      return;
    }
    const stroke = builder.commit(editor.doc.width, editor.doc.height);
    builder = null;
    try {
      addStroke(editor.doc, editor.activeFrame, stroke);
    } catch (err) {
      // Document is at a format limit — drop the stroke instead of crashing the input handler.
      console.warn('stroke rejected:', err);
    }
    scheduleDraw();
  }

  function onPointerCancel(e: PointerEvent): void {
    if (!builder || !e.isPrimary) {
      return;
    }
    builder = null;
    scheduleDraw();
  }
</script>

<div class="wrap" bind:clientWidth={wrapWidth}>
  <canvas
    bind:this={canvasEl}
    style:width="{cssWidth}px"
    style:height="{cssHeight}px"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerCancel}
  ></canvas>
</div>

<style>
  .wrap {
    width: 100%;
  }
  canvas {
    display: block;
    background: #fff;
    border: 1px solid #ccc;
    border-radius: 4px;
    /* Page scroll/zoom must not hijack drawing. */
    touch-action: none;
    cursor: crosshair;
  }
</style>

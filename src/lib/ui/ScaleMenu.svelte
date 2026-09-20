<script lang="ts">
  /**
   * The reference zoom window that comes with the hand tool: a thumbnail of
   * the frame with the visible region marked on it, plus a slider and a field
   * over the same 1–10 range the wheel steps through.
   *
   * The thumbnail is the timeline's own `FrameThumb` — one renderer, one look.
   */
  import type { EditorState } from './editor-state.svelte';
  import FrameThumb from './FrameThumb.svelte';
  import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from './viewport';
  import { draggable } from './draggable';

  let { editor }: { editor: EditorState } = $props();

  const THUMB_SIZE = 64;

  function setZoom(raw: string | number): void {
    const value = Number(raw);
    if (Number.isFinite(value)) {
      editor.zoomBy(value - editor.view.zoom);
    }
  }

  // The visible slice of the document, as percentages of the thumbnail: the
  // pan is in CSS pixels of the zoomed canvas, so it divides by that size.
  const viewport = $derived({
    left: (-editor.view.panX / (editor.viewSize.width * editor.view.zoom)) * 100,
    top: (-editor.view.panY / (editor.viewSize.height * editor.view.zoom)) * 100,
    size: 100 / editor.view.zoom,
  });
</script>

<div class="scale-menu" role="group" aria-label="Масштаб" use:draggable>
  <p class="title" data-drag-handle>Масштаб</p>
  <div class="thumb">
    <FrameThumb doc={editor.doc} frameIndex={editor.displayedFrame} maxW={THUMB_SIZE} />
    <span
      class="viewport"
      style:left="{viewport.left}%"
      style:top="{viewport.top}%"
      style:width="{viewport.size}%"
      style:height="{viewport.size}%"
      aria-hidden="true"
    ></span>
  </div>
  <input
    type="range"
    min={ZOOM_MIN}
    max={ZOOM_MAX}
    step={1}
    value={editor.view.zoom}
    oninput={(e) => setZoom(e.currentTarget.value)}
    aria-label="Масштаб холста"
  />
  <label class="value">
    <input
      type="number"
      min={ZOOM_MIN * 100}
      max={ZOOM_MAX * 100}
      step={ZOOM_STEP * 100}
      value={Math.round(editor.view.zoom * 100)}
      oninput={(e) => setZoom(Number(e.currentTarget.value) / 100)}
      aria-label="Масштаб в процентах"
    />%
  </label>
</div>

<style>
  .scale-menu {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.5rem;
    border: 1px solid var(--hairline, #0b0c1024);
    border-radius: 10px;
    background: var(--canvas, #fff);
    font-size: 13px;
  }
  .title {
    margin: 0;
    cursor: move;
    font-weight: 600;
    touch-action: none;
    user-select: none;
  }
  .thumb {
    position: relative;
    align-self: center;
    line-height: 0;
    border: 1px solid var(--hairline, #0b0c1024);
  }
  .viewport {
    position: absolute;
    border: 1px solid var(--electric, #2f6fed);
    background: color-mix(in srgb, var(--electric, #2f6fed) 10%, transparent);
    pointer-events: none;
  }
  .value {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .value input {
    width: 100%;
    min-height: 32px;
    padding: 0 6px;
    border: 1px solid var(--hairline, #0b0c1024);
    border-radius: 6px;
    background: var(--canvas, #fff);
    color: inherit;
    font: inherit;
  }
</style>

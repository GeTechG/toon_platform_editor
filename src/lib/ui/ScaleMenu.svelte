<script lang="ts">
  /**
   * The reference zoom window that comes with the hand tool, kept to one row:
   * a step out, the scale it is at, a step in. The scale is also the way back
   * — pressing it puts the sheet at 100%, centred.
   */
  import type { EditorState } from './editor-state.svelte';
  import { ZOOM_MAX, ZOOM_MIN, zoomDelta } from './viewport';
  import { draggable } from './draggable';
  import Icon from './Icon.svelte';

  let { editor }: { editor: EditorState } = $props();

  const percent = $derived(Math.round(editor.view.zoom * 100));
</script>

<div class="scale-menu" role="group" aria-label="Масштаб" data-drag-handle use:draggable>
  <button
    class="step"
    disabled={editor.view.zoom <= ZOOM_MIN}
    onclick={() => editor.zoomBy(zoomDelta(editor.view.zoom, -1))}
    title="Отдалить"
    aria-label="Отдалить"
  ><Icon name="minus" size={16} /></button>
  <button
    class="value"
    onclick={() => editor.resetView()}
    title="Вернуть 100%"
    aria-label="Масштаб {percent}%. Вернуть 100%"
  >{percent}%</button>
  <button
    class="step"
    disabled={editor.view.zoom >= ZOOM_MAX}
    onclick={() => editor.zoomBy(zoomDelta(editor.view.zoom, 1))}
    title="Приблизить"
    aria-label="Приблизить"
  ><Icon name="plus" size={16} /></button>
</div>

<style>
  .scale-menu {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--hairline, #0b0c1024);
    border-radius: 10px;
    background: var(--canvas, #fff);
    font-size: 12px;
    /* The row is its own handle; only its keys are not. */
    cursor: move;
    touch-action: none;
  }
  button {
    min-height: 28px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .step {
    flex: none;
    display: grid;
    place-items: center;
    width: 28px;
  }
  .value {
    flex: 1;
    min-width: 3.4rem;
    font-variant-numeric: tabular-nums;
  }
  button:hover:not(:disabled) {
    background: var(--hairline-soft, #0b0c1012);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>

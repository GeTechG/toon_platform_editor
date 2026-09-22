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
  import { t } from '../i18n';

  let { editor }: { editor: EditorState } = $props();

  const percent = $derived(Math.round(editor.view.zoom * 100));
</script>

<div
  class="scale-menu"
  class:up={editor.scaleMenuVisible}
  role="group"
  aria-label={t('scale.group')}
  data-drag-handle
  use:draggable
>
  <button
    class="step"
    disabled={editor.view.zoom <= ZOOM_MIN}
    onclick={() => editor.zoomBy(zoomDelta(editor.view.zoom, -1))}
    title={t('scale.out')}
    aria-label={t('scale.out')}
  ><Icon name="minus" size={16} /></button>
  <button
    class="value"
    onclick={() => editor.resetView()}
    title={t('scale.reset')}
    aria-label={t('scale.value', { percent })}
  >{percent}%</button>
  <button
    class="step"
    disabled={editor.view.zoom >= ZOOM_MAX}
    onclick={() => editor.zoomBy(zoomDelta(editor.view.zoom, 1))}
    title={t('scale.in')}
    aria-label={t('scale.in')}
  ><Icon name="plus" size={16} /></button>
</div>

<style>
  .scale-menu {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    /* The window is dragged by its own row, so this is the boundary of a
       control and takes the edge, not the divider. */
    border: 1px solid var(--edge, #0b0c107a);
    border-radius: 10px;
    /* Quiet over someone's drawing is the fill stepping back — never the
       window, which would take the readout and the edge down with it. */
    background: color-mix(in srgb, var(--canvas, #fff) 55%, transparent);
    transition: background 120ms ease;
    font-size: 12px;
    /* The row is its own handle; only its keys are not. */
    cursor: move;
    touch-action: none;
  }
  .scale-menu.up,
  .scale-menu:hover,
  .scale-menu:focus-within {
    background: var(--canvas, #fff);
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

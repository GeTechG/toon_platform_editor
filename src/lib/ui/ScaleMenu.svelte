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
    border: none;
    border-radius: var(--r-md);
    /* Quiet over someone's drawing is the fill stepping back — never the
       window, which would take the readout and the edge down with it. Paper,
       not white: with no shadow and no ring, white on the white sheet had no
       edge at all. */
    background: color-mix(in srgb, var(--paper) 80%, transparent);
    transition: background 120ms ease;
    font-size: 12px;
    /* The row is its own handle; only its keys are not. */
    cursor: move;
    touch-action: none;
  }
  .scale-menu.up,
  .scale-menu:hover,
  .scale-menu:focus-within {
    background: var(--paper);
  }
  button {
    /* The floor, not a number that fits the window. DESIGN §5 keeps 44 for
       everything outside the montage grid, and this window floats over the
       canvas — it crowds out no frame and buys nothing by being smaller. */
    min-height: var(--key-h, 2.75rem);
    border: none;
    /* Concentric with the window: its radius less the 2px it is inset by,
       so the hover fill follows the edge instead of cutting a smaller corner. */
    border-radius: calc(var(--r-md) - 2px);
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .step {
    flex: none;
    display: grid;
    place-items: center;
    width: var(--key-h, 2.75rem);
  }
  .value {
    flex: 1;
    min-width: 3.4rem;
    font-variant-numeric: tabular-nums;
  }
  button:hover:not(:disabled) {
    background: var(--hairline-soft);
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>

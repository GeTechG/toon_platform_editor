<script lang="ts">
  // Floating layers panel for the current frame. Layers are stored bottom-up,
  // the panel shows them top-down (topmost row first) — the order you see on
  // the canvas. There are no layer names in the format: a row is numbered by
  // its position, so moving a layer renumbers the rows.
  import { onDestroy } from 'svelte';
  import { MAX_LAYERS } from '../format/constants';
  import type { EditorState } from './editor-state.svelte';
  import { dragTargetIndex } from './frame-selection';
  import LayerThumb from './LayerThumb.svelte';
  import Icon from './Icon.svelte';

  let { editor, onClose }: { editor: EditorState; onClose: () => void } = $props();

  /** Row height in px — fixed, so a drag converts travel into whole rows. */
  const ROW_HEIGHT = 44;
  /** Distance from a list edge, in px, where the list auto-scrolls during a drag. */
  const AUTOSCROLL_EDGE = 32;

  let listEl: HTMLDivElement;
  /** Position announcement for assistive technologies after a keyboard move. */
  let announcement = $state('');

  // Rows top-down: row 0 is the topmost layer. Layer index = count - 1 - row.
  const rows = $derived(
    editor.doc.layers.map((_, index) => editor.doc.layers.length - 1 - index),
  );
  const canAdd = $derived(editor.doc.layers.length < MAX_LAYERS);
  const canRemove = $derived(editor.doc.layers.length > 1);
  const canMoveUp = $derived(editor.activeLayer < editor.doc.layers.length - 1);
  const canMoveDown = $derived(editor.activeLayer > 0);

  /** Row number shown to the user: 1 for the topmost layer. */
  function rowNumber(layerIndex: number): number {
    return editor.doc.layers.length - layerIndex;
  }

  function announce(layerIndex: number): void {
    announcement = `Слой: позиция ${rowNumber(layerIndex)} из ${editor.doc.layers.length}`;
  }

  function moveBy(layerIndex: number, delta: 1 | -1): void {
    const to = layerIndex + delta;
    if (to < 0 || to >= editor.doc.layers.length) {
      return;
    }
    editor.moveLayerTo(layerIndex, to);
    announce(to);
  }

  function removeLayer(): void {
    if (!canRemove) {
      return;
    }
    // Deleting a layer is not undoable, so a layer with strokes asks first.
    if (editor.layerHasStrokes(editor.activeLayer) && !confirm('Удалить слой со штрихами?')) {
      return;
    }
    editor.removeActiveLayer();
  }

  function onRowKeydown(e: KeyboardEvent, layerIndex: number): void {
    // Alt+↑/↓ reorders without dragging (WCAG 2.2 AA 2.5.7); focus stays put.
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      editor.selectLayer(layerIndex);
      moveBy(layerIndex, e.key === 'ArrowUp' ? 1 : -1);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      editor.selectLayer(layerIndex);
    }
  }

  // --- Drag by the handle ---------------------------------------------------
  // Native HTML5 drag-and-drop does not work on touch, so this is Pointer
  // Events. Only the handle starts a drag (`touch-action: none` on it alone),
  // so a gesture anywhere else in the list still scrolls it.
  type Drag = {
    pointerId: number;
    startY: number;
    /** Scroll offset when the drag began: auto-scroll moves rows under a still pointer. */
    startScroll: number;
    startRow: number;
    /** Last pointer position, so auto-scroll can re-evaluate without a new event. */
    lastY: number;
    currentLayer: number;
    fromLayer: number;
  };
  let drag = $state<Drag | null>(null);
  let autoscroll = 0;
  let autoscrollDirection: -1 | 0 | 1 = 0;

  function onHandleDown(e: PointerEvent, layerIndex: number): void {
    if (!e.isPrimary || drag) {
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    editor.selectLayer(layerIndex); // grabbing a layer selects it
    const row = editor.doc.layers.length - 1 - layerIndex;
    drag = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startScroll: listEl?.scrollTop ?? 0,
      startRow: row,
      lastY: e.clientY,
      currentLayer: layerIndex,
      fromLayer: layerIndex,
    };
  }

  function onHandleMove(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) {
      return;
    }
    drag.lastY = e.clientY;
    edgeScroll(e.clientY);
    updateTarget();
  }

  /**
   * Target row from the travel since the drag began — pointer movement *plus*
   * however far the list auto-scrolled, since scrolled rows move under a
   * pointer that is standing still at the edge.
   */
  function updateTarget(): void {
    if (!drag) {
      return;
    }
    const scrolled = (listEl?.scrollTop ?? 0) - drag.startScroll;
    const count = editor.doc.layers.length;
    const targetRow = dragTargetIndex(drag.startRow, drag.lastY - drag.startY + scrolled, ROW_HEIGHT, count);
    const targetLayer = count - 1 - targetRow;
    if (targetLayer !== drag.currentLayer) {
      // Reorder for real on each index change: the canvas rebuilds once per
      // step, not once per pointermove.
      editor.moveLayerTo(drag.currentLayer, targetLayer);
      drag.currentLayer = targetLayer;
    }
  }

  function edgeScroll(clientY: number): void {
    if (!listEl) {
      return;
    }
    const box = listEl.getBoundingClientRect();
    const direction: -1 | 0 | 1 =
      clientY - box.top < AUTOSCROLL_EDGE ? -1 : box.bottom - clientY < AUTOSCROLL_EDGE ? 1 : 0;
    if (direction === autoscrollDirection) {
      return;
    }
    // Direction changed (including to "none"): the running timer scrolls the
    // wrong way, so it is always replaced rather than left in place.
    stopAutoscroll();
    if (direction === 0) {
      return;
    }
    autoscrollDirection = direction;
    autoscroll = setInterval(() => {
      listEl.scrollBy({ top: (direction * ROW_HEIGHT) / 2 });
      // The pointer may not move again, so the target is re-evaluated here.
      updateTarget();
    }, 80) as unknown as number;
  }

  function stopAutoscroll(): void {
    clearInterval(autoscroll);
    autoscroll = 0;
    autoscrollDirection = 0;
  }

  function endDrag(e: PointerEvent): void {
    if (!drag || e.pointerId !== drag.pointerId) {
      return; // another finger's pointerup must not finish this drag
    }
    stopAutoscroll();
    announce(drag.currentLayer);
    drag = null;
  }

  /** `e` is absent for the Escape path, which cancels whatever drag is running. */
  function cancelDrag(e?: PointerEvent): void {
    if (!drag || (e && e.pointerId !== drag.pointerId)) {
      return;
    }
    stopAutoscroll();
    // Back to where the gesture started — the document is restored, not patched.
    editor.moveLayerTo(drag.currentLayer, drag.fromLayer);
    drag = null;
  }

  function onPanelKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && drag) {
      e.preventDefault();
      cancelDrag();
    }
  }

  // A drag interrupted by the panel closing would leave its timer running
  // against a detached list.
  onDestroy(stopAutoscroll);
</script>

<svelte:window onkeydown={onPanelKeydown} />

<div class="plate" role="dialog" aria-label="Слои">
  <header>
    <h2>Слои</h2>
    <button class="key icon" onclick={onClose} aria-label="Закрыть слои">
      <Icon name="x" />
    </button>
  </header>

  <div class="list" bind:this={listEl} role="listbox" aria-label="Слои" tabindex="-1">
    {#each rows as layerIndex (editor.doc.layers[layerIndex])}
      <div
        class="row"
        class:active={layerIndex === editor.activeLayer}
        class:dragging={drag?.currentLayer === layerIndex}
        role="option"
        aria-selected={layerIndex === editor.activeLayer}
        tabindex="0"
        onclick={() => editor.selectLayer(layerIndex)}
        onkeydown={(e) => onRowKeydown(e, layerIndex)}
      >
        <button
          class="eye"
          aria-pressed={!editor.doc.layers[layerIndex].hidden}
          aria-label={editor.doc.layers[layerIndex].hidden ? 'Показать слой' : 'Скрыть слой'}
          title={editor.doc.layers[layerIndex].hidden ? 'Показать слой' : 'Скрыть слой'}
          onclick={(e) => {
            e.stopPropagation();
            editor.toggleLayerHidden(layerIndex);
          }}
        >
          <Icon name={editor.doc.layers[layerIndex].hidden ? 'x' : 'layers'} size={16} />
        </button>

        <span class="thumb" class:hidden={editor.doc.layers[layerIndex].hidden}>
          <LayerThumb doc={editor.doc} {layerIndex} frameIndex={editor.displayedFrame} height={28} />
        </span>

        <span class="name">Слой {rowNumber(layerIndex)}</span>

        <span
          class="handle"
          role="presentation"
          title="Перетащить слой"
          onpointerdown={(e) => onHandleDown(e, layerIndex)}
          onpointermove={onHandleMove}
          onpointerup={endDrag}
          onpointercancel={cancelDrag}
        >≡</span>
      </div>
    {/each}
  </div>

  <footer>
    <button class="key icon" disabled={!canAdd} onclick={() => editor.addLayerAboveActive()} title="Добавить слой" aria-label="Добавить слой">
      <Icon name="plus" />
    </button>
    <button class="key icon" disabled={!canRemove} onclick={removeLayer} title="Удалить слой" aria-label="Удалить слой">
      <Icon name="x" />
    </button>
    <span class="sep"></span>
    <button class="key icon" disabled={!canMoveUp} onclick={() => moveBy(editor.activeLayer, 1)} title="Выше" aria-label="Переместить слой выше">↑</button>
    <button class="key icon" disabled={!canMoveDown} onclick={() => moveBy(editor.activeLayer, -1)} title="Ниже" aria-label="Переместить слой ниже">↓</button>
  </footer>

  <p class="sr-only" role="status" aria-live="polite">{announcement}</p>
</div>

<style>
  .plate {
    position: absolute;
    left: 0;
    bottom: calc(100% + 0.4rem);
    z-index: 6;
    display: flex;
    flex-direction: column;
    width: min(16rem, calc(100vw - 2rem));
    background: var(--canvas);
    border: 1px solid var(--hairline);
    border-radius: var(--r-md);
    box-shadow: 0 12px 28px -12px rgba(15, 23, 60, 0.35);
  }
  /* Mobile: a bottom drawer instead of a floating plate. */
  @media (max-width: 40rem) {
    .plate {
      position: fixed;
      inset: auto 0 0 0;
      width: auto;
      border-radius: var(--r-md) var(--r-md) 0 0;
      max-height: 60dvh;
    }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 0.4rem 0.4rem 0.75rem;
    border-bottom: 1px solid var(--hairline);
  }
  header h2 {
    margin: 0;
    font-size: 0.95rem;
  }
  .list {
    overflow-y: auto;
    max-height: 17rem;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    box-sizing: border-box;
    height: 44px;
    padding: 0 0.3rem 0 0.5rem;
    cursor: pointer;
  }
  .row.active {
    background: color-mix(in srgb, var(--electric, #2f5bff) 12%, transparent);
  }
  .row.dragging {
    opacity: 0.7;
  }
  .row:focus-visible {
    outline: 2px solid var(--electric, #2f5bff);
    outline-offset: -2px;
  }
  .eye {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--r-sm, 6px);
    background: transparent;
    cursor: pointer;
  }
  .thumb {
    display: block;
    border: 1px solid var(--hairline);
    line-height: 0;
  }
  .thumb.hidden {
    opacity: 0.35;
  }
  .name {
    flex: 1;
    font-size: 0.85rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* The handle is the only drag surface, so the list still scrolls by touch. */
  .handle {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    touch-action: none;
    cursor: grab;
    user-select: none;
    color: var(--ink-muted, #6b7280);
  }
  footer {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.4rem;
    border-top: 1px solid var(--hairline);
  }
  footer .sep {
    flex: 1;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>

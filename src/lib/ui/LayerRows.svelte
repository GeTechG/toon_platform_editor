<script lang="ts">
  // The layer list itself, in the reference's shape: an «+ Слой» header over
  // rows of eye · name · ⇕ · ×, every control acting on its own row. The
  // timeline's own column renders it. Layers are stored bottom-up and
  // shown top-down (topmost row first) — the order you see on the canvas.
  // A row shows the layer's stored name, or its position when it has none,
  // so moving an unnamed layer renumbers its row. The colour tag is a display
  // aid — six of them, picked per layer, never written to the document.
  import { onDestroy } from 'svelte';
  import { MAX_LAYER_NAME, MAX_LAYERS } from '../format/constants';
  import type { EditorState } from './editor-state.svelte';
  import { dragTargetIndex } from './frame-selection';
  import LayerThumb from './LayerThumb.svelte';
  import { rowHeight } from './thumb-size';
  import Icon from './Icon.svelte';

  // `compact` drops the per-row thumbnail: the studio timeline already shows
  // every cell, so a second thumbnail in the layer column would be noise.
  let { editor, compact = false }: { editor: EditorState; compact?: boolean } = $props();

  /**
   * Row height in px — one number for the whole list, so a drag converts
   * travel into whole rows. In the studio the rows line up with the timeline's
   * cells, so both follow the frame the canvas asks for.
   */
  const ROW_HEIGHT = $derived(rowHeight(editor.doc));
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

  /** Row number shown to the user: 1 for the topmost layer. */
  function rowNumber(layerIndex: number): number {
    return editor.doc.layers.length - layerIndex;
  }

  // --- Renaming -------------------------------------------------------------
  /** Layer being renamed, and the text in its field. */
  let renaming = $state<{ layer: number; text: string } | null>(null);

  /**
   * A double click on the row opens its name — but the row is also where the
   * eye, the colour tag, the handle and the delete live, and pressing one of
   * those twice quickly is two presses, not a rename.
   */
  function startRename(e: MouseEvent | null, layerIndex: number): void {
    if (e && (e.target as HTMLElement).closest('button, .handle')) {
      return;
    }
    renaming = { layer: layerIndex, text: editor.layerLabel(layerIndex) };
  }

  function commitRename(): void {
    if (!renaming) {
      return;
    }
    editor.renameActiveLayer(renaming.layer, renaming.text);
    renaming = null;
  }

  function onRenameKeydown(e: KeyboardEvent): void {
    // The editor's own hotkeys must not fire while a name is being typed.
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      renaming = null;
    }
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

  function removeLayer(layerIndex: number): void {
    if (!canRemove) {
      return;
    }
    // Deleting a layer is not undoable; the state asks by name through the
    // editor's one `ask`, so Alt+Enter mutes this the way it mutes the rest.
    editor.selectLayer(layerIndex);
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
    // F2 is the platform's rename key — the keyboard way in, since a double
    // click has none (WCAG 2.1.1).
    if (e.key === 'F2') {
      e.preventDefault();
      editor.selectLayer(layerIndex);
      startRename(null, layerIndex);
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

<!-- The gesture belongs to the window once it starts: reordering moves the
     handle's node, which drops its pointer capture, so a release delivered
     anywhere else would leave the drag — and its auto-scroll interval —
     running. All three handlers bail out when no drag is up. -->
<svelte:window
  onkeydown={onPanelKeydown}
  onpointermove={onHandleMove}
  onpointerup={endDrag}
  onpointercancel={cancelDrag}
/>

<div class="head">
  <button
    class="add-layer"
    disabled={!canAdd}
    onclick={(e) => editor.addLayerAtActive(e.ctrlKey || e.metaKey)}
    title="Добавить слой (Shift+A)"
  >
    <Icon name="plus" size={16} /> Слой
  </button>
</div>

<div class="list" data-layer-list bind:this={listEl} role="listbox" aria-label="Слои" tabindex="-1">
    {#each rows as layerIndex (editor.doc.layers[layerIndex])}
      <div
        class="row"
        style:height="{ROW_HEIGHT}px"
        class:active={layerIndex === editor.activeLayer}
        class:dragging={drag?.currentLayer === layerIndex}
        role="option"
        aria-selected={layerIndex === editor.activeLayer}
        tabindex="0"
        onclick={() => editor.selectLayer(layerIndex)}
        ondblclick={(e) => startRename(e, layerIndex)}
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
          <Icon name={editor.doc.layers[layerIndex].hidden ? 'eye-off' : 'eye'} size={16} />
        </button>

        {#if !compact}
          <span class="thumb" class:hidden={editor.doc.layers[layerIndex].hidden}>
            <LayerThumb doc={editor.doc} {layerIndex} frameIndex={editor.displayedFrame} maxW={28} />
          </span>
        {/if}

        <button
          class="tag"
          style="background: var(--layer-tag-{editor.layerColor(layerIndex)})"
          title="Цвет слоя (клик — следующий)"
          aria-label="Цвет слоя {editor.layerLabel(layerIndex)}"
          onclick={(e) => {
            e.stopPropagation();
            editor.cycleLayerColor(layerIndex);
          }}
        ></button>

        {#if renaming?.layer === layerIndex}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="name rename"
            autofocus
            maxlength={MAX_LAYER_NAME}
            bind:value={renaming.text}
            onclick={(e) => e.stopPropagation()}
            onkeydown={onRenameKeydown}
            onblur={commitRename}
            aria-label="Имя слоя"
          />
        {:else}
          <span class="name" title="Двойной клик или F2 — переименовать"
            >{editor.layerLabel(layerIndex)}</span>
        {/if}

        <span
          class="handle"
          role="presentation"
          title="Перетащить слой (Alt+↑ / Alt+↓)"
          onpointerdown={(e) => onHandleDown(e, layerIndex)}
        ><Icon name="move-vertical" size={16} /></span>

        <button
          class="kill"
          disabled={!canRemove}
          aria-label="Удалить слой {rowNumber(layerIndex)}"
          title="Удалить слой"
          onclick={(e) => {
            e.stopPropagation();
            removeLayer(layerIndex);
          }}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
  {/each}
</div>

<p class="sr-only" role="status" aria-live="polite">{announcement}</p>

<style>
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    box-sizing: border-box;
    min-height: 32px;
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
    flex: none;
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
    min-width: 0;
    font-size: 0.85rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rename {
    border: 1px solid var(--electric, #2f5bff);
    border-radius: var(--r-sm, 6px);
    padding: 0 0.25rem;
    background: var(--canvas, #fff);
    color: inherit;
    font: inherit;
    font-size: 0.85rem;
  }
  /* Six tags, in the theme rather than in the document; a click walks them.
     A 4px stripe would be a 4px tap target: the button is 14px wide with the
     stripe painted in its middle, so the pointer and the finger both hit it. */
  .tag {
    flex: none;
    box-sizing: content-box;
    width: 4px;
    height: 24px;
    padding: 0 5px;
    border: 0;
    border-radius: 2px;
    background-clip: content-box;
    cursor: pointer;
  }
  .tag:focus-visible {
    outline: 2px solid var(--electric, #2f5bff);
    outline-offset: 1px;
  }
  /* The handle is the only drag surface, so the list still scrolls by touch. */
  .handle {
    display: grid;
    place-items: center;
    flex: none;
    width: 30px;
    align-self: stretch;
    touch-action: none;
    cursor: grab;
    user-select: none;
    color: var(--ink-muted, #6b7280);
  }
  .head {
    display: flex;
    align-items: center;
    flex: none;
    height: 32px;
    padding: 0 0.3rem;
    border-bottom: 1px solid var(--hairline);
  }
  .add-layer {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    height: 26px;
    padding: 0 0.4rem;
    border: 0;
    border-radius: var(--r-sm, 6px);
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .add-layer:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .kill {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: none;
    border: 0;
    border-radius: var(--r-sm, 6px);
    background: transparent;
    color: var(--ink-muted, #6b7280);
    cursor: pointer;
  }
  .kill:disabled {
    opacity: 0.3;
    cursor: default;
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

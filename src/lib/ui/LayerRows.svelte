<script lang="ts">
  // The layer list itself, in the reference's shape: an «+ Слой» header over
  // rows of eye · name · ⇕ · ×, every control acting on its own row. The
  // timeline's own column renders it. Layers are stored bottom-up and
  // shown top-down (topmost row first) — the order you see on the canvas.
  // A row shows the layer's stored name, or its position when it has none,
  // so moving an unnamed layer renumbers its row. The colour tag is a display
  // aid — six of them, picked per layer, never written to the document.
  import { onDestroy, tick } from 'svelte';
  import { MAX_LAYER_NAME, MAX_LAYERS } from '../format/constants';
  import type { EditorState } from './editor-state.svelte';
  import type { Layer } from '../format/types';
  import { dragTargetIndex, layerGridStep } from './frame-selection';
  import { rowHeight, rowHeightCss } from './thumb-size';
  import Icon from './Icon.svelte';
  import { t } from '../i18n';

  // No thumbnail per row: the timeline beside it already shows every cell.
  let { editor }: { editor: EditorState } = $props();

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

  // --- One Tab stop ---------------------------------------------------------
  // The list is a layout grid (WAI-ARIA APG): only one control of it is in the
  // Tab order — the active layer's, in the column the arrows last left — so
  // twenty layers are one stop, not eighty. ↑/↓ pick a layer, ←/→ walk the
  // row's eye · tag · name · bin, Home/End the top and the bottom layer.
  const NAME_COL = 2;
  let col = $state(NAME_COL);
  /** Columns a row can focus: the bin is disabled, so unreachable, on the last layer. */
  const cols = $derived(canRemove ? 4 : 3);

  function stop(layerIndex: number, c: number): 0 | -1 {
    return layerIndex === editor.activeLayer && c === Math.min(col, cols - 1) ? 0 : -1;
  }

  /** Row number shown to the user: 1 for the topmost layer. */
  function rowNumber(layerIndex: number): number {
    return editor.doc.layers.length - layerIndex;
  }

  // --- Renaming -------------------------------------------------------------
  /**
   * Layer being renamed — by number and by the layer itself — and the text in
   * its field. A file dropped mid-rename replaces the document: the number
   * alone opened the field in the new drawing's row and named its layer.
   */
  let renaming = $state<{ layer: number; ref: Layer; text: string } | null>(null);

  /**
   * A double click on the row opens its name — but the row is also where the
   * eye, the colour tag, the handle and the delete live, and pressing one of
   * those twice quickly is two presses, not a rename.
   */
  function startRename(e: MouseEvent | null, layerIndex: number): void {
    if (e && (e.target as HTMLElement).closest('button:not(.name), .handle')) {
      return;
    }
    // A double click inside the open field selects a word; reopening it threw
    // the typing away for the stored name.
    if (renaming?.layer === layerIndex && renaming.ref === editor.doc.layers[layerIndex]) {
      return;
    }
    // The state refuses a rename while the preview runs; a field opened then
    // took the typing and threw it away.
    if (editor.playing) {
      return;
    }
    renaming = { layer: layerIndex, ref: editor.doc.layers[layerIndex], text: editor.layerLabel(layerIndex) };
  }

  function commitRename(): void {
    if (!renaming) {
      return;
    }
    if (editor.doc.layers[renaming.layer] === renaming.ref) {
      editor.renameActiveLayer(renaming.layer, renaming.text);
    }
    renaming = null;
  }

  function onRenameKeydown(e: KeyboardEvent): void {
    // The editor's own hotkeys must not fire while a name is being typed.
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      const layer = renaming?.layer ?? editor.activeLayer;
      commitRename();
      focusName(layer);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      const layer = renaming?.layer ?? editor.activeLayer;
      renaming = null;
      focusName(layer);
    }
  }

  /**
   * Puts the keyboard back on a row's name. The field that closed, the row
   * that was deleted and the row Svelte moved to reorder the list all take
   * their focus with them, which leaves it on <body> — the top of the page
   * for the next Tab.
   */
  function focusName(layerIndex: number): Promise<void> {
    col = NAME_COL;
    return focusCell(layerIndex);
  }

  /** The keyboard onto a row's control in the current column. */
  async function focusCell(layerIndex: number): Promise<void> {
    await tick();
    listEl
      ?.querySelector<HTMLElement>(`[data-layer="${layerIndex}"] [data-col="${Math.min(col, cols - 1)}"]`)
      ?.focus();
  }

  function announce(layerIndex: number): void {
    announcement = t('layer.moved', { n: rowNumber(layerIndex), total: editor.doc.layers.length });
  }

  // Undo and redo of a move say where the layer went, like the move itself
  // (owner, 14th audit); one made before this panel mounted is not repeated.
  let heard: { layer: number } | null | undefined;
  $effect(() => {
    const moved = editor.layerMoved;
    if (heard === undefined) {
      heard = moved;
      return;
    }
    if (moved && moved !== heard) {
      heard = moved;
      announce(moved.layer);
    }
  });

  function moveBy(layerIndex: number, delta: 1 | -1): void {
    const to = layerIndex + delta;
    if (to < 0 || to >= editor.doc.layers.length) {
      return;
    }
    const layer = editor.doc.layers[layerIndex];
    editor.moveLayerTo(layerIndex, to);
    // A move the state refused (a locked transform) has no position to say.
    if (editor.doc.layers[to] !== layer) {
      return;
    }
    announce(to);
    focusCell(to);
  }

  function removeLayer(layerIndex: number): void {
    if (!canRemove) {
      return;
    }
    // Undo brings a deleted layer back; the state still asks by name through the
    // editor's one `ask`.
    editor.selectLayer(layerIndex);
    const count = editor.doc.layers.length;
    editor.removeActiveLayer();
    // A refused delete leaves the row, and the bin under the keyboard, where they were.
    if (editor.doc.layers.length < count) {
      focusName(editor.activeLayer);
    }
  }

  /**
   * The grid's keys, from whichever control of a row holds the focus. Every
   * key it owns is kept from the editor's hotkeys — an arrow at an edge would
   * otherwise walk the frames, and Delete would take a frame.
   */
  function onGridKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const row = target.closest<HTMLElement>('[data-layer]');
    if (!row || target.dataset.col === undefined) {
      return;
    }
    const layerIndex = Number(row.dataset.layer);
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
      // autofocus only takes the focus from the name button the field replaces.
      tick().then(() => listEl?.querySelector<HTMLElement>('.rename')?.focus());
      return;
    }
    // The bin's key; the state asks «Удалить «Слой N»?» before it takes the layer.
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeLayer(layerIndex);
      return;
    }
    if (!/^(Arrow(Up|Down|Left|Right)|Home|End)$/.test(e.key) || e.altKey || e.ctrlKey || e.metaKey) {
      return;
    }
    e.preventDefault();
    const count = editor.doc.layers.length;
    const next = layerGridStep(count - 1 - layerIndex, Number(target.dataset.col), e.key, count, cols);
    if (!next) {
      return;
    }
    const to = count - 1 - next.row;
    editor.selectLayer(to);
    // A refused pick (a transform that will not let go) leaves the keyboard where it was.
    if (editor.activeLayer !== to) {
      return;
    }
    col = next.col;
    focusCell(to);
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
    /**
     * A row's height on screen: the keys in it grow with the text, so the
     * row can be taller than the frame's number (`rowHeightCss`).
     */
    rowPx: number;
    currentLayer: number;
    fromLayer: number;
  };
  let drag = $state<Drag | null>(null);
  let autoscroll = 0;
  let autoscrollDirection: -1 | 0 | 1 = 0;

  function onHandleDown(e: PointerEvent, layerIndex: number): void {
    // The main button only: a right press on the handle is a context menu.
    if (!e.isPrimary || e.button !== 0 || drag) {
      return;
    }
    editor.selectLayer(layerIndex); // grabbing a layer selects it
    // A refused pick (a transform under the lock) refuses the move as well:
    // the row followed the pointer and a reader heard of a move never made.
    if (editor.activeLayer !== layerIndex) {
      return;
    }
    const row = editor.doc.layers.length - 1 - layerIndex;
    drag = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startScroll: listEl?.scrollTop ?? 0,
      startRow: row,
      lastY: e.clientY,
      rowPx: listEl?.querySelector('.row')?.getBoundingClientRect().height || ROW_HEIGHT,
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
    const targetRow = dragTargetIndex(drag.startRow, drag.lastY - drag.startY + scrolled, drag.rowPx, count);
    const targetLayer = count - 1 - targetRow;
    if (targetLayer !== drag.currentLayer) {
      // Reorder for real on each index change: the canvas rebuilds once per
      // step, not once per pointermove.
      const moved = editor.doc.layers[drag.currentLayer];
      editor.moveLayerTo(drag.currentLayer, targetLayer, drag.currentLayer !== drag.fromLayer);
      if (editor.doc.layers[targetLayer] !== moved) {
        return; // refused: the layer is still where it was
      }
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
      listEl.scrollBy({ top: (direction * (drag?.rowPx ?? ROW_HEIGHT)) / 2 });
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
    // A press on the handle that moved nothing has nothing to say.
    if (drag.currentLayer !== drag.fromLayer) {
      announce(drag.currentLayer);
    }
    drag = null;
  }

  /** `e` is absent for the Escape path, which cancels whatever drag is running. */
  function cancelDrag(e?: PointerEvent): void {
    if (!drag || (e && e.pointerId !== drag.pointerId)) {
      return;
    }
    stopAutoscroll();
    // Back to where the gesture started — the document is restored, not patched.
    editor.moveLayerTo(drag.currentLayer, drag.fromLayer, true);
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
    aria-disabled={editor.playing || undefined}
    onclick={(e) => editor.addLayerAtActive(e.ctrlKey || e.metaKey)}
    title={canAdd ? editor.keyHint(t('layer.add_title')) : t('layer.full', { max: MAX_LAYERS })}
  >
    <Icon name="plus" size={16} /> <span class="add-word">{t('layer.add')}</span>
  </button>
</div>

<!-- A layout grid (WAI-ARIA APG): one Tab stop, the arrows inside. Each cell
     holds one button, so every control stays a control — an option role
     would have flattened them into the row's text. -->
<div
  class="list"
  data-layer-list
  bind:this={listEl}
  role="grid"
  aria-label={t('layer.list')}
  tabindex="-1"
  onkeydown={onGridKey}
>
    {#each rows as layerIndex (editor.doc.layers[layerIndex])}
      <!-- A click anywhere on the row picks the layer, as the reference does;
           the keyboard's way to the same thing is the arrows. -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_interactive_supports_focus -->
      <div
        class="row"
        style:height={rowHeightCss(editor.doc)}
        class:active={layerIndex === editor.activeLayer}
        class:dragging={drag?.currentLayer === layerIndex}
        role="row"
        data-layer={layerIndex}
        onclick={() => editor.selectLayer(layerIndex)}
        ondblclick={(e) => startRename(e, layerIndex)}
      >
        <span class="cell" role="gridcell">
        <button
          class="eye"
          data-col="0"
          tabindex={stop(layerIndex, 0)}
          aria-label={editor.doc.layers[layerIndex].hidden
            ? t('layer.show', { name: editor.layerLabel(layerIndex) })
            : t('layer.hide', { name: editor.layerLabel(layerIndex) })}
          title={editor.doc.layers[layerIndex].hidden
            ? t('layer.show', { name: editor.layerLabel(layerIndex) })
            : t('layer.hide', { name: editor.layerLabel(layerIndex) })}
          onclick={(e) => {
            e.stopPropagation();
            editor.toggleLayerHidden(layerIndex);
          }}
        >
          <Icon name={editor.doc.layers[layerIndex].hidden ? 'eye-off' : 'eye'} size={16} />
        </button>
        </span>

        <span class="cell" role="gridcell">
        <button
          class="tag"
          data-col="1"
          tabindex={stop(layerIndex, 1)}
          style="background: var(--layer-tag-{editor.layerColor(layerIndex)})"
          title={t('layer.colour_title')}
          aria-label={t('layer.colour', { name: editor.layerLabel(layerIndex) })}
          onclick={(e) => {
            e.stopPropagation();
            editor.cycleLayerColor(layerIndex);
          }}
        ></button>
        </span>

        <span class="cell" role="gridcell">
        {#if renaming?.ref === editor.doc.layers[layerIndex]}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="name rename"
            autofocus
            maxlength={MAX_LAYER_NAME}
            bind:value={renaming.text}
            onclick={(e) => e.stopPropagation()}
            onfocus={(e) => e.currentTarget.select()}
            onkeydown={onRenameKeydown}
            onblur={commitRename}
            aria-label={t('layer.name_field')}
          />
        {:else}
          <button
            class="name"
            data-col="2"
            tabindex={stop(layerIndex, 2)}
            aria-keyshortcuts="F2 Alt+ArrowUp Alt+ArrowDown"
            aria-pressed={layerIndex === editor.activeLayer}
            title={`${editor.layerLabel(layerIndex)}\n${t('layer.rename_hint')}`}
            onclick={() => editor.selectLayer(layerIndex)}
          >{editor.layerLabel(layerIndex)}</button>
        {/if}
        </span>

        <!-- The pointer's way to reorder; the keyboard's is Alt+↑/↓ on any cell. -->
        <span
          class="handle"
          aria-hidden="true"
          title={t('layer.drag')}
          onpointerdown={(e) => onHandleDown(e, layerIndex)}
        ><Icon name="move-vertical" size={16} /></span>

        <span class="cell" role="gridcell">
        <button
          class="kill"
          data-col="3"
          tabindex={stop(layerIndex, 3)}
          aria-keyshortcuts="Delete Backspace"
          disabled={!canRemove}
          aria-disabled={editor.playing || undefined}
          aria-label={t('layer.remove', { name: editor.layerLabel(layerIndex) })}
          title={t('layer.remove_title')}
          onclick={(e) => {
            e.stopPropagation();
            removeLayer(layerIndex);
          }}
        >
          <Icon name="x" size={14} />
        </button>
        </span>
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
    /* In px, though the eye, the handle and the bin are in rem (their glyphs
       grow with the text): rem gaps doubled with 200 % text as well and
       pushed the bin out of the column. */
    gap: 6px;
    box-sizing: border-box;
    min-height: 32px;
    padding: 0 5px 0 8px;
    position: relative;
    cursor: pointer;
  }
  /* The active row, in the tool keys' language — a light red fill and red
     ink — plus what is not colour: a bar at the left edge (the accent, 3.5:1
     on the fill) and a heavier name. The fill stays 12 %: every layer tag
     keeps its 3:1 on it. No ring round the row: plates part by tone here. */
  .row.active {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .row.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 4px;
    bottom: 4px;
    width: 3px;
    border-radius: 0 2px 2px 0;
    background: var(--accent);
  }
  .row.active .name {
    font-weight: 700;
    color: var(--accent-ink);
  }
  .row.dragging {
    opacity: 0.7;
  }
  /* A cell is only a role for the grid; its button stays the row's flex item. */
  .cell {
    display: contents;
  }
  /* The name button carries the keyboard; its ring sits inside, where the
     scrolling list cannot shave it off. */
  .name:focus-visible {
    outline-offset: -3px;
  }
  .eye {
    display: grid;
    place-items: center;
    flex: none;
    width: 1.75rem;
    height: 1.75rem;
    border: 0;
    border-radius: var(--r-sm, 7px);
    background: transparent;
    cursor: pointer;
  }
  .name {
    flex: 1;
    /* The name is the only thing telling two rows apart, so it keeps a floor of
       its own: «Слой 1» measures 45 and the column is sized to honour this.
       `min-width: 0` let it shrink to nothing and the list to a column of
       «Сло…». Past the floor the ellipsis is right — the divider widens it. */
    min-width: 3rem;
    align-self: stretch;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.85rem;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rename {
    border: 1px solid var(--accent);
    border-radius: var(--r-sm, 7px);
    padding: 0 0.25rem;
    background: var(--canvas);
    color: inherit;
    font: inherit;
    font-size: 0.85rem;
  }
  /* Safari on an iPhone zooms the page onto a field under 16 px and does not
     zoom back: the studio stayed magnified after a rename. */
  @media (pointer: coarse) {
    .rename {
      font-size: max(16px, 0.85rem);
    }
  }
  /* Six tags, in the theme rather than in the document; a click walks them.
     A 4px stripe would be a 4px tap target: the button is 14px wide with the
     stripe painted in its middle, so the pointer and the finger both hit it. */
  .tag {
    position: relative;
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
  /* The stripe is 4px wide on purpose — a column of them reads as a margin
     beside the names, not as a row of buttons. The thing being pressed is not
     the stripe, though: 14px was the narrowest target in the editor. The press
     target grows to the 24px floor without the drawing growing with it, and
     stays inside the 6px gap to the eye, so no neighbour loses its own press. */
  .tag::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 24px;
    height: 100%;
    transform: translate(-50%, -50%);
  }
  .tag:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  /* The handle is the only drag surface, so the list still scrolls by touch. */
  .handle {
    display: grid;
    place-items: center;
    flex: none;
    width: 1.875rem;
    align-self: stretch;
    touch-action: none;
    cursor: grab;
    -webkit-user-select: none;
    user-select: none;
    color: var(--ink-2);
  }
  /* The strip's frame numbers are 2rem too: the rows under both start level. */
  .head {
    display: flex;
    align-items: center;
    flex: none;
    box-sizing: border-box;
    height: 2rem;
    padding: 0 0.3rem;
    border-bottom: 1px solid var(--hairline);
  }
  .add-layer {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    height: 1.625rem;
    padding: 0 0.4rem;
    border: 0;
    border-radius: var(--r-sm, 7px);
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  /* aria-disabled rather than disabled while the preview runs (as the
     strip's cells): a key that loses `disabled` under the focus drops it. */
  .add-layer:disabled,
  .add-layer[aria-disabled='true'] {
    opacity: 0.4;
    cursor: default;
  }
  .kill {
    display: grid;
    place-items: center;
    width: 1.625rem;
    height: 1.625rem;
    flex: none;
    border: 0;
    border-radius: var(--r-sm, 7px);
    background: transparent;
    color: var(--ink-2);
    cursor: pointer;
  }
  .kill:disabled,
  .kill[aria-disabled='true'] {
    opacity: 0.3;
    cursor: default;
  }
  /* Phone: the column is 10rem, and the row's desktop furniture (137 px)
     plus the name's floor asked for 178 — the handle and the bin sat past
     the edge. Every key here keeps the 24 px floor (WCAG 2.5.8). */
  :global(:where(.studio.phone)) .row {
    gap: 4px;
    padding: 0 3px;
  }
  /* The 16px glyph (in rem) and 8px: the 24 px floor at 100 % text, and at
     200 % 40 rather than 48 — the column has the least room here. */
  :global(:where(.studio.phone)) .eye,
  :global(:where(.studio.phone)) .handle,
  :global(:where(.studio.phone)) .kill {
    width: calc(1rem + 8px);
  }
  :global(:where(.studio.phone)) .eye,
  :global(:where(.studio.phone)) .kill {
    height: calc(1rem + 8px);
  }
  /* The tag's 24 px press circle reaches 5 px past its 14 px key: with the
     4 px gap it ran over the eye and the name. A pixel each side, and the
     row still fits the column. */
  :global(:where(.studio.phone)) .tag {
    margin-inline: 1px;
  }
  /* The keys first, the name after them (the owner, after the thirteenth
     audit): at 360 px the row asked 155 of a 137 px column and the bin went
     off into a sideways scroll. The column never goes under the keys
     (Timeline.svelte); the name takes what is left, down to nothing. */
  :global(:where(.studio.phone)) .name {
    min-width: 0;
  }
  /* Where the keys would take more than half the strip (200 % text on a
     phone standing up), the drag handle folds away: the bin and the eye stay
     in reach, and the frames keep a cell. Alt+↑/↓ still moves a layer. */
  @container strip (width < calc(6rem + 126px)) {
    .handle {
      display: none;
    }
    /* «+ Слой» ran past the column over the frames' numbers: the plus stays,
       the word stays the key's name for a reader. */
    .add-word {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  }
  @media (forced-colors: active) {
    .row.active::before {
      forced-color-adjust: none;
      background: Highlight;
    }
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

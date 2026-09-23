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
  import { dragTargetIndex } from './frame-selection';
  import LayerThumb from './LayerThumb.svelte';
  import { rowHeight } from './thumb-size';
  import Icon from './Icon.svelte';
  import { t } from '../i18n';

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
    if (e && (e.target as HTMLElement).closest('button:not(.name), .handle')) {
      return;
    }
    // A double click inside the open field selects a word; reopening it threw
    // the typing away for the stored name.
    if (renaming?.layer === layerIndex) {
      return;
    }
    // The state refuses a rename while the preview runs; a field opened then
    // took the typing and threw it away.
    if (editor.playing) {
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
  async function focusName(layerIndex: number): Promise<void> {
    await tick();
    listEl?.querySelector<HTMLElement>(`[data-layer="${layerIndex}"]`)?.focus();
  }

  function announce(layerIndex: number): void {
    announcement = t('layer.moved', { n: rowNumber(layerIndex), total: editor.doc.layers.length });
  }

  function moveBy(layerIndex: number, delta: 1 | -1): void {
    const to = layerIndex + delta;
    if (to < 0 || to >= editor.doc.layers.length) {
      return;
    }
    editor.moveLayerTo(layerIndex, to);
    announce(to);
    focusName(to);
  }

  function removeLayer(layerIndex: number): void {
    if (!canRemove) {
      return;
    }
    // Deleting a layer is not undoable; the state asks by name through the
    // editor's one `ask`, so Alt+Enter mutes this the way it mutes the rest.
    editor.selectLayer(layerIndex);
    const count = editor.doc.layers.length;
    editor.removeActiveLayer();
    // A refused delete leaves the row, and the bin under the keyboard, where they were.
    if (editor.doc.layers.length < count) {
      focusName(editor.activeLayer);
    }
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
    // The main button only: a right press on the handle is a context menu.
    if (!e.isPrimary || e.button !== 0 || drag) {
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
    aria-disabled={editor.playing || undefined}
    onclick={(e) => editor.addLayerAtActive(e.ctrlKey || e.metaKey)}
    title={canAdd ? t('layer.add_title') : t('layer.full', { max: MAX_LAYERS })}
  >
    <Icon name="plus" size={16} /> {t('layer.add')}
  </button>
</div>

<div class="list" data-layer-list bind:this={listEl} role="list" aria-label={t('layer.list')} tabindex="-1">
    {#each rows as layerIndex (editor.doc.layers[layerIndex])}
      <!-- A click anywhere on the row picks the layer, as the reference does;
           the keyboard's way to the same thing is the name button below. An
           option role would have flattened every control in the row. -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="row"
        style:height="{ROW_HEIGHT}px"
        class:active={layerIndex === editor.activeLayer}
        class:dragging={drag?.currentLayer === layerIndex}
        role="listitem"
        onclick={() => editor.selectLayer(layerIndex)}
        ondblclick={(e) => startRename(e, layerIndex)}
      >
        <button
          class="eye"
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

        {#if !compact}
          <span class="thumb" class:hidden={editor.doc.layers[layerIndex].hidden}>
            <LayerThumb doc={editor.doc} {layerIndex} frameIndex={editor.displayedFrame} maxW={28} />
          </span>
        {/if}

        <button
          class="tag"
          style="background: var(--layer-tag-{editor.layerColor(layerIndex)})"
          title={t('layer.colour_title')}
          aria-label={t('layer.colour', { name: editor.layerLabel(layerIndex) })}
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
            onfocus={(e) => e.currentTarget.select()}
            onkeydown={onRenameKeydown}
            onblur={commitRename}
            aria-label={t('layer.name_field')}
          />
        {:else}
          <button
            class="name"
            data-layer={layerIndex}
            aria-keyshortcuts="F2 Alt+ArrowUp Alt+ArrowDown"
            aria-pressed={layerIndex === editor.activeLayer}
            title={`${editor.layerLabel(layerIndex)}\n${t('layer.rename_hint')}`}
            onclick={() => editor.selectLayer(layerIndex)}
            onkeydown={(e) => onRowKeydown(e, layerIndex)}
          >{editor.layerLabel(layerIndex)}</button>
        {/if}

        <span
          class="handle"
          role="presentation"
          title={t('layer.drag')}
          onpointerdown={(e) => onHandleDown(e, layerIndex)}
        ><Icon name="move-vertical" size={16} /></span>

        <button
          class="kill"
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
    /* In px, like the eye, the tag and the bin they space: in rem the gaps
       doubled with 200 % text and pushed the bin out of the column. */
    gap: 6px;
    box-sizing: border-box;
    min-height: 32px;
    padding: 0 5px 0 8px;
    cursor: pointer;
  }
  .row.active {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .row.dragging {
    opacity: 0.7;
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
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: var(--r-sm, 7px);
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
    width: 30px;
    align-self: stretch;
    touch-action: none;
    cursor: grab;
    user-select: none;
    color: var(--ink-2);
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
    width: 26px;
    height: 26px;
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
  @media (max-width: 40rem) {
    .row {
      gap: 4px;
      padding: 0 3px;
    }
    .eye,
    .handle,
    .kill {
      width: 24px;
    }
    .eye,
    .kill {
      height: 24px;
    }
    /* The tag's 24 px press circle reaches 5 px past its 14 px key: with the
       4 px gap it ran over the eye and the name. A pixel each side, and the
       row still fits the column. */
    .tag {
      margin-inline: 1px;
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

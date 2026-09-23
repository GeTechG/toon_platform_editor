<script lang="ts">
  // The reference toonio.ru timeline (`Timeline` in toonio.bundle.js:8645):
  // the layer list on the left and a layer-by-frame grid of cell thumbnails
  // on the right, filling whatever height the resizable bottom panel gives
  // it. One shape for every preset — a preset patches where the strip sits,
  // not what it is.
  import { tick } from 'svelte';
  import type { EditorState } from './editor-state.svelte';
  import { CELL_BOX, fitThumb, rowHeight } from './thumb-size';
  import { scrollToFrame, stripWindow } from './strip-window';
  import LayerRows from './LayerRows.svelte';
  import LayerThumb from './LayerThumb.svelte';
  import Icon from './Icon.svelte';
  import { t } from '../i18n';

  let { editor }: { editor: EditorState } = $props();


  let strip = $state<HTMLDivElement | undefined>();
  let body = $state<HTMLDivElement | undefined>();

  /** Keeps the layer names level with their row of cells. */
  function syncRowScroll(e: Event): void {
    const from = e.target as HTMLElement | null;
    if (from === strip) {
      // The window of frames the strip builds follows the scroll.
      stripScroll = strip.scrollLeft;
    }
    const list = body?.querySelector<HTMLElement>('[data-layer-list]');
    if (!from || !list || !strip) {
      return;
    }
    const to = from === list ? strip : from === strip ? list : null;
    if (to && Math.abs(to.scrollTop - from.scrollTop) > 1) {
      to.scrollTop = from.scrollTop;
    }
  }

  // --- The window of frames the strip builds ---------------------------------
  // The format allows 4096 frames and a row is built per layer: three hundred
  // frames on five layers is fifteen hundred buttons with a canvas inside. The
  // strip builds what is in view plus a screen either side, and two spacers
  // stand in for the rest so the scrollbar is the length it always was.
  /** The gap between cells of a row — `.head`, `.cells` and `.wave` share it. */
  const GRID_GAP = 2;
  let stripScroll = $state(0);
  let stripWidth = $state(0);

  // Keep the active frame in view (the reference list re-centers on it):
  // after add/delete/paste/hotkeys the strip scrolls just enough to show it.
  // Not during playback — the strip stays put while frames flip.
  $effect(() => {
    const index = editor.activeFrame;
    void editor.doc;
    if (editor.playing || !strip) return;
    // Where the frame sits is arithmetic: its cell may not be built.
    const to = scrollToFrame(index, thumbWidth, GRID_GAP, strip.scrollLeft, strip.clientWidth);
    if (to !== null) {
      strip.scrollLeft = to;
      stripScroll = to;
    }
  });

  // The strip is one Tab stop — the active cell — and focus rides along with
  // it: when the arrows move the active cell while a cell has focus, focus
  // moves too, so the new cell's name («Кадр 5, Слой 1») is what is read.
  // After the tick: the cell may only now be built by the scroll above.
  $effect(() => {
    void editor.displayedFrame;
    void editor.activeLayer;
    const focused = document.activeElement;
    if (!strip || !(focused instanceof HTMLElement) || !focused.classList.contains('cell') || !strip.contains(focused)) {
      return;
    }
    void tick().then(() => strip?.querySelector<HTMLElement>('.cell.active')?.focus());
  });

  // --- Studio grid ----------------------------------------------------------
  // The count, not the array: a write splices the array in place, so a derived
  // array would be the same reference and the window would never rebuild.
  const frameTotal = $derived(editor.doc.layers[0].frames.length);
  // Rows top-down: row 0 is the topmost layer, matching the layer column.
  const rows = $derived(editor.doc.layers.map((_, i) => editor.doc.layers.length - 1 - i));
  const onionFrames = $derived(
    editor.showOnionSkin ? editor.onionSkinLayers.map((layer) => layer.index) : [],
  );

  function isSelected(frame: number, layer: number): boolean {
    return editor.selection.frames.includes(frame) && editor.selection.layers.includes(layer);
  }

  function onCellClick(e: MouseEvent, frame: number, layer: number): void {
    const mode = e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'set';
    editor.selectCell(frame, layer, mode);
  }

  // --- Drag-selection -------------------------------------------------------
  // The reference drags a rectangle of cells with the button held
  // (`bundle:9111-9150`). Touch is left alone: a finger on the grid scrolls
  // the strip, which is the only way to reach a frame off screen on a phone.
  let dragging = $state(false);

  function onCellDown(e: PointerEvent, frame: number, layer: number): void {
    // The right button is the frame menu's: it must not collapse the block.
    if (e.pointerType === 'touch' || !e.isPrimary || e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) {
      return;
    }
    dragging = true;
    // The anchor is the cell pressed: `selectCell` moves the active cell
    // there, and every later 'range' spans from it.
    editor.selectCell(frame, layer);
  }

  function onCellEnter(e: PointerEvent, frame: number, layer: number): void {
    if (!dragging || e.pointerType === 'touch') {
      return;
    }
    editor.selectCell(frame, layer, 'range');
    (e.currentTarget as HTMLElement).scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function endCellDrag(): void {
    dragging = false;
  }

  /**
   * A press on the empty part of the strip collapses the block
   * (`bundle:8938-8944`). The rows stretch across the strip, so "empty" is
   * anywhere inside it that is not a cell — comparing the container against
   * itself would leave nowhere to press.
   */
  function resetSelection(e: PointerEvent): void {
    if (editor.playing || (e.target as HTMLElement).closest('.cell')) {
      return;
    }
    editor.collapseSelection();
  }

  // --- The frame menu -------------------------------------------------------
  // What the key row used to carry — delete, copy, paste, merge — lives on a
  // right press on the cell itself. The keys (A, Del, C, V, M) stay as they were.
  let menu = $state<{ x: number; y: number; cell: HTMLElement } | null>(null);
  let menuEl = $state<HTMLDivElement | undefined>();

  function openMenu(e: MouseEvent, frame: number, layer: number): void {
    e.preventDefault();
    if (editor.playing) {
      return;
    }
    // A press inside the block keeps it: the menu acts on what is selected.
    if (!isSelected(frame, layer)) {
      editor.selectCell(frame, layer);
    }
    const cell = e.currentTarget as HTMLElement;
    // The menu key and Shift+F10 fire with no pointer: open under the cell.
    const box = cell.getBoundingClientRect();
    const at = e.clientX || e.clientY ? { x: e.clientX, y: e.clientY } : { x: box.left, y: box.bottom };
    menu = { ...at, cell };
    void tick().then(() => {
      if (!menu || !menuEl) return;
      // The strip sits at the bottom: a menu that would run off the screen opens up/left instead.
      menu.x = Math.max(4, Math.min(menu.x, innerWidth - menuEl.offsetWidth - 4));
      menu.y = Math.max(4, Math.min(menu.y, innerHeight - menuEl.offsetHeight - 4));
      menuEl.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    });
  }

  function closeMenu(refocus = false): void {
    if (refocus) menu?.cell.focus();
    menu = null;
  }

  function run(action: () => void): void {
    closeMenu(true);
    action();
  }

  function onMenuKey(e: KeyboardEvent): void {
    // The menu owns the keys while open: the arrows are not the studio's layer keys here.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(menuEl?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }

  function onWindowDown(e: PointerEvent): void {
    if (menu && !menuEl?.contains(e.target as Node)) closeMenu();
  }

  // --- Soundtrack -----------------------------------------------------------
  // The reference's wave: half a bar per pixel of frame width, recomputed when
  // fps changes — the wave stretches over the strip rather than being re-read
  // from the file.
  const barsPerFrame = (cellWidth: number) => Math.max(1, Math.round(cellWidth / 2));
  // The canvas max-fitted into one frame — the same caps for every project.
  // `+2` is the 1px border on each side of the cell around the thumbnail; the
  // row it sits in grows with it, down to the floor its name and icons need.
  const cell = $derived(fitThumb(editor.doc.width, editor.doc.height, CELL_BOX.w, CELL_BOX.h));
  const row = $derived(rowHeight(editor.doc));
  const thumbWidth = $derived(cell.w + 2);
  /** The frames built right now — the ones in view, plus a screen either side. */
  const view = $derived(stripWindow(frameTotal, thumbWidth, GRID_GAP, stripScroll, stripWidth));
  const built = $derived(Array.from({ length: view.count }, (_, k) => view.first + k));

  // --- Layer column width ---------------------------------------------------
  // The divider between the layer list and the grid. Until it is dragged the
  // column keeps its CSS width, so the phone layout stays narrow on its own.
  /** The floor is a row without its name: eye, tag, handle, delete and the gaps. */
  const COL_MIN = 128;
  const COL_MAX = 320;
  /** Keyboard step, in px (WCAG 2.2 AA 2.5.7 — no drag required). */
  const COL_STEP = 16;
  let colPx = $state(0);
  let colWidth = $state<number | null>(null);
  let colDrag: { pointerId: number; startX: number; startWidth: number } | null = null;

  function setCol(px: number): void {
    colWidth = Math.min(COL_MAX, Math.max(COL_MIN, Math.round(px)));
  }

  function onColDown(e: PointerEvent): void {
    if (!e.isPrimary) return;
    colDrag = { pointerId: e.pointerId, startX: e.clientX, startWidth: colPx };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onColMove(e: PointerEvent): void {
    if (!colDrag || e.pointerId !== colDrag.pointerId) return;
    setCol(colDrag.startWidth + e.clientX - colDrag.startX);
  }

  function onColUp(e: PointerEvent): void {
    if (colDrag && e.pointerId === colDrag.pointerId) colDrag = null;
  }

  function onColKey(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        setCol((colWidth ?? colPx) - COL_STEP);
        break;
      case 'ArrowRight':
        e.preventDefault();
        setCol((colWidth ?? colPx) + COL_STEP);
        break;
    }
  }

</script>

{#snippet wave(cellWidth: number)}
  {#if editor.audio.hasTrack}
    {@const per = barsPerFrame(cellWidth)}
    {@const bars = editor.audio.bars(editor.doc.frame_rate, per)}
    <!-- Decoration: the note key's panel carries the track's name, its length
         and the controls. The lane is drawn even where the track is silent, so
         an empty stretch reads as "quiet here", not as a missing waveform. -->
    <div class="wave" aria-hidden="true">
      {#if view.before > 0}
        <span class="gap" style:width="{view.before}px"></span>
      {/if}
      {#each built as i (i)}
        <span class="bar" style:width="{cellWidth}px">
          {#each { length: per } as _, k (k)}
            <span style:height="{Math.max(6, Math.round((bars[i * per + k] ?? 0) * 100))}%"></span>
          {/each}
        </span>
      {/each}
      {#if view.after > 0}
        <span class="gap" style:width="{view.after}px"></span>
      {/if}
    </div>
  {/if}
{/snippet}


<!-- The release may land anywhere — outside the grid, outside the window —
     so the drag always ends on the window rather than on a cell. -->
<svelte:window onpointerup={endCellDrag} onpointercancel={endCellDrag} onpointerdown={onWindowDown} onblur={() => closeMenu()} />

<!-- The bottom panel owns the height; the timeline fills the row it is given. -->
<div class="board">
  <!-- The names and the cells are two scrollers side by side; a scroll in one
       is a scroll in the other, or the rows stop meaning the same layer.
       Scroll does not bubble, so this listens in the capture phase. -->
  <div class="body" bind:this={body} onscrollcapture={syncRowScroll}>
    <div
      class="layer-col"
      bind:clientWidth={colPx}
      style:width={colWidth === null ? undefined : `${colWidth}px`}
    >
      <LayerRows {editor} compact />
    </div>

    <!-- A focusable separator is a window splitter widget (ARIA 1.2), which
         svelte-check's non-interactive rules do not model. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="col-resizer"
      role="separator"
      aria-label={t('timeline.col_width')}
      aria-orientation="vertical"
      aria-valuenow={colPx}
      aria-valuemin={COL_MIN}
      aria-valuemax={COL_MAX}
      tabindex="0"
      onpointerdown={onColDown}
      onpointermove={onColMove}
      onpointerup={onColUp}
      onpointercancel={onColUp}
      onkeydown={onColKey}
      title={t('timeline.col_width_title')}
    ></div>

    <!-- The press-to-deselect is a mouse convenience on top of the cells,
         which are ordinary buttons: nothing here is keyboard-only reachable
         through the container, so it stays a labelled group. -->
    <div
      class="grid"
      role="group"
      aria-label={t('timeline.grid')}
      bind:this={strip}
      bind:clientWidth={stripWidth}
      onpointerdown={resetSelection}
    >
      <div class="head">
        {#if view.before > 0}
          <span class="gap" style:width="{view.before}px" aria-hidden="true"></span>
        {/if}
        {#each built as i (i)}
          <span
            class="num"
            style:width="{cell.w + 2}px"
            class:onion={onionFrames.includes(i)}
            class:copied={editor.copiedFrom?.frames.includes(i)}
            title={onionFrames.includes(i) ? t('timeline.frame_onion', { n: i + 1 }) : t('timeline.frame', { n: i + 1 })}
          >{i + 1}</span>
        {/each}
        {#if view.after > 0}
          <span class="gap" style:width="{view.after}px" aria-hidden="true"></span>
        {/if}
      </div>
      {#each rows as layerIndex (editor.doc.layers[layerIndex])}
        <div class="cells" style:height="{row}px">
          {#if view.before > 0}
            <span class="gap" style:width="{view.before}px" aria-hidden="true"></span>
          {/if}
          {#each built as i (i)}
            <button
              class="cell"
              style:width="{cell.w + 2}px"
              style:height="{cell.h + 2}px"
              class:active={i === editor.displayedFrame && layerIndex === editor.activeLayer}
              class:selected={isSelected(i, layerIndex)}
              class:copied={editor.isCopiedCell(i, layerIndex)}
              class:dim={editor.doc.layers[layerIndex].hidden}
              data-frame={i}
              tabindex={i === editor.displayedFrame && layerIndex === editor.activeLayer ? 0 : -1}
              disabled={editor.playing}
              aria-current={i === editor.displayedFrame && layerIndex === editor.activeLayer
                ? 'true'
                : undefined}
              aria-pressed={isSelected(i, layerIndex)}
              onclick={(e) => onCellClick(e, i, layerIndex)}
              onpointerdown={(e) => onCellDown(e, i, layerIndex)}
              onpointerenter={(e) => onCellEnter(e, i, layerIndex)}
              oncontextmenu={(e) => openMenu(e, i, layerIndex)}
              title={t('timeline.cell', { frame: i + 1, layer: editor.layerLabel(layerIndex) })}
              aria-label={t('timeline.cell', { frame: i + 1, layer: editor.layerLabel(layerIndex) })}
            >
              <LayerThumb
                doc={editor.doc}
                {layerIndex}
                frameIndex={i}
                maxW={CELL_BOX.w}
                maxH={CELL_BOX.h}
              />
            </button>
          {/each}
          {#if view.after > 0}
            <span class="gap" style:width="{view.after}px" aria-hidden="true"></span>
          {/if}
        </div>
      {/each}
      {@render wave(thumbWidth)}
    </div>
  </div>
</div>

{#if menu}
  <div
    class="frame-menu"
    role="menu"
    tabindex="-1"
    aria-label={t('timeline.menu')}
    style:left="{menu.x}px"
    style:top="{menu.y}px"
    bind:this={menuEl}
    onkeydown={onMenuKey}
  >
    <button role="menuitem" onclick={() => run(() => editor.addFrameAfterActive())}>
      <Icon name="plus" size={16} /><span>{t('panel.item.add_frame')}</span><kbd>A</kbd>
    </button>
    <button role="menuitem" disabled={!editor.canRemoveFrame} onclick={() => run(() => editor.removeActiveFrame())}>
      <Icon name="trash" size={16} /><span>{t('panel.item.delete_frame')}</span><kbd>Del</kbd>
    </button>
    <button role="menuitem" onclick={() => run(() => editor.copySelection())}>
      <Icon name="copy" size={16} /><span>{t('panel.item.copy')}</span><kbd>C</kbd>
    </button>
    <button role="menuitem" disabled={!editor.canPasteCells} onclick={() => run(() => editor.pasteSelection())}>
      <Icon name="paste" size={16} /><span>{t('panel.item.paste')}</span><kbd>V</kbd>
    </button>
    <button role="menuitem" disabled={!editor.canPasteCells} onclick={() => run(() => editor.mergeSelection())}>
      <Icon name="merge" size={16} /><span>{t('panel.item.merge')}</span><kbd>M</kbd>
    </button>
  </div>
{/if}

<style>

  /* --- The layer × frame grid -------------------------------------------- */
  .board {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
    border: none;
    border-radius: var(--r-sm);
    background: var(--canvas);
    overflow: hidden;
  }
  .layer-col {
    display: flex;
    flex-direction: column;
    flex: none;
    /* The row spends 137 of this on furniture — padding, eye, tag, handle,
       delete and four gaps — so 11rem left 39 for the name and «Слой 1» needs
       45. The editor's own default name did not fit the editor's own default
       column; the divider is for long names, not for that. */
    width: 12.5rem;
    min-height: 0;
    border-right: 1px solid var(--hairline);
  }
  /* A 7px band straddling that border, so the grab target is not the hairline. */
  .col-resizer {
    position: relative;
    flex: none;
    width: 7px;
    margin: 0 -3px 0 -4px;
    z-index: 1;
    cursor: ew-resize;
    touch-action: none;
  }
  /* A splitter is a hairline by nature — drawn wider it becomes a bar between
     the names and the grid. So the drawn width stays 7px and the band a finger
     can catch is 24: it reaches over the list and the grid, neither of which is
     a target of its own, so nothing else loses its press to it. */
  .col-resizer::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 0;
    bottom: 0;
    width: 24px;
    transform: translateX(-50%);
  }
  .col-resizer:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .grid {
    flex: 1;
    min-width: 0;
    overflow: auto;
  }
  .head {
    display: flex;
    gap: 2px;
    height: 32px;
    padding: 0 2px;
    border-bottom: 1px solid var(--hairline);
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--canvas);
  }
  .num {
    flex: none;
    text-align: center;
    font-size: 0.6rem;
    line-height: 32px;
    font-variant-numeric: tabular-nums;
    color: var(--ink-2);
  }
  /* Onion and copied frames are named in the header, not only tinted. */
  .num.onion {
    color: var(--accent-ink);
    text-decoration: underline dotted;
  }
  .num.copied::after {
    content: '⧉';
    margin-left: 1px;
  }
  .cells {
    display: flex;
    gap: 2px;
    padding: 2px;
    align-items: center;
  }
  .cell {
    flex: none;
    box-sizing: border-box;
    display: grid;
    place-items: center;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--edge);
    border-radius: 4px;
    background: var(--canvas);
    cursor: pointer;
  }
  .cell.dim {
    opacity: 0.35;
  }
  /* Active is a solid ring, the selection a dashed one, the copied block a
     dotted one — three shapes, so colour is never the only signal. */
  .cell.selected {
    border-style: dashed;
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .cell.copied {
    border-style: dotted;
  }
  .cell.active {
    border-style: solid;
    border-color: var(--accent);
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .cell:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .cell:disabled {
    cursor: default;
  }
  /* --- The frame menu ---------------------------------------------------- */
  /* A drop, so it takes the menu shadow (DESIGN: only what falls over work). */
  .frame-menu {
    position: fixed;
    z-index: 50;
    display: flex;
    flex-direction: column;
    min-width: 13rem;
    padding: 4px;
    border-radius: var(--r-md);
    background: var(--paper);
    box-shadow: var(--shadow-menu);
  }
  .frame-menu button {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: var(--key-h, 2.75rem);
    padding: 0 10px;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .frame-menu span {
    flex: 1;
  }
  .frame-menu kbd {
    font: inherit;
    font-size: 0.75rem;
    color: var(--ink-2);
  }
  .frame-menu button:hover:not(:disabled),
  .frame-menu button:focus-visible {
    background: var(--hairline-soft);
    outline: none;
  }
  .frame-menu button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  /* --- Soundtrack --------------------------------------------------------- */
  /* One bar per frame, aligned to the strip above it, so the wave reads as
     "this much sound happens on this frame" without a second ruler. The lane
     itself is drawn, not just the bars: a quiet passage has to look like
     quiet, not like a track that failed to load. */
  .wave {
    display: flex;
    gap: 2px;
    height: 20px;
    margin-top: 2px;
    padding: 2px;
    align-items: flex-end;
    background: color-mix(in srgb, var(--accent) 7%, transparent);
    border-radius: var(--r-sm, 7px);
  }
  /* What stands in for the frames the strip has not built: the width they
     would have taken, so the scrollbar is the length it always was. */
  .gap {
    flex: none;
  }
  .bar {
    flex: none;
    display: flex;
    gap: 1px;
    align-items: flex-end;
    height: 100%;
  }
  .bar > span {
    flex: 1;
    background: var(--accent);
    opacity: 0.6;
    border-radius: 1px;
  }

  /* Phone: a shorter timeline and no room for a wide layer column. */
  @media (max-width: 40rem) {
    .layer-col {
      width: 7.5rem;
    }
  }
</style>

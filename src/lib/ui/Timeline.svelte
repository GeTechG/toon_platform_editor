<script lang="ts">
  // Two shapes, one component. The `bar` layout keeps the single strip of
  // frames the editor always had; the `studio` layout is the reference
  // toonio.ru timeline (`Timeline` in toonio.bundle.js:8645): the shared layer
  // list on the left and a layer-by-frame grid of cell thumbnails on the
  // right, filling whatever height the resizable bottom panel gives it.
  import type { EditorState } from './editor-state.svelte';
  import FrameThumb from './FrameThumb.svelte';
  import LayerRows from './LayerRows.svelte';
  import LayerThumb from './LayerThumb.svelte';
  import Icon from './Icon.svelte';

  let { editor }: { editor: EditorState } = $props();

  const studio = $derived(editor.ux.layout === 'studio');

  let strip = $state<HTMLDivElement | undefined>();
  let scrollLeft = $state(0);
  let scrollWidth = $state(0);
  let clientWidth = $state(0);

  // Native overflow-x already scrolls (wheel/trackpad/touch); the arrows are
  // for mouse users on desktop, so they only light up when there's overflow.
  const canLeft = $derived(scrollLeft > 1);
  const canRight = $derived(scrollLeft < scrollWidth - clientWidth - 1);

  function sync(): void {
    if (!strip) return;
    scrollLeft = strip.scrollLeft;
    scrollWidth = strip.scrollWidth;
    clientWidth = strip.clientWidth;
  }

  function nudge(dir: 1 | -1): void {
    strip?.scrollBy({ left: dir * clientWidth * 0.8, behavior: 'smooth' });
  }

  // Recompute reachability whenever the frame count or the strip width changes.
  $effect(() => {
    void editor.doc.layers[0].frames.length;
    void clientWidth;
    sync();
  });

  // Keep the active frame in view (the reference list re-centers on it):
  // after add/delete/paste/hotkeys the strip scrolls just enough to show it.
  // Not during playback — the strip stays put while frames flip.
  $effect(() => {
    const index = editor.activeFrame;
    void editor.doc.layers[0].frames.length;
    if (editor.playing || !strip) return;
    const el = strip.querySelector(`[data-frame="${index}"]`) ?? strip.children[index];
    (el as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  // --- Studio grid ----------------------------------------------------------
  const frames = $derived(editor.doc.layers[0].frames);
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
    if (e.pointerType === 'touch' || !e.isPrimary || e.shiftKey || e.ctrlKey || e.metaKey) {
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

  // --- Soundtrack -----------------------------------------------------------
  // The reference's wave: half a bar per pixel of frame width, recomputed when
  // fps changes — the wave stretches over the strip rather than being re-read
  // from the file.
  const barsPerFrame = (cellWidth: number) => Math.max(1, Math.round(cellWidth / 2));
  // Bar-layout frames are as wide as their thumbnail (FrameThumb's 32px tall
  // canvas at the document's aspect) plus the 1px border on each side.
  const thumbWidth = $derived(Math.round(32 * (editor.doc.width / editor.doc.height)) + 2);

</script>

{#snippet wave(cellWidth: number)}
  {#if editor.audio.hasTrack}
    {@const per = barsPerFrame(cellWidth)}
    {@const bars = editor.audio.bars(editor.doc.frame_rate, per)}
    <!-- Decoration: the note key's panel carries the track's name, its length
         and the controls. The lane is drawn even where the track is silent, so
         an empty stretch reads as "quiet here", not as a missing waveform. -->
    <div class="wave" aria-hidden="true">
      {#each frames as _, i (i)}
        <span class="bar" style:width="{cellWidth}px">
          {#each { length: per } as _, k (k)}
            <span style:height="{Math.max(6, Math.round((bars[i * per + k] ?? 0) * 100))}%"></span>
          {/each}
        </span>
      {/each}
    </div>
  {/if}
{/snippet}


<!-- The release may land anywhere — outside the grid, outside the window —
     so the drag always ends on the window rather than on a cell. -->
<svelte:window onpointerup={endCellDrag} onpointercancel={endCellDrag} />

{#if studio}
  <!-- The bottom panel owns the height; the timeline fills the row it is given. -->
  <div class="studio">
    <div class="body">
      <div class="layer-col">
        <LayerRows {editor} compact />
      </div>

      <!-- The press-to-deselect is a mouse convenience on top of the cells,
           which are ordinary buttons: nothing here is keyboard-only reachable
           through the container, so it stays a labelled group. -->
      <div
        class="grid"
        role="group"
        aria-label="Кадры и слои"
        bind:this={strip}
        bind:clientWidth
        onscroll={sync}
        onpointerdown={resetSelection}
      >
        <div class="head">
          {#each frames as _, i (i)}
            <span
              class="num"
              class:onion={onionFrames.includes(i)}
              class:copied={editor.copiedFrom?.frames.includes(i)}
              title={onionFrames.includes(i) ? `Кадр ${i + 1} — на кальке` : `Кадр ${i + 1}`}
            >{i + 1}</span>
          {/each}
        </div>
        {#each rows as layerIndex (editor.doc.layers[layerIndex])}
          <div class="cells">
            {#each frames as _, i (i)}
              <button
                class="cell"
                class:active={i === editor.displayedFrame && layerIndex === editor.activeLayer}
                class:selected={isSelected(i, layerIndex)}
                class:copied={editor.isCopiedCell(i, layerIndex)}
                class:dim={editor.doc.layers[layerIndex].hidden}
                data-frame={i}
                disabled={editor.playing}
                aria-current={i === editor.displayedFrame && layerIndex === editor.activeLayer
                  ? 'true'
                  : undefined}
                onclick={(e) => onCellClick(e, i, layerIndex)}
                onpointerdown={(e) => onCellDown(e, i, layerIndex)}
                onpointerenter={(e) => onCellEnter(e, i, layerIndex)}
                title="Кадр {i + 1}, слой {editor.doc.layers.length - layerIndex}"
                aria-label="Кадр {i + 1}, слой {editor.doc.layers.length - layerIndex}"
              >
                <LayerThumb doc={editor.doc} {layerIndex} frameIndex={i} height={28} />
              </button>
            {/each}
          </div>
        {/each}
        {@render wave(46)}
      </div>
    </div>
  </div>
{:else}
  <div class="scroller">
    <button
      class="key icon arrow"
      disabled={!canLeft}
      onclick={() => nudge(-1)}
      aria-label="Прокрутить кадры влево"
      title="Прокрутить кадры влево"
    >
      <Icon name="chevron-left" size={18} />
    </button>

    <div class="frames" bind:this={strip} bind:clientWidth onscroll={sync}>
      <div class="row">
      {#each editor.doc.layers[0].frames as frame, i (frame)}
        <button
          class="frame"
          class:active={i === editor.displayedFrame}
          data-frame={i}
          disabled={editor.playing}
          onclick={() => editor.selectFrame(i)}
          title="Кадр {i + 1}"
          aria-label="Кадр {i + 1}"
        >
          <FrameThumb doc={editor.doc} frameIndex={i} />
          <span class="num">{i + 1}</span>
        </button>
      {/each}
      </div>
      {@render wave(thumbWidth)}
    </div>

    <button
      class="key icon arrow"
      disabled={!canRight}
      onclick={() => nudge(1)}
      aria-label="Прокрутить кадры вправо"
      title="Прокрутить кадры вправо"
    >
      <Icon name="chevron-right" size={18} />
    </button>
  </div>
{/if}

<style>
  .scroller {
    display: flex;
    align-items: stretch;
    gap: 0.3rem;
    min-width: 0;
  }
  .arrow {
    flex: none;
    height: auto;
  }
  .frames {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    overflow-x: auto;
    scrollbar-width: thin;
    background: var(--canvas);
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    padding: 3px;
  }
  .row {
    display: flex;
    gap: 2px;
  }
  .frame {
    position: relative;
    flex: none;
    /* Tap floor: the thumbnail stays 32px tall, the button around it does not. */
    min-height: var(--key-h);
    padding: 0;
    border: 1px solid var(--hairline);
    border-radius: 5px;
    overflow: hidden;
    background: var(--canvas);
    cursor: pointer;
  }
  .frame.active {
    border-color: var(--electric);
    box-shadow: inset 0 0 0 1px var(--electric);
  }
  .frame .num {
    position: absolute;
    top: 1px;
    right: 2px;
    font-size: 0.6rem;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: var(--electric);
  }
  .frame:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* --- Studio grid -------------------------------------------------------- */
  .studio {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    background: var(--canvas);
    overflow: hidden;
  }
  .layer-col {
    display: flex;
    flex-direction: column;
    flex: none;
    width: 11rem;
    min-height: 0;
    border-right: 1px solid var(--hairline);
  }
  .grid {
    flex: 1;
    min-width: 0;
    overflow: auto;
    scrollbar-width: thin;
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
    width: 46px;
    text-align: center;
    font-size: 0.6rem;
    line-height: 32px;
    font-variant-numeric: tabular-nums;
    color: var(--ink-muted, #6b7280);
  }
  /* Onion and copied frames are named in the header, not only tinted. */
  .num.onion {
    color: var(--electric);
    text-decoration: underline dotted;
  }
  .num.copied::after {
    content: '⧉';
    margin-left: 1px;
  }
  .cells {
    display: flex;
    gap: 2px;
    height: 44px;
    padding: 2px;
    align-items: center;
  }
  .cell {
    flex: none;
    box-sizing: border-box;
    width: 46px;
    height: 100%;
    display: grid;
    place-items: center;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--hairline);
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
    border-color: var(--electric, #2f5bff);
    background: color-mix(in srgb, var(--electric, #2f5bff) 10%, transparent);
  }
  .cell.copied {
    border-style: dotted;
  }
  .cell.active {
    border-style: solid;
    border-color: var(--electric, #2f5bff);
    box-shadow: inset 0 0 0 2px var(--electric, #2f5bff);
  }
  .cell:focus-visible {
    outline: 2px solid var(--electric, #2f5bff);
    outline-offset: 1px;
  }
  .cell:disabled {
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
    background: color-mix(in srgb, var(--electric, #2f5bff) 7%, transparent);
    border-radius: var(--r-sm, 5px);
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
    background: var(--electric, #2f5bff);
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

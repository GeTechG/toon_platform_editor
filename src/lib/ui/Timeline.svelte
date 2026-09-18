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

  function isCopied(frame: number, layer: number): boolean {
    const from = editor.copiedFrom;
    return from !== null && from.frames.includes(frame) && from.layers.includes(layer);
  }

  function onCellClick(e: MouseEvent, frame: number, layer: number): void {
    const mode = e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'set';
    editor.selectCell(frame, layer, mode);
  }

  // --- Soundtrack -----------------------------------------------------------
  // One bar per frame, recomputed when fps changes — the wave stretches over
  // the strip rather than being re-read from the file.
  const peaks = $derived(editor.audio.peaks(editor.doc.frame_rate));
  // Bar-layout frames are as wide as their thumbnail (FrameThumb's 32px tall
  // canvas at the document's aspect) plus the 1px border on each side.
  const thumbWidth = $derived(Math.round(32 * (editor.doc.width / editor.doc.height)) + 2);

  let picker = $state<HTMLInputElement | undefined>();

  async function pickTrack(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // picking the same file twice must fire change again
    if (file) {
      await editor.audio.load(file, file.name.replace(/\.[^.]+$/, ''), editor.audio.author);
    }
  }

  function removeTrack(): void {
    if (!editor.warnings || confirm('Убрать звук? Отменить это будет нельзя.')) {
      editor.audio.clear();
    }
  }

  /** `м:сс` — the only shape a length under an hour needs. */
  function clock(seconds: number): string {
    const whole = Math.max(0, Math.round(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }

  const filmSeconds = $derived(frames.length / editor.doc.frame_rate);
  // One bar per frame means the strip only ever shows the part of the track
  // the animation is long enough to reach. Saying both lengths out loud is
  // what keeps a flat lane from reading as a broken waveform.
  const trackOutruns = $derived(editor.audio.duration - filmSeconds > 1);
</script>

{#snippet wave(cellWidth: number)}
  {#if editor.audio.hasTrack}
    <!-- Decoration: the track's name, length and controls carry the meaning.
         The lane is drawn even where the track is silent, so an empty stretch
         reads as "quiet here" rather than as a missing waveform. -->
    <div class="wave" aria-hidden="true">
      {#each frames as _, i (i)}
        <span class="bar" style:width="{cellWidth}px">
          <span style:height="{Math.max(6, Math.round((peaks[i] ?? 0) * 100))}%"></span>
        </span>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet trackControls()}
  <div class="audio">
    <input
      type="file"
      accept="audio/mpeg,audio/ogg,audio/wav,.mp3,.ogg,.wav"
      bind:this={picker}
      onchange={pickTrack}
      hidden
    />
    <button
      class="key icon"
      onclick={() => picker?.click()}
      title={editor.audio.hasTrack ? 'Заменить звук' : 'Добавить звук (mp3, ogg, wav)'}
      aria-label={editor.audio.hasTrack ? 'Заменить звук' : 'Добавить звук'}
    >
      <Icon name="note" size={18} />
    </button>
    {#if editor.audio.hasTrack}
      <!-- The credits are metadata, not a form to fill in: they read as text
           until the pointer or the keyboard arrives, and they never grow wider
           than a title needs — two fields stretched across a studio-width
           panel was the whole problem. -->
      <span class="credits">
        <input class="meta" bind:value={editor.audio.name} placeholder="Без названия" aria-label="Название трека" />
        <input class="meta by" bind:value={editor.audio.author} placeholder="автор" aria-label="Автор трека" />
      </span>
      <span class="len lengths" title={trackOutruns ? 'Трек длиннее мультика — на ленте видно только его начало' : 'Длина мультика и трека'}>
        {clock(filmSeconds)}<span class="of">/</span>{clock(editor.audio.duration)}
      </span>
      <button class="key icon" onclick={removeTrack} title="Убрать звук" aria-label="Убрать звук">
        <Icon name="trash" size={16} />
      </button>
    {:else}
      <span class="len">Звук: mp3, ogg или wav</span>
    {/if}
    {#if editor.audio.error}
      <span class="audio-error" role="alert">{editor.audio.error}</span>
    {/if}
  </div>
{/snippet}

{#if studio}
  <!-- The bottom panel owns the height; the timeline fills the row it is given. -->
  <div class="studio">
    <div class="body">
      <div class="layer-col">
        <LayerRows {editor} compact />
      </div>

      <div class="grid" bind:this={strip} bind:clientWidth onscroll={sync}>
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
                class:copied={isCopied(i, layerIndex)}
                class:dim={editor.doc.layers[layerIndex].hidden}
                data-frame={i}
                disabled={editor.playing}
                aria-current={i === editor.displayedFrame && layerIndex === editor.activeLayer
                  ? 'true'
                  : undefined}
                onclick={(e) => onCellClick(e, i, layerIndex)}
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
    {@render trackControls()}
  </div>
{:else}
  <!-- One flex item, not two: the bar layout drops the timeline into a row
       beside undo/add/delete, so the strip and its track row have to travel
       together as a single column. -->
  <div class="bar-layout">
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
  {@render trackControls()}
  </div>
{/if}

<style>
  .bar-layout {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
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
    align-items: flex-end;
    height: 100%;
  }
  .bar > span {
    width: 100%;
    background: var(--electric, #2f5bff);
    opacity: 0.6;
    border-radius: 1px;
  }

  /* The track strip: a note key, the credits, the two lengths, the bin. It
     sits at its natural width — nothing here stretches to fill a panel. */
  .audio {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding-top: 0.35rem;
    min-width: 0;
  }
  .credits {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    min-width: 0;
    flex: 0 1 auto;
  }
  /* Reads as text, becomes a field on hover or focus: the credits are two
     words about the track, not a form standing open beside the timeline. */
  .meta {
    min-width: 0;
    width: 9rem;
    max-width: 22vw;
    height: var(--key-h);
    padding: 0 0.35rem;
    font: inherit;
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--ink);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--r-sm, 5px);
    text-overflow: ellipsis;
  }
  .meta.by {
    width: 7rem;
    font-weight: 400;
    color: var(--ink-2, #555);
  }
  .meta:hover {
    border-color: var(--hairline);
  }
  .meta:focus {
    background: var(--canvas);
    border-color: var(--electric, #2f5bff);
    outline: none;
  }
  .len {
    flex: none;
    font-size: 0.78rem;
    color: var(--ink-2, #555);
    white-space: nowrap;
  }
  /* Not `.tnum`: app.css styles that name globally and the editor is embedded
     in it (see the class-collision test in apps/web). */
  .lengths {
    font-variant-numeric: tabular-nums;
  }
  .of {
    padding: 0 0.15rem;
    opacity: 0.55;
  }
  /* DESIGN's Signal Rule reserves red for the "draw" action — errors stay ink. */
  .audio-error {
    min-width: 0;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--ink);
  }

  /* Phone: a shorter timeline and no room for a wide layer column. */
  @media (max-width: 40rem) {
    .layer-col {
      width: 7.5rem;
    }
  }
</style>

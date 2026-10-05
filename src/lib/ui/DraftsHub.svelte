<script lang="ts">
  /**
   * The drafts hub: what the studio opens on when there are drafts — every
   * local save as a card, and the choice of a sheet for a new drawing. It
   * stands in place of the studio, inside its box, not over the screen
   * (owner, 2026-10-05); Procreate Dreams' Theater is the compass, laid out
   * for a cursor on a wide screen and as Dreams has it under a finger.
   *
   * The hub is the view: what is picked, which screen is up, the sheet being
   * put together. The drafts themselves, and everything that reads or writes
   * storage or replaces the drawing, stay with the editor and come in as
   * calls.
   */
  import { onMount, tick, untrack } from 'svelte';
  import type { EditorState } from './editor-state.svelte';
  import type { DraftEntry } from '../draft/restore';
  import FrameThumb from './FrameThumb.svelte';
  import Icon from './Icon.svelte';
  import { draftSizeClass, formatFileSize } from './file-size';
  import { fitThumb } from './thumb-size';
  import { sheetAbout, sheetChoices, sheetName, sheetOf, sheetProportions, sheetSizes, sheetValue } from './sheet-size';
  import { fpsFromField } from './frame-selection';
  import { dateLocale, t } from '../i18n';

  let {
    editor,
    compact,
    drafts,
    thumbUrls,
    storageUsed,
    draftId,
    create = false,
    ready,
    onOpen,
    onCopy,
    onDownload,
    onRemove,
    onRemoveAll,
    onSheet,
    onClose,
  }: {
    editor: EditorState;
    /** The studio is on a small screen's layout. */
    compact: boolean;
    drafts: DraftEntry[];
    /** Object URLs of the cards' stills, by draft id. */
    thumbUrls: Record<string, string>;
    storageUsed: number;
    /** The draft behind the drawing on the canvas. */
    draftId: string;
    /** Open on the choice of a sheet, past the drafts. */
    create?: boolean;
    /** The drafts have been read: until then the hub cannot know its view. */
    ready: boolean;
    onOpen: (entry: DraftEntry) => void;
    onCopy: (ids: string[]) => Promise<void>;
    onDownload: (ids: string[]) => Promise<void>;
    /** Both say whether the drafts were deleted, so the focus can be placed. */
    onRemove: (ids: string[]) => Promise<boolean>;
    onRemoveAll: () => Promise<boolean>;
    /** Says whether the sheet was started; the hub closes on a yes. */
    onSheet: (value: string, fps: number) => Promise<boolean>;
    onClose: () => void;
  } = $props();

  let dialogEl = $state<HTMLDialogElement | undefined>();
  /** close(), not unmounting: an unmounted open dialog drops focus on <body>. */
  export function close(): void {
    dialogEl?.close();
  }

  // The hub is not modal: the page around the studio — the site's header —
  // stays alive. What `showModal()` gave is done by hand: the studio under it
  // goes inert.
  $effect(() => {
    const hub = dialogEl;
    if (!hub) {
      return;
    }
    hub.show();
    const rest = [...(hub.parentElement?.children ?? [])].filter((child): child is HTMLElement => child !== hub && child instanceof HTMLElement && !child.inert);
    for (const child of rest) {
      child.inert = true;
    }
    return () => {
      for (const child of rest) {
        child.inert = false;
      }
    };
  });

  // «Выбрать»: the cards are picked instead of opened, and the keys in the
  // head act on the pick.
  let selecting = $state(false);
  let picked = $state.raw<string[]>([]);
  const choosing = $derived(selecting || picked.length > 0);
  // The hub left over a clean sheet: it shows the sheets a drawing can start
  // on — a proportion, a size and the side it lies on.
  // The host asked for a new drawing: the sheets, from the first frame.
  let creating = $state(untrack(() => create));
  // Otherwise the view waits for the drafts to be read — the paper only, not
  // a view it may have to take back. With none there is nothing to show but
  // the sheets (owner, 2026-10-05); with some, the drafts.
  let settled = $state(untrack(() => create));
  $effect(() => {
    if (ready && !settled) {
      settled = true;
      void untrack(async () => {
        if (drafts.length === 0) {
          await showCreate(true);
          return;
        }
        // The view came after the hub was shown: the focus goes into it.
        await tick();
        // Not the first button: «Выбрать» is not drawn under a cursor.
        dialogEl?.querySelector<HTMLElement>('.draft-open, .hub-new')?.focus();
      });
    }
  });
  let newProportion = $state('16:9');
  let newSize = $state('720p');
  let newStanding = $state(false);
  // The frame rate is chosen where the resolution is (owner, 2026-10-05).
  let newFps = $state(untrack(() => editor.ux.defaultFps));
  function onNewFps(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    // A field left empty keeps the rate, as the one on the bar does.
    newFps = fpsFromField(input.value, newFps, editor.ux.fpsRange);
    input.value = String(newFps);
  }
  const newChoice = $derived(sheetOf(newProportion, newSize, newStanding));
  // Under a finger and on a small screen the hub is laid out as Dreams'
  // Theater is; under a cursor on a wide one, as a desktop editor's.
  let coarse = $state(false);
  onMount(() => {
    coarse = matchMedia('(hover: none)').matches;
    // The sheet the drawing has, and the focus, as «Новый мульт» takes them.
    if (creating) {
      void showCreate(true);
    }
  });
  const touchHub = $derived(compact || coarse);
  let reelEl = $state<HTMLDivElement | undefined>();
  // The chip's menu of sizes — the studio's own, not the browser's list
  // (owner, 2026-10-05). It stands at the hub's level: the reel scrolls and
  // its cards are containers, so a menu inside one would be cut.
  // The same window holds the frame rate instead, opened from the three dots
  // in the card's corner (`more`; owner, 2026-10-05).
  let sizeMenu = $state<{ x: number; y: number; from: HTMLElement; more: boolean } | null>(null);
  let sizeMenuEl = $state<HTMLDivElement | undefined>();
  async function openSizeMenu(from: HTMLElement, proportion: string, more = false): Promise<void> {
    const hub = dialogEl;
    if (!hub) {
      return;
    }
    newProportion = proportion;
    const chip = from.getBoundingClientRect();
    const box = hub.getBoundingClientRect();
    sizeMenu = { x: chip.left - box.left, y: chip.bottom - box.top + 6, from, more };
    await tick();
    if (!sizeMenuEl) {
      return;
    }
    // Under the chip where there is room; otherwise as near as the hub lets.
    sizeMenu = {
      from,
      more,
      x: Math.min(sizeMenu.x, Math.max(8, box.width - sizeMenuEl.offsetWidth - 8)),
      y: Math.min(sizeMenu.y, Math.max(8, box.height - sizeMenuEl.offsetHeight - 8)),
    };
    sizeMenuEl.querySelector<HTMLElement>('[aria-checked="true"], input')?.focus();
  }
  function closeSizeMenu(): void {
    const from = sizeMenu?.from;
    sizeMenu = null;
    from?.focus();
  }
  function pickSize(size: string): void {
    newSize = size;
    closeSizeMenu();
  }
  function sizeMenuKeys(e: KeyboardEvent): void {
    const items = [...(sizeMenuEl?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    // The sizes are one stop, the two fields of the rate one each; Tab past
    // either end puts the menu away.
    const stops: (HTMLElement | undefined)[] = [at < 0 ? items[0] : items[at], ...(sizeMenuEl?.querySelectorAll<HTMLInputElement>('input') ?? [])];
    const next = e.key === 'Tab' ? stops[stops.indexOf(document.activeElement as HTMLElement) + (e.shiftKey ? -1 : 1)] : undefined;
    if (e.key === 'Tab' && next) {
      e.preventDefault();
      next.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      // Esc is the menu's here, not the hub's.
      e.preventDefault();
      e.stopPropagation();
      closeSizeMenu();
    } else if (e.target instanceof HTMLInputElement) {
      // The arrows are the field's own: they change the rate.
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }
  }
  /** The reel was swiped: the card that is up is the proportion picked. */
  function onReel(): void {
    sizeMenu = null;
    if (reelEl) {
      newProportion = sheetProportions()[Math.round(reelEl.scrollTop / reelEl.clientHeight)] ?? newProportion;
    }
  }


  // A draft gone from the list is not left picked.
  $effect(() => {
    if (picked.some((id) => !drafts.some((d) => d.id === id))) {
      picked = picked.filter((id) => drafts.some((d) => d.id === id));
    }
  });

  function pick(entry: DraftEntry): void {
    picked = picked.includes(entry.id) ? picked.filter((id) => id !== entry.id) : [...picked, entry.id];
  }
  const openDraft = (entry: DraftEntry) => onOpen(entry);
  const copyPicked = () => onCopy(picked);
  const downloadPicked = () => onDownload(picked);

  /**
   * A deleted card takes its pressed key with it, and the focus would fall to
   * the page. It goes to the card that took the place, the one before when
   * the last went, or «Новый мульт» when none is left.
   */
  async function refocus(at: number): Promise<void> {
    await tick();
    const cards = dialogEl?.querySelectorAll<HTMLButtonElement>('.draft-open:not(.hub-new)') ?? [];
    (cards[Math.min(at, cards.length - 1)] ?? dialogEl?.querySelector<HTMLButtonElement>('.hub-new'))?.focus();
  }
  async function removePicked(): Promise<void> {
    const at = drafts.findIndex((d) => picked.includes(d.id));
    if (await onRemove(picked)) {
      await refocus(at);
    }
  }
  async function removeAllDrafts(): Promise<void> {
    if (await onRemoveAll()) {
      await refocus(0);
    }
  }

  /**
   * The hub swaps the drafts for the sheets and back. The key pressed goes
   * with its view, so the focus is handed to the first card of the other.
   */
  async function showCreate(on: boolean): Promise<void> {
    const now = sheetChoices().find((sheet) => sheet.value === sheetValue(editor.doc));
    if (on && now) {
      newProportion = now.proportion;
      newSize = now.name;
      newStanding = now.standing;
    }
    creating = on;
    selecting = false;
    picked = [];
    await tick();
    reelEl?.scrollTo({ top: sheetProportions().indexOf(newProportion) * reelEl.clientHeight });
    dialogEl?.querySelector<HTMLElement>('.draft-open, .reel .reel-size, .hub-new')?.focus();
  }

  /**
   * Esc and the close key: over a clean sheet the way out of the hub is a
   * new drawing, and the sheet is asked for; over a drawing it is the way
   * back to it.
   */
  function leaveHub(): void {
    if (!creating && editor.sheetOpen) {
      void showCreate(true);
    } else {
      dialogEl?.close();
    }
  }

  /** «Рисовать»: the editor starts the sheet; the hub closes when it did. */
  async function pickSheet(value: string): Promise<void> {
    if (await onSheet(value, newFps)) {
      dialogEl?.close();
    }
  }
</script>

{#snippet fpsField()}
  <label class="sheet-fps">
    <span class="hub-hint">{t('editor.fps')}</span>
    <input
      type="range"
      min={editor.ux.fpsRange[0]}
      max={editor.ux.fpsRange[1]}
      value={newFps}
      oninput={onNewFps}
    />
    <input
      type="number"
      min={editor.ux.fpsRange[0]}
      max={editor.ux.fpsRange[1]}
      value={newFps}
      onchange={onNewFps}
      aria-label={t('editor.fps')}
    />
  </label>
{/snippet}

<dialog
  bind:this={dialogEl}
  class="hub"
  class:touch={touchHub}
  aria-label={creating ? t('editor.new_sheet') : t('editor.drafts')}
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      leaveHub();
    }
  }}
  onclose={onClose}
>
  {#if creating}
    <!-- The second view (Dreams' «Create new movie»): a card is a
         proportion, drawn as the sheet would lie; the resolution and the
         side stand beside. -->
    <header class="hub-head">
      <span class="hub-title">
        {#if !touchHub}
          <button class="key icon" onclick={() => showCreate(false)} title={t('editor.back_to_drafts')} aria-label={t('editor.back_to_drafts')}>
            <Icon name="arrow-left" />
          </button>
        {/if}
        <h2>{t('editor.new_sheet')}</h2>
      </span>
      {#if touchHub}
        <button class="key" onclick={() => showCreate(false)}>{t('transform.cancel')}</button>
      {/if}
    </header>
    {#if touchHub}
    <!-- Dreams' «Create new movie» as it is: one card a screen, swiped up
         and down, dots beside. The card is the sheet — a plate in its
         proportion — with the size as a chip, the name and the way on. -->
    <div class="hub-body reel" bind:this={reelEl} onscroll={onReel}>
      {#each sheetProportions() as proportion (proportion)}
        {@const shape = sheetOf(proportion, newSize, newStanding)}
        <section class="reel-card" aria-label={sheetName(shape.ratio)} inert={proportion !== newProportion}>
          <div class="reel-plate" class:beside={shape.width < shape.height} style:--r={shape.width / shape.height}>
            <div class="reel-words">
            <p class="reel-name">
              <button
                class="reel-size"
                aria-haspopup="menu"
                aria-expanded={sizeMenu !== null && !sizeMenu.more && proportion === newProportion}
                aria-label={t('sheet.size_chip', { size: newSize })}
                onclick={(e) => openSizeMenu(e.currentTarget, proportion)}
              >{newSize}</button>
              <!-- Three dots in the card's corner (owner, 2026-10-05): the
                   frame rate. Beside a bare sheet they keep a corner too —
                   never the middle of the line. -->
              <button
                class="reel-more"
                aria-expanded={sizeMenu !== null && sizeMenu.more && proportion === newProportion}
                title={t('editor.fps')}
                aria-label={t('editor.fps')}
                onclick={(e) => openSizeMenu(e.currentTarget, proportion, true)}
              >
                <Icon name="more" />
              </button>
              <strong>{sheetName(shape.ratio)}</strong>
            </p>
            <p class="reel-about">{sheetAbout(shape.ratio)}</p>
            <button class="key primary" onclick={() => pickSheet(shape.value)}>{t('sheet.start')}</button>
            </div>
          </div>
        </section>
      {/each}
    </div>
    <div class="reel-dots" aria-hidden="true">
      {#each sheetProportions() as proportion (proportion)}
        <span class:on={proportion === newProportion}></span>
      {/each}
    </div>
    <label class="sheet-stand reel-stand">
      <input type="checkbox" bind:checked={newStanding} disabled={newProportion === '1:1'} />
      {t('sheet.standing')}
    </label>
    {#if sizeMenu}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="size-scrim" onclick={closeSizeMenu}></div>
      <div
        class="size-menu"
        role={sizeMenu.more ? 'group' : 'menu'}
        tabindex="-1"
        aria-label={sizeMenu.more ? t('editor.fps') : t('export.resolution')}
        bind:this={sizeMenuEl}
        style:left="{sizeMenu.x}px"
        style:top="{sizeMenu.y}px"
        onkeydown={sizeMenuKeys}
      >
        {#if sizeMenu.more}
          {@render fpsField()}
        {:else}
          {#each sheetSizes() as size (size)}
            {@const sheet = sheetOf(newProportion, size, newStanding)}
            <button role="menuitemradio" aria-checked={size === newSize} onclick={() => pickSize(size)}>
              <span>{size}</span>
              <small>{sheet.width}×{sheet.height}</small>
            </button>
          {/each}
        {/if}
      </div>
    {/if}
    {:else}
    <div class="hub-body sheet-new">
      <ul class="drafts">
        {#each sheetProportions() as proportion (proportion)}
          {@const shape = sheetOf(proportion, newSize, newStanding)}
          <li class="draft">
            <button
              class="draft-open"
              class:picked={proportion === newProportion}
              aria-pressed={proportion === newProportion}
              onclick={() => (newProportion = proportion)}
            >
              <span class="draft-thumb sheet-shape">
                <span style:aspect-ratio="{shape.width} / {shape.height}"></span>
              </span>
              <span class="draft-meta">
                <span class="draft-date">{sheetName(shape.ratio)}</span>
                <span class="draft-size">{shape.ratio} · {shape.width}×{shape.height}</span>
                <span class="draft-size">{sheetAbout(shape.ratio)}</span>
              </span>
            </button>
          </li>
        {/each}
      </ul>
      <div class="sheet-side">
        <p class="hub-hint" id="sheet-res">{t('export.resolution')}</p>
        <div class="sheet-sizes" role="group" aria-labelledby="sheet-res">
          {#each sheetSizes() as size (size)}
            {@const sheet = sheetOf(newProportion, size, newStanding)}
            <button class="key" class:active={size === newSize} aria-pressed={size === newSize} onclick={() => (newSize = size)}>
              <span>{size}</span>
              <small>{sheet.width}×{sheet.height}</small>
            </button>
          {/each}
        </div>
        {@render fpsField()}
        <label class="sheet-stand">
          <input type="checkbox" bind:checked={newStanding} disabled={newProportion === '1:1'} />
          {t('sheet.standing')}
        </label>
        <button class="key primary" onclick={() => pickSheet(newChoice.value)}>{t('sheet.start')}</button>
      </div>
    </div>
    {/if}
  {:else if settled}
  <header class="hub-head">
    <h2>{t('editor.drafts')}</h2>
    <span class="hub-keys">
      {#if choosing}
        <button class="key icon" onclick={copyPicked} disabled={picked.length === 0} title={t('editor.draft_copy_title')} aria-label={t('editor.draft_copy')}>
          <Icon name="copy" />
        </button>
        <button class="key icon" onclick={downloadPicked} disabled={picked.length === 0} title={t('editor.draft_download_title')} aria-label={t('editor.draft_download')}>
          <Icon name="download" />
        </button>
        <button class="key icon" onclick={removePicked} disabled={picked.length === 0} title={t('editor.draft_delete_title')} aria-label={t('editor.draft_delete')}>
          <Icon name="trash" />
        </button>
        <button class="key" onclick={removeAllDrafts}>{t('editor.drafts_wipe')}</button>
        <button class="key active" onclick={() => { selecting = false; picked = []; }}>{t('editor.done')}</button>
      {:else}
        {#if drafts.length > 0}
          <button class="key hub-select" onclick={() => (selecting = true)}>{t('editor.drafts_select')}</button>
        {/if}
        {#if touchHub}
          <button class="key primary icon hub-new" onclick={() => showCreate(true)} title={t('editor.create')} aria-label={t('editor.create')}>
            <Icon name="plus" />
          </button>
        {/if}
        <!-- Over a clean sheet «+» is the only way on: nothing to close to. -->
        {#if !editor.sheetOpen}
          <button class="key icon hub-close" onclick={leaveHub} title={t('editor.close')} aria-label={t('editor.close')}>
            <Icon name="x" />
          </button>
        {/if}
      {/if}
    </span>
  </header>

  <div class="hub-body">
    <!-- One region for the count and the empty list alike: deleting the
         last draft swapped the counting region out and was not heard. -->
    <div class="drafts-said" aria-live="polite">
      {#if drafts.length === 0}
        <p class="empty">{t('editor.drafts_empty')}</p>
      {:else}
        <p class="hub-hint">
          {t('draft.count', { count: drafts.length })}{t('editor.on_this_device')}
          {#if storageUsed}{t('editor.storage_used', { size: formatFileSize(storageUsed) })}{/if}
          {#if choosing}· {t('editor.drafts_picked', { count: picked.length })}{/if}
        </p>
      {/if}
    </div>
      <ul class="drafts" class:choosing>
        {#if !touchHub}
        <li class="draft">
          <button class="draft-open hub-new" onclick={() => showCreate(true)}>
            <span class="draft-thumb new-thumb"><Icon name="plus" size={28} /></span>
            <span class="draft-meta">
              <span class="draft-date">{t('editor.new_sheet')}</span>
            </span>
          </button>
        </li>
        {/if}
        {#each drafts as entry (entry.id)}
          {@const box = fitThumb(entry.doc.width, entry.doc.height, 288, 162)}
          {@const date = new Date(entry.updated).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' })}
          <li class="draft">
            <button
              class="draft-open"
              class:picked={picked.includes(entry.id)}
              aria-pressed={choosing ? picked.includes(entry.id) : undefined}
              onclick={() => (choosing ? pick(entry) : openDraft(entry))}
            >
              <span class="draft-thumb">
                {#if thumbUrls[entry.id]}
                  <!-- The still written with the record: no document to
                       re-render, and it is what the drawing looked like. -->
                  <img src={thumbUrls[entry.id]} alt="" width={box.w} height={box.h} />
                {:else}
                  <FrameThumb doc={entry.doc} frameIndex={0} maxW={box.w} maxH={box.h} />
                {/if}
              </span>
              <span class="draft-meta">
                <span class="draft-date">{date}{#if entry.id === draftId}{` · ${t('draft.current')}`}{/if}</span>
                <span class="draft-size">
                  {t('draft.frames', { count: entry.doc.layers[0].frames.length })} ·
                  {t('draft.layers', { count: entry.doc.layers.length })}
                  {#if entry.bytes}
                    · <span class={draftSizeClass(entry.bytes)}>{formatFileSize(entry.bytes)}</span>
                  {/if}
                </span>
                {#if entry.audio}
                  <span class="draft-track">
                    <Icon name="note" size={13} />
                    {entry.audio.author ? t('draft.track_by', { author: entry.audio.author }) : ''}{entry.audio.name || t('editor.audio_unnamed')}
                  </span>
                {/if}
              </span>
            </button>
            <!-- Under a cursor a card is picked without «Выбрать»: the
                 box shows on hover, on focus and once anything is picked. -->
            <label class="draft-pick">
              <input
                type="checkbox"
                checked={picked.includes(entry.id)}
                onchange={() => pick(entry)}
                aria-label={t('editor.draft_pick', { date })}
              />
            </label>
          </li>
        {/each}
      </ul>
  </div>
  {/if}
</dialog>

<style>
  /* The hub stands in place of the studio — the editor's box and no more, not
     the screen (owner, 2026-10-05): the site's header stays in sight. No
     backdrop: it is not modal. */
  .hub {
    position: absolute;
    inset: 0;
    z-index: var(--z-sheet);
    display: flex;
    flex-direction: column;
    /* A <dialog> is `fit-content` both ways by the browser's sheet: one card
       made a strip of a window. */
    width: auto;
    height: auto;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: 0;
    /* Edge to edge on a phone lying down: its keys sat under the cutout. */
    padding-inline: env(safe-area-inset-left) env(safe-area-inset-right);
    border: none;
    background: var(--paper);
    /* It stands under the site's header, not over a page as a sheet does:
       the studio's ink-blue, not a sheet's black. */
    color: var(--text);
  }
  /* For a desktop too: a column in the middle, so nothing is a trip of the
     mouse across an empty screen; the hub scrolls as one, its bar at the edge. */
  .hub {
    overflow-y: auto;
  }
  .hub > * {
    box-sizing: border-box;
    width: 100%;
    max-width: 60rem;
    margin-inline: auto;
  }
  /* The keys by the title, over the cards they act on. */
  .hub-head {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 1rem;
    padding: 0.9rem 1rem 0.6rem;
  }
  /* The screen's name: the Card step of the scale (DESIGN §3). */
  .hub-head h2 {
    /* At 200 % text on a phone the name breaks rather than running under
       the keys. */
    min-width: 0;
    overflow-wrap: anywhere;
    margin: 0;
    font-size: 1.6rem;
    font-weight: 800;
    line-height: 1.15;
    letter-spacing: -0.02em;
  }
  .hub-hint {
    margin: 0.7rem 0 0.4rem;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-2);
  }
  .hub-body {
    flex: none;
    padding: 0.4rem 1rem 0.6rem;
    /* A long word at 200 % text breaks inside the hub instead of widening it. */
    overflow-wrap: anywhere;
    padding-bottom: max(1rem, env(safe-area-inset-bottom));
  }
  /* Under a finger and on a small screen — Dreams' Theater: the title on the
     left, the keys on the right, the words under the middle of a still. */
  .hub.touch .hub-head {
    justify-content: space-between;
  }
  .touch .draft-meta {
    align-items: center;
    text-align: center;
  }
  /* …and its «Create new movie»: a reel of cards, one a screen, swiped up and
     down. The hub does not scroll under it; the reel does. */
  .hub .reel {
    position: relative;
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    scroll-snap-type: y mandatory;
    overscroll-behavior: contain;
    padding-block: 0;
    scrollbar-width: none;
  }
  .reel-card {
    scroll-snap-align: center;
    scroll-snap-stop: always;
    /* The plate is sized against this page: as wide or as tall as it lets. */
    container-type: size;
    container-name: reel;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 0.5rem 2rem 0.5rem 1rem;
  }
  /* The card is the sheet, as Dreams draws it: a light plate in the sheet's
     own proportion. A sheet too narrow or too low for its words grows to
     hold them; there the proportion gives way. */
  .reel-plate {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: min(100cqw, calc(86cqh * var(--r)));
    aspect-ratio: var(--r);
    /* No floor written for the height: the automatic one is the content, so
       a sheet too low for its words grows to hold them. */
    min-width: min(100cqw, 14rem);
    /* A standing sheet on a phone lying down: widened to its floor, it must
       not grow past the page with its proportion. */
    max-height: 100cqh;
    padding: 1.9rem 0.75rem 0.6rem;
    border-radius: var(--r-xl);
    background: var(--canvas);
    /* The three dots stand in its corner. */
    position: relative;
  }
  /* The top right corner (owner, 2026-10-05). The key is a finger deep and
     its dots are drawn at the top of it; the plate's padding above keeps the
     sheet's name from running under them on a phone. */
  .reel-more {
    position: absolute;
    top: 0;
    right: 0;
    display: grid;
    place-items: start center;
    padding: 0.3rem 0 0;
    min-width: var(--key-h, 2.75rem);
    min-height: var(--key-h, 2.75rem);
    border: 0;
    border-radius: var(--r-pill);
    background: none;
    color: var(--text-2);
    cursor: pointer;
  }
  .reel-words {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }
  .reel-name {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 0.1rem 0.6rem;
    margin: 0;
    font-size: 1.6rem;
    line-height: 1.15;
    letter-spacing: -0.02em;
    text-align: center;
  }
  .reel-about {
    margin: 0;
    max-width: 22rem;
    font-size: 0.85rem;
    text-align: center;
    color: var(--text-2);
  }
  /* The chip: a pill of the studio's tone with the size, a finger of a
     target around it. Not Dreams' dark tile: ink is a ground on the Stage
     only (DESIGN §2). */
  .reel-size {
    position: relative;
    padding: 0.15rem 0.7rem;
    border: 0;
    border-radius: var(--r-pill);
    background: var(--sub);
    color: inherit;
    font: inherit;
    font-size: 1.14rem;
    font-weight: 750;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .reel-size::after {
    content: '';
    position: absolute;
    inset: 50% -0.4rem auto;
    height: var(--key-h, 2.75rem);
    transform: translateY(-50%);
  }
  /* Its menu: the chip opened out. No shadow and no ring (owner, 2026-10-05:
     «у нас минимализм») — it is told from the white card and from the paper
     by tone alone, the chip's own, a step under both; the size chosen is
     lifted to the canvas, as the picked half of a segmented control is.
     Global and heavier: the hub's column rule would stretch and centre both. */
  .hub > .size-scrim {
    position: absolute;
    inset: 0;
    max-width: none;
    margin: 0;
  }
  .hub > .size-menu {
    position: absolute;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 13.5rem;
    margin: 0;
    padding: 4px;
    border-radius: var(--r-md);
    background: var(--sub);
  }
  .size-menu button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-height: var(--key-h, 2.75rem);
    padding: 0 10px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .size-menu small {
    font-size: 0.8rem;
    font-weight: 400;
    font-variant-numeric: tabular-nums;
    color: var(--text-2);
  }
  .size-menu button[aria-checked='true'] {
    background: var(--canvas);
    color: var(--accent-ink);
  }
  @media (hover: hover) {
    .size-menu button:hover:not([aria-checked='true']) {
      background: var(--paper);
    }
  }
  .size-menu button:focus-visible {
    outline-offset: -3px;
  }
  .hub .reel-plate .key.primary {
    padding-inline: 1.6rem;
  }
  /* A phone lying down: the page is too low for a standing sheet to hold a
     chip and a key — every one came out the same squat plate. Where it does
     not fit, the sheet is drawn bare on the left, in its own proportion, as
     a sample, and the words stand beside it (owner, 2026-10-05). A lying
     sheet fits and stays a plate. */
  @container reel (max-height: 20rem) {
    .reel-plate.beside {
      flex-direction: row;
      gap: 1.25rem;
      container-type: normal;
      overflow: visible;
      width: auto;
      aspect-ratio: auto;
      min-width: 0;
      min-height: 0;
      padding: 0;
      border-radius: 0;
      background: none;
    }
    .reel-plate.beside::before {
      content: '';
      flex: none;
      width: min(50cqw, calc(92cqh * var(--r)));
      aspect-ratio: var(--r);
      border-radius: var(--r-lg);
      background: var(--canvas);
    }
    .beside .reel-words {
      max-width: 16rem;
    }
  }
  .reel-stand {
    flex: none;
    justify-content: center;
    padding-bottom: env(safe-area-inset-bottom);
  }
  /* Global and heavier: the hub's column rule would stretch and centre it. */
  .hub > .reel-dots {
    position: absolute;
    right: 0.6rem;
    top: 50%;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: auto;
    margin: 0;
    pointer-events: none;
  }
  /* The only sign that there are more cards: the edge (3.3:1 on the paper),
     not the hairline. */
  .reel-dots span {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background: var(--edge);
  }
  .reel-dots span.on {
    background: var(--accent);
  }
  .hub-title {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
  }
  /* «Выбрать» is the finger's way in; a cursor has the card's checkbox.
     Global and heavier: a scoped rule lost to the key's own `display`. */
  @media (hover: hover) {
    .hub .hub-keys .hub-select {
      display: none;
    }
  }
  .hub-keys {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.4rem;
  }
  /* One card per draft: the still, when it was saved, how big it is. */
  .drafts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(9.5rem, 100%), 1fr));
    gap: 1rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  @media (min-width: 40.0625rem) {
    .drafts {
      grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
      gap: 1.5rem;
    }
  }
  .draft {
    position: relative;
    display: flex;
    min-width: 0;
  }
  /* The card's checkbox: a finger of a target over the still's corner, seen
     under a cursor, on focus and once anything is picked; a finger with no
     cursor gets it from «Выбрать». Unseen, it takes no press. */
  .draft-pick {
    position: absolute;
    top: 0.4rem;
    left: 0.4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--key-h, 2.75rem);
    height: var(--key-h, 2.75rem);
    /* A reveal, not a fade: unseen, it takes neither a press nor the focus. */
    visibility: hidden;
    cursor: pointer;
  }
  .draft:focus-within .draft-pick,
  .drafts.choosing .draft-pick {
    visibility: visible;
  }
  @media (hover: hover) {
    .draft:hover .draft-pick {
      visibility: visible;
    }
  }
  /* The new drawing: the proportions, and beside them the size, the side and
     the way on. Under the cards on a narrow screen. */
  .sheet-new {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 14rem;
    align-items: start;
    gap: 1.5rem;
  }
  :global(.editor.phone) .sheet-new {
    grid-template-columns: minmax(0, 1fr);
  }
  .sheet-side,
  .sheet-sizes {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  /* Global and heavier: the scoped rule lost to the key's own centring. */
  .hub .sheet-sizes .key {
    justify-content: space-between;
  }
  .sheet-sizes small {
    font-weight: 400;
    font-variant-numeric: tabular-nums;
    color: var(--text-2);
  }
  /* The rate under the sizes: its name over a slider and a box, as on the bar. */
  .sheet-fps {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 3.2rem;
    align-items: center;
    column-gap: 0.5rem;
    color: var(--text-2);
  }
  .sheet-fps span {
    grid-column: 1 / -1;
  }
  .size-menu .sheet-fps {
    padding: 2px 10px 4px;
  }
  /* The studio's track is the sub-tone, and so is the menu: on it the track
     takes the tone of the size chosen. */
  .size-menu .sheet-fps input[type='range']::-webkit-slider-runnable-track {
    background: var(--canvas);
  }
  .size-menu .sheet-fps input[type='range']::-moz-range-track {
    background: var(--canvas);
  }
  .sheet-fps input[type='range'] {
    width: 100%;
    margin: 0;
    height: var(--key-h, 2.75rem);
  }
  .sheet-fps input[type='number'] {
    height: var(--key-h, 2.75rem);
    box-sizing: border-box;
    padding: 0 0.3rem;
    border: 1px solid var(--edge);
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: var(--ink);
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }
  /* Safari on an iPhone zooms the page onto a field under 16 px. */
  @media (pointer: coarse) {
    .sheet-fps input[type='number'] {
      font-size: max(16px, 1em);
    }
  }
  .sheet-stand {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-height: var(--key-h, 2.75rem);
    cursor: pointer;
  }
  /* A draft is a plate with its still in a well, as a card of the feed is
     (DESIGN §5): the hub stands under the site's header, next to that feed. */
  .draft-open {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    gap: 0.6rem;
    min-width: 0;
    min-height: 3.4rem;
    padding: 0.5rem 0.5rem 0.7rem;
    border: 0;
    border-radius: var(--r-xl);
    background: var(--canvas);
    font: inherit;
    text-align: left;
    color: inherit;
    cursor: pointer;
  }
  @media (hover: hover) {
    .draft-open:hover {
      background: var(--well);
    }
  }
  .draft-open.picked {
    background: var(--accent-wash);
  }
  .draft-open.picked .draft-thumb {
    outline: 3px solid var(--accent);
  }
  .draft-thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    /* The still is what a draft is known by: the card is its frame, the same
       for a sheet lying and standing. */
    aspect-ratio: 16 / 9;
    flex: none;
    border-radius: var(--r-lg);
    background: var(--well);
    overflow: hidden;
  }
  /* «Новый мульт»: the tile the site's gallery opens with, in its tone. */
  .draft-open.hub-new {
    background: var(--tile);
    color: var(--tile-ink);
    font-weight: 700;
  }
  @media (hover: hover) {
    .draft-open.hub-new:hover {
      background: var(--tile-hover);
    }
  }
  .draft-thumb.new-thumb {
    background: none;
  }
  /* The proportions stand two by two beside the sizes: four in a row left
     the screen empty under them. */
  .sheet-new .drafts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }
  /* A sheet to start on, drawn as the reel draws it: white, on the paper. */
  .draft-thumb.sheet-shape {
    background: var(--paper);
  }
  .sheet-shape span {
    height: 70%;
    border-radius: var(--r-sm);
    background: var(--canvas);
  }
  .draft-thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .draft-thumb :global(canvas) {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .draft-meta {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding-inline: 0.35rem;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .draft-date {
    font-size: 0.95rem;
  }
  .draft-size {
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
    color: var(--text-2);
  }
  .empty {
    margin: 1.2rem 0;
    color: var(--text-2);
  }
</style>

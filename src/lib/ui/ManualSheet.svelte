<script module lang="ts">
  import type { ManualSectionId } from './manual-sections';

  /** The section the sheet was left on, for as long as the page lives. */
  let lastSection: ManualSectionId = 'draw';
</script>

<script lang="ts">
  /**
   * «Справка»: sections by task on one side, search over them, and in a row
   * what the hand has for that action. A key cap here is the key itself:
   * pressed, it waits for the new one — there is no second list to keep in
   * step with this one (settings-belong-in-the-canvas).
   */
  import { tick, untrack } from 'svelte';
  import type { EditorState } from './editor-state.svelte';
  import Icon from './Icon.svelte';
  import { chordLabel, chordOf, holdersOf, isBare, refusal, type Chord } from './keymap';
  import { manualSections, searchManual, type ManualRow } from './manual-sections';
  import { toolOrder, toolSpec } from './panels';
  import { t } from '../i18n';

  let {
    editor,
    quickPalette,
    hasProjectFile,
    opensBrush,
    onClose,
    onTour,
  }: {
    editor: EditorState;
    quickPalette: boolean;
    hasProjectFile: boolean;
    /** The tool in hand opens its box on a second press. */
    opensBrush: boolean;
    onClose: () => void;
    onTour: () => void;
  } = $props();

  let dialogEl = $state<HTMLDialogElement | undefined>();
  $effect(() => {
    dialogEl?.showModal();
  });

  /** Nothing that hovers at all: a finger alone. Hovering second: a finger first, with keys by it. */
  const input = matchMedia('(any-hover: none)').matches ? 'finger' : matchMedia('(hover: none)').matches ? 'both' : 'cursor';

  const capsOf = (command: string): string[] => editor.keysOf(command).map(chordLabel);

  const sections = $derived.by(() => {
    void editor.pluginsVersion;
    return manualSections({
      input,
      tools: toolOrder().filter((id) => editor.availableTools.includes(id)).map((id) => ({ id, label: toolSpec(id)?.label ?? id })),
      quickPalette,
      hasProjectFile,
      fullscreen: document.fullscreenEnabled,
      toolOpensBrush: opensBrush,
      keysOf: capsOf,
    });
  });

  let query = $state('');
  const searching = $derived(query.trim() !== '');
  const found = $derived(searching ? searchManual(sections, query, capsOf) : []);

  let section = $state(untrack(() => lastSection));
  /** A section gone from this studio since it was left: the first one stands in. */
  const shown = $derived(sections.find((one) => one.id === section) ?? sections[0]);

  function pick(id: ManualSectionId): void {
    section = lastSection = id;
    query = '';
    bodyEl?.scrollTo(0, 0);
  }

  function onTabKey(e: KeyboardEvent): void {
    const at = sections.findIndex((one) => one.id === shown?.id);
    const step: Record<string, number> = {
      ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: sections.length - 1,
    };
    if (!(e.key in step)) return;
    e.preventDefault();
    const next = sections[(step[e.key] + sections.length) % sections.length];
    pick(next.id);
    document.getElementById(`manual-tab-${next.id}`)?.focus();
  }

  let bodyEl = $state<HTMLDivElement | undefined>();

  // --- The keys -------------------------------------------------------------

  /** A cap waiting for the new key; `replacing` undefined is a key being added. */
  let capture = $state<{ command: string; replacing?: Chord } | null>(null);
  /** The key pressed is someone else's: the row asks before taking it. */
  let pending = $state<{ command: string; chord: Chord; replacing?: Chord; holders: string[] } | null>(null);
  let refused = $state<{ command: string; text: string } | null>(null);

  const anyChanged = $derived(Object.keys(editor.settings.keymap).length > 0);

  /** What a command is called where the person can see it: a row off this sheet asks no question. */
  const nameOf = $derived.by(() => {
    const names = new Map<string, string>();
    for (const one of sections) {
      for (const row of one.rows) {
        if (row.kind === 'command') names.set(row.command, row.label);
      }
    }
    return names;
  });

  function focusRow(command: string): void {
    void tick().then(() => {
      const row = dialogEl?.querySelector<HTMLElement>(`[data-command="${CSS.escape(command)}"]`);
      row?.querySelector<HTMLElement>('button')?.focus();
    });
  }

  function start(command: string, replacing?: Chord): void {
    pending = null;
    refused = null;
    capture = { command, replacing };
  }

  function stop(): void {
    const command = capture?.command;
    capture = null;
    refused = null;
    if (command) focusRow(command);
  }

  function take(command: string, chord: Chord, replacing?: Chord): void {
    editor.assignKey(command, chord, replacing);
    pending = null;
    capture = null;
    refused = null;
    focusRow(command);
  }

  // In the capture phase, ahead of the studio: Ctrl+S pressed here is the key
  // being given, not a save.
  $effect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent): void => {
      const now = capture;
      if (!now || e.isComposing || e.repeat) return;
      // Tab goes on walking the sheet: no key may trap the focus (WCAG 2.1.2).
      if (e.key === 'Tab') {
        capture = null;
        refused = null;
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') {
        stop();
        return;
      }
      const chord = chordOf(e);
      if (chord === null) return;
      const why = refusal(chord);
      if (why) {
        refused = { command: now.command, text: t(why === 'fixed' ? 'editor.key_refused_fixed' : 'editor.key_refused_browser', { key: chordLabel(chord) }) };
        return;
      }
      if (!editor.settings.letterKeys && isBare(chord)) {
        refused = { command: now.command, text: t('editor.key_refused_letter') };
        return;
      }
      const holders = holdersOf(editor.commands, editor.settings.keymap, chord, now.command).filter((id) => nameOf.has(id));
      if (holders.length > 0) {
        pending = { command: now.command, chord, replacing: now.replacing, holders };
        capture = null;
        refused = null;
        return;
      }
      take(now.command, chord, now.replacing);
    };
    // A press off the waiting row calls it off; the press still does its work.
    const onPress = (e: PointerEvent): void => {
      if (!(e.target instanceof Element) || !e.target.closest('.capture-row')) {
        capture = null;
        refused = null;
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPress, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPress, true);
    };
  });

  /** Esc while waiting is the wait's, not the sheet's. */
  function onCancel(e: Event): void {
    if (capture || pending) {
      e.preventDefault();
      if (pending) {
        const { command } = pending;
        pending = null;
        focusRow(command);
      }
    }
  }

  async function resetAll(): Promise<void> {
    capture = null;
    pending = null;
    if (await editor.ask(t('editor.keys_reset_confirm'), t('editor.keys_reset_yes'))) {
      editor.resetKeys();
    }
  }
</script>

{#snippet rowOf(row: ManualRow)}
  <li class="mrow" class:capture-row={row.kind === 'command' && capture?.command === row.command} data-command={row.kind === 'command' ? row.command : undefined}>
    <span class="mlabel">{row.label}</span>
    {#if row.kind === 'command'}
      {@const keys = editor.keysOf(row.command)}
      {@const waiting = capture?.command === row.command ? capture : null}
      <span class="mkeys">
        {#if editor.keymap.changed(row.command)}
          <button class="keyquiet" onclick={() => { editor.resetKey(row.command); focusRow(row.command); }} title={t('editor.key_reset', { name: row.label })} aria-label={t('editor.key_reset', { name: row.label })}>
            <Icon name="undo" />
          </button>
        {/if}
        {#each keys as chord (chord)}
          {#if waiting && waiting.replacing === chord}
            <span class="keycap waiting" role="status">{t('editor.key_capture')}</span>
          {:else}
            <button
              class="keycap"
              class:changed={editor.keymap.changed(row.command)}
              onclick={() => start(row.command, chord)}
              title={t('editor.key_change', { key: chordLabel(chord), name: row.label })}
              aria-label={t('editor.key_change', { key: chordLabel(chord), name: row.label })}
            >{chordLabel(chord)}</button>
          {/if}
        {/each}
        {#if waiting && waiting.replacing === undefined}
          <span class="keycap waiting" role="status">{t('editor.key_capture')}</span>
        {:else}
          <button
            class="keyquiet add"
            class:lonely={keys.length === 0}
            onclick={() => start(row.command)}
            title={t('editor.key_add', { name: row.label })}
            aria-label={t('editor.key_add', { name: row.label })}
          ><Icon name="plus" /></button>
        {/if}
      </span>
      {#if waiting}
        <span class="mnote">
          {#if refused?.command === row.command}<span class="refused" role="alert">{refused.text}</span>{:else}{t('editor.key_capture_hint')}{/if}
          {#if waiting.replacing !== undefined}
            <button class="linkish" onclick={() => { const { command, replacing } = waiting; capture = null; refused = null; editor.removeKey(command, replacing!); focusRow(command); }}>{t('editor.key_remove')}</button>
          {/if}
        </span>
      {/if}
      {#if pending?.command === row.command}
        {@const asked = pending}
        <span class="mnote ask" role="alertdialog" aria-label={t('editor.key_taken', { key: chordLabel(asked.chord), name: nameOf.get(asked.holders[0]) ?? '' })}>
          {t('editor.key_taken', { key: chordLabel(asked.chord), name: asked.holders.map((id) => nameOf.get(id)).join(', ') })}
          <button class="linkish strong" onclick={() => take(asked.command, asked.chord, asked.replacing)}>{t('editor.key_give')}</button>
          <button class="linkish" onclick={() => { pending = null; focusRow(row.command); }}>{t('ask.no')}</button>
        </span>
      {/if}
    {:else if row.kind === 'fixed'}
      <span class="mkeys"><kbd class="keycap fixed">{row.keys}</kbd></span>
    {:else}
      <span class="mhow">{row.how}</span>
    {/if}
  </li>
{/snippet}

<dialog bind:this={dialogEl} class="sheet sheet-dialog manual" aria-label={t('editor.manual')} onclose={onClose} oncancel={onCancel}>
  <header class="sheet-head">
    <h2>{t('editor.manual')}</h2>
    <button class="key icon" onclick={() => dialogEl?.close()} aria-label={t('editor.close')}>
      <Icon name="x" />
    </button>
  </header>

  <div class="manual-main">
    <div class="manual-side">
      {#if input !== 'finger'}
        <label class="manual-search">
          <Icon name="search" />
          <input type="search" bind:value={query} placeholder={t('editor.manual_search')} aria-label={t('editor.manual_search')} />
        </label>
      {/if}
      <div class="manual-tabs" role="tablist" tabindex="-1" aria-label={t('editor.manual_sections')} onkeydown={onTabKey}>
        {#each sections as one (one.id)}
          {@const on = !searching && shown?.id === one.id}
          <button
            id="manual-tab-{one.id}"
            class="tab"
            class:active={on}
            role="tab"
            aria-selected={on}
            aria-controls="manual-panel"
            tabindex={on || (searching && one === sections[0]) ? 0 : -1}
            onclick={() => pick(one.id)}
          >{t(`editor.manual_section.${one.id}`)}</button>
        {/each}
      </div>
    </div>

    <!-- Nothing but words may be there to take focus, so the body itself does:
         otherwise the arrows have nowhere to scroll the list from. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div bind:this={bodyEl} id="manual-panel" class="sheet-body" role="tabpanel" tabindex="0" aria-label={searching ? t('editor.manual_finds') : shown ? t(`editor.manual_section.${shown.id}`) : undefined}>
      {#if input !== 'finger' && !editor.settings.letterKeys}
        <p class="sheet-hint">{t('editor.key_refused_letter')}</p>
      {/if}
      {#if searching}
        {#each found as one (one.id)}
          <h3 class="sheet-hint">{t(`editor.manual_section.${one.id}`)}</h3>
          <ul class="mlist">
            {#each one.rows as row (row.id)}{@render rowOf(row)}{/each}
          </ul>
        {:else}
          <p class="sheet-hint" role="status">{t('editor.manual_nothing')}</p>
        {/each}
      {:else if shown}
        <ul class="mlist">
          {#each shown.rows as row (row.id)}{@render rowOf(row)}{/each}
        </ul>
      {/if}
    </div>
  </div>

  <footer class="sheet-foot">
    <button class="key" onclick={() => { dialogEl?.close(); onTour(); }}>{t('editor.tour_again')}</button>
    {#if anyChanged}
      <button class="key" onclick={resetAll}>{t('editor.keys_reset_all')}</button>
    {/if}
    <button class="key primary" onclick={() => dialogEl?.close()}>{t('editor.done')}</button>
  </footer>
</dialog>

<style>
  .manual-main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .manual-main .sheet-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .manual-side {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--hairline-soft);
  }
  .manual-search {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-height: var(--key-h);
    padding: 0 0.7rem;
    border-radius: var(--r-pill);
    background: var(--sub);
    color: var(--ink-2);
  }
  .manual-search :global(svg) {
    flex: none;
    width: 1.05rem;
    height: 1.05rem;
  }
  .manual-search input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--ink);
    font: inherit;
    outline: none;
  }
  .manual-search:focus-within {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
  }
  .manual-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }
  .tab {
    flex: none;
    min-height: var(--key-h);
    padding: 0 0.85rem;
    border: none;
    border-radius: var(--r-pill);
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    font-weight: 650;
    text-align: start;
    cursor: pointer;
    transition: background-color var(--dur) var(--ease-out), color var(--dur) var(--ease-out);
  }
  @media (hover: hover) {
    .tab:hover {
      background: var(--sub);
    }
  }
  .tab.active {
    background: color-mix(in srgb, var(--accent) 14%, var(--canvas));
    color: var(--accent-ink);
  }
  /* Safari 16.0 and 16.1: a tint with var() inside drops to transparent, and
     the declaration before it does not help. */
  @supports not (color: color-mix(in srgb, red, red)) {
    .tab.active,
    .keycap.waiting {
      background: var(--sub);
    }
  }
  .tab:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
  }
  .mlist {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .mrow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    column-gap: 0.75rem;
    row-gap: 0.2rem;
    min-height: 2.6rem;
    padding: 0.3rem 0;
  }
  .mrow + .mrow {
    border-top: 1px solid var(--hairline-soft);
  }
  .mlabel {
    flex: 1 1 11rem;
    font-size: 0.92rem;
    color: var(--ink);
  }
  .mhow {
    flex: 0 1 auto;
    font-size: 0.86rem;
    font-weight: 650;
    max-width: 58%;
    text-align: end;
    color: var(--ink-2);
  }
  .mkeys {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.25rem;
  }
  .keycap {
    min-width: 2rem;
    min-height: 1.9rem;
    padding: 0.1rem 0.5rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    background: var(--paper);
    color: var(--ink);
    font: inherit;
    font-size: 0.82rem;
    font-weight: 700;
    text-align: center;
  }
  button.keycap {
    cursor: pointer;
    transition: background-color var(--dur) var(--ease-out);
  }
  @media (hover: hover) {
    button.keycap:hover {
      background: var(--sub);
    }
  }
  button.keycap:focus-visible,
  .keyquiet:focus-visible,
  .linkish:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 1px;
  }
  .keycap.changed {
    border-color: var(--accent);
    color: var(--accent-ink);
  }
  .keycap.fixed {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-color: transparent;
    background: var(--sub);
  }
  .keycap.waiting {
    display: inline-flex;
    align-items: center;
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, var(--canvas));
    color: var(--accent-ink);
    font-weight: 650;
  }
  .keyquiet {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.9rem;
    padding: 0;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--ink-2);
    cursor: pointer;
  }
  .keyquiet :global(svg) {
    width: 0.95rem;
    height: 0.95rem;
  }
  @media (hover: hover) {
    .keyquiet:hover {
      background: var(--sub);
    }
    /* The «+» of a row with a key waits for the hand: forty of them were a fence. */
    .keyquiet.add:not(.lonely) {
      opacity: 0;
    }
    .mrow:hover .keyquiet.add,
    .keyquiet.add:focus-visible {
      opacity: 1;
    }
  }
  .sheet-foot {
    flex-wrap: wrap;
  }
  .mnote {
    flex: 1 0 100%;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: flex-end;
    gap: 0.6rem;
    font-size: 0.82rem;
    color: var(--ink-2);
  }
  .mnote.ask {
    color: var(--ink);
  }
  .refused {
    color: var(--accent-ink);
  }
  .linkish {
    padding: 0.2rem 0.3rem;
    border: none;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--ink-2);
    font: inherit;
    font-weight: 700;
    text-decoration: underline;
    cursor: pointer;
  }
  .linkish.strong {
    color: var(--accent-ink);
  }
  @media (hover: hover) and (min-width: 52rem) {
    :global(.editor) .sheet-dialog.manual {
      width: min(50rem, calc(100% - 2rem));
      height: min(38rem, 85dvh);
    }
    .manual-main {
      flex-direction: row;
    }
    .manual-side {
      width: 12.5rem;
      padding: 0.6rem;
      overflow-y: auto;
      border-bottom: none;
      border-right: 1px solid var(--hairline-soft);
    }
    .manual-tabs {
      flex-direction: column;
      flex-wrap: nowrap;
    }
  }
  :global(.editor.low) .sheet-dialog.manual {
    height: auto;
  }
  :global(.editor.low) .manual-main,
  :global(.editor.low) .manual-main .sheet-body {
    flex: none;
  }
</style>

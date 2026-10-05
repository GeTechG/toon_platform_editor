<script module lang="ts">
  import type { SettingsTab } from './presets';

  /**
   * The category the sheet was left on, for as long as the page lives: the
   * arranger and the plugins window close the sheet, and coming back from
   * them should not start over at «Рисование».
   */
  let lastTab: SettingsTab = 'drawing';
</script>

<script lang="ts">
  /**
   * The reference's settings window (`index.html #settings`), cut into
   * categories: one long scroll of seven headings became five tabs with one
   * short panel on screen. Every control writes straight through to the
   * persisted UI config, so there is no apply button and no draft state.
   *
   * A native <dialog> rather than a hand-rolled sheet — showModal() brings the
   * focus trap, the Esc key and an inert page with it (WCAG 2.4.3, 2.1.2).
   */
  import { tick } from 'svelte';
  import { exportDrafts, importDrafts, listDrafts } from '../draft/store';
  import { draftEntries, type DraftEntry } from '../draft/restore';
  import { formatFileSize } from './file-size';
  import {
    AUTOSAVE_INTERVALS,
    autosaveLabel,
    PALETTE_LIMIT_MAX,
    PALETTE_LIMIT_MIN,
    PALETTE_LIMIT_STEP,
    presets,
    stepTab,
  } from './presets';
  import Icon, { type IconName } from './Icon.svelte';
  import { saveFile } from './save-file';
  import { pickerAccept } from './file-accept';
  import type { EditorState } from './editor-state.svelte';
  import { dateLocale, t } from '../i18n';

  let {
    editor,
    onClose,
    onSaveNow,
    onDownloadErrors,
    onOpenFile,
    onOpenDrafts,
    onOpenPlugins,
    compact = false,
  }: {
    editor: EditorState;
    /** A small screen: its tabs are what moves, the panels are not drawn. */
    compact?: boolean;
    onClose: () => void;
    /** Resolves `false` when the draft did not reach the disk. */
    onSaveNow?: () => Promise<boolean>;
    /** Alt+L's file, the session's errors (owner, 17th audit). */
    onDownloadErrors?: () => void;
    /** The file dialog, the draft list and the plugins window live in the editor. */
    onOpenFile?: () => void;
    onOpenPlugins?: () => void;
    onOpenDrafts?: () => void;
  } = $props();

  /** Without the API the option would be a switch that does nothing. */
  const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

  let dialogEl = $state<HTMLDialogElement | undefined>();
  let bodyEl = $state<HTMLDivElement | undefined>();
  let tab = $state(lastTab);

  /** A function, like `presets()`: the names follow the language. */
  const tabs = (): { id: SettingsTab; label: string }[] => [
    { id: 'drawing', label: t('settings.drawing') },
    { id: 'palette', label: t('settings.palette') },
    { id: 'view', label: t('settings.view') },
    { id: 'saving', label: t('settings.saving') },
    { id: 'more', label: t('settings.more') },
  ];

  function selectTab(id: SettingsTab): void {
    tab = lastTab = id;
    // One body for every panel: the next one starts from its top.
    if (bodyEl) bodyEl.scrollTop = 0;
    // On a phone the strip scrolls sideways: the picked tab comes into it.
    document.getElementById(`settings-tab-${id}`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function onTabKey(e: KeyboardEvent): void {
    const next = stepTab(tab, e.key);
    if (!next) return;
    e.preventDefault();
    selectTab(next);
    document.getElementById(`settings-tab-${next}`)?.focus({ preventScroll: true });
  }
  let paletteFile = $state<HTMLInputElement | undefined>();
  let draftFile = $state<HTMLInputElement | undefined>();
  let saveDraftsEl = $state<HTMLButtonElement | undefined>();
  /** What the last import or save did, shown until the next one. */
  let report = $state('');
  /**
   * The palette limit under the finger. Every step of the slider rewrote the
   * whole studio config into storage; the setting lands on release, the
   * number beside it follows the finger all the same.
   */
  let limitDragged = $state<number | null>(null);
  const limitShown = $derived(limitDragged ?? editor.settings.paletteLimit);
  $effect(() => {
    void editor.settings.paletteLimit;
    limitDragged = null;
  });

  $effect(() => {
    dialogEl?.showModal();
  });

  // The records to tick for an export. Read once when the sheet opens: the
  // list is a few dozen rows at most and nothing writes while it is up. They
  // go through `draftEntries`, so a record whose document does not parse is
  // not offered for export — it is not a draft, whatever storage still holds.
  let drafts = $state<DraftEntry[]>([]);
  let chosen = $state<string[]>([]);
  /** Records written so far / to write, while an export runs. */
  let exporting = $state<{ done: number; total: number } | null>(null);

  $effect(() => {
    void listDrafts().then((records) => {
      drafts = draftEntries(records);
      chosen = drafts.map((entry) => entry.id);
    });
  });

  async function saveDraftsFile(): Promise<void> {
    exporting = { done: 0, total: chosen.length };
    try {
      download(
        // Our own name for our own file; `.toonio` from toonio.ru still opens.
        'drafts.toonops',
        await exportDrafts(chosen, (done, total) => (exporting = { done, total })),
      );
      report = t('draft.saved', { count: chosen.length });
    } catch (err) {
      console.warn('drafts export failed:', err);
      report = t('settings.drafts_save_failed');
    } finally {
      exporting = null;
      // The key was disabled while it ran, which drops the focus to the page.
      await tick();
      if (!dialogEl?.contains(document.activeElement)) {
        saveDraftsEl?.focus();
      }
    }
  }

  /** Reference «постоянное хранилище»: drafts the browser may not evict. */
  async function askPersist(): Promise<void> {
    const granted = await navigator.storage?.persist?.().catch(() => false);
    report = granted
      ? t('settings.persist_on')
      : t('settings.persist_off');
  }

  function download(name: string, text: string): void {
    // Drafts are not JSON to the browser: Safari names a JSON download `drafts.toonops.json`.
    saveFile(new Blob([text], { type: name.endsWith('.json') ? 'application/json' : 'application/octet-stream' }), name);
  }

  async function onPaletteFile(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      // Moved or deleted between the pick and the read.
      console.warn('palettes file unreadable:', error);
      report = t('settings.palettes_unreadable');
      return;
    }
    const { loaded, stored } = editor.importSavedPalettes(text);
    report = loaded === 0
      ? t('settings.no_palettes')
      : stored
        ? t('settings.palettes_loaded', { count: loaded })
        : t('settings.palettes_not_stored');
  }

  async function onDraftFile(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!confirm(t('settings.drafts_confirm', { name: file.name }))) {
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch (error) {
      // Moved or deleted between the pick and the read: not the storage's fault.
      console.warn('drafts file unreadable:', error);
      report = t('settings.drafts_unreadable');
      return;
    }
    try {
      const { loaded, broken } = await importDrafts(text);
      report = loaded > 0 || broken > 0
        ? t(broken > 0 ? 'settings.drafts_loaded_broken' : 'settings.drafts_loaded', { loaded, broken })
        : t('settings.no_drafts');
    } catch (err) {
      // Storage full or gone: what did go in is listed below all the same.
      console.warn('drafts import failed:', err);
      report = t('settings.drafts_load_failed');
    }
    // What came in is ticked like the rest: the list opens with everything on.
    const before = new Set(drafts.map((entry) => entry.id));
    drafts = draftEntries(await listDrafts());
    chosen = [...chosen, ...drafts.filter((entry) => !before.has(entry.id)).map((entry) => entry.id)];
  }

  /**
   * The studio's «сохранено» is under this modal, inert: neither seen for the
   * scrim nor heard. The answer goes in the sheet's own line.
   */
  async function saveNowHere(): Promise<void> {
    if (!onSaveNow) return;
    const saved = await onSaveNow();
    report = t(saved ? 'settings.saved_now' : 'settings.save_not_done');
  }

  function wipePalettes(): void {
    if (confirm(t('settings.wipe_palettes_confirm'))) {
      editor.deleteAllSavedPalettes();
      report = t('settings.palettes_wiped');
    }
  }
</script>

<!-- Both pickers stay out of the layout; the visible buttons click them. -->
<input
  bind:this={paletteFile}
  type="file"
  hidden
  accept="application/json,.json"
  aria-label={t('settings.palette_file')}
  onchange={onPaletteFile}
/>
<input
  bind:this={draftFile}
  type="file"
  hidden
  accept={pickerAccept('.toonops,.toonio,application/json,.json')}
  aria-label={t('settings.draft_file')}
  onchange={onDraftFile}
/>

<!-- An action is a row like the switches around it: its name on the left, what
     kind of thing it is on the right. A cluster of pill keys of every width
     wrapped where it liked and read as a heap. -->
{#snippet act(label: string, icon: IconName | undefined, onclick: () => void, danger = false)}
  <button class="act" class:danger {onclick}>
    <span>{label}</span>
    {#if icon}<Icon name={icon} />{/if}
  </button>
{/snippet}

<dialog bind:this={dialogEl} class="sheet sheet-dialog settings" aria-label={t('settings.sheet')} onclose={onClose}>
  <header class="sheet-head">
    <h2>{t('settings.sheet')}</h2>
    <button class="key icon" onclick={() => dialogEl?.close()} aria-label={t('picker.close')}>
      <Icon name="x" />
    </button>
  </header>

  <div class="settings-main">
    <!-- The picked tab is the list's one stop; the arrows walk the rest. -->
    <div class="settings-tabs" role="tablist" tabindex="-1" aria-label={t('settings.tabs')} onkeydown={onTabKey}>
      {#each tabs() as item (item.id)}
        <button
          id="settings-tab-{item.id}"
          class="tab"
          class:active={tab === item.id}
          role="tab"
          aria-selected={tab === item.id}
          aria-controls="settings-panel"
          tabindex={tab === item.id ? 0 : -1}
          onclick={() => selectTab(item.id)}
        >{item.label}</button>
      {/each}
    </div>

    <div
      bind:this={bodyEl}
      class="sheet-body"
      id="settings-panel"
      role="tabpanel"
      aria-labelledby={`settings-tab-${tab}`}
    >
      {#if tab === 'drawing'}
        <!--
          The option is Tonio's `toonio_old_pen`: one point per event instead of
          the coalesced batch. It is the editor's own, not a brush's — the batch
          is what every brush is handed, so the switch is offered whatever is in
          hand. (The old pen it used to mean here is a type of the brush now,
          picked in the brush box.)
        -->
        <label class="toggle">
          <span class="toggle-label stacked">
            {t('settings.mouse_mode')}
            <small>{t('settings.mouse_mode_hint')}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={editor.settings.mouseMode}
            onchange={(e) => editor.setSetting('mouseMode', e.currentTarget.checked)}
          />
        </label>
        <label class="toggle">
          <span class="toggle-label stacked">
            {t('settings.pen_pressure')}
            <small>{t('settings.pen_pressure_hint')}</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={editor.settings.penPressure}
            onchange={(e) => editor.setSetting('penPressure', e.currentTarget.checked)}
          />
        </label>
        <label class="toggle">
          <span class="toggle-label">{t('settings.crosshair')}</span>
          <input
            type="checkbox"
            role="switch"
            checked={editor.settings.crossCursor}
            onchange={(e) => editor.setSetting('crossCursor', e.currentTarget.checked)}
          />
        </label>
        <label class="toggle">
          <span class="toggle-label">{t('settings.lock_transform')}</span>
          <input
            type="checkbox"
            role="switch"
            checked={editor.settings.lockTransform}
            onchange={(e) => editor.setSetting('lockTransform', e.currentTarget.checked)}
          />
        </label>
        <label class="toggle">
          <span class="toggle-label">{t('settings.mega_eraser_warning')}</span>
          <input
            type="checkbox"
            role="switch"
            checked={editor.settings.megaEraserWarning}
            onchange={(e) => editor.setSetting('megaEraserWarning', e.currentTarget.checked)}
          />
        </label>
      {:else if tab === 'palette'}
        {#if hasEyeDropper}
          <label class="toggle">
            <span class="toggle-label">{t('settings.browser_pipette')}</span>
            <input
              type="checkbox"
              role="switch"
              checked={editor.settings.chromePicker}
              onchange={(e) => editor.setSetting('chromePicker', e.currentTarget.checked)}
            />
          </label>
        {/if}
        <label class="toggle">
          <span class="toggle-label">{t('settings.auto_add_colour')}</span>
          <input
            type="checkbox"
            role="switch"
            checked={editor.settings.paletteAutoAdd}
            onchange={(e) => editor.setSetting('paletteAutoAdd', e.currentTarget.checked)}
          />
        </label>
        <label class="row">
          <span class="row-label">{t('settings.palette_limit')}</span>
          <span class="slider">
            <input
              type="range"
              min={PALETTE_LIMIT_MIN}
              max={PALETTE_LIMIT_MAX}
              step={PALETTE_LIMIT_STEP}
              value={editor.settings.paletteLimit}
              oninput={(e) => (limitDragged = Number(e.currentTarget.value))}
              onchange={(e) => editor.setSetting('paletteLimit', Number(e.currentTarget.value))}
            />
            <output>{limitShown}</output>
          </span>
        </label>

        <h3 class="sheet-hint">{t('settings.saved_palettes')}</h3>
        {@render act(t('settings.download_palettes'), 'download', () => download('palettes.json', editor.exportSavedPalettes()))}
        {@render act(t('settings.load_palettes'), 'chevron-right', () => paletteFile?.click())}
        {@render act(t('settings.wipe_palettes'), 'trash', wipePalettes, true)}
      {:else if tab === 'view'}
        <!-- Reference «Настроить панель»: which buttons the toolbar shows, and
             the preset they come from. The gear is never hideable, so this is
             always reachable. -->
        <h3 class="sheet-hint">{t('settings.panel')}</h3>
        <div class="presets" role="group" aria-label={t('settings.preset_group')}>
          {#each presets() as p (p.id)}
            <button
              class="preset-chip"
              class:active={editor.preset === p.id}
              aria-pressed={editor.preset === p.id}
              onclick={() => editor.applyPreset(p.id)}
            >{p.label}</button>
          {/each}
        </div>
        <label class="toggle">
          <span class="toggle-label">{t('settings.mirror_layout')}</span>
          <input
            type="checkbox"
            role="switch"
            checked={editor.settings.altLayout}
            onchange={(e) => editor.setSetting('altLayout', e.currentTarget.checked)}
          />
        </label>
        <label class="toggle">
          <span class="toggle-label">{t('settings.letter_keys')}</span>
          <input
            type="checkbox"
            role="switch"
            checked={editor.settings.letterKeys}
            onchange={(e) => editor.setSetting('letterKeys', e.currentTarget.checked)}
          />
        </label>
        <!-- Расположение: arranged by hand in the editor, where the panels are.
             A list of selects said the same thing twice and nobody used it. -->
        {#if compact}
          <p class="hint">{t('settings.tabs_hint')}</p>
        {:else}
          {@render act(t('settings.edit_panels'), 'chevron-right', () => {
            editor.arranging = true;
            dialogEl?.close();
          })}
        {/if}
      {:else if tab === 'saving'}
        <label class="row">
          <span class="row-label">{t('settings.autosave')}</span>
          <select
            value={editor.settings.autosaveMs}
            onchange={(e) => editor.setSetting('autosaveMs', Number(e.currentTarget.value))}
          >
            {#each AUTOSAVE_INTERVALS as ms (ms)}
              <option value={ms}>{autosaveLabel(ms)}</option>
            {/each}
          </select>
        </label>
        <label class="toggle">
          <span class="toggle-label">{t('settings.show_drafts')}</span>
          <input
            type="checkbox"
            role="switch"
            checked={editor.settings.showDraftsOnStart}
            onchange={(e) => editor.setSetting('showDraftsOnStart', e.currentTarget.checked)}
          />
        </label>
        {#if onSaveNow}
          {@render act(t('settings.save_now'), 'save', saveNowHere)}
        {/if}
        {@render act(t('settings.ask_persist'), undefined, askPersist)}

        {#if onOpenDrafts || onOpenFile}
          <h3 class="sheet-hint">{t('settings.open')}</h3>
          {#if onOpenDrafts}
            {@render act(t('settings.drafts'), 'chevron-right', () => { dialogEl?.close(); onOpenDrafts(); })}
          {/if}
          {#if onOpenFile}
            <!-- The sheet steps aside, as it does for the plugins and the arranger:
                 an import error lands on the canvas, under this modal, unseen. -->
            {@render act(t('settings.open_toon'), 'chevron-right', () => { dialogEl?.close(); onOpenFile(); })}
          {/if}
        {/if}

        <h3 class="sheet-hint">{t('settings.drafts_copy')}</h3>
        {#if drafts.length > 0}
          <!-- Everything goes into the copy unless told otherwise: the list of
               ticks is there for the one who asks, not in everybody's way. -->
          <details class="pick">
            <summary>{t('settings.drafts_chosen', { chosen: chosen.length, total: drafts.length })}</summary>
            <ul class="picklist">
              {#each drafts as entry (entry.id)}
                <li>
                  <label class="toggle">
                    <span class="toggle-label stacked">
                      {new Date(entry.updated).toLocaleString(dateLocale(), { dateStyle: 'short', timeStyle: 'short' })}
                      <small>
                        {t('draft.frames', { count: entry.doc.layers[0].frames.length })}{#if entry.bytes} · {formatFileSize(entry.bytes)}{/if}{#if entry.audio}{t('draft.with_audio')}{/if}
                      </small>
                    </span>
                    <input
                      type="checkbox"
                      checked={chosen.includes(entry.id)}
                      onchange={(e) => {
                        chosen = e.currentTarget.checked
                          ? [...chosen, entry.id]
                          : chosen.filter((id) => id !== entry.id);
                      }}
                    />
                  </label>
                </li>
              {/each}
            </ul>
          </details>
        {/if}
        {#if exporting}
          <progress value={exporting.done} max={exporting.total} aria-label={t('settings.download_drafts')}>
            {t('settings.progress', { done: exporting.done, total: exporting.total })}
          </progress>
        {/if}
        <!-- Written out: this one is bound, for the focus to come back to. -->
        <button bind:this={saveDraftsEl} class="act" disabled={chosen.length === 0 || exporting !== null} onclick={saveDraftsFile}>
          <span>{t('settings.download_drafts')}</span>
          <Icon name="download" />
        </button>
        {@render act(t('settings.load_drafts'), 'chevron-right', () => draftFile?.click())}
      {:else if tab === 'more'}
        <h3 class="sheet-hint">{t('settings.plugins')}</h3>
        {@render act(t('settings.open_plugins'), 'chevron-right', () => {
          onOpenPlugins?.();
          dialogEl?.close();
        })}
        <label class="field">
          <span>{t('settings.catalog_url')}</span>
          <input
            type="url"
            placeholder={t('settings.catalog_placeholder')}
            value={editor.settings.pluginCatalog}
            onchange={(e) => editor.setSetting('pluginCatalog', e.currentTarget.value.trim())}
          />
        </label>
        {#if onDownloadErrors}
          <h3 class="sheet-hint">{t('settings.errors')}</h3>
          {@render act(t('settings.download_errors'), 'download', onDownloadErrors)}
        {/if}
      {/if}
    </div>
  </div>

  <!-- What the last import or save did, in the foot: the buttons that cause it
       are up in a panel, where a line at its bottom went unseen.
       Mounted before its words, or a reader may not announce them. -->
  <footer class="sheet-foot">
    <button class="key primary" onclick={() => dialogEl?.close()}>{t('settings.done')}</button>
    <p class="report" role="status">{report}</p>
  </footer>
</dialog>

<style>
  /* One size for every category: a sheet that grew and shrank with the tab
     moved its own tabs from under the pointer. Under `.editor`, or the shared
     `.editor .sheet` chrome — as heavy, and later in the page — wins. */
  :global(.editor) .sheet-dialog.settings {
    height: 85dvh;
  }
  .settings-main {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .settings-main .sheet-body {
    flex: 1;
    padding-top: 0.5rem;
  }
  /* A group of rows, then air, then the next group: packed edge to edge, the
     presets sat on the switch under them and a heading on the keys over it. */
  .settings-main .sheet-body > .sheet-hint {
    margin: 1.4rem 0 0.5rem;
  }
  .settings-main .sheet-body > :is(.presets, .hint, .field, progress) {
    margin-block: 0.75rem;
    padding-block: 0;
  }
  .settings-main .sheet-body > :first-child {
    margin-top: 0.3rem;
  }
  /* One left edge for the headings, the keys and the rows' words: the row's
     tone on hover reaches past its words into the body's margin instead of
     pushing them in. */
  :global(.editor) .settings-main .toggle {
    margin-inline: -0.5rem;
    padding-inline: 0.5rem;
  }
  /* The same row, pressed instead of switched. */
  .act {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    width: calc(100% + 1rem);
    min-height: 2.9rem;
    margin-inline: -0.5rem;
    padding: 0.3rem 0.5rem;
    border: none;
    border-radius: var(--r-sm);
    background: none;
    color: var(--ink);
    font: inherit;
    font-size: 0.95rem;
    text-align: start;
    cursor: pointer;
  }
  .act :global(svg) {
    flex: none;
    color: var(--ink-2);
  }
  @media (hover: hover) {
    .act:hover:not(:disabled) {
      background: var(--sub);
    }
  }
  .act:disabled {
    opacity: 0.45;
    cursor: default;
  }
  /* Red words, not a red key: the one solid red in the sheet is «Готово». */
  .act.danger,
  .act.danger :global(svg) {
    color: var(--accent-ink);
  }
  .act:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
  }
  /* A hairline between neighbours, as between two switches. */
  .settings-main :is(.toggle, .act, .pick) + .act {
    border-top: 1px solid var(--hairline-soft);
  }
  .settings-main :is(.row, .field) {
    padding-inline: 0;
  }
  /* Lying down on a phone: a strip that scrolls sideways when the five do not
     fit — at 200 % text they never do. */
  .settings-tabs {
    flex: none;
    display: flex;
    gap: 0.25rem;
    padding: 0.5rem 1rem;
    overflow-x: auto;
    /* A tab brought into view keeps the strip's own margin beside it. */
    scroll-padding-inline: 1rem;
    scrollbar-width: none;
    border-bottom: 1px solid var(--hairline-soft);
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
  }
  @media (hover: hover) {
    .tab:hover {
      background: var(--sub);
    }
  }
  /* Tinted like the picked preset below it, for the same reason: one solid
     red key in the sheet, and it is «Готово». */
  .tab.active {
    background: color-mix(in srgb, var(--accent) 14%, var(--canvas));
    color: var(--accent-ink);
  }
  /* Inside the tab: the strip clips whatever is drawn past its edge. */
  .tab:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
  }
  @media (min-width: 40.0625rem) {
    :global(.editor) .sheet-dialog.settings {
      width: min(40rem, calc(100% - 2rem));
      height: min(35rem, 85dvh);
    }
    .settings-main {
      flex-direction: row;
    }
    /* Standing beside the panel, where there is room for it. */
    .settings-tabs {
      flex-direction: column;
      width: 11rem;
      padding: 0.6rem;
      overflow-x: visible;
      overflow-y: auto;
      border-bottom: none;
      border-right: 1px solid var(--hairline-soft);
    }
  }
  /* A low screen scrolls the sheet whole (sheetScrollsWhole): no height of
     its own then, and the panel is as tall as what it holds. */
  :global(.editor.low) .sheet-dialog.settings {
    height: auto;
  }
  :global(.editor.low) .settings-main,
  :global(.editor.low) .settings-main .sheet-body {
    flex: none;
  }
  /* The browser's own marker: a drawn one would be an icon outside the set. */
  .pick summary {
    padding: 0.7rem 0;
    border-radius: var(--r-sm);
    font-size: 0.95rem;
    cursor: pointer;
  }
  .pick summary:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: -3px;
  }
  /* Preset chips: one row, equal shares (same control as the old sheet) —
     while they fit. A plugin's presets join them, and at 200 % text three
     already did not: squeezed, «Мультатор» broke mid-word inside a chip of
     fixed height. A chip that does not fit takes the next row whole. */
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .preset-chip {
    flex: 1 0 auto;
    min-height: var(--key-h);
    padding: 0 0.5rem;
    /* The body breaks anywhere; a preset's name is one word and stays whole. */
    overflow-wrap: normal;
    border: none;
    border-radius: var(--r-sm);
    background: var(--sub);
    color: var(--ink);
    font: inherit;
    font-weight: 650;
    cursor: pointer;
  }
  @media (hover: hover) {
    .preset-chip:hover {
      background: color-mix(in oklab, var(--sub), var(--text) 8%);
    }
  }
  /* The picked preset is tinted like a picked key: a solid red chip was a
     second red key beside «Готово» (the Signal Rule). */
  .preset-chip.active {
    background: color-mix(in srgb, var(--accent) 14%, var(--canvas));
    border-color: transparent;
    color: var(--accent-ink);
  }
  .preset-chip:focus-visible {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  /* A picked record needs two lines: when it was written, and what is in it —
     the date alone is how a stub record passed for a drawing. */
  .picklist {
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 13rem;
    overflow-y: auto;
  }
  /* A class, not `:has(small)`: Firefox 115 has no `:has()`. */
  .toggle .toggle-label.stacked {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
  }
  .toggle-label small {
    font-size: 0.8rem;
    opacity: 0.7;
  }
  /* The shape comes from the shared `.sheet` chrome; a <dialog> only needs
     its own defaults cleared and a backdrop of its own. */
  .sheet-dialog {
    margin: 0;
    padding: 0;
    max-width: none;
    border: none;
    color: var(--ink);
  }
  .sheet-dialog::backdrop {
    background: var(--scrim);
  }
  .row {
    display: flex;
    /* A control that does not fit beside its name goes under it. */
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: var(--key-h);
    padding: 0.35rem 0.3rem;
  }
  /* A label over a full-width field: a URL does not fit beside its name. */
  .field {
    display: grid;
    gap: 0.35rem;
    padding: 0.35rem 0.3rem;
    font-size: 0.95rem;
  }
  /* A text field is as wide as its `size` wants — 607px at 200 % text — and
     a grid item does not shrink below that unless told. */
  .field input {
    min-width: 0;
  }
  .row-label {
    font-size: 0.95rem;
  }
  .slider {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .slider {
    max-width: 100%;
  }
  .slider input {
    width: 9rem;
    min-width: 0;
    /* The finger-deep band reaches into the row's padding, so the row stays
       as tall as its neighbours. */
    margin-block: -0.35rem;
  }
  .slider output {
    min-width: 2.2rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .hint {
    margin: 0.3rem 0 0.1rem;
    font-size: 0.9rem;
    color: var(--ink-2);
  }
  .report {
    flex: 1;
    align-self: center;
    margin: 0;
    font-size: 0.9rem;
    color: var(--ink-2);
  }
  /* Safari 16.0 and 16.1 have no color-mix(): with a var() in it the value is
     invalid when computed and the tint went to nothing. The nearest token. */
  @supports not (color: color-mix(in srgb, red, red)) {
    @media (hover: hover) {
      .preset-chip:hover {
        background: var(--sub);
      }
    }
    .preset-chip.active {
      background: var(--accent-wash);
    }
  }
</style>

<script lang="ts">
  /**
   * The reference's settings window (`index.html #settings`): drawing,
   * palette, autosave and view. Every control writes straight through to the
   * persisted UI config, so there is no apply button and no draft state.
   *
   * A native <dialog> rather than a hand-rolled sheet — showModal() brings the
   * focus trap, the Esc key and an inert page with it (WCAG 2.4.3, 2.1.2).
   */
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
  } from './presets';
  import Icon from './Icon.svelte';
  import type { EditorState } from './editor-state.svelte';
  import { t } from '../i18n';

  let {
    editor,
    onClose,
    onSaveNow,
    onOpenFile,
    onOpenDrafts,
    onOpenPlugins,
  }: {
    editor: EditorState;
    onClose: () => void;
    onSaveNow?: () => void;
    /** The file dialog, the draft list and the plugins window live in the editor. */
    onOpenFile?: () => void;
    onOpenPlugins?: () => void;
    onOpenDrafts?: () => void;
  } = $props();

  /** Without the API the option would be a switch that does nothing. */
  const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

  let dialogEl = $state<HTMLDialogElement | undefined>();
  let paletteFile = $state<HTMLInputElement | undefined>();
  let draftFile = $state<HTMLInputElement | undefined>();
  /** What the last import or save did, shown until the next one. */
  let report = $state('');

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
    } finally {
      exporting = null;
    }
  }

  /** Reference «постоянное хранилище»: drafts the browser may not evict. */
  async function askPersist(): Promise<void> {
    const granted = await navigator.storage?.persist?.().catch(() => false);
    report = granted
      ? t('settings.persist_on')
      : t('settings.persist_off');
  }

  /** Hands the browser a file to save; nothing here touches the network. */
  function download(name: string, text: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onPaletteFile(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const loaded = editor.importSavedPalettes(await file.text());
    report = loaded > 0
      ? t('settings.palettes_loaded', { count: loaded })
      : t('settings.no_palettes');
  }

  async function onDraftFile(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (editor.warnings && !confirm(t('settings.drafts_confirm', { name: file.name }))) {
      return;
    }
    const { loaded, broken } = await importDrafts(await file.text());
    report = loaded > 0 || broken > 0
      ? t('settings.drafts_loaded', { loaded, broken })
      : t('settings.no_drafts');
    drafts = draftEntries(await listDrafts());
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
  class="file"
  type="file"
  accept="application/json,.json"
  aria-label={t('settings.palette_file')}
  onchange={onPaletteFile}
/>
<input
  bind:this={draftFile}
  class="file"
  type="file"
  accept=".toonops,.toonio,application/json,.json"
  aria-label={t('settings.draft_file')}
  onchange={onDraftFile}
/>

<dialog bind:this={dialogEl} class="sheet sheet-dialog" aria-label={t('settings.sheet')} onclose={onClose}>
  <header class="sheet-head">
    <h2>{t('settings.sheet')}</h2>
    <button class="key icon" onclick={() => dialogEl?.close()} aria-label={t('picker.close')}>
      <Icon name="x" />
    </button>
  </header>

  <div class="sheet-body">
    <p class="sheet-hint">{t('settings.drawing')}</p>
    <!--
      The option is Tonio's `toonio_old_pen`: one point per event instead of
      the coalesced batch. It is the editor's own, not a brush's — the batch
      is what every brush is handed, so the switch is offered whatever is in
      hand. (The old pen it used to mean here is a type of the brush now,
      picked in the brush box.)
    -->
    <label class="toggle">
      <span class="toggle-label">{t('settings.mouse_mode')}</span>
      <input
        type="checkbox"
        role="switch"
        checked={editor.settings.mouseMode}
        onchange={(e) => editor.setSetting('mouseMode', e.currentTarget.checked)}
      />
    </label>
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

    <p class="sheet-hint">{t('settings.palette')}</p>
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
          oninput={(e) => editor.setSetting('paletteLimit', Number(e.currentTarget.value))}
        />
        <output>{editor.settings.paletteLimit}</output>
      </span>
    </label>
    <div class="actions">
      <button
        class="key"
        onclick={() => download('palettes.json', editor.exportSavedPalettes())}
      >{t('settings.download_palettes')}</button>
      <button class="key" onclick={() => paletteFile?.click()}>{t('settings.load_palettes')}</button>
      <button class="key danger" onclick={wipePalettes}>{t('settings.wipe_palettes')}</button>
    </div>

    <p class="sheet-hint">{t('settings.autosave')}</p>
    <label class="row">
      <span class="row-label">{t('settings.interval')}</span>
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
    {#if drafts.length > 0}
      <ul class="picklist">
        {#each drafts as entry (entry.id)}
          <li>
            <label class="toggle">
              <span class="toggle-label">
                {new Date(entry.updated).toLocaleString('ru')}
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
    {/if}
    {#if exporting}
      <progress value={exporting.done} max={exporting.total} aria-label={t('settings.download_drafts')}>
        {t('settings.progress', { done: exporting.done, total: exporting.total })}
      </progress>
    {/if}
    <div class="actions">
      <button class="key" disabled={chosen.length === 0 || exporting !== null} onclick={saveDraftsFile}>
        {t('settings.download_drafts')}
      </button>
      <button class="key" onclick={() => draftFile?.click()}>{t('settings.load_drafts')}</button>
      {#if onOpenDrafts}
        <button class="key" onclick={onOpenDrafts}>{t('settings.drafts')}</button>
      {/if}
      {#if onOpenFile}
        <button class="key" onclick={onOpenFile}>{t('settings.open_toon')}</button>
      {/if}
      {#if onSaveNow}
        <button class="key" onclick={onSaveNow}>{t('settings.save_now')}</button>
      {/if}
      <button class="key" onclick={askPersist}>{t('settings.ask_persist')}</button>
    </div>

    <p class="sheet-hint">{t('settings.view')}</p>
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

    <!-- Reference «Настроить панель»: which buttons the toolbar shows, and the
         preset they come from. The gear is never hideable, so this is always
         reachable. Last, because it is a set-once concern. -->
    <p class="sheet-hint">{t('settings.panel')}</p>
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

    <!-- Расположение: arranged by hand in the editor, where the panels are.
         A list of selects said the same thing twice and nobody used it. -->
    <p class="sheet-hint">{t('settings.arrangement')}</p>
    <div class="actions">
      <button
        class="key primary"
        onclick={() => {
          editor.arranging = true;
          dialogEl?.close();
        }}
      >{t('settings.edit_panels')}</button>
    </div>

    <p class="sheet-hint">{t('settings.plugins')}</p>
    <div class="actions">
      <button
        class="key primary"
        onclick={() => {
          onOpenPlugins?.();
          dialogEl?.close();
        }}
      >{t('settings.plugins')}</button>
    </div>
    <label class="field">
      <span>{t('settings.catalog_url')}</span>
      <input
        type="url"
        placeholder={t('settings.catalog_placeholder')}
        value={editor.settings.pluginCatalog}
        onchange={(e) => editor.setSetting('pluginCatalog', e.currentTarget.value.trim())}
      />
    </label>

    {#if report}
      <p class="report" role="status">{report}</p>
    {/if}
  </div>

  <footer class="sheet-foot">
    <button class="key primary" onclick={() => dialogEl?.close()}>{t('settings.done')}</button>
  </footer>
</dialog>

<style>
  /* Preset chips: one row, equal shares (same control as the old sheet). */
  .presets {
    display: flex;
    gap: 0.4rem;
  }
  .preset-chip {
    flex: 1;
    height: var(--key-h);
    padding: 0 0.5rem;
    border: none;
    border-radius: var(--r-sm);
    background: var(--sub);
    color: var(--ink);
    font: inherit;
    font-weight: 650;
    cursor: pointer;
  }
  .preset-chip:hover {
    background: color-mix(in oklab, var(--sub), var(--text) 8%);
  }
  .preset-chip.active {
    background: var(--accent);
    border-color: transparent;
    color: var(--canvas);
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
  .picklist .toggle-label {
    flex-direction: column;
    align-items: flex-start;
    gap: 0.1rem;
  }
  .picklist small {
    font-size: 0.8rem;
    opacity: 0.7;
  }
  .file {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
    pointer-events: none;
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
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: var(--key-h);
    padding: 0.35rem 0.3rem;
  }
  .row-label {
    font-size: 0.95rem;
  }
  .slider {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .slider input {
    width: 9rem;
    accent-color: var(--accent);
  }
  .slider output {
    min-width: 2.2rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  select {
    min-height: var(--key-h);
    padding: 0 0.5rem;
    border: 1px solid var(--edge);
    border-radius: var(--r-sm);
    background: var(--canvas);
    color: inherit;
    font: inherit;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    padding: 0.3rem 0 0.1rem;
  }
  .report {
    margin: 0.7rem 0 0.2rem;
    font-size: 0.9rem;
    color: var(--ink-2);
  }
</style>

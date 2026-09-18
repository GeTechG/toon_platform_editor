<script lang="ts">
  /**
   * The reference's settings window (`index.html #settings`): drawing,
   * palette, autosave and view. Every control writes straight through to the
   * persisted UI config, so there is no apply button and no draft state.
   *
   * A native <dialog> rather than a hand-rolled sheet — showModal() brings the
   * focus trap, the Esc key and an inert page with it (WCAG 2.4.3, 2.1.2).
   */
  import { exportDrafts, importDrafts } from '../draft/store';
  import {
    AUTOSAVE_INTERVALS,
    AUTOSAVE_LABELS,
    PALETTE_LIMIT_MAX,
    PALETTE_LIMIT_MIN,
    PALETTE_LIMIT_STEP,
  } from './presets';
  import Icon from './Icon.svelte';
  import type { EditorState } from './editor-state.svelte';

  let { editor, onClose }: { editor: EditorState; onClose: () => void } = $props();

  let dialogEl = $state<HTMLDialogElement | undefined>();
  let paletteFile = $state<HTMLInputElement | undefined>();
  let draftFile = $state<HTMLInputElement | undefined>();
  /** What the last import or save did, shown until the next one. */
  let report = $state('');

  $effect(() => {
    dialogEl?.showModal();
  });

  const PLURAL = new Intl.PluralRules('ru');
  function plural(n: number, one: string, few: string, many: string): string {
    const form = PLURAL.select(n);
    return `${n} ${form === 'one' ? one : form === 'few' ? few : many}`;
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
      ? `Загружено ${plural(loaded, 'палитра', 'палитры', 'палитр')}`
      : 'В файле нет палитр';
  }

  async function onDraftFile(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const { loaded } = await importDrafts(await file.text());
    report = loaded > 0
      ? `Загружено ${plural(loaded, 'черновик', 'черновика', 'черновиков')}`
      : 'В файле нет черновиков';
  }

  function wipePalettes(): void {
    if (confirm('Удалить все сохранённые палитры? Отменить это будет нельзя.')) {
      editor.deleteAllSavedPalettes();
      report = 'Сохранённые палитры удалены';
    }
  }
</script>

<!-- Both pickers stay out of the layout; the visible buttons click them. -->
<input
  bind:this={paletteFile}
  class="file"
  type="file"
  accept="application/json,.json"
  aria-label="Файл палитр"
  onchange={onPaletteFile}
/>
<input
  bind:this={draftFile}
  class="file"
  type="file"
  accept="application/json,.json"
  aria-label="Файл черновиков"
  onchange={onDraftFile}
/>

<dialog bind:this={dialogEl} class="sheet sheet-dialog" aria-label="Настройки" onclose={onClose}>
  <header class="sheet-head">
    <h2>Настройки</h2>
    <button class="key icon" onclick={() => dialogEl?.close()} aria-label="Закрыть">
      <Icon name="x" />
    </button>
  </header>

  <div class="sheet-body">
    <p class="sheet-hint">Рисование</p>
    <label class="toggle">
      <span class="toggle-label">Режим мышки (старое перо)</span>
      <input
        type="checkbox"
        role="switch"
        checked={editor.settings.mouseMode}
        onchange={(e) => editor.setSetting('mouseMode', e.currentTarget.checked)}
      />
    </label>
    <label class="toggle">
      <span class="toggle-label">Крест на курсоре при тонкой кисти</span>
      <input
        type="checkbox"
        role="switch"
        checked={editor.settings.crossCursor}
        onchange={(e) => editor.setSetting('crossCursor', e.currentTarget.checked)}
      />
    </label>
    <label class="toggle">
      <span class="toggle-label">Блокировать редактор в трансформации</span>
      <input
        type="checkbox"
        role="switch"
        checked={editor.settings.lockTransform}
        onchange={(e) => editor.setSetting('lockTransform', e.currentTarget.checked)}
      />
    </label>

    <p class="sheet-hint">Палитра</p>
    <label class="toggle">
      <span class="toggle-label">Добавлять выбранный цвет в палитру</span>
      <input
        type="checkbox"
        role="switch"
        checked={editor.settings.paletteAutoAdd}
        onchange={(e) => editor.setSetting('paletteAutoAdd', e.currentTarget.checked)}
      />
    </label>
    <label class="row">
      <span class="row-label">Цветов в палитре</span>
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
      >Скачать палитры</button>
      <button class="key" onclick={() => paletteFile?.click()}>Загрузить палитры…</button>
      <button class="key danger" onclick={wipePalettes}>Удалить все</button>
    </div>

    <p class="sheet-hint">Автосохранение</p>
    <label class="row">
      <span class="row-label">Интервал</span>
      <select
        value={editor.settings.autosaveMs}
        onchange={(e) => editor.setSetting('autosaveMs', Number(e.currentTarget.value))}
      >
        {#each AUTOSAVE_INTERVALS as ms (ms)}
          <option value={ms}>{AUTOSAVE_LABELS[ms]}</option>
        {/each}
      </select>
    </label>
    <label class="toggle">
      <span class="toggle-label">Показывать черновики при открытии</span>
      <input
        type="checkbox"
        role="switch"
        checked={editor.settings.showDraftsOnStart}
        onchange={(e) => editor.setSetting('showDraftsOnStart', e.currentTarget.checked)}
      />
    </label>
    <div class="actions">
      <button
        class="key"
        onclick={async () => download('drafts.json', await exportDrafts())}
      >Скачать черновики</button>
      <button class="key" onclick={() => draftFile?.click()}>Загрузить черновики…</button>
    </div>

    <p class="sheet-hint">Вид</p>
    <label class="toggle">
      <span class="toggle-label">Тёмная тема <kbd>N</kbd></span>
      <input
        type="checkbox"
        role="switch"
        checked={editor.settings.theme === 'dark'}
        onchange={(e) => editor.setSetting('theme', e.currentTarget.checked ? 'dark' : 'light')}
      />
    </label>
    <label class="toggle">
      <span class="toggle-label">Серый холст в тёмной теме</span>
      <input
        type="checkbox"
        role="switch"
        disabled={editor.settings.theme !== 'dark'}
        checked={editor.settings.greyCanvas}
        onchange={(e) => editor.setSetting('greyCanvas', e.currentTarget.checked)}
      />
    </label>

    {#if report}
      <p class="report" role="status">{report}</p>
    {/if}
  </div>

  <footer class="sheet-foot">
    <button class="key primary" onclick={() => dialogEl?.close()}>Готово</button>
  </footer>
</dialog>

<style>
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
    background: rgba(11, 12, 16, 0.42);
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
    accent-color: var(--electric);
  }
  .slider output {
    min-width: 2.2rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  select {
    min-height: var(--key-h);
    padding: 0 0.5rem;
    border: 1px solid var(--hairline);
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
  kbd {
    padding: 0.1rem 0.35rem;
    border: 1px solid var(--hairline);
    border-radius: var(--r-sm);
    background: var(--paper);
    font: inherit;
    font-size: 0.78rem;
  }
</style>

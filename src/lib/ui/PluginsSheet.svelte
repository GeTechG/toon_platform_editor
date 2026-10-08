<script lang="ts">
  /**
   * The plugins window: what is installed, and what can be installed.
   *
   * Two tabs and nothing else — «Мои» holds what runs (with the button that
   * puts a bundle in from disk), «Каталог» holds what the address offers. A
   * native <dialog>, like the settings sheet: showModal() brings the focus
   * trap, the Esc key and an inert page with it (WCAG 2.4.3, 2.1.2).
   */
  import { tick } from 'svelte';
  import { BUNDLED_PLUGIN, plugins } from '../plugins';
  import {
    compareVersions,
    readCatalog,
    reviewed,
    type CatalogEntry,
  } from '../plugins/catalog';
  import { download, forPerson, sessionPlugins } from '../plugins/install';
  import { listInstalled, type InstalledPlugin } from '../plugins/store';
  import Icon from './Icon.svelte';
  import type { EditorState } from './editor-state.svelte';
  import { t } from '../i18n';
  import { pluginNamespace, pluginText } from '../plugins/contract';

  let { editor, onClose }: { editor: EditorState; onClose: () => void } = $props();

  let dialogEl = $state<HTMLDialogElement | undefined>();
  let warnEl = $state<HTMLDialogElement | undefined>();
  /**
   * An install waiting on the warning: a file, or a catalog at an address
   * other than ours. `run` goes ahead on «Установить».
   */
  let pending = $state<{ name: string; run: () => Promise<void> } | null>(null);
  let bundleFile = $state<HTMLInputElement | undefined>();
  let mineTab = $state<HTMLButtonElement | undefined>();
  let catalogTab = $state<HTMLButtonElement | undefined>();
  let tab = $state<'mine' | 'catalog'>('mine');
  let installed = $state<InstalledPlugin[]>([]);
  /** Ids in the list that storage refused: they run until a reload. */
  let onlyNow = $state<string[]>([]);
  let catalog = $state<CatalogEntry[]>([]);
  /** Why the catalog has nothing to show, when it has nothing to show. */
  let catalogError = $state('');
  /** The address is being read: nothing to show yet is not an empty catalog. */
  let catalogLoading = $state(true);
  /** The plugin being downloaded right now; its row says so. */
  let busy = $state('');
  /** What the last install or removal did, shown until the next one. */
  let report = $state('');
  /** Aborted when the sheet goes: a download does not outlive the window it is for. */
  const leaving = new AbortController();
  $effect(() => () => leaving.abort());

  $effect(() => {
    dialogEl?.showModal();
  });

  // Modal over the modal: the plugins window goes inert under it, and Esc or
  // «Отмена» brings the focus back where it was.
  $effect(() => {
    if (pending) {
      warnEl?.showModal();
    }
  });

  function answer(go: boolean): void {
    const run = go ? pending?.run : undefined;
    pending = null;
    warnEl?.close();
    // The warning hands the focus back to what held it before: after a
    // download that was the page, the key having gone disabled under it.
    void (run ? run() : keepFocus());
  }

  /**
   * Our catalog installs at once: it went through a pull request. A catalog
   * at another address is somebody's code and says so first.
   */
  async function askInstall(entry: CatalogEntry): Promise<void> {
    busy = entry.id;
    const got = await download(entry.url, undefined, leaving.signal);
    // The sheet closed under the download: the request is off, and there is
    // no window left to report into.
    if (leaving.signal.aborted) {
      return;
    }
    busy = '';
    if (typeof got === 'string') {
      // `download` has put the browser's own words in the console already.
      const failed = got;
      report = t('plugins.failed_report', { name: entry.name, reason: forPerson(failed) });
      await keepFocus();
      return;
    }
    if (reviewed(entry)) {
      await install(entry, got.code);
      return;
    }
    pending = { name: entry.name, run: () => install(entry, got.code) };
  }

  async function refresh(): Promise<void> {
    const stored = await listInstalled();
    // Refused by storage, it still runs — and has to be seen to be taken off.
    const session = sessionPlugins(plugins).filter((plugin) => !stored.some((kept) => kept.id === plugin.id));
    onlyNow = session.map((plugin) => plugin.id);
    installed = [...stored, ...session];
  }

  /**
   * The delivery first, then what was installed. It is a plugin like any
   * other — the same register, the same breakage — but not a choice anybody
   * made, so there is nothing to take off.
   */
  const delivery: InstalledPlugin = {
    id: BUNDLED_PLUGIN.id,
    name: pluginText(BUNDLED_PLUGIN.name, pluginNamespace(BUNDLED_PLUGIN.id)) ?? BUNDLED_PLUGIN.id,
    version: BUNDLED_PLUGIN.version ?? '',
    description: pluginText(BUNDLED_PLUGIN.description, pluginNamespace(BUNDLED_PLUGIN.id)) ?? '',
    icon: BUNDLED_PLUGIN.icon ?? '',
    code: '',
    source: 'bundled',
    installed: 0,
  };
  const listed = $derived([delivery, ...installed]);

  // The catalog is read when the window opens and again whenever the address
  // changes — an author pointing the editor at their own build sees it at once.
  /** «Повторить» after a failed read: a phone that lost the network gets it back. */
  let attempt = $state(0);
  $effect(() => {
    void attempt;
    const address = editor.settings.pluginCatalog;
    // An answer for an address that has since changed is not written over the
    // newer one's.
    let current = true;
    // Leaving the sheet, or a newer address, calls this read off: it does not
    // hang on in the background after nobody waits for it.
    const reading = new AbortController();
    catalogLoading = true;
    void (async () => {
      const read = await readCatalog(address, undefined, reading.signal);
      if (!current || read.aborted) {
        return;
      }
      // A record under the delivery's id is not on offer: the delivery
      // changes with the editor, not past it.
      catalog = read.plugins.filter((entry) => !plugins.isBundled(entry.id));
      catalogError = read.error ?? '';
      catalogLoading = false;
      await keepFocus();
    })();
    return () => {
      current = false;
      reading.abort();
    };
  });

  $effect(() => {
    void refresh();
  });

  /** What the register knows about a plugin right now: off, and why. */
  function broken(id: string): string | undefined {
    void editor.pluginsVersion;
    return plugins.brokenReason(id);
  }

  /**
   * Installed and not in the register — refused at the start, written for
   * another editor — and why, in the person's words. Such a row looked like
   * a working plugin whose tools were simply nowhere.
   */
  function notLoaded(plugin: InstalledPlugin): string | undefined {
    void editor.pluginsVersion;
    const reason = plugin.source === 'bundled' ? undefined : plugins.loadFailure(plugin.id);
    return reason && forPerson(reason);
  }

  function installedOf(id: string): InstalledPlugin | undefined {
    return installed.find((plugin) => plugin.id === id);
  }

  async function install(entry: CatalogEntry, code: string): Promise<void> {
    busy = entry.id;
    try {
      const failed = await editor.installPlugin(entry, code);
      if (failed) console.error(`plugin ${entry.id} refused:`, failed);
      report = failed ? t('plugins.failed_report', { name: entry.name, reason: forPerson(failed) }) : t('plugins.installed_report', { name: entry.name });
    } finally {
      busy = '';
    }
    await refresh();
    // The key went disabled while it downloaded, and an installed record has
    // no key at all: either way the focus fell to the page.
    await keepFocus();
  }

  /**
   * A key that goes away under the hand — «Установить», «Повторить»,
   * «Удалить», «Включить» — drops the focus to the page, outside the modal.
   * It comes back to the tab in hand: the report is in the foot's live
   * region, the list starts under it.
   */
  async function keepFocus(): Promise<void> {
    await tick();
    if (!dialogEl?.contains(document.activeElement)) {
      (tab === 'mine' ? mineTab : catalogTab)?.focus();
    }
  }

  async function remove(plugin: InstalledPlugin): Promise<void> {
    // Asked first, the way «Удалить все» palettes is. One put in from a file
    // has no catalog to come back from: only the same file brings it back.
    const question = plugin.source === 'local' ? 'plugins.remove_local_confirm' : 'plugins.remove_confirm';
    if (!(await editor.ask(t(question, { name: plugin.name }), t('ask.delete'), true))) {
      return;
    }
    const kept = await editor.removePlugin(plugin.id);
    report = t(kept ? 'plugins.removed_report' : 'plugins.remove_not_kept', { name: plugin.name });
    await refresh();
    await keepFocus();
  }

  async function enable(id: string): Promise<void> {
    editor.enablePlugin(id);
    await keepFocus();
  }

  async function onBundleFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    let code: string;
    try {
      code = await file.text();
    } catch (error) {
      // Moved, deleted or taken back by the system between the pick and the
      // read: said here, not an unhandled rejection.
      console.warn('plugin file unreadable:', error);
      const failed = t('plugins.file_unreadable');
      report = t('plugins.failed_report', { name: file.name, reason: forPerson(failed) });
      return;
    }
    // A file went through nobody's review: it always says so first.
    pending = { name: file.name, run: () => installFile(file.name, code) };
  }

  async function installFile(fileName: string, code: string): Promise<void> {
    busy = fileName;
    try {
      const failed = await editor.installPluginFile(code);
      // The register's reason is for the plugin's author: the console and the
      // Alt+L log keep it whole, the window says what the person can do.
      if (failed) console.error(`plugin file ${fileName} refused:`, failed);
      report = failed ? t('plugins.failed_report', { name: fileName, reason: forPerson(failed) }) : t('plugins.installed_report', { name: fileName });
    } finally {
      busy = '';
    }
    await refresh();
  }

  /**
   * A catalog icon is markup from the network, drawn before anyone has
   * trusted the plugin — so it goes into an image, where a script inside the
   * SVG does not run. The icon kept with an installed record is that same
   * text (or a file's), so «Мои» draws it the same way; a tool's own icon
   * comes from the code the editor is already running, and is markup.
   */
  function iconUrl(markup: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0b0c10" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${markup}</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  /** What the catalog's button does with a record, given what is installed. */
  function offer(entry: CatalogEntry): 'install' | 'update' | 'reinstall' | 'installed' | 'local' {
    const mine = installedOf(entry.id);
    if (!mine) {
      return 'install';
    }
    if (mine.source === 'local') {
      return 'local';
    }
    if (compareVersions(entry.version, mine.version) > 0) {
      return 'update';
    }
    // Installed and not loaded: «установлен» with no key left it broken for good.
    return notLoaded(mine) ? 'reinstall' : 'installed';
  }
</script>

<input
  bind:this={bundleFile}
  type="file"
  hidden
  accept=".js,text/javascript"
  aria-label={t('plugins.file')}
  onchange={onBundleFile}
/>

<dialog bind:this={dialogEl} class="sheet sheet-dialog" aria-label={t('plugins.sheet')} onclose={onClose}>
  <header class="sheet-head">
    <h2>{t('plugins.sheet')}</h2>
    <button class="key icon" onclick={() => dialogEl?.close()} aria-label={t('picker.close')}>
      <Icon name="x" />
    </button>
  </header>

  <!-- The picked tab is tinted like a picked key: a red one was a second red
       key beside «Готово» (the Signal Rule). -->
  <!-- Two buttons that swap what is under them, not an ARIA tablist: `role="tab"`
       promises arrow-key navigation, `aria-controls` and tabpanels that this does
       not implement. `aria-pressed` states the same thing honestly, and the group
       carries the label — the same call the site's auth dialog wrote down. -->
  <div class="tabs" role="group" aria-label={t('plugins.sheet')}>
    <button
      bind:this={mineTab}
      class="key"
      class:active={tab === 'mine'}
      aria-pressed={tab === 'mine'}
      onclick={() => (tab = 'mine')}
    >{t('plugins.mine')}</button>
    <button
      bind:this={catalogTab}
      class="key"
      class:active={tab === 'catalog'}
      aria-pressed={tab === 'catalog'}
      onclick={() => (tab = 'catalog')}
    >{t('plugins.catalog')}</button>
  </div>

  <div class="sheet-body">
    {#if tab === 'mine'}
      <div class="actions">
        <button class="key" onclick={() => bundleFile?.click()}>{t('plugins.install_file')}</button>
      </div>
      {#if installed.length === 0}
        <p class="empty">{t('plugins.empty')}</p>
      {/if}
      {#if listed.length > 0}
        <ul class="plugins">
          {#each listed as plugin (plugin.id)}
            <li class:off={broken(plugin.id) || notLoaded(plugin)}>
              <!-- A record's icon came with the catalog's index or a file's
                   manifest and was kept as text: a catalog at another address
                   may list our own bundle — installed with no warning — under
                   markup of its own. Only the delivery's is drawn as markup. -->
              <span class="face" aria-hidden="true">
                {#if plugin.source === 'bundled'}<Icon name={plugin.icon} />{:else if plugin.icon}<img src={iconUrl(plugin.icon)} alt="" width="48" height="48" />{/if}
              </span>
              <span class="about">
                <span class="name">{plugin.name} <span class="saved">{plugin.version}</span></span>
                <small>
                  {plugin.source === 'bundled'
                    ? t('plugins.source_bundled')
                    : plugin.source === 'local' ? t('plugins.source_local') : t('plugins.source_catalog')}
                  {#if onlyNow.includes(plugin.id)}
                    {t('plugins.session')}
                  {/if}
                  {#if broken(plugin.id)}
                    {t('plugins.broken')}
                  {:else if notLoaded(plugin)}
                    {t('plugins.not_loaded', { reason: notLoaded(plugin) })}
                  {/if}
                </small>
              </span>
              {#if broken(plugin.id)}
                <button class="key" onclick={() => enable(plugin.id)}>{t('plugins.enable')}</button>
              {/if}
              {#if plugin.source !== 'bundled'}
                <button class="key" onclick={() => remove(plugin)}>{t('plugins.remove')}</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {:else if catalogLoading}
      <p class="empty">{t('plugins.catalog_loading')}</p>
    {:else if catalogError}
      <p class="empty">{catalogError}</p>
      {#if editor.settings.pluginCatalog.trim()}
        <div class="actions">
          <button class="key" onclick={() => attempt++}>{t('plugins.retry')}</button>
        </div>
      {/if}
    {:else if catalog.length === 0}
      <p class="empty">{t('plugins.catalog_empty')}</p>
    {:else}
      <ul class="plugins">
        {#each catalog as entry (entry.id)}
          <li>
            <span class="face">
              {#if entry.icon}<img src={iconUrl(entry.icon)} alt="" width="48" height="48" />{/if}
            </span>
            <span class="about">
              <span class="name">{entry.name} <span class="saved">{entry.version}</span></span>
              <small>{entry.description}</small>
            </span>
            {#if offer(entry) === 'installed'}
              <span class="saved">{t('plugins.installed')}</span>
            {:else if offer(entry) === 'local'}
              <span class="saved">{t('plugins.local')}</span>
            {:else}
              <!-- One download at a time: two left `busy` to the one that ended
                   first, and the other's key came back mid-download. -->
              <button class="key" disabled={busy !== ''} onclick={() => void askInstall(entry)}>
                {busy === entry.id ? t('plugins.downloading') : offer(entry) === 'update' ? t('plugins.update') : offer(entry) === 'reinstall' ? t('plugins.reinstall') : t('plugins.install')}
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <!-- What the last install or removal did, in the foot where it is seen
       whatever the list's scroll, and mounted before its words. -->
  <footer class="sheet-foot">
    <button class="key primary" onclick={() => dialogEl?.close()}>{t('plugins.done')}</button>
    <p class="report" role="status">{report}</p>
  </footer>

  <!-- Inside the window, so the window stays open under it. Esc is «Отмена». -->
  {#if pending}
    <dialog
      bind:this={warnEl}
      class="sheet sheet-dialog warn"
      aria-labelledby="plugin-warn-title"
      aria-describedby="plugin-warn-body"
      oncancel={(e) => { e.preventDefault(); answer(false); }}
    >
      <header class="sheet-head">
        <h2 id="plugin-warn-title">{t('plugins.warn_title')}</h2>
      </header>
      <p id="plugin-warn-body" class="warn-body">{t('plugins.warn_body', { name: pending.name })}</p>
      <footer class="sheet-foot">
        <button class="key" onclick={() => answer(false)}>{t('plugins.warn_cancel')}</button>
        <!-- Not red: somebody's code is not the step the window pushes toward
             (and one red key per sheet file). -->
        <button class="key" onclick={() => answer(true)}>{t('plugins.warn_install')}</button>
      </footer>
    </dialog>
  {/if}
</dialog>

<style>
  /* The shape comes from the shared `.sheet` chrome; a <dialog> only needs its
     own defaults cleared and a backdrop of its own. */
  .sheet-dialog {
    margin: 0;
    padding: 0;
    max-width: none;
    border: none;
    color: var(--ink);
    /* A screen of the studio, like the settings it is opened from: it only
       fades in (controls.css `studio-pop`). The warning inside it too. */
    --pop-from: 0px;
    animation: studio-pop var(--dur-enter) var(--ease-out);
  }
  /* The scrim only fades: moved with the sheet, it showed its own edge. Its
     own keyframe — a browser whose backdrop cannot read the tokens (before
     Safari 17.4) drops the line and the scrim simply stands. */
  .sheet-dialog::backdrop {
    background: var(--scrim);
    animation: scrim-in var(--dur-enter) var(--ease-out);
  }
  @keyframes scrim-in {
    from {
      opacity: 0;
    }
  }
  .tabs {
    display: flex;
    gap: 0.4rem;
    /* Off the header's hairline: the tabs sat right on it. */
    padding: 0.6rem 1rem 0;
  }
  .tabs .key {
    flex: 1;
  }
  .actions {
    display: flex;
    gap: 0.4rem;
    padding: 0.3rem 0 0.6rem;
  }
  .plugins {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .plugins li {
    display: flex;
    /* At 200 % text on a phone the face, the words and two keys do not fit
       one line: squeezed, «Включить» broke letter by letter inside a key a
       finger tall. The keys take the next line whole instead. */
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    padding: 0.45rem 0.2rem;
    border-top: 1px solid var(--hairline);
  }
  /* Switched off is quieter, not louder: secondary text is what the system
     already says for «present but not in play». */
  .plugins li.off .name {
    color: var(--ink-2);
  }
  /* The plugin's face, big enough to read: the row grows to it. Not `.icon`:
     the close key wears that class too, and its cross grew to the whole key. */
  .face {
    display: inline-flex;
    /* In rem: the face is an icon too, and grows with the text like the rest. */
    width: 3rem;
    height: 3rem;
    justify-content: center;
    flex: none;
  }
  .face :global(svg),
  .face img {
    width: 100%;
    height: 100%;
  }
  .about {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    flex: 1 1 5rem;
    min-width: 0;
  }
  .plugins li > .key {
    flex: none;
    /* The body breaks anywhere; a key's word stays whole. */
    overflow-wrap: normal;
  }
  .name {
    font-weight: 650;
  }
  .about small {
    font-size: 0.8rem;
    opacity: 0.7;
  }
  .empty {
    margin: 0.6rem 0;
    color: var(--ink-2);
  }
  /* The register's reasons are lower-case, made to follow «имя: »; alone on
     a line they start a sentence. */
  .empty::first-letter {
    text-transform: uppercase;
  }
  .warn-body {
    margin: 0;
    padding: 0.8rem 1rem;
    max-width: 32rem;
  }
  .report {
    flex: 1;
    align-self: center;
    margin: 0;
    font-size: 0.9rem;
    color: var(--ink-2);
  }
</style>

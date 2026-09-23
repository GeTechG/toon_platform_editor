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
  import { compareVersions, readCatalog, type CatalogEntry } from '../plugins/catalog';
  import { forPerson } from '../plugins/install';
  import { listInstalled, type InstalledPlugin } from '../plugins/store';
  import Icon from './Icon.svelte';
  import type { EditorState } from './editor-state.svelte';
  import { t } from '../i18n';
  import { pluginNamespace, pluginText } from '../plugins/contract';

  let { editor, onClose }: { editor: EditorState; onClose: () => void } = $props();

  let dialogEl = $state<HTMLDialogElement | undefined>();
  let bundleFile = $state<HTMLInputElement | undefined>();
  let mineTab = $state<HTMLButtonElement | undefined>();
  let catalogTab = $state<HTMLButtonElement | undefined>();
  let tab = $state<'mine' | 'catalog'>('mine');
  let installed = $state<InstalledPlugin[]>([]);
  let catalog = $state<CatalogEntry[]>([]);
  /** Why the catalog has nothing to show, when it has nothing to show. */
  let catalogError = $state('');
  /** The address is being read: nothing to show yet is not an empty catalog. */
  let catalogLoading = $state(true);
  /** The plugin being downloaded right now; its row says so. */
  let busy = $state('');
  /** What the last install or removal did, shown until the next one. */
  let report = $state('');

  $effect(() => {
    dialogEl?.showModal();
  });

  async function refresh(): Promise<void> {
    installed = await listInstalled();
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
    catalogLoading = true;
    void (async () => {
      const read = await readCatalog(address);
      if (!current) {
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

  function installedOf(id: string): InstalledPlugin | undefined {
    return installed.find((plugin) => plugin.id === id);
  }

  async function install(entry: CatalogEntry): Promise<void> {
    busy = entry.id;
    try {
      const failed = await editor.installPlugin(entry);
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
    busy = file.name;
    try {
      const failed = await editor.installPluginFile(await file.text());
      // The register's reason is for the plugin's author: the console and the
      // Alt+L log keep it whole, the window says what the person can do.
      if (failed) console.error(`plugin file ${file.name} refused:`, failed);
      report = failed ? t('plugins.failed_report', { name: file.name, reason: forPerson(failed) }) : t('plugins.installed_report', { name: file.name });
    } finally {
      busy = '';
    }
    await refresh();
  }

  /**
   * A catalog icon is markup from the network, drawn before anyone has
   * trusted the plugin — so it goes into an <img>, where a script inside the
   * SVG does not run. An installed plugin's own icon comes from its code,
   * which the editor is already running, and is drawn as markup like any other.
   */
  function iconUrl(markup: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#0b0c10" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${markup}</svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }

  /** What the catalog's button does with a record, given what is installed. */
  function offer(entry: CatalogEntry): 'install' | 'update' | 'installed' | 'local' {
    const mine = installedOf(entry.id);
    if (!mine) {
      return 'install';
    }
    if (mine.source === 'local') {
      return 'local';
    }
    return compareVersions(entry.version, mine.version) > 0 ? 'update' : 'installed';
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
            <li class:off={broken(plugin.id)}>
              <span class="face" aria-hidden="true">
                {#if plugin.icon}<Icon name={plugin.icon} />{/if}
              </span>
              <span class="about">
                <span class="name">{plugin.name} <span class="saved">{plugin.version}</span></span>
                <small>
                  {plugin.source === 'bundled'
                    ? t('plugins.source_bundled')
                    : plugin.source === 'local' ? t('plugins.source_local') : t('plugins.source_catalog')}
                  {#if broken(plugin.id)}
                    {t('plugins.broken')}
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
              <button class="key" disabled={busy === entry.id} onclick={() => install(entry)}>
                {busy === entry.id ? t('plugins.downloading') : offer(entry) === 'update' ? t('plugins.update') : t('plugins.install')}
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
  }
  .sheet-dialog::backdrop {
    background: var(--scrim);
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
    width: 48px;
    height: 48px;
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
    flex: 1;
    min-width: 0;
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
  .report {
    flex: 1;
    align-self: center;
    margin: 0;
    font-size: 0.9rem;
    color: var(--ink-2);
  }
</style>

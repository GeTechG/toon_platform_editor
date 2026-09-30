/**
 * Installing, loading and updating a plugin.
 *
 * A plugin is installed one at a time: its bundle is downloaded, checked
 * against the register, and kept in storage as text. It runs from that text —
 * a module built out of a blob — so an installed plugin needs neither the
 * network nor the catalog, and an update is a real download rather than a
 * hope about an HTTP cache.
 *
 * Nothing here throws into the editor: every failure comes back as a reason.
 */

import { BUNDLE_TIMEOUT_MS, compareVersions, reviewed, type CatalogEntry } from './catalog';
import { seconds, timedOut, withDeadline } from './deadline';
import { pluginNamespace, pluginText, type Plugin } from './contract';
import type { PluginRegistry } from './registry';
import { listInstalled, putInstalled, type InstalledPlugin } from './store';
import { t } from '../i18n';

export interface InstallPorts {
  fetch: (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok?: boolean; status?: number; text(): Promise<string> }>;
  /** How long a bundle gets, in ms; `BUNDLE_TIMEOUT_MS` unless a test says otherwise. */
  timeout?: number;
  /** Turns a bundle into a module; its own port so a test needs no browser. */
  evaluate: (code: string) => Promise<Record<string, unknown>>;
  /** How long a module gets to come up, in ms; `EVALUATE_TIMEOUT_MS` unless a test says otherwise. */
  evaluateTimeout?: number;
}

/**
 * How long a bundle's module gets to come up. A module that awaits something
 * at its top level that never comes held every plugin after it and, during
 * an update, the studio behind a lock nobody can close. Ten seconds is ages
 * for code already in hand; the import itself cannot be called off, only no
 * longer waited for.
 */
export const EVALUATE_TIMEOUT_MS = 10_000;

/** `ports.evaluate`, with the deadline. */
function run(code: string, ports: InstallPorts): Promise<Record<string, unknown>> {
  return withDeadline(ports.evaluateTimeout ?? EVALUATE_TIMEOUT_MS, undefined, () => ports.evaluate(code));
}

/**
 * A bundle becomes a module through a blob: the code is already in hand, and
 * the URL is revoked as soon as the import has read it.
 */
async function evaluate(code: string): Promise<Record<string, unknown>> {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

const DEFAULT_PORTS: InstallPorts = {
  fetch: (url, init) => globalThis.fetch(url, init),
  evaluate,
};

/**
 * The one line the plugins window shows for a refused install. The register's
 * reasons are written for the plugin's author («без label», «бандл отдаёт не
 * тот плагин»); only the ones the person can act on are passed through, the
 * rest become «плагин собран с ошибкой» and go to the console whole.
 */
export function forPerson(failure: string): string {
  const shape = (key: string) =>
    new RegExp(`^${t(key, { api: '\u0000' }).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\u0000', '.*')}$`);
  const actionable = ['plugins.not_downloaded', 'plugins.not_a_bundle', 'plugin.foreign_api', 'plugins.not_kept', 'plugins.file_unreadable'];
  // Counted words have a form per number; the sheet's deadline is the one it says.
  const late = t('plugins.download_timeout', { count: seconds(BUNDLE_TIMEOUT_MS) });
  return failure === late || actionable.some((key) => shape(key).test(failure)) ? failure : t('plugins.faulty');
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A manifest's text for the language in hand; '' when it has none. */
function text(value: unknown, ns = ''): string {
  return pluginText(value, ns) ?? '';
}

function manifestOf(module: Record<string, unknown>): Partial<Plugin> & Record<string, unknown> {
  const manifest = module.default;
  return typeof manifest === 'object' && manifest !== null ? manifest as Partial<Plugin> : {};
}

/**
 * Downloads a bundle's text; the reason comes back instead of throwing. Its own
 * step so the plugins window can check the code before anything runs it.
 */
export async function download(
  url: string,
  ports: Pick<InstallPorts, 'fetch' | 'timeout'> = DEFAULT_PORTS,
  signal?: AbortSignal,
): Promise<{ code: string } | string> {
  // The browser's own words are English and about the machine: they go to
  // the console, and the report says what happened in ours.
  const timeout = ports.timeout ?? BUNDLE_TIMEOUT_MS;
  try {
    return await withDeadline(timeout, signal, async (deadline) => {
      const response = await ports.fetch(url, { signal: deadline });
      // A 404 page is text too: run as a bundle, it came back «это не плагин».
      if (response.ok === false) {
        throw new Error(`HTTP ${response.status ?? ''} ${url}`);
      }
      return { code: await response.text() };
    });
  } catch (error) {
    if (signal?.aborted) {
      // Called off by the caller: nobody is waiting for a reason.
      return t('plugins.not_downloaded');
    }
    console.warn('plugin download failed:', error);
    return timedOut(error) ? t('plugins.download_timeout', { count: seconds(timeout) }) : t('plugins.not_downloaded');
  }
}

/** Downloads and evaluates a bundle; the reason comes back instead of throwing. */
async function bundle(
  url: string,
  ports: InstallPorts,
): Promise<{ code: string; manifest: Partial<Plugin> & Record<string, unknown> } | string> {
  const got = await download(url, ports);
  return typeof got === 'string' ? got : evaluated(got.code, ports);
}

async function evaluated(
  code: string,
  ports: InstallPorts,
): Promise<{ code: string; manifest: Partial<Plugin> & Record<string, unknown> } | string> {
  try {
    return { code, manifest: manifestOf(await run(code, ports)) };
  } catch (error) {
    console.warn('plugin bundle failed:', error);
    return t('plugins.not_a_bundle');
  }
}

/**
 * Puts a manifest through the register — the same checks a built-in tool
 * passes — and takes it back out if it did not pass, so a refused install
 * leaves nothing behind.
 */
function accept(manifest: unknown, registry: PluginRegistry): string | null {
  return registry.register(manifest);
}

/** Installed plugins storage refused: they live as long as the page does. */
const session = new Map<string, InstalledPlugin>();

/**
 * What runs until a reload without a record on disk, for «Мои»: without it
 * such a plugin was nowhere in the list, and only a reload took it off.
 */
export function sessionPlugins(registry: PluginRegistry): InstalledPlugin[] {
  return [...session.values()].filter((plugin) => registry.holds(plugin.id));
}

/**
 * Puts a manifest in and its record on disk as one step. A plugin already
 * running under the id comes out first — the register refuses a second copy,
 * which is how «Обновить» and a new local build never took — and goes back
 * in if the new one is refused.
 */
async function install(
  id: string,
  manifest: unknown,
  record: InstalledPlugin,
  registry: PluginRegistry,
  ports: InstallPorts,
): Promise<string | null> {
  const was = (await listInstalled().catch(() => [])).find((plugin) => plugin.id === id);
  // What the register holds, not what the disk does: a plugin that storage
  // refused runs until the page is left, and a second install of it came back
  // «такой id уже загружен». The editor's own stay (`remove` refuses them).
  registry.remove(id);
  const failed = accept(manifest, registry);
  if (!failed) {
    // In the register but not on disk: it works until the page is left, and
    // «установлен» would promise it back after a reload.
    if (await putInstalled(record)) {
      session.delete(id);
      return null;
    }
    session.set(id, record);
    return t('plugins.not_kept');
  }
  if (was) {
    try {
      accept(manifestOf(await run(was.code, ports)), registry);
    } catch (error) {
      registry.fail(id, reason(error));
    }
  }
  return failed;
}

/**
 * Installs one plugin of the catalog. `null` means it is in. `code` is the
 * bundle the window already downloaded and checked: it is installed as is,
 * not fetched a second time (the second copy is not the one that was checked).
 */
export async function installFromCatalog(
  entry: CatalogEntry,
  registry: PluginRegistry,
  ports: InstallPorts = DEFAULT_PORTS,
  code?: string,
): Promise<string | null> {
  const got = code === undefined ? await bundle(entry.url, ports) : await evaluated(code, ports);
  if (typeof got === 'string') {
    return got;
  }
  // The catalog says what this record is; a bundle that turns out to be
  // another plugin is not the one that was asked for.
  if (got.manifest.id !== entry.id) {
    return t('plugin.wrong_bundle', { expected: entry.id, got: text(got.manifest.id) || t('plugin.no_id') });
  }
  return install(entry.id, got.manifest, {
    id: entry.id,
    version: entry.version,
    name: entry.name,
    description: entry.description,
    icon: entry.icon,
    code: got.code,
    source: 'catalog',
    installed: Date.now(),
  }, registry, ports);
}

/**
 * Installs a bundle picked from disk. There is no catalog record to describe
 * it, so its name and version come from the manifest — the one place they are
 * needed there.
 */
export async function installFromFile(
  code: string,
  registry: PluginRegistry,
  ports: InstallPorts = DEFAULT_PORTS,
): Promise<string | null> {
  const got = await evaluated(code, ports);
  if (typeof got === 'string') {
    return got;
  }
  const { manifest } = got;
  const id = text(manifest.id);
  // Its own icon, or the first tool's: a plugin that draws one thing has
  // already said what it looks like.
  const icon =
    text(manifest.icon) || text(Object.values(manifest.tools ?? {})[0]?.icon);
  // Without an id there is nothing running to swap out; the register says why.
  if (!id) {
    return accept(manifest, registry);
  }
  return install(id, manifest, {
    id,
    version: text(manifest.version) || '0.0.0',
    name: text(manifest.name, pluginNamespace(id)) || id,
    description: text(manifest.description, pluginNamespace(id)),
    icon: icon.startsWith('<') ? icon : '',
    code,
    source: 'local',
    installed: Date.now(),
  }, registry, ports);
}

/** Brings everything installed into the register. One bad bundle costs itself. */
export async function loadInstalled(
  registry: PluginRegistry,
  ports: InstallPorts = DEFAULT_PORTS,
): Promise<void> {
  // The register lives as long as the page; the studio is mounted again each
  // time the site comes back to it. A plugin already in did not need its code
  // run again — that only filled the failures with «такой id уже загружен».
  const carried = new Set(
    [...registry.tools(), ...registry.presets(), ...registry.brushTypes(), ...registry.exporters()].map((entry) => entry.plugin),
  );
  for (const plugin of await listInstalled()) {
    if (carried.has(plugin.id)) {
      continue;
    }
    try {
      const refused = accept(manifestOf(await run(plugin.code, ports)), registry);
      if (refused) {
        registry.fail(plugin.id, refused);
      }
    } catch (error) {
      registry.fail(plugin.id, reason(error));
    }
  }
}

/**
 * Downloads every catalog plugin whose version is above the installed one and
 * puts it in place of it. Returns what was updated; a failure leaves the
 * working version alone, with the reason in the log.
 */
export async function updateInstalled(
  catalog: readonly CatalogEntry[],
  registry: PluginRegistry,
  ports: InstallPorts = DEFAULT_PORTS,
  /**
   * Called once, before the first plugin is swapped: the studio locks here.
   * Downloads come first, unlocked — thirty seconds a bundle on a slow line
   * held the studio shut with nothing to call off.
   */
  onSwap?: () => void,
): Promise<string[]> {
  const updated: string[] = [];
  const ready: { plugin: InstalledPlugin; entry: CatalogEntry; got: { code: string; manifest: Partial<Plugin> & Record<string, unknown> } }[] = [];
  for (const plugin of await listInstalled()) {
    // The delivery changes with the editor, not past it.
    if (registry.isBundled(plugin.id)) {
      continue;
    }
    // A plugin installed from a file is the author's own build: the catalog
    // has no say over it until they take it off themselves.
    if (plugin.source !== 'catalog') {
      continue;
    }
    // Only what went through our pull request comes in unasked. A catalog at
    // another address is somebody's code: it warns before an install, and an
    // update from it is the same install — «Обновить» in its tab, which asks.
    const entry = catalog.find((record) => record.id === plugin.id && reviewed(record));
    if (!entry || compareVersions(entry.version, plugin.version) <= 0) {
      continue;
    }
    const got = await bundle(entry.url, ports);
    if (typeof got === 'string') {
      registry.fail(plugin.id, t('plugin.update_failed', { reason: got }));
      continue;
    }
    if (got.manifest.id !== entry.id) {
      registry.fail(plugin.id, t('plugin.update_wrong_bundle'));
      continue;
    }
    ready.push({ plugin, entry, got });
  }
  if (ready.length > 0) {
    onSwap?.();
  }
  for (const { plugin, entry, got } of ready) {
    // The old one has to go first: the register refuses a second plugin under
    // an id it already holds.
    registry.remove(plugin.id);
    const refused = accept(got.manifest, registry);
    if (refused) {
      registry.fail(plugin.id, t('plugin.update_failed', { reason: refused }));
      // The working version goes back in: a refused update is not a removal.
      try {
        accept(manifestOf(await run(plugin.code, ports)), registry);
      } catch (error) {
        registry.fail(plugin.id, reason(error));
      }
      continue;
    }
    // Not on disk, the old code comes back after a reload: not «обновлён».
    if (!(await putInstalled({ ...plugin, version: entry.version, name: entry.name, description: entry.description, icon: entry.icon, code: got.code }))) {
      registry.fail(plugin.id, t('plugins.not_kept'));
      continue;
    }
    updated.push(plugin.id);
  }
  return updated;
}

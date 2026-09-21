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

import { compareVersions, type CatalogEntry } from './catalog';
import type { Plugin } from './contract';
import type { PluginRegistry } from './registry';
import { listInstalled, putInstalled } from './store';

export interface InstallPorts {
  fetch: (url: string) => Promise<{ text(): Promise<string> }>;
  /** Turns a bundle into a module; its own port so a test needs no browser. */
  evaluate: (code: string) => Promise<Record<string, unknown>>;
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
  fetch: (url) => globalThis.fetch(url),
  evaluate,
};

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function manifestOf(module: Record<string, unknown>): Partial<Plugin> & Record<string, unknown> {
  const manifest = module.default;
  return typeof manifest === 'object' && manifest !== null ? manifest as Partial<Plugin> : {};
}

/** Downloads and evaluates a bundle; the reason comes back instead of throwing. */
async function bundle(
  url: string,
  ports: InstallPorts,
): Promise<{ code: string; manifest: Partial<Plugin> & Record<string, unknown> } | string> {
  try {
    const code = await (await ports.fetch(url)).text();
    return { code, manifest: manifestOf(await ports.evaluate(code)) };
  } catch (error) {
    return reason(error);
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

/** Installs one plugin of the catalog. `null` means it is in. */
export async function installFromCatalog(
  entry: CatalogEntry,
  registry: PluginRegistry,
  ports: InstallPorts = DEFAULT_PORTS,
): Promise<string | null> {
  const got = await bundle(entry.url, ports);
  if (typeof got === 'string') {
    return got;
  }
  // The catalog says what this record is; a bundle that turns out to be
  // another plugin is not the one that was asked for.
  if (got.manifest.id !== entry.id) {
    return `бандл отдаёт не тот плагин: ждали ${entry.id}, получили ${text(got.manifest.id) || '«без id»'}`;
  }
  const refused = accept(got.manifest, registry);
  if (refused) {
    return refused;
  }
  await putInstalled({
    id: entry.id,
    version: entry.version,
    name: entry.name,
    description: entry.description,
    icon: entry.icon,
    code: got.code,
    source: 'catalog',
    installed: Date.now(),
  });
  return null;
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
  let manifest: Partial<Plugin> & Record<string, unknown>;
  try {
    manifest = manifestOf(await ports.evaluate(code));
  } catch (error) {
    return reason(error);
  }
  const refused = accept(manifest, registry);
  if (refused) {
    return refused;
  }
  const id = text(manifest.id);
  const icon = text(manifest.icon) || text((manifest.tool as { icon?: unknown } | undefined)?.icon);
  await putInstalled({
    id,
    version: text(manifest.version) || '0.0.0',
    name: text(manifest.name) || id,
    description: text(manifest.description),
    icon: icon.startsWith('<') ? icon : '',
    code,
    source: 'local',
    installed: Date.now(),
  });
  return null;
}

/** Brings everything installed into the register. One bad bundle costs itself. */
export async function loadInstalled(
  registry: PluginRegistry,
  ports: InstallPorts = DEFAULT_PORTS,
): Promise<void> {
  for (const plugin of await listInstalled()) {
    try {
      const refused = accept(manifestOf(await ports.evaluate(plugin.code)), registry);
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
): Promise<string[]> {
  const updated: string[] = [];
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
    const entry = catalog.find((record) => record.id === plugin.id);
    if (!entry || compareVersions(entry.version, plugin.version) <= 0) {
      continue;
    }
    const got = await bundle(entry.url, ports);
    if (typeof got === 'string') {
      registry.fail(plugin.id, `обновление не удалось: ${got}`);
      continue;
    }
    if (got.manifest.id !== entry.id) {
      registry.fail(plugin.id, `обновление не удалось: бандл отдаёт не тот плагин`);
      continue;
    }
    // The old one has to go first: the register refuses a second plugin under
    // an id it already holds.
    registry.remove(plugin.id);
    const refused = accept(got.manifest, registry);
    if (refused) {
      registry.fail(plugin.id, `обновление не удалось: ${refused}`);
      continue;
    }
    await putInstalled({ ...plugin, version: entry.version, name: entry.name, description: entry.description, icon: entry.icon, code: got.code });
    updated.push(plugin.id);
  }
  return updated;
}

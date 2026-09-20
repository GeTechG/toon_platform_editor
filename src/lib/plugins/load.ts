/**
 * Reading plugins from an address.
 *
 * The address holds an `index.json` — a list of entry files next to it — and
 * each entry is an ES module whose `export default` is the manifest. Nothing
 * here may stop the editor from drawing: a plugin that does not load is a
 * plugin that is not there, with a reason in the log.
 */

import type { PluginRegistry } from './registry';

export interface LoadPorts {
  fetch: (url: string) => Promise<{ json(): Promise<unknown> }>;
  /** Its own port so a test can hand over a module without a network. */
  import: (url: string) => Promise<Record<string, unknown>>;
  /** What a relative address is relative to — the page the editor is on. */
  base?: string;
}

const DEFAULT_PORTS: LoadPorts = {
  fetch: (url) => globalThis.fetch(url),
  import: (url) => import(/* @vite-ignore */ url),
};

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadPlugins(
  address: string,
  registry: PluginRegistry,
  ports: LoadPorts = DEFAULT_PORTS,
): Promise<void> {
  const address_ = address.trim();
  if (!address_) {
    return;
  }
  // An address on the site itself (`/plugins/demo/`) is the ordinary case while
  // an author works on one, so it is resolved against the page rather than
  // refused as "not a URL".
  const base = new URL(address_, ports.base ?? globalThis.location?.href).href;
  let entries: unknown;
  try {
    const response = await ports.fetch(new URL('index.json', base).href);
    entries = await response.json();
  } catch (error) {
    registry.fail('<реестр>', `реестр не прочитан: ${reason(error)}`);
    return;
  }
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (typeof entry !== 'string') {
      continue;
    }
    const url = new URL(entry, base).href;
    try {
      registry.register((await ports.import(url)).default);
    } catch (error) {
      registry.fail(entry, reason(error));
    }
  }
}

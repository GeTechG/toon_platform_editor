/**
 * The catalog: one `index.json` at an address, one record per plugin.
 *
 * Reading it never throws and never stops the editor — an unreachable or
 * unreadable catalog is a reason shown in the plugins window, and whatever is
 * already installed goes on working from its cache.
 */

import { PLUGIN_API } from './contract';

/** A plugin offered by the catalog; `url` is its bundle, already resolved. */
export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly icon: string;
  readonly url: string;
}

export interface Catalog {
  readonly plugins: CatalogEntry[];
  /** Why there is nothing to show, when there is nothing to show. */
  readonly error?: string;
}

export interface CatalogPorts {
  fetch: (url: string) => Promise<{ json(): Promise<unknown> }>;
  /** What a relative address is relative to — the page the editor is on. */
  base?: string;
}

const DEFAULT_PORTS: CatalogPorts = { fetch: (url) => globalThis.fetch(url) };

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** `1.10.0` is above `1.9.0`: the parts are numbers, not text. */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.');
  const right = b.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (Number(left[i]) || 0) - (Number(right[i]) || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function readEntry(value: unknown, base: string): CatalogEntry | null {
  const record = typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
  if (!record || !text(record.id) || !text(record.entry)) {
    return null;
  }
  return {
    id: text(record.id),
    name: text(record.name) || text(record.id),
    version: text(record.version) || '0.0.0',
    description: text(record.description),
    icon: text(record.icon),
    url: new URL(text(record.entry), base).href,
  };
}

export async function readCatalog(address: string, ports: CatalogPorts = DEFAULT_PORTS): Promise<Catalog> {
  const address_ = address.trim();
  if (!address_) {
    return { plugins: [], error: 'адрес каталога не задан' };
  }
  // An address on the site itself (`/plugins/build/`) is the ordinary case
  // while an author works on one, so it is resolved against the page.
  const base = new URL(address_, ports.base ?? globalThis.location?.href).href;
  let index: unknown;
  try {
    index = await (await ports.fetch(new URL('index.json', base).href)).json();
  } catch (error) {
    return { plugins: [], error: `каталог не прочитан: ${reason(error)}` };
  }
  const body = typeof index === 'object' && index !== null ? index as Record<string, unknown> : {};
  if (body.api !== PLUGIN_API) {
    return { plugins: [], error: `каталог другого мажора: ${String(body.api)}` };
  }
  const plugins: CatalogEntry[] = [];
  for (const value of Array.isArray(body.plugins) ? body.plugins : []) {
    const entry = readEntry(value, base);
    if (entry) {
      plugins.push(entry);
    }
  }
  return { plugins };
}

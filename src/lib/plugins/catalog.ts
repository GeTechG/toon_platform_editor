/**
 * The catalog: one `index.json` at an address, one record per plugin.
 *
 * Reading it never throws and never stops the editor — an unreachable or
 * unreadable catalog is a reason shown in the plugins window, and whatever is
 * already installed goes on working from its cache.
 */

import { PLUGIN_API, pluginNamespace, pluginText } from './contract';
import { t } from '../i18n';

/**
 * A plugin offered by the catalog; `url` is its bundle, already resolved.
 *
 * Its words are resolved here, on reading: the list is shown before anything
 * is installed, so the plugin's own catalogue is not loaded yet and a record
 * localises itself the only way it can — by carrying the strings (`{ ru, en }`).
 */
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

/** A record's own words, in the language in hand. */
function localized(value: unknown, id: string): string {
  return pluginText(value, pluginNamespace(id)) ?? '';
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
    name: localized(record.name, text(record.id)) || text(record.id),
    version: text(record.version) || '0.0.0',
    description: localized(record.description, text(record.id)),
    icon: text(record.icon),
    url: new URL(text(record.entry), base).href,
  };
}

export async function readCatalog(address: string, ports: CatalogPorts = DEFAULT_PORTS): Promise<Catalog> {
  const address_ = address.trim();
  if (!address_) {
    return { plugins: [], error: t('plugin.catalog_no_url') };
  }
  // An address on the site itself (`/plugins/build/`) is the ordinary case
  // while an author works on one, so it is resolved against the page.
  const base = new URL(address_, ports.base ?? globalThis.location?.href).href;
  let index: unknown;
  try {
    index = await (await ports.fetch(new URL('index.json', base).href)).json();
  } catch (error) {
    return { plugins: [], error: t('plugin.catalog_unreadable', { reason: reason(error) }) };
  }
  const body = typeof index === 'object' && index !== null ? index as Record<string, unknown> : {};
  if (body.api !== PLUGIN_API) {
    return { plugins: [], error: t('plugin.catalog_foreign_major', { api: String(body.api) }) };
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

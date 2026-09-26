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
/**
 * The catalog the editor opens with: the build branch of the plugin
 * repository, read straight from GitHub — no hosting to set up, and a cache of
 * minutes rather than of hours. Its `official.json` is the one register of
 * official plugins, whatever address the settings point the catalog at.
 */
export const OFFICIAL_CATALOG = 'https://raw.githubusercontent.com/GeTechG/toonop_plugins/build/';

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
  let base: string;
  try {
    base = new URL(address_, ports.base ?? globalThis.location?.href).href;
  } catch {
    return { plugins: [], error: t('plugin.catalog_bad_url', { address: address_ }) };
  }
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

/**
 * One record of `official.json`: the owner blessed exactly this code. The
 * register lives in the plugin repository and only its owner writes it — a
 * plugin cannot mark itself, and a catalog at another address has no say.
 */
export interface OfficialEntry {
  readonly id: string;
  readonly version: string;
  /** sha256 of the bundle as the editor receives it, hex. */
  readonly sha256: string;
}

export interface OfficialPorts {
  fetch: (url: string) => Promise<{ json(): Promise<unknown> }>;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
}

const OFFICIAL_KEY = 'toonop-plugins-official';

function officialEntries(value: unknown): OfficialEntry[] | null {
  const list = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).plugins : null;
  if (!Array.isArray(list)) {
    return null;
  }
  return list.flatMap((record: Record<string, unknown>) =>
    record && text(record.id) && /^[0-9a-f]{64}$/.test(text(record.sha256))
      ? [{ id: text(record.id), version: text(record.version), sha256: text(record.sha256) }]
      : []);
}

/**
 * The register, from our catalog. Offline it is the last copy that came in;
 * with none kept it is empty — everything is community, and nothing already
 * installed is switched off for it.
 */
export async function readOfficial(
  ports: OfficialPorts = { fetch: (url) => globalThis.fetch(url) },
): Promise<OfficialEntry[]> {
  // Read lazily: in a sandboxed frame merely touching `localStorage` throws.
  const storage = () => ports.storage ?? globalThis.localStorage;
  try {
    const body = await (await ports.fetch(`${OFFICIAL_CATALOG}official.json`)).json();
    const read = officialEntries(body);
    if (read) {
      try {
        storage()?.setItem(OFFICIAL_KEY, JSON.stringify({ plugins: read }));
      } catch {
        // A private window keeps nothing; the register is still in hand.
      }
      return read;
    }
  } catch (error) {
    console.warn('official plugins register unreadable:', error);
  }
  try {
    return officialEntries(JSON.parse(storage()?.getItem(OFFICIAL_KEY) ?? 'null')) ?? [];
  } catch {
    return [];
  }
}

/** sha256 of a bundle's text as UTF-8, hex: the bytes `scripts/bless.mjs` hashed. */
export async function sha256(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Ours: this very code is in the register. Changed code is not, whatever it calls itself. */
export async function isOfficial(code: string, official: readonly OfficialEntry[]): Promise<boolean> {
  if (official.length === 0) {
    return false;
  }
  const hash = await sha256(code);
  return official.some((entry) => entry.sha256 === hash);
}

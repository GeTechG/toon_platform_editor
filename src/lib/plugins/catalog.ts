/**
 * The catalog: one `index.json` at an address, one record per plugin.
 *
 * Reading it never throws and never stops the editor — an unreachable or
 * unreadable catalog is a reason shown in the plugins window, and whatever is
 * already installed goes on working from its cache.
 */

import { PLUGIN_API, pluginNamespace, pluginText } from './contract';
import { t } from '../i18n';
import { seconds, timedOut, withDeadline } from './deadline';

/**
 * How long the catalog gets to answer. `index.json` is a few kilobytes on a
 * CDN that answers in well under a second; fifteen covers a cold cache on a
 * slow phone, and past it the person is better off with «Повторить» than with
 * «Читаю каталог…» for good.
 */
export const CATALOG_TIMEOUT_MS = 15_000;

/**
 * How long a bundle gets. A bundle is a few hundred kilobytes at most: on a
 * slow 3G line (~50 KB/s) that is several seconds, and thirty leave room for
 * that and for a slow start.
 */
export const BUNDLE_TIMEOUT_MS = 30_000;

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
 * minutes rather than of hours. What it offers went through a pull request.
 */
export const OFFICIAL_CATALOG = 'https://raw.githubusercontent.com/GeTechG/toonop_plugins/build/';

export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly icon: string;
  readonly url: string;
  /** The catalog the record was read from; a record made by hand has none. */
  readonly catalog?: string;
}

export interface Catalog {
  readonly plugins: CatalogEntry[];
  /** Why there is nothing to show, when there is nothing to show. */
  readonly error?: string;
  /** The caller called the read off: there is nothing to show and nobody to show it to. */
  readonly aborted?: true;
}

export interface CatalogPorts {
  fetch: (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok?: boolean; status?: number; json(): Promise<unknown> }>;
  /** What a relative address is relative to — the page the editor is on. */
  base?: string;
  /** How long the read gets, in ms; `CATALOG_TIMEOUT_MS` unless a test says otherwise. */
  timeout?: number;
}

const DEFAULT_PORTS: CatalogPorts = { fetch: (url, init) => globalThis.fetch(url, init) };

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
  // One record with an address that is no address costs itself: thrown, it
  // took the whole catalog and left the tab on «Читаю каталог…» for good.
  let url: string;
  try {
    url = new URL(text(record.entry), base).href;
  } catch {
    return null;
  }
  return {
    id: text(record.id),
    name: localized(record.name, text(record.id)) || text(record.id),
    version: text(record.version) || '0.0.0',
    description: localized(record.description, text(record.id)),
    icon: text(record.icon),
    url,
    catalog: base,
  };
}

/**
 * Reads the catalog at an address. `signal` calls it off — the sheet it was
 * for has closed — and the answer is then `aborted`, with no error to show.
 */
export async function readCatalog(
  address: string,
  ports: CatalogPorts = DEFAULT_PORTS,
  signal?: AbortSignal,
): Promise<Catalog> {
  const address_ = address.trim();
  if (!address_) {
    return { plugins: [], error: t('plugin.catalog_no_url') };
  }
  // An address on the site itself (`/plugins/build/`) is the ordinary case
  // while an author works on one, so it is resolved against the page.
  let base: string;
  try {
    const url = new URL(address_, ports.base ?? globalThis.location?.href);
    // A folder typed without its slash: `index.json` and every entry of it
    // were read one folder up — «нет каталога», or somebody else's files.
    if (!url.pathname.endsWith('/') && !url.pathname.endsWith('/index.json')) {
      url.pathname += '/';
    }
    base = url.href;
  } catch {
    return { plugins: [], error: t('plugin.catalog_bad_url', { address: address_ }) };
  }
  let index: unknown;
  const timeout = ports.timeout ?? CATALOG_TIMEOUT_MS;
  try {
    const response = await withDeadline(timeout, signal, async (deadline) => {
      const answer = await ports.fetch(new URL('index.json', base).href, { signal: deadline });
      // A 404 is a page, not a catalog: parsed, it said «Unexpected token '<'».
      if (answer.ok === false) {
        return answer;
      }
      index = await answer.json();
      return answer;
    });
    if (response.ok === false) {
      return { plugins: [], error: t('plugin.catalog_missing', { status: response.status ?? '' }) };
    }
  } catch (error) {
    if (signal?.aborted) {
      return { plugins: [], aborted: true };
    }
    // The browser's own words for a deadline are about the machine; this one
    // is ours, and says what to do.
    if (timedOut(error)) {
      return { plugins: [], error: t('plugin.catalog_timeout', { count: seconds(timeout) }) };
    }
    return { plugins: [], error: t('plugin.catalog_unreadable', { reason: reason(error) }) };
  }
  const body = typeof index === 'object' && index !== null ? index as Record<string, unknown> : {};
  // Some other JSON at a mistyped address is not a catalog «для другой версии
  // редактора (API undefined)»: nothing here needs a newer editor.
  if (body.api === undefined) {
    return { plugins: [], error: t('plugin.catalog_not_one') };
  }
  if (body.api !== PLUGIN_API) {
    return { plugins: [], error: t('plugin.catalog_foreign_major', { api: String(body.api) }) };
  }
  const plugins: CatalogEntry[] = [];
  for (const value of Array.isArray(body.plugins) ? body.plugins : []) {
    const entry = readEntry(value, base);
    // One id, one plugin: the window lists them by id, and a second record
    // under the same one took the whole window down with it. The first wins,
    // as the register keeps the first plugin loaded under an id.
    if (entry && !plugins.some((kept) => kept.id === entry.id)) {
      plugins.push(entry);
    }
  }
  return { plugins };
}

/**
 * Reviewed: it came from our catalog, where every plugin went through a pull
 * request. A catalog at another address, like a file, is nobody's review —
 * and it stays nobody's when it lists our bundle: the name, the words and the
 * version around it are its own («999» switched the plugin's updates off).
 */
export function reviewed(entry: Pick<CatalogEntry, 'url' | 'catalog'>): boolean {
  return entry.url.startsWith(OFFICIAL_CATALOG) && (entry.catalog ?? '').startsWith(OFFICIAL_CATALOG);
}

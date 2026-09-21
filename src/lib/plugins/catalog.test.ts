import { describe, expect, test } from 'bun:test';

import { compareVersions, readCatalog } from './catalog';
import { PLUGIN_API } from './contract';

const entry = (id: string, version = '1.0.0') => ({
  id,
  name: id,
  version,
  description: 'что-то делает',
  icon: '<path d="M4 4h16" />',
  entry: `${id}/plugin.js`,
});

function fakeFetch(body: unknown, calls: string[] = []) {
  return async (url: string) => {
    calls.push(url);
    return { ok: true, json: async () => body };
  };
}

describe('readCatalog', () => {
  test('no address, no request at all', async () => {
    const calls: string[] = [];
    const catalog = await readCatalog('', { fetch: fakeFetch({}, calls) });

    expect(calls).toEqual([]);
    expect(catalog.plugins).toEqual([]);
    expect(catalog.error).toBe('адрес каталога не задан');
  });

  test('reads index.json next to the address and resolves each bundle against it', async () => {
    const calls: string[] = [];
    const catalog = await readCatalog('https://plugins.example/build/', {
      fetch: fakeFetch({ api: PLUGIN_API, plugins: [entry('halftone')] }, calls),
    });

    expect(calls).toEqual(['https://plugins.example/build/index.json']);
    expect(catalog.error).toBeUndefined();
    expect(catalog.plugins).toHaveLength(1);
    expect(catalog.plugins[0].name).toBe('halftone');
    expect(catalog.plugins[0].url).toBe('https://plugins.example/build/halftone/plugin.js');
  });

  test('drops a record without an id or a bundle and keeps the rest', async () => {
    const catalog = await readCatalog('https://plugins.example/', {
      fetch: fakeFetch({
        api: PLUGIN_API,
        plugins: [entry('ok'), { ...entry('no-entry'), entry: undefined }, { name: 'безымянный' }],
      }),
    });

    expect(catalog.plugins.map((p) => p.id)).toEqual(['ok']);
  });

  test('a catalog of another major is not shown, with a reason', async () => {
    const catalog = await readCatalog('https://plugins.example/', {
      fetch: fakeFetch({ api: PLUGIN_API + 1, plugins: [entry('halftone')] }),
    });

    expect(catalog.plugins).toEqual([]);
    expect(catalog.error).toContain('мажор');
  });

  test('an unreachable catalog is a reason, not a throw', async () => {
    const catalog = await readCatalog('https://plugins.example/', {
      fetch: async () => {
        throw new Error('сеть недоступна');
      },
    });

    expect(catalog.plugins).toEqual([]);
    expect(catalog.error).toContain('сеть недоступна');
  });
});

describe('compareVersions', () => {
  test('compares part by part as numbers, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });

  test('a missing part is a zero', () => {
    expect(compareVersions('1.1', '1.1.0')).toBe(0);
    expect(compareVersions('1.2', '1.1.9')).toBeGreaterThan(0);
  });
});

// The list is read before anything is installed, so a plugin's own catalogue
// is not loaded yet — a record localises itself the only way it can, by
// carrying the words themselves.
test('a record may name itself in several languages', async () => {
  const catalog = await readCatalog('https://plugins.example/', {
    fetch: fakeFetch({
      api: PLUGIN_API,
      plugins: [
        { ...entry('halftone'), name: { en: 'Halftone', ru: 'Полутон' }, description: { ru: 'Полутоновая кисть' } },
      ],
    }),
  });

  expect(catalog.plugins[0].name).toBe('Полутон');
  expect(catalog.plugins[0].description).toBe('Полутоновая кисть');
});

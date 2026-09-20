import { describe, expect, test } from 'bun:test';

import { PLUGIN_API } from './contract';
import { loadPlugins } from './load';
import { PluginRegistry } from './registry';

const manifest = (id: string) => ({
  default: {
    id,
    api: PLUGIN_API,
    tool: { label: id, title: id, key: '', icon: '<path d="M4 4h16" />' },
  },
});

function fakeFetch(body: unknown, calls: string[] = []) {
  return async (url: string) => {
    calls.push(url);
    return { json: async () => body };
  };
}

describe('loadPlugins', () => {
  test('no address, no requests at all', async () => {
    const calls: string[] = [];
    const registry = new PluginRegistry();

    await loadPlugins('', registry, { fetch: fakeFetch([], calls), import: async () => ({}) });

    expect(calls).toEqual([]);
    expect(registry.tools()).toEqual([]);
  });

  test('reads the index next to the address and imports each entry from there', async () => {
    const calls: string[] = [];
    const asked: string[] = [];
    const registry = new PluginRegistry();

    await loadPlugins('https://plugins.example/dist/', registry, {
      fetch: fakeFetch(['halftone/index.js'], calls),
      import: async (url) => {
        asked.push(url);
        return manifest('a.halftone');
      },
    });

    expect(calls).toEqual(['https://plugins.example/dist/index.json']);
    expect(asked).toEqual(['https://plugins.example/dist/halftone/index.js']);
    expect(registry.tool('a.halftone')?.label).toBe('a.halftone');
  });

  test('an address on the site itself is read from the site itself', async () => {
    const calls: string[] = [];
    const asked: string[] = [];
    const registry = new PluginRegistry();

    await loadPlugins('/plugins/demo/', registry, {
      fetch: fakeFetch(['shift.js'], calls),
      import: async (url) => {
        asked.push(url);
        return manifest('a.shift');
      },
      base: 'http://localhost:5173/editor',
    });

    expect(calls).toEqual(['http://localhost:5173/plugins/demo/index.json']);
    expect(asked).toEqual(['http://localhost:5173/plugins/demo/shift.js']);
    expect(registry.failures).toEqual([]);
  });

  test('an index that cannot be read leaves the editor drawing, with a reason', async () => {
    const registry = new PluginRegistry();

    await loadPlugins('https://plugins.example/', registry, {
      fetch: async () => {
        throw new Error('сеть');
      },
      import: async () => ({}),
    });

    expect(registry.tools()).toEqual([]);
    expect(registry.failures[0].reason).toContain('сеть');
  });

  test('one broken plugin does not take the other two with it', async () => {
    const registry = new PluginRegistry();

    await loadPlugins('https://plugins.example/', registry, {
      fetch: fakeFetch(['one.js', 'bad.js', 'three.js']),
      import: async (url) => {
        if (url.endsWith('bad.js')) {
          throw new Error('разбор');
        }
        return manifest(url.endsWith('one.js') ? 'a.one' : 'a.three');
      },
    });

    expect(registry.tools().map((tool) => tool.id)).toEqual(['a.one', 'a.three']);
    expect(registry.failures).toHaveLength(1);
  });

  test('a module without a default manifest is skipped like any other refusal', async () => {
    const registry = new PluginRegistry();

    await loadPlugins('https://plugins.example/', registry, {
      fetch: fakeFetch(['empty.js']),
      import: async () => ({}),
    });

    expect(registry.tools()).toEqual([]);
    expect(registry.failures).toHaveLength(1);
  });
});

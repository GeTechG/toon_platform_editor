import { createHash } from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import { OFFICIAL_CATALOG, isOfficial, readCatalog, readOfficial, sha256 } from '../plugins/catalog';
import { PLUGIN_API } from '../plugins/contract';
import { download, installFromCatalog } from '../plugins/install';
import { PluginRegistry } from '../plugins/registry';

// Owner, after the twelfth audit: «пометку official хранить в репозитории,
// чтобы никто не мог подделать, и привязать к хэшу плагина». A plugin is
// official when the sha256 of its code is in `official.json` of our catalog.
const UI = new URL('./', import.meta.url).pathname;
const pluginsSheet = await Bun.file(UI + 'PluginsSheet.svelte').text();
const install = await Bun.file(UI + '../plugins/install.ts').text();
const store = await Bun.file(UI + '../plugins/store.ts').text();

const CODE = 'export default { id: "straight-line", api: 1 };';
const HASH = createHash('sha256').update(CODE, 'utf8').digest('hex');

/** A storage that is just a map; `null` makes every call throw (a private window). */
function memory(broken = false) {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => {
      if (broken) throw new Error('blocked');
      return map.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (broken) throw new Error('blocked');
      map.set(key, value);
    },
  };
}

const answering = (body: unknown, calls: string[] = []) => async (url: string) => {
  calls.push(url);
  return { json: async () => body };
};
const offline = async () => {
  throw new Error('offline');
};

describe('the hash is of the very text the editor runs', () => {
  it('sha256 of the code as UTF-8, hex — the same as node:crypto on the file', async () => {
    expect(await sha256(CODE)).toBe(HASH);
    expect(await sha256('Ровная линия')).toBe(createHash('sha256').update('Ровная линия', 'utf8').digest('hex'));
  });
});

describe('the register of official plugins', () => {
  const body = { plugins: [{ id: 'straight-line', version: '1.2.1', sha256: HASH }, { id: 'junk', sha256: 'nope' }] };

  it('is read from our catalog, never from the address in the settings', async () => {
    const calls: string[] = [];
    const official = await readOfficial({ fetch: answering(body, calls), storage: memory() });
    expect(calls).toEqual([`${OFFICIAL_CATALOG}official.json`]);
    // A record without a real sha256 is dropped.
    expect(official).toEqual([{ id: 'straight-line', version: '1.2.1', sha256: HASH }]);
  });

  it('keeps the last good copy and falls back to it offline', async () => {
    const storage = memory();
    await readOfficial({ fetch: answering(body), storage });
    expect(await readOfficial({ fetch: offline, storage })).toEqual([{ id: 'straight-line', version: '1.2.1', sha256: HASH }]);
  });

  it('offline with nothing kept is an empty register: everything is community', async () => {
    expect(await readOfficial({ fetch: offline, storage: memory() })).toEqual([]);
    expect(await readOfficial({ fetch: offline, storage: memory(true) })).toEqual([]);
  });

  it('a garbled answer is not a register and does not overwrite the kept one', async () => {
    const storage = memory();
    await readOfficial({ fetch: answering(body), storage });
    expect(await readOfficial({ fetch: answering('<html>'), storage })).toHaveLength(1);
  });
});

describe('official is the code, not a claim', () => {
  const official = [{ id: 'straight-line', version: '1.2.1', sha256: HASH }];

  it('the same code is official, wherever it came from', async () => {
    expect(await isOfficial(CODE, official)).toBe(true);
  });

  it('changed code is not, even under the same id and version', async () => {
    expect(await isOfficial(`${CODE} `, official)).toBe(false);
    expect(await isOfficial(CODE, [])).toBe(false);
  });

  it('a catalog record no longer carries official, whatever index.json says', async () => {
    const catalog = await readCatalog(OFFICIAL_CATALOG, {
      fetch: async () => ({
        json: async () => ({ api: PLUGIN_API, plugins: [{ id: 'liar', version: '1.0.0', entry: 'liar/plugin.js', official: true }] }),
      }),
    });
    expect(catalog.plugins[0]).not.toHaveProperty('official');
  });

  it('an installed record keeps no flag to trust later', () => {
    expect(store).not.toMatch(/readonly official/);
    expect(install).not.toMatch(/official/);
  });
});

describe('installing from the catalog checks the code it downloaded', () => {
  it('download hands back the code, or a reason', async () => {
    expect(await download('https://x/p.js', { fetch: async () => ({ text: async () => CODE }) })).toEqual({ code: CODE });
    expect(typeof (await download('https://x/p.js', { fetch: offline }))).toBe('string');
  });

  it('installs the code already downloaded, without a second download', async () => {
    const fetched: string[] = [];
    const failed = await installFromCatalog(
      { id: 'other', name: 'o', version: '1.0.0', description: '', icon: '', url: 'https://x/p.js' },
      new PluginRegistry(),
      {
        fetch: async (url) => {
          fetched.push(url);
          return { text: async () => '' };
        },
        evaluate: async () => ({ default: { id: 'straight-line' } }),
      },
      CODE,
    );
    expect(fetched).toEqual([]);
    // The id check still holds on handed-in code.
    expect(failed).toMatch(/other/);
  });

  it('the sheet downloads, checks, and warns about whatever did not pass', () => {
    const ask = pluginsSheet.match(/async function askInstall\(entry: CatalogEntry\)[^]*?\n  }\n/)![0];
    expect(ask).toMatch(/download\(entry\.url\)/);
    expect(ask).toMatch(/isOfficial\(/);
    expect(ask).toMatch(/pending = /);
  });

  it('a file of our code installs without the warning', () => {
    const fromFile = pluginsSheet.match(/async function onBundleFile[^]*?\n  }\n/)![0];
    expect(fromFile).toMatch(/isOfficial\(code/);
    expect(fromFile).toContain('pending =');
  });

  it('the «Мои» list checks every installed plugin by its code on each read', () => {
    const refresh = pluginsSheet.match(/async function refresh\(\)[^]*?\n  }\n/)![0];
    expect(refresh).toMatch(/isOfficial\(plugin\.code/);
    expect(pluginsSheet).not.toMatch(/plugin\.official|entry\.official/);
  });
});

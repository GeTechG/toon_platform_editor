import { describe, expect, it } from 'bun:test';
import * as catalogModule from '../plugins/catalog';
import { OFFICIAL_CATALOG, reviewed } from '../plugins/catalog';
import { download, installFromCatalog } from '../plugins/install';
import { PluginRegistry } from '../plugins/registry';
import { t } from '../i18n';

// Owner, after the twelfth audit, second thought: «убери разделение на
// официальные и нет — не официальные будут все, которые установлены из файла:
// всё, что прошло PR, должно быть в порядке». Our catalog is reviewed by the
// pull request; a file — or a catalog at another address — is not, and warns.
const UI = new URL('./', import.meta.url).pathname;
const pluginsSheet = await Bun.file(UI + 'PluginsSheet.svelte').text();

const CODE = 'export default { id: "straight-line", api: 1 };';
const offline = async () => {
  throw new Error('offline');
};
const entry = (url: string) => ({ id: 'p', name: 'p', version: '1.0.0', description: '', icon: '', url });

describe('no official and community any more', () => {
  it('there is no register and no hash to check', () => {
    expect(catalogModule).not.toHaveProperty('readOfficial');
    expect(catalogModule).not.toHaveProperty('isOfficial');
    expect(catalogModule).not.toHaveProperty('sha256');
    expect(pluginsSheet).not.toMatch(/official\.json|isOfficial|officialIds|listedOfficial/);
  });

  it('the list says nothing of official or community', () => {
    expect(t('plugins.official')).toBe('plugins.official');
    expect(t('plugins.community')).toBe('plugins.community');
    expect(pluginsSheet).not.toMatch(/plugins\.(official|community)/);
  });
});

describe('what went through a pull request is reviewed', () => {
  it('a plugin from our catalog is reviewed', () => {
    expect(reviewed(entry(`${OFFICIAL_CATALOG}straight-line/plugin.js`))).toBe(true);
  });

  it('a catalog at another address is not: nobody reviewed it', () => {
    expect(reviewed(entry('https://example.com/straight-line/plugin.js'))).toBe(false);
    // A look-alike prefix is not ours either.
    expect(reviewed(entry(`${OFFICIAL_CATALOG.slice(0, -1)}-evil/plugin.js`))).toBe(false);
  });

  it('the sheet warns before a catalog install only when it is not reviewed', () => {
    const ask = pluginsSheet.match(/async function askInstall\(entry: CatalogEntry\)[^]*?\n  }\n/)![0];
    expect(ask).toMatch(/reviewed\(entry\)/);
    expect(ask).toMatch(/pending = /);
  });

  it('a file always warns first', () => {
    const fromFile = pluginsSheet.match(/async function onBundleFile[^]*?\n  }\n/)![0];
    expect(fromFile).toMatch(/pending = \{ name: file\.name/);
    expect(fromFile).not.toMatch(/installFile\(file\.name, code\);\n\s*return/);
  });

  it('the warning is on ty, says unchecked and full access', () => {
    expect(t('plugins.warn_body')).toMatch(/не провер/);
    expect(t('plugins.warn_body')).toMatch(/полный доступ/);
  });
});

describe('installing from the catalog installs the code it downloaded', () => {
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
});

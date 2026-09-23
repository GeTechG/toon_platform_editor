import { describe, expect, it } from 'bun:test';
import { FileWriteError, guardSink } from '../export/video';
import { OFFICIAL_CATALOG, readCatalog } from '../plugins/catalog';
import { PLUGIN_API } from '../plugins/contract';
import { t } from '../i18n';

// Owner's answers after the twelfth audit, the export and plugins sheets.
// 1. Video streams straight into a file where File System Access is there.
// 2. Plugins are official or community; a community or local one asks first.
const UI = new URL('./', import.meta.url).pathname;
const exportSheet = await Bun.file(UI + 'ExportSheet.svelte').text();
const pluginsSheet = await Bun.file(UI + 'PluginsSheet.svelte').text();
const video = await Bun.file(UI + '../export/video.ts').text();
const install = await Bun.file(UI + '../plugins/install.ts').text();

/** A sink that records what happened to it; `failWrites` makes every write reject. */
function recorder(failWrites = false) {
  const log: string[] = [];
  const stream = new WritableStream<{ type: 'write'; data: Uint8Array; position: number }>({
    write(chunk) {
      if (failWrites) throw new Error('disk full');
      log.push(`write@${chunk.position}`);
    },
    close() {
      log.push('close');
    },
    abort() {
      log.push('abort');
    },
  });
  return { stream, log };
}

const chunk = { type: 'write' as const, data: new Uint8Array(4), position: 0 };

describe('a video streamed into a file', () => {
  it('commits the file only once it is whole', async () => {
    const sink = recorder();
    const guard = guardSink(sink.stream);
    guard.finish();
    const writer = guard.stream.getWriter();
    await writer.write(chunk);
    await writer.close();
    expect(sink.log).toEqual(['write@0', 'close']);
  });

  it('a close before the end (a cancel) aborts the file instead of committing half of it', async () => {
    const sink = recorder();
    const guard = guardSink(sink.stream);
    const writer = guard.stream.getWriter();
    await writer.write(chunk);
    await writer.close();
    expect(sink.log).toEqual(['write@0', 'abort']);
  });

  it('remembers a failed write, so the sheet can say the file did not write', async () => {
    const guard = guardSink(recorder(true).stream);
    const writer = guard.stream.getWriter();
    await writer.write(chunk).catch(() => {});
    expect(guard.failed()).toBeInstanceOf(Error);
    expect(new FileWriteError()).toBeInstanceOf(Error);
    expect(new FileWriteError().message).toBe(t('export.write_failed'));
  });

  it('streams through mediabunny StreamTarget when there is a sink, the buffer otherwise', () => {
    expect(video).toMatch(/file \? new StreamTarget\(/);
    expect(video).toContain('new BufferTarget()');
  });

  it('asks for the file first, inside the click, and only for the WebCodecs path', () => {
    const download = exportSheet.match(/async function download\(\)[^]*?\n  }\n/)![0];
    expect(download).toMatch(/!plan\.realtime/);
    // The picker comes before the first await that is not the picker itself.
    expect(download.indexOf('pickSaveFile(')).toBeGreaterThan(-1);
    expect(download.indexOf('pickSaveFile(')).toBeLessThan(download.indexOf('busy = format'));
  });

  it('removes the unfinished file after a cancel or a failure, and names a failed write', () => {
    expect(exportSheet).toMatch(/\.remove\?\.\(\)/);
    expect(exportSheet).toMatch(/instanceof FileWriteError[^]*?error = err\.message/);
  });
});

describe('official and community plugins', () => {
  const record = (id: string, official?: boolean) => ({
    id,
    name: id,
    version: '1.0.0',
    icon: '<path d="M4 4h16" />',
    entry: `${id}/plugin.js`,
    ...(official === undefined ? {} : { official }),
  });
  const fetchOf = (body: unknown) => async () => ({ json: async () => body });
  const body = { api: PLUGIN_API, plugins: [record('ours', true), record('theirs'), record('liar', true)] };

  it('the official catalog marks what it says is official', async () => {
    const catalog = await readCatalog(OFFICIAL_CATALOG, { fetch: fetchOf(body) });
    expect(catalog.plugins.map((p) => [p.id, p.official])).toEqual([
      ['ours', true],
      ['theirs', false],
      ['liar', true],
    ]);
  });

  it('any other address is a link: nothing it offers is official, whatever it claims', async () => {
    const catalog = await readCatalog('https://plugins.example/build/', { fetch: fetchOf(body) });
    expect(catalog.plugins.every((p) => p.official === false)).toBe(true);
  });

  it('the installed record keeps whether it came in official', () => {
    expect(install).toMatch(/source: 'catalog',\s*official: entry\.official/);
    expect(install).toMatch(/official: entry\.official, code: got\.code/);
  });

  it('every row says official or community, the delivery is official', () => {
    expect(pluginsSheet).toMatch(/source === 'bundled' \|\| plugin\.official/);
    expect(pluginsSheet).toContain("t('plugins.official')");
    expect(pluginsSheet).toContain("t('plugins.community')");
  });

  it('a community catalog plugin and every file ask first; an official one does not', () => {
    const catalogInstall = pluginsSheet.match(/function askInstall\(entry: CatalogEntry\)[^]*?\n  }\n/)![0];
    expect(catalogInstall).toMatch(/entry\.official/);
    const fromFile = pluginsSheet.match(/async function onBundleFile[^]*?\n  }\n/)![0];
    expect(fromFile).toContain('pending =');
    expect(pluginsSheet).toContain("t('plugins.warn_install')");
    expect(pluginsSheet).toContain("t('plugins.warn_cancel')");
  });

  it('the warning is on ty, says unchecked and full access, and never says «оп»', () => {
    const words = [t('plugins.warn_title'), t('plugins.warn_body'), t('plugins.official'), t('plugins.community')];
    const body = t('plugins.warn_body');
    expect(body).toMatch(/не провер/);
    expect(body).toMatch(/полный доступ/);
    expect(body).toMatch(/свой страх/);
    expect(body).not.toMatch(/(^|[^а-яё])(вы|вам|ваш)([^а-яё]|$)/i);
    for (const word of words) expect(word).not.toMatch(/(^|[^а-яё])оп([^а-яё]|$)/i);
    expect(t('plugins.warn_install')).toBe('Установить');
    expect(t('plugins.warn_cancel')).toBe('Отмена');
  });
});
